import snmp from "net-snmp";
import { Client as SSHClient } from "ssh2";
import type { SnmpConcentrator, SnmpProfile } from "@shared/schema";

export interface PppoeSessionInfo {
  username: string;
  ipAddress: string | null;
  macAddress: string | null;
  uptime: string | null;
  interface: string | null;
  ifIndex: number | null;  // Índice da interface SNMP para coleta de tráfego
  ifName: string | null;   // Nome da interface (ifDescr)
  ifAlias: string | null;  // Descrição/alias da interface (ifAlias)
}

interface ConcentratorSnmpProfile {
  version: string;
  port: number;
  community?: string | null;
  securityLevel?: string | null;
  authProtocol?: string | null;
  authPassword?: string | null;
  privProtocol?: string | null;
  privPassword?: string | null;
  username?: string | null;
  timeout: number;
  retries: number;
}

// Mikrotik PPP Active MIB (RouterOS 6.x+)
const PPPOE_OIDS_MIKROTIK = {
  pppActiveUser: "1.3.6.1.4.1.14988.1.1.5.1.1.1",
  pppActiveAddress: "1.3.6.1.4.1.14988.1.1.5.1.1.2",
};

// Mikrotik PPP Secret MIB alternativo (outra branch da MIB)
const PPPOE_OIDS_MIKROTIK_ALT = {
  pppSecretName: "1.3.6.1.4.1.14988.1.1.5.2.1.1",
  pppSecretRemoteAddress: "1.3.6.1.4.1.14988.1.1.5.2.1.3",
};

// IF-MIB padrão para descrição de interfaces (funciona em qualquer equipamento)
const PPPOE_OIDS_IFMIB = {
  ifDescr: "1.3.6.1.2.1.2.2.1.2",
  ifName: "1.3.6.1.2.1.31.1.1.1.1",    // IF-MIB::ifName
  ifAlias: "1.3.6.1.2.1.31.1.1.1.18",  // IF-MIB::ifAlias (descrição)
  ipAdEntIfIndex: "1.3.6.1.2.1.4.20.1.2",
  ipAdEntAddr: "1.3.6.1.2.1.4.20.1.1",
};

const PPPOE_OIDS_CISCO = {
  csubSessionUsername: "1.3.6.1.4.1.9.9.786.1.2.1.1.11",
  csubSessionIpAddr: "1.3.6.1.4.1.9.9.786.1.2.1.1.15",
};

// Cisco ASR: PPPoE sessions use ifAlias for username and ipCidrRouteIfIndex for IP mapping
const PPPOE_OIDS_CISCO_ASR = {
  ifAlias: "1.3.6.1.2.1.31.1.1.1.18",           // Username in interface alias
  ipCidrRouteIfIndex: "1.3.6.1.2.1.4.24.4.1.5", // IP CIDR route table -> ifIndex
  ifDescr: "1.3.6.1.2.1.2.2.1.2",               // Interface description
  ifName: "1.3.6.1.2.1.31.1.1.1.1",             // Interface name
};

const PPPOE_OIDS_HUAWEI = {
  hwBrasSbcUserName: "1.3.6.1.4.1.2011.5.2.1.14.1.2",
  hwBrasSbcUserIpAddr: "1.3.6.1.4.1.2011.5.2.1.14.1.4",
};

function createSnmpSession(
  targetIp: string,
  profile: ConcentratorSnmpProfile
): snmp.Session {
  const version = profile.version.replace("v", "").toLowerCase();
  const snmpVersion = version === "1" ? 0 : 1;

  const options: any = {
    port: profile.port,
    timeout: profile.timeout,
    retries: profile.retries,
    version: snmpVersion,
  };

  if (version === "3") {
    let securityLevel = snmp.SecurityLevel.noAuthNoPriv;
    if (profile.securityLevel === "authNoPriv") {
      securityLevel = snmp.SecurityLevel.authNoPriv;
    } else if (profile.securityLevel === "authPriv") {
      securityLevel = snmp.SecurityLevel.authPriv;
    }

    let authProtocol = snmp.AuthProtocols.none;
    if (profile.authProtocol === "MD5") {
      authProtocol = snmp.AuthProtocols.md5;
    } else if (profile.authProtocol === "SHA") {
      authProtocol = snmp.AuthProtocols.sha;
    }

    let privProtocol = snmp.PrivProtocols.none;
    if (profile.privProtocol === "DES") {
      privProtocol = snmp.PrivProtocols.des;
    } else if (profile.privProtocol === "AES") {
      privProtocol = snmp.PrivProtocols.aes;
    }

    const user: snmp.User = {
      name: profile.username || "",
      level: securityLevel,
      authProtocol,
      authKey: profile.authPassword || "",
      privProtocol,
      privKey: profile.privPassword || "",
    };

    return snmp.createV3Session(targetIp, user, options);
  } else {
    return snmp.createSession(
      targetIp,
      profile.community || "public",
      options
    );
  }
}

async function snmpSubtreeWalk(
  session: snmp.Session,
  oid: string,
  timeoutMs: number = 30000
): Promise<Array<{ index: string; value: string }>> {
  return new Promise((resolve) => {
    const results: Array<{ index: string; value: string }> = [];
    let completed = false;

    const timeoutId = setTimeout(() => {
      if (!completed) {
        completed = true;
        session.close();
        resolve(results);
      }
    }, timeoutMs);

    session.subtree(
      oid,
      (varbinds: snmp.Varbind[]) => {
        for (const vb of varbinds) {
          if ((snmp as any).isVarbindError?.(vb)) continue;

          const fullOid = vb.oid;
          const suffix = fullOid.replace(oid + ".", "");

          let value = "";
          if (Buffer.isBuffer(vb.value)) {
            value = vb.value.toString("utf8").replace(/\x00/g, "").trim();
          } else if (typeof vb.value === "number") {
            value = String(vb.value);
          } else if (typeof vb.value === "string") {
            value = vb.value;
          }

          if (value) {
            results.push({ index: suffix, value });
          }
        }
      },
      (error?: Error) => {
        clearTimeout(timeoutId);
        if (!completed) {
          completed = true;
          if (error) {
            console.log(`[SNMP Walk] Error on ${oid}:`, error.message);
          }
          resolve(results);
        }
      }
    );
  });
}

async function lookupPppoeViaSNMP(
  concentrator: SnmpConcentrator,
  pppoeUsers: string[],
  snmpProfile: SnmpProfile | null
): Promise<Map<string, PppoeSessionInfo>> {
  const results = new Map<string, PppoeSessionInfo>();

  if (!concentrator.ipAddress) {
    console.log(`[PPPoE SNMP] Concentrador ${concentrator.name} sem IP`);
    return results;
  }

  const profile: ConcentratorSnmpProfile = snmpProfile
    ? {
        version: snmpProfile.version,
        port: snmpProfile.port,
        community: snmpProfile.community,
        securityLevel: snmpProfile.securityLevel,
        authProtocol: snmpProfile.authProtocol,
        authPassword: snmpProfile.authPassword,
        privProtocol: snmpProfile.privProtocol,
        privPassword: snmpProfile.privPassword,
        username: snmpProfile.username,
        timeout: snmpProfile.timeout,
        retries: snmpProfile.retries,
      }
    : {
        version: "2c",
        port: 161,
        community: "public",
        timeout: 5000,
        retries: 1,
      };

  const vendor = (concentrator.vendor || "mikrotik").toLowerCase();
  console.log(`[PPPoE SNMP] Buscando ${pppoeUsers.length} sessões em ${concentrator.name} (${vendor}) via SNMP`);
  console.log(`[PPPoE SNMP] Conectando em ${concentrator.ipAddress}:${profile.port} (${profile.version}, community: ${profile.community || 'N/A'})`);

  const session = createSnmpSession(concentrator.ipAddress, profile);

  try {
    // Teste de conectividade SNMP com sysDescr (OID universal)
    const sysDescrOid = "1.3.6.1.2.1.1.1";
    try {
      const sysDescrData = await snmpSubtreeWalk(session, sysDescrOid);
      if (sysDescrData.length > 0) {
        const desc = sysDescrData[0].value.substring(0, 80);
        console.log(`[PPPoE SNMP] Conectividade OK - ${desc}...`);
      } else {
        console.log(`[PPPoE SNMP] AVISO: sysDescr vazio, SNMP pode ter restrições`);
      }
    } catch (connErr: any) {
      console.log(`[PPPoE SNMP] ERRO de conectividade: ${connErr.message}`);
      console.log(`[PPPoE SNMP] Verifique: community string, firewall, SNMP habilitado no Mikrotik`);
      session.close();
      return results;
    }

    // Definir lista de OIDs a tentar baseado no vendor
    type OidPair = { user: string; ip: string; name: string };
    const oidSets: OidPair[] = [];

    if (vendor === "cisco") {
      // Cisco ASR: Try subscriber session MIB first, then fallback to ifAlias method
      oidSets.push({ 
        user: PPPOE_OIDS_CISCO.csubSessionUsername, 
        ip: PPPOE_OIDS_CISCO.csubSessionIpAddr,
        name: "Cisco Subscriber"
      });
      // Fallback: ifAlias contains the PPPoE username
      oidSets.push({ 
        user: PPPOE_OIDS_CISCO_ASR.ifAlias, 
        ip: PPPOE_OIDS_CISCO_ASR.ipCidrRouteIfIndex,
        name: "Cisco ASR ifAlias"
      });
    } else if (vendor === "huawei") {
      oidSets.push({ 
        user: PPPOE_OIDS_HUAWEI.hwBrasSbcUserName, 
        ip: PPPOE_OIDS_HUAWEI.hwBrasSbcUserIpAddr,
        name: "Huawei BRAS"
      });
    } else {
      // Mikrotik: tentar múltiplos OIDs
      oidSets.push({ 
        user: PPPOE_OIDS_MIKROTIK.pppActiveUser, 
        ip: PPPOE_OIDS_MIKROTIK.pppActiveAddress,
        name: "Mikrotik PPP Active"
      });
      oidSets.push({ 
        user: PPPOE_OIDS_MIKROTIK_ALT.pppSecretName, 
        ip: PPPOE_OIDS_MIKROTIK_ALT.pppSecretRemoteAddress,
        name: "Mikrotik PPP Secret"
      });
      // Fallback: IF-MIB para interfaces <ppp-username>
      oidSets.push({ 
        user: PPPOE_OIDS_IFMIB.ifDescr, 
        ip: PPPOE_OIDS_IFMIB.ipAdEntAddr,
        name: "IF-MIB Standard"
      });
    }

    let usersData: { index: string; value: string }[] = [];
    let addressData: { index: string; value: string }[] = [];
    let usedOidSet = "";

    // Tentar cada conjunto de OIDs até encontrar dados
    for (const oidSet of oidSets) {
      console.log(`[PPPoE SNMP] Tentando OIDs: ${oidSet.name}`);
      
      const [users, addresses] = await Promise.all([
        snmpSubtreeWalk(session, oidSet.user),
        snmpSubtreeWalk(session, oidSet.ip),
      ]);

      console.log(`[PPPoE SNMP] ${oidSet.name}: ${users.length} usuários, ${addresses.length} IPs`);

      if (users.length > 0) {
        usersData = users;
        addressData = addresses;
        usedOidSet = oidSet.name;
        break;
      }
    }

    console.log(`[PPPoE SNMP] Walk final: ${usersData.length} usuários ativos usando "${usedOidSet || 'nenhum'}"`);
    
    // Debug: mostrar primeiros 5 usuários ativos
    if (usersData.length > 0) {
      const sample = usersData.slice(0, 5).map(u => u.value).join(", ");
      console.log(`[PPPoE SNMP] Amostra de usuários ativos: ${sample}${usersData.length > 5 ? '...' : ''}`);
    }

    const userIndex = new Map<string, string>();
    for (const item of usersData) {
      // Para IF-MIB, extrair username de interfaces tipo <ppp-USERNAME> ou <pppoe-USERNAME>
      let username = item.value;
      const pppMatch = username.match(/<ppp(?:oe)?-([^>]+)>/i);
      if (pppMatch) {
        username = pppMatch[1];
      }
      userIndex.set(username.toLowerCase(), item.index);
    }
    
    // Debug: mostrar o que estamos buscando
    console.log(`[PPPoE SNMP] Buscando usuários: ${pppoeUsers.join(", ")}`);
    
    // Debug: verificar match parcial
    for (const pppoeUser of pppoeUsers) {
      const userLower = pppoeUser.toLowerCase();
      const found = userIndex.has(userLower);
      if (!found && usersData.length > 0) {
        // Tentar encontrar match parcial
        const partial = usersData.find(u => {
          const val = u.value.toLowerCase();
          return val.includes(userLower) || userLower.includes(val);
        });
        if (partial) {
          console.log(`[PPPoE SNMP] Match parcial encontrado: buscando "${pppoeUser}" -> encontrado "${partial.value}"`);
        }
      }
    }

    // Para IF-MIB e Cisco ASR, o mapeamento IP é diferente
    // Precisamos buscar na tabela de rotas que mapeia IP -> ifIndex
    const ipByIndex = new Map<string, string>();
    const ifNameByIndex = new Map<string, string>();
    const ifAliasByIndex = new Map<string, string>();
    
    if (usedOidSet === "Cisco ASR ifAlias") {
      // Cisco ASR: ifAlias contains username, ipCidrRouteIfIndex maps IP to ifIndex
      // Format: OID.IP.MASK.0.0.0.0.0 = ifIndex
      // Example: .1.3.6.1.2.1.4.24.4.1.5.100.80.16.1.255.255.255.255.0.0.0.0.0 = 38
      console.log(`[PPPoE SNMP] Cisco ASR: Buscando ifName e ifDescr...`);
      const [ifNameData, ifDescrData] = await Promise.all([
        snmpSubtreeWalk(session, PPPOE_OIDS_CISCO_ASR.ifName),
        snmpSubtreeWalk(session, PPPOE_OIDS_CISCO_ASR.ifDescr),
      ]);
      
      for (const item of ifNameData) {
        ifNameByIndex.set(item.index, item.value);
      }
      for (const item of ifDescrData) {
        if (item.value && item.value.trim()) {
          ifAliasByIndex.set(item.index, item.value.trim());
        }
      }
      console.log(`[PPPoE SNMP] Cisco ASR: ifName: ${ifNameByIndex.size}, ifDescr: ${ifAliasByIndex.size} entradas`);
      
      // Parse ipCidrRouteIfIndex: index format is IP.MASK.NEXTHOP (13 octets)
      // We need to extract the IP (first 4 octets) and map to ifIndex
      console.log(`[PPPoE SNMP] Cisco ASR: Processando tabela de rotas CIDR (${addressData.length} entradas)...`);
      
      for (const item of addressData) {
        const ifIndex = item.value;
        // Index format: IP.MASK.NEXTHOP (e.g., 100.80.16.1.255.255.255.255.0.0.0.0.0)
        const parts = item.index.split(".");
        if (parts.length >= 4) {
          const ip = parts.slice(0, 4).join(".");
          // Only save valid IPs (not 0.0.0.0, not loopback, not multicast)
          if (ip && !ip.startsWith("0.") && !ip.startsWith("127.") && !ip.startsWith("224.")) {
            // Map ifIndex -> IP (prefer first occurrence)
            if (!ipByIndex.has(ifIndex)) {
              ipByIndex.set(ifIndex, ip);
            }
          }
        }
      }
      console.log(`[PPPoE SNMP] Cisco ASR: Mapeamento ifIndex->IP: ${ipByIndex.size} entradas`);
      
      // Debug: show sample of mappings
      if (ipByIndex.size > 0) {
        const sample = Array.from(ipByIndex.entries()).slice(0, 3)
          .map(([idx, ip]) => `${idx}=${ip}`).join(", ");
        console.log(`[PPPoE SNMP] Cisco ASR: Amostra ifIndex->IP: ${sample}...`);
      }
    } else if (usedOidSet === "IF-MIB Standard") {
      // Buscar ifName e ifAlias para todas as interfaces
      console.log(`[PPPoE SNMP] Buscando ifName e ifAlias...`);
      const [ifNameData, ifAliasData] = await Promise.all([
        snmpSubtreeWalk(session, PPPOE_OIDS_IFMIB.ifName),
        snmpSubtreeWalk(session, PPPOE_OIDS_IFMIB.ifAlias),
      ]);
      
      for (const item of ifNameData) {
        ifNameByIndex.set(item.index, item.value);
      }
      for (const item of ifAliasData) {
        if (item.value && item.value.trim()) {
          ifAliasByIndex.set(item.index, item.value.trim());
        }
      }
      console.log(`[PPPoE SNMP] ifName: ${ifNameByIndex.size}, ifAlias: ${ifAliasByIndex.size} entradas`);
      
      // Buscar tabela de rotas IP: ipRouteIfIndex (1.3.6.1.2.1.4.21.1.2)
      // Retorna: OID.IP -> ifIndex (ex: 1.3.6.1.2.1.4.21.1.2.100.80.3.120 = 15741616)
      console.log(`[PPPoE SNMP] Buscando tabela de rotas IP (ipRouteIfIndex)...`);
      const ipRouteIfIndex = "1.3.6.1.2.1.4.21.1.2";
      const routeData = await snmpSubtreeWalk(session, ipRouteIfIndex);
      console.log(`[PPPoE SNMP] Tabela de rotas: ${routeData.length} entradas`);
      
      // routeData: index=IP, value=ifIndex
      // Precisamos inverter: ifIndex -> IP
      for (const item of routeData) {
        const ifIndex = item.value;
        const ip = item.index; // IP no formato A.B.C.D
        // Só salvar IPs válidos (não 0.0.0.0, não loopback, não multicast)
        if (ip && !ip.startsWith("0.") && !ip.startsWith("127.") && !ip.startsWith("224.")) {
          // Se já temos um IP para este ifIndex, preferir o mais específico (evitar redes)
          if (!ipByIndex.has(ifIndex)) {
            ipByIndex.set(ifIndex, ip);
          }
        }
      }
      console.log(`[PPPoE SNMP] Mapeamento ifIndex->IP: ${ipByIndex.size} entradas`);
    } else {
      for (const item of addressData) {
        ipByIndex.set(item.index, item.value);
      }
    }

    for (const pppoeUser of pppoeUsers) {
      const userLower = pppoeUser.toLowerCase();
      const idx = userIndex.get(userLower);

      if (idx) {
        const ip = ipByIndex.get(idx);
        const ifName = ifNameByIndex.get(idx) || null;
        const ifAlias = ifAliasByIndex.get(idx) || null;
        const ifIndexNum = parseInt(idx, 10);
        console.log(`[PPPoE SNMP] Usuário "${pppoeUser}" -> ifIndex ${idx}, ifName: ${ifName || 'N/A'}, ifAlias: ${ifAlias || 'N/A'}, IP: ${ip || 'N/A'}`);
        // Salvar sessão mesmo sem IP se temos o ifIndex (útil para coleta de tráfego)
        results.set(pppoeUser, {
          username: pppoeUser,
          ipAddress: (ip && ip !== "0.0.0.0") ? ip : null,
          macAddress: null,
          uptime: null,
          interface: null,
          ifIndex: isNaN(ifIndexNum) ? null : ifIndexNum,
          ifName: ifName,
          ifAlias: ifAlias,
        });
      } else {
        console.log(`[PPPoE SNMP] Usuário "${pppoeUser}" não encontrado no índice`);
      }
    }

    console.log(`[PPPoE SNMP] Encontradas ${results.size} sessões de ${pppoeUsers.length} buscadas (SNMP retornou ${ipByIndex.size} mapeamentos IP)`);
  } catch (error) {
    console.error(`[PPPoE SNMP] Erro:`, error instanceof Error ? error.message : error);
  } finally {
    session.close();
  }

  return results;
}

interface SshConnectionOptions {
  host: string;
  port: number;
  username: string;
  password: string;
  timeout?: number;
}

async function executeSSHCommand(
  options: SshConnectionOptions,
  command: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = new SSHClient();
    let output = "";
    const timeout = options.timeout || 15000;

    const timeoutId = setTimeout(() => {
      client.end();
      reject(new Error("SSH connection timeout"));
    }, timeout);

    client.on("ready", () => {
      client.exec(command, (err, stream) => {
        if (err) {
          clearTimeout(timeoutId);
          client.end();
          reject(err);
          return;
        }

        stream.on("close", () => {
          clearTimeout(timeoutId);
          client.end();
          resolve(output);
        });

        stream.on("data", (data: Buffer) => {
          output += data.toString();
        });

        stream.stderr.on("data", () => {});
      });
    });

    client.on("error", (err) => {
      clearTimeout(timeoutId);
      reject(err);
    });

    client.connect({
      host: options.host,
      port: options.port,
      username: options.username,
      password: options.password,
      readyTimeout: timeout,
      algorithms: {
        kex: [
          "curve25519-sha256",
          "curve25519-sha256@libssh.org",
          "ecdh-sha2-nistp256",
          "ecdh-sha2-nistp384",
          "ecdh-sha2-nistp521",
          "diffie-hellman-group-exchange-sha256",
          "diffie-hellman-group14-sha256",
          "diffie-hellman-group14-sha1",
          "diffie-hellman-group1-sha1",
        ],
        cipher: [
          "aes128-ctr",
          "aes192-ctr",
          "aes256-ctr",
          "aes128-gcm",
          "aes128-gcm@openssh.com",
          "aes256-gcm",
          "aes256-gcm@openssh.com",
          "aes256-cbc",
          "aes192-cbc",
          "aes128-cbc",
          "3des-cbc",
        ],
      },
    });
  });
}

function parseMikrotikPppSession(output: string, pppoeUser: string): PppoeSessionInfo | null {
  const simpleMatch = output.match(
    new RegExp(`${pppoeUser.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?address=([\\d.]+)`, "i")
  );
  if (simpleMatch) {
    return {
      username: pppoeUser,
      ipAddress: simpleMatch[1],
      macAddress: null,
      uptime: null,
      interface: null,
      ifIndex: null,
      ifName: null,
      ifAlias: null,
    };
  }
  return null;
}

function parseCiscoPppSession(output: string, pppoeUser: string): PppoeSessionInfo | null {
  const lines = output.split("\n");
  for (const line of lines) {
    if (line.toLowerCase().includes(pppoeUser.toLowerCase())) {
      const ipMatch = line.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
      if (ipMatch) {
        return {
          username: pppoeUser,
          ipAddress: ipMatch[1],
          macAddress: null,
          uptime: null,
          interface: null,
          ifIndex: null,
          ifName: null,
          ifAlias: null,
        };
      }
    }
  }
  return null;
}

function parseHuaweiPppSession(output: string, pppoeUser: string): PppoeSessionInfo | null {
  const lines = output.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.toLowerCase().includes(pppoeUser.toLowerCase())) {
      for (let j = i; j < Math.min(i + 10, lines.length); j++) {
        const ipMatch = lines[j].match(/IP[:\s]+(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/i);
        if (ipMatch) {
          return {
            username: pppoeUser,
            ipAddress: ipMatch[1],
            macAddress: null,
            uptime: null,
            interface: null,
            ifIndex: null,
            ifName: null,
            ifAlias: null,
          };
        }
      }
    }
  }
  return null;
}

async function lookupPppoeViaSSH(
  concentrator: SnmpConcentrator,
  pppoeUsers: string[],
  password?: string
): Promise<Map<string, PppoeSessionInfo>> {
  const results = new Map<string, PppoeSessionInfo>();

  if (!concentrator.sshUser || !concentrator.ipAddress) {
    return results;
  }

  const sshPassword = password || concentrator.sshPassword || "";
  if (!sshPassword) {
    return results;
  }

  const vendor = (concentrator.vendor || "mikrotik").toLowerCase();
  console.log(`[PPPoE SSH] Buscando ${pppoeUsers.length} sessões em ${concentrator.name} (${vendor}) via SSH`);

  try {
    let command: string;
    if (vendor === "mikrotik") {
      command = `/ppp active print`;
    } else if (vendor === "cisco") {
      command = `show subscriber session all`;
    } else if (vendor === "huawei") {
      command = `display access-user`;
    } else {
      command = `/ppp active print`;
    }

    const output = await executeSSHCommand(
      {
        host: concentrator.ipAddress,
        port: concentrator.sshPort || 22,
        username: concentrator.sshUser,
        password: sshPassword,
        timeout: 30000,
      },
      command
    );

    for (const pppoeUser of pppoeUsers) {
      let session: PppoeSessionInfo | null = null;

      switch (vendor) {
        case "cisco":
          session = parseCiscoPppSession(output, pppoeUser);
          break;
        case "huawei":
          session = parseHuaweiPppSession(output, pppoeUser);
          break;
        case "mikrotik":
        default:
          session = parseMikrotikPppSession(output, pppoeUser);
          break;
      }

      if (session?.ipAddress) {
        results.set(pppoeUser, session);
      }
    }

    console.log(`[PPPoE SSH] Encontradas ${results.size} sessões de ${pppoeUsers.length} buscadas`);
  } catch (error) {
    console.error(`[PPPoE SSH] Erro:`, error instanceof Error ? error.message : error);
  }

  return results;
}

export async function lookupPppoeSession(
  concentrator: SnmpConcentrator,
  pppoeUser: string,
  password?: string,
  snmpProfile?: SnmpProfile | null
): Promise<PppoeSessionInfo | null> {
  const results = await lookupMultiplePppoeSessions(
    concentrator,
    [pppoeUser],
    password,
    snmpProfile
  );
  return results.get(pppoeUser) || null;
}

export async function lookupMultiplePppoeSessions(
  concentrator: SnmpConcentrator,
  pppoeUsers: string[],
  password?: string,
  snmpProfile?: SnmpProfile | null
): Promise<Map<string, PppoeSessionInfo>> {
  if (pppoeUsers.length === 0) {
    return new Map();
  }

  let results = await lookupPppoeViaSNMP(concentrator, pppoeUsers, snmpProfile || null);

  if (results.size === 0 && concentrator.sshUser && concentrator.sshPassword) {
    console.log(`[PPPoE Lookup] SNMP não retornou resultados, tentando SSH como fallback`);
    results = await lookupPppoeViaSSH(concentrator, pppoeUsers, password);
  }

  return results;
}

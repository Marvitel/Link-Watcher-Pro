import snmp from "net-snmp";
import { Client as SSHClient } from "ssh2";
import type { SnmpConcentrator, SnmpProfile } from "@shared/schema";

// Mapa OUI (primeiros 3 bytes do MAC) -> Vendor slug
// OUI identifica o fabricante do dispositivo
const OUI_VENDOR_MAP: Record<string, string> = {
  // Mikrotik
  "d4:ca:6d": "mikrotik",
  "e4:8d:8c": "mikrotik",
  "6c:3b:6b": "mikrotik",
  "4c:5e:0c": "mikrotik",
  "2c:c8:1b": "mikrotik",
  "74:4d:28": "mikrotik",
  "b8:69:f4": "mikrotik",
  "dc:2c:6e": "mikrotik",
  "48:a9:8a": "mikrotik",
  "64:d1:54": "mikrotik",
  "cc:2d:e0": "mikrotik",
  "c4:ad:34": "mikrotik",
  "18:fd:74": "mikrotik",
  "08:55:31": "mikrotik",
  
  // Huawei
  "00:18:82": "huawei",
  "00:1e:10": "huawei",
  "00:25:9e": "huawei",
  "00:e0:fc": "huawei",
  "04:02:1f": "huawei",
  "04:bd:70": "huawei",
  "08:63:61": "huawei",
  "0c:37:dc": "huawei",
  "10:1b:54": "huawei",
  "24:09:95": "huawei",
  "28:6e:d4": "huawei",
  "34:6a:c2": "huawei",
  "48:00:31": "huawei",
  "54:89:98": "huawei",
  "5c:7d:5e": "huawei",
  "60:de:44": "huawei",
  "70:7b:e8": "huawei",
  "80:fb:06": "huawei",
  "88:66:39": "huawei",
  "ac:cf:85": "huawei",
  "c4:05:28": "huawei",
  "d4:40:f0": "huawei",
  "e0:24:7f": "huawei",
  "e8:68:e7": "huawei",
  "f4:4c:7f": "huawei",
  "f8:01:13": "huawei",
  "fc:48:ef": "huawei",
  
  // Intelbras
  "00:1a:3f": "intelbras",
  "78:c2:c0": "intelbras",
  "00:0d:2b": "intelbras",
  "ac:84:c6": "intelbras",
  "dc:5e:6a": "intelbras",
  "d8:a7:56": "intelbras",
  "e0:37:bf": "intelbras",
  "b0:4e:26": "intelbras",
  "88:c3:97": "intelbras",
  
  // Cisco
  "00:00:0c": "cisco",
  "00:01:42": "cisco",
  "00:01:43": "cisco",
  "00:01:63": "cisco",
  "00:01:64": "cisco",
  "00:01:96": "cisco",
  "00:01:97": "cisco",
  "00:02:16": "cisco",
  "00:02:17": "cisco",
  "00:02:3d": "cisco",
  "00:02:4a": "cisco",
  "00:02:4b": "cisco",
  
  // TP-Link
  "00:27:19": "tp-link",
  "10:fe:ed": "tp-link",
  "14:cc:20": "tp-link",
  "18:a6:f7": "tp-link",
  "1c:3b:f3": "tp-link",
  "30:b5:c2": "tp-link",
  "50:c7:bf": "tp-link",
  "54:c8:0f": "tp-link",
  "60:e3:27": "tp-link",
  "64:66:b3": "tp-link",
  "6c:5a:b5": "tp-link",
  "78:44:76": "tp-link",
  "90:f6:52": "tp-link",
  "98:da:c4": "tp-link",
  "a0:f3:c1": "tp-link",
  "c0:25:e9": "tp-link",
  "d8:07:b6": "tp-link",
  "e8:94:f6": "tp-link",
  "f4:ec:38": "tp-link",
  "f8:1a:67": "tp-link",
  
  // Ubiquiti
  "00:15:6d": "ubiquiti",
  "00:27:22": "ubiquiti",
  "04:18:d6": "ubiquiti",
  "24:a4:3c": "ubiquiti",
  "44:d9:e7": "ubiquiti",
  "60:22:32": "ubiquiti",
  "68:72:51": "ubiquiti",
  "74:83:c2": "ubiquiti",
  "78:8a:20": "ubiquiti",
  "80:2a:a8": "ubiquiti",
  "dc:9f:db": "ubiquiti",
  "e0:63:da": "ubiquiti",
  "f0:9f:c2": "ubiquiti",
  "fc:ec:da": "ubiquiti",
  
  // ZTE
  "00:19:c6": "zte",
  "00:22:93": "zte",
  "00:25:12": "zte",
  "00:26:ed": "zte",
  "1c:1d:67": "zte",
  "28:28:5d": "zte",
  "34:4b:50": "zte",
  "54:22:f8": "zte",
  "58:2a:f7": "zte",
  "64:13:6c": "zte",
  "74:a7:8e": "zte",
  "78:31:c1": "zte",
  "84:74:2a": "zte",
  "90:4e:2b": "zte",
  "a0:ec:80": "zte",
  "b4:b3:62": "zte",
  "c8:7b:5b": "zte",
  "cc:a2:23": "zte",
  "d4:6e:5c": "zte",
  "e4:3e:d7": "zte",
  "f8:6e:cf": "zte",
  "fc:2d:5e": "zte",
  
  // Fiberhome
  "00:25:68": "fiberhome",
  "1c:a0:b8": "fiberhome",
  "24:c4:2f": "fiberhome",
  "48:2c:a0": "fiberhome",
  "54:be:53": "fiberhome",
  "58:ba:d4": "fiberhome",
  "60:45:cb": "fiberhome",
  "6c:5c:3d": "fiberhome",
  "74:2b:0f": "fiberhome",
  "7c:a2:3e": "fiberhome",
  "88:ce:fa": "fiberhome",
  "90:47:3c": "fiberhome",
  "a4:8e:af": "fiberhome",
  "b0:26:28": "fiberhome",
  "cc:50:0a": "fiberhome",
  "d8:1b:be": "fiberhome",
  "e4:f3:e8": "fiberhome",
  "f8:59:71": "fiberhome",
  
  // Datacom
  "00:04:38": "datacom",
  
  // Nokia (Alcatel-Lucent)
  "00:1d:b5": "nokia",
  "00:20:da": "nokia",
  "38:22:d6": "nokia",
  "3c:fa:d3": "nokia",
  "48:a9:d2": "nokia",
  "60:eb:69": "nokia",
  "74:a0:2f": "nokia",
  "c8:b5:b7": "nokia",
  "d4:64:e0": "nokia",
  
  // Juniper
  "00:05:85": "juniper",
  "00:10:db": "juniper",
  "00:12:1e": "juniper",
  "00:14:f6": "juniper",
  "00:17:cb": "juniper",
  "00:19:e2": "juniper",
  "00:1b:c0": "juniper",
  "00:1f:12": "juniper",
  "00:21:59": "juniper",
  "00:22:83": "juniper",
  "00:23:9c": "juniper",
  "00:24:dc": "juniper",
  "00:26:88": "juniper",
  
  // Fortinet
  "00:09:0f": "fortinet",
  "00:0c:e6": "fortinet",
  "08:5b:0e": "fortinet",
  "70:4c:a5": "fortinet",
  "90:6c:ac": "fortinet",
  
  // Aruba
  "00:0b:86": "aruba",
  "00:1a:1e": "aruba",
  "00:24:6c": "aruba",
  "04:bd:88": "aruba",
  "18:64:72": "aruba",
  "20:4c:03": "aruba",
  "24:de:c6": "aruba",
  "40:e3:d6": "aruba",
  "6c:f3:7f": "aruba",
  "84:d4:7e": "aruba",
  "94:b4:0f": "aruba",
  "9c:1c:12": "aruba",
  "a8:bd:27": "aruba",
  "d8:c7:c8": "aruba",
};

/**
 * Detecta o vendor slug pelo MAC address (OUI lookup)
 * @param macAddress MAC address no formato XX:XX:XX:XX:XX:XX ou XX-XX-XX-XX-XX-XX
 * @returns Vendor slug ou null se não encontrado
 */
export function detectVendorByMac(macAddress: string | null | undefined): string | null {
  if (!macAddress) return null;
  
  // Normalizar MAC para lowercase com ":"
  const normalizedMac = macAddress.toLowerCase().replace(/-/g, ":");
  
  // Extrair OUI (primeiros 3 bytes = 8 caracteres com ":")
  const oui = normalizedMac.substring(0, 8);
  
  const vendorSlug = OUI_VENDOR_MAP[oui];
  if (vendorSlug) {
    console.log(`[OUI Lookup] MAC ${macAddress} -> Vendor: ${vendorSlug}`);
    return vendorSlug;
  }
  
  console.log(`[OUI Lookup] MAC ${macAddress} -> Vendor não identificado (OUI: ${oui})`);
  return null;
}

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
  pppActiveCallerID: "1.3.6.1.4.1.14988.1.1.5.1.1.4", // MAC address do cliente
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

// OIDs para links corporativos (VLAN interface + ARP)
const CORPORATE_OIDS = {
  // ARP Table - ipNetToMediaTable (RFC 2011/4293)
  ipNetToMediaIfIndex: "1.3.6.1.2.1.4.22.1.1",    // ifIndex da interface
  ipNetToMediaPhysAddress: "1.3.6.1.2.1.4.22.1.2", // MAC address
  ipNetToMediaNetAddress: "1.3.6.1.2.1.4.22.1.3",  // IP address
  ipNetToMediaType: "1.3.6.1.2.1.4.22.1.4",        // Tipo de entrada (1=other, 2=invalid, 3=dynamic, 4=static)
  // Interface table
  ifDescr: "1.3.6.1.2.1.2.2.1.2",                  // Interface description
  ifName: "1.3.6.1.2.1.31.1.1.1.1",                // Interface name (IF-MIB)
  ifAlias: "1.3.6.1.2.1.31.1.1.1.18",              // Interface alias/description
};

export interface CorporateLinkInfo {
  vlanInterface: string;
  ifIndex: number;
  ipAddress: string | null;
  macAddress: string | null;
  ipBlock: string | null; // Bloco IP para monitoramento de blacklist (ex: "191.52.254.164/32")
}

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

  // Derive vendor from equipmentVendorId name or use explicit vendor field
  let vendor = (concentrator.vendor || "").toLowerCase();
  
  // If no explicit vendor, try to derive from equipment vendor name
  if (!vendor && concentrator.equipmentVendorId) {
    // Common vendor name mappings
    const vendorNameMappings: Record<string, string> = {
      "cisco": "cisco",
      "mikrotik": "mikrotik",
      "huawei": "huawei",
      "juniper": "juniper",
      "routeros": "mikrotik",
    };
    // We'll need to get the vendor name from the database
    // For now, check if concentrator has any hint in name/model
    const nameHints = `${concentrator.name} ${concentrator.model || ""}`.toLowerCase();
    if (nameHints.includes("cisco") || nameHints.includes("asr") || nameHints.includes("ios")) {
      vendor = "cisco";
    } else if (nameHints.includes("mikrotik") || nameHints.includes("routeros")) {
      vendor = "mikrotik";
    } else if (nameHints.includes("huawei") || nameHints.includes("ne40") || nameHints.includes("ne8k")) {
      vendor = "huawei";
    } else if (nameHints.includes("juniper")) {
      vendor = "juniper";
    }
  }
  
  // Default to mikrotik if still no vendor
  if (!vendor) {
    vendor = "mikrotik";
  }
  
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
        mac: PPPOE_OIDS_MIKROTIK.pppActiveCallerID, // MAC do cliente
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
    let macData: { index: string; value: string }[] = [];
    let usedOidSet = "";

    // Tentar cada conjunto de OIDs até encontrar os usuários específicos que buscamos
    for (const oidSet of oidSets) {
      console.log(`[PPPoE SNMP] Tentando OIDs: ${oidSet.name}`);
      
      const walkPromises: Promise<{ index: string; value: string }[]>[] = [
        snmpSubtreeWalk(session, oidSet.user),
        snmpSubtreeWalk(session, oidSet.ip),
      ];
      
      // Adicionar walk do MAC se disponível
      if ((oidSet as any).mac) {
        walkPromises.push(snmpSubtreeWalk(session, (oidSet as any).mac));
      }
      
      const walkResults = await Promise.all(walkPromises);
      const users = walkResults[0];
      const addresses = walkResults[1];
      const macs = walkResults[2] || [];

      console.log(`[PPPoE SNMP] ${oidSet.name}: ${users.length} usuários, ${addresses.length} IPs, ${macs.length} MACs`);

      if (users.length > 0) {
        // Verificar se encontramos pelo menos um dos usuários que buscamos
        const foundTarget = pppoeUsers.some(pppoeUser => {
          const userLower = pppoeUser.toLowerCase();
          return users.some(u => {
            let username = u.value;
            // Normalizar username (extrair de <ppp-xxx> se necessário)
            const pppMatch = username.match(/<ppp(?:oe)?-([^>]+)>/i);
            if (pppMatch) username = pppMatch[1];
            return username.toLowerCase() === userLower || username.toLowerCase().includes(userLower);
          });
        });
        
        if (foundTarget || usersData.length === 0) {
          // Encontramos o usuário alvo OU é nossa primeira opção com dados
          usersData = users;
          addressData = addresses;
          macData = macs;
          usedOidSet = oidSet.name;
          if (foundTarget) {
            console.log(`[PPPoE SNMP] ${oidSet.name}: Usuário alvo encontrado, usando este OID set`);
            break;
          }
          console.log(`[PPPoE SNMP] ${oidSet.name}: Usuário alvo NÃO encontrado, tentando próximo OID set...`);
        }
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
      let routeData = await snmpSubtreeWalk(session, ipRouteIfIndex);
      console.log(`[PPPoE SNMP] Tabela de rotas: ${routeData.length} entradas`);
      
      // If ipRouteIfIndex returns no results, try ipCidrRouteIfIndex (Cisco ASR uses this)
      if (routeData.length === 0) {
        console.log(`[PPPoE SNMP] Tentando tabela CIDR (ipCidrRouteIfIndex)...`);
        const ipCidrRouteIfIndex = "1.3.6.1.2.1.4.24.4.1.5";
        const cidrData = await snmpSubtreeWalk(session, ipCidrRouteIfIndex);
        console.log(`[PPPoE SNMP] Tabela CIDR: ${cidrData.length} entradas`);
        
        // Parse CIDR format: IP.MASK.NEXTHOP (13 octets) -> ifIndex
        for (const item of cidrData) {
          const ifIndex = item.value;
          const parts = item.index.split(".");
          if (parts.length >= 4) {
            const ip = parts.slice(0, 4).join(".");
            // Only save valid IPs (not networks, not loopback)
            if (ip && !ip.startsWith("0.") && !ip.startsWith("127.") && !ip.startsWith("224.")) {
              // Skip network routes (check if mask is /32 = 255.255.255.255)
              const isMask32 = parts.length >= 8 && 
                parts[4] === "255" && parts[5] === "255" && parts[6] === "255" && parts[7] === "255";
              if (isMask32 && !ipByIndex.has(ifIndex)) {
                ipByIndex.set(ifIndex, ip);
              }
            }
          }
        }
        console.log(`[PPPoE SNMP] CIDR Mapeamento ifIndex->IP: ${ipByIndex.size} entradas`);
      } else {
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
      }
    } else {
      for (const item of addressData) {
        ipByIndex.set(item.index, item.value);
      }
    }

    // Build reverse index from ifAlias (for Cisco ASR where username is in ifAlias)
    const ifAliasUserIndex = new Map<string, string>();
    const aliasEntries = Array.from(ifAliasByIndex.entries());
    for (const entry of aliasEntries) {
      const ifIndex = entry[0];
      const alias = entry[1];
      // ifAlias may contain the PPPoE username directly
      if (alias) {
        ifAliasUserIndex.set(alias.toLowerCase(), ifIndex);
      }
    }
    if (ifAliasUserIndex.size > 0) {
      console.log(`[PPPoE SNMP] Índice ifAlias->ifIndex: ${ifAliasUserIndex.size} entradas`);
      // Debug: show some aliases
      const sampleAliases = Array.from(ifAliasUserIndex.keys()).slice(0, 5).join(", ");
      console.log(`[PPPoE SNMP] Amostra ifAlias: ${sampleAliases}`);
    }

    for (const pppoeUser of pppoeUsers) {
      const userLower = pppoeUser.toLowerCase();
      let idx = userIndex.get(userLower);
      let foundVia = "userIndex";

      // If not found in primary userIndex, try ifAlias index (Cisco ASR pattern)
      if (!idx && ifAliasUserIndex.size > 0) {
        idx = ifAliasUserIndex.get(userLower);
        if (idx) {
          foundVia = "ifAlias";
          console.log(`[PPPoE SNMP] Usuário "${pppoeUser}" encontrado via ifAlias -> ifIndex ${idx}`);
        }
      }

      if (idx) {
        const ip = ipByIndex.get(idx);
        const ifName = ifNameByIndex.get(idx) || null;
        const ifAlias = ifAliasByIndex.get(idx) || null;
        const ifIndexNum = parseInt(idx, 10);
        console.log(`[PPPoE SNMP] Usuário "${pppoeUser}" -> ifIndex ${idx} (via ${foundVia}), ifName: ${ifName || 'N/A'}, ifAlias: ${ifAlias || 'N/A'}, IP: ${ip || 'N/A'}`);
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

  // Derive vendor from name/model hints or use explicit vendor field
  let vendor = (concentrator.vendor || "").toLowerCase();
  if (!vendor) {
    const nameHints = `${concentrator.name} ${concentrator.model || ""}`.toLowerCase();
    if (nameHints.includes("cisco") || nameHints.includes("asr") || nameHints.includes("ios")) {
      vendor = "cisco";
    } else if (nameHints.includes("mikrotik") || nameHints.includes("routeros")) {
      vendor = "mikrotik";
    } else if (nameHints.includes("huawei") || nameHints.includes("ne40") || nameHints.includes("ne8k")) {
      vendor = "huawei";
    } else {
      vendor = "mikrotik";
    }
  }
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

/**
 * Busca o ifIndex de uma interface VLAN no concentrador
 * Suporta diferentes formatos: "Vlan100", "vlan.100", "GigabitEthernet0/0/0.100", etc.
 */
export async function lookupVlanInterfaceIndex(
  concentrator: SnmpConcentrator,
  vlanInterface: string,
  snmpProfile?: SnmpProfile | null
): Promise<{ ifIndex: number; ifName: string } | null> {
  if (!vlanInterface) {
    return null;
  }

  console.log(`[Corporate SNMP] Buscando ifIndex para interface "${vlanInterface}" em ${concentrator.name}`);

  const profile: ConcentratorSnmpProfile =
    snmpProfile
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

  const session = createSnmpSession(concentrator.ipAddress, profile);

  try {
    // Buscar ifDescr e ifName para todas as interfaces
    const ifDescrData = await snmpSubtreeWalk(session, CORPORATE_OIDS.ifDescr);
    const ifNameData = await snmpSubtreeWalk(session, CORPORATE_OIDS.ifName);

    console.log(`[Corporate SNMP] Encontradas ${ifDescrData.length} interfaces via ifDescr, ${ifNameData.length} via ifName`);
    
    // Debug: mostrar algumas interfaces encontradas para verificar se a busca SNMP está funcionando
    if (ifNameData.length > 0) {
      const sample = ifNameData.slice(0, 5).map(e => e.value).join(', ');
      console.log(`[Corporate SNMP] Primeiras interfaces (ifName): ${sample}...`);
    }

    // Normalizar o nome da interface para busca
    const normalizedSearch = vlanInterface.toLowerCase().replace(/[.\-_\s]/g, "");
    console.log(`[Corporate SNMP] Buscando normalizado: "${normalizedSearch}"`);
    
    // Debug: buscar interface específica na lista
    const exactMatch = ifNameData.find(e => e.value === vlanInterface);
    if (exactMatch) {
      console.log(`[Corporate SNMP] Interface encontrada diretamente: ${exactMatch.value} (index: ${exactMatch.index})`);
    }

    // Primeiro tentar ifName (mais preciso)
    for (const entry of ifNameData) {
      const ifIndex = parseInt(entry.index.split(".").pop() || "0", 10);
      const ifName = entry.value;
      const normalizedName = ifName.toLowerCase().replace(/[.\-_\s]/g, "");

      if (normalizedName === normalizedSearch || 
          normalizedName.includes(normalizedSearch) || 
          normalizedSearch.includes(normalizedName)) {
        console.log(`[Corporate SNMP] Match encontrado via ifName: "${ifName}" -> ifIndex ${ifIndex}`);
        session.close();
        return { ifIndex, ifName };
      }
    }

    // Fallback para ifDescr
    for (const entry of ifDescrData) {
      const ifIndex = parseInt(entry.index.split(".").pop() || "0", 10);
      const ifDescr = entry.value;
      const normalizedDescr = ifDescr.toLowerCase().replace(/[.\-_\s]/g, "");

      if (normalizedDescr === normalizedSearch || 
          normalizedDescr.includes(normalizedSearch) || 
          normalizedSearch.includes(normalizedDescr)) {
        console.log(`[Corporate SNMP] Match encontrado via ifDescr: "${ifDescr}" -> ifIndex ${ifIndex}`);
        session.close();
        return { ifIndex, ifName: ifDescr };
      }
    }

    // Não fazer busca flexível por VLAN ID - pode atribuir interface errada
    // Se não encontrou match exato, retornar null e deixar o fallback tentar o backup concentrator
    console.log(`[Corporate SNMP] Interface "${vlanInterface}" não encontrada no concentrador (busca exata)`);
    session.close();
    return null;
  } catch (error: any) {
    console.error(`[Corporate SNMP] Erro ao buscar ifIndex: ${error.message}`);
    session.close();
    return null;
  }
}

/**
 * Busca o IP do cliente na tabela ARP do concentrador usando o ifIndex
 */
export async function lookupIpFromArpTable(
  concentrator: SnmpConcentrator,
  ifIndex: number,
  snmpProfile?: SnmpProfile | null
): Promise<{ ipAddress: string; macAddress: string } | null> {
  console.log(`[Corporate SNMP] Buscando IP na tabela ARP para ifIndex ${ifIndex} em ${concentrator.name}`);

  const profile: ConcentratorSnmpProfile =
    snmpProfile
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

  const session = createSnmpSession(concentrator.ipAddress, profile);

  try {
    // Walk the ARP table (ipNetToMedia)
    const arpIfIndexData = await snmpSubtreeWalk(session, CORPORATE_OIDS.ipNetToMediaIfIndex);
    const arpPhysAddrData = await snmpSubtreeWalk(session, CORPORATE_OIDS.ipNetToMediaPhysAddress);
    const arpNetAddrData = await snmpSubtreeWalk(session, CORPORATE_OIDS.ipNetToMediaNetAddress);

    console.log(`[Corporate SNMP] Tabela ARP: ${arpIfIndexData.length} entradas`);

    // O OID é: ipNetToMediaIfIndex.ifIndex.ipAddress
    // Ex: 1.3.6.1.2.1.4.22.1.1.100.10.0.0.1 -> ifIndex 100, IP 10.0.0.1

    // Criar mapa de OID suffix -> dados
    const arpEntries: Map<string, { ifIndex: number; ip: string; mac: string }> = new Map();

    for (const entry of arpIfIndexData) {
      // O index termina com: ifIndex.IP (4 octetos)
      const indexParts = entry.index.split(".");
      // Os últimos 4 octetos são o IP
      const ipParts = indexParts.slice(-4);
      const ip = ipParts.join(".");
      // O ifIndex está antes do IP
      const entryIfIndex = parseInt(entry.value, 10);
      const suffix = indexParts.slice(-5).join(".");
      
      arpEntries.set(suffix, { ifIndex: entryIfIndex, ip, mac: "" });
    }

    // Preencher MAC addresses
    for (const entry of arpPhysAddrData) {
      const indexParts = entry.index.split(".");
      const suffix = indexParts.slice(-5).join(".");
      const arpEntry = arpEntries.get(suffix);
      if (arpEntry) {
        // Converter MAC de buffer/string hex para formato legível
        let mac = entry.value;
        if (Buffer.isBuffer(mac)) {
          mac = Array.from(mac).map((b: number) => b.toString(16).padStart(2, '0')).join(':');
        }
        arpEntry.mac = mac;
      }
    }

    // Encontrar entrada para o ifIndex desejado
    const arpEntriesArray = Array.from(arpEntries.values());
    for (const data of arpEntriesArray) {
      if (data.ifIndex === ifIndex && data.ip && !data.ip.startsWith("0.")) {
        console.log(`[Corporate SNMP] IP encontrado na tabela ARP: ${data.ip} (MAC: ${data.mac || 'N/A'})`);
        session.close();
        return { ipAddress: data.ip, macAddress: data.mac || null } as { ipAddress: string; macAddress: string };
      }
    }

    console.log(`[Corporate SNMP] Nenhum IP encontrado na tabela ARP para ifIndex ${ifIndex}`);
    session.close();
    return null;
  } catch (error: any) {
    console.error(`[Corporate SNMP] Erro ao buscar tabela ARP: ${error.message}`);
    session.close();
    return null;
  }
}

/**
 * Busca bloco IP na tabela de rotas CIDR dado um ifIndex
 * OID: ipCidrRouteIfIndex (1.3.6.1.2.1.4.24.4.1.5)
 * Formato do index: destIP.maskIP.0.nextHopIP
 * Exemplo: 1.3.6.1.2.1.4.24.4.1.5.191.52.254.164.255.255.255.255.0.100.65.129.178 = 277
 */
export async function lookupIpBlockFromRouteTable(
  concentrator: SnmpConcentrator,
  targetIfIndex: number,
  snmpProfile?: SnmpProfile | null
): Promise<string | null> {
  const profile: ConcentratorSnmpProfile =
    snmpProfile
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

  const session = createSnmpSession(concentrator.ipAddress, profile);

  try {
    const ipCidrRouteIfIndex = "1.3.6.1.2.1.4.24.4.1.5";
    const routeData = await snmpSubtreeWalk(session, ipCidrRouteIfIndex);
    
    console.log(`[Corporate SNMP] Tabela de rotas CIDR: ${routeData.length} entradas`);

    // Procurar rotas que usam o ifIndex do link
    for (const entry of routeData) {
      const ifIndex = typeof entry.value === 'number' ? entry.value : parseInt(entry.value, 10);
      if (ifIndex !== targetIfIndex) continue;

      // Extrair IP e máscara do index
      // Formato: OID.destIP(4 octets).mask(4 octets).0.nextHop(4 octets)
      const indexParts = entry.index.replace(ipCidrRouteIfIndex + ".", "").split(".");
      if (indexParts.length >= 9) {
        const destIp = indexParts.slice(0, 4).join(".");
        const maskOctets = indexParts.slice(4, 8).map(Number);
        
        // Calcular CIDR a partir da máscara
        let cidr = 0;
        for (const octet of maskOctets) {
          let bits = octet;
          while (bits > 0) {
            cidr += bits & 1;
            bits >>= 1;
          }
        }
        
        const maskStr = maskOctets.join(".");
        const ipBlock = `${destIp}/${cidr}`;
        
        // Ignorar rotas default e muito grandes (provavelmente não são do cliente)
        if (destIp === "0.0.0.0" || cidr < 24) continue;
        
        // Verificar se é um IP público (ignorar privados e CGNAT)
        const firstOctet = parseInt(indexParts[0], 10);
        const secondOctet = parseInt(indexParts[1], 10);
        
        // Ignorar IPs privados e reservados:
        // 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 100.64.0.0/10 (CGNAT), 127.0.0.0/8
        const isPrivate = 
          firstOctet === 10 ||                                          // 10.0.0.0/8
          (firstOctet === 172 && secondOctet >= 16 && secondOctet <= 31) || // 172.16.0.0/12
          (firstOctet === 192 && secondOctet === 168) ||                // 192.168.0.0/16
          (firstOctet === 100 && secondOctet >= 64 && secondOctet <= 127) || // 100.64.0.0/10 (CGNAT)
          firstOctet === 127;                                           // 127.0.0.0/8 (loopback)
        
        if (isPrivate) {
          console.log(`[Corporate SNMP] Rota ignorada (IP privado/CGNAT): ${ipBlock}`);
          continue;
        }
        
        console.log(`[Corporate SNMP] Rota encontrada (IP público): ${destIp} mask ${maskStr} -> ifIndex ${ifIndex} (${ipBlock})`);
        
        session.close();
        return ipBlock;
      }
    }

    session.close();
    return null;
  } catch (error: any) {
    console.error(`[Corporate SNMP] Erro ao buscar bloco IP via CIDR: ${error.message}`);
    session.close();
    return null;
  }
}

/**
 * Busca informações de link corporativo: ifIndex pela interface VLAN e IP pela tabela ARP
 */
export async function lookupCorporateLinkInfo(
  concentrator: SnmpConcentrator,
  vlanInterface: string,
  snmpProfile?: SnmpProfile | null
): Promise<CorporateLinkInfo | null> {
  console.log(`[Corporate SNMP] Buscando info corporativa para VLAN "${vlanInterface}" em ${concentrator.name}`);

  // Primeiro, buscar o ifIndex pela interface VLAN
  const ifResult = await lookupVlanInterfaceIndex(concentrator, vlanInterface, snmpProfile);
  if (!ifResult) {
    console.log(`[Corporate SNMP] Interface VLAN "${vlanInterface}" não encontrada`);
    return null;
  }

  // Depois, buscar o IP na tabela ARP usando o ifIndex
  const arpResult = await lookupIpFromArpTable(concentrator, ifResult.ifIndex, snmpProfile);

  // Buscar bloco IP via tabela de rotas CIDR (para monitoramento de blacklist)
  console.log(`[Corporate SNMP] Buscando bloco IP via tabela de rotas CIDR...`);
  const ipBlock = await lookupIpBlockFromRouteTable(concentrator, ifResult.ifIndex, snmpProfile);
  if (ipBlock) {
    console.log(`[Corporate SNMP] Bloco IP encontrado via CIDR: ${ipBlock}`);
  }

  const result: CorporateLinkInfo = {
    vlanInterface: ifResult.ifName,
    ifIndex: ifResult.ifIndex,
    ipAddress: arpResult?.ipAddress || null,
    macAddress: arpResult?.macAddress || null,
    ipBlock: ipBlock, // Bloco IP para blacklist (separado do IP do cliente)
  };

  console.log(`[Corporate SNMP] Resultado: ifIndex=${result.ifIndex}, IP=${result.ipAddress || 'N/A'}, ipBlock=${result.ipBlock || 'N/A'}, MAC=${result.macAddress || 'N/A'}`);
  return result;
}

/**
 * Busca o MAC na tabela ARP dado um IP conhecido
 * Útil para links PPPoE onde já descobrimos o IP mas precisamos do MAC para identificar o vendor
 */
export async function lookupMacFromArpByIp(
  concentrator: SnmpConcentrator,
  targetIp: string,
  snmpProfile?: SnmpProfile | null
): Promise<string | null> {
  console.log(`[ARP Lookup] Buscando MAC para IP ${targetIp} em ${concentrator.name}`);

  const profile: ConcentratorSnmpProfile =
    snmpProfile
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

  const session = createSnmpSession(concentrator.ipAddress, profile);

  try {
    // Walk the ARP table
    const arpPhysAddrData = await snmpSubtreeWalk(session, CORPORATE_OIDS.ipNetToMediaPhysAddress);

    // OID format: ipNetToMediaPhysAddress.ifIndex.ipAddress
    for (const entry of arpPhysAddrData) {
      const indexParts = entry.index.split(".");
      // Last 4 octets are the IP
      const ipParts = indexParts.slice(-4);
      const entryIp = ipParts.join(".");

      if (entryIp === targetIp) {
        let mac = entry.value;
        if (Buffer.isBuffer(mac)) {
          mac = Array.from(mac).map((b: number) => b.toString(16).padStart(2, '0')).join(':');
        }
        console.log(`[ARP Lookup] MAC encontrado para ${targetIp}: ${mac}`);
        session.close();
        return mac;
      }
    }

    console.log(`[ARP Lookup] MAC não encontrado para IP ${targetIp}`);
    session.close();
    return null;
  } catch (error: any) {
    console.error(`[ARP Lookup] Erro ao buscar MAC: ${error.message}`);
    session.close();
    return null;
  }
}

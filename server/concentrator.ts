import { Client as SSHClient } from "ssh2";
import type { InsertSnmpConcentrator, SnmpConcentrator } from "@shared/schema";

export interface PppoeSessionInfo {
  username: string;
  ipAddress: string | null;
  macAddress: string | null;
  uptime: string | null;
  interface: string | null;
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
    let errorOutput = "";
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

        stream.stderr.on("data", (data: Buffer) => {
          errorOutput += data.toString();
        });
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
  const lines = output.split("\n");
  let currentSession: Partial<PppoeSessionInfo> = {};
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    if (trimmed.includes("name=")) {
      const nameMatch = trimmed.match(/name="?([^"\s]+)"?/);
      if (nameMatch) {
        currentSession.username = nameMatch[1];
      }
    }
    
    if (trimmed.includes("address=")) {
      const addressMatch = trimmed.match(/address=([^\s]+)/);
      if (addressMatch) {
        currentSession.ipAddress = addressMatch[1];
      }
    }
    
    if (trimmed.includes("caller-id=")) {
      const macMatch = trimmed.match(/caller-id="?([^"\s]+)"?/);
      if (macMatch) {
        currentSession.macAddress = macMatch[1];
      }
    }
    
    if (trimmed.includes("uptime=")) {
      const uptimeMatch = trimmed.match(/uptime=([^\s]+)/);
      if (uptimeMatch) {
        currentSession.uptime = uptimeMatch[1];
      }
    }
    
    if (trimmed.includes("interface=")) {
      const ifMatch = trimmed.match(/interface="?([^"\s]+)"?/);
      if (ifMatch) {
        currentSession.interface = ifMatch[1];
      }
    }
  }
  
  if (currentSession.username && currentSession.username.toLowerCase() === pppoeUser.toLowerCase()) {
    return {
      username: currentSession.username,
      ipAddress: currentSession.ipAddress || null,
      macAddress: currentSession.macAddress || null,
      uptime: currentSession.uptime || null,
      interface: currentSession.interface || null,
    };
  }
  
  const simpleMatch = output.match(new RegExp(`${pppoeUser.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?address=([\\d.]+)`, 'i'));
  if (simpleMatch) {
    return {
      username: pppoeUser,
      ipAddress: simpleMatch[1],
      macAddress: null,
      uptime: null,
      interface: null,
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
          };
        }
      }
    }
  }
  
  return null;
}

export async function lookupPppoeSession(
  concentrator: SnmpConcentrator,
  pppoeUser: string,
  password?: string
): Promise<PppoeSessionInfo | null> {
  if (!concentrator.sshUser || !concentrator.ipAddress) {
    console.log(`[PPPoE Lookup] Concentrador ${concentrator.name} sem credenciais SSH configuradas`);
    return null;
  }
  
  const sshPassword = password || concentrator.sshPassword || "";
  if (!sshPassword) {
    console.log(`[PPPoE Lookup] Concentrador ${concentrator.name} sem senha SSH configurada`);
    return null;
  }
  
  const vendor = (concentrator.vendor || "mikrotik").toLowerCase();
  
  let command: string;
  switch (vendor) {
    case "cisco":
      command = `show subscriber session username ${pppoeUser}`;
      break;
    case "huawei":
      command = `display access-user username ${pppoeUser}`;
      break;
    case "juniper":
      command = `show subscribers user-name ${pppoeUser}`;
      break;
    case "mikrotik":
    default:
      command = `/ppp active print where name="${pppoeUser}"`;
      break;
  }
  
  console.log(`[PPPoE Lookup] Consultando sessão ${pppoeUser} em ${concentrator.name} (${vendor})`);
  
  try {
    const output = await executeSSHCommand(
      {
        host: concentrator.ipAddress,
        port: concentrator.sshPort || 22,
        username: concentrator.sshUser,
        password: sshPassword,
      },
      command
    );
    
    console.log(`[PPPoE Lookup] Output recebido (${output.length} chars)`);
    
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
      console.log(`[PPPoE Lookup] IP encontrado: ${session.ipAddress} para ${pppoeUser}`);
    } else {
      console.log(`[PPPoE Lookup] Sessão não encontrada ou sem IP para ${pppoeUser}`);
    }
    
    return session;
  } catch (error) {
    console.error(`[PPPoE Lookup] Erro ao consultar ${concentrator.name}:`, error instanceof Error ? error.message : error);
    return null;
  }
}

export async function lookupMultiplePppoeSessions(
  concentrator: SnmpConcentrator,
  pppoeUsers: string[],
  password?: string
): Promise<Map<string, PppoeSessionInfo>> {
  const results = new Map<string, PppoeSessionInfo>();
  
  if (!concentrator.sshUser || !concentrator.ipAddress) {
    console.log(`[PPPoE Bulk Lookup] Concentrador ${concentrator.name} sem credenciais SSH`);
    return results;
  }
  
  const sshPassword = password || concentrator.sshPassword || "";
  if (!sshPassword) {
    console.log(`[PPPoE Bulk Lookup] Concentrador ${concentrator.name} sem senha SSH`);
    return results;
  }
  
  const vendor = (concentrator.vendor || "mikrotik").toLowerCase();
  
  console.log(`[PPPoE Bulk Lookup] Buscando ${pppoeUsers.length} sessões em ${concentrator.name}`);
  
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
    
    console.log(`[PPPoE Bulk Lookup] Output recebido (${output.length} chars)`);
    
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
    
    console.log(`[PPPoE Bulk Lookup] Encontradas ${results.size} sessões ativas de ${pppoeUsers.length} buscadas`);
    
    return results;
  } catch (error) {
    console.error(`[PPPoE Bulk Lookup] Erro:`, error instanceof Error ? error.message : error);
    return results;
  }
}

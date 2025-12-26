import { Client as SSHClient } from "ssh2";
import { Socket } from "net";
import type { Olt } from "@shared/schema";

export interface OltAlarm {
  timestamp: string;
  severity: string;
  source: string;
  status: string;
  name: string;
  description: string;
}

export interface OltDiagnosis {
  alarmType: string | null;
  alarmCode: string | null;
  description: string;
  diagnosis: string;
  rawOutput: string;
}

const ALARM_MAPPINGS: Record<string, { diagnosis: string; description: string }> = {
  "GPON_LOSi": { 
    diagnosis: "Rompimento de Fibra", 
    description: "ONU Loss of signal - Perda de sinal óptico detectada" 
  },
  "GPON_DGi": { 
    diagnosis: "Queda de Energia", 
    description: "ONU Dying Gasp - Equipamento sem energia" 
  },
  "GPON_DOWi": { 
    diagnosis: "Atenuação de Fibra", 
    description: "ONU Downstream wavelength drift - Problema de atenuação" 
  },
  "GPON_SUFi": { 
    diagnosis: "Atenuação de Fibra", 
    description: "ONU Start-up failure - Falha de inicialização por atenuação" 
  },
  "GPON_LOAMi": { 
    diagnosis: "Atenuação de Fibra", 
    description: "ONU Loss of PLOAM - Perda de mensagens de controle" 
  },
  "GPON_LCDGi": {
    diagnosis: "Atenuação de Fibra",
    description: "ONU Loss of GEM channel delineation - Desalinhamento de canal"
  },
  "GPON_RDi": {
    diagnosis: "Problema de Comunicação",
    description: "ONU Remote defect indication - Defeito remoto indicado"
  },
};

async function connectTelnet(olt: Olt, command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    let output = "";
    let loginPhase = 0;
    let promptCount = 0;
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error("Telnet connection timeout"));
    }, 30000);

    socket.connect(olt.port, olt.ipAddress, () => {
      console.log(`Telnet connected to ${olt.ipAddress}:${olt.port}`);
    });

    socket.on("data", (data) => {
      const str = data.toString();
      output += str;

      if (loginPhase === 0 && (str.includes("Username:") || str.includes("login:"))) {
        socket.write(olt.username + "\r\n");
        loginPhase = 1;
      } else if (loginPhase === 1 && str.includes("Password:")) {
        socket.write(olt.password + "\r\n");
        loginPhase = 2;
      } else if (loginPhase === 2 && (str.includes("#") || str.includes(">"))) {
        socket.write(command + "\r\n");
        loginPhase = 3;
        promptCount = 0;
      } else if (loginPhase === 3 && (str.includes("#") || str.includes(">"))) {
        promptCount++;
        // Esperar pelo segundo prompt após enviar o comando
        // Primeiro prompt é o eco do comando, segundo é após a resposta
        if (promptCount >= 2 || output.includes(command)) {
          clearTimeout(timeout);
          socket.write("exit\r\n");
          socket.end();
          resolve(output);
        }
      }
    });

    socket.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    socket.on("close", () => {
      clearTimeout(timeout);
      if (loginPhase < 3) {
        reject(new Error("Connection closed before command completion"));
      }
    });
  });
}

async function connectSSH(olt: Olt, command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const conn = new SSHClient();
    let promptCount = 0;
    const timeout = setTimeout(() => {
      conn.end();
      reject(new Error("SSH connection timeout"));
    }, 30000);

    conn.on("ready", () => {
      conn.shell((err, stream) => {
        if (err) {
          clearTimeout(timeout);
          conn.end();
          return reject(err);
        }

        let output = "";
        let commandSent = false;

        stream.on("data", (data: Buffer) => {
          const str = data.toString();
          output += str;

          if (!commandSent && (str.includes("#") || str.includes(">"))) {
            stream.write(command + "\n");
            commandSent = true;
            promptCount = 0;
          } else if (commandSent && (str.includes("#") || str.includes(">"))) {
            promptCount++;
            // Esperar pelo segundo prompt ou verificar se o comando está no output
            if (promptCount >= 2 || output.includes(command)) {
              clearTimeout(timeout);
              stream.write("exit\n");
              stream.end();
            }
          }
        });

        stream.on("close", () => {
          conn.end();
          resolve(output);
        });
      });
    });

    conn.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    conn.connect({
      host: olt.ipAddress,
      port: olt.port,
      username: olt.username,
      password: olt.password,
      algorithms: {
        kex: [
          "diffie-hellman-group-exchange-sha256",
          "diffie-hellman-group14-sha256",
          "diffie-hellman-group14-sha1",
          "diffie-hellman-group1-sha1",
        ],
        cipher: [
          "aes128-ctr",
          "aes192-ctr",
          "aes256-ctr",
          "aes128-gcm@openssh.com",
          "aes256-gcm@openssh.com",
          "aes128-cbc",
          "3des-cbc",
        ],
      },
      readyTimeout: 20000,
    });
  });
}

// Extrai apenas os números de slot/port/pon/onu de um ID para comparação normalizada
// Exemplos de entrada: "gpon-olt_1/1/1:14", "gpon-1/1/1/14", "1/1/1/14", "gpon-olt_1/1/3:116"
// Retorna: "1/1/1/14", "1/1/1/14", "1/1/1/14", "1/1/3/116"
function normalizeOnuId(onuId: string): string {
  // Remove prefixos como "gpon-olt_", "gpon-", etc
  let normalized = onuId.replace(/^(gpon-olt_|gpon-|olt_)/i, "");
  // Converte ":" para "/" para unificar formato (1/1/3:116 -> 1/1/3/116)
  normalized = normalized.replace(":", "/");
  return normalized;
}

function parseAlarmOutput(output: string, onuId: string): OltAlarm[] {
  const alarms: OltAlarm[] = [];
  const lines = output.split("\n");
  const normalizedOnuId = normalizeOnuId(onuId);
  
  console.log(`[OLT Parser] Buscando alarmes para ONU: ${onuId} (normalizado: ${normalizedOnuId})`);
  console.log(`[OLT Parser] Output bruto (${lines.length} linhas):`);
  lines.forEach((line, i) => {
    if (line.trim()) console.log(`[OLT Parser] Linha ${i}: ${line}`);
  });
  
  for (const line of lines) {
    // Regex para capturar linhas de alarme no formato Datacom/Nokia
    // Formato: "2025-12-15 05:43:59 UTC-3    CRITICAL gpon-1/1/1/14                   Active   GPON_LOSi ..."
    const match = line.match(/(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}[^\s]*)\s+(\w+)\s+([\w\-\/]+)\s+(\w+)\s+(\w+)\s+(.*)/);
    if (match) {
      const source = match[3].trim();
      const normalizedSource = normalizeOnuId(source);
      
      // Verifica se a ONU normalizada corresponde
      if (normalizedSource === normalizedOnuId) {
        console.log(`[OLT Parser] Alarme encontrado: ${match[5]} em ${source}`);
        alarms.push({
          timestamp: match[1].trim(),
          severity: match[2].trim(),
          source: source,
          status: match[4].trim(),
          name: match[5].trim(),
          description: match[6].trim(),
        });
      }
    }
  }
  
  console.log(`[OLT Parser] Total de alarmes encontrados: ${alarms.length}`);
  return alarms;
}

// Cache de alarmes por OLT para evitar múltiplas consultas no mesmo ciclo
const oltAlarmsCache = new Map<number, { timestamp: number; alarms: OltAlarm[] }>();
const OLT_ALARMS_CACHE_TTL_MS = 60000; // 1 minuto

// Busca todos os alarmes de uma OLT (para usar quando múltiplos links da mesma OLT estão offline)
export async function queryAllOltAlarms(olt: Olt): Promise<OltAlarm[]> {
  // Verificar cache
  const cached = oltAlarmsCache.get(olt.id);
  if (cached && (Date.now() - cached.timestamp) < OLT_ALARMS_CACHE_TTL_MS) {
    console.log(`[OLT] Usando cache de alarmes para ${olt.name} (${cached.alarms.length} alarmes)`);
    return cached.alarms;
  }

  const command = "sh alarm";
  let rawOutput = "";
  
  try {
    console.log(`[OLT] Consultando TODOS os alarmes de ${olt.name}...`);
    if (olt.connectionType === "ssh") {
      rawOutput = await connectSSH(olt, command);
    } else {
      rawOutput = await connectTelnet(olt, command);
    }
    
    const alarms = parseAllAlarms(rawOutput);
    console.log(`[OLT] ${alarms.length} alarmes encontrados em ${olt.name}`);
    
    // Armazenar em cache
    oltAlarmsCache.set(olt.id, { timestamp: Date.now(), alarms });
    
    return alarms;
  } catch (error) {
    console.error(`[OLT] Erro ao consultar alarmes de ${olt.name}:`, error);
    return [];
  }
}

// Parseia todos os alarmes do output (sem filtrar por ONU específica)
function parseAllAlarms(output: string): OltAlarm[] {
  const alarms: OltAlarm[] = [];
  const lines = output.split("\n");
  
  for (const line of lines) {
    const match = line.match(/(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}[^\s]*)\s+(\w+)\s+([\w\-\/]+)\s+(\w+)\s+(\w+)\s+(.*)/);
    if (match) {
      alarms.push({
        timestamp: match[1].trim(),
        severity: match[2].trim(),
        source: match[3].trim(),
        status: match[4].trim(),
        name: match[5].trim(),
        description: match[6].trim(),
      });
    }
  }
  
  return alarms;
}

// Busca diagnóstico para uma ONU específica a partir de uma lista de alarmes pré-carregados
export function getDiagnosisFromAlarms(alarms: OltAlarm[], onuId: string): OltDiagnosis {
  const normalizedOnuId = normalizeOnuId(onuId);
  
  // Filtrar alarmes para esta ONU
  const onuAlarms = alarms.filter(alarm => {
    const normalizedSource = normalizeOnuId(alarm.source);
    return normalizedSource === normalizedOnuId;
  });
  
  if (onuAlarms.length === 0) {
    return {
      alarmType: null,
      alarmCode: null,
      description: "Nenhum alarme encontrado para esta ONU",
      diagnosis: "Sem alarmes ativos",
      rawOutput: "",
    };
  }
  
  const activeAlarm = onuAlarms.find(a => a.status === "Active") || onuAlarms[0];
  const mapping = ALARM_MAPPINGS[activeAlarm.name];
  
  return {
    alarmType: activeAlarm.name,
    alarmCode: activeAlarm.source,
    description: mapping?.description || activeAlarm.description,
    diagnosis: mapping?.diagnosis || "Alarme Desconhecido",
    rawOutput: "",
  };
}

export async function queryOltAlarm(olt: Olt, onuId: string): Promise<OltDiagnosis> {
  // Usa comando abreviado e filtra pelo ONU ID normalizado (apenas números slot/port/pon/onu)
  const normalizedId = normalizeOnuId(onuId);
  const command = `sh alarm | include ${normalizedId}`;
  let rawOutput = "";
  
  try {
    if (olt.connectionType === "ssh") {
      rawOutput = await connectSSH(olt, command);
    } else {
      rawOutput = await connectTelnet(olt, command);
    }
    
    const alarms = parseAlarmOutput(rawOutput, onuId);
    
    if (alarms.length === 0) {
      return {
        alarmType: null,
        alarmCode: null,
        description: "Nenhum alarme encontrado para esta ONU",
        diagnosis: "Sem alarmes ativos",
        rawOutput,
      };
    }
    
    const activeAlarm = alarms.find(a => a.status === "Active") || alarms[0];
    const mapping = ALARM_MAPPINGS[activeAlarm.name];
    
    return {
      alarmType: activeAlarm.name,
      alarmCode: activeAlarm.source,
      description: mapping?.description || activeAlarm.description,
      diagnosis: mapping?.diagnosis || "Alarme Desconhecido",
      rawOutput,
    };
  } catch (error) {
    console.error("Error querying OLT alarm:", error);
    return {
      alarmType: null,
      alarmCode: null,
      description: `Erro ao consultar OLT: ${error instanceof Error ? error.message : "Erro desconhecido"}`,
      diagnosis: "Erro de Consulta",
      rawOutput: "",
    };
  }
}

export async function testOltConnection(olt: Olt): Promise<{ success: boolean; message: string }> {
  try {
    const command = "sh alarm";
    if (olt.connectionType === "ssh") {
      await connectSSH(olt, command);
    } else {
      await connectTelnet(olt, command);
    }
    return { success: true, message: "Conexão bem-sucedida" };
  } catch (error) {
    return { 
      success: false, 
      message: error instanceof Error ? error.message : "Erro de conexão" 
    };
  }
}

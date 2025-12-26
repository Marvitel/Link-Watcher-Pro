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
      } else if (loginPhase === 3 && (str.includes("#") || str.includes(">"))) {
        clearTimeout(timeout);
        socket.write("exit\r\n");
        socket.end();
        resolve(output);
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
          } else if (commandSent && (str.includes("#") || str.includes(">"))) {
            clearTimeout(timeout);
            stream.write("exit\n");
            stream.end();
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

function parseAlarmOutput(output: string, onuId: string): OltAlarm[] {
  const alarms: OltAlarm[] = [];
  const lines = output.split("\n");
  
  for (const line of lines) {
    if (!line.includes(onuId)) continue;
    
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

export async function queryOltAlarm(olt: Olt, onuId: string): Promise<OltDiagnosis> {
  const command = `show alarm | include ${onuId}`;
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
    const command = "show alarm";
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

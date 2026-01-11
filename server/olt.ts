import { Client as SSHClient } from "ssh2";
import { Socket } from "net";
import mysql from "mysql2/promise";
import type { Olt } from "@shared/schema";

// Interface para resultado da consulta Zabbix
interface ZabbixOnuResult {
  OLT: string;
  ONUID: string;
  PON: string;
  SPLITTER: string | null;
  "PORTA SPLITTER": string | null;
  SN: string;
  DESCRIÇÃO: string | null;
  ONURX: number | null;
  ONUTX: number | null;
  OLTRX: number | null;
  DISTANCIA: string | null;
  MODELO: string | null;
  STATUS: string;
  "ULT.MOT.OFF": string | null;
  "ÚLTIMO DGi": string | null;
  UPTIME: string | null;
  "ULT.VEZ.OFFLINE": string | null;
  "ULT.VERIFICACAO": string;
}

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

// Interface para dados do link usados no diagnóstico
export interface LinkDiagnosisData {
  onuSearchString: string | null;
  onuId: string | null;
  slotOlt: number | null;
  portOlt: number | null;
}

// Substitui variáveis no template: {serial}, {slot}, {port}, {onuId}
function replaceTemplateVariables(template: string, link: LinkDiagnosisData): string {
  let result = template;
  
  // Extrai apenas o ID numérico da ONU (ex: "116" de "gpon-olt_1/1/3:116")
  let numericOnuId = "";
  if (link.onuId) {
    const match = link.onuId.match(/:(\d+)$/);
    if (match) {
      numericOnuId = match[1];
    } else if (/^\d+$/.test(link.onuId)) {
      numericOnuId = link.onuId;
    }
  }
  
  result = result.replace(/\{serial\}/g, link.onuSearchString || "");
  result = result.replace(/\{slot\}/g, link.slotOlt?.toString() || "");
  result = result.replace(/\{port\}/g, link.portOlt?.toString() || "");
  result = result.replace(/\{onuId\}/g, numericOnuId);
  
  return result;
}

// Monta a string correta para diagnóstico de ONU baseada no template da OLT
// Se template configurado: usa o template com substituição de variáveis
// Se não: fallback para lógica por vendor
export function buildOnuDiagnosisKey(olt: Olt, link: LinkDiagnosisData): string | null {
  // Se a OLT tem template de diagnóstico configurado, usa ele
  if ((olt as any).diagnosisKeyTemplate) {
    const key = replaceTemplateVariables((olt as any).diagnosisKeyTemplate, link);
    if (key && key.trim()) {
      return key;
    }
  }
  
  // Fallback: lógica por vendor
  const normalizedVendor = (olt.vendor || "").toLowerCase();
  
  // Datacom: formato "1/slot/port/id-onu"
  if (normalizedVendor === "datacom") {
    // Se tem onuId no formato "gpon-olt_1/1/3:116", extrair a parte numérica
    if (link.onuId) {
      // Formato: gpon-olt_1/1/3:116 → extrai 1/1/3:116
      const match = link.onuId.match(/(\d+\/\d+\/\d+:\d+)/);
      if (match) {
        // Converte 1/1/3:116 para 1/1/3/116
        return match[1].replace(":", "/");
      }
      // Se já está no formato 1/slot/port/id, retorna direto
      if (/^\d+\/\d+\/\d+\/\d+$/.test(link.onuId)) {
        return link.onuId;
      }
    }
    // Fallback: monta a partir de slot/port se disponível
    if (link.slotOlt != null && link.portOlt != null && link.onuId) {
      // Tenta extrair apenas o ID numérico da ONU do onuId
      const idMatch = link.onuId.match(/:(\d+)$/);
      if (idMatch) {
        return `1/${link.slotOlt}/${link.portOlt}/${idMatch[1]}`;
      }
    }
    console.log(`[OLT Diagnosis] Datacom: não foi possível montar chave de diagnóstico. onuId=${link.onuId}`);
    return null;
  }
  
  // Outros vendors (Furukawa, Huawei, ZTE, Nokia, etc): usam o serial
  if (link.onuSearchString) {
    return link.onuSearchString;
  }
  
  // Fallback para onuId se não tiver onuSearchString
  return link.onuId;
}

// Monta o comando de busca de ONU usando template da OLT ou fallback por vendor
// searchString é tipicamente o serial da ONU
export function buildOnuSearchCommand(olt: Olt, searchString: string, link?: LinkDiagnosisData): string | null {
  // Se a OLT tem comando de busca configurado, usa ele
  if ((olt as any).searchOnuCommand) {
    let command = (olt as any).searchOnuCommand as string;
    // Substitui todas as variáveis disponíveis
    command = command.replace(/\{serial\}/g, searchString);
    if (link) {
      // Extrai ID numérico da ONU se disponível
      let numericOnuId = "";
      if (link.onuId) {
        const match = link.onuId.match(/:(\d+)$/);
        if (match) {
          numericOnuId = match[1];
        } else if (/^\d+$/.test(link.onuId)) {
          numericOnuId = link.onuId;
        }
      }
      command = command.replace(/\{slot\}/g, link.slotOlt?.toString() || "");
      command = command.replace(/\{port\}/g, link.portOlt?.toString() || "");
      command = command.replace(/\{onuId\}/g, numericOnuId);
    }
    return command;
  }
  
  // Fallback: comandos por vendor
  const vendor = (olt.vendor || "").toLowerCase();
  
  switch (vendor) {
    case "datacom":
      return `show interface gpon onu | include "${searchString}"`;
    case "furukawa":
      return `sh onu serial ${searchString}`;
    case "huawei":
      return `display ont info by-sn ${searchString}`;
    case "zte":
      return `show gpon onu by sn ${searchString}`;
    case "nokia":
      return `show equipment ont interface | match ${searchString}`;
    default:
      console.log(`[OLT Search] Vendor ${vendor} não tem comando de busca configurado`);
      return null;
  }
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

// Consulta ao banco de dados MySQL Zabbix para buscar informações de ONU por serial
async function queryZabbixMySQL(olt: Olt, serial: string): Promise<OltDiagnosis> {
  console.log(`[OLT Zabbix] Consultando MySQL ${olt.ipAddress}:${olt.port} por serial ${serial}...`);
  
  try {
    console.log(`[OLT Zabbix] Conectando ao MySQL...`);
    const connection = await mysql.createConnection({
      host: olt.ipAddress,
      port: olt.port,
      user: olt.username,
      password: olt.password,
      database: olt.database || "db_django_olts",
      connectTimeout: 30000,
      // Não usar SSL - conexão em rede interna
    });
    console.log(`[OLT Zabbix] Conexão estabelecida com sucesso`);

    // Query simplificada para buscar ONU por serial
    const query = `
      SELECT 
        olt.nome AS OLT,
        fo.onuid AS ONUID,
        fo.pon AS PON,
        fo.splitter AS SPLITTER,
        fo.porta_splitter AS 'PORTA SPLITTER',
        fo.serial AS SN,
        fo.description AS 'DESCRIÇÃO',
        h.onurx AS ONURX,
        h.onutx AS ONUTX,
        h.oltrx AS OLTRX,
        fo.distance AS 'DISTANCIA',
        fo.model AS MODELO,
        fo.status AS STATUS,
        CASE 
          WHEN alarms_active.alarm_name = 'GPON_LOSi' THEN 'los'
          WHEN alarms_active.alarm_name = 'GPON_LOFi' THEN 'lof'
          WHEN alarms_active.alarm_name = 'GPON_DGi'  THEN 'dying-gasp'
          WHEN alarms_active.alarm_name = 'GPON_SFi'  THEN 'sf'
          WHEN alarms_active.alarm_name = 'GPON_SDi'  THEN 'sd'
          WHEN alarms_active.alarm_name = 'GPON_LOAMi'THEN 'loam'
          WHEN alarms_active.alarm_name = 'GPON_DFi'  THEN 'df'
          ELSE COALESCE(fo.reason, '-')
        END AS 'ULT.MOT.OFF',
        CASE 
          WHEN fo.last_dying_gasp IS NOT NULL THEN DATE_FORMAT(fo.last_dying_gasp, '%d/%m %H:%i')
          ELSE '-'
        END AS 'ÚLTIMO DGi',
        CASE 
          WHEN fo.status = 'online' AND fo.uptime IS NOT NULL THEN fo.uptime
          WHEN fo.status = 'online' THEN '0d 0h 0m'
          ELSE '-'
        END AS 'UPTIME',
        CASE 
          WHEN alarms_active.triggered_on IS NOT NULL THEN 
            CONCAT('há ', DATEDIFF(NOW(), alarms_active.triggered_on), ' dias')
          WHEN fo.status = 'offline' AND fo.last_downtime IS NOT NULL THEN 
            CONCAT('há ', DATEDIFF(NOW(), STR_TO_DATE(fo.last_downtime, '%d-%m-%Y %H:%i:%s')), ' dias')
          WHEN fo.status = 'offline' THEN 'Offline (sem dados)'
          ELSE '-'
        END AS 'ULT.VEZ.OFFLINE',
        DATE_FORMAT(CONVERT_TZ(fo.timestamp, '+00:00', '-03:00'), '%d-%m-%Y %H:%i:%s') AS 'ULT.VERIFICACAO'
      FROM ftth_onu AS fo
      LEFT JOIN (
        SELECT foh.onu_fk_id, onurx, onutx, oltrx
        FROM ftth_onuhistory AS foh
        INNER JOIN (
          SELECT onu_fk_id, MAX(timestamp) AS max_timestamp
          FROM ftth_onuhistory
          GROUP BY onu_fk_id
        ) AS foh_max ON foh.onu_fk_id = foh_max.onu_fk_id AND foh.timestamp = foh_max.max_timestamp
      ) AS h ON fo.id = h.onu_fk_id 
      LEFT JOIN (
        SELECT 
          onu_fk_id,
          alarm_name,
          triggered_on,
          status AS alarm_status
        FROM (
          SELECT 
            onu_fk_id,
            alarm_name,
            triggered_on,
            status,
            ROW_NUMBER() OVER (PARTITION BY onu_fk_id ORDER BY 
              CASE alarm_name 
                WHEN 'GPON_LOSi'  THEN 1
                WHEN 'GPON_LOFi'  THEN 2
                WHEN 'GPON_DGi'   THEN 3
                WHEN 'GPON_SFi'   THEN 4
                WHEN 'GPON_SDi'   THEN 5
                WHEN 'GPON_LOAMi' THEN 6
                WHEN 'GPON_DFi'   THEN 7
                ELSE 99
              END, triggered_on DESC) as rn
          FROM ftth_onu_alarm 
          WHERE status = 'Active' 
          AND alarm_name IN ('GPON_DGi', 'GPON_LOSi', 'GPON_SFi', 'GPON_SDi', 'GPON_LOAMi', 'GPON_DFi', 'GPON_LOFi')
        ) ranked_alarms
        WHERE rn = 1
      ) AS alarms_active ON fo.id = alarms_active.onu_fk_id
      INNER JOIN ftth_olt olt ON (fo.olt_fk_id = olt.id) 
      WHERE fo.serial = ?
      LIMIT 1
    `;

    const [rows] = await connection.execute(query, [serial]);
    await connection.end();

    const results = rows as ZabbixOnuResult[];
    
    if (results.length === 0) {
      console.log(`[OLT Zabbix] ONU ${serial} não encontrada no banco`);
      return {
        alarmType: null,
        alarmCode: null,
        description: "ONU não encontrada no banco de dados Zabbix",
        diagnosis: "ONU não cadastrada",
        rawOutput: JSON.stringify({ serial, message: "not found" }),
      };
    }

    const onu = results[0];
    console.log(`[OLT Zabbix] ONU encontrada: ${onu.OLT} - ${onu.PON} - Status: ${onu.STATUS} - Motivo: ${onu["ULT.MOT.OFF"]}`);

    // Mapear o motivo de desconexão para diagnóstico
    const motivo = onu["ULT.MOT.OFF"];
    let alarmType: string | null = null;
    let diagnosis = "Status desconhecido";
    let description = `ONU ${serial} - ${onu["DESCRIÇÃO"] || "Sem descrição"}`;

    if (motivo) {
      switch (motivo.toLowerCase()) {
        case "los":
          alarmType = "GPON_LOSi";
          diagnosis = "Rompimento de Fibra";
          description = "ONU Loss of signal - Perda de sinal óptico detectada";
          break;
        case "lof":
          alarmType = "GPON_LOFi";
          diagnosis = "Perda de Frame";
          description = "ONU Loss of frame - Perda de sincronização";
          break;
        case "dying-gasp":
          alarmType = "GPON_DGi";
          diagnosis = "Queda de Energia";
          description = "ONU Dying Gasp - Equipamento sem energia";
          break;
        case "sf":
          alarmType = "GPON_SFi";
          diagnosis = "Atenuação de Fibra";
          description = "ONU Signal Fail - Falha de sinal";
          break;
        case "sd":
          alarmType = "GPON_SDi";
          diagnosis = "Degradação de Sinal";
          description = "ONU Signal Degrade - Sinal degradado";
          break;
        case "loam":
          alarmType = "GPON_LOAMi";
          diagnosis = "Atenuação de Fibra";
          description = "ONU Loss of PLOAM - Perda de mensagens de controle";
          break;
        case "df":
          alarmType = "GPON_DFi";
          diagnosis = "Falha de Equipamento";
          description = "ONU Disable Fail - Falha de desativação";
          break;
        default:
          if (motivo !== "-") {
            diagnosis = motivo;
            description = `Motivo: ${motivo}`;
          }
      }
    }

    // Montar informação detalhada
    const detalhes = [
      `OLT: ${onu.OLT}`,
      `PON: ${onu.PON}`,
      `Status: ${onu.STATUS}`,
      `Modelo: ${onu.MODELO || "-"}`,
      `ONURX: ${onu.ONURX || "-"} dBm`,
      `ONUTX: ${onu.ONUTX || "-"} dBm`,
      `OLTRX: ${onu.OLTRX || "-"} dBm`,
      `Distância: ${onu.DISTANCIA || "-"}`,
      `Uptime: ${onu.UPTIME || "-"}`,
      `Último DGi: ${onu["ÚLTIMO DGi"] || "-"}`,
      `Offline: ${onu["ULT.VEZ.OFFLINE"] || "-"}`,
      `Última verificação: ${onu["ULT.VERIFICACAO"]}`,
    ];

    return {
      alarmType,
      alarmCode: alarmType,
      description: `${description}\n\n${detalhes.join("\n")}`,
      diagnosis,
      rawOutput: JSON.stringify(onu, null, 2),
    };

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[OLT Zabbix] Erro ao consultar MySQL: ${errorMsg}`);
    return {
      alarmType: null,
      alarmCode: null,
      description: `Erro ao consultar banco de dados: ${errorMsg}`,
      diagnosis: "Erro de conexão",
      rawOutput: errorMsg,
    };
  }
}

async function connectTelnet(olt: Olt, command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    let output = "";
    let loginPhase = 0;
    let promptCount = 0;
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error("Telnet connection timeout"));
    }, 60000);

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

interface SSHOptions {
  requiresEnable?: boolean;
}

async function connectSSH(olt: Olt, command: string, options: SSHOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const conn = new SSHClient();
    let promptCount = 0;
    let enableSent = false;
    let enableCompleted = !options.requiresEnable; // Se não precisa de enable, já está "completo"
    const timeout = setTimeout(() => {
      conn.end();
      reject(new Error("SSH connection timeout"));
    }, 60000);

    conn.on("banner", (message) => {
      console.log(`[OLT SSH] Banner de ${olt.ipAddress}: ${message.substring(0, 100)}`);
    });
    
    conn.on("handshake", (negotiated) => {
      console.log(`[OLT SSH] Handshake OK com ${olt.ipAddress}: kex=${negotiated.kex}, cipher=${negotiated.cs.cipher}`);
    });
    
    conn.on("ready", () => {
      console.log(`[OLT SSH] Ready - conexão estabelecida com ${olt.ipAddress}`);
      conn.shell((err, stream) => {
        if (err) {
          clearTimeout(timeout);
          conn.end();
          return reject(err);
        }

        let output = "";
        let commandSent = false;
        let inactivityTimer: NodeJS.Timeout | null = null;
        let promptFallbackTimer: NodeJS.Timeout | null = null;
        
        const sendEnable = () => {
          if (options.requiresEnable && !enableSent) {
            console.log(`[OLT SSH] Enviando 'enable' para ${olt.ipAddress}`);
            // Enviar Enter primeiro para acordar o terminal, depois enable
            stream.write("\r\n");
            setTimeout(() => {
              stream.write("enable\r\n");
            }, 300);
            enableSent = true;
          }
        };
        
        const sendCommand = () => {
          if (!commandSent) {
            console.log(`[OLT SSH] Enviando comando para ${olt.ipAddress}: ${command}`);
            stream.write(command + "\r\n");
            commandSent = true;
            resetInactivityTimer();
          }
        };
        
        // Para OLTs com enable, enviar Enter inicial IMEDIATAMENTE para obter o prompt
        // Furukawa fecha o canal rapidamente se não receber atividade
        if (options.requiresEnable) {
          console.log(`[OLT SSH] Enviando Enter inicial para obter prompt de ${olt.ipAddress}`);
          stream.write("\r\n");
        }
        
        const finishCommand = () => {
          if (inactivityTimer) clearTimeout(inactivityTimer);
          if (promptFallbackTimer) clearTimeout(promptFallbackTimer);
          console.log(`[OLT SSH] Comando completo em ${olt.ipAddress}, saindo...`);
          clearTimeout(timeout);
          stream.write("exit\n");
          stream.end();
        };
        
        const resetInactivityTimer = () => {
          if (inactivityTimer) clearTimeout(inactivityTimer);
          if (commandSent) {
            // Se o comando foi enviado, esperar 5s de inatividade para finalizar
            inactivityTimer = setTimeout(() => {
              console.log(`[OLT SSH] Timeout de inatividade em ${olt.ipAddress}, finalizando...`);
              finishCommand();
            }, 5000);
          }
        };
        
        // Fallback: se o prompt não for detectado em 3s, enviar enable ou comando
        promptFallbackTimer = setTimeout(() => {
          if (options.requiresEnable && !enableSent) {
            console.log(`[OLT SSH] Fallback: prompt não detectado em 3s, enviando 'enable'`);
            sendEnable();
            // Agendar envio do comando após 2s
            setTimeout(() => {
              if (!commandSent) {
                console.log(`[OLT SSH] Fallback: enviando comando após enable`);
                sendCommand();
              }
            }, 2000);
          } else if (!commandSent) {
            console.log(`[OLT SSH] Fallback: prompt não detectado em 3s, enviando comando`);
            sendCommand();
          }
        }, 3000);

        stream.on("data", (data: Buffer) => {
          const str = data.toString();
          output += str;
          
          // Log para debug (sem quebras de linha para melhor visualização)
          const cleanStr = str.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
          if (cleanStr.length > 0) {
            console.log(`[OLT SSH] Data de ${olt.ipAddress}: ${cleanStr.substring(0, 200)}`);
          }
          
          // Reset do timer de inatividade a cada dado recebido
          resetInactivityTimer();

          const lastLine = output.trim().split('\n').pop() || '';
          
          // Para OLTs que precisam de enable (AsGOS/Cisco-like):
          // Primeiro detectar prompt ">", enviar enable
          // Depois detectar prompt "#", enviar comando
          if (options.requiresEnable) {
            // Verificar se está no prompt de usuário ">" e precisa enviar enable
            if (!enableSent && lastLine.match(/[a-zA-Z0-9\.\-_]+>\s*$/)) {
              console.log(`[OLT SSH] Prompt usuário detectado: "${lastLine.substring(Math.max(0, lastLine.length - 50))}"`);
              if (promptFallbackTimer) clearTimeout(promptFallbackTimer);
              sendEnable();
              return;
            }
            
            // Verificar se está no prompt privilegiado "#" e precisa enviar comando
            if (enableSent && !commandSent && lastLine.match(/[a-zA-Z0-9\.\-_]+#\s*$/)) {
              console.log(`[OLT SSH] Prompt privilegiado detectado: "${lastLine.substring(Math.max(0, lastLine.length - 50))}"`);
              enableCompleted = true;
              sendCommand();
              return;
            }
            
            // Após enviar comando, esperar pelo próximo prompt # para finalizar
            if (commandSent && lastLine.match(/[a-zA-Z0-9\.\-_]+#\s*$/)) {
              promptCount++;
              console.log(`[OLT SSH] Prompt count: ${promptCount} em ${olt.ipAddress}`);
              if (promptCount >= 2) {
                finishCommand();
              }
            }
          } else {
            // Fluxo normal para OLTs sem enable
            const hasPrompt = str.includes("#") || str.includes(">") || str.includes("$") || 
                             /[a-zA-Z0-9\]]\s*[#>$]\s*$/.test(output.trim());
            
            if (!commandSent && hasPrompt) {
              if (lastLine.includes('#') || lastLine.includes('>') || /[a-zA-Z0-9\]]\s*[#>$]\s*$/.test(lastLine)) {
                console.log(`[OLT SSH] Prompt detectado em ${olt.ipAddress}: "${lastLine.substring(Math.max(0, lastLine.length - 50))}"`);
                if (promptFallbackTimer) clearTimeout(promptFallbackTimer);
                sendCommand();
              }
            } else if (commandSent && hasPrompt) {
              if (lastLine.includes('#') || lastLine.includes('>') || /[a-zA-Z0-9\]]\s*[#>$]\s*$/.test(lastLine)) {
                promptCount++;
                console.log(`[OLT SSH] Prompt count: ${promptCount} em ${olt.ipAddress}`);
                if (promptCount >= 2) {
                  finishCommand();
                }
              }
            }
          }
        });

        stream.on("close", () => {
          conn.end();
          if (commandSent) {
            resolve(output);
          } else {
            // Se o stream fechou antes do comando ser enviado, é um erro
            console.log(`[OLT SSH] Stream fechou antes do comando ser enviado em ${olt.ipAddress}`);
            reject(new Error("Conexão SSH fechou antes do comando ser executado"));
          }
        });
      });
    });

    conn.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    console.log(`[OLT SSH] Conectando a ${olt.ipAddress}:${olt.port}...`);
    
    conn.on("keyboard-interactive", (name, instructions, instructionsLang, prompts, finish) => {
      console.log(`[OLT SSH] Keyboard-interactive auth para ${olt.ipAddress}`);
      finish([olt.password]);
    });
    
    conn.connect({
      host: olt.ipAddress,
      port: olt.port,
      username: olt.username,
      password: olt.password,
      tryKeyboard: true,
      algorithms: {
        kex: [
          "curve25519-sha256",
          "curve25519-sha256@libssh.org",
          "ecdh-sha2-nistp256",
          "ecdh-sha2-nistp384",
          "ecdh-sha2-nistp521",
          "diffie-hellman-group-exchange-sha256",
          "diffie-hellman-group16-sha512",
          "diffie-hellman-group18-sha512",
          "diffie-hellman-group14-sha256",
          "diffie-hellman-group14-sha1",
          "diffie-hellman-group1-sha1",
          "diffie-hellman-group-exchange-sha1",
        ],
        cipher: [
          "chacha20-poly1305@openssh.com",
          "aes128-gcm@openssh.com",
          "aes256-gcm@openssh.com",
          "aes128-ctr",
          "aes192-ctr",
          "aes256-ctr",
          "aes128-cbc",
          "aes192-cbc",
          "aes256-cbc",
          "3des-cbc",
        ],
        serverHostKey: [
          "ssh-ed25519",
          "ecdsa-sha2-nistp256",
          "ecdsa-sha2-nistp384",
          "ecdsa-sha2-nistp521",
          "rsa-sha2-512",
          "rsa-sha2-256",
          "ssh-rsa",
          "ssh-dss",
        ],
        hmac: [
          "hmac-sha2-256-etm@openssh.com",
          "hmac-sha2-512-etm@openssh.com",
          "hmac-sha2-256",
          "hmac-sha2-512",
          "hmac-sha1",
          "hmac-md5",
        ],
      },
      readyTimeout: 40000,
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
  const normalizedOnuId = normalizeOnuId(onuId);
  
  console.log(`[OLT Parser] Buscando alarmes para ONU: ${onuId} (normalizado: ${normalizedOnuId})`);
  
  // Usa o mesmo parser validado em produção para eventos de desconexão
  const allAlarms = parseDatacomAlarms(output);
  
  console.log(`[OLT Parser] Total de alarmes parseados: ${allAlarms.length}`);
  
  // Filtra apenas alarmes da ONU especificada
  const filteredAlarms = allAlarms.filter(alarm => {
    const normalizedSource = normalizeOnuId(alarm.source);
    const matches = normalizedSource === normalizedOnuId;
    if (matches) {
      console.log(`[OLT Parser] Alarme encontrado: ${alarm.name} em ${alarm.source}`);
    }
    return matches;
  });
  
  console.log(`[OLT Parser] Alarmes filtrados para ONU ${onuId}: ${filteredAlarms.length}`);
  return filteredAlarms;
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

  // Para conexões MySQL (Zabbix), não temos como listar todos os alarmes sem um serial específico
  // Retornamos array vazio - a consulta será feita por ONU específica via queryOltAlarm
  if (olt.connectionType === "mysql") {
    console.log(`[OLT] OLT ${olt.name} é MySQL/Zabbix - consulta de alarmes será feita por ONU específica`);
    return [];
  }

  // Usar comando específico do fabricante
  const vendorConfig = getVendorConfig(olt.vendor);
  const command = vendorConfig.listAlarmsCommand;
  let rawOutput = "";
  
  try {
    console.log(`[OLT] Consultando TODOS os alarmes de ${olt.name} (vendor: ${olt.vendor || 'default'}, comando: ${command})...`);
    const sshOptions: SSHOptions = { requiresEnable: vendorConfig.requiresEnable };
    if (olt.connectionType === "ssh") {
      rawOutput = await connectSSH(olt, command, sshOptions);
    } else {
      rawOutput = await connectTelnet(olt, command);
    }
    
    // Usar parser específico do fabricante
    const alarms = parseAllAlarms(rawOutput, olt.vendor);
    console.log(`[OLT] ${alarms.length} alarmes encontrados em ${olt.name}`);
    
    // Armazenar em cache
    oltAlarmsCache.set(olt.id, { timestamp: Date.now(), alarms });
    
    return alarms;
  } catch (error) {
    console.error(`[OLT] Erro ao consultar alarmes de ${olt.name}:`, error);
    return [];
  }
}

// Remove caracteres de controle ANSI (cores do terminal) - versão mais abrangente
function stripAnsiCodes(str: string): string {
  return str
    // Remove todas as sequências CSI (Control Sequence Introducer)
    .replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')
    // Remove sequências OSC (Operating System Command)
    .replace(/\x1B\].*?(?:\x07|\x1B\\)/g, '')
    // Remove carriage returns
    .replace(/\r/g, '')
    // Remove outros caracteres de controle
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

// Configurações específicas por fabricante
interface VendorConfig {
  listAlarmsCommand: string;
  parseAlarms: (output: string) => OltAlarm[];
  // Mapeamento de alarmes específicos do fabricante para nomes padronizados
  alarmNameMapping?: Record<string, string>;
  // Comando para consulta de diagnóstico específico de uma ONU (usa {onuId} como placeholder)
  diagnosisCommand?: (onuId: string) => string;
  // Parser para resposta de diagnóstico específico
  parseDiagnosis?: (output: string, onuId: string) => OltDiagnosis | null;
  // Se true, envia "enable" antes do comando (para OLTs tipo Cisco/AsGOS)
  requiresEnable?: boolean;
}

// Comando e parser para Datacom (DmOS) - VALIDADO
const datacomConfig: VendorConfig = {
  listAlarmsCommand: "sh alarm",
  parseAlarms: parseDatacomAlarms,
};

// Comando e parser para Huawei (MA5800)
const huaweiConfig: VendorConfig = {
  listAlarmsCommand: "display alarm active all",
  parseAlarms: parseHuaweiAlarms,
  alarmNameMapping: {
    "ONU LOS": "GPON_LOSi",
    "ONU_LOS": "GPON_LOSi",
    "ONU Dying-Gasp": "GPON_DGi",
    "ONU_DyingGasp": "GPON_DGi",
    "ONU Low Rx Power": "GPON_DOWi",
    "ONU_LowRxPower": "GPON_DOWi",
  },
};

// Comando e parser para ZTE (C600/C650)
const zteConfig: VendorConfig = {
  listAlarmsCommand: "show alarm current",
  parseAlarms: parseZteAlarms,
  alarmNameMapping: {
    "LOSi": "GPON_LOSi",
    "LOS": "GPON_LOSi",
    "DGi": "GPON_DGi",
    "DOWi": "GPON_DOWi",
    "SUFi": "GPON_SUFi",
  },
};

// Comando e parser para Nokia (ISAM)
const nokiaConfig: VendorConfig = {
  listAlarmsCommand: "show alarm current-status",
  parseAlarms: parseNokiaAlarms,
};

// Comando e parser para Fiberhome (AN5516)
const fiberhomeConfig: VendorConfig = {
  listAlarmsCommand: "show alarm",
  parseAlarms: parseFiberhomeAlarms,
};

// Parser de diagnóstico específico para Furukawa
// Comando: show onu serial <serial_number>
// Resposta contém: deactivate reason..........: Onu Dying-Gasp (ou LOS, etc.)
function parseFurukawaDiagnosis(output: string, onuId: string): OltDiagnosis | null {
  const cleanOutput = stripAnsiCodes(output);
  
  // Procurar por "deactivate reason" na resposta
  const deactivateMatch = cleanOutput.match(/deactivate\s+reason[.:\s]+([^\n\r]+)/i);
  
  if (deactivateMatch) {
    const reason = deactivateMatch[1].trim();
    console.log(`[Furukawa] Deactivate reason encontrado: ${reason}`);
    
    // Mapear razões Furukawa para alarmes padronizados
    let alarmType = "UNKNOWN";
    if (reason.toLowerCase().includes("dying-gasp") || reason.toLowerCase().includes("dying gasp")) {
      alarmType = "GPON_DGi";
    } else if (reason.toLowerCase().includes("los") || reason.toLowerCase().includes("loss of signal")) {
      alarmType = "GPON_LOSi";
    } else if (reason.toLowerCase().includes("power") || reason.toLowerCase().includes("low rx")) {
      alarmType = "GPON_DOWi";
    } else if (reason.toLowerCase().includes("suf") || reason.toLowerCase().includes("startup")) {
      alarmType = "GPON_SUFi";
    }
    
    const mapping = ALARM_MAPPINGS[alarmType];
    
    return {
      alarmType,
      alarmCode: onuId,
      description: mapping?.description || `Furukawa: ${reason}`,
      diagnosis: mapping?.diagnosis || reason,
      rawOutput: cleanOutput,
    };
  }
  
  // Se não encontrou deactivate reason, verificar se ONU está online
  if (cleanOutput.toLowerCase().includes("active") || cleanOutput.toLowerCase().includes("online")) {
    return {
      alarmType: null,
      alarmCode: null,
      description: "ONU está online/ativa",
      diagnosis: "Sem alarmes ativos",
      rawOutput: cleanOutput,
    };
  }
  
  return null;
}

// Comando e parser para Furukawa (AsGOS) - LD2502/LD2504
// Requer "enable" para entrar no modo privilegiado antes de comandos
const furukawaConfig: VendorConfig = {
  listAlarmsCommand: "show gpon onu alarm",
  parseAlarms: parseDatacomAlarms, // Parser para listagem de alarmes
  // Comando específico para diagnóstico por serial
  diagnosisCommand: (onuId: string) => `show onu serial ${onuId}`,
  parseDiagnosis: parseFurukawaDiagnosis,
  requiresEnable: true, // AsGOS precisa de "enable" primeiro
};

// Comando e parser para Intelbras - A VALIDAR
const intelbrasConfig: VendorConfig = {
  listAlarmsCommand: "show alarm active",
  parseAlarms: parseDatacomAlarms, // Usar parser genérico até validar
};

// Comando e parser para TP-Link - A VALIDAR
const tplinkConfig: VendorConfig = {
  listAlarmsCommand: "show alarm",
  parseAlarms: parseDatacomAlarms, // Usar parser genérico até validar
};

// Lista de fabricantes suportados (para uso no frontend)
export const OLT_VENDORS = [
  { value: "datacom", label: "Datacom" },
  { value: "zte", label: "ZTE" },
  { value: "furukawa", label: "Furukawa" },
  { value: "intelbras", label: "Intelbras" },
  { value: "tplink", label: "TP-Link" },
  { value: "huawei", label: "Huawei" },
  { value: "nokia", label: "Nokia" },
  { value: "fiberhome", label: "Fiberhome" },
] as const;

// Mapa de vendors para configurações
const vendorConfigs: Record<string, VendorConfig> = {
  "datacom": datacomConfig,
  "dmos": datacomConfig,
  "huawei": huaweiConfig,
  "zte": zteConfig,
  "nokia": nokiaConfig,
  "fiberhome": fiberhomeConfig,
  "furukawa": furukawaConfig,
  "intelbras": intelbrasConfig,
  "tplink": tplinkConfig,
  "tp-link": tplinkConfig,
  // Fallback para vendors não configurados
  "default": datacomConfig,
};

// Retorna a configuração do vendor (case-insensitive)
function getVendorConfig(vendor: string | null | undefined): VendorConfig {
  if (!vendor) return vendorConfigs["default"];
  const normalizedVendor = vendor.toLowerCase().trim();
  return vendorConfigs[normalizedVendor] || vendorConfigs["default"];
}

// Verifica se o vendor tem comando de diagnóstico específico (ex: Furukawa usa show onu serial)
export function hasSpecificDiagnosisCommand(vendor: string | null | undefined): boolean {
  const config = getVendorConfig(vendor);
  return !!(config.diagnosisCommand && config.parseDiagnosis);
}

// Parser para Datacom (DmOS) - VALIDADO EM PRODUÇÃO
function parseDatacomAlarms(output: string): OltAlarm[] {
  const alarms: OltAlarm[] = [];
  const cleanOutput = stripAnsiCodes(output);
  const lines = cleanOutput.split("\n");
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    
    // Pular linhas vazias, cabeçalhos e separadores
    if (!trimmedLine || 
        trimmedLine.startsWith("Triggered on") || 
        trimmedLine.startsWith("----") ||
        trimmedLine.includes("Welcome to") ||
        trimmedLine.includes("logged in") ||
        trimmedLine.includes("connected from") ||
        trimmedLine.includes("#")) {
      continue;
    }
    
    // Formato: "2025-12-15 05:43:59 UTC-3    CRITICAL gpon-1/1/1/14    Active   GPON_LOSi    ONU Loss..."
    const match = trimmedLine.match(/(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s*[A-Z]*[+-]?\d*)\s+(\w+)\s+([\w\-\/]+)\s+(\w+)\s+([\w_]+)\s+(.*)/);
    if (match) {
      alarms.push({
        timestamp: match[1].trim(),
        severity: match[2].trim(),
        source: match[3].trim(),
        status: match[4].trim(),
        name: match[5].trim(),
        description: match[6].trim(),
      });
      continue;
    }
    
    // Fallback: separar por múltiplos espaços
    const columns = trimmedLine.split(/\s{2,}/);
    if (columns.length >= 5 && columns[0].match(/^\d{4}-\d{2}-\d{2}/)) {
      if (columns.length >= 6) {
        alarms.push({
          timestamp: columns[0].trim(),
          severity: columns[1].trim(),
          source: columns[2].trim(),
          status: columns[3].trim(),
          name: columns[4].trim(),
          description: columns.slice(5).join(' ').trim(),
        });
      } else if (columns.length === 5) {
        alarms.push({
          timestamp: columns[0].trim(),
          severity: columns[1].trim(),
          source: columns[2].trim(),
          status: "Active",
          name: columns[3].trim(),
          description: columns[4].trim(),
        });
      }
    }
  }
  
  return alarms;
}

// Parser para Huawei (MA5800) - A VALIDAR
function parseHuaweiAlarms(output: string): OltAlarm[] {
  const alarms: OltAlarm[] = [];
  const cleanOutput = stripAnsiCodes(output);
  const lines = cleanOutput.split("\n");
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    
    // Pular linhas vazias e cabeçalhos
    if (!trimmedLine || 
        trimmedLine.startsWith("----") ||
        trimmedLine.startsWith("Alarm") ||
        trimmedLine.includes("Total:") ||
        trimmedLine.includes("#") ||
        trimmedLine.includes("MA5800")) {
      continue;
    }
    
    // Formato Huawei: "2025-12-15 05:43:59  CRITICAL  0/1/3  116  ONU LOS  ..."
    // ou: "Alarm ID  Alarm Name  Alarm State  Alarm Location  ..."
    const match = trimmedLine.match(/(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s+(\w+)\s+([\d\/]+)\s+(\d+)\s+(.*)/);
    if (match) {
      const onuId = `${match[3]}:${match[4]}`; // formato: 0/1/3:116
      const alarmDesc = match[5].trim();
      const alarmName = alarmDesc.split(/\s{2,}/)[0] || alarmDesc;
      
      // Mapear nome do alarme para formato padronizado
      const mappedName = huaweiConfig.alarmNameMapping?.[alarmName] || alarmName.replace(/\s+/g, "_");
      
      alarms.push({
        timestamp: match[1].trim(),
        severity: match[2].trim(),
        source: `gpon-${onuId}`,
        status: "Active",
        name: mappedName,
        description: alarmDesc,
      });
    }
  }
  
  return alarms;
}

// Parser para ZTE (C600/C650) - A VALIDAR
function parseZteAlarms(output: string): OltAlarm[] {
  const alarms: OltAlarm[] = [];
  const cleanOutput = stripAnsiCodes(output);
  const lines = cleanOutput.split("\n");
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    
    // Pular linhas vazias e cabeçalhos
    if (!trimmedLine || 
        trimmedLine.startsWith("----") ||
        trimmedLine.startsWith("Alarm") ||
        trimmedLine.includes("Total") ||
        trimmedLine.includes("#") ||
        trimmedLine.includes("ZXAN")) {
      continue;
    }
    
    // Formato ZTE: "1  gpon-onu_1/1/3:116  LOSi  Active  2025-12-15 05:43:59"
    const match = trimmedLine.match(/\d+\s+(gpon-onu_[\d\/\:]+)\s+(\w+)\s+(\w+)\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/i);
    if (match) {
      const alarmName = zteConfig.alarmNameMapping?.[match[2]] || `GPON_${match[2]}`;
      alarms.push({
        timestamp: match[4].trim(),
        severity: "CRITICAL",
        source: match[1].trim(),
        status: match[3].trim(),
        name: alarmName,
        description: `${match[2]} alarm`,
      });
    }
  }
  
  return alarms;
}

// Parser para Nokia (ISAM) - A VALIDAR
function parseNokiaAlarms(output: string): OltAlarm[] {
  const alarms: OltAlarm[] = [];
  const cleanOutput = stripAnsiCodes(output);
  const lines = cleanOutput.split("\n");
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    
    if (!trimmedLine || 
        trimmedLine.startsWith("----") ||
        trimmedLine.includes("#")) {
      continue;
    }
    
    // Formato Nokia: similar ao Datacom (tabular)
    const columns = trimmedLine.split(/\s{2,}/);
    if (columns.length >= 5 && columns[0].match(/^\d{4}-\d{2}-\d{2}/)) {
      alarms.push({
        timestamp: columns[0].trim(),
        severity: columns[1]?.trim() || "CRITICAL",
        source: columns[2]?.trim() || "",
        status: columns[3]?.trim() || "Active",
        name: columns[4]?.trim() || "",
        description: columns.slice(5).join(' ').trim(),
      });
    }
  }
  
  return alarms;
}

// Parser para Fiberhome (AN5516) - A VALIDAR
function parseFiberhomeAlarms(output: string): OltAlarm[] {
  const alarms: OltAlarm[] = [];
  const cleanOutput = stripAnsiCodes(output);
  const lines = cleanOutput.split("\n");
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    
    if (!trimmedLine || 
        trimmedLine.startsWith("----") ||
        trimmedLine.includes("#") ||
        trimmedLine.includes("AN5516")) {
      continue;
    }
    
    // Formato Fiberhome: "gpon-onu_1/1/3:116  LOS  Active  2025-12-15 05:43:59"
    const match = trimmedLine.match(/([\w\-\/\:]+)\s+(\w+)\s+(\w+)\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/);
    if (match) {
      alarms.push({
        timestamp: match[4].trim(),
        severity: "CRITICAL",
        source: match[1].trim(),
        status: match[3].trim(),
        name: `GPON_${match[2]}i`,
        description: `${match[2]} alarm`,
      });
    }
  }
  
  return alarms;
}

// Parseia todos os alarmes do output usando o parser específico do vendor
function parseAllAlarms(output: string, vendor?: string | null): OltAlarm[] {
  const config = getVendorConfig(vendor);
  return config.parseAlarms(output);
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
  const normalizedId = normalizeOnuId(onuId);
  
  // Se for conexão MySQL (Zabbix), usar consulta direta ao banco
  if (olt.connectionType === "mysql") {
    console.log(`[OLT] Usando consulta MySQL para ${olt.name} - Serial: ${onuId}`);
    return await queryZabbixMySQL(olt, onuId);
  }
  
  const vendorConfig = getVendorConfig(olt.vendor);
  let rawOutput = "";
  
  try {
    // Se o fabricante tem comando específico de diagnóstico (ex: Furukawa), usar ele
    if (vendorConfig.diagnosisCommand && vendorConfig.parseDiagnosis) {
      const command = vendorConfig.diagnosisCommand(onuId);
      console.log(`[OLT] Usando comando de diagnóstico específico para ${olt.vendor}: ${command}`);
      
      const sshOptions: SSHOptions = { requiresEnable: vendorConfig.requiresEnable };
      
      if (olt.connectionType === "ssh") {
        rawOutput = await connectSSH(olt, command, sshOptions);
      } else {
        rawOutput = await connectTelnet(olt, command);
      }
      
      const diagnosis = vendorConfig.parseDiagnosis(rawOutput, onuId);
      if (diagnosis) {
        return diagnosis;
      }
      
      // Se o parser específico não encontrou nada, retorna sem alarmes
      return {
        alarmType: null,
        alarmCode: null,
        description: "Nenhuma informação de diagnóstico encontrada",
        diagnosis: "Sem alarmes ativos",
        rawOutput,
      };
    }
    
    // Comando padrão (para Datacom e outros): filtrar alarmes pelo ONU ID
    // Se o normalizedId já contém um comando (ex: "show alarm | include"), usar diretamente
    // Isso acontece quando o diagnosisKeyTemplate inclui o comando completo
    const isFullCommand = normalizedId.toLowerCase().includes("show ") || normalizedId.toLowerCase().includes("sh ");
    const command = isFullCommand ? normalizedId : `show alarm | include ${normalizedId}`;
    
    // Extrai a chave de busca real para o parser (ex: "1/1/1/2" de "show alarm | include 1/1/1/2")
    let parseKey = normalizedId;
    if (isFullCommand) {
      const includeMatch = normalizedId.match(/include\s+(.+)$/i);
      if (includeMatch) {
        parseKey = includeMatch[1].trim();
      }
    }
    
    if (olt.connectionType === "ssh") {
      rawOutput = await connectSSH(olt, command);
    } else {
      rawOutput = await connectTelnet(olt, command);
    }
    
    const alarms = parseAlarmOutput(rawOutput, parseKey);
    
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

// Busca o ID da ONU via SSH usando o serial/string de busca
// Usa o comando configurado na OLT ou fallback por vendor
export async function searchOnuBySerial(olt: Olt, searchString: string): Promise<{ success: boolean; onuId: string | null; rawOutput: string; message: string }> {
  try {
    const vendor = (olt.vendor || "").toLowerCase();
    
    // Usa o comando configurado na OLT ou fallback por vendor
    const command = buildOnuSearchCommand(olt, searchString);
    
    if (!command) {
      return {
        success: false,
        onuId: null,
        rawOutput: "",
        message: `Fabricante "${olt.vendor}" não suportado para busca de ONU. Configure o comando de busca na OLT.`
      };
    }
    
    console.log(`[OLT Search] Buscando ONU por serial "${searchString}" em ${olt.name} (${vendor})`);
    console.log(`[OLT Search] Comando: ${command}`);
    
    // Usar as mesmas opções do diagnóstico (requiresEnable para Furukawa)
    const vendorConfig = getVendorConfig(vendor);
    const sshOptions: SSHOptions = { requiresEnable: vendorConfig.requiresEnable };
    
    let rawOutput: string;
    if (olt.connectionType === "ssh") {
      rawOutput = await connectSSH(olt, command, sshOptions);
    } else {
      rawOutput = await connectTelnet(olt, command);
    }
    
    console.log(`[OLT Search] Output recebido (${rawOutput.length} chars)`);
    
    // Parse do output baseado no vendor
    let onuId: string | null = null;
    const lines = rawOutput.split("\n").filter(l => l.trim());
    
    if (vendor.includes("datacom")) {
      // Datacom: formato "1/1/1 2 TPLG150853A0 Down None ..."
      // parts[0] = slot/port/pon (ex: 1/1/1)
      // parts[1] = ID numérico da ONU (ex: 2)
      // parts[2] = serial (ex: TPLG150853A0)
      // Resultado: apenas o ID numérico (ex: 2)
      for (const line of lines) {
        if (line.toLowerCase().includes(searchString.toLowerCase())) {
          const parts = line.trim().split(/\s+/);
          // Verifica se tem formato esperado: slot/port/pon + ID + serial
          if (parts.length >= 3) {
            const ponPath = parts[0]; // 1/1/1
            const onuNumber = parts[1]; // 2
            // Verifica se ponPath tem formato X/X/X e onuNumber é numérico
            if (/^\d+\/\d+\/\d+$/.test(ponPath) && /^\d+$/.test(onuNumber)) {
              onuId = onuNumber; // Apenas o ID numérico
              break;
            }
          }
        }
      }
    } else if (vendor.includes("furukawa") || vendor.includes("fk")) {
      // Furukawa: usar o mesmo parser do diagnóstico de alarmes
      // Extrai ONU index, status e motivo da última desconexão
      const cleanOutput = stripAnsiCodes(rawOutput);
      
      // Procurar ONU index - formato: "onu-index: 1/1/2/5" ou similar
      for (const line of lines) {
        const lowerLine = line.toLowerCase();
        if (lowerLine.includes("onu") && (lowerLine.includes("index") || lowerLine.includes("id"))) {
          const match = line.match(/:\s*(.+?)(?:\s|$)/);
          if (match) {
            onuId = match[1].trim();
            break;
          }
        }
      }
      
      // Alternativa: buscar formato numérico de ONU
      if (!onuId) {
        for (const line of lines) {
          const match = line.match(/(\d+\/\d+\/\d+[\/:]?\d*)/);
          if (match) {
            onuId = match[1];
            break;
          }
        }
      }
      
      // Extrair status da ONU
      let status = "";
      for (const line of lines) {
        const lowerLine = line.toLowerCase();
        if (lowerLine.includes("state") || lowerLine.includes("status")) {
          const stateMatch = line.match(/:\s*(.+?)(?:\s|$)/);
          if (stateMatch) {
            status = stateMatch[1].trim();
          }
        }
      }
      
      // Extrair motivo da última desconexão (deactivate-reason)
      let deactivateReason = "";
      const deactivateMatch = cleanOutput.match(/deactivate[- ]?reason[^:]*:\s*([^\r\n]+)/i);
      if (deactivateMatch) {
        deactivateReason = deactivateMatch[1].trim();
      }
      
      // Se encontrou informações adicionais, incluir na mensagem
      if (onuId) {
        let extraInfo = "";
        const isOnline = status.toLowerCase().includes("active") || 
                         status.toLowerCase().includes("online") || 
                         status.toLowerCase().includes("up");
        
        if (status) extraInfo += `Status: ${status}`;
        // Só mostra motivo da desconexão se NÃO estiver online
        if (deactivateReason && !isOnline) {
          extraInfo += (extraInfo ? " | " : "") + `Último motivo: ${deactivateReason}`;
        }
        
        console.log(`[OLT Search] Furukawa ONU encontrada: ${onuId}${extraInfo ? ` (${extraInfo})` : ""}`);
        
        return {
          success: true,
          onuId,
          rawOutput,
          message: extraInfo ? `ONU encontrada: ${onuId} (${extraInfo})` : `ONU encontrada: ${onuId}`
        };
      }
    } else if (vendor.includes("huawei")) {
      // Huawei: procura "ONT ID" ou similar
      for (const line of lines) {
        if (line.toLowerCase().includes("ont id") || line.toLowerCase().includes("onu id")) {
          const match = line.match(/:\s*(\d+)/);
          if (match) {
            // Huawei geralmente retorna só o número, precisa combinar com PON
            const ponMatch = rawOutput.match(/(\d+\/\d+\/\d+)/);
            onuId = ponMatch ? `${ponMatch[1]}:${match[1]}` : match[1];
            break;
          }
        }
      }
    } else if (vendor.includes("zte")) {
      // ZTE: formato similar ao Datacom
      for (const line of lines) {
        if (line.toLowerCase().includes(searchString.toLowerCase())) {
          const match = line.match(/(gpon-onu_?\d+\/\d+\/\d+:\d+)/i);
          if (match) {
            onuId = match[1];
            break;
          }
        }
      }
    } else if (vendor.includes("nokia")) {
      // Nokia: formato PON/ONU
      for (const line of lines) {
        const match = line.match(/(\d+\/\d+\/\d+\/\d+)/);
        if (match) {
          onuId = match[1];
          break;
        }
      }
    }
    
    if (onuId) {
      console.log(`[OLT Search] ONU encontrada: ${onuId}`);
      return {
        success: true,
        onuId,
        rawOutput,
        message: `ONU encontrada: ${onuId}`
      };
    } else {
      console.log(`[OLT Search] ONU não encontrada no output`);
      return {
        success: false,
        onuId: null,
        rawOutput,
        message: "ONU não encontrada. Verifique o serial informado."
      };
    }
  } catch (error) {
    console.error(`[OLT Search] Erro:`, error);
    return {
      success: false,
      onuId: null,
      rawOutput: "",
      message: error instanceof Error ? error.message : "Erro ao buscar ONU"
    };
  }
}

export async function testOltConnection(olt: Olt): Promise<{ success: boolean; message: string }> {
  try {
    if (olt.connectionType === "mysql") {
      // Teste de conexão MySQL (Zabbix)
      console.log(`[OLT Test] Testando conexão MySQL ${olt.ipAddress}:${olt.port}...`);
      const connection = await mysql.createConnection({
        host: olt.ipAddress,
        port: olt.port,
        user: olt.username,
        password: olt.password,
        database: olt.database || "db_django_olts",
        connectTimeout: 30000,
      });
      const [rows] = await connection.execute("SELECT 1 as test");
      await connection.end();
      console.log(`[OLT Test] Conexão MySQL bem-sucedida:`, rows);
      return { success: true, message: "Conexão MySQL bem-sucedida" };
    }
    
    const vendorConfig = getVendorConfig(olt.vendor);
    const command = vendorConfig.listAlarmsCommand;
    if (olt.connectionType === "ssh") {
      await connectSSH(olt, command);
    } else {
      await connectTelnet(olt, command);
    }
    return { success: true, message: "Conexão bem-sucedida" };
  } catch (error) {
    console.error(`[OLT Test] Erro:`, error);
    return { 
      success: false, 
      message: error instanceof Error ? error.message : "Erro de conexão" 
    };
  }
}

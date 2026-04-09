import { storage } from "./storage";
import { isEncrypted, decrypt } from "./crypto";

const MAX_SCHEDULED_BACKUPS = 2;

// Detecta versão do RouterOS e nome do dispositivo no output do /export
function parseExportMeta(content: string): { deviceName?: string; routerosVersion?: string } {
  const lines = content.split("\n").slice(0, 5);
  let deviceName: string | undefined;
  let routerosVersion: string | undefined;
  for (const line of lines) {
    const verMatch = line.match(/RouterOS\s+([\d.]+)/i);
    if (verMatch) routerosVersion = verMatch[1];
    const nameMatch = line.match(/by\s+([^\s]+)\s+on\s+([^\s]+)/i);
    if (nameMatch) deviceName = nameMatch[2];
  }
  return { deviceName, routerosVersion };
}

// Conecta via SSH e executa /export compact, retornando o conteúdo como string
export async function runMikrotikExport(
  ip: string,
  port: number,
  sshUser: string,
  sshPass: string,
): Promise<string> {
  const { Client: SSHClient } = await import("ssh2");

  return new Promise<string>((resolve, reject) => {
    const client = new SSHClient();
    let out = "";
    const timer = setTimeout(() => {
      client.end();
      reject(new Error("Timeout de conexão SSH (export)"));
    }, 30000);

    client.on("ready", () => {
      client.exec("/export compact", (err: any, stream: any) => {
        if (err) {
          clearTimeout(timer);
          client.end();
          return reject(err);
        }
        stream.on("close", () => {
          clearTimeout(timer);
          client.end();
          if (!out.trim()) return reject(new Error("Saída vazia — /export não retornou dados"));
          resolve(out.trim());
        });
        stream.on("data", (d: Buffer) => { out += d.toString(); });
        stream.stderr.on("data", (d: Buffer) => { out += d.toString(); });
      });
    });

    client.on("error", (err: any) => { clearTimeout(timer); reject(err); });

    client.connect({
      host: ip,
      port,
      username: sshUser,
      password: sshPass,
      readyTimeout: 15000,
      algorithms: {
        kex: ["diffie-hellman-group14-sha1", "diffie-hellman-group14-sha256", "ecdh-sha2-nistp256", "curve25519-sha256"],
        cipher: ["aes128-ctr", "aes256-ctr", "aes128-cbc", "3des-cbc", "aes256-cbc"],
        serverHostKey: ["ssh-rsa", "ssh-dss", "ecdsa-sha2-nistp256", "rsa-sha2-256"],
      },
    });
  });
}

// Restaura configuração via SFTP + /import
export async function restoreMikrotikBackup(
  ip: string,
  port: number,
  sshUser: string,
  sshPass: string,
  content: string,
): Promise<string> {
  const { Client: SSHClient } = await import("ssh2");

  return new Promise<string>((resolve, reject) => {
    const client = new SSHClient();
    let out = "";
    const timer = setTimeout(() => {
      client.end();
      reject(new Error("Timeout de conexão SSH (restore)"));
    }, 60000);

    const cleanup = () => { clearTimeout(timer); client.end(); };

    client.on("ready", () => {
      // Upload via SFTP
      client.sftp((sftpErr: any, sftp: any) => {
        if (sftpErr) { cleanup(); return reject(sftpErr); }
        const remoteFile = "/lm-restore.rsc";
        const writeStream = sftp.createWriteStream(remoteFile);
        writeStream.on("error", (e: any) => { cleanup(); reject(e); });
        writeStream.on("finish", () => {
          // Executa /import
          client.exec(`/import file-name=lm-restore.rsc`, (err: any, stream: any) => {
            if (err) { cleanup(); return reject(err); }
            stream.on("close", () => { cleanup(); resolve(out.trim() || "Restauração concluída"); });
            stream.on("data", (d: Buffer) => { out += d.toString(); });
            stream.stderr.on("data", (d: Buffer) => { out += d.toString(); });
          });
        });
        writeStream.end(Buffer.from(content, "utf8"));
      });
    });

    client.on("error", (err: any) => { cleanup(); reject(err); });

    client.connect({
      host: ip,
      port,
      username: sshUser,
      password: sshPass,
      readyTimeout: 15000,
      algorithms: {
        kex: ["diffie-hellman-group14-sha1", "diffie-hellman-group14-sha256", "ecdh-sha2-nistp256", "curve25519-sha256"],
        cipher: ["aes128-ctr", "aes256-ctr", "aes128-cbc", "3des-cbc", "aes256-cbc"],
        serverHostKey: ["ssh-rsa", "ssh-dss", "ecdsa-sha2-nistp256", "rsa-sha2-256"],
      },
    });
  });
}

// Faz backup de um CPE específico (chamado manualmente ou pelo scheduler)
export async function backupCpe(
  cpeId: number,
  linkCpeId: number | undefined,
  ip: string,
  sshPort: number,
  sshUser: string,
  sshPassword: string,
  source: "manual" | "scheduled",
  createdByUserId?: number,
  createdByUsername?: string,
): Promise<{ backupId: number; size: number }> {
  const content = await runMikrotikExport(ip, sshPort, sshUser, sshPassword);
  const { deviceName, routerosVersion } = parseExportMeta(content);
  const size = Buffer.byteLength(content, "utf8");

  const backup = await storage.createCpeBackup({
    cpeId,
    linkCpeId,
    content,
    deviceName,
    routerosVersion,
    size,
    source,
    createdByUserId,
    createdByUsername,
    label: source === "scheduled" ? "Automático (semanal)" : undefined,
  });

  // Mantém somente os 2 backups automáticos mais recentes
  if (source === "scheduled") {
    await storage.deleteOldestCpeBackups(cpeId, MAX_SCHEDULED_BACKUPS);
  }

  console.log(`[CpeBackup] CPE ${cpeId}: backup ${source} salvo (${size} bytes, id=${backup.id})`);
  return { backupId: backup.id, size };
}

// Job semanal: toda segunda-feira às 02:00
let backupInterval: NodeJS.Timeout | null = null;

async function runWeeklyBackupJob() {
  console.log("[CpeBackup] Iniciando backup semanal automático de CPEs Mikrotik...");
  try {
    // Busca todos os CPEs ativos que sejam Mikrotik (sshUser configurado)
    const allCpes = await storage.getCpes();
    const mikrotikCpes = allCpes.filter((c: any) =>
      c.isActive && c.sshUser && (c.sshPassword || c.ipAddress)
    );
    console.log(`[CpeBackup] ${mikrotikCpes.length} CPE(s) com SSH configurado para backup`);

    let ok = 0, fail = 0;
    for (const cpe of mikrotikCpes) {
      const ip = cpe.ipAddress;
      if (!ip) { fail++; continue; }
      try {
        const rawPass = cpe.sshPassword
          ? (isEncrypted(cpe.sshPassword) ? decrypt(cpe.sshPassword) : cpe.sshPassword)
          : "";
        await backupCpe(cpe.id, undefined, ip, cpe.sshPort || 22, cpe.sshUser || "admin", rawPass, "scheduled");
        ok++;
      } catch (e: any) {
        console.error(`[CpeBackup] Falha no backup do CPE ${cpe.id} (${cpe.name}):`, e.message);
        fail++;
      }
    }
    console.log(`[CpeBackup] Backup semanal concluído: ${ok} ok, ${fail} falhos`);
  } catch (e) {
    console.error("[CpeBackup] Erro no job semanal:", e);
  }
}

export function startCpeBackupScheduler() {
  console.log("[CpeBackup] Scheduler semanal iniciado (toda segunda às 02:00)");

  // Verifica a cada hora se é segunda às 02:00
  backupInterval = setInterval(async () => {
    const now = new Date();
    if (now.getDay() === 1 && now.getHours() === 2 && now.getMinutes() < 5) {
      await runWeeklyBackupJob();
    }
  }, 5 * 60 * 1000); // checa a cada 5 minutos
}

export function stopCpeBackupScheduler() {
  if (backupInterval) {
    clearInterval(backupInterval);
    backupInterval = null;
  }
}

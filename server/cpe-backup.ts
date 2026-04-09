import { storage } from "./storage";
import { isEncrypted, decrypt } from "./crypto";

const MAX_SCHEDULED_BACKUPS = 2;

// Detecta versão do RouterOS e nome do dispositivo no output do /export
function parseMikrotikMeta(content: string): { deviceName?: string; firmwareVersion?: string } {
  const lines = content.split("\n").slice(0, 5);
  let deviceName: string | undefined;
  let firmwareVersion: string | undefined;
  for (const line of lines) {
    const verMatch = line.match(/RouterOS\s+([\d.]+)/i);
    if (verMatch) firmwareVersion = verMatch[1];
    const nameMatch = line.match(/by\s+([^\s]+)\s+on\s+([^\s]+)/i);
    if (nameMatch) deviceName = nameMatch[2];
  }
  return { deviceName, firmwareVersion };
}

// Detecta hostname e versão de firmware de dispositivos Datacom EDD
function parseDatacomMeta(content: string): { deviceName?: string; firmwareVersion?: string } {
  let deviceName: string | undefined;
  let firmwareVersion: string | undefined;
  for (const line of content.split("\n").slice(0, 30)) {
    // "hostname NomeDoDispositivo"
    const hostnameMatch = line.match(/^hostname\s+(\S+)/i);
    if (hostnameMatch) deviceName = hostnameMatch[1];
    // "! Software Version: x.x.x" ou "! Firmware Version: x.x.x"
    const verMatch = line.match(/(?:software|firmware)\s+version[:\s]+(\S+)/i);
    if (verMatch) firmwareVersion = verMatch[1];
    if (deviceName && firmwareVersion) break;
  }
  return { deviceName, firmwareVersion };
}

// Conecta via SSH e executa /export compact no Mikrotik
export async function runMikrotikExport(
  ip: string,
  port: number,
  sshUser: string,
  sshPass: string,
): Promise<string> {
  ip = ip.trim();
  const { Client: SSHClient } = await import("ssh2");

  return new Promise<string>((resolve, reject) => {
    const client = new SSHClient();
    let out = "";
    let resolved = false;
    let idleTimer: NodeJS.Timeout | null = null;

    const done = (err?: Error) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(globalTimer);
      if (idleTimer) clearTimeout(idleTimer);
      client.end();
      if (err) return reject(err);
      if (!out.trim()) return reject(new Error("Saída vazia — /export não retornou dados"));
      resolve(out.trim());
    };

    const globalTimer = setTimeout(() => done(new Error("Timeout de conexão SSH (export)")), 90000);

    client.on("ready", () => {
      client.exec("/export compact", (err: any, stream: any) => {
        if (err) return done(err);

        const resetIdleTimer = () => {
          if (idleTimer) clearTimeout(idleTimer);
          idleTimer = setTimeout(() => {
            if (out.trim()) done();
            else done(new Error("Timeout — nenhum dado recebido do /export"));
          }, 15000);
        };

        stream.on("data", (d: Buffer) => { out += d.toString(); resetIdleTimer(); });
        stream.stderr.on("data", (d: Buffer) => { out += d.toString(); resetIdleTimer(); });
        stream.on("close", () => done());
        stream.on("end", () => { setTimeout(() => done(), 500); });

        resetIdleTimer();
      });
    });

    client.on("error", (err: any) => done(err));

    client.connect({
      host: ip,
      port,
      username: sshUser,
      password: sshPass,
      readyTimeout: 20000,
      algorithms: {
        kex: ["diffie-hellman-group14-sha1", "diffie-hellman-group14-sha256", "ecdh-sha2-nistp256", "curve25519-sha256"],
        cipher: ["aes128-ctr", "aes256-ctr", "aes128-cbc", "3des-cbc", "aes256-cbc"],
        serverHostKey: ["ssh-rsa", "ssh-dss", "ecdsa-sha2-nistp256", "rsa-sha2-256"],
      },
    });
  });
}

// Conecta via SSH e executa "show running-config" no Datacom EDD
export async function runDatacomExport(
  ip: string,
  port: number,
  sshUser: string,
  sshPass: string,
): Promise<string> {
  ip = ip.trim();
  const { Client: SSHClient } = await import("ssh2");

  return new Promise<string>((resolve, reject) => {
    const client = new SSHClient();
    let out = "";
    let resolved = false;
    let idleTimer: NodeJS.Timeout | null = null;

    const done = (err?: Error) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(globalTimer);
      if (idleTimer) clearTimeout(idleTimer);
      client.end();
      if (err) return reject(err);
      const cleaned = out
        .replace(/--More--|<Press any key to continue>/gi, "")
        .replace(/\r/g, "")
        .trim();
      if (!cleaned) return reject(new Error("Saída vazia — show running-config não retornou dados"));
      resolve(cleaned);
    };

    // Timeout global: 60s
    const globalTimer = setTimeout(() => done(new Error("Timeout de conexão SSH (Datacom export)")), 60000);

    const resetIdleTimer = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        if (out.trim()) done();
        else done(new Error("Timeout — nenhum dado recebido do show running-config"));
      }, 12000);
    };

    client.on("ready", () => {
      // Tenta exec channel primeiro (mais limpo, sem prompt interativo)
      client.exec("show running-config", (err: any, stream: any) => {
        if (err) {
          // Se exec channel não funcionar, tenta shell interativo
          client.shell((shellErr: any, shellStream: any) => {
            if (shellErr) return done(shellErr);
            let promptDetected = false;
            shellStream.on("data", (d: Buffer) => {
              const chunk = d.toString();
              out += chunk;
              resetIdleTimer();
              // Se recebeu o prompt do Datacom (ex: "hostname#" ou "hostname>"), encerra após idle
              if (/[>#]\s*$/.test(chunk.trim())) promptDetected = true;
            });
            shellStream.stderr?.on("data", (d: Buffer) => { out += d.toString(); });
            shellStream.on("close", () => done());
            shellStream.on("end", () => done());
            resetIdleTimer();
            // Envia terminal length 0 para evitar paginação, depois o comando
            setTimeout(() => {
              shellStream.write("terminal length 0\n");
              setTimeout(() => {
                shellStream.write("show running-config\n");
                resetIdleTimer();
              }, 800);
            }, 500);
          });
          return;
        }

        stream.on("data", (d: Buffer) => { out += d.toString(); resetIdleTimer(); });
        stream.stderr.on("data", (d: Buffer) => { out += d.toString(); resetIdleTimer(); });
        stream.on("close", () => done());
        stream.on("end", () => { setTimeout(() => done(), 500); });

        resetIdleTimer();
      });
    });

    client.on("error", (err: any) => done(err));

    client.connect({
      host: ip,
      port,
      username: sshUser,
      password: sshPass,
      readyTimeout: 20000,
      algorithms: {
        kex: [
          "diffie-hellman-group1-sha1",
          "diffie-hellman-group-exchange-sha1",
          "diffie-hellman-group-exchange-sha256",
          "diffie-hellman-group14-sha1",
          "diffie-hellman-group14-sha256",
          "ecdh-sha2-nistp256",
          "curve25519-sha256",
        ],
        cipher: ["aes128-cbc", "aes256-cbc", "3des-cbc", "aes128-ctr", "aes256-ctr", "aes192-cbc", "aes192-ctr"],
        serverHostKey: ["ssh-rsa", "ssh-dss", "ecdsa-sha2-nistp256", "rsa-sha2-256", "rsa-sha2-512"],
        hmac: ["hmac-sha1", "hmac-sha2-256", "hmac-sha1-96", "hmac-md5"],
      },
    });
  });
}

// Restaura configuração Mikrotik via SFTP + /import
export async function restoreMikrotikBackup(
  ip: string,
  port: number,
  sshUser: string,
  sshPass: string,
  content: string,
): Promise<string> {
  ip = ip.trim();
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
      client.sftp((sftpErr: any, sftp: any) => {
        if (sftpErr) { cleanup(); return reject(sftpErr); }
        const remoteFile = "/lm-restore.rsc";
        const writeStream = sftp.createWriteStream(remoteFile);
        writeStream.on("error", (e: any) => { cleanup(); reject(e); });
        writeStream.on("finish", () => {
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

export type SupportedBackupVendor = "mikrotik" | "datacom";

// Normaliza o vendor slug para os vendors suportados
export function resolveBackupVendor(vendorSlug?: string | null): SupportedBackupVendor | null {
  const slug = (vendorSlug || "").toLowerCase();
  if (slug.includes("mikrotik") || slug.includes("routeros")) return "mikrotik";
  if (slug.includes("datacom")) return "datacom";
  return null;
}

// Faz backup de um CPE (Mikrotik ou Datacom)
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
  vendorSlug?: string | null,
): Promise<{ backupId: number; size: number }> {
  const vendor = resolveBackupVendor(vendorSlug);

  let content: string;
  let deviceName: string | undefined;
  let firmwareVersion: string | undefined;

  if (vendor === "datacom") {
    content = await runDatacomExport(ip, sshPort, sshUser, sshPassword);
    ({ deviceName, firmwareVersion } = parseDatacomMeta(content));
  } else {
    // Default: Mikrotik (também usado para CPEs sem vendor definido)
    content = await runMikrotikExport(ip, sshPort, sshUser, sshPassword);
    ({ deviceName, firmwareVersion } = parseMikrotikMeta(content));
  }

  const size = Buffer.byteLength(content, "utf8");

  const backup = await storage.createCpeBackup({
    cpeId,
    linkCpeId,
    content,
    vendor: vendor || "mikrotik",
    deviceName,
    routerosVersion: firmwareVersion,
    size,
    source,
    createdByUserId,
    createdByUsername,
    label: source === "scheduled" ? "Automático (semanal)" : undefined,
  });

  if (source === "scheduled") {
    await storage.deleteOldestCpeBackups(cpeId, MAX_SCHEDULED_BACKUPS, linkCpeId);
  }

  console.log(`[CpeBackup] CPE ${cpeId} (${vendor || "mikrotik"}): backup ${source} salvo (${size} bytes, id=${backup.id})`);
  return { backupId: backup.id, size };
}

// Job semanal: toda segunda-feira às 02:00
let backupInterval: NodeJS.Timeout | null = null;

async function runWeeklyBackupJob() {
  console.log("[CpeBackup] Iniciando backup semanal automático de CPEs...");
  try {
    const associations = await storage.getActiveLinkCpesWithSsh();
    console.log(`[CpeBackup] ${associations.length} associação(ões) link-CPE com SSH configurado`);

    const seenIps = new Set<string>();
    let ok = 0, fail = 0, skipped = 0;

    for (const assoc of associations) {
      const ip = assoc.ipOverride || assoc.ipAddress;
      if (!ip) { fail++; continue; }

      const dedupeKey = assoc.isStandard && assoc.ipOverride ? `${assoc.linkCpeId}:${ip}` : ip;
      if (seenIps.has(dedupeKey)) { skipped++; continue; }
      seenIps.add(dedupeKey);

      try {
        const rawPass = assoc.sshPassword
          ? (isEncrypted(assoc.sshPassword) ? decrypt(assoc.sshPassword) : assoc.sshPassword)
          : "";
        await backupCpe(
          assoc.cpeId,
          assoc.linkCpeId,
          ip,
          assoc.sshPort || 22,
          assoc.sshUser || "admin",
          rawPass,
          "scheduled",
          undefined,
          undefined,
          assoc.vendorSlug,
        );
        ok++;
      } catch (e: any) {
        console.error(`[CpeBackup] Falha no backup link-CPE ${assoc.linkCpeId} (${assoc.cpeName}, ${ip}):`, e.message);
        fail++;
      }
    }
    console.log(`[CpeBackup] Backup semanal concluído: ${ok} ok, ${fail} falhos, ${skipped} duplicatas ignoradas`);
  } catch (e) {
    console.error("[CpeBackup] Erro no job semanal:", e);
  }
}

export function startCpeBackupScheduler() {
  console.log("[CpeBackup] Scheduler semanal iniciado (toda segunda às 02:00)");
  backupInterval = setInterval(async () => {
    const now = new Date();
    if (now.getDay() === 1 && now.getHours() === 2 && now.getMinutes() < 5) {
      await runWeeklyBackupJob();
    }
  }, 5 * 60 * 1000);
}

export function stopCpeBackupScheduler() {
  if (backupInterval) {
    clearInterval(backupInterval);
    backupInterval = null;
  }
}

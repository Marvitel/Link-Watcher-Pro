/**
 * Integração com servidor Monsta (monitoramento legado da Marvitel).
 *
 * Acesso via SSH com usuário restrito (monstaro) executando wrapper que só permite:
 *   - sqlite-monsta5 "<query>"  → leitura readonly do monsta5.db (devices, groups)
 *   - sqlite-events  "<query>"  → leitura readonly do events.db (eventos abertos/históricos)
 *   - monstadb       "<influxql>" → consulta HTTP no monstadb (séries temporais — best effort)
 *
 * Configuração (Replit Secrets):
 *   MONSTA_SSH_HOST  (ex: "191.52.248.66")
 *   MONSTA_SSH_PORT  (default: 2266)
 *   MONSTA_SSH_USER  (default: "monstaro")
 *   MONSTA_SSH_KEY   (chave privada OpenSSH em texto, BEGIN..END inteira)
 */

import { Client as SshClient } from "ssh2";
import { db } from "./db";
import { externalIntegrations } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { decrypt } from "./crypto";

const DEFAULT_PORT = 2266;
const DEFAULT_USER = "monstaro";
const SSH_TIMEOUT_MS = 20_000;
const QUERY_TIMEOUT_MS = 30_000;

export const MONSTA_PROVIDER = "monsta";

let cachedClient: SshClient | null = null;
let cachedClientReady = false;
let connectingPromise: Promise<SshClient> | null = null;
let cachedConfig: { host: string; port: number; username: string; privateKey: string; source: "db" | "env" } | null = null;
let cachedConfigAt = 0;
const CONFIG_CACHE_MS = 30_000;

interface MonstaConfigSummary {
  configured: boolean;
  source: "db" | "env" | null;
  host: string | null;
  port: number | null;
  username: string | null;
  hasKey: boolean;
}

/**
 * Resumo da configuração atual — usado pela UI (não retorna a chave em claro).
 */
export async function getConfigSummary(): Promise<MonstaConfigSummary> {
  // 1) Tenta DB
  try {
    const fromDb = await loadConfigFromDb();
    if (fromDb) {
      return {
        configured: true,
        source: "db",
        host: fromDb.host,
        port: fromDb.port,
        username: fromDb.username,
        hasKey: !!fromDb.privateKey,
      };
    }
  } catch { /* ignora — tenta env */ }

  // 2) Fallback env
  const envHost = process.env.MONSTA_SSH_HOST?.trim() || null;
  const envKey = process.env.MONSTA_SSH_KEY || "";
  if (envHost && envKey) {
    return {
      configured: true,
      source: "env",
      host: envHost,
      port: Number(process.env.MONSTA_SSH_PORT) || DEFAULT_PORT,
      username: process.env.MONSTA_SSH_USER?.trim() || DEFAULT_USER,
      hasKey: true,
    };
  }
  return { configured: false, source: null, host: null, port: null, username: null, hasKey: false };
}

/**
 * Limpa o cache do cliente SSH e da config. Chamar após salvar nova configuração.
 */
export function invalidateConfig() {
  cachedConfig = null;
  cachedConfigAt = 0;
  disposeClient();
}

async function loadConfigFromDb() {
  const rows = await db
    .select()
    .from(externalIntegrations)
    .where(and(eq(externalIntegrations.provider, MONSTA_PROVIDER), eq(externalIntegrations.isActive, true)))
    .limit(1);
  if (rows.length === 0) return null;
  const row = rows[0];
  if (!row.apiKey) return null;
  // apiUrl guarda JSON {host, port, username}
  let meta: { host?: string; port?: number; username?: string } = {};
  if (row.apiUrl) {
    try { meta = JSON.parse(row.apiUrl); } catch { /* ignora */ }
  }
  if (!meta.host) return null;
  let key: string;
  try {
    key = decrypt(row.apiKey);
  } catch (e: any) {
    throw new Error(`Falha ao descriptografar chave SSH do Monsta: ${e?.message || e}`);
  }
  return {
    host: meta.host.trim(),
    port: Number(meta.port) || DEFAULT_PORT,
    username: (meta.username || DEFAULT_USER).trim(),
    privateKey: normalizePemKey(key),
  };
}

async function getConfig() {
  if (cachedConfig && Date.now() - cachedConfigAt < CONFIG_CACHE_MS) {
    return cachedConfig;
  }

  // 1) DB tem prioridade (configurável pela UI)
  try {
    const fromDb = await loadConfigFromDb();
    if (fromDb) {
      cachedConfig = { ...fromDb, source: "db" };
      cachedConfigAt = Date.now();
      return cachedConfig;
    }
  } catch (err) {
    // Se DB falhou por outro motivo (não "ausente"), propaga
    throw err;
  }

  // 2) Fallback env (compat. com instalações que já tinham os secrets)
  const host = process.env.MONSTA_SSH_HOST?.trim();
  const key = process.env.MONSTA_SSH_KEY;
  if (!host || !key) {
    throw new Error(
      "Monsta não configurado. Configure em Admin → Analista IA → Monsta (ou defina os secrets MONSTA_SSH_HOST e MONSTA_SSH_KEY).",
    );
  }
  cachedConfig = {
    host,
    port: Number(process.env.MONSTA_SSH_PORT) || DEFAULT_PORT,
    username: process.env.MONSTA_SSH_USER?.trim() || DEFAULT_USER,
    privateKey: normalizePemKey(key),
    source: "env",
  };
  cachedConfigAt = Date.now();
  return cachedConfig;
}

/**
 * Normaliza chave PEM/OpenSSH. Aceita chaves com ou sem newlines (alguns gerenciadores
 * de secrets removem \n no paste). Re-injeta quebras de linha a cada 70 chars de base64.
 */
function normalizePemKey(raw: string): string {
  const trimmed = raw.trim();
  // Se já tem newlines, devolve como está (com newline final garantido)
  if (trimmed.includes("\n")) return trimmed.endsWith("\n") ? trimmed : trimmed + "\n";

  // Detecta marcadores comuns
  const beginMatch = trimmed.match(/^(-----BEGIN [^-]+-----)/);
  const endMatch = trimmed.match(/(-----END [^-]+-----)$/);
  if (!beginMatch || !endMatch) return trimmed; // formato desconhecido — deixa o ssh2 reclamar

  const begin = beginMatch[1];
  const end = endMatch[1];
  // Pega o miolo entre BEGIN e END, remove qualquer whitespace
  const body = trimmed.slice(begin.length, trimmed.length - end.length).replace(/\s+/g, "");
  // Quebra em linhas de 70 chars (padrão OpenSSH)
  const chunks: string[] = [];
  for (let i = 0; i < body.length; i += 70) chunks.push(body.slice(i, i + 70));
  return [begin, ...chunks, end, ""].join("\n");
}

function disposeClient() {
  cachedClientReady = false;
  if (cachedClient) {
    try { cachedClient.end(); } catch { /* ignore */ }
    cachedClient = null;
  }
}

async function getClient(): Promise<SshClient> {
  if (cachedClient && cachedClientReady) return cachedClient;
  if (connectingPromise) return connectingPromise;

  const cfg = getConfig();
  connectingPromise = new Promise<SshClient>((resolve, reject) => {
    const conn = new SshClient();
    const timer = setTimeout(() => {
      try { conn.end(); } catch { /* ignore */ }
      reject(new Error(`SSH connect timeout (${SSH_TIMEOUT_MS}ms) to ${cfg.host}:${cfg.port}`));
    }, SSH_TIMEOUT_MS);

    conn.once("ready", () => {
      clearTimeout(timer);
      cachedClient = conn;
      cachedClientReady = true;
      resolve(conn);
    });
    conn.once("error", (err) => {
      clearTimeout(timer);
      disposeClient();
      reject(new Error(`SSH error: ${err.message}`));
    });
    conn.once("end", disposeClient);
    conn.once("close", disposeClient);

    conn.connect({
      host: cfg.host,
      port: cfg.port,
      username: cfg.username,
      privateKey: cfg.privateKey,
      readyTimeout: SSH_TIMEOUT_MS,
      keepaliveInterval: 30_000,
    });
  }).finally(() => {
    connectingPromise = null;
  });

  return connectingPromise;
}

function execRemote(command: string, stdinPayload?: string): Promise<string> {
  return new Promise(async (resolve, reject) => {
    let conn: SshClient;
    try {
      conn = await getClient();
    } catch (err) {
      reject(err);
      return;
    }

    const timer = setTimeout(() => {
      reject(new Error(`Monsta query timeout (${QUERY_TIMEOUT_MS}ms): ${command.slice(0, 80)}`));
    }, QUERY_TIMEOUT_MS);

    conn.exec(command, (err, stream) => {
      if (err) {
        clearTimeout(timer);
        reject(err);
        return;
      }
      let stdout = "";
      let stderr = "";
      stream.on("data", (d: Buffer) => { stdout += d.toString("utf8"); });
      stream.stderr.on("data", (d: Buffer) => { stderr += d.toString("utf8"); });
      stream.on("close", (code: number) => {
        clearTimeout(timer);
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`Monsta cmd exit=${code}: ${stderr.trim() || stdout.trim()}`));
        }
      });
      if (stdinPayload != null) {
        stream.end(stdinPayload);
      } else {
        stream.end();
      }
    });
  });
}

// ---------- helpers de query ----------
// Queries vão pelo STDIN (zero escape de shell). O wrapper roda `sqlite3 db < stdin`.
// O ; final é exigido pelo sqlite3 em modo batch.

async function sqliteMain<T = any>(query: string): Promise<T[]> {
  const q = query.trim().endsWith(";") ? query : query + ";";
  const out = await execRemote("sqlite-monsta5", q);
  if (!out.trim()) return [];
  try {
    return JSON.parse(out) as T[];
  } catch {
    return [];
  }
}

async function sqliteEvents<T = any>(query: string): Promise<T[]> {
  const q = query.trim().endsWith(";") ? query : query + ";";
  const out = await execRemote("sqlite-events", q);
  if (!out.trim()) return [];
  try {
    return JSON.parse(out) as T[];
  } catch {
    return [];
  }
}

// ---------- validações ----------

const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;
function assertIp(ip: string) {
  if (!ip || !IPV4_RE.test(ip)) throw new Error(`IP inválido: ${ip}`);
}
function sanitizePattern(p: string): string {
  // Pra LIKE: deixa letras, números, espaço, hífen, ponto, underscore, dois-pontos, barra
  return String(p || "").replace(/[^A-Za-z0-9 _\-.:/]/g, "").slice(0, 64);
}

// =====================================================================
// API pública: 3 ferramentas para a IA
// =====================================================================

export interface MonstaDeviceStatus {
  found: boolean;
  device?: {
    id: number;
    name: string;
    kind: string;
    ip: string | null;
    snmpCommunity: string | null;
    snmpVersion: number | null;
    snmpPort: number | null;
    status: string | null;
    lastStatusChangeAt: string | null;
    description: string | null;
    isInactive: boolean;
    alertsDisabled: boolean;
    parentGroupIds: number[];
  };
  openEventsCount?: number;
  message?: string;
}

/**
 * Busca status atual de um device pelo IP.
 * Retorna config SNMP, status (DeviceUp/Down/etc), última mudança, e quantos eventos abertos tem.
 */
export async function getDeviceStatus(ip: string): Promise<MonstaDeviceStatus> {
  assertIp(ip);

  const rows = await sqliteMain<any>(
    `SELECT id, kind, name, description, ` +
    `json_extract(config, '$."net.address"') AS ip, ` +
    `json_extract(config, '$."snmp.community"') AS snmp_community, ` +
    `json_extract(config, '$."snmp.version"') AS snmp_version, ` +
    `json_extract(config, '$."snmp.port"') AS snmp_port, ` +
    `json_extract(data, '$.status') AS status, ` +
    `json_extract(data, '$.last_status_change_at') AS last_status_change_at, ` +
    `json_extract(data, '$.inactive') AS inactive, ` +
    `json_extract(data, '$.disable_alerts') AS disable_alerts, ` +
    `json_extract(data, '$.parents') AS parents_json ` +
    `FROM groups WHERE kind='Device' ` +
    `AND json_extract(config, '$."net.address"')='${ip}' LIMIT 1`,
  );

  if (rows.length === 0) {
    return { found: false, message: `Nenhum device com IP ${ip} cadastrado no Monsta` };
  }

  const r = rows[0];
  let parentIds: number[] = [];
  if (r.parents_json) {
    try { parentIds = JSON.parse(r.parents_json); } catch { /* ignore */ }
  }

  // Conta eventos abertos pra esse device
  const eventsRows = await sqliteEvents<{ c: number }>(
    `SELECT COUNT(*) AS c FROM events WHERE container_id=${Number(r.id)} AND closed=0`,
  );
  const openEventsCount = eventsRows[0]?.c ?? 0;

  return {
    found: true,
    device: {
      id: Number(r.id),
      name: r.name,
      kind: r.kind,
      ip: r.ip,
      snmpCommunity: r.snmp_community,
      snmpVersion: r.snmp_version != null ? Number(r.snmp_version) : null,
      snmpPort: r.snmp_port != null ? Number(r.snmp_port) : null,
      status: r.status,
      lastStatusChangeAt: r.last_status_change_at,
      description: r.description,
      isInactive: r.inactive === 1 || r.inactive === true,
      alertsDisabled: r.disable_alerts === 1 || r.disable_alerts === true,
      parentGroupIds: parentIds,
    },
    openEventsCount,
  };
}

export interface MonstaEvent {
  id: number;
  time: string;
  eventType: string;
  level: number;
  closed: boolean;
  durationSecs: number | null;
  acknowledgedBy: string | null;
  deviceName?: string;
  monitorName?: string;
  metricName?: string;
  formattedValue?: string;
  rawProps?: any;
}

/**
 * Lista eventos recentes (abertos e fechados) de um device pelo IP, nas últimas N horas.
 */
export async function getRecentEvents(ip: string, hours = 24, limit = 50): Promise<{
  found: boolean;
  deviceId?: number;
  deviceName?: string;
  events: MonstaEvent[];
  message?: string;
}> {
  assertIp(ip);
  const safeHours = Math.max(1, Math.min(168, Math.floor(hours)));
  const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));

  // 1. Acha device id pelo IP
  const dev = await sqliteMain<any>(
    `SELECT id, name FROM groups WHERE kind='Device' ` +
    `AND json_extract(config, '$."net.address"')='${ip}' LIMIT 1`,
  );
  if (dev.length === 0) {
    return { found: false, events: [], message: `Nenhum device com IP ${ip} no Monsta` };
  }
  const deviceId = Number(dev[0].id);

  // 2. Eventos das últimas N horas (datetime do SQLite suporta strftime)
  const rows = await sqliteEvents<any>(
    `SELECT id, time, event_type, level, closed, duration_secs, acknowledged_by, props ` +
    `FROM events WHERE container_id=${deviceId} ` +
    `AND time >= datetime('now', '-${safeHours} hours') ` +
    `ORDER BY time DESC LIMIT ${safeLimit}`,
  );

  const events: MonstaEvent[] = rows.map((r) => {
    let props: any = null;
    try { props = JSON.parse(r.props); } catch { /* ignore */ }
    return {
      id: Number(r.id),
      time: r.time,
      eventType: r.event_type,
      level: Number(r.level),
      closed: r.closed === 1 || r.closed === true,
      durationSecs: r.duration_secs != null ? Number(r.duration_secs) : null,
      acknowledgedBy: r.acknowledged_by,
      deviceName: props?.device_name,
      monitorName: props?.monitor_name,
      metricName: props?.metric_name,
      formattedValue: props?.formatted_value,
    };
  });

  return { found: true, deviceId, deviceName: dev[0].name, events };
}

export interface MonstaDeviceSummary {
  id: number;
  name: string;
  ip: string | null;
  status: string | null;
  lastStatusChangeAt: string | null;
}

/**
 * Busca devices pelo nome (LIKE %pattern%) ou IP. Útil quando o IP cadastrado está errado.
 */
export async function searchDevices(pattern: string, limit = 20): Promise<MonstaDeviceSummary[]> {
  const clean = sanitizePattern(pattern);
  if (!clean) return [];
  const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));

  const rows = await sqliteMain<any>(
    `SELECT id, name, ` +
    `json_extract(config, '$."net.address"') AS ip, ` +
    `json_extract(data, '$.status') AS status, ` +
    `json_extract(data, '$.last_status_change_at') AS last_status_change_at ` +
    `FROM groups WHERE kind='Device' ` +
    `AND (name LIKE '%${clean}%' OR json_extract(config, '$."net.address"') LIKE '%${clean}%') ` +
    `LIMIT ${safeLimit}`,
  );

  return rows.map((r) => ({
    id: Number(r.id),
    name: r.name,
    ip: r.ip,
    status: r.status,
    lastStatusChangeAt: r.last_status_change_at,
  }));
}

/**
 * Teste de conectividade. Retorna info simples se SSH+SQLite estão respondendo.
 */
export async function ping(): Promise<{ ok: boolean; deviceCount?: number; error?: string }> {
  try {
    const rows = await sqliteMain<{ c: number }>(
      `SELECT COUNT(*) AS c FROM groups WHERE kind='Device'`,
    );
    return { ok: true, deviceCount: rows[0]?.c ?? 0 };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}

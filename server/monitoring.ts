import { exec } from "child_process";
import { promisify } from "util";
import snmp from "net-snmp";
import { db } from "./db";
import { links, metrics, snmpProfiles, equipmentVendors, events, olts, switches, monitoringSettings, linkMonitoringState, blacklistChecks, cpes, linkCpes, clients, clientSettings, ddosEvents, linkTrafficInterfaces, trafficInterfaceMetrics, snmpConcentrators, externalIntegrations } from "@shared/schema";
import { eq, and, not, like, gte, isNotNull, desc, or } from "drizzle-orm";
import { queryAllOltAlarms, queryOltAlarm, getDiagnosisFromAlarms, hasSpecificDiagnosisCommand, buildOnuDiagnosisKey, queryZabbixOpticalMetrics, type OltAlarm, type ZabbixOpticalMetrics } from "./olt";
import { findInterfaceByName, discoverInterfaces, getOpticalSignal, getOpticalSignalFromSwitch, getCiscoOpticalSignal, getInterfaceOperStatus, type SnmpProfile as SnmpProfileType, type OpticalSignalData } from "./snmp";
import { lookupMultiplePppoeSessions } from "./concentrator";
import { switchSensorCache } from "@shared/schema";
import { wanguardService } from "./wanguard";

const execAsync = promisify(exec);

// Cache de IPs em blacklist por linkId - carregado uma vez por ciclo de monitoramento
let blacklistCache: Map<number, { ip: string; isListed: boolean }[]> = new Map();

// Função para carregar cache de blacklist (chamada uma vez por ciclo)
async function loadBlacklistCache(): Promise<void> {
  try {
    const allBlacklistChecks = await db.select({
      linkId: blacklistChecks.linkId,
      ip: blacklistChecks.ip,
      isListed: blacklistChecks.isListed
    })
    .from(blacklistChecks)
    .where(eq(blacklistChecks.isListed, true));
    
    blacklistCache = new Map();
    for (const check of allBlacklistChecks) {
      if (!blacklistCache.has(check.linkId)) {
        blacklistCache.set(check.linkId, []);
      }
      blacklistCache.get(check.linkId)!.push({ ip: check.ip, isListed: check.isListed });
    }
    if (blacklistCache.size > 0) {
      console.log(`[Monitor] Blacklist cache loaded: ${blacklistCache.size} links with blacklisted IPs`);
    }
  } catch (error) {
    console.error('[Monitor] Error loading blacklist cache:', error);
    blacklistCache = new Map();
  }
}

// Função auxiliar para normalizar campo de splitter (tratar vazios, "-", N/A como null)
function normalizeSplitterField(val: string | null | undefined): string | null {
  if (!val) return null;
  const trimmed = val.trim();
  if (!trimmed || /^(-|n\/?a|n\/?d|null|undefined|sem dados?)$/i.test(trimmed)) return null;
  return trimmed;
}

// Função auxiliar para normalizar distância: converter para metros, remover unidade, tratar N/A como null
function normalizeDistance(val: string | null | undefined): string | null {
  if (!val) return null;
  const trimmed = val.trim();
  
  // Tratar N/A, n/a, N/D, -, vazio como null
  if (/^(n\/?a|n\/?d|-|null|undefined|sem dados?)$/i.test(trimmed)) {
    return null;
  }
  
  const kmMatch = trimmed.match(/^(\d+(?:[.,]\d+)?)\s*km$/i);
  if (kmMatch) {
    // Converter km para metros
    const km = parseFloat(kmMatch[1].replace(",", "."));
    return Math.round(km * 1000).toString();
  }
  
  // Remove unidades comuns se presentes (m, metros)
  const cleaned = trimmed.replace(/\s*(m|metros?)$/i, "").trim();
  // Verificar se é numérico após limpeza
  if (!/^\d+(?:[.,]\d+)?$/.test(cleaned)) {
    return null;
  }
  return cleaned;
}

// Função auxiliar para atualizar dados de splitter do Zabbix no link
async function updateLinkZabbixSplitterData(
  linkId: number, 
  zabbixMetrics: ZabbixOpticalMetrics
): Promise<void> {
  try {
    // PRIMEIRO normalizar todos os campos
    const splitterName = normalizeSplitterField(zabbixMetrics.splitter);
    const splitterPort = normalizeSplitterField(zabbixMetrics.portaSplitter);
    const distancia = normalizeDistance(zabbixMetrics.distancia);
    
    // DEPOIS verificar se há pelo menos um dado válido
    if (!splitterName && !splitterPort && !distancia) {
      return; // Não atualizar se não há dados de splitter válidos
    }
    
    const updateData: Record<string, unknown> = {
      zabbixLastSync: new Date(),
      zabbixSplitterName: splitterName,
      zabbixSplitterPort: splitterPort,
      zabbixOnuDistance: distancia,
    };
    
    await db.update(links)
      .set(updateData)
      .where(eq(links.id, linkId));
      
    console.log(`[Monitor] Link ${linkId} - Splitter atualizado: ${splitterName || '(vazio)'} porta ${splitterPort || '(vazio)'} dist ${distancia || '(vazio)'}`);
      
  } catch (error) {
    console.error(`[Monitor] Erro ao atualizar dados de splitter do link ${linkId}:`, error);
  }
}

const PARALLEL_WORKERS = 5;
const COLLECTION_TIMEOUT_MS = 30000;

// ============ Moving Average & Persistence Alert System ============

interface PacketLossSample {
  loss: number;
  timestamp: string;
}

interface LinkAlertState {
  packetLossWindow: PacketLossSample[];
  packetLossAvg: number;
  consecutiveLossBreaches: number;
  lastAlertAt: Date | null;
}

// In-memory cache for link alert states (faster than DB queries each cycle)
const linkAlertStateCache = new Map<number, LinkAlertState>();

// Global monitoring settings cache
let monitoringSettingsCache: Record<string, string> = {};
let monitoringSettingsCacheTime = 0;
const SETTINGS_CACHE_TTL_MS = 60000; // Refresh settings every 1 minute

async function loadMonitoringSettings(): Promise<Record<string, string>> {
  const now = Date.now();
  if (now - monitoringSettingsCacheTime < SETTINGS_CACHE_TTL_MS && Object.keys(monitoringSettingsCache).length > 0) {
    return monitoringSettingsCache;
  }
  
  try {
    const settings = await db.select().from(monitoringSettings);
    monitoringSettingsCache = settings.reduce((acc, s) => {
      acc[s.key] = s.value;
      return acc;
    }, {} as Record<string, string>);
    monitoringSettingsCacheTime = now;
  } catch (error) {
    console.error("[Monitor] Error loading monitoring settings:", error);
  }
  
  return monitoringSettingsCache;
}

function getMonitoringParam(settings: Record<string, string>, key: string, defaultValue: number): number {
  const val = settings[key];
  if (!val) return defaultValue;
  const num = parseFloat(val);
  return isNaN(num) ? defaultValue : num;
}

async function updatePacketLossState(
  linkId: number,
  currentLoss: number,
  settings: Record<string, string>
): Promise<{ avgLoss: number; shouldAlert: boolean; consecutiveBreaches: number }> {
  const windowSize = getMonitoringParam(settings, "packet_loss_window_cycles", 10);
  const threshold = getMonitoringParam(settings, "packet_loss_threshold_pct", 2);
  const persistenceCycles = getMonitoringParam(settings, "packet_loss_persistence_cycles", 3);
  
  // Get or initialize state from cache
  let state = linkAlertStateCache.get(linkId);
  if (!state) {
    // Try to load from DB on first access
    try {
      const dbState = await db.select().from(linkMonitoringState).where(eq(linkMonitoringState.linkId, linkId));
      if (dbState[0]) {
        state = {
          packetLossWindow: (dbState[0].packetLossWindow as PacketLossSample[]) || [],
          packetLossAvg: dbState[0].packetLossAvg,
          consecutiveLossBreaches: dbState[0].consecutiveLossBreaches,
          lastAlertAt: dbState[0].lastAlertAt,
        };
      }
    } catch (e) {
      // Ignore DB errors, start fresh
    }
    
    if (!state) {
      state = {
        packetLossWindow: [],
        packetLossAvg: 0,
        consecutiveLossBreaches: 0,
        lastAlertAt: null,
      };
    }
    linkAlertStateCache.set(linkId, state);
  }
  
  // Add new sample to window
  state.packetLossWindow.push({
    loss: currentLoss,
    timestamp: new Date().toISOString(),
  });
  
  // Trim window to size
  while (state.packetLossWindow.length > windowSize) {
    state.packetLossWindow.shift();
  }
  
  // Calculate moving average
  const totalLoss = state.packetLossWindow.reduce((sum, s) => sum + s.loss, 0);
  state.packetLossAvg = state.packetLossWindow.length > 0 ? totalLoss / state.packetLossWindow.length : 0;
  
  // Check if average exceeds threshold
  const isBreaching = state.packetLossAvg > threshold;
  
  if (isBreaching) {
    state.consecutiveLossBreaches++;
  } else {
    state.consecutiveLossBreaches = 0;
  }
  
  // Determine if we should alert (persistence rule)
  const shouldAlert = state.consecutiveLossBreaches >= persistenceCycles;
  
  // Persist state to DB periodically (every 5 cycles or on breach change)
  if (state.packetLossWindow.length % 5 === 0 || shouldAlert) {
    try {
      await db.insert(linkMonitoringState)
        .values({
          linkId,
          packetLossWindow: state.packetLossWindow as any,
          packetLossAvg: state.packetLossAvg,
          consecutiveLossBreaches: state.consecutiveLossBreaches,
          lastAlertAt: state.lastAlertAt,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: linkMonitoringState.linkId,
          set: {
            packetLossWindow: state.packetLossWindow as any,
            packetLossAvg: state.packetLossAvg,
            consecutiveLossBreaches: state.consecutiveLossBreaches,
            lastAlertAt: state.lastAlertAt,
            updatedAt: new Date(),
          },
        });
    } catch (e) {
      // Log but don't fail
      console.error(`[Monitor] Error persisting alert state for link ${linkId}:`, e);
    }
  }
  
  return {
    avgLoss: state.packetLossAvg,
    shouldAlert,
    consecutiveBreaches: state.consecutiveLossBreaches,
  };
}

function markAlertSent(linkId: number): void {
  const state = linkAlertStateCache.get(linkId);
  if (state) {
    state.lastAlertAt = new Date();
    // Reset counter after alert to avoid repeated alerts
    state.consecutiveLossBreaches = 0;
  }
}

function resetLinkState(linkId: number): void {
  // Clear the link state when link goes down to avoid false alerts when it comes back
  linkAlertStateCache.delete(linkId);
}

// Interface auto-discovery constants
const IFINDEX_MISMATCH_THRESHOLD = 3; // Number of consecutive failures before auto-discovery
const IFINDEX_VALIDATION_INTERVAL_MS = 300000; // 5 minutes between validations

async function runWithConcurrencyLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<(R | null)[]> {
  const results: (R | null)[] = new Array(items.length).fill(null);
  let index = 0;
  
  async function worker(): Promise<void> {
    while (index < items.length) {
      const currentIndex = index++;
      const item = items[currentIndex];
      try {
        results[currentIndex] = await Promise.race([
          fn(item),
          new Promise<R>((_, reject) => 
            setTimeout(() => reject(new Error("Timeout")), COLLECTION_TIMEOUT_MS)
          )
        ]);
      } catch (error) {
        results[currentIndex] = null;
      }
    }
  }
  
  const workers = Array(Math.min(limit, items.length))
    .fill(null)
    .map(() => worker());
  
  await Promise.all(workers);
  return results;
}

interface StatusChangeEvent {
  type: "error" | "warning" | "info" | "critical";
  title: string;
  description: string;
  resolved: boolean;
}

// Cache para evitar múltiplas consultas de OLT durante transições rápidas
interface OltDiagnosisCacheEntry {
  timestamp: number;
  diagnosis: string;
  failureReason: string | null;
  alarmType: string | null;
  alarmTime: string | null;
}
const oltDiagnosisCache = new Map<number, OltDiagnosisCacheEntry>();
const OLT_DIAGNOSIS_COOLDOWN_MS = 300000; // 5 minutos

// Mapeamento de códigos OLT para failureReason canônicos
function mapOltAlarmToFailureReason(alarmType: string | null): string | null {
  if (!alarmType) return null;
  const alarmUpper = alarmType.toUpperCase();
  if (alarmUpper.includes("LOS") || alarmUpper.includes("LOF")) {
    return "rompimento_fibra";
  }
  if (alarmUpper.includes("DG") || alarmUpper.includes("DYING")) {
    return "queda_energia";
  }
  if (alarmUpper.includes("SF") || alarmUpper.includes("SD")) {
    return "sinal_degradado";
  }
  if (alarmUpper.includes("DOWN") || alarmUpper.includes("DOW")) {
    return "onu_inativa";
  }
  return "olt_alarm";
}

// Thresholds de sinal óptico padrão (em dBm)
const OPTICAL_THRESHOLDS = {
  rxNormalMin: -25,    // >= -25 dBm = Normal
  rxWarningMin: -28,   // >= -28 dBm = Atenção  
  // < -28 dBm = Crítico
};

/**
 * Determina o status do sinal óptico baseado em thresholds e delta
 */
function getOpticalStatus(
  rxPower: number | null | undefined,
  baseline: number | null | undefined,
  deltaThreshold: number
): "normal" | "warning" | "critical" | null {
  if (rxPower === null || rxPower === undefined) {
    return null;
  }

  // Verificar delta em relação ao baseline
  if (baseline !== null && baseline !== undefined) {
    const delta = rxPower - baseline;
    if (delta < -deltaThreshold) {
      // Degradação significativa em relação ao baseline
      return "warning";
    }
  }

  // Verificar thresholds absolutos
  if (rxPower >= OPTICAL_THRESHOLDS.rxNormalMin) {
    return "normal";
  }
  if (rxPower >= OPTICAL_THRESHOLDS.rxWarningMin) {
    return "warning";
  }
  return "critical";
}

function getStatusChangeEvent(
  previousStatus: string,
  newStatus: string,
  linkName: string,
  latency: number,
  packetLoss: number
): StatusChangeEvent | null {
  // Link ficou offline - evento crítico
  if (newStatus === "offline" && previousStatus !== "offline") {
    return {
      type: "critical",
      title: `Link ${linkName} offline`,
      description: `O link ficou indisponível. Última latência: ${latency.toFixed(1)}ms, Perda de pacotes: ${packetLoss.toFixed(1)}%`,
      resolved: false,
    };
  }
  
  // Link degradado
  if (newStatus === "degraded" && previousStatus === "operational") {
    return {
      type: "warning",
      title: `Link ${linkName} degradado`,
      description: `O link apresenta degradação de desempenho. Latência: ${latency.toFixed(1)}ms, Perda de pacotes: ${packetLoss.toFixed(1)}%`,
      resolved: false,
    };
  }
  
  // Link voltou ao normal após offline
  if (newStatus === "operational" && previousStatus === "offline") {
    return {
      type: "info",
      title: `Link ${linkName} restaurado`,
      description: `O link voltou a operar normalmente. Latência: ${latency.toFixed(1)}ms, Perda de pacotes: ${packetLoss.toFixed(1)}%`,
      resolved: true,
    };
  }
  
  // Link voltou ao normal após degradação
  if (newStatus === "operational" && previousStatus === "degraded") {
    return {
      type: "info",
      title: `Link ${linkName} normalizado`,
      description: `O link voltou ao desempenho normal. Latência: ${latency.toFixed(1)}ms, Perda de pacotes: ${packetLoss.toFixed(1)}%`,
      resolved: true,
    };
  }
  
  return null;
}

interface PingResult {
  latency: number;
  packetLoss: number;
  success: boolean;
  status?: string;
  failureReason?: string | null;
}

interface TrafficResult {
  inOctets: number;
  outOctets: number;
  timestamp: Date;
}

interface SnmpProfile {
  id: number;
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

const IF_TRAFFIC_OIDS = {
  ifInOctets: "1.3.6.1.2.1.2.2.1.10",
  ifOutOctets: "1.3.6.1.2.1.2.2.1.16",
  ifHCInOctets: "1.3.6.1.2.1.31.1.1.1.6",
  ifHCOutOctets: "1.3.6.1.2.1.31.1.1.1.10",
};

// OIDs for CPU and Memory monitoring
// FortiGate specific OIDs
const FORTIGATE_SYSTEM_OIDS = {
  cpuUsage: "1.3.6.1.4.1.12356.101.4.1.3.0",      // fgSysCpuUsage
  memoryUsage: "1.3.6.1.4.1.12356.101.4.1.4.0",   // fgSysMemUsage
};

// Generic HOST-RESOURCES-MIB OIDs (fallback)
const HOST_RESOURCES_OIDS = {
  hrProcessorLoad: "1.3.6.1.2.1.25.3.3.1.2",      // CPU load per processor
  hrStorageUsed: "1.3.6.1.2.1.25.2.3.1.6",        // Storage used
  hrStorageSize: "1.3.6.1.2.1.25.2.3.1.5",        // Storage size
};

interface SystemResourceResult {
  cpuUsage: number;
  memoryUsage: number;
}

const previousTrafficData = new Map<number, TrafficResult>();
// Cache para interfaces de tráfego adicionais - chave: "linkId-interfaceId"
const previousAdditionalTrafficData = new Map<string, TrafficResult>();

const isDevelopment = process.env.NODE_ENV === "development";
let pingPermissionDenied = false;

/**
 * Detecta se um endereço é IPv6
 * Suporta formatos: 2001:db8::1, ::1, fe80::1%eth0, [2001:db8::1]
 */
function isIPv6(address: string): boolean {
  // Remove colchetes se presentes (formato URL)
  const cleanAddress = address.replace(/^\[|\]$/g, '');
  // Remove interface scope se presente (ex: %eth0)
  const addressWithoutScope = cleanAddress.split('%')[0];
  // IPv6 contém ":" e não é apenas porta (IPv4:port)
  return addressWithoutScope.includes(':') && !addressWithoutScope.match(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d+$/);
}

export async function checkTcpPort(ipAddress: string, port: number = 80, timeoutMs: number = 3000): Promise<{ success: boolean; responseTimeMs: number }> {
  const net = await import("net");
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = new net.Socket();
    
    socket.setTimeout(timeoutMs);
    
    socket.on("connect", () => {
      const elapsed = Date.now() - start;
      socket.destroy();
      resolve({ success: true, responseTimeMs: elapsed });
    });
    
    socket.on("timeout", () => {
      socket.destroy();
      resolve({ success: false, responseTimeMs: timeoutMs });
    });
    
    socket.on("error", () => {
      socket.destroy();
      resolve({ success: false, responseTimeMs: Date.now() - start });
    });
    
    socket.connect(port, ipAddress);
  });
}

export async function pingHost(ipAddress: string, count: number = 5): Promise<PingResult> {
  if (pingPermissionDenied) {
    return simulatePing();
  }

  try {
    // Detecta IPv6 e usa o comando apropriado
    const isV6 = isIPv6(ipAddress);
    const pingCmd = isV6 ? 'ping6' : 'ping';
    
    // Increased timeout from 2s to 3s to reduce false positives
    // Using -i 0.3 for faster ping interval (300ms between pings)
    const { stdout } = await execAsync(`${pingCmd} -c ${count} -W 3 -i 0.3 ${ipAddress} 2>&1`, {
      timeout: 20000,
    });

    if (stdout.includes("Operation not permitted") || stdout.includes("missing cap_net_raw")) {
      console.log("[Monitor] Ping requires elevated permissions. Using simulated data in development.");
      pingPermissionDenied = true;
      return simulatePing();
    }

    const latencyMatch = stdout.match(/rtt min\/avg\/max\/mdev = [\d.]+\/([\d.]+)\/[\d.]+\/[\d.]+/);
    const lossMatch = stdout.match(/(\d+)% packet loss/);

    const latency = latencyMatch ? parseFloat(latencyMatch[1]) : 0;
    const packetLoss = lossMatch ? parseFloat(lossMatch[1]) : 100;
    
    // Log when packet loss is detected for debugging false positives
    if (packetLoss > 0 && packetLoss < 100) {
      console.log(`[Ping] ${ipAddress}: ${packetLoss}% loss detected (${count - Math.round(count * packetLoss / 100)}/${count} packets received)`);
    }

    return {
      latency,
      packetLoss,
      success: packetLoss < 100,
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorOutput = (error as { stdout?: string })?.stdout || "";
    
    if (errorOutput.includes("Operation not permitted") || errorOutput.includes("missing cap_net_raw")) {
      console.log("[Monitor] Ping requires elevated permissions. Using simulated data in development.");
      pingPermissionDenied = true;
      return simulatePing();
    }
    
    if (isDevelopment) {
      return simulatePing();
    }
    
    // Determine failure reason from error message
    let failureReason = "unknown";
    if (errorMessage.includes("timed out") || errorMessage.includes("timeout")) {
      failureReason = "timeout";
    } else if (errorMessage.includes("Destination Host Unreachable") || errorOutput.includes("Destination Host Unreachable")) {
      failureReason = "host_unreachable";
    } else if (errorMessage.includes("Network is unreachable") || errorOutput.includes("Network is unreachable")) {
      failureReason = "network_unreachable";
    } else if (errorMessage.includes("100% packet loss") || errorOutput.includes("100% packet loss")) {
      failureReason = "no_response";
    }
    
    console.error(`Ping failed for ${ipAddress}:`, errorMessage);
    return {
      latency: 0,
      packetLoss: 100,
      success: false,
      failureReason,
    };
  }
}

function simulatePing(): PingResult {
  const baseLatency = 30 + Math.random() * 40;
  const packetLoss = Math.random() < 0.95 ? Math.random() * 1.5 : Math.random() * 5;
  
  return {
    latency: baseLatency,
    packetLoss,
    success: true,
  };
}

function createSnmpSession(targetIp: string, profile: SnmpProfile): snmp.Session {
  // Determine SNMP version - net-snmp uses numeric constants
  // Version1 = 0, Version2c = 1
  const snmpVersion = profile.version === "v1" ? 0 : 1;
  
  const options: any = {
    port: profile.port,
    timeout: profile.timeout,
    retries: profile.retries,
    version: snmpVersion,
  };

  if (profile.version === "v3") {
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
    return snmp.createSession(targetIp, profile.community || "public", options);
  }
}

// Helper function to check if a varbind contains an error (No Such Instance, No Such Object, etc.)
function isVarbindError(varbind: any): boolean {
  if (!varbind) return true;
  // Use net-snmp's built-in error checker
  return (snmp as any).isVarbindError(varbind);
}

// Helper function to parse Buffer of any size to number
function bufferToNumber(buf: Buffer): number {
  let result = 0;
  for (let i = 0; i < buf.length; i++) {
    result = result * 256 + buf[i];
  }
  return result;
}

// Helper to safely extract octets value from varbind
function extractOctetsValue(varbind: any): number | null {
  if (!varbind || isVarbindError(varbind)) {
    return null;
  }
  
  const val = varbind.value;
  
  if (Buffer.isBuffer(val)) {
    return bufferToNumber(val);
  } else if (typeof val === 'bigint') {
    return Number(val);
  } else if (typeof val === 'number' && isFinite(val)) {
    return val;
  }
  
  // String or other types may indicate error response
  return null;
}

export async function getInterfaceTraffic(
  targetIp: string,
  profile: SnmpProfile,
  ifIndex: number
): Promise<TrafficResult | null> {
  return new Promise((resolve) => {
    try {
      const session = createSnmpSession(targetIp, profile);

      // Try 64-bit HC counters first
      const hcOids = [
        `${IF_TRAFFIC_OIDS.ifHCInOctets}.${ifIndex}`,
        `${IF_TRAFFIC_OIDS.ifHCOutOctets}.${ifIndex}`,
      ];
      
      // Fallback 32-bit counters
      const stdOids = [
        `${IF_TRAFFIC_OIDS.ifInOctets}.${ifIndex}`,
        `${IF_TRAFFIC_OIDS.ifOutOctets}.${ifIndex}`,
      ];

      let sessionClosed = false;
      const closeSession = () => {
        if (!sessionClosed) {
          sessionClosed = true;
          try { session.close(); } catch {}
        }
      };

      const snmpSession = session as unknown as { 
        get: (oids: string[], callback: (error: Error | null, varbinds: any[]) => void) => void 
      };

      // First try HC counters
      snmpSession.get(hcOids, (error: Error | null, varbinds: any[]) => {
        if (error) {
          console.error(`[SNMP HC Error] ${targetIp}:`, error.message);
          closeSession();
          resolve(null);
          return;
        }

        if (!varbinds || varbinds.length < 2) {
          closeSession();
          resolve(null);
          return;
        }

        const inOctetsHC = extractOctetsValue(varbinds[0]);
        const outOctetsHC = extractOctetsValue(varbinds[1]);
        
        // If both HC counters work, use them
        if (inOctetsHC !== null && outOctetsHC !== null) {
          closeSession();
          resolve({
            inOctets: inOctetsHC,
            outOctets: outOctetsHC,
            timestamp: new Date(),
          });
          return;
        }
        
        // If one or both HC counters failed, try 32-bit fallback
        console.log(`[SNMP Fallback] ${targetIp}: HC counter error, trying 32-bit counters (inHC=${inOctetsHC !== null}, outHC=${outOctetsHC !== null})`);
        
        snmpSession.get(stdOids, (stdError: Error | null, stdVarbinds: any[]) => {
          closeSession();
          
          if (stdError) {
            console.error(`[SNMP 32-bit Error] ${targetIp}:`, stdError.message);
            // If we have partial HC data, use what we have with 0 for missing
            if (inOctetsHC !== null || outOctetsHC !== null) {
              resolve({
                inOctets: inOctetsHC ?? 0,
                outOctets: outOctetsHC ?? 0,
                timestamp: new Date(),
              });
            } else {
              resolve(null);
            }
            return;
          }
          
          if (!stdVarbinds || stdVarbinds.length < 2) {
            resolve(null);
            return;
          }
          
          const inOctetsStd = extractOctetsValue(stdVarbinds[0]);
          const outOctetsStd = extractOctetsValue(stdVarbinds[1]);
          
          // Use HC where available, fallback to 32-bit
          const finalInOctets = inOctetsHC ?? inOctetsStd ?? 0;
          const finalOutOctets = outOctetsHC ?? outOctetsStd ?? 0;
          
          if (finalInOctets === 0 && finalOutOctets === 0 && inOctetsStd === null && outOctetsStd === null) {
            // Both failed completely
            resolve(null);
            return;
          }
          
          resolve({
            inOctets: finalInOctets,
            outOctets: finalOutOctets,
            timestamp: new Date(),
          });
        });
      });

      setTimeout(() => {
        closeSession();
        resolve(null);
      }, profile.timeout + 4000); // Extended timeout for fallback
    } catch (error) {
      console.error(`SNMP session error for ${targetIp}:`, error);
      resolve(null);
    }
  });
}

async function verifyInterfaceAtIndex(
  targetIp: string,
  profile: SnmpProfile,
  ifIndex: number,
  expectedName: string
): Promise<{ matches: boolean; actualName: string | null; actualAlias: string | null }> {
  return new Promise((resolve) => {
    try {
      const session = createSnmpSession(targetIp, profile);
      const ifDescrOid = `1.3.6.1.2.1.2.2.1.2.${ifIndex}`;
      const ifNameOid = `1.3.6.1.2.1.31.1.1.1.1.${ifIndex}`;
      const ifAliasOid = `1.3.6.1.2.1.31.1.1.1.18.${ifIndex}`;

      let sessionClosed = false;
      const closeSession = () => {
        if (!sessionClosed) {
          sessionClosed = true;
          try { session.close(); } catch {}
        }
      };

      const snmpSession = session as unknown as {
        get: (oids: string[], callback: (error: Error | null, varbinds: any[]) => void) => void
      };

      snmpSession.get([ifNameOid, ifDescrOid, ifAliasOid], (error: Error | null, varbinds: any[]) => {
        closeSession();
        if (error || !varbinds || varbinds.length < 2) {
          resolve({ matches: false, actualName: null, actualAlias: null });
          return;
        }

        const extractValue = (vb: any): string | null => {
          if (!vb || vb.value === undefined || vb.type === 128 || vb.type === 129) return null;
          const val = Buffer.isBuffer(vb.value) ? vb.value.toString('utf8') : String(vb.value);
          if (!val || val.length === 0 || val === 'noSuchInstance' || val === 'noSuchObject') return null;
          return val.trim();
        };

        const actualIfName = extractValue(varbinds[0]);
        const actualIfDescr = extractValue(varbinds[1]);
        const actualAlias = extractValue(varbinds[2]);

        const actualName = actualIfName || actualIfDescr;

        if (!actualName) {
          resolve({ matches: false, actualName: null, actualAlias });
          return;
        }

        const normalizedExpected = expectedName.toLowerCase().trim();
        const normalizedActual = actualName.toLowerCase().trim();
        const matches = normalizedActual === normalizedExpected || 
                       normalizedActual.includes(normalizedExpected) ||
                       normalizedExpected.includes(normalizedActual);
        resolve({ matches, actualName, actualAlias });
      });

      setTimeout(() => {
        closeSession();
        resolve({ matches: false, actualName: null, actualAlias: null });
      }, profile.timeout + 2000);
    } catch {
      resolve({ matches: false, actualName: null, actualAlias: null });
    }
  });
}

const IFNAME_VERIFY_INTERVAL_MS = 2 * 60 * 1000;
const lastIfNameVerification = new Map<number, number>();

// Helper function to parse SNMP values
function parseSnmpValue(value: unknown): number {
  if (Buffer.isBuffer(value)) {
    let result = 0;
    for (let i = 0; i < value.length; i++) {
      result = result * 256 + value[i];
    }
    return result;
  } else if (typeof value === 'bigint') {
    return Number(value);
  } else if (typeof value === 'number') {
    return value;
  } else if (value !== null && value !== undefined) {
    return Number(String(value));
  }
  return 0;
}

export interface MemoryOids {
  memoryOid?: string | null;
  memoryTotalOid?: string | null;
  memoryUsedOid?: string | null;
  memoryIsPercentage?: boolean;
}

export async function getSystemResources(
  targetIp: string,
  profile: SnmpProfile,
  cpuOid?: string | null,
  memoryConfig?: string | null | MemoryOids,
  cpuDivisor: number = 1
): Promise<SystemResourceResult | null> {
  // Parse memory config - can be a simple OID string or an object with multiple OIDs
  let memoryOid: string | null = null;
  let memoryTotalOid: string | null = null;
  let memoryUsedOid: string | null = null;
  let memoryIsPercentage = true;

  if (typeof memoryConfig === 'string') {
    memoryOid = memoryConfig;
  } else if (memoryConfig && typeof memoryConfig === 'object') {
    memoryOid = memoryConfig.memoryOid || null;
    memoryTotalOid = memoryConfig.memoryTotalOid || null;
    memoryUsedOid = memoryConfig.memoryUsedOid || null;
    memoryIsPercentage = memoryConfig.memoryIsPercentage ?? true;
  }

  // If no OIDs provided, return null
  if (!cpuOid && !memoryOid && !memoryTotalOid) {
    return null;
  }

  return new Promise((resolve) => {
    try {
      const session = createSnmpSession(targetIp, profile);

      // Use provided OIDs or skip if not available
      const oids: string[] = [];
      const oidMap: { cpu: number; memory: number; memoryTotal: number; memoryUsed: number } = { 
        cpu: -1, memory: -1, memoryTotal: -1, memoryUsed: -1 
      };
      
      if (cpuOid) {
        oidMap.cpu = oids.length;
        oids.push(cpuOid);
      }
      if (memoryOid) {
        oidMap.memory = oids.length;
        oids.push(memoryOid);
      }
      if (memoryTotalOid) {
        oidMap.memoryTotal = oids.length;
        oids.push(memoryTotalOid);
      }
      if (memoryUsedOid) {
        oidMap.memoryUsed = oids.length;
        oids.push(memoryUsedOid);
      }

      if (oids.length === 0) {
        resolve(null);
        return;
      }

      let sessionClosed = false;
      const closeSession = () => {
        if (!sessionClosed) {
          sessionClosed = true;
          try { session.close(); } catch {}
        }
      };

      (session as unknown as { get: (oids: string[], callback: (error: Error | null, varbinds: Array<{value: unknown, type: number}>) => void) => void }).get(oids, (error: Error | null, varbinds: Array<{value: unknown, type: number}>) => {
        closeSession();

        if (error) {
          resolve(null);
          return;
        }

        if (!varbinds || varbinds.length === 0) {
          resolve(null);
          return;
        }

        // Check if we got valid responses (not NoSuchObject or NoSuchInstance)
        const noSuchObject = 128; // snmp.ObjectType.NoSuchObject
        const noSuchInstance = 129; // snmp.ObjectType.NoSuchInstance

        try {
          let cpuUsage = 0;
          let memoryUsage = 0;

          if (oidMap.cpu >= 0 && varbinds[oidMap.cpu]) {
            const vb = varbinds[oidMap.cpu];
            if (vb.type !== noSuchObject && vb.type !== noSuchInstance) {
              cpuUsage = parseSnmpValue(vb.value);
              // Aplicar divisor (ex: 100 para valores como 3315 -> 33.15%)
              if (cpuDivisor > 1) {
                cpuUsage = cpuUsage / cpuDivisor;
              }
            }
          }

          // Try to get memory from percentage OID first
          if (oidMap.memory >= 0 && varbinds[oidMap.memory]) {
            const vb = varbinds[oidMap.memory];
            if (vb.type !== noSuchObject && vb.type !== noSuchInstance) {
              memoryUsage = parseSnmpValue(vb.value);
            }
          }
          
          // If no percentage OID or value is 0, try to calculate from total/used
          if (memoryUsage === 0 && oidMap.memoryTotal >= 0 && oidMap.memoryUsed >= 0) {
            const vbTotal = varbinds[oidMap.memoryTotal];
            const vbUsed = varbinds[oidMap.memoryUsed];
            
            if (vbTotal && vbUsed && 
                vbTotal.type !== noSuchObject && vbTotal.type !== noSuchInstance &&
                vbUsed.type !== noSuchObject && vbUsed.type !== noSuchInstance) {
              const total = parseSnmpValue(vbTotal.value);
              const used = parseSnmpValue(vbUsed.value);
              
              if (total > 0) {
                memoryUsage = (used / total) * 100;
              }
            }
          }

          resolve({
            cpuUsage: isFinite(cpuUsage) && cpuUsage >= 0 && cpuUsage <= 100 ? cpuUsage : 0,
            memoryUsage: isFinite(memoryUsage) && memoryUsage >= 0 && memoryUsage <= 100 ? memoryUsage : 0,
          });
        } catch {
          resolve(null);
        }
      });

      setTimeout(() => {
        closeSession();
        resolve(null);
      }, profile.timeout + 2000);
    } catch (error) {
      console.error(`SNMP system resources error for ${targetIp}:`, error);
      resolve(null);
    }
  });
}

function calculateBandwidth(
  current: TrafficResult,
  previous: TrafficResult
): { downloadMbps: number; uploadMbps: number } {
  const timeDiffSeconds = (current.timestamp.getTime() - previous.timestamp.getTime()) / 1000;

  if (timeDiffSeconds <= 0 || !isFinite(timeDiffSeconds)) {
    return { downloadMbps: 0, uploadMbps: 0 };
  }

  let inOctetsDiff = current.inOctets - previous.inOctets;
  let outOctetsDiff = current.outOctets - previous.outOctets;

  if (!isFinite(inOctetsDiff) || inOctetsDiff < 0) {
    inOctetsDiff = 0;
  }
  if (!isFinite(outOctetsDiff) || outOctetsDiff < 0) {
    outOctetsDiff = 0;
  }

  const downloadBps = inOctetsDiff * 8 / timeDiffSeconds;
  const uploadBps = outOctetsDiff * 8 / timeDiffSeconds;

  const downloadMbps = isFinite(downloadBps) ? downloadBps / 1000000 : 0;
  const uploadMbps = isFinite(uploadBps) ? uploadBps / 1000000 : 0;

  return { downloadMbps, uploadMbps };
}

const snmpProfileCache = new Map<number, { profile: SnmpProfile; cachedAt: number }>();
const vendorCache = new Map<number, { vendor: typeof equipmentVendors.$inferSelect; cachedAt: number }>();
const concentratorCache = new Map<number, { concentrator: typeof snmpConcentrators.$inferSelect; cachedAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function getSnmpProfile(profileId: number): Promise<SnmpProfile | null> {
  const cached = snmpProfileCache.get(profileId);
  if (cached && (Date.now() - cached.cachedAt) < CACHE_TTL_MS) {
    return cached.profile;
  }
  const [profile] = await db.select().from(snmpProfiles).where(eq(snmpProfiles.id, profileId));
  if (profile) {
    snmpProfileCache.set(profileId, { profile, cachedAt: Date.now() });
  }
  return profile || null;
}

async function getEquipmentVendor(vendorId: number): Promise<typeof equipmentVendors.$inferSelect | null> {
  const cached = vendorCache.get(vendorId);
  if (cached && (Date.now() - cached.cachedAt) < CACHE_TTL_MS) {
    return cached.vendor;
  }
  const [vendor] = await db.select().from(equipmentVendors).where(eq(equipmentVendors.id, vendorId));
  if (vendor) {
    vendorCache.set(vendorId, { vendor, cachedAt: Date.now() });
  }
  return vendor || null;
}

async function getConcentrator(concentratorId: number): Promise<typeof snmpConcentrators.$inferSelect | null> {
  const cached = concentratorCache.get(concentratorId);
  if (cached && (Date.now() - cached.cachedAt) < CACHE_TTL_MS) {
    return cached.concentrator;
  }
  const [concentrator] = await db.select().from(snmpConcentrators).where(eq(snmpConcentrators.id, concentratorId));
  if (concentrator) {
    concentratorCache.set(concentratorId, { concentrator, cachedAt: Date.now() });
  }
  return concentrator || null;
}

export function invalidateConcentratorCache(concentratorId?: number): void {
  if (concentratorId) {
    concentratorCache.delete(concentratorId);
  } else {
    concentratorCache.clear();
  }
}

export function invalidateSnmpProfileCache(profileId?: number): void {
  if (profileId) {
    snmpProfileCache.delete(profileId);
  } else {
    snmpProfileCache.clear();
  }
}

// Auto-discovery: Check and fix ifIndex when SNMP collection fails
async function handleIfIndexAutoDiscovery(
  link: typeof links.$inferSelect,
  profile: SnmpProfile,
  trafficDataSuccess: boolean
): Promise<{ updated: boolean; newIfIndex?: number }> {
  const now = new Date();
  
  // Fetch fresh link data from DB to get current mismatch counter
  const [freshLink] = await db.select().from(links).where(eq(links.id, link.id));
  if (!freshLink) return { updated: false };
  
  const lastValidation = freshLink.lastIfIndexValidation;
  const mismatchCount = freshLink.ifIndexMismatchCount || 0;
  
  // If traffic collection was successful, reset mismatch counter
  if (trafficDataSuccess) {
    if (mismatchCount > 0) {
      await db.update(links).set({
        ifIndexMismatchCount: 0,
        lastIfIndexValidation: now,
      }).where(eq(links.id, link.id));
    }
    return { updated: false };
  }
  
  // Traffic collection failed - increment mismatch counter
  const newMismatchCount = mismatchCount + 1;
  
  // When snmpInterfaceIndex is null, skip threshold and attempt discovery immediately
  const ifIndexIsNull = freshLink.snmpInterfaceIndex === null || freshLink.snmpInterfaceIndex === undefined;
  
  // Only attempt auto-discovery after threshold is reached (skip threshold if ifIndex is null)
  if (!ifIndexIsNull && newMismatchCount < IFINDEX_MISMATCH_THRESHOLD) {
    await db.update(links).set({
      ifIndexMismatchCount: newMismatchCount,
    }).where(eq(links.id, link.id));
    return { updated: false };
  }
  
  if (ifIndexIsNull) {
    console.log(`[Monitor] ${link.name}: snmpInterfaceIndex is null - attempting immediate auto-discovery (bypassing cooldown)`);
  }
  
  // Check if we should skip auto-discovery (cooldown) - bypass when ifIndex is null
  if (!ifIndexIsNull && lastValidation && (now.getTime() - lastValidation.getTime()) < IFINDEX_VALIDATION_INTERVAL_MS) {
    await db.update(links).set({
      ifIndexMismatchCount: newMismatchCount,
    }).where(eq(links.id, link.id));
    return { updated: false };
  }
  
  // Attempt auto-discovery using interface name
  // Para links PPPoE com concentrador, priorizar pppoeUser (username puro)
  // Isso permite failover entre concentradores de vendors diferentes (ex: Mikrotik -> Cisco)
  // Para links corporativos, usar vlanInterface se snmpInterfaceName não existir
  let searchName = link.originalIfName || link.snmpInterfaceName;
  if (!searchName && link.authType === 'corporate' && link.vlanInterface) {
    searchName = link.vlanInterface;
  }
  
  if ((link.trafficSourceType === 'concentrator' || link.concentratorId) && link.pppoeUser) {
    searchName = link.pppoeUser;
    console.log(`[Monitor] ${link.name}: Using pppoeUser "${link.pppoeUser}" for auto-discovery (cross-vendor compatible)`);
  }
  
  // For Cisco Vi interfaces: use snmpInterfaceDescr (contains PPPoE username like "rp.farolandia")
  // Vi names are unstable and change on reconnection
  const isCiscoViForDiscovery = /^Vi\d+\.\d+$/i.test(searchName || '');
  if (isCiscoViForDiscovery && link.snmpInterfaceDescr && !/^Virtual-Access/i.test(link.snmpInterfaceDescr)) {
    searchName = link.snmpInterfaceDescr;
    console.log(`[Monitor] ${link.name}: Cisco Vi detected - using snmpInterfaceDescr "${searchName}" for auto-discovery (stable across reconnections)`);
  }
  
  // Determinar IP e perfil SNMP para busca
  // Para links com concentrador, usar o IP do concentrador
  let searchIp = link.snmpRouterIp;
  let searchProfile = profile;
  
  if (link.concentratorId) {
    const concentrator = await getConcentrator(link.concentratorId);
    if (concentrator) {
      searchIp = concentrator.ipAddress;
      // Usar perfil SNMP do concentrador se configurado
      if (concentrator.snmpProfileId) {
        const [concProfile] = await db.select().from(snmpProfiles).where(eq(snmpProfiles.id, concentrator.snmpProfileId));
        if (concProfile) {
          searchProfile = {
            id: concProfile.id,
            version: concProfile.version || '2c',
            port: concProfile.port || 161,
            community: concProfile.community,
            securityLevel: concProfile.securityLevel,
            authProtocol: concProfile.authProtocol,
            authPassword: concProfile.authPassword,
            privProtocol: concProfile.privProtocol,
            privPassword: concProfile.privPassword,
            username: concProfile.username,
            timeout: concProfile.timeout || 5000,
            retries: concProfile.retries || 1,
          };
        }
      }
    }
  }
  
  if (!searchName || !searchIp) {
    return { updated: false };
  }
  
  console.log(`[Monitor] ${link.name}: Auto-discovery triggered after ${newMismatchCount} failures. Searching for interface "${searchName}" on ${searchIp}`);
  
  const snmpProfileForSearch: SnmpProfileType = {
    id: searchProfile.id,
    version: searchProfile.version,
    port: searchProfile.port,
    community: searchProfile.community,
    securityLevel: searchProfile.securityLevel,
    authProtocol: searchProfile.authProtocol,
    authPassword: searchProfile.authPassword,
    privProtocol: searchProfile.privProtocol,
    privPassword: searchProfile.privPassword,
    username: searchProfile.username,
    timeout: searchProfile.timeout,
    retries: searchProfile.retries,
  };
  
  // Para links PPPoE com concentrador, usar lookupMultiplePppoeSessions diretamente
  // Isso funciona em todos os vendors (Mikrotik, Cisco, Huawei, etc)
  let searchResult: { found: boolean; ifIndex: number | null; ifName?: string; ifDescr?: string; ifAlias?: string; matchType?: string; ipAddress?: string } = { found: false, ifIndex: null };
  
  // Determinar pppoeUser: usar o campo direto ou extrair do snmpInterfaceName ou snmpInterfaceAlias
  let effectivePppoeUser = link.pppoeUser;
  if (!effectivePppoeUser && link.snmpInterfaceName) {
    const pppMatch = link.snmpInterfaceName.match(/<ppp(?:oe)?-([^>]+)>/i);
    if (pppMatch) {
      effectivePppoeUser = pppMatch[1];
      console.log(`[Monitor] ${link.name}: Extracted pppoeUser "${effectivePppoeUser}" from snmpInterfaceName`);
    }
  }
  if (!effectivePppoeUser && link.snmpInterfaceAlias) {
    effectivePppoeUser = link.snmpInterfaceAlias;
    console.log(`[Monitor] ${link.name}: Using snmpInterfaceAlias "${effectivePppoeUser}" as effectivePppoeUser (Cisco Vi ifAlias)`);
  }
  // Cisco Vi: ifDescr may contain PPPoE username (e.g. "rp.farolandia") but NOT when it's "Virtual-Access..." format
  if (!effectivePppoeUser && link.snmpInterfaceDescr) {
    const isCiscoViForPppoe = /^Vi\d+\.\d+$/i.test(link.snmpInterfaceName || '');
    if (isCiscoViForPppoe && !/^Virtual-Access/i.test(link.snmpInterfaceDescr)) {
      effectivePppoeUser = link.snmpInterfaceDescr;
      console.log(`[Monitor] ${link.name}: Using snmpInterfaceDescr "${effectivePppoeUser}" as effectivePppoeUser (Cisco Vi ifDescr contains PPPoE username)`);
    } else if (isCiscoViForPppoe) {
      console.log(`[Monitor] ${link.name}: Cisco Vi ifDescr is "${link.snmpInterfaceDescr}" (interface name, not PPPoE username). Attempting to derive from link name...`);
    }
  }
  // Last resort for Cisco Vi: derive PPPoE username pattern from link name
  // e.g., "RP TANCREDO - 100M" → try "rp.tancredo" as PPPoE user
  if (!effectivePppoeUser && /^Vi\d+\.\d+$/i.test(link.snmpInterfaceName || '') && link.name && link.concentratorId) {
    const namePart = link.name.split(/\s*-\s*/)[0].trim().toLowerCase();
    if (namePart && namePart.includes(' ')) {
      const derivedPppoeUser = namePart.replace(/\s+/g, '.');
      effectivePppoeUser = derivedPppoeUser;
      console.log(`[Monitor] ${link.name}: Derived effectivePppoeUser "${derivedPppoeUser}" from link name (Cisco Vi without stored PPPoE data)`);
    }
  }
  
  // Usar concentrador se: trafficSourceType='concentrator' OU (concentratorId existe e temos pppoeUser ou vlanInterface)
  const useConcentratorPppoe = (link.trafficSourceType === 'concentrator' || link.concentratorId) && link.concentratorId && effectivePppoeUser;
  const useConcentratorCorporate = link.authType === 'corporate' && link.concentratorId && link.vlanInterface;
  
  // Corporate links: use VLAN interface + ARP table lookup
  if (useConcentratorCorporate && link.vlanInterface && link.concentratorId) {
    try {
      const { lookupCorporateLinkInfo } = await import("./concentrator");
      const concentrator = await getConcentrator(link.concentratorId);
      if (concentrator) {
        console.log(`[Monitor] ${link.name}: Using Corporate/VLAN lookup for "${link.vlanInterface}" on ${concentrator.name}`);
        
        let snmpProfile = null;
        if (concentrator.snmpProfileId) {
          const [profileResult] = await db.select().from(snmpProfiles).where(eq(snmpProfiles.id, concentrator.snmpProfileId));
          snmpProfile = profileResult || null;
        }
        
        const corpInfo = await lookupCorporateLinkInfo(concentrator, link.vlanInterface, snmpProfile);
        if (corpInfo) {
          searchResult = {
            found: true,
            ifIndex: corpInfo.ifIndex,
            ifName: corpInfo.vlanInterface,
            ipAddress: corpInfo.ipAddress || undefined,
            matchType: 'corporate_vlan',
          };
          console.log(`[Monitor] ${link.name}: Corporate VLAN lookup result: ifIndex=${corpInfo.ifIndex}, IP=${corpInfo.ipAddress || 'N/A'}`);
        } else {
          console.log(`[Monitor] ${link.name}: Corporate VLAN interface "${link.vlanInterface}" not found on concentrator`);
        }
      }
    } catch (corpError: any) {
      console.error(`[Monitor] ${link.name}: Corporate lookup error: ${corpError.message}`);
    }
  }
  // PPPoE links: use PPPoE session lookup
  else if (useConcentratorPppoe && effectivePppoeUser && link.concentratorId) {
    try {
      const concentrator = await getConcentrator(link.concentratorId);
      if (concentrator) {
        const pppoeUserToSearch = effectivePppoeUser; // Already validated as non-null
        console.log(`[Monitor] ${link.name}: Using PPPoE lookup for "${pppoeUserToSearch}" on ${concentrator.name} (vendor: ${concentrator.vendor})`);
        
        let snmpProfile = null;
        if (concentrator.snmpProfileId) {
          const [profileResult] = await db.select().from(snmpProfiles).where(eq(snmpProfiles.id, concentrator.snmpProfileId));
          snmpProfile = profileResult || null;
        }
        
        const sessions = await lookupMultiplePppoeSessions(concentrator, [pppoeUserToSearch], undefined, snmpProfile);
        const session = sessions.get(pppoeUserToSearch);
        
        if (session && session.ifIndex) {
          searchResult = {
            found: true,
            ifIndex: session.ifIndex,
            ifName: session.ifName || undefined,
            ifAlias: session.ifAlias || undefined,
            matchType: 'pppoe-session',
            ipAddress: session.ipAddress || undefined,
          };
          console.log(`[Monitor] ${link.name}: PPPoE session found: ifIndex=${session.ifIndex}, IP=${session.ipAddress}, ifName=${session.ifName}`);
        }
      }
    } catch (pppoeError) {
      console.error(`[Monitor] ${link.name}: PPPoE lookup failed:`, pppoeError);
    }
  }
  
  // Fallback: use findInterfaceByName for non-PPPoE links or if PPPoE lookup failed
  if (!searchResult.found) {
    const isCiscoVi = /^Vi\d+\.\d+$/i.test(searchName || '');
    // For Cisco Vi, use ifAlias or ifDescr as stable search identifier (Vi names are unstable)
    const searchAlias = link.snmpInterfaceAlias || (isCiscoVi ? link.snmpInterfaceDescr : undefined) || undefined;
    
    if (isCiscoVi && searchAlias) {
      console.log(`[Monitor] ${link.name}: Cisco Vi interface detected ("${searchName}"). Searching by description/alias "${searchAlias}" instead (Vi names change on reconnection)`);
    }
    
    const ifResult = await findInterfaceByName(
      searchIp,
      snmpProfileForSearch,
      isCiscoVi && searchAlias ? searchAlias : searchName,
      link.snmpInterfaceDescr,
      searchAlias
    );
    searchResult = {
      found: ifResult.found,
      ifIndex: ifResult.ifIndex,
      ifName: ifResult.ifName || undefined,
      ifDescr: ifResult.ifDescr || undefined,
      ifAlias: ifResult.ifAlias || undefined,
      matchType: ifResult.matchType || undefined,
    };
    
    if (!searchResult.found && isCiscoVi) {
      // Last resort for Cisco Vi: discover all interfaces on the concentrator and 
      // find Vi interfaces whose ifAlias matches the link's pppoeUser
      if (link.concentratorId && (link.pppoeUser || !searchAlias)) {
        try {
          const concentrator = await getConcentrator(link.concentratorId);
          if (concentrator) {
            console.log(`[Monitor] ${link.name}: Cisco Vi "${searchName}" not found. Scanning all interfaces on ${concentrator.name} to find matching Vi by alias...`);
            
            let scanProfile = snmpProfileForSearch;
            if (concentrator.snmpProfileId) {
              const [concProfile] = await db.select().from(snmpProfiles).where(eq(snmpProfiles.id, concentrator.snmpProfileId));
              if (concProfile) {
                scanProfile = {
                  id: concProfile.id,
                  version: concProfile.version || '2c',
                  port: concProfile.port || 161,
                  community: concProfile.community,
                  securityLevel: concProfile.securityLevel,
                  authProtocol: concProfile.authProtocol,
                  authPassword: concProfile.authPassword,
                  privProtocol: concProfile.privProtocol,
                  privPassword: concProfile.privPassword,
                  username: concProfile.username,
                  timeout: concProfile.timeout || 5000,
                  retries: concProfile.retries || 1,
                };
              }
            }
            
            const allInterfaces = await discoverInterfaces(concentrator.ipAddress, scanProfile);
            
            // Filter Vi interfaces with aliases
            const viCandidates = allInterfaces.filter(iface => 
              /^Vi\d+\.\d+$/i.test(iface.ifName || '') && iface.ifAlias && iface.ifAlias.trim()
            );
            
            console.log(`[Monitor] ${link.name}: Found ${viCandidates.length} Vi interfaces with aliases on concentrator (total: ${allInterfaces.length})`);
            
            if (viCandidates.length > 0) {
              const searchTerms: string[] = [];
              if (link.pppoeUser) searchTerms.push(link.pppoeUser.toLowerCase());
              // Try to derive PPPoE username from link name (e.g., "RP TANCREDO - 100M" → "rp.tancredo")
              if (!link.pppoeUser && link.name) {
                // Extract meaningful part before " - " separator (e.g., "RP TANCREDO" from "RP TANCREDO - 100M")
                const namePart = link.name.split(/\s*-\s*/)[0].trim().toLowerCase();
                if (namePart) {
                  // Try "rp.tancredo" pattern (replace spaces with dots)
                  const dotPattern = namePart.replace(/\s+/g, '.');
                  searchTerms.push(dotPattern);
                  // Also try just the second word if format is "PREFIX NAME" (e.g., "RP TANCREDO" → "tancredo")
                  const words = namePart.split(/\s+/);
                  if (words.length >= 2) {
                    searchTerms.push(words.slice(1).join('.'));
                  }
                }
              }
              console.log(`[Monitor] ${link.name}: Cisco Vi alias scan search terms: [${searchTerms.join(', ')}]`);
              
              let bestMatch: typeof viCandidates[0] | null = null;
              for (const candidate of viCandidates) {
                const aliasLower = (candidate.ifAlias || '').toLowerCase();
                for (const term of searchTerms) {
                  if (aliasLower === term || aliasLower.includes(term) || term.includes(aliasLower)) {
                    bestMatch = candidate;
                    break;
                  }
                }
                if (bestMatch) break;
              }
              
              if (bestMatch) {
                console.log(`[Monitor] ${link.name}: Found Vi interface via alias scan: ${bestMatch.ifName} (alias: "${bestMatch.ifAlias}", ifIndex: ${bestMatch.ifIndex})`);
                searchResult = {
                  found: true,
                  ifIndex: bestMatch.ifIndex,
                  ifName: bestMatch.ifName || undefined,
                  ifAlias: bestMatch.ifAlias || undefined,
                  matchType: 'cisco-vi-alias-scan',
                };
                const aliasScanUpdate: Record<string, any> = {
                  snmpInterfaceAlias: bestMatch.ifAlias || null,
                };
                if (!link.pppoeUser && bestMatch.ifAlias) {
                  aliasScanUpdate.pppoeUser = bestMatch.ifAlias;
                }
                await db.update(links).set(aliasScanUpdate).where(eq(links.id, link.id));
                console.log(`[Monitor] ${link.name}: Stored pppoeUser="${bestMatch.ifAlias}" and ifAlias for future PPPoE lookups`);
              } else {
                console.log(`[Monitor] ${link.name}: No matching Vi interface found via alias scan. Search terms: [${searchTerms.join(', ')}]. Candidates: ${viCandidates.slice(0, 5).map(c => `${c.ifName}(${c.ifAlias})`).join(', ')}${viCandidates.length > 5 ? '...' : ''}`);
              }
            }
          }
        } catch (scanError: any) {
          console.error(`[Monitor] ${link.name}: ifAlias scan failed: ${scanError.message}`);
        }
      } else if (!searchAlias) {
        console.log(`[Monitor] ${link.name}: Cisco Vi interface "${searchName}" not found. No pppoeUser or ifAlias stored - cannot track across reconnections.`);
      }
    }
  }
  
  if (searchResult.found && searchResult.ifIndex !== null) {
    const oldIfIndex = link.snmpInterfaceIndex;
    const newIfIndex = searchResult.ifIndex;
    
    if (oldIfIndex !== newIfIndex) {
      console.log(`[Monitor] ${link.name}: ifIndex changed from ${oldIfIndex} to ${newIfIndex} (auto-discovered via ${searchResult.matchType}). New ifName: ${searchResult.ifName || 'N/A'}, ifAlias: ${searchResult.ifAlias || 'N/A'}`);
      lastIfNameVerification.delete(link.id);
      
      const updateData: Record<string, any> = {
        snmpInterfaceIndex: newIfIndex,
        snmpInterfaceName: searchResult.ifName || link.snmpInterfaceName,
        snmpInterfaceDescr: searchResult.ifDescr || link.snmpInterfaceDescr,
        snmpInterfaceAlias: searchResult.ifAlias || link.snmpInterfaceAlias,
        originalIfName: link.originalIfName || link.snmpInterfaceName,
        ifIndexMismatchCount: 0,
        lastIfIndexValidation: now,
      };
      
      // Armazenar pppoeUser descoberto para futuras buscas diretas
      // Prioridade: ifAlias da sessão > effectivePppoeUser derivado > pppoeUser existente
      if (!link.pppoeUser && searchResult.ifAlias) {
        updateData.pppoeUser = searchResult.ifAlias;
        console.log(`[Monitor] ${link.name}: Armazenando pppoeUser "${searchResult.ifAlias}" descoberto via ${searchResult.matchType}`);
      } else if (!link.pppoeUser && effectivePppoeUser) {
        updateData.pppoeUser = effectivePppoeUser;
        console.log(`[Monitor] ${link.name}: Armazenando pppoeUser "${effectivePppoeUser}" (derivado) após discovery bem-sucedido`);
      }
      
      // Se já temos IP da sessão PPPoE, atualizar monitoredIp
      if (searchResult.ipAddress) {
        updateData.monitoredIp = searchResult.ipAddress;
        console.log(`[Monitor] ${link.name}: IP atualizado para ${searchResult.ipAddress}`);
      }
      
      await db.update(links).set(updateData).where(eq(links.id, link.id));
      
      // Create event for the ifIndex change
      await db.insert(events).values({
        linkId: link.id,
        clientId: link.clientId,
        type: "info",
        title: `Interface atualizada em ${link.name}`,
        description: `O índice da interface SNMP foi atualizado automaticamente de ${oldIfIndex} para ${newIfIndex} (${searchResult.matchType}). Interface: ${searchResult.ifName || searchName}`,
        timestamp: now,
        resolved: true,
      });
      
      return { updated: true, newIfIndex };
    } else {
      // Interface found with same ifIndex - reset counter but don't create event
      // This means the SNMP collection failed for another reason (device unreachable, etc)
      console.log(`[Monitor] ${link.name}: Interface found with same ifIndex ${oldIfIndex}. Resetting mismatch counter.`);
      await db.update(links).set({
        ifIndexMismatchCount: 0,
        lastIfIndexValidation: now,
      }).where(eq(links.id, link.id));
      return { updated: false };
    }
  } else {
    // Interface not found on primary concentrator - try backup if configured
    console.log(`[Monitor] ${link.name}: Interface "${searchName}" NÃO ENCONTRADA no concentrador. trafficSourceType=${link.trafficSourceType}, concentratorId=${link.concentratorId}, pppoeUser=${link.pppoeUser}, effectivePppoeUser=${effectivePppoeUser}`);
    
    // Usar concentrador se temos concentratorId e pppoeUser ou vlanInterface (corporate)
    const hasPppoeForBackup = link.concentratorId && effectivePppoeUser;
    const hasCorporateForBackup = link.authType === 'corporate' && link.concentratorId && link.vlanInterface;
    
    if (hasPppoeForBackup || hasCorporateForBackup) {
      const currentConcentrator = await getConcentrator(link.concentratorId!);
      
      console.log(`[Monitor] ${link.name}: Concentrador atual: ${currentConcentrator?.name || 'N/A'}, backupId=${currentConcentrator?.backupConcentratorId || 'NÃO CONFIGURADO'}`);
      
      if (!currentConcentrator?.backupConcentratorId || currentConcentrator.backupConcentratorId === currentConcentrator.id) {
        console.log(`[Monitor] ${link.name}: ⚠️ Concentrador "${currentConcentrator?.name}" NÃO tem backup configurado. Se a sessão PPPoE migrou para outro concentrador, o sistema não consegue descobrir automaticamente. Configure o campo "Concentrador Backup" no cadastro do concentrador.`);
      }
      
      if (currentConcentrator?.backupConcentratorId && currentConcentrator.backupConcentratorId !== currentConcentrator.id) {
        console.log(`[Monitor] ${link.name}: Interface não encontrada no concentrador principal. Tentando backup...`);
        
        // Get backup concentrator
        const backupConcentrator = await getConcentrator(currentConcentrator.backupConcentratorId);
        
        console.log(`[Monitor] ${link.name}: Backup concentrador: ${backupConcentrator?.name || 'NÃO ENCONTRADO'}, isActive=${backupConcentrator?.isActive}, backupId=${backupConcentrator?.backupConcentratorId}`);
        
        // Allow mutual backup (A->B, B->A) - this is a valid redundancy pattern
        // The cyclic check was too restrictive, preventing valid failover scenarios
        if (backupConcentrator && backupConcentrator.isActive) {
          // Get backup concentrator's SNMP profile
          let backupProfile = searchProfile;
          if (backupConcentrator.snmpProfileId) {
            const [backupProfileResult] = await db.select().from(snmpProfiles).where(eq(snmpProfiles.id, backupConcentrator.snmpProfileId));
            if (backupProfileResult) {
              backupProfile = {
                id: backupProfileResult.id,
                version: backupProfileResult.version || '2c',
                port: backupProfileResult.port || 161,
                community: backupProfileResult.community,
                securityLevel: backupProfileResult.securityLevel,
                authProtocol: backupProfileResult.authProtocol,
                authPassword: backupProfileResult.authPassword,
                privProtocol: backupProfileResult.privProtocol,
                privPassword: backupProfileResult.privPassword,
                username: backupProfileResult.username,
                timeout: backupProfileResult.timeout || 5000,
                retries: backupProfileResult.retries || 1,
              };
            }
          }
          
          try {
            // Try PPPoE lookup on backup for PPPoE links
            if (hasPppoeForBackup && effectivePppoeUser) {
              console.log(`[Monitor] ${link.name}: Buscando PPPoE "${effectivePppoeUser}" no backup ${backupConcentrator.name} (${backupConcentrator.ipAddress})`);
              
              const pppoeUserForBackup = effectivePppoeUser;
              const sessions = await lookupMultiplePppoeSessions(backupConcentrator, [pppoeUserForBackup], undefined, backupProfile as any);
              const session = sessions.get(pppoeUserForBackup);
              
              if (session && session.ifIndex) {
                console.log(`[Monitor] ${link.name}: PPPoE encontrado no backup! ifIndex=${session.ifIndex}, IP=${session.ipAddress}`);
                
                const updateData: Record<string, any> = {
                  concentratorId: backupConcentrator.id,
                  snmpInterfaceIndex: session.ifIndex,
                  snmpInterfaceName: session.ifName || link.snmpInterfaceName,
                  snmpInterfaceDescr: session.ifAlias || link.snmpInterfaceDescr,
                  ifIndexMismatchCount: 0,
                  lastIfIndexValidation: now,
                };
                
                if (session.ipAddress) {
                  updateData.monitoredIp = session.ipAddress;
                }
                
                await db.update(links).set(updateData).where(eq(links.id, link.id));
                
                await db.insert(events).values({
                  linkId: link.id,
                  clientId: link.clientId,
                  type: "info",
                  title: `Failover de concentrador em ${link.name}`,
                  description: `Link migrou de "${currentConcentrator.name}" para backup "${backupConcentrator.name}". Nova interface: ${session.ifName || 'N/A'}, IP: ${session.ipAddress || 'N/A'}`,
                  timestamp: now,
                  resolved: true,
                });
                
                return { updated: true, newIfIndex: session.ifIndex };
              }
            }
            
            // Try Corporate VLAN/ARP lookup on backup for corporate links
            if (hasCorporateForBackup && link.vlanInterface) {
              console.log(`[Monitor] ${link.name}: Buscando VLAN "${link.vlanInterface}" no backup ${backupConcentrator.name} (${backupConcentrator.ipAddress})`);
              
              const { lookupCorporateLinkInfo } = await import("./concentrator");
              const corpInfo = await lookupCorporateLinkInfo(backupConcentrator, link.vlanInterface, backupProfile as any);
              
              if (corpInfo && corpInfo.ifIndex) {
                console.log(`[Monitor] ${link.name}: VLAN encontrada no backup! ifIndex=${corpInfo.ifIndex}, IP=${corpInfo.ipAddress}`);
                
                const updateData: Record<string, any> = {
                  concentratorId: backupConcentrator.id,
                  snmpInterfaceIndex: corpInfo.ifIndex,
                  snmpInterfaceName: corpInfo.vlanInterface || link.snmpInterfaceName,
                  ifIndexMismatchCount: 0,
                  lastIfIndexValidation: now,
                };
                
                if (corpInfo.ipAddress) {
                  updateData.monitoredIp = corpInfo.ipAddress;
                }
                
                await db.update(links).set(updateData).where(eq(links.id, link.id));
                
                await db.insert(events).values({
                  linkId: link.id,
                  clientId: link.clientId,
                  type: "info",
                  title: `Failover de concentrador em ${link.name}`,
                  description: `Link corporativo migrou de "${currentConcentrator.name}" para backup "${backupConcentrator.name}". Nova interface: ${corpInfo.vlanInterface || 'N/A'}, IP: ${corpInfo.ipAddress || 'N/A'}`,
                  timestamp: now,
                  resolved: true,
                });
                
                return { updated: true, newIfIndex: corpInfo.ifIndex };
              }
            }
          } catch (backupError) {
            console.error(`[Monitor] ${link.name}: Erro ao buscar no concentrador backup:`, backupError);
          }
        }
      }
    }
    
    // Interface not found on primary or backup - create warning event
    let backupInfo = "";
    if (hasPppoeForBackup || hasCorporateForBackup) {
      const conc = await getConcentrator(link.concentratorId!);
      if (!conc?.backupConcentratorId || conc.backupConcentratorId === conc.id) {
        backupInfo = ` Concentrador "${conc?.name}" não tem backup configurado - configure para permitir failover automático.`;
      } else {
        const backup = await getConcentrator(conc.backupConcentratorId);
        backupInfo = ` Também buscou no backup "${backup?.name || 'N/A'}" sem sucesso.`;
      }
    }
    console.log(`[Monitor] ${link.name}: Could not auto-discover interface "${searchName}".${backupInfo}`);
    
    await db.update(links).set({
      ifIndexMismatchCount: newMismatchCount,
      lastIfIndexValidation: now,
    }).where(eq(links.id, link.id));
    
    // Only create event once per validation interval
    await db.insert(events).values({
      linkId: link.id,
      clientId: link.clientId,
      type: "warning",
      title: `Interface não encontrada em ${link.name}`,
      description: `A interface SNMP "${searchName}" (ifIndex: ${link.snmpInterfaceIndex}) não foi encontrada no equipamento.${backupInfo} Verifique a configuração do link.`,
      timestamp: now,
      resolved: false,
    });
  }
  
  return { updated: false };
}

export async function collectLinkMetrics(link: typeof links.$inferSelect): Promise<{
  latency: number;
  packetLoss: number;
  downloadMbps: number;
  uploadMbps: number;
  cpuUsage: number;
  memoryUsage: number;
  status: string;
  failureReason: string | null;
  opticalSignal: OpticalSignalData | null;
}> {
  const ipToMonitor = link.monitoredIp || link.snmpRouterIp || link.address;

  // Links L2 não têm IP para monitorar - status vem da porta do switch
  const isL2Link = (link as any).isL2Link === true;
  
  // Para links L2, não fazer ping - status será determinado pelo sinal óptico/porta
  let pingResult: PingResult;
  
  // Variável para armazenar o status da porta para links L2
  let l2PortStatus: { operStatus: string; adminStatus: string } | null = null;
  
  if (isL2Link) {
    // Links L2: latência e perda de pacotes não se aplicam
    pingResult = { latency: 0, packetLoss: 0, status: "operational", failureReason: null, success: true };
    console.log(`[Monitor] ${link.name}: Link L2 - ignorando ping (sem IP monitorado)`);
  } else {
    pingResult = await pingHost(ipToMonitor);
  }

  let downloadMbps = 0;
  let uploadMbps = 0;
  let cpuUsage = 0;
  let memoryUsage = 0;

  // Determine traffic source: manual (default), concentrator, or accessPoint
  // For accessPoint mode, use the switch's IP and interface for traffic collection
  let trafficSourceIp = link.snmpRouterIp;
  let trafficSourceIfIndex = link.snmpInterfaceIndex;
  let trafficSourceProfileId = link.snmpProfileId;
  
  if (link.trafficSourceType === 'accessPoint' && link.accessPointId) {
    const accessPointSwitch = await db.select().from(switches).where(eq(switches.id, link.accessPointId)).limit(1);
    if (accessPointSwitch.length > 0) {
      const sw = accessPointSwitch[0];
      trafficSourceIp = sw.ipAddress;
      trafficSourceProfileId = sw.snmpProfileId;
      trafficSourceIfIndex = link.accessPointInterfaceIndex || null;
      console.log(`[Monitor] ${link.name}: Using access point (${sw.name}) for traffic collection. IP: ${trafficSourceIp}, ifIndex: ${trafficSourceIfIndex}`);
    }
  } else if (link.concentratorId) {
    // Use concentrator for traffic collection when concentratorId is set
    // This handles both trafficSourceType='concentrator' and 'manual' with concentrator
    // Cisco Vi interfaces (Vi1.x) exist on the concentrator, not the CPE
    const concentrator = await getConcentrator(link.concentratorId);
    if (concentrator) {
      const isCiscoViInterface = /^Vi\d+\.\d+$/i.test(link.snmpInterfaceName || '');
      if (isCiscoViInterface || link.trafficSourceType === 'concentrator') {
        trafficSourceIp = concentrator.ipAddress;
        if (concentrator.snmpProfileId) {
          trafficSourceProfileId = concentrator.snmpProfileId;
        }
        console.log(`[Monitor] ${link.name}: Using concentrator (${concentrator.name}) for traffic collection (Cisco Vi=${isCiscoViInterface}, sourceType=${link.trafficSourceType}). IP: ${trafficSourceIp}, ifIndex: ${trafficSourceIfIndex}, profileId: ${trafficSourceProfileId}`);
      }
    }
  }
  
  // Fallback: quando snmpProfileId é null mas concentratorId existe, usar perfil SNMP do concentrador
  if (!trafficSourceProfileId && link.concentratorId && link.trafficSourceType !== 'accessPoint') {
    const concentrator = await getConcentrator(link.concentratorId);
    if (concentrator && concentrator.snmpProfileId) {
      trafficSourceProfileId = concentrator.snmpProfileId;
      if (!trafficSourceIp) {
        trafficSourceIp = concentrator.ipAddress;
      }
      console.log(`[Monitor] ${link.name}: snmpProfileId null - using concentrator ${concentrator.name} SNMP profile (${concentrator.snmpProfileId}) as fallback. IP: ${trafficSourceIp}`);
    }
  }

  if (!trafficSourceProfileId || !trafficSourceIp) {
    console.log(`[Monitor] ${link.name}: Cannot collect traffic - missing trafficSourceIp=${trafficSourceIp}, profileId=${trafficSourceProfileId}, ifIndex=${trafficSourceIfIndex}, sourceType=${link.trafficSourceType}, concentratorId=${link.concentratorId}`);
  }
  
  if (trafficSourceProfileId && trafficSourceIp) {
    const profile = await getSnmpProfile(trafficSourceProfileId);

    if (profile) {
      let trafficDataSuccess = false;
      
      if (trafficSourceIfIndex) {
        const trafficData = await getInterfaceTraffic(
          trafficSourceIp,
          profile,
          trafficSourceIfIndex
        );

        trafficDataSuccess = trafficData !== null;
        
        if (trafficData) {
          const previousData = previousTrafficData.get(link.id);

          if (previousData) {
            const bandwidth = calculateBandwidth(trafficData, previousData);
            downloadMbps = bandwidth.downloadMbps;
            uploadMbps = bandwidth.uploadMbps;
          } else {
            console.log(`[Monitor] ${link.name}: First traffic reading stored (need 2 readings to calculate bandwidth). inOctets=${trafficData.inOctets}, outOctets=${trafficData.outOctets}`);
          }

          previousTrafficData.set(link.id, trafficData);
        } else {
          console.log(`[Monitor] ${link.name}: SNMP traffic collection returned null. IP=${trafficSourceIp}, ifIndex=${trafficSourceIfIndex}, profileId=${trafficSourceProfileId}`);
        }
      } else {
        console.log(`[Monitor] ${link.name}: snmpInterfaceIndex is null - cannot collect traffic. Will attempt auto-discovery.`);
      }
      
      {
        if (trafficSourceIfIndex && link.snmpInterfaceName && trafficSourceIp) {
          const lastVerify = lastIfNameVerification.get(link.id) || 0;
          const nowMs = Date.now();
          if (nowMs - lastVerify >= IFNAME_VERIFY_INTERVAL_MS) {
            lastIfNameVerification.set(link.id, nowMs);
            const verification = await verifyInterfaceAtIndex(
              trafficSourceIp,
              profile,
              trafficSourceIfIndex,
              link.snmpInterfaceName
            );
            if (verification.actualAlias && !link.snmpInterfaceAlias) {
              const aliasUpdate: Record<string, any> = { snmpInterfaceAlias: verification.actualAlias };
              if (!link.pppoeUser) {
                aliasUpdate.pppoeUser = verification.actualAlias;
                console.log(`[Monitor] ${link.name}: Storing discovered ifAlias "${verification.actualAlias}" as pppoeUser and snmpInterfaceAlias for ifIndex ${trafficSourceIfIndex}`);
              } else {
                console.log(`[Monitor] ${link.name}: Storing discovered ifAlias "${verification.actualAlias}" for ifIndex ${trafficSourceIfIndex}`);
              }
              await db.update(links).set(aliasUpdate).where(eq(links.id, link.id));
            }
            if (!verification.matches && verification.actualName !== null) {
              console.log(`[Monitor] ${link.name}: ifIndex ${trafficSourceIfIndex} name mismatch! Expected "${link.snmpInterfaceName}", found "${verification.actualName}" (alias: "${verification.actualAlias || 'none'}"). Clearing ifIndex and forcing immediate auto-discovery.`);
              trafficDataSuccess = false;
              previousTrafficData.delete(link.id);
              trafficSourceIfIndex = null;
              await db.update(links).set({ 
                snmpInterfaceIndex: null,
                ifIndexMismatchCount: IFINDEX_MISMATCH_THRESHOLD + 1 
              }).where(eq(links.id, link.id));
            } else if (!verification.matches && verification.actualName === null) {
              console.log(`[Monitor] ${link.name}: ifIndex ${trafficSourceIfIndex} no longer exists (no ifName/ifDescr returned). Clearing ifIndex and forcing immediate auto-discovery.`);
              trafficDataSuccess = false;
              previousTrafficData.delete(link.id);
              trafficSourceIfIndex = null;
              await db.update(links).set({ 
                snmpInterfaceIndex: null,
                ifIndexMismatchCount: IFINDEX_MISMATCH_THRESHOLD + 1 
              }).where(eq(links.id, link.id));
            } else if (verification.matches) {
              console.log(`[Monitor] ${link.name}: ifIndex ${trafficSourceIfIndex} verified OK - "${verification.actualName}" matches "${link.snmpInterfaceName}"`);
            }
          }
        }
        
        const isLinkOffline = !pingResult.success || pingResult.packetLoss >= 50;
        const canDoPppoeDiscovery = (link.trafficSourceType === 'concentrator' || link.concentratorId) && link.concentratorId && (link.pppoeUser || link.snmpInterfaceName);
        const canDoCorporateDiscovery = link.authType === 'corporate' && link.concentratorId && link.vlanInterface;
        const canDoConcentratorDiscovery = canDoPppoeDiscovery || canDoCorporateDiscovery;
        
        const hasInterfaceForDiscovery = link.snmpInterfaceName || (link.authType === 'corporate' && link.vlanInterface) || ((link.trafficSourceType === 'concentrator' || link.concentratorId) && link.pppoeUser);
        if (hasInterfaceForDiscovery && link.trafficSourceType !== 'accessPoint' && (!isLinkOffline || canDoConcentratorDiscovery)) {
          const discoveryResult = await handleIfIndexAutoDiscovery(link, profile, trafficDataSuccess);
          
          if (discoveryResult.updated && discoveryResult.newIfIndex) {
            const retryTrafficData = await getInterfaceTraffic(
              trafficSourceIp!,
              profile,
              discoveryResult.newIfIndex
            );
            
            if (retryTrafficData) {
              const previousData = previousTrafficData.get(link.id);
              if (previousData) {
                const bandwidth = calculateBandwidth(retryTrafficData, previousData);
                downloadMbps = bandwidth.downloadMbps;
                uploadMbps = bandwidth.uploadMbps;
              }
              previousTrafficData.set(link.id, retryTrafficData);
            }
          }
        }
      }

      // Collect CPU and memory usage - determine which OIDs to use
      let cpuOid: string | null = null;
      let memoryConfig: MemoryOids = {};

      // Priority: custom OIDs > vendor OIDs
      if (link.customCpuOid) {
        cpuOid = link.customCpuOid;
      }
      if (link.customMemoryOid) {
        memoryConfig.memoryOid = link.customMemoryOid;
      }

      // If no custom OIDs, try vendor OIDs
      let cpuDivisor = 1;
      if ((!cpuOid || !memoryConfig.memoryOid) && link.equipmentVendorId) {
        const vendor = await getEquipmentVendor(link.equipmentVendorId);
        console.log(`[Monitor] ${link.name} - vendorId: ${link.equipmentVendorId}, vendor: ${vendor?.name}, cpuOid: ${vendor?.cpuOid}, cpuDivisor: ${vendor?.cpuDivisor}, memOid: ${vendor?.memoryOid}, memTotalOid: ${vendor?.memoryTotalOid}, memUsedOid: ${vendor?.memoryUsedOid}`);
        if (vendor) {
          if (!cpuOid && vendor.cpuOid) {
            cpuOid = vendor.cpuOid;
            cpuDivisor = vendor.cpuDivisor ?? 1;
          }
          if (!memoryConfig.memoryOid) {
            memoryConfig = {
              memoryOid: vendor.memoryOid,
              memoryTotalOid: vendor.memoryTotalOid,
              memoryUsedOid: vendor.memoryUsedOid,
              memoryIsPercentage: vendor.memoryIsPercentage ?? true,
            };
          }
        }
      }

      const hasMemoryOids = memoryConfig.memoryOid || (memoryConfig.memoryTotalOid && memoryConfig.memoryUsedOid);
      // CPU/Memory always collected from link's router IP (not traffic source)
      const cpuMemIp = link.snmpRouterIp;
      if ((cpuOid || hasMemoryOids) && cpuMemIp) {
        console.log(`[Monitor] ${link.name} - Coletando CPU/Mem via SNMP: ${cpuMemIp}, cpuOid: ${cpuOid}, cpuDivisor: ${cpuDivisor}, memConfig: ${JSON.stringify(memoryConfig)}`);
        const systemResources = await getSystemResources(cpuMemIp, profile, cpuOid, memoryConfig, cpuDivisor);
        console.log(`[Monitor] ${link.name} - Resultado CPU/Mem: cpu=${systemResources?.cpuUsage}, mem=${systemResources?.memoryUsage}`);
        if (systemResources) {
          cpuUsage = systemResources.cpuUsage;
          memoryUsage = systemResources.memoryUsage;
        }
      } else {
        console.log(`[Monitor] ${link.name} - Sem OIDs para CPU/Mem. vendorId: ${link.equipmentVendorId}, customCpu: ${link.customCpuOid}, customMem: ${link.customMemoryOid}`);
      }
    }
  }

  let status = "operational";
  let failureReason: string | null = null;
  
  // Links L2: status determinado depois, baseado no sinal óptico/tráfego
  // Links não-L2: determinação preliminar por ping (pode ser sobrescrita por óptico/tráfego depois)
  let pingBasedOffline = false;
  if (!isL2Link) {
    const pingFailed = !pingResult.success || pingResult.packetLoss >= 50;
    
    if (pingFailed && link.icmpBlocked) {
      let tcpSuccess = false;
      const tcpPort = Math.max(1, Math.min(65535, link.tcpCheckPort || 80));
      
      if (ipToMonitor) {
        const tcpResult = await checkTcpPort(ipToMonitor, tcpPort);
        if (tcpResult.success) {
          tcpSuccess = true;
          pingResult.latency = tcpResult.responseTimeMs;
          pingResult.packetLoss = 0;
          pingResult.success = true;
          console.log(`[Monitor] ${link.name}: ICMP blocked, TCP port ${tcpPort} responded in ${tcpResult.responseTimeMs}ms - link is UP`);
        }
      }
      
      if (!tcpSuccess) {
        const hasTraffic = downloadMbps > 0 || uploadMbps > 0;
        if (hasTraffic) {
          pingResult.latency = 0;
          pingResult.packetLoss = 0;
          pingResult.success = true;
          console.log(`[Monitor] ${link.name}: ICMP blocked, TCP failed/skipped, but SNMP traffic detected (DL=${downloadMbps.toFixed(2)}Mbps) - link is UP`);
        } else {
          console.log(`[Monitor] ${link.name}: ICMP blocked, TCP failed/skipped, no SNMP traffic - link is OFFLINE`);
        }
      }
    }
    
    if (!pingResult.success || pingResult.packetLoss >= 50) {
      status = "offline";
      pingBasedOffline = true;
      if (pingResult.failureReason) {
        failureReason = pingResult.failureReason;
      } else if (pingResult.packetLoss >= 100) {
        failureReason = "no_response";
      } else if (pingResult.packetLoss >= 50) {
        failureReason = "packet_loss";
      }
    } else if (pingResult.latency > link.latencyThreshold || pingResult.packetLoss > link.packetLossThreshold) {
      status = "degraded";
    }
  }

  // Coleta de sinal óptico (se habilitado e configurado)
  let opticalSignal: OpticalSignalData | null = null;
  if (link.opticalMonitoringEnabled && link.oltId) {
    // Verificar se temos os dados da ONU (slot, port, onuId)
    const hasSlotPort = link.slotOlt !== null && link.portOlt !== null;
    const hasOnuId = link.onuId !== null && link.onuId !== '';
    
    // Parse onuId de forma inteligente - aceita formatos como "14", "1/1/8/14", "slot/1/8/14"
    let parsedOnuId = NaN;
    if (hasOnuId) {
      const onuIdStr = link.onuId!.trim();
      // Tenta extrair o último número se for um caminho com barras
      if (onuIdStr.includes('/')) {
        const parts = onuIdStr.split('/').filter(p => p.trim() !== '');
        const lastPart = parts[parts.length - 1];
        parsedOnuId = parseInt(lastPart, 10);
      } else {
        parsedOnuId = parseInt(onuIdStr, 10);
      }
    }
    
    if (!hasSlotPort || !hasOnuId || isNaN(parsedOnuId) || parsedOnuId < 0) {
      console.log(`[Monitor] ${link.name} - Óptico: falta ONU params (slot=${link.slotOlt}, port=${link.portOlt}, onuId=${link.onuId}, parsed=${parsedOnuId})`);
    } else {
      // Buscar OLT com vendor e perfil SNMP
      const olt = await db.select().from(olts).where(eq(olts.id, link.oltId)).limit(1);
      
      if (olt.length > 0 && olt[0].snmpProfileId && olt[0].vendor) {
        const oltVendorSlug = olt[0].vendor;
        
        // Buscar OIDs do fabricante da OLT (pelo slug)
        const vendorBySlug = await db.select().from(equipmentVendors)
          .where(eq(equipmentVendors.slug, oltVendorSlug))
          .limit(1);
        
        if (vendorBySlug.length > 0) {
          let rxOid = vendorBySlug[0].opticalRxOid || null;
          let txOid = vendorBySlug[0].opticalTxOid || null;
          const oltRxOid = vendorBySlug[0].opticalOltRxOid || null;
          
          let distanceOid: string | null = null;
          
          // Fallback: se OIDs não configurados no fabricante, usar OIDs hardcoded do OPTICAL_OIDS
          if (!rxOid && !txOid && !oltRxOid) {
            const { OPTICAL_OIDS } = await import("./snmp");
            const normalizedSlug = oltVendorSlug.toLowerCase().trim();
            const fallbackOids = (OPTICAL_OIDS as any)[normalizedSlug];
            if (fallbackOids) {
              rxOid = fallbackOids.onuRxPower || null;
              txOid = fallbackOids.onuTxPower || null;
              distanceOid = fallbackOids.onuDistance || null;
              console.log(`[Monitor] ${link.name} - Óptico: usando OIDs padrão para '${oltVendorSlug}' (RX=${rxOid}, TX=${txOid}, Dist=${distanceOid})`);
            } else {
              console.log(`[Monitor] ${link.name} - Óptico: OIDs não configurados para fabricante '${oltVendorSlug}' (${vendorBySlug[0].name}). Configure em Admin → Fabricantes.`);
            }
          } else {
            // Mesmo com OIDs do fabricante, buscar OID de distância do hardcoded se disponível
            const { OPTICAL_OIDS } = await import("./snmp");
            const normalizedSlug = oltVendorSlug.toLowerCase().trim();
            const fallbackOids = (OPTICAL_OIDS as any)[normalizedSlug];
            if (fallbackOids?.onuDistance) {
              distanceOid = fallbackOids.onuDistance;
            }
          }
          
          if (rxOid || txOid || oltRxOid) {
            const oltProfile = await getSnmpProfile(olt[0].snmpProfileId);
            if (oltProfile) {
              const onuParams = {
                slot: link.slotOlt!,
                port: link.portOlt!,
                onuId: parsedOnuId,
              };
              
              console.log(`[Monitor] ${link.name} - Óptico: coletando via OLT ${olt[0].name} (${oltVendorSlug}) slot=${onuParams.slot} port=${onuParams.port} onu=${onuParams.onuId}`);
              
              opticalSignal = await getOpticalSignal(
                olt[0].ipAddress,
                oltProfile,
                oltVendorSlug,
                onuParams,
                rxOid,
                txOid,
                oltRxOid,
                distanceOid
              );
              
              if (opticalSignal) {
                const hasValues = opticalSignal.rxPower !== null || opticalSignal.txPower !== null || opticalSignal.oltRxPower !== null;
                if (hasValues) {
                  const distLog = opticalSignal.onuDistance != null ? ` Dist=${opticalSignal.onuDistance}m` : '';
                  console.log(`[Monitor] ${link.name} - Óptico OK: RX=${opticalSignal.rxPower}dBm TX=${opticalSignal.txPower}dBm OLT_RX=${opticalSignal.oltRxPower}dBm${distLog}`);
                  
                  if (opticalSignal.onuDistance != null) {
                    await db.update(links).set({ zabbixOnuDistance: String(opticalSignal.onuDistance) }).where(eq(links.id, link.id));
                  }
                  
                  // Fallback para Zabbix: se OLT RX não veio via SNMP e temos serial da ONU, consultar Zabbix
                  // Usar equipmentSerialNumber (serial da ONU) ao invés de onuSearchString (comando CLI)
                  const onuSerial = link.equipmentSerialNumber || null;
                  if (opticalSignal.oltRxPower === null && onuSerial) {
                    console.log(`[Monitor] ${link.name} - Óptico: OLT_RX vazio, tentando fallback Zabbix por serial ${onuSerial}...`);
                    const zabbixOlt = await db.select().from(olts)
                      .where(eq(olts.connectionType, "mysql"))
                      .limit(1);
                    
                    if (zabbixOlt.length > 0) {
                      const zabbixMetrics = await queryZabbixOpticalMetrics(zabbixOlt[0], onuSerial);
                      if (zabbixMetrics) {
                        // Complementar com dados do Zabbix
                        if (zabbixMetrics.oltRxPower !== null) {
                          opticalSignal.oltRxPower = zabbixMetrics.oltRxPower;
                          console.log(`[Monitor] ${link.name} - Óptico Zabbix: OLT_RX=${zabbixMetrics.oltRxPower}dBm`);
                        }
                        // Se SNMP não retornou RX/TX, usar os do Zabbix
                        if (opticalSignal.rxPower === null && zabbixMetrics.rxPower !== null) {
                          opticalSignal.rxPower = zabbixMetrics.rxPower;
                        }
                        if (opticalSignal.txPower === null && zabbixMetrics.txPower !== null) {
                          opticalSignal.txPower = zabbixMetrics.txPower;
                        }
                        // Atualizar dados de splitter do Zabbix no link
                        await updateLinkZabbixSplitterData(link.id, zabbixMetrics);
                      }
                    }
                  }
                } else {
                  console.log(`[Monitor] ${link.name} - Óptico: SNMP respondeu mas sem valores. Verifique OIDs configurados para ${oltVendorSlug}.`);
                  
                  // Fallback completo para Zabbix se SNMP não retornou nada
                  // Usar equipmentSerialNumber (serial da ONU) ao invés de onuSearchString (comando CLI)
                  const onuSerialFallback = link.equipmentSerialNumber || null;
                  if (onuSerialFallback) {
                    console.log(`[Monitor] ${link.name} - Óptico: tentando fallback completo Zabbix por serial ${onuSerialFallback}...`);
                    const zabbixOlt = await db.select().from(olts)
                      .where(eq(olts.connectionType, "mysql"))
                      .limit(1);
                    
                    if (zabbixOlt.length > 0) {
                      const zabbixMetrics = await queryZabbixOpticalMetrics(zabbixOlt[0], onuSerialFallback);
                      if (zabbixMetrics && (zabbixMetrics.rxPower !== null || zabbixMetrics.txPower !== null || zabbixMetrics.oltRxPower !== null)) {
                        opticalSignal = {
                          rxPower: zabbixMetrics.rxPower,
                          txPower: zabbixMetrics.txPower,
                          oltRxPower: zabbixMetrics.oltRxPower,
                        };
                        console.log(`[Monitor] ${link.name} - Óptico Zabbix OK: RX=${zabbixMetrics.rxPower}dBm TX=${zabbixMetrics.txPower}dBm OLT_RX=${zabbixMetrics.oltRxPower}dBm`);
                        // Atualizar dados de splitter do Zabbix no link
                        await updateLinkZabbixSplitterData(link.id, zabbixMetrics);
                      } else {
                        opticalSignal = null;
                      }
                    } else {
                      opticalSignal = null;
                    }
                  } else {
                    opticalSignal = null;
                  }
                }
              } else {
                console.log(`[Monitor] ${link.name} - Óptico: sem resposta SNMP da OLT ${olt[0].ipAddress}`);
                
                // Fallback para Zabbix se SNMP falhou
                // Usar equipmentSerialNumber (serial da ONU) ao invés de onuSearchString (comando CLI)
                const onuSerialSnmpFail = link.equipmentSerialNumber || null;
                if (onuSerialSnmpFail) {
                  console.log(`[Monitor] ${link.name} - Óptico: tentando fallback Zabbix por serial ${onuSerialSnmpFail} após falha SNMP...`);
                  const zabbixOlt = await db.select().from(olts)
                    .where(eq(olts.connectionType, "mysql"))
                    .limit(1);
                  
                  if (zabbixOlt.length > 0) {
                    const zabbixMetrics = await queryZabbixOpticalMetrics(zabbixOlt[0], onuSerialSnmpFail);
                    if (zabbixMetrics && (zabbixMetrics.rxPower !== null || zabbixMetrics.txPower !== null || zabbixMetrics.oltRxPower !== null)) {
                      opticalSignal = {
                        rxPower: zabbixMetrics.rxPower,
                        txPower: zabbixMetrics.txPower,
                        oltRxPower: zabbixMetrics.oltRxPower,
                      };
                      console.log(`[Monitor] ${link.name} - Óptico Zabbix OK (fallback): RX=${zabbixMetrics.rxPower}dBm TX=${zabbixMetrics.txPower}dBm OLT_RX=${zabbixMetrics.oltRxPower}dBm`);
                      // Atualizar dados de splitter do Zabbix no link
                      await updateLinkZabbixSplitterData(link.id, zabbixMetrics);
                    }
                  }
                }
              }
            } else {
              console.log(`[Monitor] ${link.name} - Óptico: perfil SNMP ${olt[0].snmpProfileId} não encontrado`);
            }
          }
        } else {
          console.log(`[Monitor] ${link.name} - Óptico: vendor '${oltVendorSlug}' não encontrado em equipmentVendors`);
        }
      } else if (olt.length > 0) {
        console.log(`[Monitor] ${link.name} - Óptico: OLT ${olt[0].name} sem vendor ou perfil SNMP`);
      }
    }
  }

  // Coleta de sinal óptico para links PTP (via Switch)
  const linkType = (link as any).linkType;
  const switchId = (link as any).switchId;
  const switchPort = (link as any).switchPort;
  
  if (link.opticalMonitoringEnabled && linkType === "ptp" && switchId && switchPort && !opticalSignal) {
    try {
      // Buscar switch
      const switchData = await db.select().from(switches).where(eq(switches.id, switchId)).limit(1);
      
      if (switchData.length > 0) {
        const sw = switchData[0];
        
        // Buscar OIDs do vendor (preferencial) ou do switch individual (fallback/legado)
        let opticalRxOid = sw.opticalRxOidTemplate;
        let opticalTxOid = sw.opticalTxOidTemplate;
        let portIndexTemplate = sw.portIndexTemplate;
        let opticalDivisor = 1000; // Default: milésimos de dBm (Mikrotik)
        let vendorSnmpProfileId: number | null = null;
        let vendorName = "";
        let vendorSlug = sw.vendor?.toLowerCase() || "";
        
        // Se o switch tem vendorId, buscar dados do fabricante (incluindo snmpProfileId)
        if (sw.vendorId) {
          const vendorData = await db.select().from(equipmentVendors).where(eq(equipmentVendors.id, sw.vendorId)).limit(1);
          if (vendorData.length > 0) {
            const vendor = vendorData[0];
            vendorName = vendor.name;
            vendorSlug = vendor.slug?.toLowerCase() || "";
            vendorSnmpProfileId = vendor.snmpProfileId;
            // Usar OIDs do vendor se disponíveis
            if (vendor.switchOpticalRxOid) opticalRxOid = vendor.switchOpticalRxOid;
            if (vendor.switchOpticalTxOid) opticalTxOid = vendor.switchOpticalTxOid;
            if (vendor.switchPortIndexTemplate) portIndexTemplate = vendor.switchPortIndexTemplate;
            if (vendor.switchOpticalDivisor) opticalDivisor = vendor.switchOpticalDivisor;
            console.log(`[Monitor] ${link.name} - Óptico PTP: usando OIDs do fabricante ${vendorName} (divisor: ${opticalDivisor})`);
          }
        }
        
        // Determinar perfil SNMP: switch > fabricante
        const effectiveSnmpProfileId = sw.snmpProfileId || vendorSnmpProfileId;
        
        if (!effectiveSnmpProfileId) {
          console.log(`[Monitor] ${link.name} - Óptico PTP: Perfil SNMP não encontrado (nem no switch nem no fabricante)`);
        } else {
          const swProfile = await getSnmpProfile(effectiveSnmpProfileId);
          if (sw.snmpProfileId) {
            console.log(`[Monitor] ${link.name} - Óptico PTP: usando perfil SNMP do switch`);
          } else {
            console.log(`[Monitor] ${link.name} - Óptico PTP: usando perfil SNMP herdado do fabricante ${vendorName}`);
          }
        
        if (swProfile) {
          console.log(`[Monitor] ${link.name} - Óptico PTP: coletando via Switch ${sw.name} porta ${switchPort}`);
          
          // Verificar se é Cisco (usa Entity MIB com discovery de sensores)
          const isCisco = vendorSlug.includes("cisco");
          // Verificar se é Datacom (usa MIB proprietária com ifIndex)
          const isDatacom = vendorSlug.includes("datacom");
          
          // Datacom: usar OIDs padrão se não configurados
          // OID RX: 1.3.6.1.4.1.3709.3.6.8.2.1.1.2.{ifIndex}.1 (centésimos de dBm, divisor 100)
          // OID TX: 1.3.6.1.4.1.3709.3.6.8.2.1.1.1.{ifIndex}.1 (centésimos de dBm, divisor 100)
          if (isDatacom && !opticalRxOid && !opticalTxOid) {
            opticalRxOid = "1.3.6.1.4.1.3709.3.6.8.2.1.1.2.{ifIndex}.1";
            opticalTxOid = "1.3.6.1.4.1.3709.3.6.8.2.1.1.1.{ifIndex}.1";
            opticalDivisor = 100; // Datacom retorna centésimos de dBm
            console.log(`[Monitor] ${link.name} - Óptico PTP Datacom: usando OIDs padrão (divisor: 100)`);
          }
          
          if (isCisco) {
            // Cisco usa Entity MIB - buscar índices de sensor no cache
            console.log(`[Monitor] ${link.name} - Óptico PTP Cisco: buscando sensores no cache...`);
            
            // Normalizar nome da porta para match (Ethernet1/1 ou Eth1/1)
            let normalizedPort = switchPort.replace(/^Eth(\d)/i, "Ethernet$1");
            
            let sensorData = await db.select()
              .from(switchSensorCache)
              .where(and(
                eq(switchSensorCache.switchId, sw.id),
                eq(switchSensorCache.portName, normalizedPort)
              ))
              .limit(1);
            
            // Fallback para portas de breakout QSFP (40G→4x10G ou 100G→4x25G)
            // Se não encontrar Ethernet1/22/1 diretamente, tentar porta base Ethernet1/22
            // Isso funciona quando o transceiver não reporta lanes separadas
            if (sensorData.length === 0) {
              const breakoutMatch = normalizedPort.match(/^(Ethernet\d+\/\d+)\/\d+$/);
              if (breakoutMatch) {
                const basePort = breakoutMatch[1];
                console.log(`[Monitor] ${link.name} - Óptico PTP Cisco: sub-porta não encontrada, tentando porta base ${basePort}`);
                
                sensorData = await db.select()
                  .from(switchSensorCache)
                  .where(and(
                    eq(switchSensorCache.switchId, sw.id),
                    eq(switchSensorCache.portName, basePort)
                  ))
                  .limit(1);
                
                if (sensorData.length > 0) {
                  console.log(`[Monitor] ${link.name} - Óptico PTP Cisco: usando sensor da porta base (sem lanes)`);
                }
              }
            }
            
            if (sensorData.length > 0 && (sensorData[0].rxSensorIndex || sensorData[0].txSensorIndex)) {
              const sensor = sensorData[0];
              console.log(`[Monitor] ${link.name} - Óptico PTP Cisco: usando sensores RX=${sensor.rxSensorIndex} TX=${sensor.txSensorIndex}`);
              
              // Cisco Nexus retorna valores em milésimos de dBm (ex: -7304 = -7.304 dBm)
              // Usar divisor do fabricante (switchOpticalDivisor) se configurado, senão 1000
              const ciscoDivisor = opticalDivisor || 1000;
              opticalSignal = await getCiscoOpticalSignal(
                sw.ipAddress,
                swProfile,
                sensor.rxSensorIndex,
                sensor.txSensorIndex,
                ciscoDivisor
              );
              
              if (opticalSignal) {
                const hasValues = opticalSignal.rxPower !== null || opticalSignal.txPower !== null;
                if (hasValues) {
                  console.log(`[Monitor] ${link.name} - Óptico PTP Cisco OK: RX=${opticalSignal.rxPower}dBm TX=${opticalSignal.txPower}dBm`);
                } else {
                  console.log(`[Monitor] ${link.name} - Óptico PTP Cisco: SNMP respondeu mas sem valores`);
                  opticalSignal = null;
                }
              }
            } else {
              console.log(`[Monitor] ${link.name} - Óptico PTP Cisco: porta ${normalizedPort} não encontrada no cache. Execute discovery no switch.`);
            }
          } else if (opticalRxOid || opticalTxOid) {
            // Outros fabricantes (Mikrotik, Datacom, etc) - método tradicional com templates
            // Para Datacom e outros que usam {ifIndex}, passar o snmpInterfaceIndex do link
            const linkIfIndex = link.snmpInterfaceIndex ? parseInt(link.snmpInterfaceIndex.toString(), 10) : null;
            opticalSignal = await getOpticalSignalFromSwitch(
              sw.ipAddress,
              swProfile,
              switchPort,
              opticalRxOid,
              opticalTxOid,
              portIndexTemplate,
              opticalDivisor,
              linkIfIndex
            );
            
            if (opticalSignal) {
              const hasValues = opticalSignal.rxPower !== null || opticalSignal.txPower !== null;
              if (hasValues) {
                console.log(`[Monitor] ${link.name} - Óptico PTP OK: RX=${opticalSignal.rxPower}dBm TX=${opticalSignal.txPower}dBm`);
              } else {
                console.log(`[Monitor] ${link.name} - Óptico PTP: SNMP respondeu mas sem valores`);
                opticalSignal = null;
              }
            }
          }
        } else {
          console.log(`[Monitor] ${link.name} - Óptico PTP: Perfil SNMP inválido`);
        }
        } // fecha o else do effectiveSnmpProfileId
      }
    } catch (error) {
      console.log(`[Monitor] ${link.name} - Óptico PTP: erro ${error instanceof Error ? error.message : "desconhecido"}`);
    }
  }

  // Fallback para links não-L2 que ping marcou como offline:
  // Se tem monitoramento óptico habilitado e sinal bom, ou tráfego SNMP ativo, considerar operacional
  if (!isL2Link && pingBasedOffline && !link.icmpBlocked) {
    const hasGoodOptical = opticalSignal && opticalSignal.rxPower !== null && opticalSignal.rxPower < 0 && opticalSignal.rxPower > -30 && link.opticalMonitoringEnabled;
    const hasTraffic = downloadMbps > 0 || uploadMbps > 0;
    
    if (hasGoodOptical && hasTraffic) {
      status = "operational";
      failureReason = null;
      pingResult.latency = 0;
      pingResult.packetLoss = 0;
      pingResult.success = true;
      console.log(`[Monitor] ${link.name}: Ping failed but optical signal OK (RX=${opticalSignal!.rxPower}dBm) and SNMP traffic active (DL=${downloadMbps.toFixed(2)}Mbps) - overriding to OPERATIONAL`);
    } else if (hasGoodOptical) {
      status = "degraded";
      failureReason = "ping_failed_optical_ok";
      console.log(`[Monitor] ${link.name}: Ping failed but optical signal OK (RX=${opticalSignal!.rxPower}dBm), no traffic yet - setting DEGRADED`);
    }
  }

  // Links L2: Determinar status baseado no status da porta, sinal óptico ou tráfego
  if (isL2Link) {
    // Coletar status da porta via SNMP (fonte primária para links L2)
    // Usa o switch/concentrador configurado para o link
    let portStatusSource: { ip: string; profileId: number; ifIndex: number } | null = null;
    
    // Determinar fonte de status da porta
    if (link.trafficSourceType === 'accessPoint' && link.accessPointId && link.accessPointInterfaceIndex) {
      // Link L2 via ponto de acesso
      const accessSwitch = await db.select().from(switches).where(eq(switches.id, link.accessPointId)).limit(1);
      if (accessSwitch.length > 0 && accessSwitch[0].snmpProfileId) {
        portStatusSource = {
          ip: accessSwitch[0].ipAddress,
          profileId: accessSwitch[0].snmpProfileId,
          ifIndex: link.accessPointInterfaceIndex
        };
      }
    } else if (link.switchId && link.snmpInterfaceIndex) {
      // Link L2 via switch de acesso
      const sw = await db.select().from(switches).where(eq(switches.id, link.switchId)).limit(1);
      if (sw.length > 0 && sw[0].snmpProfileId) {
        portStatusSource = {
          ip: sw[0].ipAddress,
          profileId: sw[0].snmpProfileId,
          ifIndex: link.snmpInterfaceIndex
        };
      }
    }
    
    // Coletar status da porta se tiver fonte configurada
    if (portStatusSource) {
      const portProfile = await getSnmpProfile(portStatusSource.profileId);
      if (portProfile) {
        l2PortStatus = await getInterfaceOperStatus(
          portStatusSource.ip,
          portProfile,
          portStatusSource.ifIndex
        );
      }
    }
    
    // Prioridade 1: Status da porta via SNMP (ifOperStatus)
    if (l2PortStatus) {
      if (l2PortStatus.operStatus === 'down') {
        status = "offline";
        failureReason = "port_down";
        console.log(`[Monitor] ${link.name}: Link L2 OFFLINE - Porta down (adminStatus: ${l2PortStatus.adminStatus})`);
      } else if (l2PortStatus.operStatus === 'up') {
        // Porta up - verificar sinal óptico se disponível para determinar degradação
        if (opticalSignal && opticalSignal.rxPower !== null && link.opticalMonitoringEnabled) {
          const rxPower = opticalSignal.rxPower;
          if (rxPower < -28) {
            status = "degraded";
            failureReason = "optical_low_signal";
            console.log(`[Monitor] ${link.name}: Link L2 DEGRADED - Porta up, sinal óptico crítico (${rxPower} dBm)`);
          } else if (rxPower < -25) {
            status = "degraded";
            failureReason = "optical_warning";
            console.log(`[Monitor] ${link.name}: Link L2 DEGRADED - Porta up, sinal óptico em warning (${rxPower} dBm)`);
          } else {
            status = "operational";
            failureReason = null;
            console.log(`[Monitor] ${link.name}: Link L2 operacional - Porta up, sinal OK (${rxPower} dBm)`);
          }
        } else {
          status = "operational";
          failureReason = null;
          console.log(`[Monitor] ${link.name}: Link L2 operacional - Porta up`);
        }
      } else {
        // Status desconhecido/testing/dormant
        status = "degraded";
        failureReason = `port_${l2PortStatus.operStatus}`;
        console.log(`[Monitor] ${link.name}: Link L2 DEGRADED - Porta em estado ${l2PortStatus.operStatus}`);
      }
    }
    // Prioridade 2: Sinal óptico (se configurado e sem status da porta)
    else if (opticalSignal && opticalSignal.rxPower !== null && link.opticalMonitoringEnabled) {
      const rxPower = opticalSignal.rxPower;
      
      if (rxPower < -30) {
        status = "offline";
        failureReason = "optical_no_signal";
        console.log(`[Monitor] ${link.name}: Link L2 OFFLINE - Sinal óptico muito baixo (${rxPower} dBm)`);
      } else if (rxPower < -28) {
        status = "degraded";
        failureReason = "optical_low_signal";
        console.log(`[Monitor] ${link.name}: Link L2 DEGRADED - Sinal óptico crítico (${rxPower} dBm)`);
      } else if (rxPower < -25) {
        status = "degraded";
        failureReason = "optical_warning";
        console.log(`[Monitor] ${link.name}: Link L2 DEGRADED - Sinal óptico em warning (${rxPower} dBm)`);
      } else {
        status = "operational";
        failureReason = null;
        console.log(`[Monitor] ${link.name}: Link L2 operacional - Sinal óptico OK (${rxPower} dBm)`);
      }
    }
    // Prioridade 3: Sem status de porta nem sinal - considerar offline (não há forma de verificar)
    else {
      status = "offline";
      failureReason = "snmp_unreachable";
      console.log(`[Monitor] ${link.name}: Link L2 OFFLINE - Sem status de porta ou sinal óptico disponível`);
    }
  }

  return {
    latency: pingResult.latency,
    packetLoss: pingResult.packetLoss,
    downloadMbps,
    uploadMbps,
    cpuUsage,
    memoryUsage,
    status,
    failureReason,
    opticalSignal,
  };
}

async function processLinkMetrics(link: typeof links.$inferSelect): Promise<boolean> {
  if (!link.monitoringEnabled) return true;

  try {
    const collectedMetrics = await collectLinkMetrics(link);

    const currentUptime = link.uptime || 99;
    let newUptime = currentUptime;

    if (collectedMetrics.status === "offline") {
      newUptime = Math.max(0, currentUptime - 0.01);
    } else if (collectedMetrics.status === "operational") {
      newUptime = Math.min(100, currentUptime + 0.001);
    }

    const safeDownload = isFinite(collectedMetrics.downloadMbps) ? collectedMetrics.downloadMbps : 0;
    const safeUpload = isFinite(collectedMetrics.uploadMbps) ? collectedMetrics.uploadMbps : 0;
    const safeLatency = isFinite(collectedMetrics.latency) ? collectedMetrics.latency : 0;
    const safePacketLoss = isFinite(collectedMetrics.packetLoss) ? collectedMetrics.packetLoss : 0;
    const safeCpuUsage = isFinite(collectedMetrics.cpuUsage) ? collectedMetrics.cpuUsage : 0;
    const safeMemoryUsage = isFinite(collectedMetrics.memoryUsage) ? collectedMetrics.memoryUsage : 0;

    const previousStatus = link.status;
    const newStatus = collectedMetrics.status;
    
    // Helper function to enrich with OLT diagnosis
    const enrichWithOltDiagnosis = async (): Promise<string> => {
      if (!link.oltId || !link.onuId) return "";
      
      const cached = oltDiagnosisCache.get(link.id);
      const now = Date.now();
      
      // Use cache if still valid
      if (cached && (now - cached.timestamp) < OLT_DIAGNOSIS_COOLDOWN_MS) {
        if (cached.failureReason) {
          collectedMetrics.failureReason = cached.failureReason;
        }
        return cached.diagnosis;
      }
      
      // Check if we already have OLT diagnosis saved in DB (after server restart)
      const oltReasons = ['rompimento_fibra', 'queda_energia', 'sinal_degradado', 'onu_inativa', 'olt_alarm'];
      const isOltReason = link.failureSource === 'olt' && link.failureReason && 
        oltReasons.includes(link.failureReason);
      if (isOltReason) {
        collectedMetrics.failureReason = link.failureReason;
        // Return the saved diagnosis label for event description
        const reasonLabels: Record<string, string> = {
          "rompimento_fibra": "Rompimento de Fibra",
          "queda_energia": "Queda de Energia",
          "sinal_degradado": "Sinal Degradado",
          "onu_inativa": "ONU Inativa",
          "olt_alarm": "Alarme OLT",
        };
        const label = reasonLabels[link.failureReason!] || link.failureReason;
        return ` | OLT: ${label}`;
      }
      
      try {
        const [olt] = await db.select().from(olts).where(eq(olts.id, link.oltId!));
        
        if (olt && olt.isActive) {
          let diagnosisSuffix = "";
          let oltAlarmType: string | null = null;
          
          const diagnosisKey = buildOnuDiagnosisKey(olt, {
            onuSearchString: link.onuSearchString,
            onuId: link.onuId,
            slotOlt: link.slotOlt,
            portOlt: link.portOlt,
          });
          
          if (!diagnosisKey) {
            diagnosisSuffix = " | OLT: Dados de ONU incompletos para diagnóstico";
          } else {
            // Use queryOltAlarm for all OLT types (same as manual diagnosis endpoint)
            console.log(`[Monitor] ${link.name}: Querying OLT with key: ${diagnosisKey}`);
            const diagnosis = await queryOltAlarm(olt, diagnosisKey);
            oltAlarmType = diagnosis.alarmType;
            console.log(`[Monitor] ${link.name}: OLT returned alarmType=${oltAlarmType}, diagnosis=${diagnosis.diagnosis}`);
            diagnosisSuffix = diagnosis.alarmType 
              ? ` | Diagnóstico OLT: ${diagnosis.diagnosis} (${diagnosis.alarmType})`
              : ` | OLT: ${diagnosis.description}`;
          }
          
          const oltFailureReason = mapOltAlarmToFailureReason(oltAlarmType);
          if (oltFailureReason) {
            collectedMetrics.failureReason = oltFailureReason;
          }
          
          oltDiagnosisCache.set(link.id, { 
            timestamp: now, 
            diagnosis: diagnosisSuffix,
            failureReason: oltFailureReason,
            alarmType: oltAlarmType,
            alarmTime: null,
          });
          
          return diagnosisSuffix;
        }
      } catch (oltError) {
        console.error(`[Monitor] Erro ao consultar OLT:`, oltError);
      }
      
      return "";
    }
    
    // Save failure history and clear cache/failureReason when link comes back online
    let shouldSaveFailureHistory = false;
    if (newStatus === "operational" && (previousStatus === "offline" || previousStatus === "degraded")) {
      // Save the failure reason to history before clearing
      if (link.failureReason) {
        shouldSaveFailureHistory = true;
      }
      oltDiagnosisCache.delete(link.id);
      collectedMetrics.failureReason = null;
    }
    
    // Enrich with OLT diagnosis when offline (both transition and ongoing)
    let diagnosisSuffix = "";
    if (newStatus === "offline" && link.oltId && link.onuId) {
      console.log(`[Monitor] ${link.name}: Offline detected, consulting OLT for diagnosis...`);
      diagnosisSuffix = await enrichWithOltDiagnosis();
      console.log(`[Monitor] ${link.name}: OLT diagnosis result: "${diagnosisSuffix}"`);
    }
    
    // Create event on status change
    if (previousStatus !== newStatus) {
      const eventConfig = getStatusChangeEvent(previousStatus, newStatus, link.name, safeLatency, safePacketLoss);
      if (eventConfig) {
        let eventDescription = eventConfig.description + diagnosisSuffix;
        console.log(`[Monitor] ${link.name}: Creating event with description: "${eventDescription}"`);
        
        await db.insert(events).values({
          linkId: link.id,
          clientId: link.clientId,
          type: eventConfig.type,
          title: eventConfig.title,
          description: eventDescription,
          timestamp: new Date(),
          resolved: eventConfig.resolved,
        });
      }
    }
    
    // Auto-resolve events based on current metrics
    // Each type of event is resolved only when its specific condition returns to normal
    const latencyThresholdForResolve = link.latencyThreshold || 80;
    const packetLossThresholdForResolve = link.packetLossThreshold || 2;
    
    // Resolve latency events only when latency is back to normal
    if (safeLatency <= latencyThresholdForResolve) {
      const resolvedLatency = await db
        .update(events)
        .set({ resolved: true, resolvedAt: new Date() })
        .where(and(
          eq(events.linkId, link.id), 
          eq(events.resolved, false),
          like(events.title, '%Latência elevada%')
        ))
        .returning();
      if (resolvedLatency.length > 0) {
        console.log(`[Monitor] ${link.name}: Auto-resolved ${resolvedLatency.length} latency events (latency normal: ${safeLatency.toFixed(1)}ms)`);
      }
    }
    
    // Resolve packet loss events only when packet loss is back to normal
    if (safePacketLoss <= packetLossThresholdForResolve) {
      const resolvedPacketLoss = await db
        .update(events)
        .set({ resolved: true, resolvedAt: new Date() })
        .where(and(
          eq(events.linkId, link.id), 
          eq(events.resolved, false),
          like(events.title, '%Perda de pacotes%')
        ))
        .returning();
      if (resolvedPacketLoss.length > 0) {
        console.log(`[Monitor] ${link.name}: Auto-resolved ${resolvedPacketLoss.length} packet loss events (loss normal: ${safePacketLoss.toFixed(1)}%)`);
      }
    }
    
    // Resolve offline/degraded status events only when link is fully operational
    const isFullyNormal = newStatus === "operational" && 
                          safeLatency <= latencyThresholdForResolve && 
                          safePacketLoss <= packetLossThresholdForResolve;
    
    if (isFullyNormal) {
      const resolvedStatus = await db
        .update(events)
        .set({ resolved: true, resolvedAt: new Date() })
        .where(and(
          eq(events.linkId, link.id), 
          eq(events.resolved, false),
          not(like(events.title, '%blacklist%')),      // Blacklist: gerenciado por hetrixtools.ts
          not(like(events.title, '%Latência elevada%')), // Já resolvido acima
          not(like(events.title, '%Perda de pacotes%'))  // Já resolvido acima
        ))
        .returning();
      if (resolvedStatus.length > 0) {
        console.log(`[Monitor] ${link.name}: Auto-resolved ${resolvedStatus.length} status events (link fully normal)`);
      }
    }
    
    const latencyThreshold = link.latencyThreshold || 80;
    const packetLossThreshold = link.packetLossThreshold || 2;
    
    if (safeLatency > latencyThreshold && link.latency <= latencyThreshold) {
      await db.insert(events).values({
        linkId: link.id,
        clientId: link.clientId,
        type: "warning",
        title: `Latência elevada em ${link.name}`,
        description: `Latência atual: ${safeLatency.toFixed(1)}ms (limite: ${latencyThreshold}ms)`,
        timestamp: new Date(),
        resolved: false,
      });
    }
    
    // Use moving average and persistence rule for packet loss alerts
    // Skip packet loss alerts if link is offline (status = 'offline' or 'down')
    const isLinkDown = collectedMetrics.status === 'offline' || collectedMetrics.status === 'down';
    
    if (!isLinkDown) {
      const globalSettings = await loadMonitoringSettings();
      const lossState = await updatePacketLossState(link.id, safePacketLoss, globalSettings);
      
      // Only alert if persistence rule is met (X consecutive cycles above threshold)
      if (lossState.shouldAlert) {
        await db.insert(events).values({
          linkId: link.id,
          clientId: link.clientId,
          type: "warning",
          title: `Perda de pacotes elevada em ${link.name}`,
          description: `Média móvel: ${lossState.avgLoss.toFixed(1)}% (limite: ${packetLossThreshold}%) - ${lossState.consecutiveBreaches} ciclos consecutivos`,
          timestamp: new Date(),
          resolved: false,
        });
        // Mark alert sent to reset consecutive counter and avoid repeated alerts
        markAlertSent(link.id);
      }
    } else {
      // Reset packet loss state when link is down to avoid false alerts when it comes back
      resetLinkState(link.id);
    }
    
    // ========== EVENTO DE SINAL ÓPTICO DEGRADADO ==========
    // Verificar se o sinal óptico está abaixo do limite e criar evento
    // NOTA: Eventos de sinal óptico NÃO são auto-resolvidos para evitar flapping
    // O operador deve resolver manualmente após verificar a situação
    if (collectedMetrics.opticalSignal?.rxPower !== null && collectedMetrics.opticalSignal?.rxPower !== undefined) {
      const opticalStatus = getOpticalStatus(
        collectedMetrics.opticalSignal.rxPower, 
        link.opticalRxBaseline, 
        link.opticalDeltaThreshold ?? 3
      );
      
      // Buscar evento de sinal óptico ativo (não resolvido)
      const activeOpticalEvent = await db.select().from(events)
        .where(and(
          eq(events.linkId, link.id),
          eq(events.resolved, false),
          like(events.title, '%Sinal óptico%')
        ))
        .limit(1);
      const hasActiveOpticalEvent = activeOpticalEvent.length > 0;
      
      // Buscar último evento de sinal óptico (resolvido ou não) nas últimas 6 horas
      // Isso evita criar eventos repetidos mesmo se o anterior foi resolvido manualmente
      const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
      const recentOpticalEvents = await db.select().from(events)
        .where(and(
          eq(events.linkId, link.id),
          like(events.title, '%Sinal óptico%'),
          gte(events.timestamp, sixHoursAgo)
        ))
        .limit(1);
      const hasRecentOpticalEvent = recentOpticalEvents.length > 0;
      
      // Criar evento de sinal crítico/warning se não há evento ativo E não há evento recente (debounce 6h)
      if ((opticalStatus === 'critical' || opticalStatus === 'warning') && !hasActiveOpticalEvent && !hasRecentOpticalEvent) {
        const eventType = opticalStatus === 'critical' ? 'critical' : 'warning';
        const statusLabel = opticalStatus === 'critical' ? 'Crítico' : 'Degradado';
        await db.insert(events).values({
          linkId: link.id,
          clientId: link.clientId,
          type: eventType,
          title: `Sinal óptico ${statusLabel.toLowerCase()} em ${link.name}`,
          description: `Potência RX: ${collectedMetrics.opticalSignal.rxPower.toFixed(1)} dBm (limite normal: ≥${OPTICAL_THRESHOLDS.rxNormalMin} dBm)`,
          timestamp: new Date(),
          resolved: false,
        });
        console.log(`[Monitor] ${link.name}: Created optical signal ${opticalStatus} event (RX: ${collectedMetrics.opticalSignal.rxPower.toFixed(1)} dBm)`);
      } else if ((opticalStatus === 'critical' || opticalStatus === 'warning') && (hasRecentOpticalEvent || hasActiveOpticalEvent)) {
        // Suprimiu evento por debounce ou evento ativo existente
        // Não logamos para evitar spam no log
      }
      
      // NÃO auto-resolver eventos de sinal óptico
      // Operador deve resolver manualmente após verificar a situação
      // Isso evita o flapping de criar/resolver/criar eventos rapidamente
    }
    
    // ========== EVENTO DE CONGESTIONAMENTO DE BANDA ==========
    // Verificar se o uso de banda está acima de 90% da capacidade contratada
    const bandwidthCapacity = link.bandwidth || 0; // Mbps
    if (bandwidthCapacity > 0) {
      const downloadUsagePercent = (safeDownload / bandwidthCapacity) * 100;
      const uploadUsagePercent = (safeUpload / bandwidthCapacity) * 100;
      const maxUsagePercent = Math.max(downloadUsagePercent, uploadUsagePercent);
      const congestionThreshold = 90; // 90% padrão
      
      // Buscar evento de congestionamento ativo
      const activeCongestionEvent = await db.select().from(events)
        .where(and(
          eq(events.linkId, link.id),
          eq(events.resolved, false),
          like(events.title, '%congestionado%')
        ))
        .limit(1);
      
      const hasCongestionEvent = activeCongestionEvent.length > 0;
      
      if (maxUsagePercent >= congestionThreshold && !hasCongestionEvent) {
        // Criar evento de congestionamento
        const direction = downloadUsagePercent > uploadUsagePercent ? 'Download' : 'Upload';
        await db.insert(events).values({
          linkId: link.id,
          clientId: link.clientId,
          type: "warning",
          title: `Link congestionado - ${link.name}`,
          description: `${direction} em ${maxUsagePercent.toFixed(1)}% da capacidade (${bandwidthCapacity} Mbps). Limite: ${congestionThreshold}%`,
          timestamp: new Date(),
          resolved: false,
        });
        console.log(`[Monitor] ${link.name}: Created congestion event (${maxUsagePercent.toFixed(1)}% usage)`);
      } else if (maxUsagePercent < congestionThreshold - 10 && hasCongestionEvent) {
        // Resolver evento de congestionamento se uso caiu abaixo de 80% (10% abaixo do limite para evitar flapping)
        const resolvedCongestion = await db
          .update(events)
          .set({ resolved: true, resolvedAt: new Date() })
          .where(and(
            eq(events.linkId, link.id),
            eq(events.resolved, false),
            like(events.title, '%congestionado%')
          ))
          .returning();
        if (resolvedCongestion.length > 0) {
          console.log(`[Monitor] ${link.name}: Auto-resolved congestion event (usage now ${maxUsagePercent.toFixed(1)}%)`);
        }
      }
    }

    // Determine failure source based on whether we have OLT diagnosis
    const cached = oltDiagnosisCache.get(link.id);
    const hasOltDiagnosisFromCache = cached?.failureReason && collectedMetrics.status === 'offline';
    
    // Preserve OLT diagnosis from database if already set (even if not in cache)
    const hasOltDiagnosisFromDb = collectedMetrics.status === 'offline' && 
      link.failureSource === 'olt' && 
      link.failureReason && 
      ['rompimento_fibra', 'queda_energia', 'sinal_degradado', 'onu_inativa', 'olt_alarm'].includes(link.failureReason);
    
    // Determine final failureReason and failureSource
    let finalFailureReason: string | null = null;
    let finalFailureSource: string | null = null;
    let finalStatus = collectedMetrics.status;
    
    // Check if link has IPs currently listed in blacklist (from cached data)
    // This uses the cache loaded once per monitoring cycle for performance
    const cachedBlacklistIps = blacklistCache.get(link.id) || [];
    const hasBlacklistedIps = cachedBlacklistIps.length > 0;
    
    // Check if link is currently degraded due to blacklist - preserve this status
    const isBlacklistDegraded = link.status === 'degraded' && link.failureSource === 'blacklist';
    
    if (collectedMetrics.status === 'offline') {
      if (hasOltDiagnosisFromCache && cached.failureReason) {
        finalFailureReason = cached.failureReason;
        finalFailureSource = 'olt';
      } else if (hasOltDiagnosisFromDb) {
        // Preserve existing OLT diagnosis from database
        finalFailureReason = link.failureReason;
        finalFailureSource = 'olt';
      } else {
        finalFailureReason = collectedMetrics.failureReason;
        finalFailureSource = 'monitoring';
      }
    } else if (collectedMetrics.status === 'degraded') {
      // For degraded status, use monitoring-derived reason (e.g., packet_loss)
      finalFailureReason = collectedMetrics.failureReason;
      finalFailureSource = collectedMetrics.failureReason ? 'monitoring' : null;
    } else if (collectedMetrics.status === 'operational' && (isBlacklistDegraded || hasBlacklistedIps)) {
      // FORCE/PRESERVE blacklist degraded status - don't override with operational
      // This ensures links with blacklisted IPs always show as degraded
      finalStatus = 'degraded';
      if (hasBlacklistedIps) {
        const listedIps = cachedBlacklistIps.map(c => c.ip).join(', ');
        finalFailureReason = `IP(s) em blacklist: ${listedIps}`;
      } else {
        finalFailureReason = link.failureReason;
      }
      finalFailureSource = 'blacklist';
    }
    // For operational status (without blacklist), both remain null (no failure)
    
    // Build update object
    const updateData: Record<string, any> = {
      currentDownload: safeDownload,
      currentUpload: safeUpload,
      latency: safeLatency,
      packetLoss: safePacketLoss,
      cpuUsage: safeCpuUsage,
      memoryUsage: safeMemoryUsage,
      status: finalStatus,  // Use finalStatus to preserve blacklist degraded state
      failureReason: finalFailureReason,
      failureSource: finalFailureSource,
      lastFailureAt: finalStatus === 'offline' ? new Date() : link.lastFailureAt,
      uptime: newUptime,
      lastUpdated: new Date(),
    };
    
    // Save failure history when link recovers
    if (shouldSaveFailureHistory) {
      updateData.lastFailureReason = link.failureReason;
      updateData.lastFailureSource = link.failureSource;
    }
    
    await db.update(links).set(updateData).where(eq(links.id, link.id));

    await db.insert(metrics).values({
      linkId: link.id,
      clientId: link.clientId,
      timestamp: new Date(),
      download: safeDownload,
      upload: safeUpload,
      latency: safeLatency,
      packetLoss: safePacketLoss,
      cpuUsage: safeCpuUsage,
      memoryUsage: safeMemoryUsage,
      errorRate: 0,
      status: collectedMetrics.status,
      // Dados de sinal óptico
      opticalRxPower: collectedMetrics.opticalSignal?.rxPower ?? null,
      opticalTxPower: collectedMetrics.opticalSignal?.txPower ?? null,
      opticalOltRxPower: collectedMetrics.opticalSignal?.oltRxPower ?? null,
      opticalStatus: collectedMetrics.opticalSignal 
        ? getOpticalStatus(collectedMetrics.opticalSignal.rxPower, link.opticalRxBaseline, link.opticalDeltaThreshold ?? 3)
        : null,
    });

    // Coletar métricas de interfaces de tráfego adicionais
    try {
      const additionalInterfaces = await db.select()
        .from(linkTrafficInterfaces)
        .where(and(
          eq(linkTrafficInterfaces.linkId, link.id),
          eq(linkTrafficInterfaces.isEnabled, true)
        ));
      
      if (additionalInterfaces.length > 0) {
        console.log(`[Monitor] ${link.name}: Coletando ${additionalInterfaces.length} interfaces adicionais`);
        const metricsToInsert: Array<{linkId: number; trafficInterfaceId: number; download: number; upload: number; timestamp: Date}> = [];
        
        for (const iface of additionalInterfaces) {
          try {
            let ifaceIp: string | null = null;
            let ifaceProfileId: number | null = null;
            
            // Determinar IP e perfil SNMP baseado no sourceType
            if (iface.sourceType === 'manual' && iface.ipAddress) {
              ifaceIp = iface.ipAddress;
              ifaceProfileId = iface.snmpProfileId;
            } else if (iface.sourceType === 'concentrator' && iface.sourceEquipmentId) {
              const conc = await db.select().from(snmpConcentrators).where(eq(snmpConcentrators.id, iface.sourceEquipmentId)).limit(1);
              if (conc.length > 0) {
                ifaceIp = conc[0].ipAddress;
                ifaceProfileId = conc[0].snmpProfileId;
              }
            } else if (iface.sourceType === 'switch' && iface.sourceEquipmentId) {
              const sw = await db.select().from(switches).where(eq(switches.id, iface.sourceEquipmentId)).limit(1);
              if (sw.length > 0) {
                ifaceIp = sw[0].ipAddress;
                ifaceProfileId = sw[0].snmpProfileId;
              }
            }
            
            if (!ifaceIp || !ifaceProfileId || !iface.ifIndex) {
              console.log(`[Monitor] ${link.name}: Interface ${iface.id} (${iface.label}) - Dados incompletos: IP=${ifaceIp}, profileId=${ifaceProfileId}, ifIndex=${iface.ifIndex}`);
              continue;
            }
            
            const profile = await getSnmpProfile(ifaceProfileId);
            if (!profile) {
              console.log(`[Monitor] ${link.name}: Interface ${iface.id} (${iface.label}) - Perfil SNMP ${ifaceProfileId} não encontrado`);
              continue;
            }
            
            const trafficData = await getInterfaceTraffic(ifaceIp, profile, iface.ifIndex);
            if (!trafficData) {
              console.log(`[Monitor] ${link.name}: Interface ${iface.id} (${iface.label}) - Sem dados de tráfego de ${ifaceIp}`);
              continue;
            }
            
            const cacheKey = `${link.id}-${iface.id}`;
            const previousData = previousAdditionalTrafficData.get(cacheKey);
            
            if (previousData) {
              const bandwidth = calculateBandwidth(trafficData, previousData);
              let download = bandwidth.downloadMbps;
              let upload = bandwidth.uploadMbps;
              
              // Inverter se configurado
              if (iface.invertBandwidth) {
                [download, upload] = [upload, download];
              }
              
              const now = new Date();
              
              metricsToInsert.push({
                linkId: link.id,
                trafficInterfaceId: iface.id,
                download: download * 1000000, // Converter Mbps para bps
                upload: upload * 1000000,
                timestamp: now, // Timestamp explícito
              });
            } else {
              console.log(`[Monitor] ${link.name}: Interface ${iface.id} (${iface.label}) - Primeira coleta, aguardando próxima para calcular bandwidth`);
            }
            
            previousAdditionalTrafficData.set(cacheKey, trafficData);
          } catch (ifaceError) {
            console.error(`[Monitor] ${link.name}: Interface ${iface.id} (${iface.label}) - Erro:`, ifaceError);
          }
        }
        
        // Inserir métricas em batch
        if (metricsToInsert.length > 0) {
          await db.insert(trafficInterfaceMetrics).values(metricsToInsert);
          console.log(`[Monitor] ${link.name}: Inseridas ${metricsToInsert.length} métricas de interfaces adicionais`);
        }
        
        // Processar mainGraphMode: aggregate ou single
        // Usa as métricas das interfaces adicionais para gerar métricas principais
        if ((link.mainGraphMode === 'aggregate' || link.mainGraphMode === 'single') && 
            link.mainGraphInterfaceIds && link.mainGraphInterfaceIds.length > 0 && 
            metricsToInsert.length > 0) {
          
          const selectedIds = link.mainGraphInterfaceIds;
          const selectedMetrics = metricsToInsert.filter(m => selectedIds.includes(m.trafficInterfaceId));
          
          if (selectedMetrics.length > 0) {
            let mainDownload = 0;
            let mainUpload = 0;
            
            if (link.mainGraphMode === 'aggregate') {
              // Somar todas as interfaces selecionadas
              mainDownload = selectedMetrics.reduce((sum, m) => sum + m.download, 0) / 1000000; // bps -> Mbps
              mainUpload = selectedMetrics.reduce((sum, m) => sum + m.upload, 0) / 1000000;
              console.log(`[Monitor] ${link.name}: Gráfico principal agregado de ${selectedMetrics.length} interfaces: DL=${mainDownload.toFixed(2)}Mbps, UL=${mainUpload.toFixed(2)}Mbps`);
            } else if (link.mainGraphMode === 'single') {
              // Usar apenas a primeira interface selecionada
              const singleMetric = selectedMetrics[0];
              mainDownload = singleMetric.download / 1000000;
              mainUpload = singleMetric.upload / 1000000;
              console.log(`[Monitor] ${link.name}: Gráfico principal usando interface ${singleMetric.trafficInterfaceId}: DL=${mainDownload.toFixed(2)}Mbps, UL=${mainUpload.toFixed(2)}Mbps`);
            }
            
            // Atualizar link com valores do gráfico principal
            await db.update(links).set({
              currentDownload: mainDownload,
              currentUpload: mainUpload,
              lastUpdated: new Date(),
            }).where(eq(links.id, link.id));
            
            // Atualizar a métrica mais recente com os valores agregados/single
            const recentMetrics = await db.select({ id: metrics.id })
              .from(metrics)
              .where(eq(metrics.linkId, link.id))
              .orderBy(desc(metrics.timestamp))
              .limit(1);
            
            if (recentMetrics.length > 0) {
              await db.update(metrics)
                .set({
                  download: mainDownload,
                  upload: mainUpload,
                })
                .where(eq(metrics.id, recentMetrics[0].id));
            }
          }
        }
      }
    } catch (additionalError) {
      // Não falhar a coleta principal por erro nas interfaces adicionais
      console.error(`[Monitor] ${link.name}: Erro ao coletar interfaces adicionais:`, additionalError);
    }

    console.log(
      `[Monitor] ${link.name}: lat=${safeLatency.toFixed(1)}ms, loss=${safePacketLoss.toFixed(1)}%, status=${collectedMetrics.status}`
    );
    return true;
  } catch (error) {
    console.error(`[Monitor] Error collecting ${link.name}:`, error);
    return false;
  }
}

export async function collectAllLinksMetrics(): Promise<void> {
  try {
    // Load blacklist cache once per cycle (instead of querying per link)
    await loadBlacklistCache();
    
    const allLinks = await db.select().from(links);
    const enabledLinks = allLinks.filter(l => l.monitoringEnabled);
    const disabledLinks = allLinks.filter(l => !l.monitoringEnabled);
    
    // Log links with monitoring disabled for diagnostics
    if (disabledLinks.length > 0) {
      console.log(`[Monitor] Skipping ${disabledLinks.length} links with monitoring disabled: ${disabledLinks.map(l => `${l.id}:${l.name}`).join(', ')}`);
    }
    
    if (enabledLinks.length === 0) return;
    
    const startTime = Date.now();
    console.log(`[Monitor] Starting parallel collection for ${enabledLinks.length} links (${PARALLEL_WORKERS} workers)`);
    
    const results = await runWithConcurrencyLimit(enabledLinks, PARALLEL_WORKERS, processLinkMetrics);
    
    const successful = results.filter(r => r === true).length;
    const failed = results.filter(r => r === false || r === null).length;
    const elapsed = Date.now() - startTime;
    
    console.log(`[Monitor] Collection complete: ${successful} ok, ${failed} failed, ${elapsed}ms elapsed`);
    
    // Coletar métricas dos CPEs após a coleta de links
    try {
      await collectAllCpesMetrics();
    } catch (err) {
      console.error("[Monitor] CPE collection error:", err);
    }
  } catch (error) {
    console.error("[Monitor] Error in collectAllLinksMetrics:", error);
  }
}

let monitoringInterval: NodeJS.Timeout | null = null;

/**
 * Coleta métricas de CPU/Memória de todos os CPEs cadastrados via SNMP
 * Usa os OIDs configurados no fabricante (equipmentVendors) associado ao CPE
 */
export async function collectAllCpesMetrics(): Promise<void> {
  try {
    console.log(`[Monitor/CPE] Iniciando coleta de métricas de CPEs...`);
    
    // Buscar todos os CPEs ativos com IP (do CPE ou via ipOverride do linkCpes)
    const allCpes = await db.select().from(cpes).where(eq(cpes.isActive, true));
    
    // Buscar relações linkCpes para obter ipOverride
    const allLinkCpes = await db.select().from(linkCpes);
    
    // Para CPEs padrão (isStandard=true), cada associação link_cpe é uma instância separada
    // Para CPEs não-padrão, usa o primeiro ipOverride encontrado ou o IP do próprio CPE
    type CpeInstance = typeof allCpes[0] & { effectiveIp: string | null; ipSource: string; linkCpeId?: number };
    const cpeInstances: CpeInstance[] = [];
    
    for (const cpe of allCpes) {
      if (cpe.isStandard) {
        // CPE padrão: criar uma instância para cada associação com ipOverride
        const associations = allLinkCpes.filter(lc => lc.cpeId === cpe.id && lc.ipOverride);
        if (associations.length > 0) {
          for (const assoc of associations) {
            cpeInstances.push({
              ...cpe,
              effectiveIp: assoc.ipOverride,
              ipSource: 'override',
              linkCpeId: assoc.id
            });
          }
        } else {
          // CPE padrão sem override: usar IP do CPE se existir
          if (cpe.ipAddress) {
            cpeInstances.push({
              ...cpe,
              effectiveIp: cpe.ipAddress,
              ipSource: 'cpe'
            });
          }
        }
      } else {
        // CPE não-padrão: usar primeiro ipOverride ou IP do próprio CPE
        const assocWithOverride = allLinkCpes.find(lc => lc.cpeId === cpe.id && lc.ipOverride);
        const effectiveIp = assocWithOverride?.ipOverride || cpe.ipAddress || null;
        const ipSource = assocWithOverride?.ipOverride ? 'override' : (cpe.ipAddress ? 'cpe' : 'none');
        cpeInstances.push({ ...cpe, effectiveIp, ipSource });
      }
    }
    
    console.log(`[Monitor/CPE] CPEs ativos encontrados: ${allCpes.length}, instâncias para coleta: ${cpeInstances.length}`);
    
    // Debug: mostrar de onde vem o IP de cada instância
    for (const cpe of cpeInstances) {
      if (cpe.effectiveIp) {
        console.log(`[Monitor/CPE] ${cpe.name}: IP=${cpe.effectiveIp} (fonte: ${cpe.ipSource})`);
      }
    }
    
    const monitorableCpes = cpeInstances.filter(c => c.effectiveIp && c.vendorId && c.hasAccess);
    
    if (monitorableCpes.length === 0) {
      if (cpeInstances.length > 0) {
        const missingIp = cpeInstances.filter(c => !c.effectiveIp).length;
        const missingVendor = cpeInstances.filter(c => !c.vendorId).length;
        const noAccess = cpeInstances.filter(c => !c.hasAccess).length;
        console.log(`[Monitor/CPE] Nenhum CPE monitorável (sem IP: ${missingIp}, sem fabricante: ${missingVendor}, sem acesso: ${noAccess})`);
      } else {
        console.log(`[Monitor/CPE] Nenhum CPE ativo cadastrado`);
      }
      return;
    }
    
    console.log(`[Monitor/CPE] Coletando métricas de ${monitorableCpes.length} instâncias...`);
    
    // Buscar perfis SNMP e vendors em paralelo
    const [allProfiles, allVendors] = await Promise.all([
      db.select().from(snmpProfiles),
      db.select().from(equipmentVendors)
    ]);
    
    const profilesMap = new Map(allProfiles.map(p => [p.id, p]));
    const vendorsMap = new Map(allVendors.map(v => [v.id, v]));
    
    const collectCpeMetrics = async (cpe: typeof monitorableCpes[0]) => {
      try {
        if (!cpe.effectiveIp || !cpe.vendorId) return;
        
        const vendor = vendorsMap.get(cpe.vendorId);
        if (!vendor) {
          console.log(`[Monitor/CPE] CPE ${cpe.id} (${cpe.name}): fabricante ID ${cpe.vendorId} não encontrado`);
          return;
        }
        
        // Verificar se o fabricante tem OIDs de CPU/memória configurados
        if (!vendor.cpuOid && !vendor.memoryOid) {
          console.log(`[Monitor/CPE] CPE ${cpe.id} (${cpe.name}): fabricante ${vendor.name} sem OIDs de CPU/memória configurados`);
          return;
        }
        
        // Obter perfil SNMP (prioridade: CPE > Vendor)
        const profileId = cpe.snmpProfileId || vendor.snmpProfileId;
        const profile = profileId ? profilesMap.get(profileId) : null;
        
        // Se não encontrou perfil SNMP, pular este CPE (não usar fallback inseguro)
        if (!profile) {
          console.log(`[Monitor/CPE] CPE ${cpe.id} (${cpe.name}): sem perfil SNMP configurado - pulando coleta`);
          return;
        }
        
        // Montar configuração de memória
        const memoryConfig = {
          memoryOid: vendor.memoryOid,
          memoryTotalOid: vendor.memoryTotalOid,
          memoryUsedOid: vendor.memoryUsedOid,
          memoryIsPercentage: vendor.memoryIsPercentage ?? true
        };
        
        // Coletar recursos do sistema
        const resources = await getSystemResources(
          cpe.effectiveIp,
          profile,
          vendor.cpuOid,
          memoryConfig,
          vendor.cpuDivisor ?? 1
        );
        
        if (resources) {
          const now = new Date();
          
          // Para CPEs padrão com linkCpeId, salvar métricas na associação (link_cpes)
          // Para CPEs não-padrão, salvar métricas no próprio CPE
          if (cpe.isStandard && cpe.linkCpeId) {
            await db.update(linkCpes)
              .set({
                cpuUsage: resources.cpuUsage,
                memoryUsage: resources.memoryUsage,
                lastMonitoredAt: now
              })
              .where(eq(linkCpes.id, cpe.linkCpeId));
            console.log(`[Monitor/CPE] ${cpe.name} (${cpe.effectiveIp}) [linkCpe=${cpe.linkCpeId}]: CPU=${resources.cpuUsage.toFixed(1)}%, Mem=${resources.memoryUsage.toFixed(1)}%`);
          } else {
            await db.update(cpes)
              .set({
                cpuUsage: resources.cpuUsage,
                memoryUsage: resources.memoryUsage,
                lastMonitoredAt: now,
                updatedAt: now
              })
              .where(eq(cpes.id, cpe.id));
            console.log(`[Monitor/CPE] ${cpe.name} (${cpe.effectiveIp}): CPU=${resources.cpuUsage.toFixed(1)}%, Mem=${resources.memoryUsage.toFixed(1)}%`);
          }
        } else {
          console.log(`[Monitor/CPE] ${cpe.name} (${cpe.effectiveIp}): SNMP retornou null (timeout ou erro)`);
        }
      } catch (error) {
        console.error(`[Monitor/CPE] Erro ao coletar ${cpe.name}:`, error);
      }
    };
    
    // Executar coleta em paralelo com limite de concorrência
    await runWithConcurrencyLimit(monitorableCpes, PARALLEL_WORKERS, collectCpeMetrics);
    
    console.log(`[Monitor/CPE] Coleta de CPEs concluída`);
  } catch (error) {
    console.error("[Monitor/CPE] Erro na coleta de métricas dos CPEs:", error);
  }
}

// Sincronização automática do Wanguard para detecção de DDoS
let wanguardSyncInterval: ReturnType<typeof setInterval> | null = null;

async function syncWanguardForAllClients(): Promise<void> {
  try {
    // Buscar todos os clientes com Wanguard habilitado
    const clientsWithWanguard = await db
      .select({
        clientId: clientSettings.clientId,
        endpoint: clientSettings.wanguardApiEndpoint,
        user: clientSettings.wanguardApiUser,
        password: clientSettings.wanguardApiPassword,
      })
      .from(clientSettings)
      .where(
        and(
          eq(clientSettings.wanguardEnabled, true),
          isNotNull(clientSettings.wanguardApiEndpoint)
        )
      );

    if (clientsWithWanguard.length === 0) {
      return; // Nenhum cliente com Wanguard configurado
    }

    console.log(`[Wanguard Auto-Sync] Sincronizando ${clientsWithWanguard.length} cliente(s)...`);

    for (const settings of clientsWithWanguard) {
      if (!settings.endpoint || !settings.user || !settings.password) {
        continue;
      }

      try {
        // Configurar serviço Wanguard para este cliente
        wanguardService.configure({
          endpoint: settings.endpoint,
          user: settings.user,
          password: settings.password,
        });

        // Buscar anomalias ativas
        const anomalies = await wanguardService.getActiveAnomalies();
        
        if (anomalies.length === 0) {
          continue;
        }

        // Buscar links do cliente
        const clientLinks = await db
          .select()
          .from(links)
          .where(eq(links.clientId, settings.clientId));

        let createdCount = 0;
        let updatedCount = 0;

        for (const anomaly of anomalies) {
          // Tentar encontrar link correspondente pelo IP
          const matchingLink = clientLinks.find(link => 
            link.ipBlock && anomaly.ip?.startsWith(link.ipBlock.split("/")[0].slice(0, -1))
          );
          
          // Se não encontrar link, usar o primeiro link do cliente
          const targetLink = matchingLink || clientLinks[0];
          
          if (targetLink) {
            const eventData = wanguardService.mapAnomalyToEvent(anomaly, settings.clientId, targetLink.id);
            
            // Verificar se evento já existe
            const [existingEvent] = await db
              .select()
              .from(ddosEvents)
              .where(eq(ddosEvents.wanguardAnomalyId, anomaly.id))
              .limit(1);
            
            if (existingEvent) {
              // Atualizar evento existente
              await db.update(ddosEvents)
                .set({
                  endTime: eventData.endTime,
                  peakBandwidth: eventData.peakBandwidth,
                  mitigationStatus: eventData.mitigationStatus,
                  blockedPackets: eventData.blockedPackets,
                })
                .where(eq(ddosEvents.id, existingEvent.id));
              updatedCount++;
            } else {
              // Criar novo evento DDoS
              await db.insert(ddosEvents).values({
                ...eventData,
                startTime: eventData.startTime,
              });
              createdCount++;
              
              // Também criar evento no feed de eventos para visibilidade unificada
              await db.insert(events).values({
                linkId: targetLink.id,
                clientId: settings.clientId,
                type: "ddos_attack",
                title: `Ataque DDoS: ${eventData.attackType}`,
                description: `Ataque detectado em ${anomaly.ip} - Pico: ${Math.round(eventData.peakBandwidth || 0)} Gbps - Wanguard ID: ${anomaly.id}`,
              });
              
              console.log(`[Wanguard Auto-Sync] NOVO ATAQUE DDoS detectado para cliente ${settings.clientId}: ${eventData.attackType} em ${anomaly.ip}`);
            }
          }
        }

        if (createdCount > 0 || updatedCount > 0) {
          console.log(`[Wanguard Auto-Sync] Cliente ${settings.clientId}: ${createdCount} novos, ${updatedCount} atualizados`);
        }
      } catch (clientError) {
        console.error(`[Wanguard Auto-Sync] Erro no cliente ${settings.clientId}:`, clientError);
      }
    }
  } catch (error) {
    console.error("[Wanguard Auto-Sync] Erro na sincronização automática:", error);
  }
}

// Sincronização automática do OZmap para dados de splitter, OLT e rota de fibra
let ozmapSyncInterval: ReturnType<typeof setInterval> | null = null;
let currentOzmapIntervalMinutes: number = 5;

async function getOzmapSyncInterval(): Promise<number> {
  try {
    const integration = await db
      .select({ syncIntervalMinutes: externalIntegrations.syncIntervalMinutes })
      .from(externalIntegrations)
      .where(eq(externalIntegrations.provider, "ozmap"))
      .limit(1);
    
    return integration.length > 0 && integration[0].syncIntervalMinutes 
      ? integration[0].syncIntervalMinutes 
      : 5;
  } catch {
    return 5;
  }
}

async function syncOzmapForAllLinks(): Promise<void> {
  try {
    // Buscar integração OZmap global
    const integration = await db
      .select()
      .from(externalIntegrations)
      .where(eq(externalIntegrations.provider, "ozmap"))
      .limit(1);
    
    if (integration.length === 0 || !integration[0].apiKey || !integration[0].apiUrl || !integration[0].isActive) {
      console.log("[OZmap Auto-Sync] Integração não configurada ou inativa");
      return; // OZmap não configurado ou inativo
    }
    
    // Verificar se o intervalo mudou
    const newInterval = integration[0].syncIntervalMinutes || 5;
    if (newInterval !== currentOzmapIntervalMinutes && ozmapSyncInterval) {
      currentOzmapIntervalMinutes = newInterval;
      clearInterval(ozmapSyncInterval);
      ozmapSyncInterval = setInterval(() => {
        syncOzmapForAllLinks();
      }, currentOzmapIntervalMinutes * 60 * 1000);
      console.log(`[OZmap Auto-Sync] Intervalo atualizado para ${currentOzmapIntervalMinutes} minutos`);
    }

    const ozmapConfig = integration[0];
    console.log("[OZmap Auto-Sync] Iniciando sincronização...");
    
    // Normalizar URL base
    let baseUrl = ozmapConfig.apiUrl!.replace(/\/+$/, "");
    if (baseUrl.endsWith("/api/v2")) {
      baseUrl = baseUrl.slice(0, -7);
    }

    // Buscar todos os links com tag OZmap configurada
    const linksWithOzmap = await db
      .select()
      .from(links)
      .where(
        or(
          isNotNull(links.ozmapTag),
          isNotNull(links.identifier),
          isNotNull(links.voalleContractTagServiceTag)
        )
      );

    if (linksWithOzmap.length === 0) {
      console.log("[OZmap Auto-Sync] Nenhum link com tag OZmap configurada");
      return;
    }

    console.log(`[OZmap Auto-Sync] Processando ${linksWithOzmap.length} link(s)...`);

    let syncedCount = 0;
    let errorCount = 0;

    for (const link of linksWithOzmap) {
      // Determinar a tag a usar (prioridade: voalle > identifier > ozmapTag)
      const ozmapTag = link.voalleContractTagServiceTag || link.identifier || link.ozmapTag;
      
      if (!ozmapTag) continue;

      try {
        const url = `${baseUrl}/api/v2/properties/client/${encodeURIComponent(ozmapTag)}/potency?locale=pt_BR`;
        
        const response = await fetch(url, {
          method: "GET",
          headers: {
            "Accept": "application/json",
            "Authorization": ozmapConfig.apiKey!,
          },
        });

        if (!response.ok) {
          console.log(`[OZmap Auto-Sync] Link ${link.name}: Tag "${ozmapTag}" não encontrada (HTTP ${response.status})`);
          continue; // Link não encontrado no OZmap, pular
        }

        const data = await response.json();
        
        if (!Array.isArray(data) || data.length === 0) {
          console.log(`[OZmap Auto-Sync] Link ${link.name}: Sem dados de potência`);
          continue;
        }

        const potencyItem = data[0];
        
        // Extrair informações de splitter e OLT dos elementos da rota
        // Pegar o ÚLTIMO splitter da rota (mais próximo do cliente)
        let splitterName: string | null = null;
        let splitterPort: string | null = null;
        let oltName: string | null = null;
        let oltSlot: number | null = null;
        let oltPort: number | null = null;
        
        if (potencyItem.elements && Array.isArray(potencyItem.elements)) {
          console.log(`[OZmap Auto-Sync] Link ${link.name}: ${potencyItem.elements.length} elementos na rota`);
          
          // Percorrer todos os elementos para encontrar o ÚLTIMO splitter (mais próximo do cliente)
          for (const elem of potencyItem.elements) {
            // Detectar Splitter pelo kind do elemento
            if (elem.element?.kind === 'Splitter') {
              splitterName = elem.parent?.name || elem.element?.name || null;
              // Porta pode ser um objeto {id, label, number} ou um valor simples
              const portData = elem.element?.port;
              if (portData !== undefined && portData !== null) {
                if (typeof portData === 'object' && portData.number !== undefined) {
                  splitterPort = String(portData.number);
                } else if (typeof portData === 'object' && portData.label) {
                  splitterPort = String(portData.label);
                } else if (typeof portData !== 'object') {
                  splitterPort = String(portData);
                }
              } else if (elem.element?.label) {
                splitterPort = String(elem.element.label);
              }
              console.log(`[OZmap Auto-Sync] Link ${link.name}: Splitter: ${splitterName}, Porta: ${splitterPort}`);
            }
            // Detectar OLT pelo kind ou nome
            if (elem.element?.kind === 'OLT' || elem.parent?.name?.toLowerCase()?.includes('olt')) {
              oltName = elem.parent?.name || elem.element?.name || null;
              // Slot pode ser objeto ou número
              const slotData = elem.element?.slot;
              if (slotData !== undefined) {
                if (typeof slotData === 'object' && slotData.number !== undefined) {
                  oltSlot = parseInt(String(slotData.number), 10);
                } else if (typeof slotData !== 'object') {
                  oltSlot = parseInt(String(slotData), 10);
                }
              }
              // Port pode ser objeto ou número
              const portData = elem.element?.port;
              if (portData !== undefined) {
                if (typeof portData === 'object' && portData.number !== undefined) {
                  oltPort = parseInt(String(portData.number), 10);
                } else if (typeof portData !== 'object') {
                  oltPort = parseInt(String(portData), 10);
                }
              }
            }
          }
        }
        
        // Dados do nível superior
        if (potencyItem.olt_name) oltName = potencyItem.olt_name;
        // Slot e port no nível superior também podem ser objetos
        if (potencyItem.slot !== undefined) {
          if (typeof potencyItem.slot === 'object' && potencyItem.slot?.number !== undefined) {
            oltSlot = parseInt(String(potencyItem.slot.number), 10);
          } else if (typeof potencyItem.slot !== 'object') {
            oltSlot = parseInt(String(potencyItem.slot), 10);
          }
        }
        if (potencyItem.port !== undefined) {
          if (typeof potencyItem.port === 'object' && potencyItem.port?.number !== undefined) {
            oltPort = parseInt(String(potencyItem.port.number), 10);
          } else if (typeof potencyItem.port !== 'object') {
            oltPort = parseInt(String(potencyItem.port), 10);
          }
        }
        
        // Preparar update
        const ozmapUpdate: any = {
          ozmapDistance: potencyItem.distance || null,
          ozmapArrivingPotency: potencyItem.arriving_potency || null,
          ozmapAttenuation: potencyItem.attenuation || null,
          ozmapPonReached: potencyItem.pon_reached || false,
          ozmapLastSync: new Date(),
        };
        
        if (splitterName) ozmapUpdate.ozmapSplitterName = splitterName;
        if (splitterPort) ozmapUpdate.ozmapSplitterPort = splitterPort;
        if (oltName) ozmapUpdate.ozmapOltName = oltName;
        if (oltSlot !== null) ozmapUpdate.ozmapSlot = oltSlot;
        if (oltPort !== null) ozmapUpdate.ozmapPort = oltPort;
        
        // Usar potência de chegada do OZmap como baseline RX automaticamente
        if (potencyItem.arriving_potency !== undefined && potencyItem.arriving_potency !== null) {
          ozmapUpdate.opticalRxBaseline = potencyItem.arriving_potency;
        }
        
        await db.update(links)
          .set(ozmapUpdate)
          .where(eq(links.id, link.id));
        
        console.log(`[OZmap Auto-Sync] Link ${link.name}: Salvo - Splitter: ${splitterName || 'N/A'}, Porta: ${splitterPort || 'N/A'}, Potência: ${potencyItem.arriving_potency || 'N/A'}`);
        syncedCount++;
      } catch (linkError) {
        console.error(`[OZmap Auto-Sync] Link ${link.name}: Erro -`, linkError);
        errorCount++;
      }
    }

    console.log(`[OZmap Auto-Sync] Concluído: ${syncedCount} sincronizados, ${errorCount} erros`);
  } catch (error) {
    console.error("[OZmap Auto-Sync] Erro na sincronização automática:", error);
  }
}

export function startRealTimeMonitoring(intervalSeconds: number = 30): void {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
  }
  if (wanguardSyncInterval) {
    clearInterval(wanguardSyncInterval);
  }
  if (ozmapSyncInterval) {
    clearInterval(ozmapSyncInterval);
  }

  console.log(`[Monitor] Starting real-time monitoring with ${intervalSeconds}s interval`);

  collectAllLinksMetrics();
  syncWanguardForAllClients(); // Sincronização inicial
  syncOzmapForAllLinks(); // Sincronização inicial do OZmap

  monitoringInterval = setInterval(() => {
    collectAllLinksMetrics();
  }, intervalSeconds * 1000);

  // Sincronização do Wanguard a cada 120 segundos (reduzido de 60s para economizar CPU)
  wanguardSyncInterval = setInterval(() => {
    syncWanguardForAllClients();
  }, 120 * 1000);
  
  // Sincronização do OZmap - intervalo configurável
  getOzmapSyncInterval().then((intervalMinutes) => {
    currentOzmapIntervalMinutes = intervalMinutes;
    ozmapSyncInterval = setInterval(() => {
      syncOzmapForAllLinks();
    }, intervalMinutes * 60 * 1000);
    console.log(`[OZmap Auto-Sync] Sincronização automática iniciada (${intervalMinutes}min)`);
  });
  
  console.log(`[Wanguard Auto-Sync] Sincronização automática iniciada (120s)`);
}

export function stopMonitoring(): void {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
    monitoringInterval = null;
    console.log("[Monitor] Monitoring stopped");
  }
  if (wanguardSyncInterval) {
    clearInterval(wanguardSyncInterval);
    wanguardSyncInterval = null;
    console.log("[Wanguard Auto-Sync] Sincronização automática parada");
  }
  if (ozmapSyncInterval) {
    clearInterval(ozmapSyncInterval);
    ozmapSyncInterval = null;
    console.log("[OZmap Auto-Sync] Sincronização automática parada");
  }
}

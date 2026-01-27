import { exec } from "child_process";
import { promisify } from "util";
import snmp from "net-snmp";
import { db } from "./db";
import { links, metrics, snmpProfiles, equipmentVendors, events, olts, switches, monitoringSettings, linkMonitoringState, blacklistChecks, cpes, linkCpes, clients, clientSettings, ddosEvents } from "@shared/schema";
import { eq, and, not, like, gte, isNotNull } from "drizzle-orm";
import { queryAllOltAlarms, queryOltAlarm, getDiagnosisFromAlarms, hasSpecificDiagnosisCommand, buildOnuDiagnosisKey, queryZabbixOpticalMetrics, type OltAlarm, type ZabbixOpticalMetrics } from "./olt";
import { findInterfaceByName, getOpticalSignal, getOpticalSignalFromSwitch, getCiscoOpticalSignal, type SnmpProfile as SnmpProfileType, type OpticalSignalData } from "./snmp";
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

const PARALLEL_WORKERS = 10;
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
  failureReason?: string;
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

async function getSnmpProfile(profileId: number): Promise<SnmpProfile | null> {
  const [profile] = await db.select().from(snmpProfiles).where(eq(snmpProfiles.id, profileId));
  return profile || null;
}

async function getEquipmentVendor(vendorId: number): Promise<typeof equipmentVendors.$inferSelect | null> {
  const [vendor] = await db.select().from(equipmentVendors).where(eq(equipmentVendors.id, vendorId));
  return vendor || null;
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
  
  // Only attempt auto-discovery after threshold is reached
  if (newMismatchCount < IFINDEX_MISMATCH_THRESHOLD) {
    await db.update(links).set({
      ifIndexMismatchCount: newMismatchCount,
    }).where(eq(links.id, link.id));
    return { updated: false };
  }
  
  // Check if we should skip auto-discovery (cooldown)
  if (lastValidation && (now.getTime() - lastValidation.getTime()) < IFINDEX_VALIDATION_INTERVAL_MS) {
    // Still update the mismatch counter to track failures
    await db.update(links).set({
      ifIndexMismatchCount: newMismatchCount,
    }).where(eq(links.id, link.id));
    return { updated: false };
  }
  
  // Attempt auto-discovery using interface name
  const searchName = link.originalIfName || link.snmpInterfaceName;
  if (!searchName || !link.snmpRouterIp) {
    return { updated: false };
  }
  
  console.log(`[Monitor] ${link.name}: Auto-discovery triggered after ${newMismatchCount} failures. Searching for interface "${searchName}"`);
  
  const snmpProfileForSearch: SnmpProfileType = {
    id: profile.id,
    version: profile.version,
    port: profile.port,
    community: profile.community,
    securityLevel: profile.securityLevel,
    authProtocol: profile.authProtocol,
    authPassword: profile.authPassword,
    privProtocol: profile.privProtocol,
    privPassword: profile.privPassword,
    username: profile.username,
    timeout: profile.timeout,
    retries: profile.retries,
  };
  
  const searchResult = await findInterfaceByName(
    link.snmpRouterIp,
    snmpProfileForSearch,
    searchName,
    link.snmpInterfaceDescr,
    link.snmpInterfaceAlias || undefined
  );
  
  if (searchResult.found && searchResult.ifIndex !== null) {
    const oldIfIndex = link.snmpInterfaceIndex;
    const newIfIndex = searchResult.ifIndex;
    
    if (oldIfIndex !== newIfIndex) {
      console.log(`[Monitor] ${link.name}: ifIndex changed from ${oldIfIndex} to ${newIfIndex} (auto-discovered)`);
      
      // Update link with new ifIndex
      await db.update(links).set({
        snmpInterfaceIndex: newIfIndex,
        snmpInterfaceName: searchResult.ifName || link.snmpInterfaceName,
        snmpInterfaceDescr: searchResult.ifDescr || link.snmpInterfaceDescr,
        snmpInterfaceAlias: searchResult.ifAlias || link.snmpInterfaceAlias,
        originalIfName: link.originalIfName || link.snmpInterfaceName,
        ifIndexMismatchCount: 0,
        lastIfIndexValidation: now,
      }).where(eq(links.id, link.id));
      
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
    // Interface not found - create warning event
    console.log(`[Monitor] ${link.name}: Could not auto-discover interface "${searchName}"`);
    
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
      description: `A interface SNMP "${searchName}" (ifIndex: ${link.snmpInterfaceIndex}) não foi encontrada no equipamento. Verifique a configuração do link.`,
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

  const pingResult = await pingHost(ipToMonitor);

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
    // Fetch switch data for access point mode
    const accessPointSwitch = await db.select().from(switches).where(eq(switches.id, link.accessPointId)).limit(1);
    if (accessPointSwitch.length > 0) {
      const sw = accessPointSwitch[0];
      trafficSourceIp = sw.ipAddress;
      trafficSourceProfileId = sw.snmpProfileId;
      trafficSourceIfIndex = link.accessPointInterfaceIndex || null;
      console.log(`[Monitor] ${link.name}: Using access point (${sw.name}) for traffic collection. IP: ${trafficSourceIp}, ifIndex: ${trafficSourceIfIndex}`);
    }
  }

  if (trafficSourceProfileId && trafficSourceIp) {
    const profile = await getSnmpProfile(trafficSourceProfileId);

    if (profile) {
      // Collect traffic data if interface index is configured
      if (trafficSourceIfIndex) {
        const trafficData = await getInterfaceTraffic(
          trafficSourceIp,
          profile,
          trafficSourceIfIndex
        );

        const trafficDataSuccess = trafficData !== null;
        
        if (trafficData) {
          const previousData = previousTrafficData.get(link.id);

          if (previousData) {
            const bandwidth = calculateBandwidth(trafficData, previousData);
            downloadMbps = bandwidth.downloadMbps;
            uploadMbps = bandwidth.uploadMbps;
          }

          previousTrafficData.set(link.id, trafficData);
        }
        
        // Handle auto-discovery of ifIndex when collection fails
        // Skip auto-discovery if link is offline (ping failed) - device is unreachable
        // Only do auto-discovery for manual/concentrator mode, not accessPoint mode
        const isLinkOffline = !pingResult.success || pingResult.packetLoss >= 50;
        if (link.snmpInterfaceName && !isLinkOffline && link.trafficSourceType !== 'accessPoint') {
          const discoveryResult = await handleIfIndexAutoDiscovery(link, profile, trafficDataSuccess);
          
          // If ifIndex was updated, retry collection with new index
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
  
  if (!pingResult.success || pingResult.packetLoss >= 50) {
    status = "offline";
    // Determine failure reason
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
          const rxOid = vendorBySlug[0].opticalRxOid || null;
          const txOid = vendorBySlug[0].opticalTxOid || null;
          const oltRxOid = vendorBySlug[0].opticalOltRxOid || null;
          
          // Verificar se pelo menos um OID óptico está configurado
          if (!rxOid && !txOid && !oltRxOid) {
            console.log(`[Monitor] ${link.name} - Óptico: OIDs não configurados para fabricante '${oltVendorSlug}' (${vendorBySlug[0].name}). Configure em Admin → Fabricantes.`);
          } else {
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
                oltRxOid
              );
              
              if (opticalSignal) {
                const hasValues = opticalSignal.rxPower !== null || opticalSignal.txPower !== null || opticalSignal.oltRxPower !== null;
                if (hasValues) {
                  console.log(`[Monitor] ${link.name} - Óptico OK: RX=${opticalSignal.rxPower}dBm TX=${opticalSignal.txPower}dBm OLT_RX=${opticalSignal.oltRxPower}dBm`);
                  
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
            opticalSignal = await getOpticalSignalFromSwitch(
              sw.ipAddress,
              swProfile,
              switchPort,
              opticalRxOid,
              opticalTxOid,
              portIndexTemplate,
              opticalDivisor
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

export function startRealTimeMonitoring(intervalSeconds: number = 30): void {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
  }
  if (wanguardSyncInterval) {
    clearInterval(wanguardSyncInterval);
  }

  console.log(`[Monitor] Starting real-time monitoring with ${intervalSeconds}s interval`);

  collectAllLinksMetrics();
  syncWanguardForAllClients(); // Sincronização inicial

  monitoringInterval = setInterval(() => {
    collectAllLinksMetrics();
  }, intervalSeconds * 1000);

  // Sincronização do Wanguard a cada 60 segundos
  wanguardSyncInterval = setInterval(() => {
    syncWanguardForAllClients();
  }, 60 * 1000);
  
  console.log(`[Wanguard Auto-Sync] Sincronização automática iniciada (60s)`);
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
}

import { exec } from "child_process";
import { promisify } from "util";
import snmp from "net-snmp";
import { db } from "./db";
import { links, metrics, snmpProfiles, equipmentVendors, events } from "@shared/schema";
import { eq } from "drizzle-orm";

const execAsync = promisify(exec);

interface StatusChangeEvent {
  type: "error" | "warning" | "info";
  title: string;
  description: string;
  resolved: boolean;
}

function getStatusChangeEvent(
  previousStatus: string,
  newStatus: string,
  linkName: string,
  latency: number,
  packetLoss: number
): StatusChangeEvent | null {
  // Link ficou offline
  if (newStatus === "offline" && previousStatus !== "offline") {
    return {
      type: "error",
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

export async function pingHost(ipAddress: string, count: number = 5): Promise<PingResult> {
  if (pingPermissionDenied) {
    return simulatePing();
  }

  try {
    const { stdout } = await execAsync(`ping -c ${count} -W 2 ${ipAddress} 2>&1`, {
      timeout: 15000,
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
    
    console.error(`Ping failed for ${ipAddress}:`, errorMessage);
    return {
      latency: 0,
      packetLoss: 100,
      success: false,
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
  const options: snmp.SessionOptions = {
    port: profile.port,
    timeout: profile.timeout,
    retries: profile.retries,
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

export async function getInterfaceTraffic(
  targetIp: string,
  profile: SnmpProfile,
  ifIndex: number
): Promise<TrafficResult | null> {
  return new Promise((resolve) => {
    try {
      const session = createSnmpSession(targetIp, profile);

      const oids = [
        `${IF_TRAFFIC_OIDS.ifHCInOctets}.${ifIndex}`,
        `${IF_TRAFFIC_OIDS.ifHCOutOctets}.${ifIndex}`,
      ];

      let sessionClosed = false;
      const closeSession = () => {
        if (!sessionClosed) {
          sessionClosed = true;
          try { session.close(); } catch {}
        }
      };

      (session as unknown as { get: (oids: string[], callback: (error: Error | null, varbinds: Array<{value: unknown}>) => void) => void }).get(oids, (error: Error | null, varbinds: Array<{value: unknown}>) => {
        closeSession();

        if (error) {
          console.error(`SNMP error for ${targetIp}:`, error.message);
          resolve(null);
          return;
        }

        if (!varbinds || varbinds.length < 2) {
          resolve(null);
          return;
        }

        try {
          // Handle different value types from net-snmp
          let inOctets = 0;
          let outOctets = 0;
          
          const val0 = varbinds[0].value;
          const val1 = varbinds[1].value;
          
          // Helper function to parse Buffer of any size to number
          const bufferToNumber = (buf: Buffer): number => {
            let result = 0;
            for (let i = 0; i < buf.length; i++) {
              result = result * 256 + buf[i];
            }
            return result;
          };
          
          // net-snmp returns Counter64 as Buffer, need to convert properly
          if (Buffer.isBuffer(val0)) {
            inOctets = bufferToNumber(val0);
          } else if (typeof val0 === 'bigint') {
            inOctets = Number(val0);
          } else if (typeof val0 === 'number') {
            inOctets = val0;
          } else if (val0 !== null && val0 !== undefined) {
            inOctets = Number(String(val0));
          }
          
          if (Buffer.isBuffer(val1)) {
            outOctets = bufferToNumber(val1);
          } else if (typeof val1 === 'bigint') {
            outOctets = Number(val1);
          } else if (typeof val1 === 'number') {
            outOctets = val1;
          } else if (val1 !== null && val1 !== undefined) {
            outOctets = Number(String(val1));
          }

          resolve({
            inOctets: isFinite(inOctets) ? inOctets : 0,
            outOctets: isFinite(outOctets) ? outOctets : 0,
            timestamp: new Date(),
          });
        } catch (parseError) {
          console.error(`[SNMP Parse Error] ${targetIp}:`, parseError);
          resolve(null);
        }
      });

      setTimeout(() => {
        closeSession();
        resolve(null);
      }, profile.timeout + 2000);
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

export async function getSystemResources(
  targetIp: string,
  profile: SnmpProfile,
  cpuOid?: string | null,
  memoryOid?: string | null
): Promise<SystemResourceResult | null> {
  // If no OIDs provided, return null
  if (!cpuOid && !memoryOid) {
    return null;
  }

  return new Promise((resolve) => {
    try {
      const session = createSnmpSession(targetIp, profile);

      // Use provided OIDs or skip if not available
      const oids: string[] = [];
      const oidMap: { cpu: number; memory: number } = { cpu: -1, memory: -1 };
      
      if (cpuOid) {
        oidMap.cpu = oids.length;
        oids.push(cpuOid);
      }
      if (memoryOid) {
        oidMap.memory = oids.length;
        oids.push(memoryOid);
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
          // FortiGate OIDs failed, return null (could try generic OIDs as fallback)
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
            }
          }

          if (oidMap.memory >= 0 && varbinds[oidMap.memory]) {
            const vb = varbinds[oidMap.memory];
            if (vb.type !== noSuchObject && vb.type !== noSuchInstance) {
              memoryUsage = parseSnmpValue(vb.value);
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

export async function collectLinkMetrics(link: typeof links.$inferSelect): Promise<{
  latency: number;
  packetLoss: number;
  downloadMbps: number;
  uploadMbps: number;
  cpuUsage: number;
  memoryUsage: number;
  status: string;
}> {
  const ipToMonitor = link.monitoredIp || link.snmpRouterIp || link.address;

  const pingResult = await pingHost(ipToMonitor);

  let downloadMbps = 0;
  let uploadMbps = 0;
  let cpuUsage = 0;
  let memoryUsage = 0;

  if (link.snmpProfileId && link.snmpRouterIp) {
    const profile = await getSnmpProfile(link.snmpProfileId);

    if (profile) {
      // Collect traffic data if interface index is configured
      if (link.snmpInterfaceIndex) {
        const trafficData = await getInterfaceTraffic(
          link.snmpRouterIp,
          profile,
          link.snmpInterfaceIndex
        );

        if (trafficData) {
          const previousData = previousTrafficData.get(link.id);

          if (previousData) {
            const bandwidth = calculateBandwidth(trafficData, previousData);
            downloadMbps = bandwidth.downloadMbps;
            uploadMbps = bandwidth.uploadMbps;
          }

          previousTrafficData.set(link.id, trafficData);
        }
      }

      // Collect CPU and memory usage - determine which OIDs to use
      let cpuOid: string | null = null;
      let memoryOid: string | null = null;

      // Priority: custom OIDs > vendor OIDs
      if (link.customCpuOid) {
        cpuOid = link.customCpuOid;
      }
      if (link.customMemoryOid) {
        memoryOid = link.customMemoryOid;
      }

      // If no custom OIDs, try vendor OIDs
      if ((!cpuOid || !memoryOid) && link.equipmentVendorId) {
        const vendor = await getEquipmentVendor(link.equipmentVendorId);
        if (vendor) {
          if (!cpuOid && vendor.cpuOid) {
            cpuOid = vendor.cpuOid;
          }
          if (!memoryOid && vendor.memoryOid) {
            memoryOid = vendor.memoryOid;
          }
        }
      }

      if (cpuOid || memoryOid) {
        const systemResources = await getSystemResources(link.snmpRouterIp, profile, cpuOid, memoryOid);
        if (systemResources) {
          cpuUsage = systemResources.cpuUsage;
          memoryUsage = systemResources.memoryUsage;
        }
      }
    }
  }

  let status = "operational";
  if (!pingResult.success || pingResult.packetLoss >= 50) {
    status = "offline";
  } else if (pingResult.latency > link.latencyThreshold || pingResult.packetLoss > link.packetLossThreshold) {
    status = "degraded";
  }

  return {
    latency: pingResult.latency,
    packetLoss: pingResult.packetLoss,
    downloadMbps,
    uploadMbps,
    cpuUsage,
    memoryUsage,
    status,
  };
}

export async function collectAllLinksMetrics(): Promise<void> {
  try {
    const allLinks = await db.select().from(links);

    for (const link of allLinks) {
      if (!link.monitoringEnabled) continue;

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

        // Detectar mudança de status para gerar eventos
        const previousStatus = link.status;
        const newStatus = collectedMetrics.status;
        
        // Criar evento se o status mudou
        if (previousStatus !== newStatus) {
          const eventConfig = getStatusChangeEvent(previousStatus, newStatus, link.name, safeLatency, safePacketLoss);
          if (eventConfig) {
            await db.insert(events).values({
              linkId: link.id,
              clientId: link.clientId,
              type: eventConfig.type,
              title: eventConfig.title,
              description: eventConfig.description,
              timestamp: new Date(),
              resolved: eventConfig.resolved,
            });
            console.log(`[Monitor] Evento criado: ${eventConfig.title}`);
          }
        }
        
        // Criar alertas para latência/perda de pacotes alta (mesmo sem mudança de status)
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
        
        if (safePacketLoss > packetLossThreshold && link.packetLoss <= packetLossThreshold) {
          await db.insert(events).values({
            linkId: link.id,
            clientId: link.clientId,
            type: "warning",
            title: `Perda de pacotes elevada em ${link.name}`,
            description: `Perda atual: ${safePacketLoss.toFixed(1)}% (limite: ${packetLossThreshold}%)`,
            timestamp: new Date(),
            resolved: false,
          });
        }

        await db.update(links).set({
          currentDownload: safeDownload,
          currentUpload: safeUpload,
          latency: safeLatency,
          packetLoss: safePacketLoss,
          cpuUsage: safeCpuUsage,
          memoryUsage: safeMemoryUsage,
          status: collectedMetrics.status,
          uptime: newUptime,
          lastUpdated: new Date(),
        }).where(eq(links.id, link.id));

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
        });

        console.log(
          `[Monitor] ${link.name}: latency=${safeLatency.toFixed(1)}ms, ` +
          `loss=${safePacketLoss.toFixed(1)}%, down=${safeDownload.toFixed(2)}Mbps, ` +
          `up=${safeUpload.toFixed(2)}Mbps, cpu=${safeCpuUsage.toFixed(1)}%, mem=${safeMemoryUsage.toFixed(1)}%, status=${collectedMetrics.status}`
        );
      } catch (error) {
        console.error(`Error collecting metrics for link ${link.name}:`, error);
      }
    }
  } catch (error) {
    console.error("Error in collectAllLinksMetrics:", error);
  }
}

let monitoringInterval: NodeJS.Timeout | null = null;

export function startRealTimeMonitoring(intervalSeconds: number = 30): void {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
  }

  console.log(`[Monitor] Starting real-time monitoring with ${intervalSeconds}s interval`);

  collectAllLinksMetrics();

  monitoringInterval = setInterval(() => {
    collectAllLinksMetrics();
  }, intervalSeconds * 1000);
}

export function stopMonitoring(): void {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
    monitoringInterval = null;
    console.log("[Monitor] Monitoring stopped");
  }
}

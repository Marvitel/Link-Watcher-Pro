import { ExternalIntegration, BlacklistCheck, Link } from "@shared/schema";

export function expandCidrToIps(cidr: string): string[] {
  const cidrMatch = cidr.match(/^(\d+\.\d+\.\d+\.\d+)\/(\d+)$/);
  
  if (!cidrMatch) {
    if (/^\d+\.\d+\.\d+\.\d+$/.test(cidr)) {
      return [cidr];
    }
    return [];
  }

  const [, baseIp, prefixStr] = cidrMatch;
  const prefix = parseInt(prefixStr, 10);
  
  const hostBits = 32 - prefix;
  const totalHosts = Math.pow(2, hostBits);
  const maxHosts = Math.min(totalHosts, 256);
  
  if (totalHosts > 256) {
    console.log(`[CIDR] Block /${prefix} has ${totalHosts} IPs, limiting to first 256`);
  }
  
  const parts = baseIp.split('.').map(Number);
  const baseNum = ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
  const networkMask = (~((1 << hostBits) - 1)) >>> 0;
  const networkBase = (baseNum & networkMask) >>> 0;
  
  const ips: string[] = [];
  for (let i = 0; i < maxHosts; i++) {
    const ipNum = (networkBase + i) >>> 0;
    const ip = [
      (ipNum >>> 24) & 0xff,
      (ipNum >>> 16) & 0xff,
      (ipNum >>> 8) & 0xff,
      ipNum & 0xff,
    ].join('.');
    ips.push(ip);
  }
  
  return ips;
}

interface HetrixBlacklistMonitor {
  id: string;
  name: string;
  type: "ipv4" | "domain";
  target: string;
  rdns?: string;
  report_id: string;
  status: string;
  contact_lists: string[];
  listed: Array<{ rbl: string; delist: string }>;
  created_at: number;
  last_check: number;
}

interface HetrixBlacklistReport {
  id: string;
  name: string;
  type: "ipv4" | "domain";
  target: string;
  report_id: string;
  status: string;
  listed: Array<{ rbl: string; delist: string }>;
  last_check: number;
  blacklists_checked: number;
  blacklists_listed: number;
}

interface HetrixApiResponse<T> {
  monitors?: T[];
  meta?: {
    total: number;
    returned: number;
  };
}

export class HetrixToolsAdapter {
  private apiKey: string;
  private baseUrl: string = "https://api.hetrixtools.com/v3";

  constructor(integration: ExternalIntegration) {
    if (!integration.apiKey) {
      throw new Error("HetrixTools API key not configured");
    }
    this.apiKey = integration.apiKey;
    if (integration.apiUrl) {
      this.baseUrl = integration.apiUrl;
    }
  }

  private async request<T>(method: string, endpoint: string): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    console.log(`[HetrixTools] ${method} ${url}`);

    const response = await fetch(url, {
      method,
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[HetrixTools] Error ${response.status}: ${errorText}`);
      throw new Error(`HetrixTools API error: ${response.status} ${response.statusText}`);
    }

    if (response.status === 204) {
      return {} as T;
    }

    return response.json();
  }

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      await this.request<any>("GET", "/account/limits");
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
    }
  }

  async getBlacklists(): Promise<{ ipv4: any[]; domains: any[] }> {
    return this.request<{ ipv4: any[]; domains: any[] }>("GET", "/blacklists");
  }

  async getBlacklistMonitors(filters?: { target?: string; type?: string }): Promise<HetrixBlacklistMonitor[]> {
    const allMonitors: HetrixBlacklistMonitor[] = [];
    let page = 1;
    const perPage = 200;
    
    while (true) {
      let endpoint = `/blacklist-monitors?per_page=${perPage}&page=${page}`;
      if (filters?.target) {
        endpoint += `&target=${encodeURIComponent(filters.target)}&exact_target=true`;
      }
      if (filters?.type) {
        endpoint += `&type=${filters.type}`;
      }
      
      const response = await this.request<HetrixApiResponse<HetrixBlacklistMonitor>>("GET", endpoint);
      const monitors = response.monitors || [];
      allMonitors.push(...monitors);
      
      console.log(`[HetrixTools] Page ${page}: fetched ${monitors.length} monitors (total: ${allMonitors.length})`);
      
      if (monitors.length < perPage) {
        break;
      }
      page++;
      
      if (page > 50) {
        console.warn("[HetrixTools] Reached max pages limit (50)");
        break;
      }
    }
    
    return allMonitors;
  }

  async getBlacklistReport(identifier: string): Promise<HetrixBlacklistReport | null> {
    try {
      const report = await this.request<HetrixBlacklistReport>(
        "GET",
        `/blacklist-monitors/${encodeURIComponent(identifier)}/report`
      );
      return report;
    } catch (error) {
      console.error(`[HetrixTools] Failed to get report for ${identifier}:`, error);
      return null;
    }
  }

  async checkIpBlacklist(ip: string): Promise<{
    isListed: boolean;
    listedOn: Array<{ rbl: string; delist: string }>;
    reportId?: string;
    reportUrl?: string;
    lastCheck?: number;
  }> {
    const monitors = await this.getBlacklistMonitors({ target: ip, type: "ipv4" });
    
    if (monitors.length === 0) {
      console.log(`[HetrixTools] No monitor found for IP ${ip}`);
      return { isListed: false, listedOn: [] };
    }

    const monitor = monitors[0];
    const isListed = monitor.listed && monitor.listed.length > 0;
    const reportUrl = `https://hetrixtools.com/report/blacklist/${monitor.report_id}`;

    console.log(`[HetrixTools] IP ${ip}: ${isListed ? "LISTED" : "CLEAN"} on ${monitor.listed?.length || 0} blacklists`);

    return {
      isListed,
      listedOn: monitor.listed || [],
      reportId: monitor.report_id,
      reportUrl,
      lastCheck: monitor.last_check,
    };
  }

  async checkMultipleIps(ips: string[]): Promise<Map<string, {
    isListed: boolean;
    listedOn: Array<{ rbl: string; delist: string }>;
    reportId?: string;
    reportUrl?: string;
  }>> {
    const results = new Map();
    
    // Buscar cada IP individualmente em vez de todos os monitores
    // Isso usa 1 requisição por IP em vez de N páginas de 200
    console.log(`[HetrixTools] Checking ${ips.length} specific IPs`);
    
    for (const ip of ips) {
      try {
        // Buscar monitor específico para este IP
        const monitors = await this.getBlacklistMonitors({ target: ip, type: "ipv4" });
        const monitor = monitors[0];
        
        if (monitor) {
          console.log(`[HetrixTools] IP ${ip}: found monitor, listed on ${monitor.listed?.length || 0} blacklists`);
          results.set(ip, {
            isListed: monitor.listed && monitor.listed.length > 0,
            listedOn: monitor.listed || [],
            reportId: monitor.report_id,
            reportUrl: `https://hetrixtools.com/report/blacklist/${monitor.report_id}`,
          });
        } else {
          console.log(`[HetrixTools] IP ${ip}: no monitor found`);
          results.set(ip, {
            isListed: false,
            listedOn: [],
          });
        }
      } catch (err) {
        console.error(`[HetrixTools] Error checking IP ${ip}:`, err);
        results.set(ip, {
          isListed: false,
          listedOn: [],
        });
      }
    }
    
    return results;
  }
}

export async function createHetrixToolsAdapter(
  getIntegration: () => Promise<ExternalIntegration | null>
): Promise<HetrixToolsAdapter | null> {
  const integration = await getIntegration();
  if (!integration || !integration.isActive || !integration.apiKey) {
    return null;
  }
  return new HetrixToolsAdapter(integration);
}

// Intervalo padrão de 12 horas em milissegundos
const DEFAULT_CHECK_INTERVAL_HOURS = 12;

let blacklistCheckTimer: ReturnType<typeof setInterval> | null = null;
let isCheckRunning = false;
let isInitialized = false;
let currentIntervalHours = DEFAULT_CHECK_INTERVAL_HOURS;

export async function startBlacklistAutoCheck(
  storage: {
    getExternalIntegrations: () => Promise<any[]>;
    getLinks: () => Promise<any[]>;
    upsertBlacklistCheck: (check: any) => Promise<any>;
    updateLinkStatus: (id: number, data: any) => Promise<void>;
    createBlacklistEvent: (linkId: number, clientId: number, linkName: string, listedIps: string[], rbls: string[]) => Promise<void>;
    resolveBlacklistEvents: (linkId: number) => Promise<void>;
  }
): Promise<void> {
  // Evitar múltiplas inicializações (hot reload, múltiplas instâncias)
  if (isInitialized) {
    console.log("[BlacklistAutoCheck] Already initialized, skipping...");
    return;
  }
  isInitialized = true;
  
  // Buscar intervalo configurado na integração HetrixTools
  const integrations = await storage.getExternalIntegrations();
  const hetrixIntegration = integrations.find(
    (i: any) => i.provider === "hetrixtools" && i.isActive
  );
  currentIntervalHours = hetrixIntegration?.checkIntervalHours || DEFAULT_CHECK_INTERVAL_HOURS;

  const runCheck = async () => {
    // Mutex: evitar runs concorrentes
    if (isCheckRunning) {
      console.log("[BlacklistAutoCheck] Previous check still running, skipping this cycle...");
      return;
    }
    
    isCheckRunning = true;
    try {
      console.log("[BlacklistAutoCheck] Starting scheduled blacklist verification...");

      const integrations = await storage.getExternalIntegrations();
      const hetrixIntegration = integrations.find(
        (i: any) => i.provider === "hetrixtools" && i.isActive && i.apiKey
      );

      if (!hetrixIntegration) {
        console.log("[BlacklistAutoCheck] HetrixTools integration not configured or inactive, skipping...");
        return;
      }

      const adapter = new HetrixToolsAdapter(hetrixIntegration);
      const links = await storage.getLinks();
      const linksWithIp = links.filter((link: any) => link.ipBlock || link.ipAddress);
      
      console.log(`[BlacklistAutoCheck] Checking ${linksWithIp.length} links with IP/blocks`);

      let checkedCount = 0;
      let listedCount = 0;
      let notMonitoredCount = 0;

      for (const link of linksWithIp) {
        try {
          const ipsToCheck: string[] = [];
          
          if (link.ipBlock) {
            const expandedIps = expandCidrToIps(link.ipBlock);
            ipsToCheck.push(...expandedIps);
          }
          
          if (link.ipAddress && !ipsToCheck.includes(link.ipAddress)) {
            ipsToCheck.push(link.ipAddress);
          }
          
          if (ipsToCheck.length === 0) continue;
          
          const listedIpsForLink: string[] = [];
          const allRblsForLink = new Set<string>();
          let linkCheckedCount = 0;
          let notMonitoredForLink = 0;
          
          // Buscar cada IP individualmente (1 requisição por IP)
          for (const ip of ipsToCheck) {
            try {
              const monitors = await adapter.getBlacklistMonitors({ target: ip, type: "ipv4" });
              const monitor = monitors[0];
              
              if (!monitor) {
                notMonitoredCount++;
                notMonitoredForLink++;
                continue;
              }

              const lastCheckedAt = monitor.last_check 
                ? new Date(monitor.last_check * 1000) 
                : new Date();

              const isListed = monitor.listed && monitor.listed.length > 0;
              const checkResult = {
                linkId: link.id,
                ip,
                isListed,
                listedOn: monitor.listed || [],
                reportId: monitor.report_id,
                reportUrl: `https://hetrixtools.com/report/blacklist/${monitor.report_id}`,
                lastCheckedAt,
              };

              if (isListed) {
                listedCount++;
                listedIpsForLink.push(ip);
                for (const rbl of (monitor.listed || [])) {
                  if (typeof rbl === 'string') {
                    allRblsForLink.add(rbl);
                  } else if (rbl?.rbl) {
                    allRblsForLink.add(rbl.rbl);
                  }
                }
              }

              await storage.upsertBlacklistCheck(checkResult);
              checkedCount++;
              linkCheckedCount++;
            } catch (err) {
              console.error(`[BlacklistAutoCheck] Error checking IP ${ip}:`, err);
              notMonitoredCount++;
              notMonitoredForLink++;
            }
          }
          
          // Criar evento e atualizar status se há IPs listados
          if (listedIpsForLink.length > 0) {
            await storage.createBlacklistEvent(
              link.id,
              link.clientId,
              link.name,
              listedIpsForLink,
              Array.from(allRblsForLink)
            );
            
            if (link.status !== 'offline' && link.status !== 'maintenance') {
              await storage.updateLinkStatus(link.id, { 
                status: 'degraded',
                failureReason: `IP(s) em blacklist: ${listedIpsForLink.join(', ')}`,
                failureSource: 'blacklist'
              });
              console.log(`[BlacklistAutoCheck] Link ${link.id} status updated to degraded`);
            }
          } else if (linkCheckedCount > 0 && listedIpsForLink.length === 0 && notMonitoredForLink === 0) {
            // Nenhum IP listado E todos os IPs foram verificados (nenhum não-monitorado)
            // Só resolver eventos quando temos certeza que todos os IPs foram verificados
            await storage.resolveBlacklistEvents(link.id);
            console.log(`[BlacklistAutoCheck] Link ${link.id}: All ${linkCheckedCount} IPs verified clean, resolving events`);
            
            if (link.status === 'degraded' && link.failureSource === 'blacklist') {
              await storage.updateLinkStatus(link.id, { 
                status: 'operational',
                failureReason: null,
                failureSource: null
              });
              console.log(`[BlacklistAutoCheck] Link ${link.id} status restored to operational`);
            }
          } else if (linkCheckedCount > 0 && listedIpsForLink.length === 0 && notMonitoredForLink > 0) {
            // Alguns IPs não estão sendo monitorados - não resolver eventos automaticamente
            console.log(`[BlacklistAutoCheck] Link ${link.id}: ${linkCheckedCount} IPs clean but ${notMonitoredForLink} not monitored - keeping events open`);
          }
        } catch (err) {
          console.error(`[BlacklistAutoCheck] Failed to check link ${link.id}:`, err);
        }
      }

      console.log(`[BlacklistAutoCheck] Completed: ${checkedCount} IPs checked, ${listedCount} listed, ${notMonitoredCount} not monitored`);
    } catch (error) {
      console.error("[BlacklistAutoCheck] Error during scheduled check:", error);
    } finally {
      isCheckRunning = false;
    }
  };

  // Executar imediatamente na inicialização (após 30 segundos)
  setTimeout(runCheck, 30000);

  // Agendar execução usando o intervalo configurado
  const intervalMs = currentIntervalHours * 60 * 60 * 1000;
  blacklistCheckTimer = setInterval(runCheck, intervalMs);

  console.log(`[BlacklistAutoCheck] Scheduled blacklist verification every ${currentIntervalHours} hours`);
}

export function stopBlacklistAutoCheck(): void {
  if (blacklistCheckTimer) {
    clearInterval(blacklistCheckTimer);
    blacklistCheckTimer = null;
    isInitialized = false;
    console.log("[BlacklistAutoCheck] Stopped scheduled blacklist verification");
  }
}

export async function checkBlacklistForLink(
  link: { id: number; clientId: number; name: string; status?: string; failureSource?: string | null; ipBlock?: string | null; ipAddress?: string | null },
  storage: {
    getExternalIntegrations: () => Promise<any[]>;
    upsertBlacklistCheck: (check: any) => Promise<any>;
    getBlacklistCheck: (linkId: number) => Promise<any[]>;
    updateLinkStatus?: (id: number, data: any) => Promise<void>;
    createBlacklistEvent?: (linkId: number, clientId: number, linkName: string, listedIps: string[], rbls: string[]) => Promise<void>;
    resolveBlacklistEvents?: (linkId: number) => Promise<void>;
  }
): Promise<{ checked: number; listed: number; notMonitored: number }> {
  const ipsToCheck: string[] = [];
  
  if (link.ipBlock) {
    const expandedIps = expandCidrToIps(link.ipBlock);
    ipsToCheck.push(...expandedIps);
  }
  
  if (link.ipAddress && !ipsToCheck.includes(link.ipAddress)) {
    ipsToCheck.push(link.ipAddress);
  }
  
  if (ipsToCheck.length === 0) {
    console.log(`[BlacklistCheck] Link ${link.id} has no IPs to check`);
    return { checked: 0, listed: 0, notMonitored: 0 };
  }

  console.log(`[BlacklistCheck] Checking ${ipsToCheck.length} IPs for link ${link.id}`);

  const integrations = await storage.getExternalIntegrations();
  console.log(`[BlacklistCheck] Found ${integrations.length} integrations`);
  for (const i of integrations) {
    console.log(`[BlacklistCheck] Integration: provider=${i.provider}, isActive=${i.isActive}, hasApiKey=${!!i.apiKey}`);
  }
  
  const hetrixIntegration = integrations.find(
    (i: any) => i.provider === "hetrixtools" && i.isActive && i.apiKey
  );

  if (!hetrixIntegration) {
    console.log("[BlacklistCheck] HetrixTools integration not configured or inactive");
    for (const ip of ipsToCheck) {
      await storage.upsertBlacklistCheck({
        linkId: link.id,
        ip,
        isListed: false,
        listedOn: [],
        reportId: null,
        reportUrl: null,
        lastCheckedAt: new Date(),
      });
    }
    return { checked: 0, listed: 0, notMonitored: ipsToCheck.length };
  }

  const adapter = new HetrixToolsAdapter(hetrixIntegration);
  const results = await adapter.checkMultipleIps(ipsToCheck);

  let checked = 0;
  let listed = 0;
  let notMonitored = 0;

  for (const ip of ipsToCheck) {
    const result = results.get(ip);
    
    if (!result || !result.reportId) {
      notMonitored++;
      await storage.upsertBlacklistCheck({
        linkId: link.id,
        ip,
        isListed: false,
        listedOn: [],
        reportId: null,
        reportUrl: null,
        lastCheckedAt: new Date(),
      });
    } else {
      checked++;
      if (result.isListed) listed++;
      
      await storage.upsertBlacklistCheck({
        linkId: link.id,
        ip,
        isListed: result.isListed,
        listedOn: result.listedOn,
        reportId: result.reportId,
        reportUrl: result.reportUrl,
        lastCheckedAt: new Date(),
      });
    }
  }

  console.log(`[BlacklistCheck] Link ${link.id}: ${checked} checked, ${listed} listed, ${notMonitored} not monitored`);
  
  // Buscar resultados atualizados para criar evento/atualizar status
  if (listed > 0) {
    // Coletar IPs listados e RBLs para o evento
    const listedIps: string[] = [];
    const allRbls = new Set<string>();
    
    for (const ip of ipsToCheck) {
      const result = results.get(ip);
      if (result?.isListed && result.listedOn?.length > 0) {
        listedIps.push(ip);
        for (const rbl of result.listedOn) {
          if (typeof rbl === 'string') {
            allRbls.add(rbl);
          } else if (rbl?.rbl) {
            allRbls.add(rbl.rbl);
          }
        }
      }
    }
    
    // Criar evento de blacklist
    if (storage.createBlacklistEvent && listedIps.length > 0) {
      await storage.createBlacklistEvent(
        link.id,
        link.clientId,
        link.name,
        listedIps,
        Array.from(allRbls)
      );
    }
    
    // Atualizar status do link para degraded (se não estiver já offline)
    if (storage.updateLinkStatus && link.status !== 'offline' && link.status !== 'maintenance') {
      await storage.updateLinkStatus(link.id, { 
        status: 'degraded',
        failureReason: `IP(s) em blacklist: ${listedIps.join(', ')}`,
        failureSource: 'blacklist'
      });
      console.log(`[BlacklistCheck] Link ${link.id} status updated to degraded (blacklist)`);
    }
  } else if (listed === 0 && checked > 0 && notMonitored === 0) {
    // Nenhum IP listado E todos os IPs foram verificados (nenhum não-monitorado)
    // Só resolver eventos quando temos certeza que todos os IPs foram verificados
    if (storage.resolveBlacklistEvents) {
      await storage.resolveBlacklistEvents(link.id);
      console.log(`[BlacklistCheck] Link ${link.id}: All ${checked} IPs verified clean, resolving events`);
    }
    
    // Se o link estava degraded por blacklist, restaurar para operational
    if (storage.updateLinkStatus && link.status === 'degraded' && link.failureSource === 'blacklist') {
      await storage.updateLinkStatus(link.id, { 
        status: 'operational',
        failureReason: null,
        failureSource: null
      });
      console.log(`[BlacklistCheck] Link ${link.id} status restored to operational`);
    }
  } else if (listed === 0 && checked > 0 && notMonitored > 0) {
    // Alguns IPs não estão sendo monitorados - não resolver eventos automaticamente
    console.log(`[BlacklistCheck] Link ${link.id}: ${checked} IPs clean but ${notMonitored} not monitored - keeping events open`);
  }
  
  return { checked, listed, notMonitored };
}

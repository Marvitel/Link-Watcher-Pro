import { ExternalIntegration, BlacklistCheck } from "@shared/schema";

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
    let endpoint = "/blacklist-monitors?per_page=200";
    if (filters?.target) {
      endpoint += `&target=${encodeURIComponent(filters.target)}&exact_target=true`;
    }
    if (filters?.type) {
      endpoint += `&type=${filters.type}`;
    }
    
    const response = await this.request<HetrixApiResponse<HetrixBlacklistMonitor>>("GET", endpoint);
    return response.monitors || [];
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
    
    const monitors = await this.getBlacklistMonitors({ type: "ipv4" });
    
    for (const ip of ips) {
      const monitor = monitors.find(m => m.target === ip);
      if (monitor) {
        results.set(ip, {
          isListed: monitor.listed && monitor.listed.length > 0,
          listedOn: monitor.listed || [],
          reportId: monitor.report_id,
          reportUrl: `https://hetrixtools.com/report/blacklist/${monitor.report_id}`,
        });
      } else {
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

// Intervalo de 12 horas em milissegundos
const BLACKLIST_CHECK_INTERVAL = 12 * 60 * 60 * 1000;

let blacklistCheckTimer: ReturnType<typeof setInterval> | null = null;
let isCheckRunning = false;
let isInitialized = false;

export async function startBlacklistAutoCheck(
  storage: {
    getExternalIntegrations: () => Promise<any[]>;
    getLinks: () => Promise<any[]>;
    upsertBlacklistCheck: (check: any) => Promise<any>;
  }
): Promise<void> {
  // Evitar múltiplas inicializações (hot reload, múltiplas instâncias)
  if (isInitialized) {
    console.log("[BlacklistAutoCheck] Already initialized, skipping...");
    return;
  }
  isInitialized = true;

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
        (i: any) => i.type === "hetrixtools" && i.isActive && i.apiKey
      );

      if (!hetrixIntegration) {
        console.log("[BlacklistAutoCheck] HetrixTools integration not configured or inactive, skipping...");
        return;
      }

      const adapter = new HetrixToolsAdapter(hetrixIntegration);
      const links = await storage.getLinks();
      const linksWithIp = links.filter((link: any) => link.ipAddress);
      
      console.log(`[BlacklistAutoCheck] Checking ${linksWithIp.length} links with IP addresses`);

      // Obter todos os monitores de uma vez para eficiência
      const allMonitors = await adapter.getBlacklistMonitors({ type: "ipv4" });
      let checkedCount = 0;
      let listedCount = 0;
      let notMonitoredCount = 0;

      for (const link of linksWithIp) {
        try {
          const monitor = allMonitors.find((m: any) => m.target === link.ipAddress);
          
          if (!monitor) {
            // Registrar que o IP não está sendo monitorado pelo HetrixTools
            // Isso evita blind spots e permite ao usuário saber quais IPs não têm monitor
            notMonitoredCount++;
            await storage.upsertBlacklistCheck({
              linkId: link.id,
              ip: link.ipAddress,
              isListed: false,
              listedOn: [],
              reportId: null,
              reportUrl: null,
              lastCheckedAt: new Date(),
            });
            continue;
          }

          // Usar o timestamp do monitor (last_check) para alinhamento com a API
          const lastCheckedAt = monitor.last_check 
            ? new Date(monitor.last_check * 1000) 
            : new Date();

          const checkResult = {
            linkId: link.id,
            ip: link.ipAddress,
            isListed: monitor.listed && monitor.listed.length > 0,
            listedOn: monitor.listed || [],
            reportId: monitor.report_id,
            reportUrl: `https://hetrixtools.com/report/blacklist/${monitor.report_id}`,
            lastCheckedAt,
          };

          if (checkResult.isListed) {
            listedCount++;
          }

          await storage.upsertBlacklistCheck(checkResult);
          checkedCount++;
        } catch (err) {
          console.error(`[BlacklistAutoCheck] Failed to check link ${link.id}:`, err);
        }
      }

      console.log(`[BlacklistAutoCheck] Completed: ${checkedCount} checked, ${listedCount} listed, ${notMonitoredCount} not monitored`);
    } catch (error) {
      console.error("[BlacklistAutoCheck] Error during scheduled check:", error);
    } finally {
      isCheckRunning = false;
    }
  };

  // Executar imediatamente na inicialização (após 30 segundos)
  setTimeout(runCheck, 30000);

  // Agendar execução a cada 12 horas usando setInterval (mais robusto)
  blacklistCheckTimer = setInterval(runCheck, BLACKLIST_CHECK_INTERVAL);

  console.log("[BlacklistAutoCheck] Scheduled blacklist verification every 12 hours");
}

export function stopBlacklistAutoCheck(): void {
  if (blacklistCheckTimer) {
    clearInterval(blacklistCheckTimer);
    blacklistCheckTimer = null;
    isInitialized = false;
    console.log("[BlacklistAutoCheck] Stopped scheduled blacklist verification");
  }
}

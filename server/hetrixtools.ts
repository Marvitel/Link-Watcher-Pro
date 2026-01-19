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

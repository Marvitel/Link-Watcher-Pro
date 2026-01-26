import type { InsertDDoSEvent } from "@shared/schema";

interface WanguardAnomalyRef {
  href: string;
}

interface WanguardBgpAnnouncement {
  id: number;
  prefix: string;
  status: string;
  anomaly_id: string | null;
  bgp_connector?: {
    bgp_connector_id: string;
    bgp_connector_name: string;
    href: string;
  };
  from?: {
    iso_8601: string;
    unixtime: string;
  };
  until?: {
    iso_8601: string;
    unixtime: string;
  };
  href?: string;
}

interface WanguardBgpAnnouncementRef {
  href: string;
}

interface WanguardAnomalyDetail {
  status: string;
  prefix: string;
  ip_group: string | null;
  anomaly: string;
  direction: string;
  decoder: {
    decoder_id: string;
    decoder_name: string;
    href: string;
  };
  unit: string;
  threshold: string;
  value: string;
  latest_value: string;
  sensor: {
    sensor_interface_name: string;
    sensor_interface_id: string;
    href: string;
  };
  from: {
    iso_8601: string;
    unixtime: string;
  };
  until: {
    iso_8601: string;
    unixtime: string;
  };
  duration: string;
  "pkts/s": string;
  "bits/s": string;
  packets: string;
  bits: string;
  severity: string;
  link_severity: string;
  classification: string;
  comments: string;
}

interface WanguardAnomaly {
  id: number;
  ip: string;
  sensor: string;
  decoder: string;
  status: string;
  kbps: number;
  pps: number;
  start_time: string;
  end_time: string | null;
  href: string;
}

interface WanguardConfig {
  endpoint: string;
  user: string;
  password: string;
}

export class WanguardService {
  private config: WanguardConfig | null = null;

  constructor() {}

  configure(config: WanguardConfig) {
    this.config = config;
  }

  isConfigured(): boolean {
    return this.config !== null && 
           this.config.endpoint !== "" && 
           this.config.user !== "" && 
           this.config.password !== "";
  }

  private async apiRequest<T>(path: string, params?: Record<string, string>): Promise<T> {
    if (!this.config) {
      throw new Error("Wanguard não configurado");
    }

    const url = new URL(`${this.config.endpoint}/wanguard-api/v1${path}`);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.append(key, value);
      });
    }

    const auth = Buffer.from(`${this.config.user}:${this.config.password}`).toString("base64");

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "Authorization": `Basic ${auth}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Wanguard API error: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<T>;
  }

  private extractIdFromHref(href: string): number {
    const match = href.match(/\/anomalies\/(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  }

  private async getAnomalyDetails(anomalyId: number): Promise<WanguardAnomalyDetail | null> {
    try {
      return await this.apiRequest<WanguardAnomalyDetail>(`/anomalies/${anomalyId}`);
    } catch (error) {
      console.error(`Erro ao buscar detalhes da anomalia ${anomalyId}:`, error);
      return null;
    }
  }

  private convertDetailToAnomaly(id: number, detail: WanguardAnomalyDetail): WanguardAnomaly {
    return {
      id,
      ip: detail.prefix,
      sensor: detail.sensor?.sensor_interface_name || "",
      decoder: detail.decoder?.decoder_name || "",
      status: detail.status,
      kbps: Math.round(parseInt(detail["bits/s"] || "0", 10) / 1000),
      pps: parseInt(detail["pkts/s"] || "0", 10),
      start_time: detail.from?.iso_8601 || "",
      end_time: detail.until?.iso_8601 || null,
      href: `/wanguard-api/v1/anomalies/${id}`,
    };
  }

  async getActiveAnomalies(): Promise<WanguardAnomaly[]> {
    try {
      const refs = await this.apiRequest<WanguardAnomalyRef[]>("/anomalies", { Status: "Active" });
      const anomalies: WanguardAnomaly[] = [];
      
      for (const ref of refs) {
        const id = this.extractIdFromHref(ref.href);
        if (id) {
          const detail = await this.getAnomalyDetails(id);
          if (detail) {
            anomalies.push(this.convertDetailToAnomaly(id, detail));
          }
        }
      }
      
      return anomalies;
    } catch (error) {
      console.error("Erro ao buscar anomalias ativas do Wanguard:", error);
      return [];
    }
  }

  async getHistoricalAnomalies(since?: Date, limit: number = 100): Promise<WanguardAnomaly[]> {
    try {
      const params: Record<string, string> = { Status: "Historical" };
      if (since) {
        params["StartTime"] = since.toISOString();
      }
      
      const refs = await this.apiRequest<WanguardAnomalyRef[]>("/anomalies", params);
      const anomalies: WanguardAnomaly[] = [];
      
      const limitedRefs = refs.slice(0, limit);
      
      for (const ref of limitedRefs) {
        const id = this.extractIdFromHref(ref.href);
        if (id) {
          const detail = await this.getAnomalyDetails(id);
          if (detail) {
            anomalies.push(this.convertDetailToAnomaly(id, detail));
          }
        }
      }
      
      console.log(`[Wanguard] Importadas ${anomalies.length} de ${refs.length} anomalias históricas`);
      return anomalies;
    } catch (error) {
      console.error("Erro ao buscar anomalias históricas do Wanguard:", error);
      return [];
    }
  }

  mapAnomalyToEvent(anomaly: WanguardAnomaly, clientId: number, linkId: number): Omit<InsertDDoSEvent, "id" | "startTime"> & { startTime: Date } {
    const attackTypeMap: Record<string, string> = {
      "syn": "SYN Flood",
      "udp": "UDP Flood",
      "icmp": "ICMP Flood",
      "dns": "DNS Amplification",
      "ntp": "NTP Amplification",
      "ssdp": "SSDP Amplification",
      "memcached": "Memcached Amplification",
      "chargen": "Chargen Amplification",
      "http": "HTTP Flood",
      "https": "HTTPS Flood",
      "tcp": "TCP Flood",
      "fragment": "Fragmentation Attack",
      "slowloris": "Slowloris",
      "rudy": "R.U.D.Y.",
      "ip": "Volumetric Attack",
    };

    const decoder = anomaly.decoder?.toLowerCase() || "";
    let attackType = "Volumetric Attack";
    for (const [key, value] of Object.entries(attackTypeMap)) {
      if (decoder.includes(key)) {
        attackType = value;
        break;
      }
    }

    const mitigationStatusMap: Record<string, string> = {
      "active": "mitigating",
      "detected": "detected",
      "mitigated": "mitigated",
      "finished": "resolved",
      "historical": "resolved",
    };

    return {
      linkId,
      clientId,
      attackType,
      startTime: new Date(anomaly.start_time),
      endTime: anomaly.end_time ? new Date(anomaly.end_time) : null,
      peakBandwidth: anomaly.kbps / 1000,
      mitigationStatus: mitigationStatusMap[anomaly.status?.toLowerCase()] || "detected",
      sourceIps: 0,
      blockedPackets: anomaly.pps,
      wanguardAnomalyId: anomaly.id,
      wanguardSensor: anomaly.sensor,
      targetIp: anomaly.ip,
      decoder: anomaly.decoder,
    };
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    if (!this.config) {
      return { success: false, message: "Wanguard não configurado" };
    }

    try {
      const refs = await this.apiRequest<WanguardAnomalyRef[]>("/anomalies", { limit: "1" });
      return { 
        success: true, 
        message: `Conexão com Wanguard estabelecida com sucesso (${refs.length} anomalia(s) disponível)` 
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro desconhecido";
      return { success: false, message: `Falha na conexão: ${message}` };
    }
  }

  private extractBgpIdFromHref(href: string): number {
    const match = href.match(/\/bgp_announcements\/(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  }

  async getActiveBgpAnnouncements(): Promise<WanguardBgpAnnouncement[]> {
    try {
      const refs = await this.apiRequest<WanguardBgpAnnouncementRef[]>("/bgp_announcements", { Status: "Active" });
      const announcements: WanguardBgpAnnouncement[] = [];
      
      for (const ref of refs) {
        const id = this.extractBgpIdFromHref(ref.href);
        if (id) {
          try {
            const detail = await this.apiRequest<WanguardBgpAnnouncement>(`/bgp_announcements/${id}`);
            announcements.push({ ...detail, id });
          } catch (detailError) {
            console.error(`Erro ao buscar detalhes do anúncio BGP ${id}:`, detailError);
          }
        }
      }
      
      return announcements;
    } catch (error) {
      console.error("Erro ao buscar anúncios BGP ativos do Wanguard:", error);
      return [];
    }
  }

  async getMitigatedPrefixes(): Promise<{ prefix: string; connector: string; announcedAt: string; expiresAt: string | null; anomalyId: number | null }[]> {
    try {
      const announcements = await this.getActiveBgpAnnouncements();
      
      // Filtrar apenas anúncios ativos (status "Active" ou "Pending" são mitigações em andamento)
      // Status "Finished" ou "Delayed" são mitigações finalizadas/históricas
      const activeAnnouncements = announcements.filter(a => 
        a.status === "Active" || a.status === "Pending" || a.status === "Announcing"
      );
      
      
      return activeAnnouncements.map(a => ({
        prefix: a.prefix,
        connector: a.bgp_connector?.bgp_connector_name || "-",
        announcedAt: a.from?.iso_8601 || "",
        expiresAt: a.until?.iso_8601 || null,
        anomalyId: a.anomaly_id ? parseInt(a.anomaly_id, 10) : null,
      }));
    } catch (error) {
      console.error("Erro ao buscar prefixos mitigados:", error);
      return [];
    }
  }
}

export const wanguardService = new WanguardService();

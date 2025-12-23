import type { InsertDDoSEvent } from "@shared/schema";

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

  async getActiveAnomalies(): Promise<WanguardAnomaly[]> {
    try {
      return await this.apiRequest<WanguardAnomaly[]>("/anomalies", { Status: "Active" });
    } catch (error) {
      console.error("Erro ao buscar anomalias ativas do Wanguard:", error);
      return [];
    }
  }

  async getHistoricalAnomalies(since?: Date): Promise<WanguardAnomaly[]> {
    try {
      const params: Record<string, string> = { Status: "Historical" };
      if (since) {
        params["StartTime"] = since.toISOString();
      }
      return await this.apiRequest<WanguardAnomaly[]>("/anomalies", params);
    } catch (error) {
      console.error("Erro ao buscar anomalias históricas do Wanguard:", error);
      return [];
    }
  }

  async getAnomalyDetails(anomalyId: number): Promise<WanguardAnomaly | null> {
    try {
      return await this.apiRequest<WanguardAnomaly>(`/anomalies/${anomalyId}`);
    } catch (error) {
      console.error(`Erro ao buscar detalhes da anomalia ${anomalyId}:`, error);
      return null;
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
      "historical": "mitigated",
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
      blockedPackets: 0,
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
      await this.apiRequest<unknown>("/anomalies", { limit: "1" });
      return { success: true, message: "Conexão com Wanguard estabelecida com sucesso" };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro desconhecido";
      return { success: false, message: `Falha na conexão: ${message}` };
    }
  }
}

export const wanguardService = new WanguardService();

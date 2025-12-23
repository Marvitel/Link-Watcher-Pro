import type {
  Link,
  Metric,
  Event,
  Alert,
  DDoSEvent,
  SLAIndicator,
  DashboardStats,
} from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
  getLinks(): Promise<Link[]>;
  getLink(id: string): Promise<Link | undefined>;
  getLinkMetrics(linkId: string): Promise<Metric[]>;
  getLinkEvents(linkId: string): Promise<Event[]>;
  getLinkSLA(linkId: string): Promise<SLAIndicator[]>;
  getEvents(): Promise<Event[]>;
  getAlerts(): Promise<Alert[]>;
  getDDoSEvents(): Promise<DDoSEvent[]>;
  getSLAIndicators(): Promise<SLAIndicator[]>;
  getDashboardStats(): Promise<DashboardStats>;
}

function generateMetricsHistory(linkId: string, count: number = 24): Metric[] {
  const metrics: Metric[] = [];
  const now = new Date();
  const baseDownload = linkId === "sede" ? 85 : 120;
  const baseUpload = linkId === "sede" ? 45 : 75;
  
  for (let i = count - 1; i >= 0; i--) {
    const timestamp = new Date(now.getTime() - i * 5 * 60 * 1000);
    const variation = Math.sin(i * 0.5) * 20;
    
    metrics.push({
      id: randomUUID(),
      linkId,
      timestamp: timestamp.toISOString(),
      download: Math.max(10, baseDownload + variation + Math.random() * 15),
      upload: Math.max(5, baseUpload + variation * 0.5 + Math.random() * 10),
      latency: 35 + Math.random() * 20,
      packetLoss: Math.random() * 0.5,
      cpuUsage: 25 + Math.random() * 20,
      memoryUsage: 40 + Math.random() * 15,
      errorRate: Math.random() * 0.001,
    });
  }
  
  return metrics;
}

function generateEvents(): Event[] {
  const now = new Date();
  return [
    {
      id: "evt-1",
      linkId: "sede",
      type: "info",
      title: "Manutenção preventiva concluída",
      description: "Atualização de firmware do equipamento CPE realizada com sucesso",
      timestamp: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(),
      resolved: true,
      resolvedAt: new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: "evt-2",
      linkId: "central",
      type: "warning",
      title: "Latência elevada detectada",
      description: "Latência acima de 60ms detectada por 10 minutos",
      timestamp: new Date(now.getTime() - 4 * 60 * 60 * 1000).toISOString(),
      resolved: true,
      resolvedAt: new Date(now.getTime() - 3.5 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: "evt-3",
      linkId: "sede",
      type: "info",
      title: "Backup de configuração realizado",
      description: "Backup automático das configurações do firewall",
      timestamp: new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString(),
      resolved: true,
    },
    {
      id: "evt-4",
      linkId: "central",
      type: "info",
      title: "Certificado SSL renovado",
      description: "Certificado SSL do portal de gerenciamento renovado automaticamente",
      timestamp: new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString(),
      resolved: true,
    },
    {
      id: "evt-5",
      linkId: "sede",
      type: "maintenance",
      title: "Janela de manutenção agendada",
      description: "Manutenção programada para atualização de patches de segurança",
      timestamp: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
      resolved: true,
    },
    {
      id: "evt-6",
      linkId: "central",
      type: "critical",
      title: "Indisponibilidade temporária",
      description: "Link indisponível por 15 minutos devido a falha de roteamento",
      timestamp: new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString(),
      resolved: true,
      resolvedAt: new Date(now.getTime() - 47.75 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: "evt-7",
      linkId: "sede",
      type: "warning",
      title: "Uso elevado de CPU",
      description: "CPU do firewall atingiu 85% de utilização",
      timestamp: new Date(now.getTime() - 72 * 60 * 60 * 1000).toISOString(),
      resolved: true,
      resolvedAt: new Date(now.getTime() - 71 * 60 * 60 * 1000).toISOString(),
    },
  ];
}

function generateDDoSEvents(): DDoSEvent[] {
  const now = new Date();
  return [
    {
      id: "ddos-1",
      linkId: "central",
      attackType: "UDP Flood",
      startTime: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      endTime: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000 + 45 * 60 * 1000).toISOString(),
      peakBandwidth: 1.2,
      mitigationStatus: "resolved",
      sourceIps: 12500,
      blockedPackets: 8500000,
    },
    {
      id: "ddos-2",
      linkId: "sede",
      attackType: "SYN Flood",
      startTime: new Date(now.getTime() - 12 * 24 * 60 * 60 * 1000).toISOString(),
      endTime: new Date(now.getTime() - 12 * 24 * 60 * 60 * 1000 + 30 * 60 * 1000).toISOString(),
      peakBandwidth: 0.8,
      mitigationStatus: "resolved",
      sourceIps: 8200,
      blockedPackets: 4200000,
    },
    {
      id: "ddos-3",
      linkId: "central",
      attackType: "HTTP Flood",
      startTime: new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000).toISOString(),
      endTime: new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000).toISOString(),
      peakBandwidth: 0.5,
      mitigationStatus: "resolved",
      sourceIps: 3500,
      blockedPackets: 2100000,
    },
  ];
}

function generateSLAIndicators(linkId?: string): SLAIndicator[] {
  return [
    {
      id: "sla-de",
      name: "Disponibilidade do Enlace (DE)",
      description: "Percentual de tempo em que o enlace esteve em condições normais de funcionamento",
      formula: "D = [(To-Ti)/To] x 100",
      target: "≥ 99,00%",
      current: 99.85,
      periodicity: "Mensal",
      status: "compliant",
    },
    {
      id: "sla-teb",
      name: "Taxa de Erro de Bit (TEB)",
      description: "Relação entre bits transmitidos com erro e o total de bits enviados",
      formula: "TEB = (NBE/NTB) x 100",
      target: "≤ 1x10⁻⁶",
      current: 0.0000001,
      periodicity: "Eventual",
      status: "compliant",
    },
    {
      id: "sla-dp",
      name: "Descarte de Pacotes (DP)",
      description: "Relação entre pacotes enviados pela origem e recebidos no destino",
      formula: "PP = [(NPorig – NPdest)/NPdest] x 100",
      target: "≤ 2%",
      current: 0.45,
      periodicity: "Eventual",
      status: "compliant",
    },
    {
      id: "sla-lat",
      name: "Latência (LAT)",
      description: "Tempo de transmissão de um pacote entre a origem e o destino",
      formula: "N/A",
      target: "≤ 80ms",
      current: 45,
      periodicity: "Horária",
      status: "compliant",
    },
    {
      id: "sla-repair",
      name: "Prazo de Reparo do Serviço",
      description: "Tempo entre a abertura do chamado e o restabelecimento do serviço",
      formula: "N/A",
      target: "Máximo 6 horas",
      current: 100,
      periodicity: "Mensal",
      status: "compliant",
    },
  ];
}

export class MemStorage implements IStorage {
  private links: Map<string, Link>;
  private metricsCache: Map<string, Metric[]>;
  private events: Event[];
  private ddosEvents: DDoSEvent[];

  constructor() {
    this.links = new Map();
    this.metricsCache = new Map();
    this.events = generateEvents();
    this.ddosEvents = generateDDoSEvents();

    const sedeLink: Link = {
      id: "sede",
      name: "Sede Administrativa",
      location: "Centro, Aracaju/SE",
      address: "Travessa João Francisco da Silveira, nº 44, Centro – Aracaju/SE, CEP 49.010-360",
      ipBlock: "/29",
      totalIps: 8,
      usableIps: 6,
      bandwidth: 200,
      status: "operational",
      uptime: 99.85,
      currentDownload: 87.5,
      currentUpload: 42.3,
      latency: 42,
      packetLoss: 0.12,
      cpuUsage: 35,
      memoryUsage: 48,
      lastUpdated: new Date().toISOString(),
    };

    const centralLink: Link = {
      id: "central",
      name: "Central de Atendimento",
      location: "Jardins, Aracaju/SE",
      address: "Avenida Ministro Geraldo Barreto Sobral, nº 1436, Jardins – Aracaju/SE, CEP 49.026-010",
      ipBlock: "/28",
      totalIps: 16,
      usableIps: 14,
      bandwidth: 200,
      status: "operational",
      uptime: 99.72,
      currentDownload: 125.8,
      currentUpload: 78.4,
      latency: 38,
      packetLoss: 0.08,
      cpuUsage: 42,
      memoryUsage: 52,
      lastUpdated: new Date().toISOString(),
    };

    this.links.set("sede", sedeLink);
    this.links.set("central", centralLink);

    this.metricsCache.set("sede", generateMetricsHistory("sede"));
    this.metricsCache.set("central", generateMetricsHistory("central"));

    setInterval(() => this.updateMetrics(), 30000);
  }

  private updateMetrics() {
    for (const [linkId, link] of this.links) {
      const variation = (Math.random() - 0.5) * 10;
      link.currentDownload = Math.max(10, Math.min(195, link.currentDownload + variation));
      link.currentUpload = Math.max(5, Math.min(195, link.currentUpload + variation * 0.5));
      link.latency = Math.max(20, Math.min(75, link.latency + (Math.random() - 0.5) * 5));
      link.packetLoss = Math.max(0, Math.min(1.5, link.packetLoss + (Math.random() - 0.5) * 0.1));
      link.cpuUsage = Math.max(15, Math.min(80, link.cpuUsage + (Math.random() - 0.5) * 5));
      link.memoryUsage = Math.max(30, Math.min(70, link.memoryUsage + (Math.random() - 0.5) * 3));
      link.lastUpdated = new Date().toISOString();

      const metrics = this.metricsCache.get(linkId) || [];
      metrics.push({
        id: randomUUID(),
        linkId,
        timestamp: new Date().toISOString(),
        download: link.currentDownload,
        upload: link.currentUpload,
        latency: link.latency,
        packetLoss: link.packetLoss,
        cpuUsage: link.cpuUsage,
        memoryUsage: link.memoryUsage,
        errorRate: Math.random() * 0.001,
      });

      if (metrics.length > 50) {
        metrics.shift();
      }

      this.metricsCache.set(linkId, metrics);
    }
  }

  async getLinks(): Promise<Link[]> {
    return Array.from(this.links.values());
  }

  async getLink(id: string): Promise<Link | undefined> {
    return this.links.get(id);
  }

  async getLinkMetrics(linkId: string): Promise<Metric[]> {
    return this.metricsCache.get(linkId) || [];
  }

  async getLinkEvents(linkId: string): Promise<Event[]> {
    return this.events.filter((e) => e.linkId === linkId);
  }

  async getLinkSLA(linkId: string): Promise<SLAIndicator[]> {
    return generateSLAIndicators(linkId);
  }

  async getEvents(): Promise<Event[]> {
    return this.events.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }

  async getAlerts(): Promise<Alert[]> {
    return [];
  }

  async getDDoSEvents(): Promise<DDoSEvent[]> {
    return this.ddosEvents;
  }

  async getSLAIndicators(): Promise<SLAIndicator[]> {
    return generateSLAIndicators();
  }

  async getDashboardStats(): Promise<DashboardStats> {
    const links = await this.getLinks();
    const operationalLinks = links.filter((l) => l.status === "operational").length;
    const avgUptime = links.reduce((sum, l) => sum + l.uptime, 0) / links.length;
    const avgLatency = links.reduce((sum, l) => sum + l.latency, 0) / links.length;
    const totalBandwidth = links.reduce((sum, l) => sum + l.bandwidth, 0);
    const activeAlerts = this.events.filter((e) => !e.resolved).length;
    const today = new Date().toDateString();
    const ddosToday = this.ddosEvents.filter(
      (e) => new Date(e.startTime).toDateString() === today
    ).length;

    return {
      totalLinks: links.length,
      operationalLinks,
      activeAlerts,
      averageUptime: avgUptime,
      averageLatency: avgLatency,
      totalBandwidth,
      ddosEventsToday: ddosToday,
    };
  }
}

export const storage = new MemStorage();

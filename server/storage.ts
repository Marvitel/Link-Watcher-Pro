import {
  links,
  metrics,
  events,
  ddosEvents,
  incidents,
  type Link,
  type Metric,
  type Event,
  type DDoSEvent,
  type Incident,
  type InsertIncident,
  type SLAIndicator,
  type DashboardStats,
  type LinkStatusDetail,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, gte, and, lt, isNull, ne } from "drizzle-orm";

export interface IStorage {
  getLinks(): Promise<Link[]>;
  getLink(id: string): Promise<Link | undefined>;
  getLinkMetrics(linkId: string, limit?: number): Promise<Metric[]>;
  getLinkEvents(linkId: string): Promise<Event[]>;
  getLinkSLA(linkId: string): Promise<SLAIndicator[]>;
  getEvents(): Promise<Event[]>;
  getDDoSEvents(): Promise<DDoSEvent[]>;
  getSLAIndicators(): Promise<SLAIndicator[]>;
  getDashboardStats(): Promise<DashboardStats>;
  initializeDefaultData(): Promise<void>;
  addMetric(linkId: string, data: Omit<Metric, "id" | "timestamp" | "linkId">): Promise<void>;
  updateLinkStatus(linkId: string, data: Partial<Link>): Promise<void>;
  startMetricCollection(): void;
  cleanupOldData(): Promise<void>;
  getLinkStatusDetail(linkId: string): Promise<LinkStatusDetail | undefined>;
  updateLinkFailureState(linkId: string, failureReason: string | null, failureSource: string | null): Promise<void>;
  getIncidents(): Promise<Incident[]>;
  getLinkIncidents(linkId: string): Promise<Incident[]>;
  getOpenIncidents(): Promise<Incident[]>;
  getIncident(id: number): Promise<Incident | undefined>;
  createIncident(data: InsertIncident): Promise<Incident>;
  updateIncident(id: number, data: Partial<Incident>): Promise<void>;
  closeIncident(id: number, notes?: string): Promise<void>;
}

function generateSLAIndicators(linkUptime?: number, linkLatency?: number, linkPacketLoss?: number): SLAIndicator[] {
  const uptime = linkUptime ?? 99.85;
  const latency = linkLatency ?? 45;
  const packetLoss = linkPacketLoss ?? 0.45;
  
  return [
    {
      id: "sla-de",
      name: "Disponibilidade do Enlace (DE)",
      description: "Percentual de tempo em que o enlace esteve em condições normais de funcionamento",
      formula: "D = [(To-Ti)/To] x 100",
      target: "≥ 99,00%",
      current: uptime,
      periodicity: "Mensal",
      status: uptime >= 99 ? "compliant" : uptime >= 98 ? "warning" : "non_compliant",
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
      current: packetLoss,
      periodicity: "Eventual",
      status: packetLoss <= 2 ? "compliant" : packetLoss <= 3 ? "warning" : "non_compliant",
    },
    {
      id: "sla-lat",
      name: "Latência (LAT)",
      description: "Tempo de transmissão de um pacote entre a origem e o destino",
      formula: "N/A",
      target: "≤ 80ms",
      current: latency,
      periodicity: "Horária",
      status: latency <= 80 ? "compliant" : latency <= 100 ? "warning" : "non_compliant",
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

export class DatabaseStorage implements IStorage {
  async getLinks(): Promise<Link[]> {
    return await db.select().from(links);
  }

  async getLink(id: string): Promise<Link | undefined> {
    const [link] = await db.select().from(links).where(eq(links.id, id));
    return link || undefined;
  }

  async getLinkMetrics(linkId: string, limit?: number): Promise<Metric[]> {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    
    const query = db
      .select()
      .from(metrics)
      .where(and(eq(metrics.linkId, linkId), gte(metrics.timestamp, sixMonthsAgo)))
      .orderBy(desc(metrics.timestamp));
    
    if (limit) {
      return await query.limit(limit);
    }
    return await query;
  }

  async getLinkEvents(linkId: string): Promise<Event[]> {
    return await db
      .select()
      .from(events)
      .where(eq(events.linkId, linkId))
      .orderBy(desc(events.timestamp));
  }

  async getLinkSLA(linkId: string): Promise<SLAIndicator[]> {
    const link = await this.getLink(linkId);
    return generateSLAIndicators(link?.uptime, link?.latency, link?.packetLoss);
  }

  async getEvents(): Promise<Event[]> {
    return await db.select().from(events).orderBy(desc(events.timestamp));
  }

  async getDDoSEvents(): Promise<DDoSEvent[]> {
    return await db.select().from(ddosEvents).orderBy(desc(ddosEvents.startTime));
  }

  async getSLAIndicators(): Promise<SLAIndicator[]> {
    const allLinks = await this.getLinks();
    if (allLinks.length === 0) return generateSLAIndicators();
    
    const avgUptime = allLinks.reduce((sum, l) => sum + l.uptime, 0) / allLinks.length;
    const avgLatency = allLinks.reduce((sum, l) => sum + l.latency, 0) / allLinks.length;
    const avgPacketLoss = allLinks.reduce((sum, l) => sum + l.packetLoss, 0) / allLinks.length;
    
    return generateSLAIndicators(avgUptime, avgLatency, avgPacketLoss);
  }

  async getDashboardStats(): Promise<DashboardStats> {
    const allLinks = await this.getLinks();
    const operationalLinks = allLinks.filter((l) => l.status === "operational").length;
    const avgUptime = allLinks.length > 0 
      ? allLinks.reduce((sum, l) => sum + l.uptime, 0) / allLinks.length 
      : 0;
    const avgLatency = allLinks.length > 0 
      ? allLinks.reduce((sum, l) => sum + l.latency, 0) / allLinks.length 
      : 0;
    const totalBandwidth = allLinks.reduce((sum, l) => sum + l.bandwidth, 0);
    
    const unresolvedEvents = await db
      .select()
      .from(events)
      .where(eq(events.resolved, false));
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const ddosToday = await db
      .select()
      .from(ddosEvents)
      .where(gte(ddosEvents.startTime, today));

    const openIncidentsList = await db
      .select()
      .from(incidents)
      .where(isNull(incidents.closedAt));

    return {
      totalLinks: allLinks.length,
      operationalLinks,
      activeAlerts: unresolvedEvents.length,
      averageUptime: avgUptime,
      averageLatency: avgLatency,
      totalBandwidth,
      ddosEventsToday: ddosToday.length,
      openIncidents: openIncidentsList.length,
    };
  }

  async addMetric(linkId: string, data: Omit<Metric, "id" | "timestamp" | "linkId">): Promise<void> {
    await db.insert(metrics).values({
      linkId,
      download: data.download,
      upload: data.upload,
      latency: data.latency,
      packetLoss: data.packetLoss,
      cpuUsage: data.cpuUsage,
      memoryUsage: data.memoryUsage,
      errorRate: data.errorRate,
    });
  }

  async updateLinkStatus(linkId: string, data: Partial<Link>): Promise<void> {
    await db.update(links).set({
      ...data,
      lastUpdated: new Date(),
    }).where(eq(links.id, linkId));
  }

  async initializeDefaultData(): Promise<void> {
    const existingLinks = await this.getLinks();
    if (existingLinks.length > 0) return;

    await db.insert(links).values([
      {
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
      },
      {
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
      },
    ]);

    const now = new Date();
    await db.insert(events).values([
      {
        linkId: "sede",
        type: "info",
        title: "Manutenção preventiva concluída",
        description: "Atualização de firmware do equipamento CPE realizada com sucesso",
        timestamp: new Date(now.getTime() - 2 * 60 * 60 * 1000),
        resolved: true,
        resolvedAt: new Date(now.getTime() - 1 * 60 * 60 * 1000),
      },
      {
        linkId: "central",
        type: "warning",
        title: "Latência elevada detectada",
        description: "Latência acima de 60ms detectada por 10 minutos",
        timestamp: new Date(now.getTime() - 4 * 60 * 60 * 1000),
        resolved: true,
        resolvedAt: new Date(now.getTime() - 3.5 * 60 * 60 * 1000),
      },
      {
        linkId: "sede",
        type: "info",
        title: "Backup de configuração realizado",
        description: "Backup automático das configurações do firewall",
        timestamp: new Date(now.getTime() - 6 * 60 * 60 * 1000),
        resolved: true,
      },
      {
        linkId: "central",
        type: "info",
        title: "Certificado SSL renovado",
        description: "Certificado SSL do portal de gerenciamento renovado automaticamente",
        timestamp: new Date(now.getTime() - 12 * 60 * 60 * 1000),
        resolved: true,
      },
      {
        linkId: "sede",
        type: "maintenance",
        title: "Janela de manutenção agendada",
        description: "Manutenção programada para atualização de patches de segurança",
        timestamp: new Date(now.getTime() - 24 * 60 * 60 * 1000),
        resolved: true,
      },
      {
        linkId: "central",
        type: "critical",
        title: "Indisponibilidade temporária",
        description: "Link indisponível por 15 minutos devido a falha de roteamento",
        timestamp: new Date(now.getTime() - 48 * 60 * 60 * 1000),
        resolved: true,
        resolvedAt: new Date(now.getTime() - 47.75 * 60 * 60 * 1000),
      },
    ]);

    await db.insert(ddosEvents).values([
      {
        linkId: "central",
        attackType: "UDP Flood",
        startTime: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000),
        endTime: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000 + 45 * 60 * 1000),
        peakBandwidth: 1.2,
        mitigationStatus: "resolved",
        sourceIps: 12500,
        blockedPackets: 8500000,
      },
      {
        linkId: "sede",
        attackType: "SYN Flood",
        startTime: new Date(now.getTime() - 12 * 24 * 60 * 60 * 1000),
        endTime: new Date(now.getTime() - 12 * 24 * 60 * 60 * 1000 + 30 * 60 * 1000),
        peakBandwidth: 0.8,
        mitigationStatus: "resolved",
        sourceIps: 8200,
        blockedPackets: 4200000,
      },
      {
        linkId: "central",
        attackType: "HTTP Flood",
        startTime: new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000),
        endTime: new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000),
        peakBandwidth: 0.5,
        mitigationStatus: "resolved",
        sourceIps: 3500,
        blockedPackets: 2100000,
      },
    ]);

    for (const linkId of ["sede", "central"]) {
      const baseDownload = linkId === "sede" ? 85 : 120;
      const baseUpload = linkId === "sede" ? 45 : 75;
      
      for (let i = 24; i >= 0; i--) {
        const timestamp = new Date(now.getTime() - i * 5 * 60 * 1000);
        const variation = Math.sin(i * 0.5) * 20;
        
        await db.insert(metrics).values({
          linkId,
          timestamp,
          download: Math.max(10, baseDownload + variation + Math.random() * 15),
          upload: Math.max(5, baseUpload + variation * 0.5 + Math.random() * 10),
          latency: 35 + Math.random() * 20,
          packetLoss: Math.random() * 0.5,
          cpuUsage: 25 + Math.random() * 20,
          memoryUsage: 40 + Math.random() * 15,
          errorRate: Math.random() * 0.001,
        });
      }
    }
  }

  startMetricCollection(): void {
    setInterval(async () => {
      try {
        const allLinks = await this.getLinks();
        
        for (const link of allLinks) {
          const variation = (Math.random() - 0.5) * 10;
          const newDownload = Math.max(10, Math.min(195, link.currentDownload + variation));
          const newUpload = Math.max(5, Math.min(195, link.currentUpload + variation * 0.5));
          const newLatency = Math.max(20, Math.min(75, link.latency + (Math.random() - 0.5) * 5));
          const newPacketLoss = Math.max(0, Math.min(1.5, link.packetLoss + (Math.random() - 0.5) * 0.1));
          const newCpuUsage = Math.max(15, Math.min(80, link.cpuUsage + (Math.random() - 0.5) * 5));
          const newMemoryUsage = Math.max(30, Math.min(70, link.memoryUsage + (Math.random() - 0.5) * 3));
          const errorRate = Math.random() * 0.001;

          await this.updateLinkStatus(link.id, {
            currentDownload: newDownload,
            currentUpload: newUpload,
            latency: newLatency,
            packetLoss: newPacketLoss,
            cpuUsage: newCpuUsage,
            memoryUsage: newMemoryUsage,
          });

          await this.addMetric(link.id, {
            download: newDownload,
            upload: newUpload,
            latency: newLatency,
            packetLoss: newPacketLoss,
            cpuUsage: newCpuUsage,
            memoryUsage: newMemoryUsage,
            errorRate,
          });
        }
      } catch (error) {
        console.error("Error collecting metrics:", error);
      }
    }, 30000);

    setInterval(async () => {
      try {
        await this.cleanupOldData();
      } catch (error) {
        console.error("Error cleaning up old data:", error);
      }
    }, 24 * 60 * 60 * 1000);
  }

  async cleanupOldData(): Promise<void> {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    
    await db.delete(metrics).where(lt(metrics.timestamp, sixMonthsAgo));
    await db.delete(events).where(lt(events.timestamp, sixMonthsAgo));
    await db.delete(ddosEvents).where(lt(ddosEvents.startTime, sixMonthsAgo));
    
    console.log("Cleaned up data older than 6 months");
  }

  async getLinkStatusDetail(linkId: string): Promise<LinkStatusDetail | undefined> {
    const link = await this.getLink(linkId);
    if (!link) return undefined;

    const failureReasonLabels: Record<string, string> = {
      "falha_eletrica": "Falha Elétrica",
      "rompimento_fibra": "Rompimento de Fibra",
      "falha_equipamento": "Falha de Equipamento",
      "indefinido": "Causa Indefinida",
    };

    const [activeIncident] = await db
      .select()
      .from(incidents)
      .where(and(eq(incidents.linkId, linkId), isNull(incidents.closedAt)))
      .orderBy(desc(incidents.openedAt))
      .limit(1);

    return {
      link,
      failureInfo: {
        reason: link.failureReason,
        reasonLabel: link.failureReason ? failureReasonLabels[link.failureReason] || link.failureReason : "Operacional",
        source: link.failureSource,
        lastFailureAt: link.lastFailureAt,
      },
      activeIncident: activeIncident || null,
    };
  }

  async updateLinkFailureState(linkId: string, failureReason: string | null, failureSource: string | null): Promise<void> {
    await db.update(links).set({
      failureReason,
      failureSource,
      lastFailureAt: failureReason ? new Date() : null,
      status: failureReason ? "down" : "operational",
      lastUpdated: new Date(),
    }).where(eq(links.id, linkId));
  }

  async getIncidents(): Promise<Incident[]> {
    return await db.select().from(incidents).orderBy(desc(incidents.openedAt));
  }

  async getLinkIncidents(linkId: string): Promise<Incident[]> {
    return await db
      .select()
      .from(incidents)
      .where(eq(incidents.linkId, linkId))
      .orderBy(desc(incidents.openedAt));
  }

  async getOpenIncidents(): Promise<Incident[]> {
    return await db
      .select()
      .from(incidents)
      .where(isNull(incidents.closedAt))
      .orderBy(desc(incidents.openedAt));
  }

  async getIncident(id: number): Promise<Incident | undefined> {
    const [incident] = await db.select().from(incidents).where(eq(incidents.id, id));
    return incident || undefined;
  }

  async createIncident(data: InsertIncident): Promise<Incident> {
    const slaDeadline = new Date();
    slaDeadline.setHours(slaDeadline.getHours() + 6);
    
    const [incident] = await db.insert(incidents).values({
      ...data,
      slaDeadline: data.slaDeadline || slaDeadline,
    }).returning();
    return incident;
  }

  async updateIncident(id: number, data: Partial<Incident>): Promise<void> {
    await db.update(incidents).set({
      ...data,
      lastUpdateAt: new Date(),
    }).where(eq(incidents.id, id));
  }

  async closeIncident(id: number, notes?: string): Promise<void> {
    const incident = await this.getIncident(id);
    if (!incident) return;

    await db.update(incidents).set({
      status: "resolvido",
      closedAt: new Date(),
      lastUpdateAt: new Date(),
      repairNotes: notes,
    }).where(eq(incidents.id, id));

    await this.updateLinkFailureState(incident.linkId, null, null);
  }
}

export const storage = new DatabaseStorage();

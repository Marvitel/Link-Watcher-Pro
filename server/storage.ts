import {
  clients,
  users,
  links,
  hosts,
  metrics,
  events,
  ddosEvents,
  incidents,
  clientSettings,
  type Client,
  type User,
  type Link,
  type Host,
  type Metric,
  type Event,
  type DDoSEvent,
  type Incident,
  type ClientSettings,
  type InsertClient,
  type InsertUser,
  type InsertLink,
  type InsertHost,
  type InsertIncident,
  type InsertClientSettings,
  type InsertDDoSEvent,
  type SLAIndicator,
  type DashboardStats,
  type LinkStatusDetail,
  type AuthUser,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, gte, and, lt, isNull, sql } from "drizzle-orm";
import crypto from "crypto";

function hashPassword(password: string): string {
  return crypto.createHash("sha256").update(password).digest("hex");
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

export class DatabaseStorage {
  async getClients(): Promise<Client[]> {
    return await db.select().from(clients).where(eq(clients.isActive, true));
  }

  async getClient(id: number): Promise<Client | undefined> {
    const [client] = await db.select().from(clients).where(eq(clients.id, id));
    return client || undefined;
  }

  async getClientBySlug(slug: string): Promise<Client | undefined> {
    const [client] = await db.select().from(clients).where(eq(clients.slug, slug));
    return client || undefined;
  }

  async createClient(data: InsertClient): Promise<Client> {
    const [client] = await db.insert(clients).values(data).returning();
    return client;
  }

  async updateClient(id: number, data: Partial<Client>): Promise<void> {
    await db.update(clients).set({ ...data, updatedAt: new Date() }).where(eq(clients.id, id));
  }

  async deleteClient(id: number): Promise<void> {
    await db.update(clients).set({ isActive: false, updatedAt: new Date() }).where(eq(clients.id, id));
  }

  async getUsers(clientId?: number): Promise<User[]> {
    if (clientId) {
      return await db.select().from(users).where(and(eq(users.clientId, clientId), eq(users.isActive, true)));
    }
    return await db.select().from(users).where(eq(users.isActive, true));
  }

  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
    return user || undefined;
  }

  async createUser(data: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values({
      ...data,
      email: data.email.toLowerCase(),
      passwordHash: hashPassword(data.passwordHash),
    }).returning();
    return user;
  }

  async updateUser(id: number, data: Partial<User>): Promise<void> {
    const updateData: Partial<User> = { ...data, updatedAt: new Date() };
    if (data.passwordHash) {
      updateData.passwordHash = hashPassword(data.passwordHash);
    }
    await db.update(users).set(updateData).where(eq(users.id, id));
  }

  async validateCredentials(email: string, password: string): Promise<AuthUser | null> {
    const user = await this.getUserByEmail(email);
    if (!user || !user.isActive) return null;
    
    const hashedPassword = hashPassword(password);
    if (user.passwordHash !== hashedPassword) return null;

    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));

    let clientName: string | undefined;
    if (user.clientId) {
      const client = await this.getClient(user.clientId);
      clientName = client?.name;
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role as "admin" | "operator" | "viewer",
      clientId: user.clientId,
      clientName,
    };
  }

  async getLinks(clientId?: number): Promise<Link[]> {
    if (clientId) {
      return await db.select().from(links).where(eq(links.clientId, clientId));
    }
    return await db.select().from(links);
  }

  async getLink(id: number): Promise<Link | undefined> {
    const [link] = await db.select().from(links).where(eq(links.id, id));
    return link || undefined;
  }

  async getLinkByIdentifier(clientId: number, identifier: string): Promise<Link | undefined> {
    const [link] = await db.select().from(links).where(
      and(eq(links.clientId, clientId), eq(links.identifier, identifier))
    );
    return link || undefined;
  }

  async createLink(data: InsertLink): Promise<Link> {
    const [link] = await db.insert(links).values(data).returning();
    return link;
  }

  async updateLink(id: number, data: Partial<Link>): Promise<void> {
    await db.update(links).set({ ...data, lastUpdated: new Date() }).where(eq(links.id, id));
  }

  async deleteLink(id: number): Promise<void> {
    await db.delete(links).where(eq(links.id, id));
  }

  async getHosts(linkId?: number, clientId?: number): Promise<Host[]> {
    if (linkId) {
      return await db.select().from(hosts).where(eq(hosts.linkId, linkId));
    }
    if (clientId) {
      return await db.select().from(hosts).where(eq(hosts.clientId, clientId));
    }
    return await db.select().from(hosts);
  }

  async getHost(id: number): Promise<Host | undefined> {
    const [host] = await db.select().from(hosts).where(eq(hosts.id, id));
    return host || undefined;
  }

  async createHost(data: InsertHost): Promise<Host> {
    const [host] = await db.insert(hosts).values(data).returning();
    return host;
  }

  async updateHost(id: number, data: Partial<Host>): Promise<void> {
    await db.update(hosts).set({ ...data, updatedAt: new Date() }).where(eq(hosts.id, id));
  }

  async deleteHost(id: number): Promise<void> {
    await db.delete(hosts).where(eq(hosts.id, id));
  }

  async getLinkMetrics(linkId: number, limit?: number): Promise<Metric[]> {
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

  async getLinkEvents(linkId: number): Promise<Event[]> {
    return await db
      .select()
      .from(events)
      .where(eq(events.linkId, linkId))
      .orderBy(desc(events.timestamp));
  }

  async getLinkSLA(linkId: number): Promise<SLAIndicator[]> {
    const link = await this.getLink(linkId);
    return generateSLAIndicators(link?.uptime, link?.latency, link?.packetLoss);
  }

  async getEvents(clientId?: number): Promise<Event[]> {
    if (clientId) {
      return await db.select().from(events).where(eq(events.clientId, clientId)).orderBy(desc(events.timestamp));
    }
    return await db.select().from(events).orderBy(desc(events.timestamp));
  }

  async getDDoSEvents(clientId?: number): Promise<DDoSEvent[]> {
    if (clientId) {
      return await db.select().from(ddosEvents).where(eq(ddosEvents.clientId, clientId)).orderBy(desc(ddosEvents.startTime));
    }
    return await db.select().from(ddosEvents).orderBy(desc(ddosEvents.startTime));
  }

  async getDDoSEventByWanguardId(wanguardAnomalyId: number): Promise<DDoSEvent | null> {
    const [event] = await db
      .select()
      .from(ddosEvents)
      .where(eq(ddosEvents.wanguardAnomalyId, wanguardAnomalyId))
      .limit(1);
    return event || null;
  }

  async createDDoSEvent(data: InsertDDoSEvent & { startTime?: Date }): Promise<DDoSEvent> {
    const [event] = await db.insert(ddosEvents).values({
      linkId: data.linkId,
      clientId: data.clientId,
      attackType: data.attackType,
      startTime: data.startTime || new Date(),
      endTime: data.endTime,
      peakBandwidth: data.peakBandwidth,
      mitigationStatus: data.mitigationStatus || "detected",
      sourceIps: data.sourceIps || 0,
      blockedPackets: data.blockedPackets || 0,
      wanguardAnomalyId: data.wanguardAnomalyId,
      wanguardSensor: data.wanguardSensor,
      targetIp: data.targetIp,
      decoder: data.decoder,
    }).returning();
    return event;
  }

  async getSLAIndicators(clientId?: number): Promise<SLAIndicator[]> {
    const allLinks = clientId ? await this.getLinks(clientId) : await this.getLinks();
    if (allLinks.length === 0) return generateSLAIndicators();
    
    const avgUptime = allLinks.reduce((sum, l) => sum + l.uptime, 0) / allLinks.length;
    const avgLatency = allLinks.reduce((sum, l) => sum + l.latency, 0) / allLinks.length;
    const avgPacketLoss = allLinks.reduce((sum, l) => sum + l.packetLoss, 0) / allLinks.length;
    
    return generateSLAIndicators(avgUptime, avgLatency, avgPacketLoss);
  }

  async getDashboardStats(clientId?: number): Promise<DashboardStats> {
    const allLinks = clientId ? await this.getLinks(clientId) : await this.getLinks();
    const operationalLinks = allLinks.filter((l) => l.status === "operational").length;
    const avgUptime = allLinks.length > 0 
      ? allLinks.reduce((sum, l) => sum + l.uptime, 0) / allLinks.length 
      : 0;
    const avgLatency = allLinks.length > 0 
      ? allLinks.reduce((sum, l) => sum + l.latency, 0) / allLinks.length 
      : 0;
    const totalBandwidth = allLinks.reduce((sum, l) => sum + l.bandwidth, 0);
    
    const unresolvedEventsQuery = clientId 
      ? db.select().from(events).where(and(eq(events.clientId, clientId), eq(events.resolved, false)))
      : db.select().from(events).where(eq(events.resolved, false));
    const unresolvedEvents = await unresolvedEventsQuery;
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const ddosTodayQuery = clientId
      ? db.select().from(ddosEvents).where(and(eq(ddosEvents.clientId, clientId), gte(ddosEvents.startTime, today)))
      : db.select().from(ddosEvents).where(gte(ddosEvents.startTime, today));
    const ddosToday = await ddosTodayQuery;

    const openIncidentsQuery = clientId
      ? db.select().from(incidents).where(and(eq(incidents.clientId, clientId), isNull(incidents.closedAt)))
      : db.select().from(incidents).where(isNull(incidents.closedAt));
    const openIncidentsList = await openIncidentsQuery;

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

  async addMetric(linkId: number, clientId: number, data: Omit<Metric, "id" | "timestamp" | "linkId" | "clientId">): Promise<void> {
    await db.insert(metrics).values({
      linkId,
      clientId,
      download: data.download,
      upload: data.upload,
      latency: data.latency,
      packetLoss: data.packetLoss,
      cpuUsage: data.cpuUsage,
      memoryUsage: data.memoryUsage,
      errorRate: data.errorRate,
    });
  }

  async updateLinkStatus(id: number, data: Partial<Link>): Promise<void> {
    await db.update(links).set({
      ...data,
      lastUpdated: new Date(),
    }).where(eq(links.id, id));
  }

  async initializeDefaultData(): Promise<void> {
    const existingClients = await this.getClients();
    if (existingClients.length > 0) return;

    const [defaultClient] = await db.insert(clients).values({
      name: "Defensoria Pública do Estado de Sergipe",
      slug: "dpe-se",
      cnpj: "09.264.424/0001-00",
      address: "Aracaju, SE",
      email: "contato@defensoria.se.def.br",
      isActive: true,
    }).returning();

    await db.insert(clientSettings).values({
      clientId: defaultClient.id,
      slaAvailability: 99.0,
      slaLatency: 80,
      slaPacketLoss: 2,
      slaRepairTime: 6,
      dataRetentionDays: 180,
    });

    await db.insert(users).values({
      email: "admin@defensoria.se.def.br",
      passwordHash: hashPassword("admin123"),
      name: "Administrador DPE/SE",
      role: "admin",
      clientId: defaultClient.id,
      isActive: true,
    });

    const [sedeLink] = await db.insert(links).values({
      clientId: defaultClient.id,
      identifier: "sede",
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
      monitoringEnabled: true,
      icmpInterval: 30,
    }).returning();

    const [centralLink] = await db.insert(links).values({
      clientId: defaultClient.id,
      identifier: "central",
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
      monitoringEnabled: true,
      icmpInterval: 30,
    }).returning();

    const now = new Date();
    await db.insert(events).values([
      {
        linkId: sedeLink.id,
        clientId: defaultClient.id,
        type: "info",
        title: "Manutenção preventiva concluída",
        description: "Atualização de firmware do equipamento CPE realizada com sucesso",
        timestamp: new Date(now.getTime() - 2 * 60 * 60 * 1000),
        resolved: true,
        resolvedAt: new Date(now.getTime() - 1 * 60 * 60 * 1000),
      },
      {
        linkId: centralLink.id,
        clientId: defaultClient.id,
        type: "warning",
        title: "Latência elevada detectada",
        description: "Latência acima de 60ms detectada por 10 minutos",
        timestamp: new Date(now.getTime() - 4 * 60 * 60 * 1000),
        resolved: true,
        resolvedAt: new Date(now.getTime() - 3.5 * 60 * 60 * 1000),
      },
    ]);

    await db.insert(ddosEvents).values([
      {
        linkId: centralLink.id,
        clientId: defaultClient.id,
        attackType: "UDP Flood",
        startTime: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000),
        endTime: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000 + 45 * 60 * 1000),
        peakBandwidth: 1.2,
        mitigationStatus: "resolved",
        sourceIps: 12500,
        blockedPackets: 8500000,
      },
    ]);

    for (const link of [sedeLink, centralLink]) {
      const baseDownload = link.identifier === "sede" ? 85 : 120;
      const baseUpload = link.identifier === "sede" ? 45 : 75;
      
      for (let i = 24; i >= 0; i--) {
        const timestamp = new Date(now.getTime() - i * 5 * 60 * 1000);
        const variation = Math.sin(i * 0.5) * 20;
        
        await db.insert(metrics).values({
          linkId: link.id,
          clientId: defaultClient.id,
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

    console.log("Initialized default client: DPE/SE with 2 links");
  }

  startMetricCollection(): void {
    setInterval(async () => {
      try {
        const allLinks = await this.getLinks();
        
        for (const link of allLinks) {
          if (!link.monitoringEnabled) continue;

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

          await this.addMetric(link.id, link.clientId, {
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

  async getLinkStatusDetail(linkId: number): Promise<LinkStatusDetail | undefined> {
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

  async updateLinkFailureState(linkId: number, failureReason: string | null, failureSource: string | null): Promise<void> {
    await db.update(links).set({
      failureReason,
      failureSource,
      lastFailureAt: failureReason ? new Date() : null,
      status: failureReason ? "down" : "operational",
      lastUpdated: new Date(),
    }).where(eq(links.id, linkId));
  }

  async getIncidents(clientId?: number): Promise<Incident[]> {
    if (clientId) {
      return await db.select().from(incidents).where(eq(incidents.clientId, clientId)).orderBy(desc(incidents.openedAt));
    }
    return await db.select().from(incidents).orderBy(desc(incidents.openedAt));
  }

  async getLinkIncidents(linkId: number): Promise<Incident[]> {
    return await db
      .select()
      .from(incidents)
      .where(eq(incidents.linkId, linkId))
      .orderBy(desc(incidents.openedAt));
  }

  async getOpenIncidents(clientId?: number): Promise<Incident[]> {
    if (clientId) {
      return await db.select().from(incidents).where(and(eq(incidents.clientId, clientId), isNull(incidents.closedAt))).orderBy(desc(incidents.openedAt));
    }
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

  async getClientSettings(clientId: number): Promise<ClientSettings | undefined> {
    const [settings] = await db.select().from(clientSettings).where(eq(clientSettings.clientId, clientId));
    return settings || undefined;
  }

  async updateClientSettings(clientId: number, data: Partial<ClientSettings>): Promise<void> {
    await db.update(clientSettings).set({ ...data, updatedAt: new Date() }).where(eq(clientSettings.clientId, clientId));
  }
}

export const storage = new DatabaseStorage();

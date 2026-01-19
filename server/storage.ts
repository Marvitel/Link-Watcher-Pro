import {
  clients,
  users,
  links,
  hosts,
  metrics,
  metricsHourly,
  metricsDaily,
  events,
  ddosEvents,
  incidents,
  clientSettings,
  groups,
  groupMembers,
  permissions,
  groupPermissions,
  snmpProfiles,
  mibConfigs,
  hostMibConfigs,
  eventTypes,
  clientEventSettings,
  equipmentVendors,
  olts,
  snmpConcentrators,
  erpIntegrations,
  clientErpMappings,
  monitoringSettings,
  linkMonitoringState,
  auditLogs,
  radiusSettings,
  radiusGroupMappings,
  linkGroups,
  linkGroupMembers,
  externalIntegrations,
  blacklistChecks,
  type Client,
  type User,
  type Link,
  type Host,
  type Metric,
  type Event,
  type DDoSEvent,
  type Incident,
  type ClientSettings,
  type Group,
  type GroupMember,
  type Permission,
  type GroupPermission,
  type SnmpProfile,
  type MibConfig,
  type HostMibConfig,
  type EventType,
  type ClientEventSetting,
  type EquipmentVendor,
  type Olt,
  type SnmpConcentrator,
  type ErpIntegration,
  type ClientErpMapping,
  type MonitoringSetting,
  type LinkMonitoringState,
  type AuditLog,
  type InsertAuditLog,
  type RadiusSettings,
  type InsertRadiusSettings,
  type LinkGroup,
  type LinkGroupMember,
  type InsertClient,
  type InsertUser,
  type InsertLink,
  type InsertHost,
  type InsertIncident,
  type InsertClientSettings,
  type InsertDDoSEvent,
  type InsertGroup,
  type InsertSnmpProfile,
  type InsertMibConfig,
  type InsertEventType,
  type InsertClientEventSetting,
  type InsertOlt,
  type InsertSnmpConcentrator,
  type InsertErpIntegration,
  type InsertClientErpMapping,
  type InsertEquipmentVendor,
  type InsertLinkGroup,
  type InsertLinkGroupMember,
  type RadiusGroupMapping,
  type InsertRadiusGroupMapping,
  type SLAIndicator,
  type DashboardStats,
  type LinkStatusDetail,
  type AuthUser,
  type ExternalIntegration,
  type InsertExternalIntegration,
  type BlacklistCheck,
  type InsertBlacklistCheck,
} from "@shared/schema";
import { db } from "./db";
import { startRealTimeMonitoring } from "./monitoring";
import { startAggregationJobs } from "./aggregation";
import { eq, desc, gte, lte, and, lt, isNull, sql, or } from "drizzle-orm";
import crypto from "crypto";

function hashPassword(password: string): string {
  return crypto.createHash("sha256").update(password).digest("hex");
}

interface SLACalculation {
  availability: number;  // % de tempo operacional
  avgLatency: number;    // latência média em ms
  avgPacketLoss: number; // % perda de pacotes média
  totalMetrics: number;  // total de amostras
  operationalMetrics: number; // amostras com status "operational"
  avgRepairTime: number; // tempo médio de reparo em horas
}

function buildSLAIndicators(calc: SLACalculation): SLAIndicator[] {
  const uptime = calc.availability;
  const latency = calc.avgLatency;
  const packetLoss = calc.avgPacketLoss;
  const repairTime = calc.avgRepairTime;
  
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
      current: repairTime <= 6 ? 100 : Math.max(0, 100 - ((repairTime - 6) * 10)),
      periodicity: "Mensal",
      status: repairTime <= 6 ? "compliant" : repairTime <= 8 ? "warning" : "non_compliant",
    },
  ];
}

// Legacy function for backwards compatibility
function generateSLAIndicators(linkUptime?: number, linkLatency?: number, linkPacketLoss?: number): SLAIndicator[] {
  return buildSLAIndicators({
    availability: linkUptime ?? 99.85,
    avgLatency: linkLatency ?? 45,
    avgPacketLoss: linkPacketLoss ?? 0.45,
    totalMetrics: 0,
    operationalMetrics: 0,
    avgRepairTime: 2,
  });
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
    // Delete associated events, metrics, ddos events, and incidents
    await db.delete(events).where(eq(events.clientId, id));
    await db.delete(ddosEvents).where(eq(ddosEvents.clientId, id));
    await db.delete(incidents).where(eq(incidents.clientId, id));
    // Delete metrics for all links of this client
    const clientLinks = await db.select({ id: links.id }).from(links).where(eq(links.clientId, id));
    for (const link of clientLinks) {
      await db.delete(metrics).where(eq(metrics.linkId, link.id));
      await db.delete(metricsHourly).where(eq(metricsHourly.linkId, link.id));
      await db.delete(metricsDaily).where(eq(metricsDaily.linkId, link.id));
    }
    // Delete hosts and links
    await db.delete(hosts).where(eq(hosts.clientId, id));
    await db.delete(links).where(eq(links.clientId, id));
    // Soft delete the client
    await db.update(clients).set({ isActive: false, updatedAt: new Date() }).where(eq(clients.id, id));
  }

  async getUsers(clientId?: number): Promise<User[]> {
    if (clientId) {
      return await db.select().from(users).where(and(eq(users.clientId, clientId), eq(users.isActive, true)));
    }
    return await db.select().from(users).where(eq(users.isActive, true));
  }

  async getSuperAdmins(): Promise<User[]> {
    return await db.select().from(users).where(and(eq(users.isSuperAdmin, true), eq(users.isActive, true)));
  }

  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
    return user || undefined;
  }

  async getUserByEmailOrUsername(identifier: string): Promise<User | undefined> {
    const lowerIdentifier = identifier.toLowerCase();
    const [user] = await db.select().from(users).where(
      or(
        eq(users.email, lowerIdentifier),
        eq(sql`LOWER(${users.radiusUsername})`, lowerIdentifier)
      )
    );
    return user || undefined;
  }

  async createUser(data: InsertUser): Promise<User> {
    // Preservar prefixo RADIUS_ONLY: sem hash (marcador de usuário apenas RADIUS)
    const passwordHash = data.passwordHash.startsWith("RADIUS_ONLY:") 
      ? data.passwordHash 
      : hashPassword(data.passwordHash);
    
    const [user] = await db.insert(users).values({
      ...data,
      email: data.email.toLowerCase(),
      passwordHash,
    }).returning();
    return user;
  }

  async updateUser(id: number, data: Partial<User>): Promise<void> {
    const updateData: Partial<User> = { ...data, updatedAt: new Date() };
    if (data.passwordHash) {
      // Preservar prefixo RADIUS_ONLY: sem hash (marcador de usuário apenas RADIUS)
      updateData.passwordHash = data.passwordHash.startsWith("RADIUS_ONLY:")
        ? data.passwordHash
        : hashPassword(data.passwordHash);
    }
    await db.update(users).set(updateData).where(eq(users.id, id));
  }

  async deleteUser(id: number): Promise<void> {
    await db.delete(groupMembers).where(eq(groupMembers.userId, id));
    await db.delete(users).where(eq(users.id, id));
  }

  async validateCredentials(identifier: string, password: string): Promise<AuthUser | null> {
    const user = await this.getUserByEmailOrUsername(identifier);
    if (!user || !user.isActive) return null;
    
    // Rejeitar usuários criados via RADIUS - eles só podem autenticar via RADIUS
    if (user.passwordHash.startsWith("RADIUS_ONLY:")) {
      console.log(`[AUTH] Usuário ${identifier} é apenas RADIUS - rejeitando autenticação local`);
      return null;
    }
    
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
      isSuperAdmin: user.isSuperAdmin,
    };
  }

  async getLinks(clientId?: number): Promise<Link[]> {
    if (clientId) {
      return await db.select().from(links).where(eq(links.clientId, clientId));
    }
    // Filter to only show links from active clients
    const activeClients = await db.select({ id: clients.id }).from(clients).where(eq(clients.isActive, true));
    const activeClientIds = activeClients.map(c => c.id);
    if (activeClientIds.length === 0) {
      return [];
    }
    return await db.select().from(links).where(sql`${links.clientId} IN (${sql.join(activeClientIds.map(id => sql`${id}`), sql`, `)})`);
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
    // Delete all associated records from related tables
    await db.delete(events).where(eq(events.linkId, id));
    await db.delete(metrics).where(eq(metrics.linkId, id));
    await db.delete(metricsHourly).where(eq(metricsHourly.linkId, id));
    await db.delete(metricsDaily).where(eq(metricsDaily.linkId, id));
    await db.delete(hosts).where(eq(hosts.linkId, id));
    await db.delete(ddosEvents).where(eq(ddosEvents.linkId, id));
    await db.delete(incidents).where(eq(incidents.linkId, id));
    await db.delete(linkMonitoringState).where(eq(linkMonitoringState.linkId, id));
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

  async getLinkMetrics(linkId: number, limit?: number, hours?: number, fromDate?: Date, toDate?: Date): Promise<Metric[]> {
    let startDate: Date;
    let endDate: Date | undefined;
    
    if (fromDate && toDate) {
      startDate = fromDate;
      endDate = toDate;
    } else if (hours) {
      startDate = new Date();
      startDate.setHours(startDate.getHours() - hours);
    } else {
      startDate = new Date();
      startDate.setMonth(startDate.getMonth() - 6);
    }
    
    const now = new Date();
    const hoursSpan = (now.getTime() - startDate.getTime()) / (1000 * 60 * 60);
    
    // Mínimo de pontos esperados para considerar dados agregados suficientes
    const expectedDailyPoints = Math.ceil(hoursSpan / 24);
    const expectedHourlyPoints = Math.ceil(hoursSpan);
    
    if (hoursSpan >= 24 * 30) {
      const conditions = [eq(metricsDaily.linkId, linkId), gte(metricsDaily.bucketStart, startDate)];
      if (endDate) conditions.push(lte(metricsDaily.bucketStart, endDate));
      
      const dailyData = await db
        .select()
        .from(metricsDaily)
        .where(and(...conditions))
        .orderBy(desc(metricsDaily.bucketStart));
      
      // Usar dados diários somente se tiver pelo menos 50% dos pontos esperados
      if (dailyData.length >= expectedDailyPoints * 0.5) {
        return dailyData.map(d => {
          const totalSamples = d.operationalCount + d.degradedCount + d.offlineCount;
          const dominantStatus = d.offlineCount > totalSamples * 0.5 ? "offline" 
            : d.degradedCount > totalSamples * 0.3 ? "degraded" : "operational";
          return {
            id: d.id,
            linkId: d.linkId,
            clientId: d.clientId,
            timestamp: d.bucketStart,
            download: d.downloadAvg,
            upload: d.uploadAvg,
            latency: d.latencyAvg,
            packetLoss: d.packetLossAvg,
            cpuUsage: d.cpuUsageAvg,
            memoryUsage: d.memoryUsageAvg,
            errorRate: d.offlineCount > 0 ? (d.offlineCount / Math.max(1, totalSamples)) * 100 : 0,
            status: dominantStatus,
          };
        });
      }
    }
    
    if (hoursSpan >= 24 * 7) {
      const conditions = [eq(metricsHourly.linkId, linkId), gte(metricsHourly.bucketStart, startDate)];
      if (endDate) conditions.push(lte(metricsHourly.bucketStart, endDate));
      
      const hourlyData = await db
        .select()
        .from(metricsHourly)
        .where(and(...conditions))
        .orderBy(desc(metricsHourly.bucketStart));
      
      // Usar dados horários somente se tiver pelo menos 30% dos pontos esperados
      if (hourlyData.length >= expectedHourlyPoints * 0.3) {
        return hourlyData.map(d => {
          const totalSamples = d.operationalCount + d.degradedCount + d.offlineCount;
          const dominantStatus = d.offlineCount > totalSamples * 0.5 ? "offline" 
            : d.degradedCount > totalSamples * 0.3 ? "degraded" : "operational";
          return {
            id: d.id,
            linkId: d.linkId,
            clientId: d.clientId,
            timestamp: d.bucketStart,
            download: d.downloadAvg,
            upload: d.uploadAvg,
            latency: d.latencyAvg,
            packetLoss: d.packetLossAvg,
            cpuUsage: d.cpuUsageAvg,
            memoryUsage: d.memoryUsageAvg,
            errorRate: d.offlineCount > 0 ? (d.offlineCount / Math.max(1, totalSamples)) * 100 : 0,
            status: dominantStatus,
          };
        });
      }
    }
    
    const conditions = [eq(metrics.linkId, linkId), gte(metrics.timestamp, startDate)];
    if (endDate) {
      conditions.push(lte(metrics.timestamp, endDate));
    }
    
    const rawData = await db
      .select()
      .from(metrics)
      .where(and(...conditions))
      .orderBy(desc(metrics.timestamp));
    
    if (limit) {
      return rawData.slice(0, limit);
    }
    
    // Downsample para períodos longos (>7 dias) se houver muitos pontos
    const maxPoints = hoursSpan > 24 * 7 ? 720 : 2000; // 1 ponto por hora para 30d, mais pontos para 7d
    if (rawData.length > maxPoints) {
      const step = Math.ceil(rawData.length / maxPoints);
      return rawData.filter((_, i) => i % step === 0);
    }
    
    return rawData;
  }

  async getLinkEvents(linkId: number): Promise<(Event & { linkName?: string | null })[]> {
    return await db
      .select({
        id: events.id,
        linkId: events.linkId,
        clientId: events.clientId,
        type: events.type,
        title: events.title,
        description: events.description,
        timestamp: events.timestamp,
        resolved: events.resolved,
        resolvedAt: events.resolvedAt,
        linkName: links.name,
      })
      .from(events)
      .leftJoin(links, eq(events.linkId, links.id))
      .where(eq(events.linkId, linkId))
      .orderBy(desc(events.timestamp));
  }

  async getLinkSLA(linkId: number): Promise<SLAIndicator[]> {
    const link = await this.getLink(linkId);
    return generateSLAIndicators(link?.uptime, link?.latency, link?.packetLoss);
  }

  async getEventsPaginated(clientId?: number, page: number = 1, pageSize: number = 50): Promise<{
    events: (Event & { linkName?: string | null })[];
    total: number;
    counts: { total: number; active: number; critical: number; warning: number };
  }> {
    // Get active client IDs to filter events
    const activeClients = await db.select({ id: clients.id }).from(clients).where(eq(clients.isActive, true));
    const activeClientIds = activeClients.map(c => c.id);
    
    if (activeClientIds.length === 0) {
      return { events: [], total: 0, counts: { total: 0, active: 0, critical: 0, warning: 0 } };
    }
    
    // Build the active clients filter condition
    const activeClientsFilter = sql`${events.clientId} IN (${sql.join(activeClientIds.map(id => sql`${id}`), sql`, `)})`;
    const clientFilter = clientId ? eq(events.clientId, clientId) : activeClientsFilter;
    
    // Get total count
    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(events)
      .where(clientFilter);
    const total = countResult?.count || 0;
    
    // Get counts by type/status
    const countsResult = await db
      .select({
        type: events.type,
        resolved: events.resolved,
        count: sql<number>`count(*)::int`,
      })
      .from(events)
      .where(clientFilter)
      .groupBy(events.type, events.resolved);
    
    const counts = {
      total,
      active: 0,
      critical: 0,
      warning: 0,
    };
    
    for (const row of countsResult) {
      if (!row.resolved) counts.active += row.count;
      if (row.type === 'critical') counts.critical += row.count;
      if (row.type === 'warning') counts.warning += row.count;
    }
    
    // Get paginated events
    const offset = (page - 1) * pageSize;
    const eventsList = await db
      .select({
        id: events.id,
        linkId: events.linkId,
        clientId: events.clientId,
        type: events.type,
        title: events.title,
        description: events.description,
        timestamp: events.timestamp,
        resolved: events.resolved,
        resolvedAt: events.resolvedAt,
        linkName: links.name,
      })
      .from(events)
      .leftJoin(links, eq(events.linkId, links.id))
      .where(clientFilter)
      .orderBy(desc(events.timestamp))
      .limit(pageSize)
      .offset(offset);
    
    return { events: eventsList, total, counts };
  }

  async deleteAllEvents(clientId: number): Promise<number> {
    const result = await db.delete(events)
      .where(eq(events.clientId, clientId))
      .returning();
    return result.length;
  }

  async getUnresolvedEventsByLinkIds(linkIds: number[]): Promise<Event[]> {
    if (linkIds.length === 0) return [];
    
    const linkIdsCondition = sql`${events.linkId} IN (${sql.join(linkIds.map(id => sql`${id}`), sql`, `)})`;
    
    const unresolvedEvents = await db
      .select()
      .from(events)
      .where(and(linkIdsCondition, eq(events.resolved, false)))
      .orderBy(desc(events.timestamp));
    
    return unresolvedEvents;
  }

  async resolveAllEventsForLink(linkId: number): Promise<number> {
    const result = await db
      .update(events)
      .set({ resolved: true, resolvedAt: new Date() })
      .where(and(eq(events.linkId, linkId), eq(events.resolved, false)))
      .returning();
    return result.length;
  }

  async getLatestUnresolvedLinkEvent(linkId: number, eventType?: string): Promise<Event | null> {
    const conditions = [
      eq(events.linkId, linkId),
      eq(events.resolved, false),
    ];
    if (eventType) {
      conditions.push(eq(events.type, eventType));
    }
    const [event] = await db
      .select()
      .from(events)
      .where(and(...conditions))
      .orderBy(desc(events.timestamp))
      .limit(1);
    return event || null;
  }

  async updateEventDescription(eventId: number, newDescription: string): Promise<Event | null> {
    const [updated] = await db
      .update(events)
      .set({ description: newDescription })
      .where(eq(events.id, eventId))
      .returning();
    return updated || null;
  }

  async createOltDiagnosisEvent(linkId: number, clientId: number, diagnosis: string, alarmType: string | null): Promise<Event> {
    const [event] = await db.insert(events).values({
      linkId,
      clientId,
      type: "info",
      title: "Diagnóstico OLT realizado",
      description: `Resultado: ${diagnosis}${alarmType ? ` (Alarme: ${alarmType})` : ""}`,
      timestamp: new Date(),
      resolved: true,
    }).returning();
    return event;
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

  async updateDDoSEvent(id: number, data: Partial<InsertDDoSEvent & { startTime?: Date }>): Promise<DDoSEvent | null> {
    const [event] = await db.update(ddosEvents)
      .set({
        linkId: data.linkId,
        clientId: data.clientId,
        attackType: data.attackType,
        startTime: data.startTime,
        endTime: data.endTime,
        peakBandwidth: data.peakBandwidth,
        mitigationStatus: data.mitigationStatus,
        sourceIps: data.sourceIps,
        blockedPackets: data.blockedPackets,
        wanguardAnomalyId: data.wanguardAnomalyId,
        wanguardSensor: data.wanguardSensor,
        targetIp: data.targetIp,
        decoder: data.decoder,
      })
      .where(eq(ddosEvents.id, id))
      .returning();
    return event || null;
  }

  async deleteDDoSEventsWithoutWanguardId(clientId: number): Promise<number> {
    const result = await db.delete(ddosEvents)
      .where(and(
        eq(ddosEvents.clientId, clientId),
        sql`${ddosEvents.wanguardAnomalyId} IS NULL`
      ))
      .returning();
    return result.length;
  }

  async deleteAllDDoSEvents(clientId: number): Promise<number> {
    const result = await db.delete(ddosEvents)
      .where(eq(ddosEvents.clientId, clientId))
      .returning();
    return result.length;
  }

  async calculateSLAFromMetrics(clientId?: number, fromDate?: Date, toDate?: Date, linkId?: number): Promise<SLACalculation> {
    // If linkId provided, filter to that specific link only
    let targetLinks: Link[];
    if (linkId) {
      const link = await this.getLink(linkId);
      if (!link) {
        return {
          availability: 0,
          avgLatency: 0,
          avgPacketLoss: 0,
          totalMetrics: 0,
          operationalMetrics: 0,
          avgRepairTime: 0,
        };
      }
      targetLinks = [link];
    } else {
      targetLinks = clientId ? await this.getLinks(clientId) : await this.getLinks();
    }
    
    if (targetLinks.length === 0) {
      return {
        availability: 0,
        avgLatency: 0,
        avgPacketLoss: 0,
        totalMetrics: 0,
        operationalMetrics: 0,
        avgRepairTime: 0,
      };
    }

    // Build date conditions
    const conditions: any[] = [];
    if (fromDate) {
      conditions.push(gte(metrics.timestamp, fromDate));
    }
    if (toDate) {
      conditions.push(lte(metrics.timestamp, toDate));
    }
    
    // If no dates, use last 6 months (default retention)
    if (!fromDate && !toDate) {
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      conditions.push(gte(metrics.timestamp, sixMonthsAgo));
    }

    // Filter by target links
    const targetLinkIds = targetLinks.map(l => l.id);
    
    // Get all metrics for the period
    let allMetrics: Metric[] = [];
    for (const lid of targetLinkIds) {
      const linkMetrics = await db
        .select()
        .from(metrics)
        .where(and(
          eq(metrics.linkId, lid),
          ...conditions
        ));
      allMetrics = allMetrics.concat(linkMetrics);
    }

    if (allMetrics.length === 0) {
      // Fall back to current link values if no metrics
      const avgUptime = targetLinks.reduce((sum, l) => sum + l.uptime, 0) / targetLinks.length;
      const avgLatency = targetLinks.reduce((sum, l) => sum + l.latency, 0) / targetLinks.length;
      const avgPacketLoss = targetLinks.reduce((sum, l) => sum + l.packetLoss, 0) / targetLinks.length;
      return {
        availability: avgUptime,
        avgLatency: avgLatency,
        avgPacketLoss: avgPacketLoss,
        totalMetrics: 0,
        operationalMetrics: 0,
        avgRepairTime: 2,
      };
    }

    // Calculate availability: % of metrics where status is "operational"
    const operationalMetrics = allMetrics.filter(m => m.status === "operational").length;
    const availability = (operationalMetrics / allMetrics.length) * 100;

    // Calculate average latency (ignoring zeros)
    const latencyMetrics = allMetrics.filter(m => m.latency > 0);
    const avgLatency = latencyMetrics.length > 0
      ? latencyMetrics.reduce((sum, m) => sum + m.latency, 0) / latencyMetrics.length
      : 0;

    // Calculate average packet loss
    const avgPacketLoss = allMetrics.reduce((sum, m) => sum + m.packetLoss, 0) / allMetrics.length;

    // Calculate average repair time from incidents
    const incidentConditions: any[] = [];
    if (clientId) {
      incidentConditions.push(eq(incidents.clientId, clientId));
    }
    if (fromDate) {
      incidentConditions.push(gte(incidents.openedAt, fromDate));
    }
    if (toDate) {
      incidentConditions.push(lte(incidents.openedAt, toDate));
    }
    
    const closedIncidents = await db
      .select()
      .from(incidents)
      .where(incidentConditions.length > 0 ? and(...incidentConditions, sql`${incidents.closedAt} IS NOT NULL`) : sql`${incidents.closedAt} IS NOT NULL`);
    
    let avgRepairTime = 2; // Default 2 hours if no incidents
    if (closedIncidents.length > 0) {
      const totalRepairHours = closedIncidents.reduce((sum, inc) => {
        if (inc.closedAt && inc.openedAt) {
          const diffMs = new Date(inc.closedAt).getTime() - new Date(inc.openedAt).getTime();
          return sum + (diffMs / (1000 * 60 * 60)); // convert to hours
        }
        return sum;
      }, 0);
      avgRepairTime = totalRepairHours / closedIncidents.length;
    }

    return {
      availability,
      avgLatency,
      avgPacketLoss,
      totalMetrics: allMetrics.length,
      operationalMetrics,
      avgRepairTime,
    };
  }

  async getSLAIndicators(clientId?: number, fromDate?: Date, toDate?: Date, linkId?: number): Promise<SLAIndicator[]> {
    const calc = await this.calculateSLAFromMetrics(clientId, fromDate, toDate, linkId);
    return buildSLAIndicators(calc);
  }
  
  async getSLAIndicatorsMonthly(clientId?: number, year?: number, month?: number, linkId?: number): Promise<SLAIndicator[]> {
    const now = new Date();
    const targetYear = year ?? now.getFullYear();
    const targetMonth = month ?? now.getMonth(); // 0-indexed
    
    const fromDate = new Date(targetYear, targetMonth, 1, 0, 0, 0, 0);
    const toDate = new Date(targetYear, targetMonth + 1, 0, 23, 59, 59, 999);
    
    return this.getSLAIndicators(clientId, fromDate, toDate, linkId);
  }
  
  async getSLAIndicatorsAccumulated(clientId?: number, linkId?: number): Promise<SLAIndicator[]> {
    // Use full retention period (6 months)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    
    return this.getSLAIndicators(clientId, sixMonthsAgo, new Date(), linkId);
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
      status: data.status || "operational",
    });
  }

  async updateLinkStatus(id: number, data: Partial<Link>): Promise<void> {
    await db.update(links).set({
      ...data,
      lastUpdated: new Date(),
    }).where(eq(links.id, id));
  }

  async initializeDefaultEquipmentVendors(): Promise<void> {
    const existingVendors = await db.select().from(equipmentVendors);
    if (existingVendors.length > 0) return;

    const defaultVendors = [
      {
        name: "Fortinet (FortiGate)",
        slug: "fortigate",
        cpuOid: "1.3.6.1.4.1.12356.101.4.1.3.0",      // fgSysCpuUsage
        memoryOid: "1.3.6.1.4.1.12356.101.4.1.4.0",   // fgSysMemUsage
        memoryIsPercentage: true,
        description: "FortiGate Firewalls (FortiOS)",
        isBuiltIn: true,
      },
      {
        name: "Mikrotik (RouterOS)",
        slug: "mikrotik",
        cpuOid: "1.3.6.1.2.1.25.3.3.1.2.1",           // hrProcessorLoad.1
        memoryOid: null,                              // Needs calculation
        memoryTotalOid: "1.3.6.1.2.1.25.2.3.1.5.65536",  // hrStorageSize
        memoryUsedOid: "1.3.6.1.2.1.25.2.3.1.6.65536",   // hrStorageUsed
        memoryIsPercentage: false,
        description: "Mikrotik RouterOS devices",
        isBuiltIn: true,
      },
      {
        name: "Cisco (IOS)",
        slug: "cisco",
        cpuOid: "1.3.6.1.4.1.9.2.1.57.0",             // avgBusy5 (5min avg CPU)
        memoryOid: null,
        memoryTotalOid: "1.3.6.1.4.1.9.9.48.1.1.1.5.1", // ciscoMemoryPoolFree
        memoryUsedOid: "1.3.6.1.4.1.9.9.48.1.1.1.6.1",  // ciscoMemoryPoolUsed
        memoryIsPercentage: false,
        description: "Cisco IOS/IOS-XE devices",
        isBuiltIn: true,
      },
      {
        name: "Huawei",
        slug: "huawei",
        cpuOid: "1.3.6.1.4.1.2011.5.25.31.1.1.1.1.5.0",  // hwEntityCpuUsage
        memoryOid: "1.3.6.1.4.1.2011.5.25.31.1.1.1.1.7.0", // hwEntityMemUsage
        memoryIsPercentage: true,
        description: "Huawei network devices",
        isBuiltIn: true,
      },
      {
        name: "Datacom",
        slug: "datacom",
        cpuOid: "1.3.6.1.4.1.3709.3.5.201.1.1.5.0",    // CPU usage
        memoryOid: "1.3.6.1.4.1.3709.3.5.201.1.1.6.0", // Memory usage
        memoryIsPercentage: true,
        description: "Datacom network devices",
        isBuiltIn: true,
      },
      {
        name: "Ubiquiti (EdgeOS/UniFi)",
        slug: "ubiquiti",
        cpuOid: "1.3.6.1.2.1.25.3.3.1.2.1",           // hrProcessorLoad.1
        memoryOid: null,
        memoryTotalOid: "1.3.6.1.2.1.25.2.2.0",       // hrMemorySize
        memoryUsedOid: null,
        memoryIsPercentage: false,
        description: "Ubiquiti EdgeRouter/UniFi devices",
        isBuiltIn: true,
      },
      {
        name: "Ruijie",
        slug: "ruijie",
        cpuOid: "1.3.6.1.4.1.4881.1.1.10.2.36.1.1.2.0", // CPU usage
        memoryOid: "1.3.6.1.4.1.4881.1.1.10.2.36.1.1.6.0", // Memory usage
        memoryIsPercentage: true,
        description: "Ruijie network devices",
        isBuiltIn: true,
      },
      {
        name: "TP-Link",
        slug: "tplink",
        cpuOid: "1.3.6.1.4.1.11863.6.4.1.1.1.1.2.1",  // CPU usage
        memoryOid: "1.3.6.1.4.1.11863.6.4.1.1.2.1.2.1", // Memory usage
        memoryIsPercentage: true,
        description: "TP-Link managed switches and routers",
        isBuiltIn: true,
      },
      {
        name: "Personalizado",
        slug: "custom",
        cpuOid: null,
        memoryOid: null,
        memoryIsPercentage: true,
        description: "Configure OIDs manually in the link settings",
        isBuiltIn: true,
      },
    ];

    for (const vendor of defaultVendors) {
      await db.insert(equipmentVendors).values(vendor);
    }

    console.log("[Storage] Default equipment vendors initialized");
  }

  async initializeDefaultData(): Promise<void> {
    await this.initializeDefaultPermissions();
    await this.initializeDefaultEventTypes();
    await this.initializeDefaultEquipmentVendors();
    await this.initializeSuperAdmin();
    await this.initializeDefaultMonitoringSettings();
    
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
    startRealTimeMonitoring(30);
    startAggregationJobs();
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
      // OLT diagnosis reasons
      "rompimento_fibra": "Rompimento de Fibra",
      "queda_energia": "Queda de Energia",
      "sinal_degradado": "Sinal Degradado",
      "onu_inativa": "ONU Inativa",
      "olt_alarm": "Alarme OLT",
      // Legacy/manual reasons
      "falha_eletrica": "Falha Elétrica",
      "falha_equipamento": "Falha de Equipamento",
      "indefinido": "Causa Indefinida",
      // Network/ping reasons
      "timeout": "Timeout",
      "host_unreachable": "Host Inacessível",
      "network_unreachable": "Rede Inacessível",
      "connection_refused": "Conexão Recusada",
      "packet_loss": "Perda de Pacotes",
      "no_response": "Sem Resposta",
      "dns_failure": "Falha DNS",
      "unknown": "Desconhecido",
    };

    const [activeIncident] = await db
      .select()
      .from(incidents)
      .where(and(eq(incidents.linkId, linkId), isNull(incidents.closedAt)))
      .orderBy(desc(incidents.openedAt))
      .limit(1);

    // Build lastFailureInfo from history fields if available
    const lastFailureInfo = link.lastFailureReason ? {
      reason: link.lastFailureReason,
      reasonLabel: failureReasonLabels[link.lastFailureReason] || link.lastFailureReason,
      source: link.lastFailureSource,
      lastFailureAt: link.lastFailureAt,
    } : null;

    return {
      link,
      failureInfo: {
        reason: link.failureReason,
        reasonLabel: link.failureReason ? failureReasonLabels[link.failureReason] || link.failureReason : "Operacional",
        source: link.failureSource,
        lastFailureAt: link.lastFailureAt,
      },
      lastFailureInfo,
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
    // Check if settings exist for this client
    const existing = await this.getClientSettings(clientId);
    
    if (existing) {
      // Update existing settings
      await db.update(clientSettings)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(clientSettings.clientId, clientId));
    } else {
      // Create new settings for this client
      await db.insert(clientSettings).values({
        clientId,
        ...data,
        updatedAt: new Date(),
      });
    }
  }

  async getGroups(clientId?: number): Promise<Group[]> {
    if (clientId) {
      return await db.select().from(groups).where(eq(groups.clientId, clientId));
    }
    return await db.select().from(groups);
  }

  async getGroup(id: number): Promise<Group | undefined> {
    const [group] = await db.select().from(groups).where(eq(groups.id, id));
    return group || undefined;
  }

  async createGroup(data: InsertGroup): Promise<Group> {
    const [group] = await db.insert(groups).values(data).returning();
    return group;
  }

  async updateGroup(id: number, data: Partial<Group>): Promise<void> {
    await db.update(groups).set({ ...data, updatedAt: new Date() }).where(eq(groups.id, id));
  }

  async deleteGroup(id: number): Promise<void> {
    await db.delete(groupMembers).where(eq(groupMembers.groupId, id));
    await db.delete(groupPermissions).where(eq(groupPermissions.groupId, id));
    await db.delete(groups).where(eq(groups.id, id));
  }

  async getGroupMembers(groupId: number): Promise<User[]> {
    const members = await db.select().from(groupMembers).where(eq(groupMembers.groupId, groupId));
    const userIds = members.map(m => m.userId);
    if (userIds.length === 0) return [];
    const allUsers = await db.select().from(users);
    return allUsers.filter(u => userIds.includes(u.id));
  }

  async addGroupMember(groupId: number, userId: number): Promise<void> {
    const existing = await db.select().from(groupMembers).where(
      and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId))
    );
    if (existing.length > 0) return;
    await db.insert(groupMembers).values({ groupId, userId });
  }

  async removeGroupMember(groupId: number, userId: number): Promise<void> {
    await db.delete(groupMembers).where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)));
  }

  async getPermissions(): Promise<Permission[]> {
    return await db.select().from(permissions);
  }

  async getGroupPermissions(groupId: number): Promise<Permission[]> {
    const gps = await db.select().from(groupPermissions).where(eq(groupPermissions.groupId, groupId));
    const permIds = gps.map(gp => gp.permissionId);
    if (permIds.length === 0) return [];
    const allPerms = await db.select().from(permissions);
    return allPerms.filter(p => permIds.includes(p.id));
  }

  async setGroupPermissions(groupId: number, permissionIds: number[]): Promise<void> {
    await db.delete(groupPermissions).where(eq(groupPermissions.groupId, groupId));
    for (const permissionId of permissionIds) {
      await db.insert(groupPermissions).values({ groupId, permissionId });
    }
  }

  async getUserPermissions(userId: number): Promise<string[]> {
    const memberships = await db.select().from(groupMembers).where(eq(groupMembers.userId, userId));
    if (memberships.length === 0) return [];
    
    const allPerms: string[] = [];
    for (const membership of memberships) {
      const perms = await this.getGroupPermissions(membership.groupId);
      allPerms.push(...perms.map(p => p.code));
    }
    return Array.from(new Set(allPerms));
  }

  async getEquipmentVendors(): Promise<EquipmentVendor[]> {
    return await db.select().from(equipmentVendors).where(eq(equipmentVendors.isActive, true));
  }

  async getAllEquipmentVendors(): Promise<EquipmentVendor[]> {
    return await db.select().from(equipmentVendors).orderBy(equipmentVendors.name);
  }

  async getEquipmentVendor(id: number): Promise<EquipmentVendor | undefined> {
    const [vendor] = await db.select().from(equipmentVendors).where(eq(equipmentVendors.id, id));
    return vendor || undefined;
  }

  async createEquipmentVendor(data: InsertEquipmentVendor): Promise<EquipmentVendor> {
    const [vendor] = await db.insert(equipmentVendors).values(data).returning();
    return vendor;
  }

  async updateEquipmentVendor(id: number, data: Partial<EquipmentVendor>): Promise<void> {
    await db.update(equipmentVendors).set({ ...data, updatedAt: new Date() }).where(eq(equipmentVendors.id, id));
  }

  async deleteEquipmentVendor(id: number): Promise<void> {
    await db.delete(equipmentVendors).where(eq(equipmentVendors.id, id));
  }

  async getSnmpProfiles(clientId: number): Promise<SnmpProfile[]> {
    return await db.select().from(snmpProfiles).where(eq(snmpProfiles.clientId, clientId));
  }

  async getGlobalSnmpProfiles(): Promise<SnmpProfile[]> {
    return await db.select().from(snmpProfiles).where(isNull(snmpProfiles.clientId));
  }

  async getSnmpProfile(id: number): Promise<SnmpProfile | undefined> {
    const [profile] = await db.select().from(snmpProfiles).where(eq(snmpProfiles.id, id));
    return profile || undefined;
  }

  async createSnmpProfile(data: InsertSnmpProfile): Promise<SnmpProfile> {
    const [profile] = await db.insert(snmpProfiles).values(data).returning();
    return profile;
  }

  async updateSnmpProfile(id: number, data: Partial<SnmpProfile>): Promise<void> {
    await db.update(snmpProfiles).set({ ...data, updatedAt: new Date() }).where(eq(snmpProfiles.id, id));
  }

  async deleteSnmpProfile(id: number): Promise<void> {
    await db.delete(snmpProfiles).where(eq(snmpProfiles.id, id));
  }

  async getMibConfigs(clientId: number): Promise<MibConfig[]> {
    return await db.select().from(mibConfigs).where(eq(mibConfigs.clientId, clientId));
  }

  async getMibConfig(id: number): Promise<MibConfig | undefined> {
    const [config] = await db.select().from(mibConfigs).where(eq(mibConfigs.id, id));
    return config || undefined;
  }

  async createMibConfig(data: InsertMibConfig): Promise<MibConfig> {
    const [config] = await db.insert(mibConfigs).values(data).returning();
    return config;
  }

  async updateMibConfig(id: number, data: Partial<MibConfig>): Promise<void> {
    await db.update(mibConfigs).set({ ...data, updatedAt: new Date() }).where(eq(mibConfigs.id, id));
  }

  async deleteMibConfig(id: number): Promise<void> {
    await db.delete(hostMibConfigs).where(eq(hostMibConfigs.mibConfigId, id));
    await db.delete(mibConfigs).where(eq(mibConfigs.id, id));
  }

  async getHostMibConfigs(hostId: number): Promise<HostMibConfig[]> {
    return await db.select().from(hostMibConfigs).where(eq(hostMibConfigs.hostId, hostId));
  }

  async addHostMibConfig(hostId: number, mibConfigId: number): Promise<void> {
    const host = await this.getHost(hostId);
    if (!host) return;
    
    const mibConfig = await this.getMibConfig(mibConfigId);
    if (!mibConfig || mibConfig.clientId !== host.clientId) return;
    
    const existing = await db.select().from(hostMibConfigs).where(
      and(eq(hostMibConfigs.hostId, hostId), eq(hostMibConfigs.mibConfigId, mibConfigId))
    );
    if (existing.length > 0) return;
    await db.insert(hostMibConfigs).values({ hostId, mibConfigId });
  }

  async removeHostMibConfig(hostId: number, mibConfigId: number): Promise<void> {
    await db.delete(hostMibConfigs).where(
      and(eq(hostMibConfigs.hostId, hostId), eq(hostMibConfigs.mibConfigId, mibConfigId))
    );
  }

  async setHostMibConfigs(hostId: number, mibConfigIds: number[]): Promise<void> {
    const host = await this.getHost(hostId);
    if (!host) return;
    
    await db.delete(hostMibConfigs).where(eq(hostMibConfigs.hostId, hostId));
    for (const mibConfigId of mibConfigIds) {
      const mibConfig = await this.getMibConfig(mibConfigId);
      if (!mibConfig || mibConfig.clientId !== host.clientId) continue;
      await db.insert(hostMibConfigs).values({ hostId, mibConfigId });
    }
  }

  async getEventTypes(): Promise<EventType[]> {
    return await db.select().from(eventTypes);
  }

  async getEventType(id: number): Promise<EventType | undefined> {
    const [eventType] = await db.select().from(eventTypes).where(eq(eventTypes.id, id));
    return eventType || undefined;
  }

  async getEventTypeByCode(code: string): Promise<EventType | undefined> {
    const [eventType] = await db.select().from(eventTypes).where(eq(eventTypes.code, code));
    return eventType || undefined;
  }

  async createEventType(data: InsertEventType): Promise<EventType> {
    const [eventType] = await db.insert(eventTypes).values(data).returning();
    return eventType;
  }

  async getClientEventSettings(clientId: number): Promise<ClientEventSetting[]> {
    return await db.select().from(clientEventSettings).where(eq(clientEventSettings.clientId, clientId));
  }

  async getClientEventSetting(clientId: number, eventTypeId: number): Promise<ClientEventSetting | undefined> {
    const [setting] = await db.select().from(clientEventSettings).where(
      and(eq(clientEventSettings.clientId, clientId), eq(clientEventSettings.eventTypeId, eventTypeId))
    );
    return setting || undefined;
  }

  async upsertClientEventSetting(data: InsertClientEventSetting): Promise<ClientEventSetting> {
    const existing = await this.getClientEventSetting(data.clientId, data.eventTypeId);
    if (existing) {
      await db.update(clientEventSettings).set({ ...data, updatedAt: new Date() }).where(eq(clientEventSettings.id, existing.id));
      return { ...existing, ...data };
    }
    const [setting] = await db.insert(clientEventSettings).values(data).returning();
    return setting;
  }

  async deleteClientEventSetting(clientId: number, eventTypeId: number): Promise<void> {
    await db.delete(clientEventSettings).where(
      and(eq(clientEventSettings.clientId, clientId), eq(clientEventSettings.eventTypeId, eventTypeId))
    );
  }

  async resetClientEventSettings(clientId: number): Promise<void> {
    await db.delete(clientEventSettings).where(eq(clientEventSettings.clientId, clientId));
  }

  async initializeDefaultEventTypes(): Promise<void> {
    const existingTypes = await this.getEventTypes();
    if (existingTypes.length > 0) return;

    const defaultTypes: InsertEventType[] = [
      { code: "link_down", name: "Link Indisponível", category: "connectivity", severity: "critical" },
      { code: "link_degraded", name: "Link Degradado", category: "connectivity", severity: "high" },
      { code: "high_latency", name: "Alta Latência", category: "performance", severity: "medium" },
      { code: "packet_loss", name: "Perda de Pacotes", category: "performance", severity: "high" },
      { code: "ddos_detected", name: "Ataque DDoS Detectado", category: "security", severity: "critical" },
      { code: "host_unreachable", name: "Host Inacessível", category: "connectivity", severity: "high" },
      { code: "sla_breach", name: "Violação de SLA", category: "sla", severity: "high" },
    ];

    for (const eventType of defaultTypes) {
      await this.createEventType(eventType);
    }
  }

  async initializeDefaultPermissions(): Promise<void> {
    const existingPerms = await this.getPermissions();
    if (existingPerms.length > 0) return;

    const defaultPerms = [
      { code: "dashboard.view", name: "Visualizar Dashboard", category: "dashboard" },
      { code: "links.view", name: "Visualizar Links", category: "links" },
      { code: "links.manage", name: "Gerenciar Links", category: "links" },
      { code: "hosts.view", name: "Visualizar Hosts", category: "hosts" },
      { code: "hosts.manage", name: "Gerenciar Hosts", category: "hosts" },
      { code: "incidents.view", name: "Visualizar Incidentes", category: "incidents" },
      { code: "incidents.manage", name: "Gerenciar Incidentes", category: "incidents" },
      { code: "security.view", name: "Visualizar Segurança", category: "security" },
      { code: "sla.view", name: "Visualizar SLA", category: "sla" },
      { code: "admin.view", name: "Visualizar Admin", category: "admin" },
      { code: "admin.manage", name: "Gerenciar Admin", category: "admin" },
    ];

    for (const perm of defaultPerms) {
      await db.insert(permissions).values(perm);
    }
  }

  async initializeSuperAdmin(): Promise<void> {
    const existing = await db.select().from(users).where(eq(users.email, "admin@marvitel.com.br"));
    if (existing.length > 0) return;
    
    await db.insert(users).values({
      email: "admin@marvitel.com.br",
      passwordHash: hashPassword("marvitel123"),
      name: "Super Admin Marvitel",
      role: "admin",
      clientId: null,
      isSuperAdmin: true,
      isActive: true,
    });
    console.log("Initialized super admin user");
  }

  async getOlts(): Promise<Olt[]> {
    // OLTs são recursos globais - não filtrar por clientId
    return db.select().from(olts).orderBy(olts.name);
  }

  async getOlt(id: number): Promise<Olt | undefined> {
    const result = await db.select().from(olts).where(eq(olts.id, id));
    return result[0];
  }

  async createOlt(data: InsertOlt): Promise<Olt> {
    const result = await db.insert(olts).values(data).returning();
    return result[0];
  }

  async updateOlt(id: number, data: Partial<InsertOlt>): Promise<Olt | undefined> {
    const result = await db.update(olts).set({ ...data, updatedAt: new Date() }).where(eq(olts.id, id)).returning();
    return result[0];
  }

  async deleteOlt(id: number): Promise<void> {
    await db.delete(olts).where(eq(olts.id, id));
  }

  // ============ SNMP Concentrators ============
  
  async getConcentrators(): Promise<SnmpConcentrator[]> {
    return db.select().from(snmpConcentrators).orderBy(snmpConcentrators.name);
  }

  async getConcentrator(id: number): Promise<SnmpConcentrator | undefined> {
    const result = await db.select().from(snmpConcentrators).where(eq(snmpConcentrators.id, id));
    return result[0];
  }

  async createConcentrator(data: InsertSnmpConcentrator): Promise<SnmpConcentrator> {
    const result = await db.insert(snmpConcentrators).values(data).returning();
    return result[0];
  }

  async updateConcentrator(id: number, data: Partial<InsertSnmpConcentrator>): Promise<SnmpConcentrator | undefined> {
    const result = await db.update(snmpConcentrators).set({ ...data, updatedAt: new Date() }).where(eq(snmpConcentrators.id, id)).returning();
    return result[0];
  }

  async deleteConcentrator(id: number): Promise<void> {
    await db.delete(snmpConcentrators).where(eq(snmpConcentrators.id, id));
  }

  // ============ ERP Integrations ============
  
  async getErpIntegrations(): Promise<ErpIntegration[]> {
    return db.select().from(erpIntegrations).orderBy(erpIntegrations.name);
  }

  async getErpIntegration(id: number): Promise<ErpIntegration | undefined> {
    const result = await db.select().from(erpIntegrations).where(eq(erpIntegrations.id, id));
    return result[0];
  }

  async getErpIntegrationByProvider(provider: string): Promise<ErpIntegration | undefined> {
    const result = await db.select().from(erpIntegrations)
      .where(and(eq(erpIntegrations.provider, provider), eq(erpIntegrations.isActive, true)))
      .orderBy(desc(erpIntegrations.isDefault));
    return result[0];
  }

  async getDefaultErpIntegration(): Promise<ErpIntegration | undefined> {
    const result = await db.select().from(erpIntegrations)
      .where(and(eq(erpIntegrations.isDefault, true), eq(erpIntegrations.isActive, true)));
    return result[0];
  }

  async createErpIntegration(data: InsertErpIntegration): Promise<ErpIntegration> {
    // If this is being set as default, unset other defaults
    if (data.isDefault) {
      await db.update(erpIntegrations).set({ isDefault: false });
    }
    const result = await db.insert(erpIntegrations).values(data).returning();
    return result[0];
  }

  async updateErpIntegration(id: number, data: Partial<InsertErpIntegration>): Promise<ErpIntegration | undefined> {
    // If this is being set as default, unset other defaults
    if (data.isDefault) {
      await db.update(erpIntegrations).set({ isDefault: false }).where(sql`${erpIntegrations.id} != ${id}`);
    }
    const result = await db.update(erpIntegrations)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(erpIntegrations.id, id))
      .returning();
    return result[0];
  }

  async deleteErpIntegration(id: number): Promise<void> {
    // First delete related mappings
    await db.delete(clientErpMappings).where(eq(clientErpMappings.erpIntegrationId, id));
    await db.delete(erpIntegrations).where(eq(erpIntegrations.id, id));
  }

  async updateErpIntegrationTestStatus(id: number, status: string, error?: string): Promise<void> {
    await db.update(erpIntegrations).set({
      lastTestedAt: new Date(),
      lastTestStatus: status,
      lastTestError: error || null,
      updatedAt: new Date(),
    }).where(eq(erpIntegrations.id, id));
  }

  // ============ Client ERP Mappings ============

  async getClientErpMappings(erpIntegrationId?: number): Promise<ClientErpMapping[]> {
    if (erpIntegrationId) {
      return db.select().from(clientErpMappings)
        .where(eq(clientErpMappings.erpIntegrationId, erpIntegrationId))
        .orderBy(clientErpMappings.clientId);
    }
    return db.select().from(clientErpMappings).orderBy(clientErpMappings.clientId);
  }

  async getClientErpMapping(clientId: number, erpIntegrationId?: number): Promise<ClientErpMapping | undefined> {
    if (erpIntegrationId) {
      const result = await db.select().from(clientErpMappings)
        .where(and(
          eq(clientErpMappings.clientId, clientId),
          eq(clientErpMappings.erpIntegrationId, erpIntegrationId)
        ));
      return result[0];
    }
    // Get any active mapping for this client
    const result = await db.select().from(clientErpMappings)
      .where(and(eq(clientErpMappings.clientId, clientId), eq(clientErpMappings.isActive, true)));
    return result[0];
  }

  async createClientErpMapping(data: InsertClientErpMapping): Promise<ClientErpMapping> {
    const result = await db.insert(clientErpMappings).values(data).returning();
    return result[0];
  }

  async updateClientErpMapping(id: number, data: Partial<InsertClientErpMapping>): Promise<ClientErpMapping | undefined> {
    const result = await db.update(clientErpMappings)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(clientErpMappings.id, id))
      .returning();
    return result[0];
  }

  async deleteClientErpMapping(id: number): Promise<void> {
    await db.delete(clientErpMappings).where(eq(clientErpMappings.id, id));
  }

  async getClientErpMappingsByErpIntegration(erpIntegrationId: number): Promise<(ClientErpMapping & { client: Client | null })[]> {
    const mappings = await db.select().from(clientErpMappings)
      .where(eq(clientErpMappings.erpIntegrationId, erpIntegrationId));
    
    const result = await Promise.all(mappings.map(async (mapping) => {
      const client = await this.getClient(mapping.clientId);
      return { ...mapping, client: client || null };
    }));
    
    return result;
  }

  // ============ Monitoring Settings (Global Parameters) ============

  async getMonitoringSettings(): Promise<MonitoringSetting[]> {
    return db.select().from(monitoringSettings);
  }

  async getMonitoringSetting(key: string): Promise<string | null> {
    const result = await db.select().from(monitoringSettings)
      .where(eq(monitoringSettings.key, key));
    return result[0]?.value ?? null;
  }

  async setMonitoringSetting(key: string, value: string, description?: string): Promise<void> {
    await db.insert(monitoringSettings)
      .values({ key, value, description })
      .onConflictDoUpdate({
        target: monitoringSettings.key,
        set: { value, description, updatedAt: new Date() }
      });
  }

  async getMonitoringSettingsMap(): Promise<Record<string, string>> {
    const settings = await this.getMonitoringSettings();
    return settings.reduce((acc, s) => {
      acc[s.key] = s.value;
      return acc;
    }, {} as Record<string, string>);
  }

  // ============ Link Monitoring State (Moving Average & Persistence) ============

  async getLinkMonitoringState(linkId: number): Promise<LinkMonitoringState | null> {
    const result = await db.select().from(linkMonitoringState)
      .where(eq(linkMonitoringState.linkId, linkId));
    return result[0] ?? null;
  }

  async upsertLinkMonitoringState(
    linkId: number,
    packetLossWindow: Array<{ loss: number; timestamp: string }>,
    packetLossAvg: number,
    consecutiveLossBreaches: number,
    lastAlertAt?: Date
  ): Promise<void> {
    await db.insert(linkMonitoringState)
      .values({
        linkId,
        packetLossWindow: packetLossWindow as any,
        packetLossAvg,
        consecutiveLossBreaches,
        lastAlertAt,
        updatedAt: new Date()
      })
      .onConflictDoUpdate({
        target: linkMonitoringState.linkId,
        set: {
          packetLossWindow: packetLossWindow as any,
          packetLossAvg,
          consecutiveLossBreaches,
          lastAlertAt,
          updatedAt: new Date()
        }
      });
  }

  async initializeDefaultMonitoringSettings(): Promise<void> {
    const defaults = [
      { key: "packet_loss_window_cycles", value: "10", description: "Número de ciclos para média móvel de perda de pacotes (ex: 10 ciclos = 5 minutos)" },
      { key: "packet_loss_threshold_pct", value: "2", description: "Threshold de perda de pacotes para alerta (%)" },
      { key: "packet_loss_persistence_cycles", value: "3", description: "Número de ciclos consecutivos acima do threshold para disparar alerta" },
      { key: "latency_window_cycles", value: "10", description: "Número de ciclos para média móvel de latência" },
      { key: "latency_threshold_ms", value: "80", description: "Threshold de latência para alerta (ms)" },
      { key: "latency_persistence_cycles", value: "3", description: "Número de ciclos consecutivos acima do threshold para disparar alerta" },
    ];

    for (const setting of defaults) {
      const existing = await this.getMonitoringSetting(setting.key);
      if (existing === null) {
        await this.setMonitoringSetting(setting.key, setting.value, setting.description);
      }
    }
  }

  // =====================================
  // AUDIT LOGS METHODS
  // =====================================

  async createAuditLog(data: InsertAuditLog): Promise<AuditLog> {
    const [log] = await db.insert(auditLogs).values(data).returning();
    return log;
  }

  async getAuditLogs(
    filters: {
      clientId?: number;
      action?: string;
      entity?: string;
      actorId?: number;
      status?: string;
      startDate?: Date;
      endDate?: Date;
    },
    limit: number,
    offset: number
  ): Promise<{ logs: AuditLog[]; total: number }> {
    const conditions: any[] = [];
    
    if (filters.clientId) {
      conditions.push(eq(auditLogs.clientId, filters.clientId));
    }
    if (filters.action) {
      conditions.push(eq(auditLogs.action, filters.action));
    }
    if (filters.entity) {
      conditions.push(eq(auditLogs.entity, filters.entity));
    }
    if (filters.actorId) {
      conditions.push(eq(auditLogs.actorUserId, filters.actorId));
    }
    if (filters.status) {
      conditions.push(eq(auditLogs.status, filters.status));
    }
    if (filters.startDate) {
      conditions.push(gte(auditLogs.createdAt, filters.startDate));
    }
    if (filters.endDate) {
      conditions.push(lte(auditLogs.createdAt, filters.endDate));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    
    const logs = await db
      .select()
      .from(auditLogs)
      .where(whereClause)
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit)
      .offset(offset);
    
    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(auditLogs)
      .where(whereClause);
    
    return {
      logs,
      total: Number(countResult?.count || 0),
    };
  }

  async getAuditLogById(id: number): Promise<AuditLog | undefined> {
    const [log] = await db.select().from(auditLogs).where(eq(auditLogs.id, id));
    return log || undefined;
  }

  async getAuditLogsSummary(startDate: Date): Promise<{
    totalEvents: number;
    byAction: Record<string, number>;
    byEntity: Record<string, number>;
    byStatus: Record<string, number>;
    recentActivity: { date: string; count: number }[];
  }> {
    const logs = await db
      .select()
      .from(auditLogs)
      .where(gte(auditLogs.createdAt, startDate));
    
    const byAction: Record<string, number> = {};
    const byEntity: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    const byDate: Record<string, number> = {};
    
    for (const log of logs) {
      byAction[log.action] = (byAction[log.action] || 0) + 1;
      if (log.entity) {
        byEntity[log.entity] = (byEntity[log.entity] || 0) + 1;
      }
      byStatus[log.status] = (byStatus[log.status] || 0) + 1;
      
      if (log.createdAt) {
        const dateKey = log.createdAt.toISOString().split('T')[0];
        byDate[dateKey] = (byDate[dateKey] || 0) + 1;
      }
    }
    
    const recentActivity = Object.entries(byDate)
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));
    
    return {
      totalEvents: logs.length,
      byAction,
      byEntity,
      byStatus,
      recentActivity,
    };
  }

  // ============ RADIUS Settings ============
  async getRadiusSettings(): Promise<RadiusSettings | undefined> {
    const [settings] = await db.select().from(radiusSettings).limit(1);
    return settings || undefined;
  }

  async saveRadiusSettings(data: InsertRadiusSettings): Promise<RadiusSettings> {
    const existing = await this.getRadiusSettings();
    
    if (existing) {
      await db.update(radiusSettings)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(radiusSettings.id, existing.id));
      const [updated] = await db.select().from(radiusSettings).where(eq(radiusSettings.id, existing.id));
      return updated;
    } else {
      const [created] = await db.insert(radiusSettings).values(data).returning();
      return created;
    }
  }

  async updateRadiusHealthStatus(status: string): Promise<void> {
    const existing = await this.getRadiusSettings();
    if (existing) {
      await db.update(radiusSettings)
        .set({ lastHealthCheck: new Date(), lastHealthStatus: status })
        .where(eq(radiusSettings.id, existing.id));
    }
  }

  // ============ Link Groups ============
  
  async getLinkGroups(clientId?: number): Promise<LinkGroup[]> {
    if (clientId) {
      return db.select().from(linkGroups)
        .where(and(eq(linkGroups.clientId, clientId), eq(linkGroups.isActive, true)))
        .orderBy(linkGroups.name);
    }
    return db.select().from(linkGroups)
      .where(eq(linkGroups.isActive, true))
      .orderBy(linkGroups.name);
  }

  async getLinkGroup(id: number): Promise<LinkGroup | undefined> {
    const [group] = await db.select().from(linkGroups).where(eq(linkGroups.id, id));
    return group;
  }

  async createLinkGroup(data: InsertLinkGroup): Promise<LinkGroup> {
    const [group] = await db.insert(linkGroups).values(data).returning();
    return group;
  }

  async updateLinkGroup(id: number, data: Partial<InsertLinkGroup>): Promise<void> {
    await db.update(linkGroups)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(linkGroups.id, id));
  }

  async deleteLinkGroup(id: number): Promise<void> {
    // Remove members first
    await db.delete(linkGroupMembers).where(eq(linkGroupMembers.groupId, id));
    // Then remove the group
    await db.delete(linkGroups).where(eq(linkGroups.id, id));
  }

  async getLinkGroupMembers(groupId: number): Promise<Array<LinkGroupMember & { link?: Link }>> {
    const members = await db.select().from(linkGroupMembers)
      .where(eq(linkGroupMembers.groupId, groupId))
      .orderBy(linkGroupMembers.displayOrder);
    
    // Enrich with link data
    const enrichedMembers = await Promise.all(members.map(async (member) => {
      const link = await this.getLink(member.linkId);
      return { ...member, link: link || undefined };
    }));
    
    return enrichedMembers;
  }

  async addLinkGroupMember(data: InsertLinkGroupMember): Promise<LinkGroupMember> {
    const [member] = await db.insert(linkGroupMembers).values(data).returning();
    return member;
  }

  async removeLinkGroupMember(groupId: number, linkId: number): Promise<void> {
    await db.delete(linkGroupMembers)
      .where(and(eq(linkGroupMembers.groupId, groupId), eq(linkGroupMembers.linkId, linkId)));
  }

  async clearLinkGroupMembers(groupId: number): Promise<void> {
    await db.delete(linkGroupMembers).where(eq(linkGroupMembers.groupId, groupId));
  }

  async getLinkGroupMetrics(groupId: number, period: string): Promise<Array<{
    timestamp: string;
    download: number;
    upload: number;
    latency: number;
    packetLoss: number;
    status: string;
  }>> {
    const group = await this.getLinkGroup(groupId);
    if (!group) return [];
    
    const members = await this.getLinkGroupMembers(groupId);
    if (members.length === 0) return [];
    
    const linkIds = members.map(m => m.linkId);
    
    // Get period filter
    const now = new Date();
    let startDate: Date;
    switch (period) {
      case "1h":
        startDate = new Date(now.getTime() - 60 * 60 * 1000);
        break;
      case "6h":
        startDate = new Date(now.getTime() - 6 * 60 * 60 * 1000);
        break;
      case "24h":
      default:
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case "7d":
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
    }
    
    // Fetch metrics for all member links
    const allMetrics: Array<{linkId: number; timestamp: Date; download: number; upload: number; latency: number; packetLoss: number; status: string}> = [];
    
    for (const linkId of linkIds) {
      const linkMetrics = await db.select().from(metrics)
        .where(and(
          eq(metrics.linkId, linkId),
          gte(metrics.timestamp, startDate)
        ))
        .orderBy(metrics.timestamp);
      
      for (const m of linkMetrics) {
        allMetrics.push({
          linkId,
          timestamp: m.timestamp,
          download: m.download,
          upload: m.upload,
          latency: m.latency,
          packetLoss: m.packetLoss,
          status: m.status,
        });
      }
    }
    
    // First: Group by linkId + timestamp (rounded to minute) to get average per link per minute
    // This prevents multiple samples per minute from being summed (monitor collects every 30s)
    const perLinkPerMinute: Record<string, Record<number, {downloads: number[]; uploads: number[]; latencies: number[]; losses: number[]; statuses: string[]}>> = {};
    
    for (const m of allMetrics) {
      const timeKey = new Date(Math.floor(m.timestamp.getTime() / 60000) * 60000).toISOString();
      if (!perLinkPerMinute[timeKey]) {
        perLinkPerMinute[timeKey] = {};
      }
      if (!perLinkPerMinute[timeKey][m.linkId]) {
        perLinkPerMinute[timeKey][m.linkId] = { downloads: [], uploads: [], latencies: [], losses: [], statuses: [] };
      }
      perLinkPerMinute[timeKey][m.linkId].downloads.push(m.download);
      perLinkPerMinute[timeKey][m.linkId].uploads.push(m.upload);
      perLinkPerMinute[timeKey][m.linkId].latencies.push(m.latency);
      perLinkPerMinute[timeKey][m.linkId].losses.push(m.packetLoss);
      perLinkPerMinute[timeKey][m.linkId].statuses.push(m.status);
    }
    
    // Second: Calculate average per link, then aggregate across links
    const result: Array<{timestamp: string; download: number; upload: number; latency: number; packetLoss: number; status: string}> = [];
    
    for (const [timestamp, linkData] of Object.entries(perLinkPerMinute)) {
      // Calculate average for each link in this minute
      const linkAverages: Array<{download: number; upload: number; latency: number; packetLoss: number; status: string}> = [];
      
      for (const [, data] of Object.entries(linkData)) {
        const avgDownload = data.downloads.reduce((a, b) => a + b, 0) / data.downloads.length;
        const avgUpload = data.uploads.reduce((a, b) => a + b, 0) / data.uploads.length;
        const avgLatency = data.latencies.reduce((a, b) => a + b, 0) / data.latencies.length;
        const maxLoss = Math.max(...data.losses);
        // Use most recent status
        const linkStatus = data.statuses[data.statuses.length - 1];
        
        linkAverages.push({ download: avgDownload, upload: avgUpload, latency: avgLatency, packetLoss: maxLoss, status: linkStatus });
      }
      
      let download: number, upload: number, latency: number, packetLoss: number, status: string;
      
      if (group.groupType === "aggregation") {
        // Aggregation: sum bandwidth across links, average latency, max packet loss
        download = linkAverages.reduce((sum, l) => sum + l.download, 0);
        upload = linkAverages.reduce((sum, l) => sum + l.upload, 0);
        latency = linkAverages.reduce((sum, l) => sum + l.latency, 0) / linkAverages.length;
        packetLoss = Math.max(...linkAverages.map(l => l.packetLoss));
        // Status: degraded if any member is down, otherwise operational
        status = linkAverages.some(l => l.status === "offline" || l.status === "critical" || l.status === "down") 
          ? "degraded" 
          : "operational";
      } else {
        // Redundancy: use best link values
        download = Math.max(...linkAverages.map(l => l.download));
        upload = Math.max(...linkAverages.map(l => l.upload));
        latency = Math.min(...linkAverages.map(l => l.latency));
        packetLoss = Math.min(...linkAverages.map(l => l.packetLoss));
        // Status: operational if any member is online
        status = linkAverages.some(l => l.status === "operational") 
          ? "operational" 
          : "offline";
      }
      
      result.push({ timestamp, download, upload, latency, packetLoss, status });
    }
    
    return result.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  // ============ RADIUS Group Mappings ============
  async getRadiusGroupMappings(): Promise<RadiusGroupMapping[]> {
    return db.select().from(radiusGroupMappings)
      .where(eq(radiusGroupMappings.isActive, true))
      .orderBy(desc(radiusGroupMappings.priority));
  }

  async getRadiusGroupMapping(id: number): Promise<RadiusGroupMapping | undefined> {
    const [mapping] = await db.select().from(radiusGroupMappings).where(eq(radiusGroupMappings.id, id));
    return mapping;
  }

  async getRadiusGroupMappingByName(groupName: string): Promise<RadiusGroupMapping | undefined> {
    const [mapping] = await db.select().from(radiusGroupMappings)
      .where(and(
        eq(radiusGroupMappings.radiusGroupName, groupName),
        eq(radiusGroupMappings.isActive, true)
      ));
    return mapping;
  }

  async findBestRadiusGroupMapping(groups: string[]): Promise<RadiusGroupMapping | undefined> {
    if (!groups || groups.length === 0) return undefined;
    
    // Get all active mappings ordered by priority (highest first)
    const mappings = await this.getRadiusGroupMappings();
    
    // Find the first matching mapping (highest priority wins)
    for (const mapping of mappings) {
      if (groups.some(g => g.toLowerCase() === mapping.radiusGroupName.toLowerCase())) {
        return mapping;
      }
    }
    return undefined;
  }

  async createRadiusGroupMapping(data: InsertRadiusGroupMapping): Promise<RadiusGroupMapping> {
    const [mapping] = await db.insert(radiusGroupMappings).values(data).returning();
    return mapping;
  }

  async updateRadiusGroupMapping(id: number, data: Partial<InsertRadiusGroupMapping>): Promise<void> {
    await db.update(radiusGroupMappings)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(radiusGroupMappings.id, id));
  }

  async deleteRadiusGroupMapping(id: number): Promise<void> {
    await db.delete(radiusGroupMappings).where(eq(radiusGroupMappings.id, id));
  }

  // ========== External Integrations (HetrixTools, etc.) ==========
  
  async getExternalIntegrations(): Promise<ExternalIntegration[]> {
    return db.select().from(externalIntegrations).orderBy(externalIntegrations.name);
  }

  async getExternalIntegration(id: number): Promise<ExternalIntegration | undefined> {
    const [result] = await db.select().from(externalIntegrations).where(eq(externalIntegrations.id, id));
    return result;
  }

  async getExternalIntegrationByProvider(provider: string): Promise<ExternalIntegration | undefined> {
    const [result] = await db.select().from(externalIntegrations)
      .where(and(eq(externalIntegrations.provider, provider), eq(externalIntegrations.isActive, true)));
    return result;
  }

  async createExternalIntegration(data: InsertExternalIntegration): Promise<ExternalIntegration> {
    const [result] = await db.insert(externalIntegrations).values(data).returning();
    return result;
  }

  async updateExternalIntegration(id: number, data: Partial<InsertExternalIntegration>): Promise<void> {
    await db.update(externalIntegrations)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(externalIntegrations.id, id));
  }

  async deleteExternalIntegration(id: number): Promise<void> {
    await db.delete(externalIntegrations).where(eq(externalIntegrations.id, id));
  }

  // ========== Blacklist Checks ==========

  async getBlacklistCheck(linkId: number): Promise<BlacklistCheck | undefined> {
    const [result] = await db.select().from(blacklistChecks).where(eq(blacklistChecks.linkId, linkId));
    return result;
  }

  async getBlacklistCheckByIp(ip: string): Promise<BlacklistCheck | undefined> {
    const [result] = await db.select().from(blacklistChecks).where(eq(blacklistChecks.ip, ip));
    return result;
  }

  async getBlacklistChecks(): Promise<BlacklistCheck[]> {
    return db.select().from(blacklistChecks).orderBy(desc(blacklistChecks.lastCheckedAt));
  }

  async getListedBlacklistChecks(): Promise<BlacklistCheck[]> {
    return db.select().from(blacklistChecks)
      .where(eq(blacklistChecks.isListed, true))
      .orderBy(desc(blacklistChecks.lastCheckedAt));
  }

  async upsertBlacklistCheck(data: InsertBlacklistCheck): Promise<BlacklistCheck> {
    const existing = await this.getBlacklistCheck(data.linkId);
    if (existing) {
      await db.update(blacklistChecks)
        .set({ ...data, lastCheckedAt: new Date() })
        .where(eq(blacklistChecks.linkId, data.linkId));
      const [updated] = await db.select().from(blacklistChecks).where(eq(blacklistChecks.linkId, data.linkId));
      return updated;
    } else {
      const [result] = await db.insert(blacklistChecks).values(data).returning();
      return result;
    }
  }

  async deleteBlacklistCheck(linkId: number): Promise<void> {
    await db.delete(blacklistChecks).where(eq(blacklistChecks.linkId, linkId));
  }
}

export const storage = new DatabaseStorage();

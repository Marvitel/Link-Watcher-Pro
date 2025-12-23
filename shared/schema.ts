import { pgTable, text, varchar, integer, real, timestamp, boolean, serial } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const clients = pgTable("clients", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
  cnpj: varchar("cnpj", { length: 20 }),
  address: text("address"),
  phone: varchar("phone", { length: 20 }),
  email: varchar("email", { length: 255 }),
  logoUrl: text("logo_url"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  role: varchar("role", { length: 20 }).notNull().default("viewer"),
  clientId: integer("client_id"),
  isActive: boolean("is_active").notNull().default(true),
  lastLoginAt: timestamp("last_login_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const links = pgTable("links", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull(),
  identifier: varchar("identifier", { length: 50 }).notNull(),
  name: text("name").notNull(),
  location: text("location").notNull(),
  address: text("address").notNull(),
  ipBlock: varchar("ip_block", { length: 20 }).notNull(),
  totalIps: integer("total_ips").notNull(),
  usableIps: integer("usable_ips").notNull(),
  bandwidth: integer("bandwidth").notNull(),
  status: varchar("status", { length: 20 }).notNull().default("operational"),
  uptime: real("uptime").notNull().default(99.0),
  currentDownload: real("current_download").notNull().default(0),
  currentUpload: real("current_upload").notNull().default(0),
  latency: real("latency").notNull().default(0),
  packetLoss: real("packet_loss").notNull().default(0),
  cpuUsage: real("cpu_usage").notNull().default(0),
  memoryUsage: real("memory_usage").notNull().default(0),
  lastUpdated: timestamp("last_updated").notNull().defaultNow(),
  failureReason: varchar("failure_reason", { length: 50 }),
  failureSource: text("failure_source"),
  lastFailureAt: timestamp("last_failure_at"),
  monitoringEnabled: boolean("monitoring_enabled").notNull().default(true),
  oltEndpoint: text("olt_endpoint"),
  snmpCommunity: varchar("snmp_community", { length: 100 }),
  icmpInterval: integer("icmp_interval").notNull().default(30),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const hosts = pgTable("hosts", {
  id: serial("id").primaryKey(),
  linkId: integer("link_id").notNull(),
  clientId: integer("client_id").notNull(),
  name: text("name").notNull(),
  ipAddress: varchar("ip_address", { length: 45 }).notNull(),
  hostType: varchar("host_type", { length: 50 }).notNull().default("server"),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  latencyThreshold: real("latency_threshold").notNull().default(80),
  packetLossThreshold: real("packet_loss_threshold").notNull().default(2),
  lastStatus: varchar("last_status", { length: 20 }).notNull().default("unknown"),
  lastCheckedAt: timestamp("last_checked_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const metrics = pgTable("metrics", {
  id: serial("id").primaryKey(),
  linkId: integer("link_id").notNull(),
  clientId: integer("client_id").notNull(),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
  download: real("download").notNull(),
  upload: real("upload").notNull(),
  latency: real("latency").notNull(),
  packetLoss: real("packet_loss").notNull(),
  cpuUsage: real("cpu_usage").notNull(),
  memoryUsage: real("memory_usage").notNull(),
  errorRate: real("error_rate").notNull().default(0),
});

export const events = pgTable("events", {
  id: serial("id").primaryKey(),
  linkId: integer("link_id").notNull(),
  clientId: integer("client_id").notNull(),
  type: varchar("type", { length: 20 }).notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
  resolved: boolean("resolved").notNull().default(false),
  resolvedAt: timestamp("resolved_at"),
});

export const ddosEvents = pgTable("ddos_events", {
  id: serial("id").primaryKey(),
  linkId: integer("link_id").notNull(),
  clientId: integer("client_id").notNull(),
  attackType: varchar("attack_type", { length: 100 }).notNull(),
  startTime: timestamp("start_time").notNull().defaultNow(),
  endTime: timestamp("end_time"),
  peakBandwidth: real("peak_bandwidth").notNull(),
  mitigationStatus: varchar("mitigation_status", { length: 20 }).notNull().default("detected"),
  sourceIps: integer("source_ips").notNull().default(0),
  blockedPackets: integer("blocked_packets").notNull().default(0),
  wanguardAnomalyId: integer("wanguard_anomaly_id"),
  wanguardSensor: varchar("wanguard_sensor", { length: 100 }),
  targetIp: varchar("target_ip", { length: 45 }),
  decoder: varchar("decoder", { length: 100 }),
});

export const incidents = pgTable("incidents", {
  id: serial("id").primaryKey(),
  linkId: integer("link_id").notNull(),
  clientId: integer("client_id").notNull(),
  protocol: varchar("protocol", { length: 100 }),
  status: varchar("status", { length: 50 }).notNull().default("aberto"),
  failureReason: varchar("failure_reason", { length: 50 }),
  failureSource: varchar("failure_source", { length: 50 }),
  description: text("description"),
  erpSystem: varchar("erp_system", { length: 100 }),
  erpTicketId: varchar("erp_ticket_id", { length: 100 }),
  erpTicketStatus: varchar("erp_ticket_status", { length: 50 }),
  openedAt: timestamp("opened_at").notNull().defaultNow(),
  lastUpdateAt: timestamp("last_update_at").notNull().defaultNow(),
  slaDeadline: timestamp("sla_deadline"),
  closedAt: timestamp("closed_at"),
  repairTeam: text("repair_team"),
  repairNotes: text("repair_notes"),
});

export const clientSettings = pgTable("client_settings", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().unique(),
  slaAvailability: real("sla_availability").notNull().default(99.0),
  slaLatency: real("sla_latency").notNull().default(80),
  slaPacketLoss: real("sla_packet_loss").notNull().default(2),
  slaRepairTime: integer("sla_repair_time").notNull().default(6),
  dataRetentionDays: integer("data_retention_days").notNull().default(180),
  oltApiEndpoint: text("olt_api_endpoint"),
  oltApiKey: text("olt_api_key"),
  erpApiEndpoint: text("erp_api_endpoint"),
  erpApiKey: text("erp_api_key"),
  voalleApiUrl: text("voalle_api_url"),
  voalleClientId: varchar("voalle_client_id", { length: 100 }),
  voalleClientSecret: text("voalle_client_secret"),
  voalleSynV1Token: text("voalle_syn_v1_token"),
  voalleSolicitationTypeCode: varchar("voalle_solicitation_type_code", { length: 50 }),
  voalleEnabled: boolean("voalle_enabled").notNull().default(false),
  voalleAutoCreateTicket: boolean("voalle_auto_create_ticket").notNull().default(false),
  wanguardApiEndpoint: text("wanguard_api_endpoint"),
  wanguardApiUser: varchar("wanguard_api_user", { length: 100 }),
  wanguardApiPassword: text("wanguard_api_password"),
  wanguardEnabled: boolean("wanguard_enabled").notNull().default(false),
  wanguardSyncInterval: integer("wanguard_sync_interval").notNull().default(60),
  notificationEmail: varchar("notification_email", { length: 255 }),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertClientSchema = createInsertSchema(clients).omit({ id: true, createdAt: true, updatedAt: true });
export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true, updatedAt: true, lastLoginAt: true });
export const insertLinkSchema = createInsertSchema(links).omit({ id: true, lastUpdated: true, createdAt: true });
export const insertHostSchema = createInsertSchema(hosts).omit({ id: true, createdAt: true, updatedAt: true, lastCheckedAt: true });
export const insertMetricSchema = createInsertSchema(metrics).omit({ id: true, timestamp: true });
export const insertEventSchema = createInsertSchema(events).omit({ id: true, timestamp: true });
export const insertDDoSEventSchema = createInsertSchema(ddosEvents).omit({ id: true, startTime: true });
export const insertIncidentSchema = createInsertSchema(incidents).omit({ id: true, openedAt: true, lastUpdateAt: true });
export const insertClientSettingsSchema = createInsertSchema(clientSettings).omit({ id: true, updatedAt: true });

export type InsertClient = z.infer<typeof insertClientSchema>;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type InsertLink = z.infer<typeof insertLinkSchema>;
export type InsertHost = z.infer<typeof insertHostSchema>;
export type InsertMetric = z.infer<typeof insertMetricSchema>;
export type InsertEvent = z.infer<typeof insertEventSchema>;
export type InsertDDoSEvent = z.infer<typeof insertDDoSEventSchema>;
export type InsertIncident = z.infer<typeof insertIncidentSchema>;
export type InsertClientSettings = z.infer<typeof insertClientSettingsSchema>;

export type Client = typeof clients.$inferSelect;
export type User = typeof users.$inferSelect;
export type Link = typeof links.$inferSelect;
export type Host = typeof hosts.$inferSelect;
export type Metric = typeof metrics.$inferSelect;
export type Event = typeof events.$inferSelect;
export type DDoSEvent = typeof ddosEvents.$inferSelect;
export type Incident = typeof incidents.$inferSelect;
export type ClientSettings = typeof clientSettings.$inferSelect;

export type UserRole = "admin" | "operator" | "viewer";
export type LinkStatus = "operational" | "degraded" | "down" | "maintenance";
export type HostStatus = "online" | "offline" | "degraded" | "unknown";
export type FailureReason = "falha_eletrica" | "rompimento_fibra" | "falha_equipamento" | "indefinido" | null;
export type IncidentStatus = "aberto" | "em_andamento" | "aguardando_peca" | "resolvido" | "cancelado";

export interface SLAIndicator {
  id: string;
  name: string;
  description: string;
  formula: string;
  target: string;
  current: number;
  periodicity: string;
  status: "compliant" | "warning" | "non_compliant";
}

export interface DashboardStats {
  totalLinks: number;
  operationalLinks: number;
  activeAlerts: number;
  averageUptime: number;
  averageLatency: number;
  totalBandwidth: number;
  ddosEventsToday: number;
  openIncidents: number;
}

export interface LinkStatusDetail {
  link: Link;
  failureInfo: {
    reason: string | null;
    reasonLabel: string;
    source: string | null;
    lastFailureAt: Date | null;
  };
  activeIncident: Incident | null;
}

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: UserRole;
  clientId: number | null;
  clientName?: string;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

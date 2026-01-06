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
  voalleCustomerId: integer("voalle_customer_id"),
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
  isSuperAdmin: boolean("is_super_admin").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  lastLoginAt: timestamp("last_login_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const groups = pgTable("groups", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id"),
  name: text("name").notNull(),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const groupMembers = pgTable("group_members", {
  id: serial("id").primaryKey(),
  groupId: integer("group_id").notNull(),
  userId: integer("user_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const permissions = pgTable("permissions", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 100 }).notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  category: varchar("category", { length: 50 }).notNull(),
});

export const groupPermissions = pgTable("group_permissions", {
  id: serial("id").primaryKey(),
  groupId: integer("group_id").notNull(),
  permissionId: integer("permission_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
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
  snmpProfileId: integer("snmp_profile_id"),
  snmpInterfaceIndex: integer("snmp_interface_index"),
  snmpInterfaceName: varchar("snmp_interface_name", { length: 100 }),
  snmpInterfaceDescr: text("snmp_interface_descr"),
  snmpRouterIp: varchar("snmp_router_ip", { length: 45 }),
  monitoredIp: varchar("monitored_ip", { length: 45 }),
  equipmentVendorId: integer("equipment_vendor_id"),
  customCpuOid: varchar("custom_cpu_oid", { length: 255 }),
  customMemoryOid: varchar("custom_memory_oid", { length: 255 }),
  equipmentModel: varchar("equipment_model", { length: 100 }),
  latencyThreshold: real("latency_threshold").notNull().default(80),
  packetLossThreshold: real("packet_loss_threshold").notNull().default(2),
  oltId: integer("olt_id"),
  onuId: varchar("onu_id", { length: 50 }),
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
  snmpProfileId: integer("snmp_profile_id"),
  snmpInterfaceIndex: integer("snmp_interface_index"),
  snmpInterfaceName: varchar("snmp_interface_name", { length: 100 }),
  snmpInterfaceDescr: text("snmp_interface_descr"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const snmpProfiles = pgTable("snmp_profiles", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull(),
  name: text("name").notNull(),
  version: varchar("version", { length: 10 }).notNull().default("v2c"),
  port: integer("port").notNull().default(161),
  community: varchar("community", { length: 100 }),
  securityLevel: varchar("security_level", { length: 20 }),
  authProtocol: varchar("auth_protocol", { length: 10 }),
  authPassword: text("auth_password"),
  privProtocol: varchar("priv_protocol", { length: 10 }),
  privPassword: text("priv_password"),
  username: varchar("username", { length: 100 }),
  timeout: integer("timeout").notNull().default(5000),
  retries: integer("retries").notNull().default(3),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Equipment vendors with pre-configured SNMP OIDs for CPU/Memory
export const equipmentVendors = pgTable("equipment_vendors", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: varchar("slug", { length: 50 }).notNull().unique(),
  cpuOid: varchar("cpu_oid", { length: 255 }),
  memoryOid: varchar("memory_oid", { length: 255 }),
  memoryTotalOid: varchar("memory_total_oid", { length: 255 }),
  memoryUsedOid: varchar("memory_used_oid", { length: 255 }),
  memoryIsPercentage: boolean("memory_is_percentage").notNull().default(true),
  description: text("description"),
  isBuiltIn: boolean("is_built_in").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const mibConfigs = pgTable("mib_configs", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull(),
  name: text("name").notNull(),
  oid: varchar("oid", { length: 255 }).notNull(),
  metricType: varchar("metric_type", { length: 50 }).notNull(),
  unit: varchar("unit", { length: 20 }),
  scaleFactor: real("scale_factor").notNull().default(1),
  pollInterval: integer("poll_interval").notNull().default(60),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const hostMibConfigs = pgTable("host_mib_configs", {
  id: serial("id").primaryKey(),
  hostId: integer("host_id").notNull(),
  mibConfigId: integer("mib_config_id").notNull(),
  isEnabled: boolean("is_enabled").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
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
  status: varchar("status", { length: 20 }).notNull().default("operational"),
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
  contractDuration: integer("contract_duration").default(12),
  contractMonthlyValue: real("contract_monthly_value"),
  contractAnnualValue: real("contract_annual_value"),
  contractBidNumber: varchar("contract_bid_number", { length: 50 }),
  supportPhone: varchar("support_phone", { length: 50 }),
  supportEmail: varchar("support_email", { length: 255 }),
  supportPortalUrl: text("support_portal_url"),
  supportResponseTime: integer("support_response_time").default(3),
  supportRepairTime: integer("support_repair_time").default(6),
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
  notificationSms: varchar("notification_sms", { length: 50 }),
  notifyEmailEnabled: boolean("notify_email_enabled").notNull().default(true),
  notifySmsEnabled: boolean("notify_sms_enabled").notNull().default(false),
  notifyDdosEnabled: boolean("notify_ddos_enabled").notNull().default(true),
  autoRefreshInterval: integer("auto_refresh_interval").notNull().default(5),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const eventTypes = pgTable("event_types", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  severity: varchar("severity", { length: 20 }).notNull().default("medium"),
  category: varchar("category", { length: 50 }).notNull(),
  isSystem: boolean("is_system").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const clientEventSettings = pgTable("client_event_settings", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull(),
  eventTypeId: integer("event_type_id").notNull(),
  autoCreateTicket: boolean("auto_create_ticket").notNull().default(false),
  voalleSolicitationTypeCode: varchar("voalle_solicitation_type_code", { length: 50 }),
  notifyEmail: boolean("notify_email").notNull().default(true),
  notifySms: boolean("notify_sms").notNull().default(false),
  priority: varchar("priority", { length: 20 }).notNull().default("media"),
  isEnabled: boolean("is_enabled").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// OLTs são recursos globais - não vinculadas a um cliente específico
// A relação cliente-OLT é feita através dos links (link.oltId + link.clientId)
// connectionType pode ser: telnet, ssh, mysql (para consultas ao banco Zabbix)
export const olts = pgTable("olts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  ipAddress: varchar("ip_address", { length: 45 }).notNull(),
  port: integer("port").notNull().default(23),
  username: varchar("username", { length: 100 }).notNull(),
  password: text("password").notNull(),
  connectionType: varchar("connection_type", { length: 20 }).notNull().default("telnet"),
  vendor: varchar("vendor", { length: 50 }),
  model: varchar("model", { length: 100 }),
  database: varchar("database", { length: 100 }), // Para conexões MySQL (ex: Zabbix)
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
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
export const insertGroupSchema = createInsertSchema(groups).omit({ id: true, createdAt: true, updatedAt: true });
export const insertGroupMemberSchema = createInsertSchema(groupMembers).omit({ id: true, createdAt: true });
export const insertPermissionSchema = createInsertSchema(permissions).omit({ id: true });
export const insertGroupPermissionSchema = createInsertSchema(groupPermissions).omit({ id: true, createdAt: true });
export const insertSnmpProfileSchema = createInsertSchema(snmpProfiles).omit({ id: true, createdAt: true, updatedAt: true });
export const insertEquipmentVendorSchema = createInsertSchema(equipmentVendors).omit({ id: true, createdAt: true, updatedAt: true });
export const insertMibConfigSchema = createInsertSchema(mibConfigs).omit({ id: true, createdAt: true, updatedAt: true });
export const insertHostMibConfigSchema = createInsertSchema(hostMibConfigs).omit({ id: true, createdAt: true });
export const insertEventTypeSchema = createInsertSchema(eventTypes).omit({ id: true, createdAt: true });
export const insertClientEventSettingSchema = createInsertSchema(clientEventSettings).omit({ id: true, createdAt: true, updatedAt: true });
export const insertOltSchema = createInsertSchema(olts).omit({ id: true, createdAt: true, updatedAt: true });

export type InsertClient = z.infer<typeof insertClientSchema>;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type InsertLink = z.infer<typeof insertLinkSchema>;
export type InsertHost = z.infer<typeof insertHostSchema>;
export type InsertMetric = z.infer<typeof insertMetricSchema>;
export type InsertEvent = z.infer<typeof insertEventSchema>;
export type InsertDDoSEvent = z.infer<typeof insertDDoSEventSchema>;
export type InsertIncident = z.infer<typeof insertIncidentSchema>;
export type InsertClientSettings = z.infer<typeof insertClientSettingsSchema>;
export type InsertGroup = z.infer<typeof insertGroupSchema>;
export type InsertGroupMember = z.infer<typeof insertGroupMemberSchema>;
export type InsertPermission = z.infer<typeof insertPermissionSchema>;
export type InsertGroupPermission = z.infer<typeof insertGroupPermissionSchema>;
export type InsertSnmpProfile = z.infer<typeof insertSnmpProfileSchema>;
export type InsertEquipmentVendor = z.infer<typeof insertEquipmentVendorSchema>;
export type InsertMibConfig = z.infer<typeof insertMibConfigSchema>;
export type InsertHostMibConfig = z.infer<typeof insertHostMibConfigSchema>;
export type InsertEventType = z.infer<typeof insertEventTypeSchema>;
export type InsertClientEventSetting = z.infer<typeof insertClientEventSettingSchema>;
export type InsertOlt = z.infer<typeof insertOltSchema>;

export type Client = typeof clients.$inferSelect;
export type User = typeof users.$inferSelect;
export type Link = typeof links.$inferSelect;
export type Host = typeof hosts.$inferSelect;
export type Metric = typeof metrics.$inferSelect;
export type Event = typeof events.$inferSelect;
export type DDoSEvent = typeof ddosEvents.$inferSelect;
export type Incident = typeof incidents.$inferSelect;
export type ClientSettings = typeof clientSettings.$inferSelect;
export type Group = typeof groups.$inferSelect;
export type GroupMember = typeof groupMembers.$inferSelect;
export type Permission = typeof permissions.$inferSelect;
export type GroupPermission = typeof groupPermissions.$inferSelect;
export type SnmpProfile = typeof snmpProfiles.$inferSelect;
export type EquipmentVendor = typeof equipmentVendors.$inferSelect;
export type MibConfig = typeof mibConfigs.$inferSelect;
export type HostMibConfig = typeof hostMibConfigs.$inferSelect;
export type EventType = typeof eventTypes.$inferSelect;
export type ClientEventSetting = typeof clientEventSettings.$inferSelect;
export type Olt = typeof olts.$inferSelect;

// ERP Integrations - Global configuration for ERP systems (Voalle, IXC, SGP)
export const erpIntegrations = pgTable("erp_integrations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  provider: varchar("provider", { length: 20 }).notNull(), // voalle, ixc, sgp
  connectionType: varchar("connection_type", { length: 20 }).notNull(), // api, database
  isActive: boolean("is_active").notNull().default(true),
  isDefault: boolean("is_default").notNull().default(false),
  
  // API Configuration
  apiUrl: text("api_url"),
  apiAuthUrl: text("api_auth_url"),
  apiClientId: varchar("api_client_id", { length: 255 }),
  apiClientSecret: text("api_client_secret"),
  apiToken: text("api_token"),
  apiSynV1Token: text("api_syn_v1_token"), // Voalle specific
  
  // Database Configuration
  dbHost: varchar("db_host", { length: 255 }),
  dbPort: integer("db_port"),
  dbName: varchar("db_name", { length: 100 }),
  dbUser: varchar("db_user", { length: 100 }),
  dbPassword: text("db_password"),
  dbType: varchar("db_type", { length: 20 }), // mysql, postgresql, sqlserver
  
  // Provider-specific settings (JSON)
  providerConfig: text("provider_config"), // JSON with provider-specific fields
  
  // Ticket/Solicitation settings
  defaultSolicitationTypeCode: varchar("default_solicitation_type_code", { length: 50 }),
  autoCreateTicket: boolean("auto_create_ticket").notNull().default(false),
  
  lastTestedAt: timestamp("last_tested_at"),
  lastTestStatus: varchar("last_test_status", { length: 20 }), // success, error
  lastTestError: text("last_test_error"),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Mapping between Link Monitor clients and ERP customers
export const clientErpMappings = pgTable("client_erp_mappings", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull(), // Link Monitor client
  erpIntegrationId: integer("erp_integration_id").notNull(), // Which ERP integration
  erpCustomerId: varchar("erp_customer_id", { length: 100 }).notNull(), // Customer ID in ERP
  erpCustomerCode: varchar("erp_customer_code", { length: 50 }), // Customer code in ERP
  erpCustomerName: text("erp_customer_name"), // Cached customer name from ERP
  isActive: boolean("is_active").notNull().default(true),
  lastSyncAt: timestamp("last_sync_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertErpIntegrationSchema = createInsertSchema(erpIntegrations).omit({ id: true, createdAt: true, updatedAt: true });
export const insertClientErpMappingSchema = createInsertSchema(clientErpMappings).omit({ id: true, createdAt: true, updatedAt: true });

export type InsertErpIntegration = z.infer<typeof insertErpIntegrationSchema>;
export type InsertClientErpMapping = z.infer<typeof insertClientErpMappingSchema>;
export type ErpIntegration = typeof erpIntegrations.$inferSelect;
export type ClientErpMapping = typeof clientErpMappings.$inferSelect;

export type ErpProvider = "voalle" | "ixc" | "sgp";
export type ErpConnectionType = "api" | "database";

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
  isSuperAdmin: boolean;
  permissions?: string[];
}

export interface LoginCredentials {
  email: string;
  password: string;
}

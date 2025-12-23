import { pgTable, text, varchar, integer, real, timestamp, boolean, serial } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const links = pgTable("links", {
  id: varchar("id", { length: 50 }).primaryKey(),
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
});

export const metrics = pgTable("metrics", {
  id: serial("id").primaryKey(),
  linkId: varchar("link_id", { length: 50 }).notNull(),
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
  linkId: varchar("link_id", { length: 50 }).notNull(),
  type: varchar("type", { length: 20 }).notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
  resolved: boolean("resolved").notNull().default(false),
  resolvedAt: timestamp("resolved_at"),
});

export const ddosEvents = pgTable("ddos_events", {
  id: serial("id").primaryKey(),
  linkId: varchar("link_id", { length: 50 }).notNull(),
  attackType: varchar("attack_type", { length: 100 }).notNull(),
  startTime: timestamp("start_time").notNull().defaultNow(),
  endTime: timestamp("end_time"),
  peakBandwidth: real("peak_bandwidth").notNull(),
  mitigationStatus: varchar("mitigation_status", { length: 20 }).notNull().default("detected"),
  sourceIps: integer("source_ips").notNull().default(0),
  blockedPackets: integer("blocked_packets").notNull().default(0),
});

export const insertLinkSchema = createInsertSchema(links).omit({ lastUpdated: true });
export const insertMetricSchema = createInsertSchema(metrics).omit({ id: true, timestamp: true });
export const insertEventSchema = createInsertSchema(events).omit({ id: true, timestamp: true });
export const insertDDoSEventSchema = createInsertSchema(ddosEvents).omit({ id: true, startTime: true });

export type InsertLink = z.infer<typeof insertLinkSchema>;
export type InsertMetric = z.infer<typeof insertMetricSchema>;
export type InsertEvent = z.infer<typeof insertEventSchema>;
export type InsertDDoSEvent = z.infer<typeof insertDDoSEventSchema>;

export type Link = typeof links.$inferSelect;
export type Metric = typeof metrics.$inferSelect;
export type Event = typeof events.$inferSelect;
export type DDoSEvent = typeof ddosEvents.$inferSelect;

export type LinkStatus = "operational" | "degraded" | "down" | "maintenance";

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
}

import { pgTable, text, varchar, integer, real, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id", { length: 36 }).primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export type LinkStatus = "operational" | "degraded" | "down" | "maintenance";

export interface Link {
  id: string;
  name: string;
  location: string;
  address: string;
  ipBlock: string;
  totalIps: number;
  usableIps: number;
  bandwidth: number;
  status: LinkStatus;
  uptime: number;
  currentDownload: number;
  currentUpload: number;
  latency: number;
  packetLoss: number;
  cpuUsage: number;
  memoryUsage: number;
  lastUpdated: string;
}

export interface Metric {
  id: string;
  linkId: string;
  timestamp: string;
  download: number;
  upload: number;
  latency: number;
  packetLoss: number;
  cpuUsage: number;
  memoryUsage: number;
  errorRate: number;
}

export interface Event {
  id: string;
  linkId: string;
  type: "info" | "warning" | "critical" | "maintenance";
  title: string;
  description: string;
  timestamp: string;
  resolved: boolean;
  resolvedAt?: string;
}

export interface Alert {
  id: string;
  linkId: string;
  severity: "low" | "medium" | "high" | "critical";
  type: string;
  message: string;
  timestamp: string;
  acknowledged: boolean;
}

export interface DDoSEvent {
  id: string;
  linkId: string;
  attackType: string;
  startTime: string;
  endTime?: string;
  peakBandwidth: number;
  mitigationStatus: "detected" | "mitigating" | "mitigated" | "resolved";
  sourceIps: number;
  blockedPackets: number;
}

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

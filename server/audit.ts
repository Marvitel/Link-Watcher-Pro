import { db } from "./db";
import { auditLogs, type InsertAuditLog, type AuditAction, type AuditEntity, type AuthUser } from "@shared/schema";
import type { Request } from "express";

const SENSITIVE_FIELDS = [
  "password",
  "passwordHash",
  "snmpCommunity",
  "wanguardApiPassword",
  "voallePortalPassword",
  "apiKey",
  "secret",
  "token",
  "accessToken",
  "refreshToken",
  "authKey",
  "privKey",
  "bearer",
  "credential",
  "privateKey",
];

function maskSensitiveData(obj: unknown): unknown {
  if (obj === null || obj === undefined) return null;
  
  if (Array.isArray(obj)) {
    return obj.map(item => maskSensitiveData(item));
  }
  
  if (typeof obj !== "object") return obj;
  
  const masked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (SENSITIVE_FIELDS.some(field => key.toLowerCase().includes(field.toLowerCase()))) {
      masked[key] = "***";
    } else if (value !== null && typeof value === "object") {
      masked[key] = maskSensitiveData(value);
    } else {
      masked[key] = value;
    }
  }
  return masked;
}

function getClientIp(req: Request): string | null {
  const realIp = req.headers["x-real-ip"];
  if (realIp) {
    return typeof realIp === "string" ? realIp : realIp[0];
  }
  
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    const ips = (typeof forwarded === "string" ? forwarded : forwarded[0]).split(",");
    return ips[0].trim();
  }
  
  return req.socket?.remoteAddress || null;
}

export interface AuditEventParams {
  clientId?: number | null;
  actor?: AuthUser | { id: null; email: string; name: string; role: string } | null;
  action: AuditAction;
  entity?: AuditEntity;
  entityId?: number | string | null;
  entityName?: string;
  previous?: Record<string, unknown> | null;
  current?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
  status?: "success" | "failure";
  errorMessage?: string;
  request?: Request;
}

export async function logAuditEvent(params: AuditEventParams): Promise<void> {
  try {
    const {
      clientId,
      actor,
      action,
      entity,
      entityId,
      entityName,
      previous,
      current,
      metadata,
      status = "success",
      errorMessage,
      request,
    } = params;

    const auditEntry: InsertAuditLog = {
      clientId: clientId ?? null,
      actorUserId: actor?.id ?? null,
      actorEmail: actor?.email ?? null,
      actorName: actor?.name ?? null,
      actorRole: actor && "isSuperAdmin" in actor && actor.isSuperAdmin ? "super_admin" : (actor?.role ?? null),
      action,
      entity: entity ?? null,
      entityId: entityId ? (typeof entityId === "string" ? parseInt(entityId) || null : entityId) : null,
      entityName: entityName ?? null,
      previousValues: maskSensitiveData(previous) as Record<string, unknown> | null,
      newValues: maskSensitiveData(current) as Record<string, unknown> | null,
      metadata: metadata ?? null,
      ipAddress: request ? getClientIp(request) : null,
      userAgent: request?.headers["user-agent"] ?? null,
      status,
      errorMessage: errorMessage ?? null,
    };

    await db.insert(auditLogs).values(auditEntry);
  } catch (error) {
    console.error("[Audit] Failed to log audit event:", error);
  }
}

export function computeDiff(
  previous: Record<string, unknown> | null,
  current: Record<string, unknown> | null
): { added: string[]; removed: string[]; changed: string[] } {
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];

  if (!previous && current) {
    return { added: Object.keys(current), removed: [], changed: [] };
  }
  if (previous && !current) {
    return { added: [], removed: Object.keys(previous), changed: [] };
  }
  if (!previous || !current) {
    return { added: [], removed: [], changed: [] };
  }

  const allKeys = Array.from(new Set([...Object.keys(previous), ...Object.keys(current)]));
  for (const key of allKeys) {
    const prevValue = previous[key];
    const currValue = current[key];
    
    if (!(key in previous)) {
      added.push(key);
    } else if (!(key in current)) {
      removed.push(key);
    } else if (JSON.stringify(prevValue) !== JSON.stringify(currValue)) {
      changed.push(key);
    }
  }

  return { added, removed, changed };
}

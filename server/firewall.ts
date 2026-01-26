import { Request, Response, NextFunction } from "express";
import { db } from "./db";
import { firewallWhitelist, firewallSettings } from "@shared/schema";
import { eq, and } from "drizzle-orm";

interface FirewallConfig {
  enabled: boolean;
  defaultDenyAdmin: boolean;
  defaultDenySsh: boolean;
  logBlockedAttempts: boolean;
}

interface WhitelistEntry {
  ipAddress: string;
  allowAdmin: boolean;
  allowSsh: boolean;
  allowApi: boolean;
}

let firewallConfig: FirewallConfig = {
  enabled: false,
  defaultDenyAdmin: true,
  defaultDenySsh: true,
  logBlockedAttempts: true,
};

let whitelistCache: WhitelistEntry[] = [];
let cacheTimestamp = 0;
const CACHE_TTL = 30000; // 30 segundos

function isIpInCidr(ip: string, cidr: string): boolean {
  const [network, prefix] = cidr.split("/");
  const prefixLen = parseInt(prefix, 10);
  
  if (isNaN(prefixLen)) return false;
  
  const ipParts = ip.split(".").map(Number);
  const networkParts = network.split(".").map(Number);
  
  if (ipParts.length !== 4 || networkParts.length !== 4) return false;
  
  const ipNum = ipParts.reduce((acc, part) => (acc << 8) + part, 0) >>> 0;
  const networkNum = networkParts.reduce((acc, part) => (acc << 8) + part, 0) >>> 0;
  const mask = prefixLen === 0 ? 0 : (0xFFFFFFFF << (32 - prefixLen)) >>> 0;
  
  return (ipNum & mask) === (networkNum & mask);
}

function normalizeIp(ip: string): string {
  return ip.replace(/^::ffff:/, "");
}

function isIpMatch(clientIp: string, entryIp: string): boolean {
  const normalizedClientIp = normalizeIp(clientIp);
  
  if (entryIp.includes("/")) {
    return isIpInCidr(normalizedClientIp, entryIp);
  }
  return normalizedClientIp === entryIp;
}

export async function loadFirewallConfig(): Promise<void> {
  try {
    const [settings] = await db.select().from(firewallSettings).limit(1);
    if (settings) {
      firewallConfig = {
        enabled: settings.enabled,
        defaultDenyAdmin: settings.defaultDenyAdmin,
        defaultDenySsh: settings.defaultDenySsh,
        logBlockedAttempts: settings.logBlockedAttempts,
      };
    }
  } catch (error) {
    console.error("[Firewall] Erro ao carregar configurações:", error);
  }
}

export async function loadWhitelistCache(): Promise<void> {
  try {
    const entries = await db.select().from(firewallWhitelist).where(eq(firewallWhitelist.isActive, true));
    whitelistCache = entries.map(e => ({
      ipAddress: e.ipAddress,
      allowAdmin: e.allowAdmin,
      allowSsh: e.allowSsh,
      allowApi: e.allowApi,
    }));
    cacheTimestamp = Date.now();
  } catch (error) {
    console.error("[Firewall] Erro ao carregar whitelist:", error);
  }
}

async function ensureCacheValid(): Promise<void> {
  if (Date.now() - cacheTimestamp > CACHE_TTL) {
    await loadWhitelistCache();
    await loadFirewallConfig();
  }
}

export function isIpAllowedForAdmin(clientIp: string): boolean {
  if (!firewallConfig.enabled) return true;
  if (!firewallConfig.defaultDenyAdmin) return true;
  
  // Se whitelist está vazia e default deny está ativo, bloqueia todos
  if (whitelistCache.length === 0) return false;
  
  const normalizedIp = normalizeIp(clientIp);
  
  for (const entry of whitelistCache) {
    if (entry.allowAdmin && isIpMatch(normalizedIp, entry.ipAddress)) {
      return true;
    }
  }
  
  return false;
}

export function isIpAllowedForSsh(clientIp: string): boolean {
  if (!firewallConfig.enabled) return true;
  if (!firewallConfig.defaultDenySsh) return true;
  
  // Se whitelist está vazia e default deny está ativo, bloqueia todos
  if (whitelistCache.length === 0) return false;
  
  const normalizedIp = normalizeIp(clientIp);
  
  for (const entry of whitelistCache) {
    if (entry.allowSsh && isIpMatch(normalizedIp, entry.ipAddress)) {
      return true;
    }
  }
  
  return false;
}

export function createFirewallMiddleware(type: "admin" | "ssh") {
  return async (req: Request, res: Response, next: NextFunction) => {
    await ensureCacheValid();
    
    if (!firewallConfig.enabled) {
      return next();
    }
    
    const clientIp = req.ip || req.socket.remoteAddress || "";
    const isAllowed = type === "admin" 
      ? isIpAllowedForAdmin(clientIp) 
      : isIpAllowedForSsh(clientIp);
    
    if (!isAllowed) {
      if (firewallConfig.logBlockedAttempts) {
        console.log(`[Firewall] Acesso ${type.toUpperCase()} bloqueado de IP: ${normalizeIp(clientIp)}`);
      }
      return res.status(403).json({ 
        error: "Acesso negado",
        message: "Seu IP não está autorizado a acessar este recurso"
      });
    }
    
    next();
  };
}

export async function initializeFirewall(): Promise<void> {
  await loadFirewallConfig();
  await loadWhitelistCache();
  
  if (firewallConfig.enabled) {
    console.log(`[Firewall] Ativado com ${whitelistCache.length} entrada(s) na whitelist`);
  } else {
    console.log("[Firewall] Desativado");
  }
}

export function invalidateCache(): void {
  cacheTimestamp = 0;
}

export function getFirewallStatus(): { config: FirewallConfig; whitelistCount: number } {
  return {
    config: firewallConfig,
    whitelistCount: whitelistCache.length,
  };
}

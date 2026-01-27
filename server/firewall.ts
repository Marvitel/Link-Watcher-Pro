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

// Detecta se é IPv4 ou IPv6
function isIPv4(ip: string): boolean {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(ip);
}

function isIPv6(ip: string): boolean {
  return ip.includes(":");
}

// Expande IPv6 abreviado para formato completo (8 grupos de 4 hex)
function expandIPv6(ip: string): string {
  // Remove zona/scope (ex: %eth0)
  ip = ip.split("%")[0];
  
  // Se tiver ::, precisa expandir
  if (ip.includes("::")) {
    const parts = ip.split("::");
    const left = parts[0] ? parts[0].split(":") : [];
    const right = parts[1] ? parts[1].split(":") : [];
    const missing = 8 - left.length - right.length;
    const middle = Array(missing).fill("0000");
    const full = [...left, ...middle, ...right];
    return full.map(p => p.padStart(4, "0")).join(":");
  }
  
  return ip.split(":").map(p => p.padStart(4, "0")).join(":");
}

// Converte IPv6 expandido para array de 128 bits (como 4 números de 32 bits)
function ipv6ToNumbers(ip: string): number[] {
  const expanded = expandIPv6(ip);
  const parts = expanded.split(":");
  const result: number[] = [];
  
  for (let i = 0; i < 8; i += 2) {
    const high = parseInt(parts[i], 16);
    const low = parseInt(parts[i + 1], 16);
    result.push((high << 16) | low);
  }
  
  return result;
}

// Verifica se IPv4 está em CIDR IPv4
function isIPv4InCidr(ip: string, cidr: string): boolean {
  const [network, prefix] = cidr.split("/");
  const prefixLen = parseInt(prefix, 10);
  
  if (isNaN(prefixLen) || prefixLen < 0 || prefixLen > 32) return false;
  
  const ipParts = ip.split(".").map(Number);
  const networkParts = network.split(".").map(Number);
  
  if (ipParts.length !== 4 || networkParts.length !== 4) return false;
  if (ipParts.some(p => p < 0 || p > 255) || networkParts.some(p => p < 0 || p > 255)) return false;
  
  const ipNum = ipParts.reduce((acc, part) => (acc << 8) + part, 0) >>> 0;
  const networkNum = networkParts.reduce((acc, part) => (acc << 8) + part, 0) >>> 0;
  const mask = prefixLen === 0 ? 0 : (0xFFFFFFFF << (32 - prefixLen)) >>> 0;
  
  return (ipNum & mask) === (networkNum & mask);
}

// Verifica se IPv6 está em CIDR IPv6
function isIPv6InCidr(ip: string, cidr: string): boolean {
  const [network, prefix] = cidr.split("/");
  const prefixLen = parseInt(prefix, 10);
  
  if (isNaN(prefixLen) || prefixLen < 0 || prefixLen > 128) return false;
  
  try {
    const ipNums = ipv6ToNumbers(ip);
    const networkNums = ipv6ToNumbers(network);
    
    let remainingBits = prefixLen;
    
    for (let i = 0; i < 4; i++) {
      if (remainingBits <= 0) break;
      
      const bitsInThisGroup = Math.min(32, remainingBits);
      const mask = bitsInThisGroup === 32 ? 0xFFFFFFFF : (0xFFFFFFFF << (32 - bitsInThisGroup)) >>> 0;
      
      if ((ipNums[i] & mask) !== (networkNums[i] & mask)) {
        return false;
      }
      
      remainingBits -= 32;
    }
    
    return true;
  } catch {
    return false;
  }
}

// Normaliza IP removendo prefixo IPv4-mapped IPv6
function normalizeIp(ip: string): string {
  // Remove ::ffff: prefix (IPv4-mapped IPv6)
  if (ip.startsWith("::ffff:")) {
    return ip.substring(7);
  }
  return ip;
}

// Normaliza IPv6 para comparação direta
function normalizeIPv6ForComparison(ip: string): string {
  if (!isIPv6(ip)) return ip;
  return expandIPv6(ip).toLowerCase();
}

function isIpMatch(clientIp: string, entryIp: string): boolean {
  const normalizedClientIp = normalizeIp(clientIp);
  const normalizedEntryIp = normalizeIp(entryIp);
  
  // Verifica se é CIDR
  if (normalizedEntryIp.includes("/")) {
    const networkPart = normalizedEntryIp.split("/")[0];
    
    // IPv4 CIDR
    if (isIPv4(networkPart) && isIPv4(normalizedClientIp)) {
      return isIPv4InCidr(normalizedClientIp, normalizedEntryIp);
    }
    
    // IPv6 CIDR
    if (isIPv6(networkPart) && isIPv6(normalizedClientIp)) {
      return isIPv6InCidr(normalizedClientIp, normalizedEntryIp);
    }
    
    return false;
  }
  
  // Comparação direta de IP
  if (isIPv4(normalizedEntryIp) && isIPv4(normalizedClientIp)) {
    return normalizedClientIp === normalizedEntryIp;
  }
  
  if (isIPv6(normalizedEntryIp) && isIPv6(normalizedClientIp)) {
    return normalizeIPv6ForComparison(normalizedClientIp) === normalizeIPv6ForComparison(normalizedEntryIp);
  }
  
  return false;
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

// Obtém o IP real do cliente considerando proxies reversos
function getClientIp(req: Request): string {
  // Prioridade: X-Forwarded-For > X-Real-IP > req.ip > remoteAddress
  const xForwardedFor = req.headers["x-forwarded-for"];
  if (xForwardedFor) {
    // X-Forwarded-For pode ter múltiplos IPs separados por vírgula
    const ips = Array.isArray(xForwardedFor) ? xForwardedFor[0] : xForwardedFor;
    const firstIp = ips.split(",")[0].trim();
    if (firstIp) return firstIp;
  }
  
  const xRealIp = req.headers["x-real-ip"];
  if (xRealIp) {
    return Array.isArray(xRealIp) ? xRealIp[0] : xRealIp;
  }
  
  return req.ip || req.socket.remoteAddress || "";
}

export function createFirewallMiddleware(type: "admin" | "ssh") {
  return async (req: Request, res: Response, next: NextFunction) => {
    await ensureCacheValid();
    
    if (!firewallConfig.enabled) {
      return next();
    }
    
    const clientIp = getClientIp(req);
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

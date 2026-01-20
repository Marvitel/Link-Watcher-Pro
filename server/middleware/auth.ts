import type { Request, Response, NextFunction } from "express";
import "express-session";
import jwt from "jsonwebtoken";
import { storage } from "../storage";
import type { AuthUser } from "@shared/schema";

const JWT_SECRET = process.env.SESSION_SECRET || "link-monitor-secret-key";

export function signToken(user: AuthUser): string {
  return jwt.sign(
    { 
      id: user.id, 
      email: user.email, 
      name: user.name,
      role: user.role,
      clientId: user.clientId,
      isSuperAdmin: user.isSuperAdmin 
    }, 
    JWT_SECRET, 
    { expiresIn: "24h" }
  );
}

function getUserFromRequest(req: Request): AuthUser | undefined {
  const sessionUser = (req.session as any)?.user as AuthUser | undefined;
  if (sessionUser) {
    return sessionUser;
  }
  
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.substring(7);
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as AuthUser;
      return decoded;
    } catch (error) {
      return undefined;
    }
  }
  
  return undefined;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: "Autenticação necessária" });
  }
  req.user = user;
  req.clientId = user.clientId ?? undefined;
  next();
}

export function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  const user = getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: "Autenticação necessária" });
  }
  if (!user.isSuperAdmin) {
    return res.status(403).json({ error: "Acesso restrito a super administradores" });
  }
  req.user = user;
  next();
}

export function requireClientAccess(req: Request, res: Response, next: NextFunction) {
  const user = getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: "Autenticação necessária" });
  }
  
  const requestedClientId = parseInt(req.params.clientId, 10);
  
  if (user.isSuperAdmin) {
    req.user = user;
    req.clientId = requestedClientId;
    return next();
  }
  
  if (user.clientId !== requestedClientId) {
    return res.status(403).json({ error: "Acesso negado a este cliente" });
  }
  
  req.user = user;
  req.clientId = user.clientId ?? undefined;
  next();
}

export function requirePermission(permissionCode: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: "Autenticação necessária" });
    }
    
    if (user.isSuperAdmin) {
      req.user = user;
      return next();
    }
    
    const userPerms = await storage.getUserPermissions(user.id);
    if (!userPerms.includes(permissionCode)) {
      return res.status(403).json({ error: "Permissão insuficiente" });
    }
    
    req.user = user;
    req.clientId = user.clientId ?? undefined;
    next();
  };
}

export function optionalAuth(req: Request, res: Response, next: NextFunction) {
  const user = getUserFromRequest(req);
  if (user) {
    req.user = user;
    req.clientId = user.clientId ?? undefined;
  }
  next();
}

export function requireDiagnosticsAccess(req: Request, res: Response, next: NextFunction) {
  const diagnosticsToken = process.env.DIAGNOSTICS_TOKEN;
  const providedToken = req.headers["x-diagnostics-token"] as string | undefined;
  
  if (diagnosticsToken && providedToken === diagnosticsToken) {
    return next();
  }
  
  const user = getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: "Autenticação necessária. Use X-Diagnostics-Token ou faça login como Super Admin." });
  }
  if (!user.isSuperAdmin) {
    return res.status(403).json({ error: "Acesso restrito a super administradores" });
  }
  req.user = user;
  next();
}

import type { Request, Response, NextFunction } from "express";
import "express-session";
import { storage } from "../storage";
import type { AuthUser } from "@shared/schema";

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = (req.session as any)?.user as AuthUser | undefined;
  if (!user) {
    return res.status(401).json({ error: "Autenticação necessária" });
  }
  req.user = user;
  req.clientId = user.clientId ?? undefined;
  next();
}

export function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  const user = (req.session as any)?.user as AuthUser | undefined;
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
  const user = (req.session as any)?.user as AuthUser | undefined;
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
    const user = (req.session as any)?.user as AuthUser | undefined;
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
  const user = (req.session as any)?.user as AuthUser | undefined;
  if (user) {
    req.user = user;
    req.clientId = user.clientId ?? undefined;
  }
  next();
}

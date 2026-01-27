import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import MemoryStore from "memorystore";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { setupTerminalWebSocket } from "./terminal";
import { initializeFirewall, createFirewallMiddleware } from "./firewall";

const app = express();
const httpServer = createServer(app);

// Servidor admin separado (porta diferente em produção)
const adminApp = express();
const adminHttpServer = createServer(adminApp);

// Whitelist de IPs para porta admin (configurável via env)
// Formato: IPs separados por vírgula, ex: "192.168.1.0/24,10.0.0.0/8,200.123.45.67"
const ADMIN_IP_WHITELIST = process.env.ADMIN_IP_WHITELIST || "";

function isIpInWhitelist(clientIp: string, whitelist: string[]): boolean {
  if (whitelist.length === 0) return true; // Sem whitelist = permite todos
  
  const cleanIp = clientIp.replace(/^::ffff:/, ""); // Remove prefixo IPv6 para IPv4 mapeado
  
  for (const entry of whitelist) {
    if (entry.includes("/")) {
      // CIDR notation
      if (isIpInCidr(cleanIp, entry)) return true;
    } else {
      // IP exato
      if (cleanIp === entry) return true;
    }
  }
  return false;
}

function isIpInCidr(ip: string, cidr: string): boolean {
  const [range, bits] = cidr.split("/");
  const mask = parseInt(bits, 10);
  
  if (mask < 0 || mask > 32) return false;
  
  const ipNum = ipToNumber(ip);
  const rangeNum = ipToNumber(range);
  
  if (ipNum === null || rangeNum === null) return false;
  
  const maskNum = ~((1 << (32 - mask)) - 1) >>> 0;
  return (ipNum & maskNum) === (rangeNum & maskNum);
}

function ipToNumber(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  
  let result = 0;
  for (const part of parts) {
    const num = parseInt(part, 10);
    if (isNaN(num) || num < 0 || num > 255) return null;
    result = (result << 8) + num;
  }
  return result >>> 0;
}

const MemoryStoreSession = MemoryStore(session);

// Configuração de sessão compartilhada
const sessionStore = new MemoryStoreSession({
  checkPeriod: 86400000, // prune expired entries every 24h
});

const sessionConfig = {
  secret: process.env.SESSION_SECRET || "link-monitor-secret-key",
  resave: false,
  saveUninitialized: false,
  store: sessionStore,
  cookie: {
    secure: false,
    httpOnly: true,
    sameSite: "lax" as const,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
  },
};

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

// Middleware de JSON para ambos os apps
const jsonMiddleware = express.json({
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  },
});

app.use(jsonMiddleware);
adminApp.use(express.json({
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  },
}));

app.use(express.urlencoded({ extended: false }));
adminApp.use(express.urlencoded({ extended: false }));

// Trust proxy for secure cookies behind reverse proxy
app.set("trust proxy", 1);
adminApp.set("trust proxy", 1);

app.use(session(sessionConfig));
adminApp.use(session(sessionConfig));

// Middleware de whitelist de IP para servidor admin
const adminWhitelist = ADMIN_IP_WHITELIST.split(",").map(ip => ip.trim()).filter(ip => ip.length > 0);

if (adminWhitelist.length > 0) {
  adminApp.use((req, res, next) => {
    const clientIp = req.ip || req.socket.remoteAddress || "";
    
    if (!isIpInWhitelist(clientIp, adminWhitelist)) {
      console.log(`[Security] Blocked access from IP: ${clientIp} (not in whitelist)`);
      return res.status(403).json({ 
        error: "Acesso negado",
        message: "Seu IP não está autorizado a acessar este portal"
      });
    }
    next();
  });
  console.log(`[Security] Admin IP whitelist enabled: ${adminWhitelist.join(", ")}`);
} else {
  console.log(`[Security] Admin IP whitelist disabled (no ADMIN_IP_WHITELIST configured)`);
}

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // Determinar modo de operação
  const port = parseInt(process.env.PORT || "5000", 10);
  const adminPort = parseInt(process.env.ADMIN_PORT || "5001", 10);
  const isSinglePortMode = adminPort === port;
  
  // Inicializar firewall do banco de dados
  await initializeFirewall();
  
  // Aplicar middleware de firewall nas rotas admin
  app.use("/admin", createFirewallMiddleware("admin"));
  app.use("/api/admin", createFirewallMiddleware("admin"));
  adminApp.use("/admin", createFirewallMiddleware("admin"));
  adminApp.use("/api/admin", createFirewallMiddleware("admin"));
  
  // Aplicar middleware de firewall no terminal SSH
  app.use("/ws/terminal", createFirewallMiddleware("ssh"));
  adminApp.use("/ws/terminal", createFirewallMiddleware("ssh"));
  
  // Registrar rotas
  await registerRoutes(httpServer, app);
  
  // Em modo dual-port, configurar servidor admin separado
  if (!isSinglePortMode) {
    await registerRoutes(adminHttpServer, adminApp);
    // Terminal WebSocket apenas no servidor admin
    setupTerminalWebSocket(adminHttpServer);
  }

  // Error handlers
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    res.status(status).json({ message });
    throw err;
  });

  adminApp.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    res.status(status).json({ message });
    throw err;
  });

  // Setup static/vite
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
    if (!isSinglePortMode) {
      serveStatic(adminApp);
    }
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
    if (!isSinglePortMode) {
      await setupVite(adminHttpServer, adminApp);
    }
  }

  // Porta principal (clientes)
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`Client portal serving on port ${port}`);
    },
  );

  // Porta admin (funcionários Marvitel) - apenas em modo dual-port
  if (!isSinglePortMode) {
    adminHttpServer.listen(
      {
        port: adminPort,
        host: "0.0.0.0",
        reusePort: true,
      },
      () => {
        log(`Admin portal serving on port ${adminPort} (restrict via firewall in production)`);
      },
    );
  } else {
    // Em single-port mode, terminal WebSocket no servidor principal
    setupTerminalWebSocket(httpServer);
    log(`Single port mode: admin features on port ${port}`);
  }
})();

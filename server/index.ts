import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import MemoryStore from "memorystore";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { setupTerminalWebSocket } from "./terminal";

const app = express();
const httpServer = createServer(app);

// Servidor admin separado (porta diferente em produção)
const adminApp = express();
const adminHttpServer = createServer(adminApp);

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
adminApp.use(express.json());

app.use(express.urlencoded({ extended: false }));
adminApp.use(express.urlencoded({ extended: false }));

// Trust proxy for secure cookies behind reverse proxy
app.set("trust proxy", 1);
adminApp.set("trust proxy", 1);

app.use(session(sessionConfig));
adminApp.use(session(sessionConfig));

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
  // Registrar rotas em ambos os apps
  await registerRoutes(httpServer, app);
  await registerRoutes(adminHttpServer, adminApp);
  
  // Terminal WebSocket apenas no servidor admin
  setupTerminalWebSocket(adminHttpServer);

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

  // Setup static/vite para ambos
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
    serveStatic(adminApp);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
    await setupVite(adminHttpServer, adminApp);
  }

  // Porta principal (clientes) - PORT ou 5000
  const port = parseInt(process.env.PORT || "5000", 10);
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

  // Porta admin (funcionários Marvitel) - ADMIN_PORT ou 5001
  // Em produção, configurar firewall para liberar apenas IPs da Marvitel
  const adminPort = parseInt(process.env.ADMIN_PORT || "5001", 10);
  
  // Só inicia servidor admin se a porta for diferente da principal
  // No Replit, ambas usam 5000, então não inicia o segundo servidor
  if (adminPort !== port) {
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
    // Se mesma porta, terminal WebSocket também no servidor principal
    setupTerminalWebSocket(httpServer);
    log(`Single port mode: admin features on port ${port}`);
  }
})();

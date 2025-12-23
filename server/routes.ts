import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { wanguardService } from "./wanguard";
import { 
  insertIncidentSchema, 
  insertClientSchema, 
  insertUserSchema, 
  insertLinkSchema, 
  insertHostSchema,
  type AuthUser 
} from "@shared/schema";

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      clientId?: number;
    }
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  await storage.initializeDefaultData();
  storage.startMetricCollection();

  app.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: "Email e senha são obrigatórios" });
      }
      
      const user = await storage.validateCredentials(email, password);
      if (!user) {
        return res.status(401).json({ error: "Credenciais inválidas" });
      }
      
      (req.session as any).user = user;
      res.json({ user });
    } catch (error) {
      res.status(500).json({ error: "Erro ao fazer login" });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ error: "Erro ao fazer logout" });
      }
      res.json({ success: true });
    });
  });

  app.get("/api/auth/me", (req, res) => {
    const user = (req.session as any)?.user;
    if (!user) {
      return res.status(401).json({ error: "Não autenticado" });
    }
    res.json({ user });
  });

  app.get("/api/clients", async (req, res) => {
    try {
      const allClients = await storage.getClients();
      res.json(allClients);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch clients" });
    }
  });

  app.get("/api/clients/:id", async (req, res) => {
    try {
      const client = await storage.getClient(parseInt(req.params.id, 10));
      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }
      res.json(client);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch client" });
    }
  });

  app.post("/api/clients", async (req, res) => {
    try {
      const validatedData = insertClientSchema.parse(req.body);
      const client = await storage.createClient(validatedData);
      res.status(201).json(client);
    } catch (error) {
      res.status(400).json({ error: "Invalid client data" });
    }
  });

  app.patch("/api/clients/:id", async (req, res) => {
    try {
      await storage.updateClient(parseInt(req.params.id, 10), req.body);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to update client" });
    }
  });

  app.delete("/api/clients/:id", async (req, res) => {
    try {
      await storage.deleteClient(parseInt(req.params.id, 10));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete client" });
    }
  });

  app.get("/api/clients/:clientId/users", async (req, res) => {
    try {
      const userList = await storage.getUsers(parseInt(req.params.clientId, 10));
      res.json(userList.map(u => ({ ...u, passwordHash: undefined })));
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch users" });
    }
  });

  app.post("/api/users", async (req, res) => {
    try {
      const validatedData = insertUserSchema.parse(req.body);
      const user = await storage.createUser(validatedData);
      res.status(201).json({ ...user, passwordHash: undefined });
    } catch (error) {
      res.status(400).json({ error: "Invalid user data" });
    }
  });

  app.patch("/api/users/:id", async (req, res) => {
    try {
      await storage.updateUser(parseInt(req.params.id, 10), req.body);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to update user" });
    }
  });

  app.get("/api/stats", async (req, res) => {
    try {
      const clientId = req.query.clientId ? parseInt(req.query.clientId as string, 10) : undefined;
      const stats = await storage.getDashboardStats(clientId);
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch dashboard stats" });
    }
  });

  app.get("/api/links", async (req, res) => {
    try {
      const clientId = req.query.clientId ? parseInt(req.query.clientId as string, 10) : undefined;
      const linkList = await storage.getLinks(clientId);
      res.json(linkList);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch links" });
    }
  });

  app.get("/api/links/:id", async (req, res) => {
    try {
      const link = await storage.getLink(parseInt(req.params.id, 10));
      if (!link) {
        return res.status(404).json({ error: "Link not found" });
      }
      res.json(link);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch link" });
    }
  });

  app.post("/api/links", async (req, res) => {
    try {
      const validatedData = insertLinkSchema.parse(req.body);
      const link = await storage.createLink(validatedData);
      res.status(201).json(link);
    } catch (error) {
      res.status(400).json({ error: "Invalid link data" });
    }
  });

  app.patch("/api/links/:id", async (req, res) => {
    try {
      await storage.updateLink(parseInt(req.params.id, 10), req.body);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to update link" });
    }
  });

  app.delete("/api/links/:id", async (req, res) => {
    try {
      await storage.deleteLink(parseInt(req.params.id, 10));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete link" });
    }
  });

  app.get("/api/links/:id/metrics", async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
      const metricsData = await storage.getLinkMetrics(parseInt(req.params.id, 10), Math.min(limit, 1000));
      res.json(metricsData);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch link metrics" });
    }
  });

  app.get("/api/links/:id/events", async (req, res) => {
    try {
      const eventsList = await storage.getLinkEvents(parseInt(req.params.id, 10));
      res.json(eventsList);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch link events" });
    }
  });

  app.get("/api/links/:id/sla", async (req, res) => {
    try {
      const sla = await storage.getLinkSLA(parseInt(req.params.id, 10));
      res.json(sla);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch link SLA" });
    }
  });

  app.get("/api/links/:id/status-detail", async (req, res) => {
    try {
      const statusDetail = await storage.getLinkStatusDetail(parseInt(req.params.id, 10));
      if (!statusDetail) {
        return res.status(404).json({ error: "Link not found" });
      }
      res.json(statusDetail);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch link status detail" });
    }
  });

  app.post("/api/links/:id/failure", async (req, res) => {
    try {
      const { failureReason, failureSource } = req.body;
      await storage.updateLinkFailureState(parseInt(req.params.id, 10), failureReason, failureSource);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to update link failure state" });
    }
  });

  app.get("/api/links/:id/incidents", async (req, res) => {
    try {
      const linkIncidents = await storage.getLinkIncidents(parseInt(req.params.id, 10));
      res.json(linkIncidents);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch link incidents" });
    }
  });

  app.get("/api/hosts", async (req, res) => {
    try {
      const linkId = req.query.linkId ? parseInt(req.query.linkId as string, 10) : undefined;
      const clientId = req.query.clientId ? parseInt(req.query.clientId as string, 10) : undefined;
      const hostList = await storage.getHosts(linkId, clientId);
      res.json(hostList);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch hosts" });
    }
  });

  app.get("/api/hosts/:id", async (req, res) => {
    try {
      const host = await storage.getHost(parseInt(req.params.id, 10));
      if (!host) {
        return res.status(404).json({ error: "Host not found" });
      }
      res.json(host);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch host" });
    }
  });

  app.post("/api/hosts", async (req, res) => {
    try {
      const validatedData = insertHostSchema.parse(req.body);
      const host = await storage.createHost(validatedData);
      res.status(201).json(host);
    } catch (error) {
      res.status(400).json({ error: "Invalid host data" });
    }
  });

  app.patch("/api/hosts/:id", async (req, res) => {
    try {
      await storage.updateHost(parseInt(req.params.id, 10), req.body);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to update host" });
    }
  });

  app.delete("/api/hosts/:id", async (req, res) => {
    try {
      await storage.deleteHost(parseInt(req.params.id, 10));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete host" });
    }
  });

  app.get("/api/events", async (req, res) => {
    try {
      const clientId = req.query.clientId ? parseInt(req.query.clientId as string, 10) : undefined;
      const eventsList = await storage.getEvents(clientId);
      res.json(eventsList);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch events" });
    }
  });

  app.get("/api/security/ddos", async (req, res) => {
    try {
      const clientId = req.query.clientId ? parseInt(req.query.clientId as string, 10) : undefined;
      const ddosList = await storage.getDDoSEvents(clientId);
      res.json(ddosList);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch DDoS events" });
    }
  });

  app.get("/api/sla", async (req, res) => {
    try {
      const clientId = req.query.clientId ? parseInt(req.query.clientId as string, 10) : undefined;
      const sla = await storage.getSLAIndicators(clientId);
      res.json(sla);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch SLA indicators" });
    }
  });

  app.get("/api/incidents", async (req, res) => {
    try {
      const open = req.query.open === "true";
      const clientId = req.query.clientId ? parseInt(req.query.clientId as string, 10) : undefined;
      const allIncidents = open 
        ? await storage.getOpenIncidents(clientId) 
        : await storage.getIncidents(clientId);
      res.json(allIncidents);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch incidents" });
    }
  });

  app.get("/api/incidents/:id", async (req, res) => {
    try {
      const incident = await storage.getIncident(parseInt(req.params.id, 10));
      if (!incident) {
        return res.status(404).json({ error: "Incident not found" });
      }
      res.json(incident);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch incident" });
    }
  });

  app.post("/api/incidents", async (req, res) => {
    try {
      const validatedData = insertIncidentSchema.parse(req.body);
      const incident = await storage.createIncident(validatedData);
      
      await storage.updateLinkFailureState(
        validatedData.linkId,
        validatedData.failureReason || "indefinido",
        validatedData.failureSource || "manual"
      );
      
      res.status(201).json(incident);
    } catch (error) {
      res.status(400).json({ error: "Invalid incident data" });
    }
  });

  app.patch("/api/incidents/:id", async (req, res) => {
    try {
      const { status, erpTicketId, erpTicketStatus, repairNotes } = req.body;
      await storage.updateIncident(parseInt(req.params.id, 10), {
        status,
        erpTicketId,
        erpTicketStatus,
        repairNotes,
      });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to update incident" });
    }
  });

  app.post("/api/incidents/:id/close", async (req, res) => {
    try {
      const { notes } = req.body;
      await storage.closeIncident(parseInt(req.params.id, 10), notes);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to close incident" });
    }
  });

  app.get("/api/clients/:clientId/settings", async (req, res) => {
    try {
      const settings = await storage.getClientSettings(parseInt(req.params.clientId, 10));
      if (!settings) {
        return res.status(404).json({ error: "Settings not found" });
      }
      res.json(settings);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch client settings" });
    }
  });

  app.patch("/api/clients/:clientId/settings", async (req, res) => {
    try {
      await storage.updateClientSettings(parseInt(req.params.clientId, 10), req.body);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to update client settings" });
    }
  });

  app.post("/api/clients/:clientId/wanguard/test", async (req, res) => {
    try {
      const settings = await storage.getClientSettings(parseInt(req.params.clientId, 10));
      if (!settings?.wanguardApiEndpoint || !settings?.wanguardApiUser || !settings?.wanguardApiPassword) {
        return res.status(400).json({ 
          success: false, 
          message: "Configurações do Wanguard incompletas" 
        });
      }

      wanguardService.configure({
        endpoint: settings.wanguardApiEndpoint,
        user: settings.wanguardApiUser,
        password: settings.wanguardApiPassword,
      });

      const result = await wanguardService.testConnection();
      res.json(result);
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        message: "Erro ao testar conexão com Wanguard" 
      });
    }
  });

  app.post("/api/clients/:clientId/wanguard/sync", async (req, res) => {
    try {
      const clientId = parseInt(req.params.clientId, 10);
      const settings = await storage.getClientSettings(clientId);
      
      if (!settings?.wanguardEnabled) {
        return res.status(400).json({ 
          error: "Integração com Wanguard não está habilitada" 
        });
      }

      if (!settings.wanguardApiEndpoint || !settings.wanguardApiUser || !settings.wanguardApiPassword) {
        return res.status(400).json({ 
          error: "Configurações do Wanguard incompletas" 
        });
      }

      wanguardService.configure({
        endpoint: settings.wanguardApiEndpoint,
        user: settings.wanguardApiUser,
        password: settings.wanguardApiPassword,
      });

      const anomalies = await wanguardService.getActiveAnomalies();
      const links = await storage.getLinks(clientId);
      
      let syncedCount = 0;
      for (const anomaly of anomalies) {
        const matchingLink = links.find(link => 
          link.ipBlock && anomaly.ip?.startsWith(link.ipBlock.split("/")[0].slice(0, -1))
        );
        
        if (matchingLink) {
          const existingEvent = await storage.getDDoSEventByWanguardId(anomaly.id);
          if (!existingEvent) {
            const eventData = wanguardService.mapAnomalyToEvent(anomaly, clientId, matchingLink.id);
            await storage.createDDoSEvent(eventData);
            syncedCount++;
          }
        }
      }

      res.json({ 
        success: true, 
        message: `Sincronização concluída. ${syncedCount} novos eventos importados.`,
        syncedCount 
      });
    } catch (error) {
      res.status(500).json({ error: "Erro ao sincronizar com Wanguard" });
    }
  });

  app.get("/api/clients/:clientId/wanguard/anomalies", async (req, res) => {
    try {
      const clientId = parseInt(req.params.clientId, 10);
      const settings = await storage.getClientSettings(clientId);
      
      if (!settings?.wanguardEnabled || !settings.wanguardApiEndpoint) {
        return res.status(400).json({ error: "Wanguard não configurado" });
      }

      wanguardService.configure({
        endpoint: settings.wanguardApiEndpoint,
        user: settings.wanguardApiUser || "",
        password: settings.wanguardApiPassword || "",
      });

      const status = req.query.status as string || "active";
      const anomalies = status === "historical" 
        ? await wanguardService.getHistoricalAnomalies()
        : await wanguardService.getActiveAnomalies();

      res.json(anomalies);
    } catch (error) {
      res.status(500).json({ error: "Erro ao buscar anomalias do Wanguard" });
    }
  });

  return httpServer;
}

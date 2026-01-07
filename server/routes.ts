import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { wanguardService } from "./wanguard";
import { VoalleService } from "./voalle";
import { getErpAdapter, configureErpAdapter, clearErpAdapter } from "./erp";
import { discoverInterfaces, type SnmpInterface } from "./snmp";
import { queryOltAlarm, testOltConnection } from "./olt";
import { requireAuth, requireSuperAdmin, requireClientAccess, requirePermission, signToken } from "./middleware/auth";
import { 
  insertIncidentSchema, 
  insertClientSchema, 
  insertUserSchema, 
  insertLinkSchema, 
  insertHostSchema,
  insertGroupSchema,
  insertSnmpProfileSchema,
  insertMibConfigSchema,
  insertClientEventSettingSchema,
  insertOltSchema,
  insertErpIntegrationSchema,
  insertClientErpMappingSchema,
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

function mapIncidentReasonToEventType(failureReason: string): string {
  const reasonMap: Record<string, string> = {
    "fibra_rompida": "link_down",
    "equipamento_danificado": "link_down",
    "falha_energia": "link_down",
    "manutencao_programada": "maintenance",
    "manutencao": "maintenance",
    "latencia_alta": "high_latency",
    "perda_pacotes": "packet_loss",
    "ddos": "ddos_detected",
    "ddos_ataque": "ddos_detected",
  };
  return reasonMap[failureReason.toLowerCase()] || "link_down";
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
      
      const token = signToken(user);
      
      (req.session as any).user = user;
      req.session.save((err) => {
        if (err) {
          console.error("Session save error:", err);
        }
        res.json({ user, token });
      });
    } catch (error) {
      console.error("Login error:", error);
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

  // Endpoint para listar Super Admins da Marvitel
  app.get("/api/superadmins", requireAuth, async (req, res) => {
    try {
      if (!req.user?.isSuperAdmin) {
        return res.status(403).json({ error: "Acesso negado" });
      }
      const superAdminList = await storage.getSuperAdmins();
      res.json(superAdminList.map(u => ({ ...u, passwordHash: undefined })));
    } catch (error) {
      res.status(500).json({ error: "Falha ao buscar super admins" });
    }
  });

  app.post("/api/users", requireAuth, async (req, res) => {
    try {
      if (!req.user?.isSuperAdmin) {
        return res.status(403).json({ error: "Acesso negado" });
      }
      
      const { password, ...userData } = req.body;
      if (!password || password.length < 6) {
        return res.status(400).json({ error: "Senha deve ter pelo menos 6 caracteres" });
      }
      
      const userDataWithHash = {
        ...userData,
        passwordHash: password,
      };
      
      const validatedData = insertUserSchema.parse(userDataWithHash);
      const user = await storage.createUser(validatedData);
      res.status(201).json({ ...user, passwordHash: undefined });
    } catch (error: any) {
      console.error("Error creating user:", error);
      res.status(400).json({ error: error.message || "Dados de usuario invalidos" });
    }
  });

  app.patch("/api/users/:id", requireAuth, async (req, res) => {
    try {
      if (!req.user?.isSuperAdmin) {
        return res.status(403).json({ error: "Acesso negado" });
      }
      
      const { password, ...updateData } = req.body;
      if (password) {
        updateData.passwordHash = password;
      }
      
      await storage.updateUser(parseInt(req.params.id, 10), updateData);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Falha ao atualizar usuario" });
    }
  });

  app.delete("/api/users/:id", requireAuth, async (req, res) => {
    try {
      if (!req.user?.isSuperAdmin) {
        return res.status(403).json({ error: "Acesso negado" });
      }
      
      await storage.deleteUser(parseInt(req.params.id, 10));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Falha ao excluir usuario" });
    }
  });

  function getEffectiveClientId(req: Request): number | undefined {
    const user = req.user;
    const queryClientId = req.query.clientId ? parseInt(req.query.clientId as string, 10) : undefined;
    
    if (user?.isSuperAdmin) {
      return queryClientId;
    }
    return user?.clientId || undefined;
  }

  app.get("/api/stats", requireAuth, async (req, res) => {
    try {
      const clientId = getEffectiveClientId(req);
      const stats = await storage.getDashboardStats(clientId);
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch dashboard stats" });
    }
  });

  app.get("/api/my-settings", requireAuth, async (req, res) => {
    try {
      const clientId = getEffectiveClientId(req);
      if (!clientId) {
        return res.json({ wanguardEnabled: true, voalleEnabled: true });
      }
      const settings = await storage.getClientSettings(clientId);
      res.json({
        wanguardEnabled: settings?.wanguardEnabled ?? false,
        voalleEnabled: settings?.voalleEnabled ?? false,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch settings" });
    }
  });

  app.get("/api/links", requireAuth, async (req, res) => {
    try {
      const clientId = getEffectiveClientId(req);
      const linkList = await storage.getLinks(clientId);
      res.json(linkList);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch links" });
    }
  });

  async function validateLinkAccess(req: Request, linkId: number): Promise<{ allowed: boolean; link?: any }> {
    const link = await storage.getLink(linkId);
    if (!link) return { allowed: false };
    
    const user = req.user;
    if (!user) return { allowed: false };
    if (user.isSuperAdmin) return { allowed: true, link };
    if (link.clientId === user.clientId) return { allowed: true, link };
    
    return { allowed: false };
  }

  app.get("/api/links/:id", requireAuth, async (req, res) => {
    try {
      const linkId = parseInt(req.params.id, 10);
      const { allowed, link } = await validateLinkAccess(req, linkId);
      if (!allowed || !link) {
        return res.status(404).json({ error: "Link not found" });
      }
      res.json(link);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch link" });
    }
  });

  app.post("/api/links", requireAuth, async (req, res) => {
    try {
      const user = req.user;
      const validatedData = insertLinkSchema.parse(req.body);
      
      if (!user?.isSuperAdmin && validatedData.clientId !== user?.clientId) {
        return res.status(403).json({ error: "Acesso negado" });
      }
      
      const link = await storage.createLink(validatedData);
      res.status(201).json(link);
    } catch (error) {
      res.status(400).json({ error: "Invalid link data" });
    }
  });

  app.patch("/api/links/:id", requireAuth, async (req, res) => {
    try {
      const linkId = parseInt(req.params.id, 10);
      const { allowed } = await validateLinkAccess(req, linkId);
      if (!allowed) {
        return res.status(403).json({ error: "Acesso negado" });
      }
      
      await storage.updateLink(linkId, req.body);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to update link" });
    }
  });

  app.delete("/api/links/:id", requireAuth, async (req, res) => {
    try {
      const linkId = parseInt(req.params.id, 10);
      const { allowed } = await validateLinkAccess(req, linkId);
      if (!allowed) {
        return res.status(403).json({ error: "Acesso negado" });
      }
      
      await storage.deleteLink(linkId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete link" });
    }
  });

  app.get("/api/links/:id/metrics", requireAuth, async (req, res) => {
    try {
      const linkId = parseInt(req.params.id, 10);
      const { allowed } = await validateLinkAccess(req, linkId);
      if (!allowed) {
        return res.status(403).json({ error: "Acesso negado" });
      }
      
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
      // Padrão 1h para mini-gráficos (dashboard/links), página de detalhes passa hours explicitamente
      const hours = req.query.hours ? parseInt(req.query.hours as string, 10) : 1;
      
      // Suporte a intervalo personalizado via from/to (timestamps ISO)
      const fromParam = req.query.from as string | undefined;
      const toParam = req.query.to as string | undefined;
      const fromDate = fromParam ? new Date(fromParam) : undefined;
      const toDate = toParam ? new Date(toParam) : undefined;
      
      const metricsData = await storage.getLinkMetrics(
        linkId, 
        limit ? Math.min(limit, 5000) : undefined, 
        (fromDate && toDate) ? undefined : hours,
        fromDate,
        toDate
      );
      res.json(metricsData);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch link metrics" });
    }
  });

  app.get("/api/links/:id/events", requireAuth, async (req, res) => {
    try {
      const linkId = parseInt(req.params.id, 10);
      const { allowed } = await validateLinkAccess(req, linkId);
      if (!allowed) {
        return res.status(403).json({ error: "Acesso negado" });
      }
      
      const eventsList = await storage.getLinkEvents(linkId);
      res.json(eventsList);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch link events" });
    }
  });

  app.get("/api/links/:id/sla", requireAuth, async (req, res) => {
    try {
      const linkId = parseInt(req.params.id, 10);
      const { allowed } = await validateLinkAccess(req, linkId);
      if (!allowed) {
        return res.status(403).json({ error: "Acesso negado" });
      }
      
      const sla = await storage.getLinkSLA(linkId);
      res.json(sla);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch link SLA" });
    }
  });

  app.get("/api/links/:id/status-detail", requireAuth, async (req, res) => {
    try {
      const linkId = parseInt(req.params.id, 10);
      const { allowed, link } = await validateLinkAccess(req, linkId);
      if (!allowed || !link) {
        return res.status(404).json({ error: "Link not found" });
      }
      
      const statusDetail = await storage.getLinkStatusDetail(linkId);
      res.json(statusDetail);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch link status detail" });
    }
  });

  app.post("/api/links/:id/failure", requireAuth, async (req, res) => {
    try {
      const linkId = parseInt(req.params.id, 10);
      const { allowed } = await validateLinkAccess(req, linkId);
      if (!allowed) {
        return res.status(403).json({ error: "Acesso negado" });
      }
      
      const { failureReason, failureSource } = req.body;
      await storage.updateLinkFailureState(linkId, failureReason, failureSource);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to update link failure state" });
    }
  });

  app.get("/api/links/:id/incidents", requireAuth, async (req, res) => {
    try {
      const linkId = parseInt(req.params.id, 10);
      const { allowed } = await validateLinkAccess(req, linkId);
      if (!allowed) {
        return res.status(403).json({ error: "Acesso negado" });
      }
      
      const linkIncidents = await storage.getLinkIncidents(linkId);
      res.json(linkIncidents);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch link incidents" });
    }
  });

  app.get("/api/hosts", requireAuth, async (req, res) => {
    try {
      const linkId = req.query.linkId ? parseInt(req.query.linkId as string, 10) : undefined;
      const clientId = getEffectiveClientId(req);
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

  app.get("/api/events", requireAuth, async (req, res) => {
    try {
      const clientId = getEffectiveClientId(req);
      const eventsList = await storage.getEvents(clientId);
      res.json(eventsList);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch events" });
    }
  });

  app.delete("/api/clients/:clientId/events", async (req, res) => {
    try {
      const clientId = parseInt(req.params.clientId, 10);
      const deletedCount = await storage.deleteAllEvents(clientId);
      res.json({ 
        success: true, 
        message: `${deletedCount} eventos removidos`,
        deletedCount 
      });
    } catch (error) {
      res.status(500).json({ error: "Erro ao limpar eventos" });
    }
  });

  app.get("/api/security/ddos", requireAuth, async (req, res) => {
    try {
      const clientId = getEffectiveClientId(req);
      const ddosList = await storage.getDDoSEvents(clientId);
      res.json(ddosList);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch DDoS events" });
    }
  });

  app.get("/api/sla", requireAuth, async (req, res) => {
    try {
      const clientId = getEffectiveClientId(req);
      const type = req.query.type as string | undefined; // "monthly" | "accumulated" | undefined
      const year = req.query.year ? parseInt(req.query.year as string, 10) : undefined;
      const month = req.query.month ? parseInt(req.query.month as string, 10) - 1 : undefined; // Convert 1-indexed to 0-indexed
      const linkId = req.query.linkId ? parseInt(req.query.linkId as string, 10) : undefined;
      
      let sla;
      if (type === "monthly") {
        sla = await storage.getSLAIndicatorsMonthly(clientId, year, month, linkId);
      } else if (type === "accumulated") {
        sla = await storage.getSLAIndicatorsAccumulated(clientId, linkId);
      } else {
        // Default: accumulated (full period)
        sla = await storage.getSLAIndicatorsAccumulated(clientId, linkId);
      }
      res.json(sla);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch SLA indicators" });
    }
  });

  app.get("/api/incidents", requireAuth, async (req, res) => {
    try {
      const open = req.query.open === "true";
      const clientId = getEffectiveClientId(req);
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
      let incident = await storage.createIncident(validatedData);
      
      await storage.updateLinkFailureState(
        validatedData.linkId,
        validatedData.failureReason || "indefinido",
        validatedData.failureSource || "manual"
      );
      
      const clientSettings = await storage.getClientSettings(validatedData.clientId);
      if (clientSettings?.voalleEnabled && clientSettings?.voalleAutoCreateTicket) {
        const eventTypeCode = mapIncidentReasonToEventType(validatedData.failureReason || "link_down");
        const eventType = await storage.getEventTypeByCode(eventTypeCode);
        const eventSetting = eventType ? await storage.getClientEventSetting(validatedData.clientId, eventType.id) : undefined;
        const shouldAutoCreate = eventSetting?.autoCreateTicket ?? true;
        
        if (shouldAutoCreate) {
          try {
            const link = await storage.getLink(validatedData.linkId);
            const client = await storage.getClient(validatedData.clientId);
            
            if (!link || !client) {
              console.warn(`Incidente ${incident.id}: Link ou cliente não encontrado, pulando criação de ticket Voalle`);
            } else if (clientSettings.voalleApiUrl && clientSettings.voalleClientId && clientSettings.voalleClientSecret && clientSettings.voalleSolicitationTypeCode) {
            const clientVoalleService = new VoalleService();
            clientVoalleService.configure({
              apiUrl: clientSettings.voalleApiUrl,
              clientId: clientSettings.voalleClientId,
              clientSecret: clientSettings.voalleClientSecret,
              synV1Token: clientSettings.voalleSynV1Token || undefined,
            });
            
            const linkName = link?.name || link?.identifier || "Link desconhecido";
            const linkLocation = link?.location || "Local não especificado";
            
            const result = await clientVoalleService.createProtocol(
              clientSettings.voalleSolicitationTypeCode,
              incident,
              linkName,
              linkLocation
            );
            
            if (result.success && result.protocolId) {
              await storage.updateIncident(incident.id, {
                erpSystem: "Voalle",
                erpTicketId: result.protocolId,
                erpTicketStatus: "aberto",
              });
              
              incident = { 
                ...incident, 
                erpSystem: "Voalle", 
                erpTicketId: result.protocolId, 
                erpTicketStatus: "aberto" 
              };
            } else {
              console.warn(`Falha ao criar ticket Voalle para incidente ${incident.id}: ${result.message}`);
            }
            }
          } catch (voalleError) {
            console.error("Erro ao criar ticket no Voalle:", voalleError);
          }
        }
      }
      
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
      const includeHistorical = req.body?.includeHistorical === true;
      const clearAll = req.body?.clearAll === true;
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

      // Se clearAll, apagar TODOS os eventos DDoS do cliente
      let deletedCount = 0;
      if (clearAll) {
        deletedCount = await storage.deleteAllDDoSEvents(clientId);
        console.log(`[Wanguard] Removidos ${deletedCount} eventos DDoS (limpeza total)`);
      } else {
        // Apenas remover eventos de demonstração (sem wanguardAnomalyId)
        deletedCount = await storage.deleteDDoSEventsWithoutWanguardId(clientId);
        if (deletedCount > 0) {
          console.log(`[Wanguard] Removidos ${deletedCount} eventos de demonstração`);
        }
      }

      // Buscar anomalias ativas
      let anomalies = await wanguardService.getActiveAnomalies();
      
      // Se solicitado, incluir também anomalias históricas
      if (includeHistorical) {
        const historicalAnomalies = await wanguardService.getHistoricalAnomalies();
        anomalies = [...anomalies, ...historicalAnomalies];
      }
      
      const links = await storage.getLinks(clientId);
      
      let createdCount = 0;
      let updatedCount = 0;
      
      for (const anomaly of anomalies) {
        // Tentar encontrar link correspondente pelo IP
        const matchingLink = links.find(link => 
          link.ipBlock && anomaly.ip?.startsWith(link.ipBlock.split("/")[0].slice(0, -1))
        );
        
        // Se não encontrar link, usar o primeiro link do cliente (para não perder o evento)
        const targetLink = matchingLink || links[0];
        
        if (targetLink) {
          const eventData = wanguardService.mapAnomalyToEvent(anomaly, clientId, targetLink.id);
          const existingEvent = await storage.getDDoSEventByWanguardId(anomaly.id);
          
          if (existingEvent) {
            // Sobrescrever evento existente com dados do Wanguard
            await storage.updateDDoSEvent(existingEvent.id, eventData);
            updatedCount++;
          } else {
            // Criar novo evento
            await storage.createDDoSEvent(eventData);
            createdCount++;
          }
        }
      }

      res.json({ 
        success: true, 
        message: `Sincronização concluída. ${createdCount} novos, ${updatedCount} atualizados, ${deletedCount} removidos.`,
        createdCount,
        updatedCount,
        deletedCount,
        totalAnomalies: anomalies.length
      });
    } catch (error) {
      console.error("Erro ao sincronizar com Wanguard:", error);
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

  // Voalle Integration Routes
  app.post("/api/clients/:clientId/voalle/test", async (req, res) => {
    try {
      const settings = await storage.getClientSettings(parseInt(req.params.clientId, 10));
      if (!settings?.voalleApiUrl || !settings?.voalleClientId || !settings?.voalleClientSecret) {
        return res.status(400).json({ 
          success: false, 
          message: "Configurações do Voalle incompletas" 
        });
      }

      const testVoalleService = new VoalleService();
      testVoalleService.configure({
        apiUrl: settings.voalleApiUrl,
        clientId: settings.voalleClientId,
        clientSecret: settings.voalleClientSecret,
        synV1Token: settings.voalleSynV1Token || undefined,
      });

      const result = await testVoalleService.testConnection();
      res.json(result);
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        message: "Erro ao testar conexão com Voalle" 
      });
    }
  });

  app.post("/api/clients/:clientId/voalle/create-ticket", async (req, res) => {
    try {
      const clientId = parseInt(req.params.clientId, 10);
      const { incidentId } = req.body;

      if (!incidentId) {
        return res.status(400).json({ error: "ID do incidente é obrigatório" });
      }

      const settings = await storage.getClientSettings(clientId);
      
      if (!settings?.voalleEnabled) {
        return res.status(400).json({ error: "Integração com Voalle não está habilitada" });
      }

      if (!settings.voalleApiUrl || !settings.voalleClientId || !settings.voalleClientSecret) {
        return res.status(400).json({ error: "Configurações do Voalle incompletas" });
      }

      if (!settings.voalleSolicitationTypeCode) {
        return res.status(400).json({ error: "Código do tipo de solicitação não configurado" });
      }

      const incident = await storage.getIncident(incidentId);
      if (!incident) {
        return res.status(404).json({ error: "Incidente não encontrado" });
      }

      const link = await storage.getLink(incident.linkId);
      if (!link) {
        return res.status(404).json({ error: "Link do incidente não encontrado" });
      }

      const ticketVoalleService = new VoalleService();
      ticketVoalleService.configure({
        apiUrl: settings.voalleApiUrl,
        clientId: settings.voalleClientId,
        clientSecret: settings.voalleClientSecret,
        synV1Token: settings.voalleSynV1Token || undefined,
      });

      const result = await ticketVoalleService.createProtocol(
        settings.voalleSolicitationTypeCode,
        incident,
        link.name,
        link.location
      );

      if (result.success && result.protocolId) {
        await storage.updateIncident(incidentId, {
          erpSystem: "Voalle",
          erpTicketId: result.protocolId,
          erpTicketStatus: "aberto",
        });
      }

      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Erro ao criar chamado no Voalle" });
    }
  });

  // Voalle Customer Search (for importing clients)
  app.get("/api/voalle/customers/search", requireSuperAdmin, async (req, res) => {
    try {
      const query = req.query.q as string;
      if (!query || query.length < 2) {
        return res.json({ customers: [] });
      }

      // Use the global ERP Integration (VoalleAdapter) which handles providerConfig correctly
      const voalleIntegration = await storage.getErpIntegrationByProvider('voalle');
      
      if (voalleIntegration && voalleIntegration.isActive) {
        console.log("[Voalle Search] Using VoalleAdapter with integration:", voalleIntegration.name);
        const adapter = configureErpAdapter(voalleIntegration);
        const customers = await adapter.searchCustomers(query);
        console.log("[Voalle Search] Found", customers.length, "customers");
        return res.json({ customers });
      }

      console.log("[Voalle Search] No active Voalle integration found");
      return res.status(400).json({ 
        error: "Voalle não configurado", 
        message: "Configure o Voalle nas Integrações ERP Globais" 
      });
    } catch (error: any) {
      console.error("[Voalle Search] Error:", error?.message || error);
      res.status(500).json({ 
        error: "Erro ao buscar clientes no Voalle",
        details: error?.message || "Erro desconhecido"
      });
    }
  });

  app.get("/api/super-admin/users", requireSuperAdmin, async (req, res) => {
    try {
      const allUsers = await storage.getUsers();
      res.json(allUsers.map(u => ({ ...u, passwordHash: undefined })));
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch all users" });
    }
  });

  app.get("/api/clients/:clientId/groups", requireClientAccess, async (req, res) => {
    try {
      const clientId = parseInt(req.params.clientId, 10);
      const groupList = await storage.getGroups(clientId);
      res.json(groupList);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch groups" });
    }
  });

  app.post("/api/clients/:clientId/groups", requireClientAccess, async (req, res) => {
    try {
      const clientId = parseInt(req.params.clientId, 10);
      const data = insertGroupSchema.parse({ ...req.body, clientId });
      const group = await storage.createGroup(data);
      res.status(201).json(group);
    } catch (error) {
      res.status(400).json({ error: "Invalid group data" });
    }
  });

  app.patch("/api/clients/:clientId/groups/:groupId", requireClientAccess, async (req, res) => {
    try {
      const groupId = parseInt(req.params.groupId, 10);
      await storage.updateGroup(groupId, req.body);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to update group" });
    }
  });

  app.delete("/api/clients/:clientId/groups/:groupId", requireClientAccess, async (req, res) => {
    try {
      const groupId = parseInt(req.params.groupId, 10);
      await storage.deleteGroup(groupId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete group" });
    }
  });

  app.get("/api/clients/:clientId/groups/:groupId/members", requireClientAccess, async (req, res) => {
    try {
      const groupId = parseInt(req.params.groupId, 10);
      const members = await storage.getGroupMembers(groupId);
      res.json(members.map(u => ({ ...u, passwordHash: undefined })));
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch group members" });
    }
  });

  app.post("/api/clients/:clientId/groups/:groupId/members", requireClientAccess, async (req, res) => {
    try {
      const groupId = parseInt(req.params.groupId, 10);
      const { userId } = req.body;
      await storage.addGroupMember(groupId, userId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to add group member" });
    }
  });

  app.delete("/api/clients/:clientId/groups/:groupId/members/:userId", requireClientAccess, async (req, res) => {
    try {
      const groupId = parseInt(req.params.groupId, 10);
      const userId = parseInt(req.params.userId, 10);
      await storage.removeGroupMember(groupId, userId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to remove group member" });
    }
  });

  app.get("/api/permissions", requireAuth, async (req, res) => {
    try {
      const permissionList = await storage.getPermissions();
      res.json(permissionList);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch permissions" });
    }
  });

  app.get("/api/clients/:clientId/groups/:groupId/permissions", requireClientAccess, async (req, res) => {
    try {
      const groupId = parseInt(req.params.groupId, 10);
      const perms = await storage.getGroupPermissions(groupId);
      res.json(perms);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch group permissions" });
    }
  });

  app.put("/api/clients/:clientId/groups/:groupId/permissions", requireClientAccess, async (req, res) => {
    try {
      const groupId = parseInt(req.params.groupId, 10);
      const { permissionIds } = req.body;
      await storage.setGroupPermissions(groupId, permissionIds);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to set group permissions" });
    }
  });

  app.get("/api/snmp-profiles", requireSuperAdmin, async (req, res) => {
    try {
      const clientList = await storage.getClients();
      const allProfiles: any[] = [];
      for (const client of clientList) {
        const profiles = await storage.getSnmpProfiles(client.id);
        allProfiles.push(...profiles);
      }
      res.json(allProfiles);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch SNMP profiles" });
    }
  });

  app.get("/api/clients/:clientId/snmp-profiles", requireClientAccess, async (req, res) => {
    try {
      const clientId = parseInt(req.params.clientId, 10);
      const profiles = await storage.getSnmpProfiles(clientId);
      res.json(profiles);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch SNMP profiles" });
    }
  });

  app.post("/api/clients/:clientId/snmp-profiles", requireClientAccess, async (req, res) => {
    try {
      const clientId = parseInt(req.params.clientId, 10);
      const data = insertSnmpProfileSchema.parse({ ...req.body, clientId });
      const profile = await storage.createSnmpProfile(data);
      res.status(201).json(profile);
    } catch (error) {
      res.status(400).json({ error: "Invalid SNMP profile data" });
    }
  });

  app.patch("/api/clients/:clientId/snmp-profiles/:profileId", requireClientAccess, async (req, res) => {
    try {
      const profileId = parseInt(req.params.profileId, 10);
      await storage.updateSnmpProfile(profileId, req.body);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to update SNMP profile" });
    }
  });

  app.delete("/api/clients/:clientId/snmp-profiles/:profileId", requireClientAccess, async (req, res) => {
    try {
      const profileId = parseInt(req.params.profileId, 10);
      await storage.deleteSnmpProfile(profileId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete SNMP profile" });
    }
  });

  app.post("/api/snmp/discover-interfaces", requireAuth, async (req, res) => {
    try {
      const { targetIp, snmpProfileId } = req.body;
      
      if (!targetIp || !snmpProfileId) {
        return res.status(400).json({ error: "IP do roteador e perfil SNMP são obrigatórios" });
      }
      
      const ipPattern = /^((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
      if (!ipPattern.test(targetIp)) {
        return res.status(400).json({ error: "Formato de IP inválido" });
      }
      
      if (typeof snmpProfileId !== 'number' || snmpProfileId <= 0) {
        return res.status(400).json({ error: "ID do perfil SNMP inválido" });
      }
      
      const profile = await storage.getSnmpProfile(snmpProfileId);
      if (!profile) {
        return res.status(404).json({ error: "Perfil SNMP não encontrado" });
      }
      
      const user = req.user;
      if (!user?.isSuperAdmin && profile.clientId !== user?.clientId) {
        return res.status(403).json({ error: "Acesso negado a este perfil SNMP" });
      }
      
      const interfaces = await discoverInterfaces(targetIp, {
        id: profile.id,
        version: profile.version,
        port: profile.port,
        community: profile.community,
        securityLevel: profile.securityLevel,
        authProtocol: profile.authProtocol,
        authPassword: profile.authPassword,
        privProtocol: profile.privProtocol,
        privPassword: profile.privPassword,
        username: profile.username,
        timeout: profile.timeout,
        retries: profile.retries,
      });
      
      res.json(interfaces);
    } catch (error: any) {
      console.error("SNMP discovery error:", error);
      const message = error?.message || "Falha ao descobrir interfaces SNMP";
      if (message.includes("Timeout") || message.includes("timeout")) {
        return res.status(504).json({ error: "Tempo esgotado ao conectar ao dispositivo SNMP" });
      }
      if (message.includes("Authentication") || message.includes("auth")) {
        return res.status(401).json({ error: "Falha de autenticação SNMP" });
      }
      res.status(500).json({ error: message });
    }
  });

  app.get("/api/clients/:clientId/snmp-profiles/:profileId/mib-configs", requireClientAccess, async (req, res) => {
    try {
      const profileId = parseInt(req.params.profileId, 10);
      const configs = await storage.getMibConfigs(profileId);
      res.json(configs);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch MIB configs" });
    }
  });

  app.post("/api/clients/:clientId/snmp-profiles/:profileId/mib-configs", requireClientAccess, async (req, res) => {
    try {
      const profileId = parseInt(req.params.profileId, 10);
      const data = insertMibConfigSchema.parse({ ...req.body, snmpProfileId: profileId });
      const config = await storage.createMibConfig(data);
      res.status(201).json(config);
    } catch (error) {
      res.status(400).json({ error: "Invalid MIB config data" });
    }
  });

  app.patch("/api/clients/:clientId/mib-configs/:configId", requireClientAccess, async (req, res) => {
    try {
      const configId = parseInt(req.params.configId, 10);
      await storage.updateMibConfig(configId, req.body);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to update MIB config" });
    }
  });

  app.delete("/api/clients/:clientId/mib-configs/:configId", requireClientAccess, async (req, res) => {
    try {
      const configId = parseInt(req.params.configId, 10);
      await storage.deleteMibConfig(configId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete MIB config" });
    }
  });

  app.get("/api/hosts/:hostId/mib-configs", requireAuth, async (req, res) => {
    try {
      const hostId = parseInt(req.params.hostId, 10);
      const host = await storage.getHost(hostId);
      if (!host) {
        return res.status(404).json({ error: "Host not found" });
      }
      if (!req.user?.isSuperAdmin && req.user?.clientId !== host.clientId) {
        return res.status(403).json({ error: "Acesso negado a este host" });
      }
      const configs = await storage.getHostMibConfigs(hostId);
      res.json(configs);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch host MIB configs" });
    }
  });

  app.put("/api/hosts/:hostId/mib-configs", requireAuth, async (req, res) => {
    try {
      const hostId = parseInt(req.params.hostId, 10);
      const host = await storage.getHost(hostId);
      if (!host) {
        return res.status(404).json({ error: "Host not found" });
      }
      if (!req.user?.isSuperAdmin && req.user?.clientId !== host.clientId) {
        return res.status(403).json({ error: "Acesso negado a este host" });
      }
      const { mibConfigIds } = req.body;
      await storage.setHostMibConfigs(hostId, mibConfigIds);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to set host MIB configs" });
    }
  });

  app.get("/api/equipment-vendors", requireAuth, async (req, res) => {
    try {
      const all = req.query.all === "true";
      const vendors = all ? await storage.getAllEquipmentVendors() : await storage.getEquipmentVendors();
      res.json(vendors);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch equipment vendors" });
    }
  });

  app.get("/api/equipment-vendors/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const vendor = await storage.getEquipmentVendor(id);
      if (!vendor) {
        return res.status(404).json({ error: "Fabricante não encontrado" });
      }
      res.json(vendor);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch equipment vendor" });
    }
  });

  app.post("/api/equipment-vendors", requireAuth, async (req, res) => {
    try {
      if (!req.user?.isSuperAdmin) {
        return res.status(403).json({ error: "Apenas super admins podem criar fabricantes" });
      }
      const data = req.body;
      const vendor = await storage.createEquipmentVendor(data);
      res.status(201).json(vendor);
    } catch (error) {
      res.status(400).json({ error: "Falha ao criar fabricante" });
    }
  });

  app.patch("/api/equipment-vendors/:id", requireAuth, async (req, res) => {
    try {
      if (!req.user?.isSuperAdmin) {
        return res.status(403).json({ error: "Apenas super admins podem editar fabricantes" });
      }
      const id = parseInt(req.params.id, 10);
      await storage.updateEquipmentVendor(id, req.body);
      const vendor = await storage.getEquipmentVendor(id);
      res.json(vendor);
    } catch (error) {
      res.status(400).json({ error: "Falha ao atualizar fabricante" });
    }
  });

  app.delete("/api/equipment-vendors/:id", requireAuth, async (req, res) => {
    try {
      if (!req.user?.isSuperAdmin) {
        return res.status(403).json({ error: "Apenas super admins podem excluir fabricantes" });
      }
      const id = parseInt(req.params.id, 10);
      await storage.deleteEquipmentVendor(id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Falha ao excluir fabricante" });
    }
  });

  app.get("/api/event-types", requireAuth, async (req, res) => {
    try {
      const types = await storage.getEventTypes();
      res.json(types);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch event types" });
    }
  });

  app.get("/api/clients/:clientId/event-settings", requireClientAccess, async (req, res) => {
    try {
      const clientId = parseInt(req.params.clientId, 10);
      const settings = await storage.getClientEventSettings(clientId);
      res.json(settings);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch event settings" });
    }
  });

  app.put("/api/clients/:clientId/event-settings/:eventTypeId", requireClientAccess, async (req, res) => {
    try {
      const clientId = parseInt(req.params.clientId, 10);
      const eventTypeId = parseInt(req.params.eventTypeId, 10);
      const data = insertClientEventSettingSchema.parse({ 
        ...req.body, 
        clientId, 
        eventTypeId 
      });
      const setting = await storage.upsertClientEventSetting(data);
      res.json(setting);
    } catch (error) {
      res.status(400).json({ error: "Invalid event setting data" });
    }
  });

  app.delete("/api/clients/:clientId/event-settings/:eventTypeId", requireClientAccess, async (req, res) => {
    try {
      const clientId = parseInt(req.params.clientId, 10);
      const eventTypeId = parseInt(req.params.eventTypeId, 10);
      await storage.deleteClientEventSetting(clientId, eventTypeId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete event setting" });
    }
  });

  app.get("/api/olts", requireAuth, async (req, res) => {
    try {
      // OLTs são recursos globais - disponíveis para todos os usuários autenticados
      const oltList = await storage.getOlts();
      res.json(oltList);
    } catch (error) {
      res.status(500).json({ error: "Falha ao buscar OLTs" });
    }
  });

  app.get("/api/olts/:id", requireAuth, async (req, res) => {
    try {
      const olt = await storage.getOlt(parseInt(req.params.id, 10));
      if (!olt) {
        return res.status(404).json({ error: "OLT não encontrada" });
      }
      // OLTs são recursos globais - sem verificação de clientId
      res.json(olt);
    } catch (error) {
      res.status(500).json({ error: "Falha ao buscar OLT" });
    }
  });

  app.post("/api/olts", requireSuperAdmin, async (req, res) => {
    try {
      const data = insertOltSchema.parse(req.body);
      const olt = await storage.createOlt(data);
      res.status(201).json(olt);
    } catch (error) {
      console.error("Error creating OLT:", error);
      res.status(400).json({ error: "Dados de OLT inválidos" });
    }
  });

  app.patch("/api/olts/:id", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const olt = await storage.updateOlt(id, req.body);
      if (!olt) {
        return res.status(404).json({ error: "OLT não encontrada" });
      }
      res.json(olt);
    } catch (error) {
      res.status(500).json({ error: "Falha ao atualizar OLT" });
    }
  });

  app.delete("/api/olts/:id", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      await storage.deleteOlt(id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Falha ao excluir OLT" });
    }
  });

  app.post("/api/olts/:id/test", requireSuperAdmin, async (req, res) => {
    try {
      const olt = await storage.getOlt(parseInt(req.params.id, 10));
      if (!olt) {
        return res.status(404).json({ error: "OLT não encontrada" });
      }
      const result = await testOltConnection(olt);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Falha ao testar conexão" });
    }
  });

  app.post("/api/olts/:id/query-alarm", requireAuth, async (req, res) => {
    try {
      const olt = await storage.getOlt(parseInt(req.params.id, 10));
      if (!olt) {
        return res.status(404).json({ error: "OLT não encontrada" });
      }
      // OLTs são recursos globais - disponível para todos os usuários autenticados
      const { onuId } = req.body;
      if (!onuId) {
        return res.status(400).json({ error: "ONU ID é obrigatório" });
      }
      const diagnosis = await queryOltAlarm(olt, onuId);
      res.json(diagnosis);
    } catch (error) {
      res.status(500).json({ error: "Falha ao consultar alarme" });
    }
  });

  // ============ ERP Integrations Routes ============

  app.get("/api/erp-integrations", requireSuperAdmin, async (req, res) => {
    try {
      const integrations = await storage.getErpIntegrations();
      res.json(integrations.map(i => ({
        ...i,
        apiClientSecret: i.apiClientSecret ? "********" : null,
        dbPassword: i.dbPassword ? "********" : null,
      })));
    } catch (error) {
      res.status(500).json({ error: "Falha ao listar integrações ERP" });
    }
  });

  app.get("/api/erp-integrations/:id", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const integration = await storage.getErpIntegration(id);
      if (!integration) {
        return res.status(404).json({ error: "Integração ERP não encontrada" });
      }
      res.json({
        ...integration,
        apiClientSecret: integration.apiClientSecret ? "********" : null,
        dbPassword: integration.dbPassword ? "********" : null,
      });
    } catch (error) {
      res.status(500).json({ error: "Falha ao buscar integração ERP" });
    }
  });

  app.post("/api/erp-integrations", requireSuperAdmin, async (req, res) => {
    try {
      const data = insertErpIntegrationSchema.parse(req.body);
      const integration = await storage.createErpIntegration(data);
      res.status(201).json(integration);
    } catch (error) {
      console.error("Error creating ERP integration:", error);
      res.status(400).json({ error: "Dados de integração ERP inválidos" });
    }
  });

  app.patch("/api/erp-integrations/:id", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const existing = await storage.getErpIntegration(id);
      if (!existing) {
        return res.status(404).json({ error: "Integração ERP não encontrada" });
      }
      
      const updateData = { ...req.body };
      if (updateData.apiClientSecret === "********") {
        delete updateData.apiClientSecret;
      }
      if (updateData.dbPassword === "********") {
        delete updateData.dbPassword;
      }
      
      const integration = await storage.updateErpIntegration(id, updateData);
      clearErpAdapter(id);
      res.json(integration);
    } catch (error) {
      res.status(500).json({ error: "Falha ao atualizar integração ERP" });
    }
  });

  app.delete("/api/erp-integrations/:id", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      await storage.deleteErpIntegration(id);
      clearErpAdapter(id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Falha ao excluir integração ERP" });
    }
  });

  app.post("/api/erp-integrations/:id/test", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const integration = await storage.getErpIntegration(id);
      if (!integration) {
        return res.status(404).json({ error: "Integração ERP não encontrada" });
      }

      const adapter = configureErpAdapter(integration);
      const result = await adapter.testConnection();
      
      await storage.updateErpIntegrationTestStatus(
        id,
        result.success ? "success" : "error",
        result.success ? undefined : result.message
      );

      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro desconhecido";
      await storage.updateErpIntegrationTestStatus(
        parseInt(req.params.id, 10),
        "error",
        message
      );
      res.status(500).json({ success: false, message });
    }
  });

  app.get("/api/erp-integrations/:id/solicitation-types", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const integration = await storage.getErpIntegration(id);
      if (!integration) {
        return res.status(404).json({ error: "Integração ERP não encontrada" });
      }

      const adapter = getErpAdapter(integration);
      const types = await adapter.getSolicitationTypes();
      res.json(types);
    } catch (error) {
      res.status(500).json({ error: "Falha ao buscar tipos de solicitação" });
    }
  });

  app.get("/api/erp-integrations/:id/customers/search", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const integration = await storage.getErpIntegration(id);
      if (!integration) {
        return res.status(404).json({ error: "Integração ERP não encontrada" });
      }

      const query = req.query.q as string || "";
      if (!query || query.length < 2) {
        return res.json([]);
      }

      const adapter = getErpAdapter(integration);
      const customers = await adapter.searchCustomers(query);
      res.json(customers);
    } catch (error) {
      res.status(500).json({ error: "Falha ao buscar clientes no ERP" });
    }
  });

  // ============ Client ERP Mappings Routes ============

  app.get("/api/erp-integrations/:id/mappings", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const mappings = await storage.getClientErpMappingsByErpIntegration(id);
      res.json(mappings);
    } catch (error) {
      res.status(500).json({ error: "Falha ao listar mapeamentos" });
    }
  });

  app.post("/api/erp-integrations/:id/mappings", requireSuperAdmin, async (req, res) => {
    try {
      const erpIntegrationId = parseInt(req.params.id, 10);
      const data = insertClientErpMappingSchema.parse({
        ...req.body,
        erpIntegrationId,
      });
      const mapping = await storage.createClientErpMapping(data);
      res.status(201).json(mapping);
    } catch (error) {
      console.error("Error creating ERP mapping:", error);
      res.status(400).json({ error: "Dados de mapeamento inválidos" });
    }
  });

  app.patch("/api/client-erp-mappings/:id", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const mapping = await storage.updateClientErpMapping(id, req.body);
      res.json(mapping);
    } catch (error) {
      res.status(500).json({ error: "Falha ao atualizar mapeamento" });
    }
  });

  app.delete("/api/client-erp-mappings/:id", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      await storage.deleteClientErpMapping(id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Falha ao excluir mapeamento" });
    }
  });

  // ERP Ticket Creation (using global ERP integration)
  app.post("/api/erp/create-ticket", requireAuth, async (req, res) => {
    try {
      const { incidentId, erpIntegrationId } = req.body;
      
      const incident = await storage.getIncident(incidentId);
      if (!incident) {
        return res.status(404).json({ error: "Incidente não encontrado" });
      }

      const link = await storage.getLink(incident.linkId!);
      if (!link) {
        return res.status(404).json({ error: "Link não encontrado" });
      }

      let integration;
      if (erpIntegrationId) {
        integration = await storage.getErpIntegration(erpIntegrationId);
      } else {
        integration = await storage.getDefaultErpIntegration();
      }

      if (!integration) {
        return res.status(400).json({ error: "Nenhuma integração ERP configurada" });
      }

      const adapter = getErpAdapter(integration);
      
      const clientMapping = await storage.getClientErpMapping(link.clientId, integration.id);

      const result = await adapter.createTicket({
        solicitationTypeCode: integration.defaultSolicitationTypeCode || "",
        incident,
        linkName: link.name,
        linkLocation: link.location,
        customerId: clientMapping?.erpCustomerId,
      });

      if (result.success && result.protocol) {
        await storage.updateIncident(incidentId, {
          erpSystem: integration.provider,
          erpTicketId: result.protocol,
          erpTicketStatus: "aberto",
        });
      }

      res.json(result);
    } catch (error) {
      console.error("Error creating ERP ticket:", error);
      res.status(500).json({ error: "Falha ao criar chamado no ERP" });
    }
  });

  return httpServer;
}

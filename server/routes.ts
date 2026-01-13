import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { wanguardService } from "./wanguard";
import { VoalleService } from "./voalle";
import { getErpAdapter, configureErpAdapter, clearErpAdapter } from "./erp";
import { discoverInterfaces, type SnmpInterface } from "./snmp";
import { queryOltAlarm, testOltConnection } from "./olt";
import { requireAuth, requireSuperAdmin, requireClientAccess, requirePermission, signToken } from "./middleware/auth";
import { encrypt, decrypt, isEncrypted } from "./crypto";
import pg from "pg";
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
  insertSnmpConcentratorSchema,
  insertErpIntegrationSchema,
  insertClientErpMappingSchema,
  type AuthUser,
  type UserRole,
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

  // Login via Portal Voalle (para clientes)
  app.post("/api/auth/voalle", async (req, res) => {
    try {
      const { username, password, clientId } = req.body;
      
      if (!username || !password) {
        return res.status(400).json({ error: "Usuário e senha são obrigatórios" });
      }
      
      // Buscar integração Voalle ativa
      const voalleIntegration = await storage.getErpIntegrationByProvider('voalle');
      if (!voalleIntegration || !voalleIntegration.isActive) {
        return res.status(400).json({ error: "Login via Portal Voalle não disponível" });
      }
      
      // Configurar adapter
      const adapter = configureErpAdapter(voalleIntegration) as any;
      
      // Validar credenciais no Portal Voalle
      const validation = await adapter.validatePortalCredentials(username, password);
      
      if (!validation.success) {
        return res.status(401).json({ 
          error: validation.message,
          canRecover: true
        });
      }
      
      // Credenciais válidas - buscar ou criar usuário no sistema
      // Primeiro, tentar encontrar cliente pelo CNPJ (username pode ser o CNPJ)
      const normalizedUsername = username.replace(/\D/g, ''); // Remove caracteres não-numéricos
      
      let client = null;
      let user = null;
      
      // Se clientId foi fornecido, buscar o cliente específico
      if (clientId) {
        client = await storage.getClient(parseInt(clientId, 10));
      } else {
        // Buscar cliente pelo CNPJ
        const allClients = await storage.getClients();
        client = allClients.find(c => c.cnpj && c.cnpj.replace(/\D/g, '') === normalizedUsername);
      }
      
      if (!client) {
        // Cliente não existe no sistema - usar dados retornados pela autenticação do Portal
        console.log(`[Auth Voalle] Cliente não encontrado localmente. Usando dados da autenticação do Portal.`);
        
        try {
          // Usar os dados retornados pela autenticação do Portal (validation.person)
          // Se a autenticação foi bem-sucedida, validation.person deveria conter os dados da pessoa
          const personData = validation.person;
          
          if (!personData || !personData.name) {
            console.log(`[Auth Voalle] Dados da pessoa não retornados pela autenticação do Portal.`);
            console.log(`[Auth Voalle] validation.person: ${JSON.stringify(personData)}`);
            return res.status(404).json({ 
              error: "Não foi possível obter seus dados. Entre em contato com a Marvitel.",
              canRecover: false
            });
          }
          
          // Criar cliente automaticamente com os dados do Portal
          const clientName = personData.name;
          const slug = clientName.toLowerCase()
            .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "");
          
          console.log(`[Auth Voalle] Criando cliente automaticamente: ${clientName} (CPF/CNPJ: ${normalizedUsername}, Portal ID: ${personData.id})`);
          
          client = await storage.createClient({
            name: clientName,
            slug: slug + "-" + Date.now().toString(36), // Adiciona timestamp para garantir unicidade
            email: null, // Portal API pode não retornar email na autenticação
            phone: null,
            cnpj: normalizedUsername, // CPF/CNPJ usado no login
            voalleCustomerId: personData.id?.toString() || null,
            voallePortalUsername: username,
            voallePortalPassword: encrypt(password),
            portalCredentialsStatus: "valid",
            portalCredentialsLastCheck: new Date(),
            isActive: true,
          });
          
          console.log(`[Auth Voalle] Cliente criado com sucesso: ID ${client.id}`);
        } catch (createError) {
          console.error("[Auth Voalle] Erro ao criar cliente automaticamente:", createError);
          return res.status(404).json({ 
            error: "Cliente não encontrado. Entre em contato com a Marvitel.",
            canRecover: false
          });
        }
      }
      
      // Atualizar credenciais do portal no cliente (armazenar criptografado)
      await storage.updateClient(client.id, {
        voallePortalUsername: username,
        voallePortalPassword: encrypt(password),
        portalCredentialsStatus: "valid",
        portalCredentialsLastCheck: new Date(),
        portalCredentialsError: null,
      });
      
      // Buscar ou criar usuário associado ao cliente
      const userEmail = `portal_${normalizedUsername}@voalle.local`;
      user = await storage.getUserByEmail(userEmail);
      
      if (!user) {
        // Criar usuário para o cliente
        const newUser = await storage.createUser({
          email: userEmail,
          passwordHash: password, // Será hashado pelo storage
          name: validation.person?.name || client.name,
          role: "user",
          clientId: client.id,
          isSuperAdmin: false,
        });
        user = newUser;
      }
      
      // Construir objeto AuthUser tipado
      const authUser: AuthUser = {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role as UserRole,
        clientId: user.clientId,
        isSuperAdmin: user.isSuperAdmin || false,
        clientName: client.name,
      };
      
      // Gerar token
      const token = signToken(authUser);
      
      (req.session as any).user = authUser;
      req.session.save((err) => {
        if (err) {
          console.error("Session save error:", err);
        }
        res.json({ user: authUser, token });
      });
      
    } catch (error) {
      console.error("[Auth Voalle] Error:", error);
      res.status(500).json({ error: "Erro ao fazer login via Portal Voalle" });
    }
  });

  // Recuperação de senha do Portal Voalle
  app.post("/api/auth/voalle/recover", async (req, res) => {
    try {
      const { username } = req.body;
      
      if (!username) {
        return res.status(400).json({ error: "CPF/CNPJ é obrigatório" });
      }
      
      // Buscar integração Voalle ativa
      const voalleIntegration = await storage.getErpIntegrationByProvider('voalle');
      if (!voalleIntegration || !voalleIntegration.isActive) {
        return res.status(400).json({ error: "Recuperação via Portal Voalle não disponível" });
      }
      
      // Configurar adapter e solicitar recuperação
      const adapter = configureErpAdapter(voalleIntegration) as any;
      const result = await adapter.requestPortalPasswordRecovery(username);
      
      if (result.success) {
        res.json({ 
          success: true, 
          message: "Um email com instruções de recuperação foi enviado para você." 
        });
      } else {
        res.status(400).json({ 
          success: false, 
          error: result.message || "Erro ao solicitar recuperação de senha" 
        });
      }
      
    } catch (error) {
      console.error("[Auth Voalle Recovery] Error:", error);
      res.status(500).json({ error: "Erro ao solicitar recuperação de senha" });
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
      // Nunca retornar senha do portal
      const safeClients = allClients.map(c => ({ ...c, voallePortalPassword: c.voallePortalPassword ? "[ENCRYPTED]" : null }));
      res.json(safeClients);
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
      // Nunca retornar senha do portal
      res.json({ ...client, voallePortalPassword: client.voallePortalPassword ? "[ENCRYPTED]" : null });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch client" });
    }
  });

  app.post("/api/clients", async (req, res) => {
    try {
      const validatedData = insertClientSchema.parse(req.body);
      
      // Criptografar senha do portal se fornecida
      if (validatedData.voallePortalPassword) {
        validatedData.voallePortalPassword = encrypt(validatedData.voallePortalPassword);
      }
      
      // Check if there's an inactive client with the same slug (soft-deleted)
      const existingClient = await storage.getClientBySlug(validatedData.slug);
      if (existingClient) {
        // Reactivate the existing client with updated data
        await storage.updateClient(existingClient.id, {
          ...validatedData,
          isActive: true,
          updatedAt: new Date(),
          portalCredentialsStatus: "unchecked",
        });
        const reactivatedClient = await storage.getClient(existingClient.id);
        console.log(`[POST /api/clients] Reactivated existing client: ${existingClient.slug}`);
        return res.status(200).json(reactivatedClient);
      }
      
      const client = await storage.createClient(validatedData);
      res.status(201).json(client);
    } catch (error) {
      console.error("[POST /api/clients] Validation error:", error);
      if (error instanceof Error) {
        res.status(400).json({ error: "Invalid client data", details: error.message });
      } else {
        res.status(400).json({ error: "Invalid client data" });
      }
    }
  });

  app.patch("/api/clients/:id", async (req, res) => {
    try {
      const updateData = { ...req.body };
      
      // Criptografar senha do portal se está sendo atualizada
      if (updateData.voallePortalPassword && !isEncrypted(updateData.voallePortalPassword)) {
        updateData.voallePortalPassword = encrypt(updateData.voallePortalPassword);
        updateData.portalCredentialsStatus = "unchecked";
      }
      
      await storage.updateClient(parseInt(req.params.id, 10), updateData);
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

  // Diagnóstico OLT para um link específico - consulta e atualiza failureReason
  app.post("/api/links/:id/olt-diagnosis", requireAuth, async (req, res) => {
    try {
      const linkId = parseInt(req.params.id, 10);
      const { allowed, link } = await validateLinkAccess(req, linkId);
      if (!allowed) {
        return res.status(403).json({ error: "Acesso negado" });
      }
      if (!link) {
        return res.status(404).json({ error: "Link não encontrado" });
      }
      
      if (!link.oltId || !link.onuId) {
        return res.json({
          alarmType: null,
          diagnosis: "Link sem OLT/ONU configurado",
          description: "Configure a OLT e ONU do link para habilitar diagnóstico",
        });
      }
      
      const olt = await storage.getOlt(link.oltId);
      if (!olt || !olt.isActive) {
        return res.json({
          alarmType: null,
          diagnosis: "OLT não disponível",
          description: "A OLT configurada não está ativa ou não foi encontrada",
        });
      }
      
      const { buildOnuDiagnosisKey } = await import("./olt");
      const diagnosisKey = buildOnuDiagnosisKey(olt, {
        onuId: link.onuId,
        slotOlt: link.slotOlt,
        portOlt: link.portOlt,
        onuSearchString: link.onuSearchString,
      });
      
      if (!diagnosisKey) {
        return res.json({
          alarmType: null,
          diagnosis: "Dados insuficientes para diagnóstico",
          description: "Verifique os campos ONU ID, Slot e Porta do link",
        });
      }
      
      const result = await queryOltAlarm(olt, diagnosisKey);
      
      // Update link's failureReason based on OLT diagnosis
      const failureReasonMap: Record<string, string> = {
        "GPON_LOSi": "rompimento_fibra",
        "GPON_LOFi": "rompimento_fibra",
        "GPON_DGi": "queda_energia",
        "GPON_SFi": "sinal_degradado",
        "GPON_SDi": "sinal_degradado",
        "GPON_DOWi": "onu_inativa",
      };
      
      const failureReasonLabels: Record<string, string> = {
        "rompimento_fibra": "Rompimento de Fibra",
        "queda_energia": "Queda de Energia",
        "sinal_degradado": "Sinal Degradado",
        "onu_inativa": "ONU Inativa",
        "olt_alarm": "Alarme OLT",
      };
      
      if (result.alarmType) {
        const failureReason = failureReasonMap[result.alarmType] || "olt_alarm";
        await storage.updateLinkFailureState(linkId, failureReason, "olt");
        
        // Update existing offline event with OLT diagnosis
        const latestEvent = await storage.getLatestUnresolvedLinkEvent(linkId, "critical");
        if (latestEvent && latestEvent.title.includes("offline")) {
          const diagnosisLabel = failureReasonLabels[failureReason] || failureReason;
          const updatedDescription = latestEvent.description.replace(
            /\| OLT:.*$/,
            `| OLT: ${diagnosisLabel}`
          );
          const finalDescription = updatedDescription.includes("| OLT:") 
            ? updatedDescription 
            : `${latestEvent.description} | OLT: ${diagnosisLabel}`;
          await storage.updateEventDescription(latestEvent.id, finalDescription);
        }
      }
      
      // Create OLT diagnosis event for audit trail
      await storage.createOltDiagnosisEvent(
        linkId,
        link.clientId,
        result.diagnosis,
        result.alarmType
      );
      
      return res.json(result);
    } catch (error) {
      console.error("Erro no diagnóstico OLT do link:", error);
      return res.status(500).json({ error: "Falha ao realizar diagnóstico OLT" });
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
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const pageSize = req.query.pageSize ? Math.min(parseInt(req.query.pageSize as string, 10), 200) : 50;
      const result = await storage.getEventsPaginated(clientId, page, pageSize);
      res.json(result);
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

  // Buscar solicitações em aberto do Voalle para um link
  app.get("/api/links/:linkId/voalle/solicitations", requireAuth, async (req, res) => {
    try {
      const linkId = parseInt(req.params.linkId, 10);
      const link = await storage.getLink(linkId);
      
      if (!link) {
        return res.status(404).json({ error: "Link não encontrado" });
      }

      // Verificar permissão de acesso ao link
      const { allowed } = await validateLinkAccess(req, linkId);
      if (!allowed) {
        return res.status(403).json({ error: "Acesso negado" });
      }

      // Buscar cliente do Link Monitor
      const client = await storage.getClient(link.clientId);
      if (!client) {
        return res.status(404).json({ error: "Cliente não encontrado" });
      }

      // Buscar integração Voalle ativa
      const voalleIntegration = await storage.getErpIntegrationByProvider('voalle');
      if (!voalleIntegration || !voalleIntegration.isActive) {
        return res.status(400).json({ 
          error: "Integração Voalle não configurada",
          solicitations: [] 
        });
      }

      // Verificar se o cliente tem ID no Voalle
      let voalleCustomerId = client.voalleCustomerId;
      
      if (!voalleCustomerId) {
        // Tentar buscar pelo mapeamento ERP
        const voalleMapping = await storage.getClientErpMapping(link.clientId, voalleIntegration.id);
        
        if (!voalleMapping) {
          return res.json({ 
            solicitations: [],
            message: "Cliente não mapeado no Voalle" 
          });
        }
        voalleCustomerId = parseInt(voalleMapping.erpCustomerId, 10) || null;
      }

      // Usar VoalleAdapter com configuração global (igual à rota de contract-tags)
      const adapter = configureErpAdapter(voalleIntegration) as any;
      
      if (!adapter || typeof adapter.getOpenSolicitations !== 'function') {
        return res.status(500).json({ 
          error: "Adapter Voalle não suporta busca de solicitações",
          solicitations: [] 
        });
      }

      // Buscar solicitações em aberto usando o adapter
      const solicitations = await adapter.getOpenSolicitations(voalleCustomerId ?? undefined);

      res.json({ 
        solicitations,
        clientName: client.name,
        voalleCustomerId 
      });
    } catch (error: any) {
      console.error("[Voalle Solicitations] Error:", error?.message || error);
      res.status(500).json({ 
        error: "Erro ao buscar solicitações no Voalle",
        details: error?.message || "Erro desconhecido",
        solicitations: [] 
      });
    }
  });

  // Buscar etiquetas de contrato (conexões) do Voalle para um cliente
  app.get("/api/clients/:clientId/voalle/contract-tags", requireAuth, async (req, res) => {
    try {
      const clientId = parseInt(req.params.clientId, 10);
      console.log(`[Voalle Contract Tags] Buscando etiquetas para cliente ${clientId}`);
      
      // Buscar cliente
      const client = await storage.getClient(clientId);
      if (!client) {
        console.log(`[Voalle Contract Tags] Cliente ${clientId} não encontrado`);
        return res.status(404).json({ error: "Cliente não encontrado", tags: [] });
      }

      console.log(`[Voalle Contract Tags] Cliente: ${client.name}, CNPJ: ${client.cnpj || 'não definido'}, VoalleCustomerId: ${client.voalleCustomerId || 'não definido'}`);

      // Buscar integração Voalle ativa usando configuração global
      const voalleIntegration = await storage.getErpIntegrationByProvider('voalle');
      if (!voalleIntegration || !voalleIntegration.isActive) {
        console.log("[Voalle Contract Tags] Integração Voalle não encontrada ou inativa");
        return res.status(400).json({ 
          error: "Integração Voalle não configurada",
          tags: [] 
        });
      }

      // Usar VoalleAdapter com configuração global
      console.log("[Voalle Contract Tags] Usando VoalleAdapter com integração:", voalleIntegration.name);
      const adapter = configureErpAdapter(voalleIntegration) as any;

      // Preparar identificadores para o adapter:
      // - Portal API usa voalleCustomerId + credenciais do portal do cliente
      // - API antiga usa CNPJ (txId)
      const voalleCustomerId = client.voalleCustomerId ? client.voalleCustomerId.toString() : null;
      const cnpj = client.cnpj ? client.cnpj.replace(/\D/g, '') : null;
      const portalUsername = client.voallePortalUsername || null;
      
      // Descriptografar senha apenas para uso interno - NUNCA logar ou retornar
      let portalPassword: string | null = null;
      try {
        portalPassword = client.voallePortalPassword ? decrypt(client.voallePortalPassword) : null;
      } catch (decryptError) {
        console.log("[Voalle Contract Tags] Erro ao descriptografar senha do portal (ignorando)");
        portalPassword = null;
      }
      
      // Log seguro - NUNCA logar senha
      console.log(`[Voalle Contract Tags] voalleCustomerId: ${voalleCustomerId || 'não definido'}, CNPJ: ${cnpj || 'não definido'}, portalUser: ${portalUsername ? 'definido' : 'não definido'}, portalPass: ${portalPassword ? '[presente]' : 'não definido'}`);
      
      if (!voalleCustomerId && !cnpj) {
        return res.json({ 
          tags: [],
          message: "Cliente não possui voalleCustomerId nem CNPJ cadastrado" 
        });
      }
      
      // Buscar etiquetas de contrato usando o adapter
      const tags = await adapter.getContractTags({ voalleCustomerId, cnpj, portalUsername, portalPassword });
      console.log(`[Voalle Contract Tags] Encontradas ${tags.length} etiquetas`);

      res.json({ 
        tags,
        clientName: client.name,
        cnpj: client.cnpj,
        voalleCustomerId: client.voalleCustomerId
      });
    } catch (error: any) {
      // Sanitizar mensagem de erro - NUNCA expor credenciais
      // Cobre múltiplos padrões: password=, senha=, secret=, token=, credenciais em JSON
      const sanitizedMessage = (error?.message || "Erro desconhecido")
        .replace(/password[=:]["']?[^\s&"']+["']?/gi, "password=[REDACTED]")
        .replace(/username[=:]["']?[^\s&"']+["']?/gi, "username=[REDACTED]")
        .replace(/senha[=:]["']?[^\s&"']+["']?/gi, "senha=[REDACTED]")
        .replace(/secret[=:]["']?[^\s&"']+["']?/gi, "secret=[REDACTED]")
        .replace(/token[=:]["']?[^\s&"']+["']?/gi, "token=[REDACTED]")
        .replace(/"password"\s*:\s*"[^"]+"/gi, '"password":"[REDACTED]"')
        .replace(/"senha"\s*:\s*"[^"]+"/gi, '"senha":"[REDACTED]"')
        .replace(/"secret"\s*:\s*"[^"]+"/gi, '"secret":"[REDACTED]"');
      console.error("[Voalle Contract Tags] Error:", sanitizedMessage);
      // Retornar erro genérico sem detalhes técnicos
      res.status(500).json({ 
        error: "Erro ao buscar etiquetas no Voalle",
        tags: [] 
      });
    }
  });

  // Buscar conexões do Voalle para preenchimento automático de links
  app.get("/api/clients/:clientId/voalle/connections", requireAuth, async (req, res) => {
    try {
      const clientId = parseInt(req.params.clientId, 10);
      const client = await storage.getClient(clientId);
      
      if (!client) {
        return res.status(404).json({ error: "Cliente não encontrado" });
      }

      // Buscar integração Voalle ativa
      const voalleIntegration = await storage.getErpIntegrationByProvider('voalle');
      if (!voalleIntegration || !voalleIntegration.isActive) {
        return res.json({ 
          connections: [],
          message: "Integração Voalle não configurada" 
        });
      }

      const adapter = configureErpAdapter(voalleIntegration) as any;
      
      // Verificar se cliente tem credenciais do portal
      const voalleCustomerId = client.voalleCustomerId ? client.voalleCustomerId.toString() : null;
      const portalUsername = client.voallePortalUsername || null;
      
      let portalPassword: string | null = null;
      try {
        portalPassword = client.voallePortalPassword ? decrypt(client.voallePortalPassword) : null;
      } catch {
        portalPassword = null;
      }
      
      if (!voalleCustomerId || !portalUsername || !portalPassword) {
        return res.json({ 
          connections: [],
          message: "Cliente não possui credenciais do portal configuradas" 
        });
      }
      
      // Buscar conexões via API Portal
      const result = await adapter.getConnections({ 
        voalleCustomerId, 
        portalUsername, 
        portalPassword 
      });
      
      if (!result.success) {
        return res.json({ 
          connections: [],
          message: result.message || "Erro ao buscar conexões" 
        });
      }

      res.json({ 
        connections: result.connections,
        clientName: client.name,
        voalleCustomerId: client.voalleCustomerId
      });
    } catch (error: any) {
      const sanitizedMessage = (error?.message || "Erro desconhecido")
        .replace(/password[=:]["']?[^\s&"']+["']?/gi, "password=[REDACTED]")
        .replace(/username[=:]["']?[^\s&"']+["']?/gi, "username=[REDACTED]");
      console.error("[Voalle Connections] Error:", sanitizedMessage);
      res.status(500).json({ 
        error: "Erro ao buscar conexões no Voalle",
        connections: [] 
      });
    }
  });

  // Health check de credenciais do portal Voalle (apenas super admin)
  app.post("/api/clients/:clientId/voalle/portal-health-check", requireSuperAdmin, async (req, res) => {
    try {
      const clientId = parseInt(req.params.clientId, 10);
      const client = await storage.getClient(clientId);
      
      if (!client) {
        return res.status(404).json({ error: "Cliente não encontrado" });
      }

      // Verificar se tem credenciais do portal configuradas
      if (!client.voallePortalUsername || !client.voallePortalPassword) {
        await storage.updateClient(clientId, {
          portalCredentialsStatus: "unconfigured",
          portalCredentialsLastCheck: new Date(),
          portalCredentialsError: "Credenciais do portal não configuradas",
        });
        return res.json({
          status: "unconfigured",
          message: "Credenciais do portal não configuradas",
          lastCheck: new Date(),
        });
      }

      // Buscar integração Voalle ativa
      const voalleIntegration = await storage.getErpIntegrationByProvider('voalle');
      if (!voalleIntegration || !voalleIntegration.isActive) {
        return res.status(400).json({
          status: "error",
          message: "Integração Voalle não configurada",
        });
      }

      // Tentar autenticar com as credenciais do portal
      const adapter = configureErpAdapter(voalleIntegration) as any;
      const voalleCustomerId = client.voalleCustomerId?.toString() || null;
      const portalPassword = decrypt(client.voallePortalPassword);

      try {
        // Tentar buscar etiquetas - se funcionar, credenciais estão OK
        const tags = await adapter.getContractTags({
          voalleCustomerId,
          cnpj: client.cnpj?.replace(/\D/g, '') || null,
          portalUsername: client.voallePortalUsername,
          portalPassword,
        });

        await storage.updateClient(clientId, {
          portalCredentialsStatus: "valid",
          portalCredentialsLastCheck: new Date(),
          portalCredentialsError: null,
        });

        res.json({
          status: "valid",
          message: `Credenciais válidas. ${tags.length} etiquetas encontradas.`,
          lastCheck: new Date(),
          tagsCount: tags.length,
        });
      } catch (authError: any) {
        const errorMessage = authError?.message || "Falha na autenticação";
        const isAuthError = errorMessage.includes("401") || 
                           errorMessage.includes("403") || 
                           errorMessage.includes("Unauthorized") ||
                           errorMessage.includes("Invalid credentials");

        await storage.updateClient(clientId, {
          portalCredentialsStatus: isAuthError ? "invalid" : "error",
          portalCredentialsLastCheck: new Date(),
          portalCredentialsError: errorMessage,
        });

        res.json({
          status: isAuthError ? "invalid" : "error",
          message: isAuthError ? "Credenciais inválidas ou expiradas" : errorMessage,
          lastCheck: new Date(),
        });
      }
    } catch (error: any) {
      console.error("[Portal Health Check] Error:", error?.message || error);
      res.status(500).json({
        status: "error",
        message: "Erro ao verificar credenciais",
        details: error?.message,
      });
    }
  });

  // Solicitar recuperação de senha do portal Voalle
  app.post("/api/clients/:clientId/voalle/portal-recovery", requireSuperAdmin, async (req, res) => {
    try {
      const clientId = parseInt(req.params.clientId, 10);
      const client = await storage.getClient(clientId);
      
      if (!client) {
        return res.status(404).json({ error: "Cliente não encontrado" });
      }

      if (!client.voallePortalUsername) {
        return res.status(400).json({
          success: false,
          message: "Cliente não possui usuário do portal configurado",
        });
      }

      // Buscar integração Voalle ativa
      const voalleIntegration = await storage.getErpIntegrationByProvider('voalle');
      if (!voalleIntegration || !voalleIntegration.isActive) {
        return res.status(400).json({
          success: false,
          message: "Integração Voalle não configurada",
        });
      }

      const adapter = configureErpAdapter(voalleIntegration) as any;
      
      if (typeof adapter.requestPortalPasswordRecovery !== 'function') {
        return res.status(400).json({
          success: false,
          message: "Adapter não suporta recuperação de senha do portal",
        });
      }

      const result = await adapter.requestPortalPasswordRecovery(client.voallePortalUsername);
      
      if (result.success) {
        console.log(`[Portal Recovery] Recuperação solicitada para cliente ${clientId}: ${client.voallePortalUsername}`);
      }
      
      res.json(result);
    } catch (error: any) {
      console.error("[Portal Recovery] Error:", error?.message || error);
      res.status(500).json({
        success: false,
        message: "Erro ao solicitar recuperação de senha",
        details: error?.message,
      });
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
      // Perfis globais (clientId = null)
      const globalProfiles = await storage.getGlobalSnmpProfiles();
      allProfiles.push(...globalProfiles);
      // Perfis por cliente
      for (const client of clientList) {
        const profiles = await storage.getSnmpProfiles(client.id);
        allProfiles.push(...profiles);
      }
      res.json(allProfiles);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch SNMP profiles" });
    }
  });

  // Criar perfil SNMP global (para concentradores)
  app.post("/api/snmp-profiles", requireSuperAdmin, async (req, res) => {
    try {
      const data = insertSnmpProfileSchema.parse({ ...req.body, clientId: null });
      const profile = await storage.createSnmpProfile(data);
      res.status(201).json(profile);
    } catch (error) {
      console.error("Error creating global SNMP profile:", error);
      res.status(400).json({ error: "Invalid SNMP profile data" });
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

  // Endpoint para buscar ID da ONU pelo serial na OLT
  app.post("/api/olts/:id/search-onu", requireAuth, async (req, res) => {
    try {
      const olt = await storage.getOlt(parseInt(req.params.id, 10));
      if (!olt) {
        return res.status(404).json({ error: "OLT não encontrada" });
      }
      const { searchString } = req.body;
      if (!searchString) {
        return res.status(400).json({ error: "String de busca é obrigatória" });
      }
      const { searchOnuBySerial } = await import("./olt");
      const result = await searchOnuBySerial(olt, searchString);
      res.json(result);
    } catch (error) {
      console.error("Erro ao buscar ONU:", error);
      res.status(500).json({ error: "Falha ao buscar ONU" });
    }
  });

  // Testar diagnóstico de ONU na OLT
  app.post("/api/olts/:id/test-diagnosis", requireAuth, async (req, res) => {
    try {
      const olt = await storage.getOlt(parseInt(req.params.id, 10));
      if (!olt) {
        return res.status(404).json({ error: "OLT não encontrada" });
      }
      const { onuId, slotOlt, portOlt, equipmentSerialNumber, linkId, updateLink } = req.body;
      if (!onuId) {
        return res.status(400).json({ error: "ID da ONU é obrigatório" });
      }
      
      const { buildOnuDiagnosisKey } = await import("./olt");
      
      // Monta a chave de diagnóstico usando os dados fornecidos
      const diagnosisKey = buildOnuDiagnosisKey(olt, {
        onuId,
        slotOlt,
        portOlt,
        onuSearchString: equipmentSerialNumber,
      });
      
      if (!diagnosisKey) {
        return res.json({
          alarmType: null,
          diagnosis: "Dados insuficientes para diagnóstico",
          description: "Verifique se os campos ONU ID, Slot e Porta estão preenchidos corretamente",
        });
      }
      
      const result = await queryOltAlarm(olt, diagnosisKey);
      
      // If linkId provided and updateLink=true, update the link's failureReason
      if (linkId && updateLink && result.alarmType) {
        const failureReasonMap: Record<string, string> = {
          "GPON_LOSi": "rompimento_fibra",
          "GPON_LOFi": "rompimento_fibra",
          "GPON_DGi": "queda_energia",
          "GPON_SFi": "sinal_degradado",
          "GPON_SDi": "sinal_degradado",
          "GPON_DOWi": "onu_inativa",
        };
        const failureReason = failureReasonMap[result.alarmType] || "olt_alarm";
        await storage.updateLinkFailureState(linkId, failureReason, "olt");
      }
      
      res.json(result);
    } catch (error) {
      console.error("Erro ao testar diagnóstico:", error);
      res.status(500).json({ error: "Falha ao testar diagnóstico" });
    }
  });

  // ============ SNMP Concentrators Routes ============

  app.get("/api/concentrators", requireAuth, async (req, res) => {
    try {
      const concentrators = await storage.getConcentrators();
      res.json(concentrators);
    } catch (error) {
      res.status(500).json({ error: "Falha ao buscar concentradores" });
    }
  });

  app.get("/api/concentrators/:id", requireAuth, async (req, res) => {
    try {
      const concentrator = await storage.getConcentrator(parseInt(req.params.id, 10));
      if (!concentrator) {
        return res.status(404).json({ error: "Concentrador não encontrado" });
      }
      res.json(concentrator);
    } catch (error) {
      res.status(500).json({ error: "Falha ao buscar concentrador" });
    }
  });

  app.post("/api/concentrators", requireSuperAdmin, async (req, res) => {
    try {
      const data = insertSnmpConcentratorSchema.parse(req.body);
      const concentrator = await storage.createConcentrator(data);
      res.status(201).json(concentrator);
    } catch (error) {
      console.error("Error creating concentrator:", error);
      res.status(400).json({ error: "Dados de concentrador inválidos" });
    }
  });

  app.patch("/api/concentrators/:id", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const concentrator = await storage.updateConcentrator(id, req.body);
      if (!concentrator) {
        return res.status(404).json({ error: "Concentrador não encontrado" });
      }
      res.json(concentrator);
    } catch (error) {
      res.status(500).json({ error: "Falha ao atualizar concentrador" });
    }
  });

  app.delete("/api/concentrators/:id", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      await storage.deleteConcentrator(id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Falha ao excluir concentrador" });
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

  // Database configuration endpoints
  app.get("/api/database/status", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const { pool } = await import("./db");
      const result = await pool.query("SELECT version(), current_database()");
      const tableResult = await pool.query(`
        SELECT count(*) as table_count 
        FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      `);
      
      const dbUrl = process.env.DATABASE_URL || "";
      let host = "localhost";
      let connectionType = "Local";
      
      try {
        const url = new URL(dbUrl);
        host = url.hostname;
        connectionType = host === "localhost" || host === "127.0.0.1" ? "Local" : "Remoto";
      } catch {}
      
      res.json({
        connected: true,
        host,
        database: result.rows[0].current_database,
        version: result.rows[0].version.split(" ")[1],
        tableCount: parseInt(tableResult.rows[0].table_count),
        connectionType,
      });
    } catch (error: any) {
      res.json({
        connected: false,
        host: "",
        database: "",
        version: "",
        tableCount: 0,
        connectionType: "",
        error: error.message,
      });
    }
  });

  app.post("/api/database/test", requireAuth, requireSuperAdmin, async (req, res) => {
    const { host, port, database, username, password, ssl } = req.body;
    
    if (!host || !database) {
      return res.status(400).json({ success: false, error: "Host e banco sao obrigatorios" });
    }
    
    const connectionString = `postgresql://${username || "postgres"}:${password || ""}@${host}:${port || 5432}/${database}${ssl ? "?sslmode=require" : ""}`;
    
    const testPool = new pg.Pool({ 
      connectionString,
      connectionTimeoutMillis: 10000,
      max: 1,
    });
    
    try {
      const client = await testPool.connect();
      const result = await client.query("SELECT version(), current_database()");
      client.release();
      await testPool.end();
      
      res.json({
        success: true,
        version: result.rows[0].version.split(" ")[1],
        database: result.rows[0].current_database,
      });
    } catch (error: any) {
      await testPool.end().catch(() => {});
      res.json({
        success: false,
        error: error.message || "Falha ao conectar",
      });
    }
  });

  app.post("/api/database/configure", requireAuth, requireSuperAdmin, async (req, res) => {
    const { host, port, database, username, password, ssl } = req.body;
    
    if (!host || !database) {
      return res.status(400).json({ success: false, error: "Host e banco sao obrigatorios" });
    }
    
    // Build the connection string
    const connectionString = `postgresql://${username || "postgres"}:${password || ""}@${host}:${port || 5432}/${database}${ssl ? "?sslmode=require" : ""}`;
    
    // Test connection first
    const testPool = new pg.Pool({ 
      connectionString,
      connectionTimeoutMillis: 10000,
      max: 1,
    });
    
    try {
      const client = await testPool.connect();
      await client.query("SELECT 1");
      client.release();
      await testPool.end();
      
      // Note: In production, this would update environment variables and trigger restart
      // For now, we just return success and advise manual configuration
      res.json({
        success: true,
        message: "Conexao validada. Para aplicar, configure DATABASE_URL nas variaveis de ambiente.",
        connectionString: connectionString.replace(password || "", "***"),
      });
    } catch (error: any) {
      await testPool.end().catch(() => {});
      res.json({
        success: false,
        error: error.message || "Falha ao conectar",
      });
    }
  });

  // ============ Monitoring Settings (Global Parameters) ============

  app.get("/api/monitoring-settings", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const settings = await storage.getMonitoringSettings();
      res.json(settings);
    } catch (error: any) {
      console.error("Error fetching monitoring settings:", error);
      res.status(500).json({ error: "Erro ao buscar configurações de monitoramento" });
    }
  });

  app.put("/api/monitoring-settings/:key", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const { key } = req.params;
      const { value, description } = req.body;
      
      if (value === undefined || value === null) {
        return res.status(400).json({ error: "Valor é obrigatório" });
      }
      
      await storage.setMonitoringSetting(key, String(value), description);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error updating monitoring setting:", error);
      res.status(500).json({ error: "Erro ao atualizar configuração" });
    }
  });

  app.post("/api/monitoring-settings/initialize", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      await storage.initializeDefaultMonitoringSettings();
      const settings = await storage.getMonitoringSettings();
      res.json(settings);
    } catch (error: any) {
      console.error("Error initializing monitoring settings:", error);
      res.status(500).json({ error: "Erro ao inicializar configurações" });
    }
  });

  // ============ System Version & Updates ============
  
  app.get("/api/system/info", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const fs = await import("fs");
      const path = await import("path");
      const { exec } = await import("child_process");
      const { promisify } = await import("util");
      const execAsync = promisify(exec);
      
      let version = "1.0.0";
      let gitCommit = "";
      let gitBranch = "";
      let lastUpdate = "";
      let githubUrl = "";
      
      // Try to read version from package.json
      try {
        const packagePath = path.join(process.cwd(), "package.json");
        if (fs.existsSync(packagePath)) {
          const pkg = JSON.parse(fs.readFileSync(packagePath, "utf-8"));
          version = pkg.version || "1.0.0";
        }
      } catch (e) {}
      
      // Try to get git info
      try {
        const { stdout: commit } = await execAsync("git rev-parse --short HEAD");
        gitCommit = commit.trim();
      } catch (e) {}
      
      try {
        const { stdout: branch } = await execAsync("git rev-parse --abbrev-ref HEAD");
        gitBranch = branch.trim();
      } catch (e) {}
      
      try {
        const { stdout: date } = await execAsync("git log -1 --format=%ci");
        lastUpdate = date.trim();
      } catch (e) {}
      
      try {
        const { stdout: remote } = await execAsync("git remote get-url origin");
        githubUrl = remote.trim();
      } catch (e) {}
      
      // Read saved github URL from settings if not from git
      const savedGithubUrl = await storage.getMonitoringSetting("github_repo_url");
      if (savedGithubUrl && !githubUrl) {
        githubUrl = savedGithubUrl;
      }
      
      res.json({
        version,
        gitCommit,
        gitBranch,
        lastUpdate,
        githubUrl: savedGithubUrl || githubUrl,
        environment: "Produção",
      });
    } catch (error: any) {
      console.error("Error fetching system info:", error);
      res.status(500).json({ error: "Erro ao buscar informações do sistema" });
    }
  });
  
  app.post("/api/system/github-url", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const { url } = req.body;
      if (!url) {
        return res.status(400).json({ error: "URL do GitHub é obrigatória" });
      }
      await storage.setMonitoringSetting("github_repo_url", url, "URL do repositório GitHub");
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error saving GitHub URL:", error);
      res.status(500).json({ error: "Erro ao salvar URL do GitHub" });
    }
  });
  
  app.post("/api/system/update", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const { exec } = await import("child_process");
      
      // Execute the update script
      const updateScript = "/opt/link-monitor/deploy/update-from-github.sh";
      const logFile = "/var/log/link-monitor-update.log";
      
      // Check if script exists
      const fs = await import("fs");
      if (!fs.existsSync(updateScript)) {
        return res.status(404).json({ 
          error: "Script de atualização não encontrado",
          details: `O arquivo ${updateScript} não existe no servidor`
        });
      }
      
      // Use setsid to create a completely new session, detached from the current process group
      // This ensures the script survives even when systemd kills the parent service
      const command = `setsid nohup sudo bash ${updateScript} > ${logFile} 2>&1 < /dev/null &`;
      
      exec(command, (error: Error | null) => {
        if (error) {
          console.error("Failed to start update script:", error);
        }
      });
      
      res.json({ 
        success: true, 
        message: "Atualização iniciada. O sistema será reiniciado em alguns instantes. Aguarde cerca de 2 minutos." 
      });
    } catch (error: any) {
      console.error("Error running update:", error);
      res.status(500).json({ error: "Erro ao executar atualização", details: error.message });
    }
  });
  
  // ============ Backups ============
  
  app.get("/api/system/backups", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const fs = await import("fs");
      const path = await import("path");
      
      const backupDir = "/opt/link-monitor-backups";
      
      if (!fs.existsSync(backupDir)) {
        return res.json({ backups: [], message: "Diretório de backups não encontrado" });
      }
      
      const files = fs.readdirSync(backupDir);
      const backups = files
        .filter(f => f.endsWith(".tar.gz") || f.endsWith(".zip") || f.endsWith(".sql") || f.endsWith(".backup"))
        .map(f => {
          const filePath = path.join(backupDir, f);
          const stats = fs.statSync(filePath);
          return {
            name: f,
            path: filePath,
            size: stats.size,
            sizeFormatted: formatBytes(stats.size),
            createdAt: stats.mtime.toISOString(),
          };
        })
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      
      res.json({ backups });
    } catch (error: any) {
      console.error("Error listing backups:", error);
      res.status(500).json({ error: "Erro ao listar backups" });
    }
  });
  
  app.post("/api/system/backups/restore", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const { backupName } = req.body;
      if (!backupName) {
        return res.status(400).json({ error: "Nome do backup é obrigatório" });
      }
      
      const fs = await import("fs");
      const path = await import("path");
      const { exec } = await import("child_process");
      const { promisify } = await import("util");
      const execAsync = promisify(exec);
      
      const backupPath = path.join("/opt/link-monitor-backups", backupName);
      
      if (!fs.existsSync(backupPath)) {
        return res.status(404).json({ error: "Arquivo de backup não encontrado" });
      }
      
      // For SQL backups, restore to database
      if (backupName.endsWith(".sql")) {
        const dbUrl = process.env.DATABASE_URL;
        if (!dbUrl) {
          return res.status(500).json({ error: "DATABASE_URL não configurada" });
        }
        
        try {
          await execAsync(`psql "${dbUrl}" < "${backupPath}"`);
          res.json({ success: true, message: "Backup SQL restaurado com sucesso" });
        } catch (e: any) {
          res.status(500).json({ error: "Erro ao restaurar backup SQL", details: e.message });
        }
      } else if (backupName.endsWith(".tar.gz")) {
        // For tar.gz, extract to the application directory
        try {
          await execAsync(`cd /opt/link-monitor && sudo tar -xzf "${backupPath}"`);
          res.json({ success: true, message: "Backup restaurado. Reinicie o serviço para aplicar." });
        } catch (e: any) {
          res.status(500).json({ error: "Erro ao restaurar backup", details: e.message });
        }
      } else {
        res.status(400).json({ error: "Tipo de backup não suportado" });
      }
    } catch (error: any) {
      console.error("Error restoring backup:", error);
      res.status(500).json({ error: "Erro ao restaurar backup", details: error.message });
    }
  });
  
  app.post("/api/system/backups/upload", requireAuth, requireSuperAdmin, async (req, res) => {
    // This would need multipart form handling - simplified for now
    res.status(501).json({ error: "Upload de backup ainda não implementado. Use o diretório /opt/link-monitor-backups diretamente." });
  });

  return httpServer;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

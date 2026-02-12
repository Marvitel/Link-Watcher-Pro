import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { wanguardService } from "./wanguard";
import { VoalleService } from "./voalle";
import { getErpAdapter, configureErpAdapter, clearErpAdapter } from "./erp";
import { discoverInterfaces, type SnmpInterface } from "./snmp";
import { queryOltAlarm, testOltConnection } from "./olt";
import { requireAuth, requireSuperAdmin, requireClientAccess, requirePermission, signToken, requireDiagnosticsAccess } from "./middleware/auth";
import { encrypt, decrypt, isEncrypted } from "./crypto";
import { logAuditEvent } from "./audit";
import pg from "pg";
import crypto from "crypto";
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
  insertCpeSchema,
  insertLinkCpeSchema,
  insertLinkTrafficInterfaceSchema,
  insertOltSchema,
  insertSwitchSchema,
  insertSnmpConcentratorSchema,
  insertErpIntegrationSchema,
  insertClientErpMappingSchema,
  insertLinkGroupSchema,
  insertLinkGroupMemberSchema,
  insertExternalIntegrationSchema,
  insertFirewallWhitelistSchema,
  insertFirewallSettingsSchema,
  links,
  blacklistChecks,
  firewallWhitelist,
  firewallSettings,
  trafficInterfaceMetrics,
  type AuthUser,
  type UserRole,
} from "@shared/schema";
import { invalidateCache, getFirewallStatus } from "./firewall";
import { db } from "./db";
import { eq, sql } from "drizzle-orm";
import { HetrixToolsAdapter, startBlacklistAutoCheck, checkBlacklistForLink } from "./hetrixtools";
import {
  getFlashmanConfigForClient,
  testFlashmanConnection,
  resolveDeviceMac,
  getDeviceByMac,
  getDeviceByMacForPolling,
  formatFlashmanDeviceInfo,
  triggerSpeedtest,
  triggerPing,
  triggerTraceroute,
  triggerReboot,
  triggerOnlineDevices,
  triggerSiteSurvey,
  triggerPonData,
  triggerBestChannel,
  sendCommand,
  getFlashmanGlobalConfig,
  syncDevice,
  getFlashboardReport,
  getDeviceWifi,
  updateWifiRadio,
  updateWifiInterface,
  setDeviceWan,
  deleteDeviceWan,
  setDeviceWans,
  getWebCredentials,
  setWebCredentials,
  getLanDnsServers,
  setLanDnsServers,
  getDeviceComments,
  setDeviceComments,
  getDeviceCustomInfo,
  setDeviceCustomInfo,
  getAppAccess,
  setAppAccessPassword,
  getDeviceVoip,
  setDeviceVoip,
  getConfigFiles,
  sendConfigFileToDevice,
  listFirmwares,
  listFirmwaresByModel,
  getWebhooks,
  getWebhookById,
  createWebhook,
  updateWebhook,
  deleteWebhook,
  getPeriodicReboot,
  setPeriodicRebootByModel,
  getPreRegisters,
  getPreRegisterById,
  setPreRegister,
  deletePreRegisters,
  getSnmpCredentials,
  createSnmpCredential,
  deleteSnmpCredentials,
  getSshCredentials,
  createSshCredential,
  deleteSshCredentials,
  getTelnetCredentials,
  createTelnetCredential,
  deleteTelnetCredentials,
  searchDevices,
  searchMeshVendorDevices,
  getDeviceHomologation,
  getFlashmanSystemConfig,
  setDeviceLanSubnet,
} from "./flashman";

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      clientId?: number;
    }
  }
}

interface ImportJobStatus {
  jobId: string;
  status: 'running' | 'completed' | 'error';
  phase: 'discovery' | 'pppoe_lookup' | 'corporate_lookup' | 'onu_discovery' | 'done';
  linksImported: number;
  linksFailed: number;
  pppoeIpsFound: number;
  corporateIpsFound: number;
  onuIdsDiscovered: number;
  pppoeTotal: number;
  pppoeCurrent: number;
  corporateTotal: number;
  corporateCurrent: number;
  onuTotal: number;
  onuCurrent: number;
  retryRound: number;
  maxRetryRounds: number;
  pppoeFailed: number;
  corporateFailed: number;
  onuFailed: number;
  errors: Array<{ serviceTag: string; error: string }>;
  startedAt: string;
  completedAt?: string;
  bgError?: string;
}

const activeImportJobs = new Map<string, ImportJobStatus>();

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

// Importa função de versão do build (calculada do hash real do index.html)
import { getBuildVersion } from "./static";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  await storage.initializeDefaultData();
  storage.startMetricCollection();

  // Registrar fetcher de configuração RADIUS DB a partir da tabela de integrações
  const { setRadiusDbConfigFetcher, resetRadiusDbPool } = await import("./radius");
  setRadiusDbConfigFetcher(async () => {
    try {
      const integrations = await storage.getExternalIntegrations();
      const radiusDb = integrations.find(i => i.provider === "radius_db" && i.isActive);
      if (!radiusDb || !radiusDb.apiUrl || !radiusDb.apiKey) return null;
      const connData = JSON.parse(radiusDb.apiUrl);
      return {
        host: connData.host,
        port: parseInt(connData.port || "5432", 10),
        database: connData.database,
        user: connData.user,
        password: radiusDb.apiKey,
      };
    } catch {
      return null;
    }
  });

  // Endpoint de versão para verificação de atualizações pelo frontend
  // IMPORTANTE: Headers anti-cache para garantir que proxies/CDN não cacheiem
  app.get("/api/version", (_req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
    res.json({
      version: getBuildVersion(),
      timestamp: Date.now(),
      message: "ok",
    });
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: "Email e senha são obrigatórios" });
      }
      
      // Primeiro verifica se o usuário existe no sistema (por email ou username RADIUS)
      // Também verifica com @radius.local para usuários criados automaticamente
      let localUser = await storage.getUserByEmailOrUsername(email);
      if (!localUser && !email.includes("@")) {
        localUser = await storage.getUserByEmailOrUsername(`${email}@radius.local`);
      }
      
      // Verifica se RADIUS está habilitado - tenta autenticação RADIUS para todos os usuários
      const radiusSettings = await storage.getRadiusSettings();
      
      if (radiusSettings && radiusSettings.isEnabled) {
        // RADIUS habilitado - tentar autenticação mesmo sem usuário local
        // Isso permite auto-criação de usuários AD/RADIUS
        try {
          const { authenticateWithFailover } = await import("./radius");
          
          console.log(`[LOGIN] Iniciando autenticação RADIUS para: ${email}`);
          console.log(`[LOGIN] RADIUS habilitado: ${radiusSettings.isEnabled}, Host: ${radiusSettings.primaryHost}:${radiusSettings.primaryPort}`);
          console.log(`[LOGIN] Fallback local: ${radiusSettings.allowLocalFallback}, Usuário local existe: ${!!localUser}`);
          
          // Para RADIUS, usar o email/username - com timeout reduzido para não atrasar login
          const radiusResult = await authenticateWithFailover({
            primaryHost: radiusSettings.primaryHost,
            primaryPort: radiusSettings.primaryPort,
            sharedSecretEncrypted: radiusSettings.sharedSecretEncrypted,
            secondaryHost: radiusSettings.secondaryHost,
            secondaryPort: radiusSettings.secondaryPort,
            secondarySecretEncrypted: radiusSettings.secondarySecretEncrypted,
            nasIdentifier: radiusSettings.nasIdentifier,
            timeout: Math.min(radiusSettings.timeout || 5000, 2000),
            retries: Math.min(radiusSettings.retries || 3, 1),
          }, email, password);
          
          console.log(`[LOGIN] Resultado RADIUS: success=${radiusResult.success}, code=${radiusResult.code}, server=${radiusResult.usedServer}`);
          console.log(`[LOGIN] Mensagem RADIUS: ${radiusResult.message}`);
          
          await storage.updateRadiusHealthStatus(
            radiusResult.code === "TIMEOUT" ? "timeout" : "online"
          );
          
          if (radiusResult.success) {
            // RADIUS autenticou com sucesso
            const radiusGroups = radiusResult.groups || [];
            let isSuperAdmin = localUser?.isSuperAdmin || false;
            let canManageSuperAdmins = false;
            let radiusGroupName: string | undefined;
            let defaultRole: UserRole = "viewer";
            
            // Verificar grupos retornados pelo RADIUS/NPS
            if (radiusGroups.length > 0) {
              console.log(`[RADIUS] Grupos retornados: ${radiusGroups.join(", ")}`);
              const groupMapping = await storage.findBestRadiusGroupMapping(radiusGroups);
              if (groupMapping) {
                isSuperAdmin = groupMapping.isSuperAdmin;
                canManageSuperAdmins = groupMapping.canManageSuperAdmins;
                radiusGroupName = groupMapping.radiusGroupName;
                defaultRole = (groupMapping.defaultRole as UserRole) || "admin";
                console.log(`[RADIUS] Mapeamento encontrado: ${groupMapping.radiusGroupName} -> superAdmin=${isSuperAdmin}, canManageSuperAdmins=${canManageSuperAdmins}, role=${defaultRole}`);
              } else {
                console.log(`[RADIUS] Nenhum mapeamento encontrado para grupos: ${radiusGroups.join(", ")}`);
                // Sem mapeamento = sem permissão de super admin
                isSuperAdmin = false;
              }
            } else {
              console.log(`[RADIUS] Nenhum grupo retornado pelo NPS`);
              // Sem grupos = sem permissão de super admin (a menos que já exista localmente)
            }
            
            // Se usuário não existe localmente e tem mapeamento de grupo, criar automaticamente
            if (!localUser && radiusGroupName) {
              console.log(`[RADIUS] Criando usuário automaticamente: ${email}`);
              
              // Extrair nome do email ou usar o próprio email
              const nameParts = email.split("@")[0].split(".");
              const displayName = nameParts.map((p: string) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
              
              const newUser = await storage.createUser({
                email: email.includes("@") ? email : `${email}@radius.local`,
                name: displayName,
                passwordHash: `RADIUS_ONLY:${crypto.randomUUID()}`, // Prefixo especial bloqueia login local
                role: defaultRole,
                clientId: null,
                isSuperAdmin,
                isActive: true,
              });
              
              localUser = newUser;
              console.log(`[RADIUS] Usuário criado com ID: ${newUser.id}, superAdmin=${isSuperAdmin}`);
              
              await logAuditEvent({
                action: "create",
                entity: "user",
                entityId: newUser.id,
                entityName: displayName,
                actor: { id: newUser.id, email: newUser.email, name: displayName, role: defaultRole, clientId: null, isSuperAdmin },
                status: "success",
                metadata: { 
                  authMethod: "radius_auto_create", 
                  radiusGroups,
                  radiusGroupName,
                  isSuperAdmin,
                },
                request: req,
              });
            } else if (!localUser && !radiusGroupName) {
              // RADIUS autenticou mas sem mapeamento de grupo - não criar usuário automaticamente
              console.log(`[RADIUS] Usuário ${email} autenticou via RADIUS mas não tem mapeamento de grupo configurado`);
              return res.status(403).json({ 
                error: "Usuário não autorizado. Contate o administrador para configurar acesso.",
                code: "NO_GROUP_MAPPING",
              });
            }
            
            // Atualizar permissões do usuário se mudaram (baseado no grupo RADIUS)
            if (localUser && radiusGroupName && localUser.isSuperAdmin !== isSuperAdmin) {
              console.log(`[RADIUS] Atualizando permissões do usuário ${localUser.id}: superAdmin ${localUser.isSuperAdmin} -> ${isSuperAdmin}`);
              await storage.updateUser(localUser.id, { isSuperAdmin });
            }
            
            const user: AuthUser = {
              id: localUser!.id,
              email: localUser!.email,
              name: localUser!.name,
              role: localUser!.role as any,
              clientId: localUser!.clientId,
              isSuperAdmin,
            };
            
            const token = signToken(user);
            
            await logAuditEvent({
              clientId: user.clientId,
              action: "login",
              entity: "user",
              entityId: user.id,
              entityName: user.name,
              actor: user,
              status: "success",
              metadata: { 
                authMethod: "radius", 
                radiusServer: radiusResult.usedServer,
                radiusGroups,
                radiusGroupName,
                canManageSuperAdmins,
              },
              request: req,
            });
            
            (req.session as any).user = user;
            (req.session as any).canManageSuperAdmins = canManageSuperAdmins;
            // Armazenar credenciais RADIUS na sessão para uso em SSH (credenciais do operador)
            (req.session as any).radiusCredentials = {
              username: email.split("@")[0], // Usar apenas o username sem domínio
              password: password, // Senha em texto plano para SSH (sessão é efêmera)
            };
            console.log(`[LOGIN] Credenciais RADIUS armazenadas na sessão para SSH (user: ${email.split("@")[0]})`);
            req.session.save((err) => {
              if (err) console.error("Session save error:", err);
              res.json({ 
                user, 
                token, 
                authMethod: "radius",
                radiusGroups,
                canManageSuperAdmins,
              });
            });
            return;
          } else if (radiusResult.code === "ACCESS_REJECT") {
            // RADIUS rejeitou credenciais - tenta fallback local se permitido
            if (radiusSettings.allowLocalFallback && localUser) {
              console.log(`[RADIUS] Access-Reject, tentando fallback local para: ${email}`);
              // Continua para autenticação local abaixo
            } else if (!localUser) {
              // Usuário não existe localmente e RADIUS rejeitou
              await logAuditEvent({
                action: "login_failed",
                entity: "user",
                actor: { id: null, email, name: email, role: "unknown" },
                status: "failure",
                errorMessage: "RADIUS: Credenciais inválidas",
                metadata: { authMethod: "radius", radiusServer: radiusResult.usedServer },
                request: req,
              });
              return res.status(401).json({ error: "Credenciais inválidas" });
            } else {
              // Sem fallback, retorna erro
              await logAuditEvent({
                action: "login_failed",
                entity: "user",
                actor: { id: null, email, name: email, role: "unknown" },
                status: "failure",
                errorMessage: "RADIUS: Credenciais inválidas",
                metadata: { authMethod: "radius", radiusServer: radiusResult.usedServer },
                request: req,
              });
              return res.status(401).json({ error: "Credenciais inválidas" });
            }
          } else if (radiusSettings.allowLocalFallback && localUser) {
            // RADIUS falhou (timeout, erro de rede), tenta fallback local
            console.log(`[RADIUS] Falha de conexão (${radiusResult.code}), tentando fallback local`);
          } else if (!localUser) {
            // Usuário não existe localmente e RADIUS falhou
            return res.status(503).json({ 
              error: "Servidor de autenticação indisponível",
              radiusError: radiusResult.message,
            });
          } else {
            // Sem fallback, retorna erro
            await logAuditEvent({
              action: "login_failed",
              entity: "user",
              actor: { id: null, email, name: email, role: "unknown" },
              status: "failure",
              errorMessage: `RADIUS indisponível: ${radiusResult.message}`,
              metadata: { authMethod: "radius", radiusCode: radiusResult.code, radiusServer: radiusResult.usedServer },
              request: req,
            });
            return res.status(503).json({ 
              error: "Servidor de autenticação indisponível",
              radiusError: radiusResult.message,
            });
          }
        } catch (radiusError) {
          console.error("[RADIUS] Exception during auth:", radiusError);
          if (!radiusSettings.allowLocalFallback || !localUser) {
            return res.status(503).json({ error: "Erro no servidor de autenticação" });
          }
          // Continua para fallback local
        }
      }
      
      // Autenticação local (fallback ou usuário não-super-admin)
      const user = await storage.validateCredentials(email, password);
      if (!user) {
        await logAuditEvent({
          action: "login_failed",
          entity: "user",
          actor: { id: null, email, name: email, role: "unknown" },
          status: "failure",
          errorMessage: "Credenciais inválidas",
          metadata: { authMethod: "local" },
          request: req,
        });
        return res.status(401).json({ error: "Credenciais inválidas" });
      }
      
      const token = signToken(user);
      
      await logAuditEvent({
        clientId: user.clientId,
        action: "login",
        entity: "user",
        entityId: user.id,
        entityName: user.name,
        actor: user,
        status: "success",
        metadata: { authMethod: "local" },
        request: req,
      });
      
      (req.session as any).user = user;
      req.session.save((err) => {
        if (err) {
          console.error("Session save error:", err);
        }
        res.json({ user, token, authMethod: "local" });
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

  app.post("/api/clients", requireAuth, requireSuperAdmin, async (req, res) => {
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
        
        await logAuditEvent({
          clientId: existingClient.id,
          action: "update",
          entity: "client",
          entityId: existingClient.id,
          entityName: reactivatedClient?.name,
          actor: req.user!,
          previous: existingClient as unknown as Record<string, unknown>,
          current: reactivatedClient as unknown as Record<string, unknown>,
          metadata: { reactivated: true },
          request: req,
        });
        
        console.log(`[POST /api/clients] Reactivated existing client: ${existingClient.slug}`);
        return res.status(200).json(reactivatedClient);
      }
      
      const client = await storage.createClient(validatedData);
      
      await logAuditEvent({
        clientId: client.id,
        action: "create",
        entity: "client",
        entityId: client.id,
        entityName: client.name,
        actor: req.user!,
        current: client as unknown as Record<string, unknown>,
        request: req,
      });
      
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

  app.patch("/api/clients/:id", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const clientId = parseInt(req.params.id, 10);
      const previousClient = await storage.getClient(clientId);
      const updateData = { ...req.body };
      
      // Criptografar senha do portal se está sendo atualizada
      if (updateData.voallePortalPassword && !isEncrypted(updateData.voallePortalPassword)) {
        updateData.voallePortalPassword = encrypt(updateData.voallePortalPassword);
        updateData.portalCredentialsStatus = "unchecked";
      }
      
      await storage.updateClient(clientId, updateData);
      const updatedClient = await storage.getClient(clientId);
      
      await logAuditEvent({
        clientId,
        action: "update",
        entity: "client",
        entityId: clientId,
        entityName: updatedClient?.name || previousClient?.name,
        actor: req.user!,
        previous: previousClient as unknown as Record<string, unknown>,
        current: updatedClient as unknown as Record<string, unknown>,
        request: req,
      });
      
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to update client" });
    }
  });

  app.delete("/api/clients/:id", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const clientId = parseInt(req.params.id, 10);
      const previousClient = await storage.getClient(clientId);
      
      await storage.deleteClient(clientId);
      
      await logAuditEvent({
        clientId,
        action: "delete",
        entity: "client",
        entityId: clientId,
        entityName: previousClient?.name,
        actor: req.user!,
        previous: previousClient as unknown as Record<string, unknown>,
        request: req,
      });
      
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
      
      await logAuditEvent({
        clientId: user.clientId,
        action: "create",
        entity: "user",
        entityId: user.id,
        entityName: user.name,
        actor: req.user!,
        current: { ...user, passwordHash: undefined } as unknown as Record<string, unknown>,
        request: req,
      });
      
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
      
      const userId = parseInt(req.params.id, 10);
      const previousUser = await storage.getUser(userId);
      
      const { password, ...updateData } = req.body;
      const hasPasswordChange = !!password;
      if (password) {
        updateData.passwordHash = password;
      }
      
      await storage.updateUser(userId, updateData);
      const updatedUser = await storage.getUser(userId);
      
      await logAuditEvent({
        clientId: updatedUser?.clientId || previousUser?.clientId,
        action: hasPasswordChange ? "password_change" : "update",
        entity: "user",
        entityId: userId,
        entityName: updatedUser?.name || previousUser?.name,
        actor: req.user!,
        previous: previousUser ? { ...previousUser, passwordHash: undefined } as unknown as Record<string, unknown> : null,
        current: updatedUser ? { ...updatedUser, passwordHash: undefined } as unknown as Record<string, unknown> : null,
        request: req,
      });
      
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
      
      const userId = parseInt(req.params.id, 10);
      const previousUser = await storage.getUser(userId);
      
      await storage.deleteUser(userId);
      
      await logAuditEvent({
        clientId: previousUser?.clientId,
        action: "delete",
        entity: "user",
        entityId: userId,
        entityName: previousUser?.name,
        actor: req.user!,
        previous: previousUser ? { ...previousUser, passwordHash: undefined } as unknown as Record<string, unknown> : null,
        request: req,
      });
      
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
      
      // Forçar mainGraphMode='primary' na criação (interfaces são adicionadas depois)
      validatedData.mainGraphMode = 'primary';
      validatedData.mainGraphInterfaceIds = [];
      
      const link = await storage.createLink(validatedData);
      
      await logAuditEvent({
        clientId: link.clientId,
        action: "create",
        entity: "link",
        entityId: link.id,
        entityName: link.name,
        actor: user!,
        current: link as unknown as Record<string, unknown>,
        request: req,
      });
      
      checkBlacklistForLink(link, storage).catch((err) => {
        console.error(`[BlacklistCheck] Error checking new link ${link.id}:`, err);
      });
      
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
      
      const knownLinkFields = new Set(Object.keys(links).filter(k => k !== 'getSQL' && k !== '_' && k !== '$inferInsert' && k !== '$inferSelect'));
      const linkColumns = new Set([
        'clientId', 'identifier', 'name', 'location', 'address', 'ipBlock', 'totalIps', 'usableIps',
        'bandwidth', 'monitoringEnabled', 'icmpInterval', 'monitoredIp', 'monitoredIp2', 'gateway',
        'snmpCommunity', 'snmpVersion', 'snmpPort', 'snmpTimeout', 'status', 'linkType',
        'bandwidthIn', 'bandwidthOut', 'bandwidthInOctets', 'bandwidthOutOctets', 'latency',
        'packetLoss', 'jitter', 'oltId', 'switchId', 'slotOlt', 'portOlt', 'onuId',
        'vlanId', 'concentratorId', 'cpuUsage', 'memoryUsage', 'failureReason', 'failureSource',
        'trafficSourceType', 'trafficSourceIp', 'trafficIfIndex', 'interfaceName', 'serviceTag',
        'profileId', 'invertBandwidthDirection', 'authType', 'authInterface', 'authUsername',
        'lastUpdated', 'equipmentSerialNumber', 'opticalRxBaseline', 'opticalTxBaseline',
        'mainGraphMode', 'mainGraphInterfaceIds',
      ]);
      const filteredBody: Record<string, any> = {};
      for (const [key, value] of Object.entries(req.body)) {
        if (linkColumns.has(key)) {
          filteredBody[key] = value;
        }
      }

      // Validar mainGraphMode e mainGraphInterfaceIds
      if (filteredBody.mainGraphMode) {
        if (filteredBody.mainGraphMode === 'primary') {
          filteredBody.mainGraphInterfaceIds = [];
        } else if ((filteredBody.mainGraphMode === 'single' || filteredBody.mainGraphMode === 'aggregate')) {
          const interfaceIds = filteredBody.mainGraphInterfaceIds || [];
          if (!Array.isArray(interfaceIds) || interfaceIds.length === 0) {
            return res.status(400).json({ 
              error: `Modo "${filteredBody.mainGraphMode}" requer pelo menos uma interface selecionada` 
            });
          }
        }
      }
      
      const previousLink = await storage.getLink(linkId);
      await storage.updateLink(linkId, filteredBody);
      const updatedLink = await storage.getLink(linkId);
      
      // Check if IP block was changed or removed - clear blacklist checks
      const oldIpBlock = previousLink?.ipBlock?.trim() || '';
      const newIpBlock = updatedLink?.ipBlock?.trim() || '';
      
      if (oldIpBlock !== newIpBlock) {
        // IP block changed - delete old blacklist checks and resolve blacklist events
        await db.delete(blacklistChecks).where(eq(blacklistChecks.linkId, linkId));
        await storage.resolveBlacklistEvents(linkId);
        console.log(`[Link] IP block changed for link ${linkId}: "${oldIpBlock}" -> "${newIpBlock}", cleared blacklist checks and resolved events`);
        
        // If link was degraded due to blacklist, reset to operational
        if (updatedLink?.status === 'degraded' && updatedLink?.failureSource === 'blacklist') {
          await db.update(links).set({
            status: 'operational',
            failureReason: null,
            failureSource: null
          }).where(eq(links.id, linkId));
          console.log(`[Link] Reset link ${linkId} status from blacklist-degraded to operational`);
        }
        
        // If new IP block is not empty, trigger blacklist check for new IPs
        if (newIpBlock && updatedLink) {
          checkBlacklistForLink(updatedLink, storage).catch((err) => {
            console.error(`[BlacklistCheck] Error checking updated link ${linkId}:`, err);
          });
        }
      }
      
      await logAuditEvent({
        clientId: previousLink?.clientId,
        action: "update",
        entity: "link",
        entityId: linkId,
        entityName: updatedLink?.name || previousLink?.name,
        actor: req.user!,
        previous: previousLink as unknown as Record<string, unknown>,
        current: updatedLink as unknown as Record<string, unknown>,
        request: req,
      });
      
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
      
      const previousLink = await storage.getLink(linkId);
      await storage.deleteLink(linkId);
      
      await logAuditEvent({
        clientId: previousLink?.clientId,
        action: "delete",
        entity: "link",
        entityId: linkId,
        entityName: previousLink?.name,
        actor: req.user!,
        previous: previousLink as unknown as Record<string, unknown>,
        request: req,
      });
      
      res.json({ success: true });
    } catch (error) {
      console.error("[API] Error deleting link:", error);
      res.status(500).json({ error: "Erro ao excluir link", details: error instanceof Error ? error.message : String(error) });
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
      
      // Suporte a paginação
      const page = parseInt(req.query.page as string) || 1;
      const pageSize = Math.min(parseInt(req.query.pageSize as string) || 50, 200);
      const offset = (page - 1) * pageSize;
      
      const { events: eventsList, total } = await storage.getLinkEventsPaginated(linkId, pageSize, offset);
      res.json({ events: eventsList, total, page, pageSize });
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

  // Obter status da porta do switch para links PTP/L2
  app.get("/api/links/:id/port-status", requireAuth, async (req, res) => {
    try {
      const linkId = parseInt(req.params.id, 10);
      const { allowed, link } = await validateLinkAccess(req, linkId);
      if (!allowed || !link) {
        return res.status(404).json({ error: "Link not found" });
      }

      // Importar funções SNMP
      const { getInterfaceOperStatus, findInterfaceByName } = await import("./snmp");
      
      // Determinar fonte de status da porta
      let portStatusSource: { ip: string; profileId: number; ifIndex: number; sourceName: string; portName?: string } | null = null;
      
      const isPtp = link.linkType === 'ptp';
      const isL2 = (link as any).isL2Link === true;
      
      // Para links PTP: usar switch + switchPort (nome da porta física do SFP)
      // Isso evita usar a VLAN que sempre mostra UP
      if (isPtp && link.switchId && link.switchPort) {
        const sw = await storage.getSwitch(link.switchId);
        if (sw && sw.snmpProfileId) {
          // Descobrir o ifIndex da porta física pelo nome
          const profile = await storage.getSnmpProfile(sw.snmpProfileId);
          if (profile) {
            const interfaceSearch = await findInterfaceByName(sw.ipAddress, profile, link.switchPort);
            if (interfaceSearch.found && interfaceSearch.ifIndex) {
              portStatusSource = {
                ip: sw.ipAddress,
                profileId: sw.snmpProfileId,
                ifIndex: interfaceSearch.ifIndex,
                sourceName: `${sw.name} - ${link.switchPort}`,
                portName: link.switchPort
              };
            } else {
              // Fallback: tentar usando switchPortNumber se disponível
              if (link.switchPortNumber) {
                portStatusSource = {
                  ip: sw.ipAddress,
                  profileId: sw.snmpProfileId,
                  ifIndex: link.switchPortNumber,
                  sourceName: `${sw.name} - Porta ${link.switchPortNumber}`,
                  portName: link.switchPort
                };
              }
            }
          }
        }
      }
      // Para links L2 via ponto de acesso
      else if (isL2 && link.trafficSourceType === 'accessPoint' && link.accessPointId && link.accessPointInterfaceIndex) {
        const accessSwitch = await storage.getSwitch(link.accessPointId);
        if (accessSwitch && accessSwitch.snmpProfileId) {
          portStatusSource = {
            ip: accessSwitch.ipAddress,
            profileId: accessSwitch.snmpProfileId,
            ifIndex: link.accessPointInterfaceIndex,
            sourceName: `${accessSwitch.name} (Ponto de Acesso)`
          };
        }
      }
      // Para links L2 via switch de acesso
      else if (isL2 && link.switchId && link.snmpInterfaceIndex) {
        const sw = await storage.getSwitch(link.switchId);
        if (sw && sw.snmpProfileId) {
          portStatusSource = {
            ip: sw.ipAddress,
            profileId: sw.snmpProfileId,
            ifIndex: link.snmpInterfaceIndex,
            sourceName: `${sw.name} (Switch)`
          };
        }
      }
      
      if (!portStatusSource) {
        return res.json({
          available: false,
          message: isPtp 
            ? "Switch ou porta física (switchPort) não configurado para este link PTP"
            : "Switch ou ponto de acesso não configurado para este link"
        });
      }
      
      // Buscar perfil SNMP
      const profile = await storage.getSnmpProfile(portStatusSource.profileId);
      if (!profile) {
        return res.json({
          available: false,
          message: "Perfil SNMP não encontrado"
        });
      }
      
      // Coletar status da porta via SNMP
      const portStatus = await getInterfaceOperStatus(
        portStatusSource.ip,
        profile,
        portStatusSource.ifIndex
      );
      
      if (!portStatus) {
        return res.json({
          available: false,
          message: "Falha ao coletar status SNMP"
        });
      }
      
      res.json({
        available: true,
        operStatus: portStatus.operStatus,
        adminStatus: portStatus.adminStatus,
        ifIndex: portStatusSource.ifIndex,
        sourceName: portStatusSource.sourceName,
        sourceIp: portStatusSource.ip,
        portName: portStatusSource.portName
      });
    } catch (error) {
      console.error("Error fetching port status:", error);
      res.status(500).json({ error: "Falha ao obter status da porta" });
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

  // Endpoint de ping para diagnóstico (Super Admin only)
  app.post("/api/links/:id/tools/ping", requireAuth, async (req, res) => {
    try {
      const user = req.user as any;
      if (!user?.isSuperAdmin) {
        return res.status(403).json({ error: "Acesso restrito a Super Admin" });
      }
      
      const linkId = parseInt(req.params.id, 10);
      const { target } = req.body; // 'olt', 'concentrator', 'cpe'
      
      const { allowed, link } = await validateLinkAccess(req, linkId);
      if (!allowed || !link) {
        return res.status(404).json({ error: "Link não encontrado" });
      }
      
      let ipAddress: string | null = null;
      let deviceName = "";
      
      if (target === "olt" && link.oltId) {
        const olt = await storage.getOlt(link.oltId);
        ipAddress = olt?.ipAddress || null;
        deviceName = olt?.name || "OLT";
      } else if (target === "switch" && link.switchId) {
        const switchDevice = await storage.getSwitch(link.switchId);
        ipAddress = switchDevice?.ipAddress || null;
        deviceName = switchDevice?.name || "Switch";
      } else if (target === "concentrator") {
        ipAddress = link.snmpRouterIp || null;
        deviceName = "Concentrador";
      } else if (target === "cpe") {
        ipAddress = link.monitoredIp || link.address;
        deviceName = "CPE Cliente";
      }
      
      if (!ipAddress) {
        return res.json({ success: false, error: `IP não configurado para ${deviceName || target}` });
      }
      
      const { pingHost } = await import("./monitoring");
      const result = await pingHost(ipAddress, 5);
      
      return res.json({
        success: true,
        target,
        deviceName,
        ipAddress,
        latency: result.latency.toFixed(2),
        packetLoss: result.packetLoss.toFixed(1),
        reachable: result.success,
      });
    } catch (error) {
      console.error("Erro no ping de diagnóstico:", error);
      return res.status(500).json({ error: "Falha ao executar ping" });
    }
  });

  // Endpoint de traceroute para diagnóstico (Super Admin only)
  app.post("/api/links/:id/tools/traceroute", requireAuth, async (req, res) => {
    try {
      const user = req.user as any;
      if (!user?.isSuperAdmin) {
        return res.status(403).json({ error: "Acesso restrito a Super Admin" });
      }
      
      const linkId = parseInt(req.params.id, 10);
      const { target } = req.body;
      
      const { allowed, link } = await validateLinkAccess(req, linkId);
      if (!allowed || !link) {
        return res.status(404).json({ error: "Link não encontrado" });
      }
      
      let ipAddress: string | null = null;
      let deviceName = "";
      
      if (target === "olt" && link.oltId) {
        const olt = await storage.getOlt(link.oltId);
        ipAddress = olt?.ipAddress || null;
        deviceName = olt?.name || "OLT";
      } else if (target === "switch" && link.switchId) {
        const switchDevice = await storage.getSwitch(link.switchId);
        ipAddress = switchDevice?.ipAddress || null;
        deviceName = switchDevice?.name || "Switch";
      } else if (target === "concentrator") {
        ipAddress = link.snmpRouterIp || null;
        deviceName = "Concentrador";
      } else if (target === "cpe") {
        ipAddress = link.monitoredIp || link.address;
        deviceName = "CPE Cliente";
      }
      
      if (!ipAddress) {
        return res.json({ success: false, error: `IP não configurado para ${deviceName || target}` });
      }
      
      const { exec } = await import("child_process");
      const { promisify } = await import("util");
      const execAsync = promisify(exec);
      
      // Detectar IPv6
      const isV6 = ipAddress.includes(':') && !ipAddress.match(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d+$/);
      const traceCmd = isV6 ? 'traceroute6' : 'traceroute';
      
      try {
        const { stdout } = await execAsync(`${traceCmd} -n -w 2 -m 20 ${ipAddress} 2>&1`, {
          timeout: 60000,
        });
        
        const hops = stdout.split('\n')
          .filter(line => line.match(/^\s*\d+/))
          .map(line => {
            const match = line.match(/^\s*(\d+)\s+(.+)$/);
            if (match) {
              return { hop: parseInt(match[1]), data: match[2].trim() };
            }
            return null;
          })
          .filter(Boolean);
        
        return res.json({
          success: true,
          target,
          deviceName,
          ipAddress,
          hops,
          raw: stdout,
        });
      } catch (traceError: any) {
        return res.json({
          success: false,
          error: traceError.message || "Timeout no traceroute",
          raw: traceError.stdout || "",
        });
      }
    } catch (error) {
      console.error("Erro no traceroute de diagnóstico:", error);
      return res.status(500).json({ error: "Falha ao executar traceroute" });
    }
  });

  // Endpoint para executar comandos no terminal (Super Admin only)
  app.post("/api/links/:id/tools/terminal", requireAuth, async (req, res) => {
    try {
      const user = req.user as any;
      if (!user?.isSuperAdmin) {
        return res.status(403).json({ error: "Acesso restrito a Super Admin" });
      }
      
      const linkId = parseInt(req.params.id, 10);
      const { command } = req.body;
      
      if (!command || typeof command !== 'string') {
        return res.status(400).json({ error: "Comando não especificado" });
      }
      
      const { allowed, link } = await validateLinkAccess(req, linkId);
      if (!allowed || !link) {
        return res.status(404).json({ error: "Link não encontrado" });
      }
      
      // Lista de comandos bloqueados por segurança (podem danificar o sistema)
      const blockedCommands = ['rm', 'rmdir', 'mkfs', 'dd', 'shutdown', 'reboot', 'poweroff', 'halt', 'init', 'systemctl', 'kill', 'killall', 'pkill'];
      const cmdParts = command.trim().split(/\s+/);
      const baseCmd = cmdParts[0].toLowerCase().replace(/^.*\//, ''); // Remove path prefix
      
      if (blockedCommands.includes(baseCmd)) {
        return res.json({
          success: false,
          output: `Comando bloqueado por segurança: ${baseCmd}`,
        });
      }
      
      const { exec } = await import("child_process");
      const { promisify } = await import("util");
      const execAsync = promisify(exec);
      
      // Timeout de 60 segundos para qualquer comando
      const timeout = 60000;
      
      try {
        const { stdout, stderr } = await execAsync(command, { timeout });
        const output = stdout + (stderr ? `\n${stderr}` : '');
        
        return res.json({
          success: true,
          output: output || '(sem saída)',
          command,
        });
      } catch (execError: any) {
        return res.json({
          success: false,
          output: execError.stdout || execError.stderr || execError.message || 'Erro ao executar comando',
          command,
        });
      }
    } catch (error) {
      console.error("Erro no terminal:", error);
      return res.status(500).json({ error: "Falha ao executar comando" });
    }
  });

  // Endpoint para obter IPs dos dispositivos do link (Super Admin only)
  app.get("/api/links/:id/tools/devices", requireAuth, async (req, res) => {
    try {
      const user = req.user as any;
      if (!user?.isSuperAdmin) {
        return res.status(403).json({ error: "Acesso restrito a Super Admin" });
      }
      
      const linkId = parseInt(req.params.id, 10);
      const { allowed, link } = await validateLinkAccess(req, linkId);
      if (!allowed || !link) {
        return res.status(404).json({ error: "Link não encontrado" });
      }
      
      // Verificar configurações RADIUS para dispositivos
      const radiusSettings = await storage.getRadiusSettings();
      const useRadiusForDevices = radiusSettings?.isEnabled && radiusSettings?.useRadiusForDevices;
      const radiusCredentials = (req.session as any)?.radiusCredentials;
      
      let olt = null;
      if (link.oltId) {
        olt = await storage.getOlt(link.oltId);
      }
      
      // Buscar switch para links PTP
      let switchDevice = null;
      if (link.switchId) {
        switchDevice = await storage.getSwitch(link.switchId);
      }
      
      // Buscar concentrador se configurado
      let concentrator = null;
      if (link.concentratorId) {
        concentrator = await storage.getConcentrator(link.concentratorId);
      }
      
      // Credenciais locais do dispositivo (concentrador) - usadas como fallback
      const localConcentratorUser = concentrator?.sshUser || "admin";
      const localConcentratorPassword = concentrator?.sshPassword ? decrypt(concentrator.sshPassword) : null;
      
      // Credenciais a usar (podem ser RADIUS ou locais)
      let concentratorSshUser = localConcentratorUser;
      let concentratorSshPassword = localConcentratorPassword;
      let usingRadiusCredentials = false;
      
      console.log(`[Devices] Concentrador: id=${concentrator?.id}, name=${concentrator?.name}, sshUser=${concentrator?.sshUser}`);
      console.log(`[Devices] User logado: id=${user?.id}, name=${user?.name}`);
      console.log(`[Devices] Credenciais RADIUS na sessão: ${radiusCredentials ? `user=${radiusCredentials.username}` : 'não disponível'}`);
      console.log(`[Devices] useRadiusForDevices: ${useRadiusForDevices}`);
      
      // Se useRadiusForDevices está ativo E há credenciais RADIUS na sessão, usar RADIUS como primário
      // As credenciais locais do dispositivo serão passadas como fallback
      if (useRadiusForDevices && radiusCredentials?.username && radiusCredentials?.password) {
        concentratorSshUser = radiusCredentials.username;
        concentratorSshPassword = radiusCredentials.password;
        usingRadiusCredentials = true;
        console.log(`[Devices] USANDO credenciais RADIUS (useRadiusForDevices=true): ${concentratorSshUser}`);
      } else if (concentrator?.useOperatorCredentials) {
        // Fallback: usar credenciais do operador se useOperatorCredentials estiver ativo no concentrador
        if (radiusCredentials?.username && radiusCredentials?.password) {
          concentratorSshUser = radiusCredentials.username;
          concentratorSshPassword = radiusCredentials.password;
          usingRadiusCredentials = true;
          console.log(`[Devices] USANDO credenciais RADIUS (useOperatorCredentials=true): ${concentratorSshUser}`);
        } else if (user?.id) {
          const operatorUser = await storage.getUser(user.id);
          if (operatorUser?.sshUser) {
            concentratorSshUser = operatorUser.sshUser;
            concentratorSshPassword = operatorUser.sshPassword ? decrypt(operatorUser.sshPassword) : null;
            console.log(`[Devices] USANDO credenciais SSH do operador: ${concentratorSshUser}`);
          }
        }
      } else {
        console.log(`[Devices] Usando credenciais locais do concentrador`);
      }
      
      // Buscar CPEs associados ao link
      const linkCpeAssociations = await storage.getLinkCpes(linkId);
      console.log(`[Devices] Link ${linkId}: encontrados ${linkCpeAssociations.length} CPEs associados`);
      
      // Buscar fabricantes para incluir nome no retorno
      const allVendors = await storage.getEquipmentVendors();
      const vendorsMap = new Map(allVendors.map(v => [v.id, v]));
      
      const cpes = linkCpeAssociations.map((assoc: any) => {
        const cpe = assoc.cpe;
        if (!cpe) return null;
        // Decrypt SSH password only if encrypted
        let decryptedSshPassword = null;
        if (cpe.sshPassword) {
          try {
            decryptedSshPassword = isEncrypted(cpe.sshPassword) ? decrypt(cpe.sshPassword) : cpe.sshPassword;
            // Log para debug (mostrando primeiros/últimos caracteres da senha)
            const masked = decryptedSshPassword ? `${decryptedSshPassword.slice(0,2)}***${decryptedSshPassword.slice(-2)}` : 'null';
            console.log(`[Devices] CPE ${cpe.id} (${cpe.name}): sshUser=${cpe.sshUser}, sshPassword=${masked}`);
          } catch (e) {
            console.error(`Failed to decrypt SSH password for CPE ${cpe.id}:`, e);
          }
        } else {
          console.log(`[Devices] CPE ${cpe.id} (${cpe.name}): sem senha SSH cadastrada`);
        }
        // IP efetivo: usa ipOverride se disponível, senão ipAddress do CPE
        const effectiveIp = assoc.ipOverride || cpe.ipAddress;
        // Buscar nome do fabricante
        const vendor = cpe.vendorId ? vendorsMap.get(cpe.vendorId) : null;
        
        // Para CPEs padrão, usar métricas da associação (link_cpes); caso contrário, usar do CPE
        const useAssocMetrics = cpe.isStandard && assoc.lastMonitoredAt;
        const cpuUsage = useAssocMetrics ? assoc.cpuUsage : cpe.cpuUsage;
        const memoryUsage = useAssocMetrics ? assoc.memoryUsage : cpe.memoryUsage;
        const lastMonitoredAt = useAssocMetrics ? assoc.lastMonitoredAt : cpe.lastMonitoredAt;
        
        // Se useRadiusForDevices ativo e há credenciais RADIUS, usar RADIUS; senão usar credenciais do CPE
        const cpeSshUser = (useRadiusForDevices && radiusCredentials?.username) 
          ? radiusCredentials.username 
          : (cpe.sshUser || "admin");
        const cpeSshPassword = (useRadiusForDevices && radiusCredentials?.password) 
          ? radiusCredentials.password 
          : decryptedSshPassword;
        const cpeUsingRadius = !!(useRadiusForDevices && radiusCredentials?.username);
        
        return {
          id: cpe.id,
          cpeId: cpe.id, // Alias para uso no frontend
          linkCpeId: assoc.id,
          name: cpe.name,
          type: cpe.type,
          ip: effectiveIp,
          available: !!effectiveIp && cpe.hasAccess,
          isStandard: cpe.isStandard || false,
          model: cpe.model,
          manufacturer: vendor?.name || null,
          macAddress: assoc.macAddress || null,
          role: assoc.role || "primary",
          ipOverride: assoc.ipOverride || null,
          showInEquipmentTab: assoc.showInEquipmentTab || false,
          sshUser: cpeSshUser,
          sshPassword: cpeSshPassword,
          sshPort: cpe.sshPort || 22,
          webPort: cpe.webPort || 80,
          webProtocol: cpe.webProtocol || "http",
          winboxPort: cpe.winboxPort || 8291,
          hasAccess: cpe.hasAccess,
          cpuUsage: lastMonitoredAt ? (cpuUsage ?? null) : null,
          memoryUsage: lastMonitoredAt ? (memoryUsage ?? null) : null,
          lastMonitoredAt: lastMonitoredAt?.toISOString() || null,
          usingRadiusCredentials: cpeUsingRadius,
          // Credenciais de fallback (locais do CPE)
          fallbackSshUser: cpeUsingRadius ? (cpe.sshUser || "admin") : undefined,
          fallbackSshPassword: cpeUsingRadius ? decryptedSshPassword : undefined,
        };
      }).filter(Boolean);

      // Manter compatibilidade: pegar o CPE marcado para exibição na aba equipamento ou o primeiro
      const primaryCpe = cpes.find((c: any) => c.showInEquipmentTab) || cpes.find((c: any) => c.role === "primary") || cpes[0] || null;

      const devices = {
        olt: olt ? {
          name: olt.name,
          ip: olt.ipAddress,
          available: !!olt.ipAddress,
          // Se useRadiusForDevices ativo e há credenciais RADIUS, usar RADIUS; senão usar credenciais da OLT
          sshUser: (useRadiusForDevices && radiusCredentials?.username) ? radiusCredentials.username : (olt.username || "admin"),
          sshPassword: (useRadiusForDevices && radiusCredentials?.password) ? radiusCredentials.password : (olt.password ? (isEncrypted(olt.password) ? decrypt(olt.password) : olt.password) : null),
          sshPort: olt.port || 22,
          webPort: 80,
          webProtocol: "http",
          winboxPort: (olt as any).winboxPort || 8291,
          vendor: olt.vendor || null,
          usingRadiusCredentials: !!(useRadiusForDevices && radiusCredentials?.username),
          // Credenciais de fallback (locais da OLT)
          fallbackSshUser: (useRadiusForDevices && radiusCredentials?.username) ? (olt.username || "admin") : undefined,
          fallbackSshPassword: (useRadiusForDevices && radiusCredentials?.password) ? (olt.password ? (isEncrypted(olt.password) ? decrypt(olt.password) : olt.password) : null) : undefined,
        } : null,
        switch: switchDevice ? {
          name: switchDevice.name,
          ip: switchDevice.ipAddress,
          available: !!switchDevice.ipAddress,
          // Se useRadiusForDevices ativo e há credenciais RADIUS, usar RADIUS; senão usar credenciais do switch
          sshUser: (useRadiusForDevices && radiusCredentials?.username) ? radiusCredentials.username : (switchDevice.sshUser || "admin"),
          sshPassword: (useRadiusForDevices && radiusCredentials?.password) ? radiusCredentials.password : (switchDevice.sshPassword ? decrypt(switchDevice.sshPassword) : null),
          sshPort: switchDevice.sshPort || 22,
          webPort: switchDevice.webPort || 80,
          webProtocol: switchDevice.webProtocol || "http",
          winboxPort: (switchDevice as any).winboxPort || 8291,
          vendor: switchDevice.vendor || null,
          model: switchDevice.model || null,
          usingRadiusCredentials: !!(useRadiusForDevices && radiusCredentials?.username),
          // Credenciais de fallback (locais do switch)
          fallbackSshUser: (useRadiusForDevices && radiusCredentials?.username) ? (switchDevice.sshUser || "admin") : undefined,
          fallbackSshPassword: (useRadiusForDevices && radiusCredentials?.password) ? (switchDevice.sshPassword ? decrypt(switchDevice.sshPassword) : null) : undefined,
        } : null,
        concentrator: {
          name: concentrator?.name || "Concentrador",
          ip: concentrator?.ipAddress || link.snmpRouterIp,
          available: !!(concentrator?.ipAddress || link.snmpRouterIp),
          sshUser: concentratorSshUser,
          sshPassword: concentratorSshPassword,
          sshPort: (concentrator as any)?.sshPort || 22,
          webPort: (concentrator as any)?.webPort || 80,
          webProtocol: (concentrator as any)?.webProtocol || "http",
          winboxPort: concentrator?.winboxPort || 8291,
          vendor: concentrator?.vendor || null,
          usingRadiusCredentials: usingRadiusCredentials,
          // Credenciais de fallback: usadas quando autenticação RADIUS falha
          fallbackSshUser: usingRadiusCredentials ? localConcentratorUser : undefined,
          fallbackSshPassword: usingRadiusCredentials ? localConcentratorPassword : undefined,
        } as any,
        
        // Debug: mostrar credenciais de fallback do concentrador
        _debug_concentrator_fallback: {
          usingRadius: usingRadiusCredentials,
          hasFallbackUser: !!(usingRadiusCredentials && localConcentratorUser),
          hasFallbackPassword: !!(usingRadiusCredentials && localConcentratorPassword),
        },
        cpe: primaryCpe || {
          name: link.name,
          ip: link.monitoredIp || link.address,
          available: !!(link.monitoredIp || link.address),
          sshUser: (link as any).cpeUser || "admin",
          sshPassword: (link as any).cpePassword || null,
          sshPort: (link as any).cpeSshPort || 22,
          webPort: (link as any).cpeWebPort || 80,
          webProtocol: (link as any).cpeWebProtocol || "http",
          winboxPort: (link as any).cpeWinboxPort || 8291,
          vendor: (link as any).cpeVendor || null,
        },
        cpes: cpes, // Lista completa de CPEs associados
        // Configurações de autenticação RADIUS para dispositivos
        radiusAuth: useRadiusForDevices ? {
          enabled: true,
          hasCredentials: !!radiusCredentials?.username,
          username: radiusCredentials?.username || null,
          // Senha é passada apenas se disponível na sessão (login via RADIUS)
          password: radiusCredentials?.password || null,
        } : {
          enabled: false,
          hasCredentials: false,
          username: null,
          password: null,
        },
      };
      
      return res.json(devices);
    } catch (error) {
      console.error("Erro ao buscar dispositivos:", error);
      return res.status(500).json({ error: "Falha ao buscar dispositivos" });
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

  // ==================== Link Groups CRUD ====================
  
  // Get all link groups for a client
  app.get("/api/link-groups", requireAuth, async (req, res) => {
    try {
      const clientId = getEffectiveClientId(req);
      const groups = await storage.getLinkGroups(clientId);
      
      // Enrich with members
      const groupsWithMembers = await Promise.all(groups.map(async (group) => {
        const members = await storage.getLinkGroupMembers(group.id);
        return { ...group, members };
      }));
      
      res.json(groupsWithMembers);
    } catch (error) {
      console.error("Erro ao buscar grupos de links:", error);
      res.status(500).json({ error: "Falha ao buscar grupos de links" });
    }
  });

  // Get single link group with members
  app.get("/api/link-groups/:id", requireAuth, async (req, res) => {
    try {
      const groupId = parseInt(req.params.id, 10);
      const group = await storage.getLinkGroup(groupId);
      if (!group) {
        return res.status(404).json({ error: "Grupo não encontrado" });
      }
      
      // Verify client access
      const clientId = getEffectiveClientId(req);
      if (clientId && group.clientId !== clientId) {
        return res.status(403).json({ error: "Acesso negado" });
      }
      
      // Get members with link details
      const members = await storage.getLinkGroupMembers(groupId);
      res.json({ ...group, members });
    } catch (error) {
      console.error("Erro ao buscar grupo de links:", error);
      res.status(500).json({ error: "Falha ao buscar grupo de links" });
    }
  });

  // Create link group
  app.post("/api/link-groups", requireAuth, async (req, res) => {
    try {
      // Super admin can specify clientId in body, regular users use their own clientId
      let clientId = getEffectiveClientId(req);
      if (req.user?.isSuperAdmin && req.body.clientId) {
        clientId = parseInt(req.body.clientId, 10);
      }
      if (!clientId) {
        return res.status(400).json({ error: "Cliente não identificado" });
      }
      
      const { members, ...groupData } = req.body;
      const validatedData = insertLinkGroupSchema.parse({ ...groupData, clientId });
      const group = await storage.createLinkGroup(validatedData);
      
      // Add members if provided
      if (members && Array.isArray(members)) {
        for (const member of members) {
          await storage.addLinkGroupMember({
            groupId: group.id,
            linkId: member.linkId,
            role: member.role || "member",
            displayOrder: member.displayOrder || 0,
          });
        }
      }
      
      const groupWithMembers = await storage.getLinkGroup(group.id);
      const membersList = await storage.getLinkGroupMembers(group.id);
      res.status(201).json({ ...groupWithMembers, members: membersList });
    } catch (error) {
      console.error("Erro ao criar grupo de links:", error);
      res.status(400).json({ error: "Dados de grupo inválidos" });
    }
  });

  // Update link group
  app.patch("/api/link-groups/:id", requireAuth, async (req, res) => {
    try {
      const groupId = parseInt(req.params.id, 10);
      const group = await storage.getLinkGroup(groupId);
      if (!group) {
        return res.status(404).json({ error: "Grupo não encontrado" });
      }
      
      const clientId = getEffectiveClientId(req);
      if (clientId && group.clientId !== clientId) {
        return res.status(403).json({ error: "Acesso negado" });
      }
      
      const { members, ...groupData } = req.body;
      console.log("[LinkGroups] Updating group", groupId, "with members:", JSON.stringify(members));
      await storage.updateLinkGroup(groupId, groupData);
      
      // Update members if provided
      if (members && Array.isArray(members) && members.length > 0) {
        // Remove existing members
        await storage.clearLinkGroupMembers(groupId);
        console.log("[LinkGroups] Cleared existing members, adding", members.length, "new members");
        // Add new members
        for (const member of members) {
          console.log("[LinkGroups] Adding member:", member);
          await storage.addLinkGroupMember({
            groupId,
            linkId: member.linkId,
            role: member.role || "member",
            displayOrder: member.displayOrder || 0,
          });
        }
      }
      
      const updatedGroup = await storage.getLinkGroup(groupId);
      const membersList = await storage.getLinkGroupMembers(groupId);
      res.json({ ...updatedGroup, members: membersList });
    } catch (error) {
      console.error("Erro ao atualizar grupo de links:", error);
      res.status(500).json({ error: "Falha ao atualizar grupo de links" });
    }
  });

  // Delete link group
  app.delete("/api/link-groups/:id", requireAuth, async (req, res) => {
    try {
      const groupId = parseInt(req.params.id, 10);
      const group = await storage.getLinkGroup(groupId);
      if (!group) {
        return res.status(404).json({ error: "Grupo não encontrado" });
      }
      
      const clientId = getEffectiveClientId(req);
      if (clientId && group.clientId !== clientId) {
        return res.status(403).json({ error: "Acesso negado" });
      }
      
      await storage.deleteLinkGroup(groupId);
      res.json({ success: true });
    } catch (error) {
      console.error("Erro ao deletar grupo de links:", error);
      res.status(500).json({ error: "Falha ao deletar grupo de links" });
    }
  });

  // Get aggregated metrics for a link group
  app.get("/api/link-groups/:id/metrics", requireAuth, async (req, res) => {
    try {
      const groupId = parseInt(req.params.id, 10);
      const group = await storage.getLinkGroup(groupId);
      if (!group) {
        return res.status(404).json({ error: "Grupo não encontrado" });
      }
      
      const clientId = getEffectiveClientId(req);
      if (clientId && group.clientId !== clientId) {
        return res.status(403).json({ error: "Acesso negado" });
      }
      
      const period = req.query.period as string || "24h";
      const metricsHistory = await storage.getLinkGroupMetrics(groupId, period);
      
      // Get current member status
      const members = await storage.getLinkGroupMembers(groupId);
      const membersTotal = members.length;
      const membersOnline = members.filter(m => m.link?.status === "operational").length;
      
      // Calculate current aggregated values from member's current data (always fresh)
      let download = 0, upload = 0, latency = 0, packetLoss = 0, status = "unknown";
      
      // For cards, always use current member data for real-time values
      // Note: currentDownload/currentUpload are already inverted in the database (monitor inverts by default)
      // So we need to swap them again to show correctly: download shows upload values, upload shows download values
      if (group.groupType === "aggregation") {
        // Aggregation: sum bandwidth from all members
        for (const m of members) {
          if (m.link) {
            // Invert: currentDownload is actually upload data, currentUpload is actually download data
            download += m.link.currentUpload || 0;
            upload += m.link.currentDownload || 0;
          }
        }
        const onlineMembers = members.filter(m => m.link?.status === "operational");
        if (onlineMembers.length > 0) {
          latency = onlineMembers.reduce((sum, m) => sum + (m.link?.latency || 0), 0) / onlineMembers.length;
          packetLoss = Math.max(...onlineMembers.map(m => m.link?.packetLoss || 0));
        }
        status = membersOnline === membersTotal ? "operational" : (membersOnline > 0 ? "degraded" : "offline");
      } else if (group.groupType === "shared") {
        // Shared: bandwidth from primary (contracted), traffic sum for analysis, status degraded if any offline
        // Sum actual traffic from all members (for distribution analysis)
        for (const m of members) {
          if (m.link) {
            download += m.link.currentUpload || 0;
            upload += m.link.currentDownload || 0;
          }
        }
        const onlineMembers = members.filter(m => m.link?.status === "operational");
        if (onlineMembers.length > 0) {
          latency = onlineMembers.reduce((sum, m) => sum + (m.link?.latency || 0), 0) / onlineMembers.length;
          packetLoss = Math.max(...onlineMembers.map(m => m.link?.packetLoss || 0));
        }
        // Status: degraded if any member offline, operational only if all online
        status = membersOnline === membersTotal ? "operational" : (membersOnline > 0 ? "degraded" : "offline");
      } else {
        // Redundancy: use primary or best available
        const primaryMember = members.find(m => m.role === "primary" && m.link?.status === "operational");
        const activeMember = primaryMember || members.find(m => m.link?.status === "operational");
        if (activeMember?.link) {
          // Invert: currentDownload is actually upload data, currentUpload is actually download data
          download = activeMember.link.currentUpload || 0;
          upload = activeMember.link.currentDownload || 0;
          latency = activeMember.link.latency || 0;
          packetLoss = activeMember.link.packetLoss || 0;
        }
        status = membersOnline > 0 ? "operational" : "offline";
      }
      
      // Fallback to metricsHistory only if no current data
      if (download === 0 && upload === 0 && metricsHistory.length > 0) {
        const latest = metricsHistory[metricsHistory.length - 1];
        download = latest.download;
        upload = latest.upload;
        latency = latest.latency;
        packetLoss = latest.packetLoss;
        status = latest.status;
      }
      
      res.json({
        download,
        upload,
        latency,
        packetLoss,
        status,
        membersOnline,
        membersTotal,
        metricsHistory,
      });
    } catch (error) {
      console.error("Erro ao buscar métricas do grupo:", error);
      res.status(500).json({ error: "Falha ao buscar métricas do grupo" });
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

  app.get("/api/clients/:clientId/wanguard/mitigated-prefixes", async (req, res) => {
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

      const prefixes = await wanguardService.getMitigatedPrefixes();
      res.json(prefixes);
    } catch (error) {
      console.error("Erro ao buscar prefixos mitigados:", error);
      res.status(500).json({ error: "Erro ao buscar prefixos mitigados do Wanguard" });
    }
  });

  app.get("/api/links/:linkId/mitigation-status", requireAuth, async (req, res) => {
    try {
      const linkId = parseInt(req.params.linkId, 10);
      const { allowed, link } = await validateLinkAccess(req, linkId);
      if (!allowed || !link) {
        return res.status(404).json({ error: "Link not found" });
      }

      const settings = await storage.getClientSettings(link.clientId);
      if (!settings?.wanguardEnabled || !settings.wanguardApiEndpoint) {
        return res.json({ 
          isMitigated: false, 
          mitigationInfo: null,
          message: "Wanguard não configurado" 
        });
      }

      wanguardService.configure({
        endpoint: settings.wanguardApiEndpoint,
        user: settings.wanguardApiUser || "",
        password: settings.wanguardApiPassword || "",
      });

      const prefixes = await wanguardService.getMitigatedPrefixes();
      
      const linkIp = link.ipBlock?.split("/")[0];
      const linkNetwork = link.ipBlock;
      
      const matchingMitigation = prefixes.find(p => {
        const prefixNetwork = p.prefix;
        if (linkNetwork && prefixNetwork === linkNetwork) return true;
        if (linkIp && p.prefix.includes(linkIp)) return true;
        const prefixBase = p.prefix.split("/")[0];
        if (linkIp && prefixBase === linkIp) return true;
        return false;
      });

      res.json({
        isMitigated: !!matchingMitigation,
        mitigationInfo: matchingMitigation || null,
        linkIp: linkNetwork,
      });
    } catch (error) {
      console.error("Erro ao verificar status de mitigação:", error);
      res.status(500).json({ error: "Erro ao verificar status de mitigação" });
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
      const allSolicitations = await adapter.getOpenSolicitations(voalleCustomerId ?? undefined);

      // Filtrar solicitações pelo serviceTag do link, se configurado
      let solicitations = allSolicitations;
      let filterApplied = false;
      
      if (link.voalleContractTagServiceTag) {
        const linkServiceTag = link.voalleContractTagServiceTag.toLowerCase().trim();
        
        // Filtrar por serviceTag ou connectionId
        solicitations = allSolicitations.filter((s: { contractServiceTag?: string; connectionId?: number; subject?: string }) => {
          // Match por serviceTag
          if (s.contractServiceTag) {
            return s.contractServiceTag.toLowerCase().trim() === linkServiceTag;
          }
          // Match por connectionId se o link tiver voalleConnectionId
          if (link.voalleConnectionId && s.connectionId) {
            return s.connectionId === link.voalleConnectionId;
          }
          // Match por texto no título (fallback: busca pelo serviceTag no título)
          if (s.subject) {
            return s.subject.toLowerCase().includes(linkServiceTag);
          }
          return false;
        });
        
        filterApplied = true;
        console.log(`[Voalle Solicitations] Filtro aplicado: ${allSolicitations.length} total -> ${solicitations.length} para link ${link.name} (serviceTag: ${link.voalleContractTagServiceTag})`);
      }

      res.json({ 
        solicitations,
        allSolicitations: filterApplied ? allSolicitations : undefined,
        filterApplied,
        filterCriteria: link.voalleContractTagServiceTag || null,
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

  // Comparar dados do link local com dados da conexão Voalle
  app.get("/api/links/:linkId/voalle-compare", requireAuth, async (req, res) => {
    try {
      const linkId = parseInt(req.params.linkId, 10);
      const link = await storage.getLink(linkId);
      if (!link) {
        return res.status(404).json({ error: "Link não encontrado" });
      }

      if (!link.voalleConnectionId && !link.voalleContractTagServiceTag && !link.voalleContractTagId) {
        return res.json({ available: false, message: "Link não possui ID de conexão nem etiqueta Voalle" });
      }

      const client = await storage.getClient(link.clientId);
      if (!client) {
        return res.json({ available: false, message: "Cliente não encontrado" });
      }

      const voalleIntegration = await storage.getErpIntegrationByProvider('voalle');
      if (!voalleIntegration || !voalleIntegration.isActive) {
        return res.json({ available: false, message: "Integração Voalle não configurada" });
      }

      const adapter = configureErpAdapter(voalleIntegration) as any;

      const voalleCustomerId = client.voalleCustomerId ? client.voalleCustomerId.toString() : null;
      const portalUsername = client.voallePortalUsername || null;
      let portalPassword: string | null = null;
      try {
        portalPassword = client.voallePortalPassword ? decrypt(client.voallePortalPassword) : null;
      } catch {
        portalPassword = null;
      }

      if (!voalleCustomerId || !portalUsername || !portalPassword) {
        return res.json({ available: false, message: "Cliente não possui credenciais do portal Voalle configuradas" });
      }

      const result = await adapter.getConnections({ voalleCustomerId, portalUsername, portalPassword });
      if (!result.success || !result.connections?.length) {
        return res.json({ available: false, message: result.message || "Não foi possível buscar conexões do Voalle" });
      }

      let voalleConn: any = null;
      if (link.voalleConnectionId) {
        voalleConn = result.connections.find((c: any) => c.id === link.voalleConnectionId);
      }
      if (!voalleConn && link.voalleContractTagServiceTag) {
        voalleConn = result.connections.find((c: any) => c.contractServiceTag?.serviceTag === link.voalleContractTagServiceTag);
        if (voalleConn && !link.voalleConnectionId) {
          await storage.updateLink(linkId, { voalleConnectionId: voalleConn.id });
          console.log(`[Voalle Compare] Link ${linkId}: voalleConnectionId descoberto via etiqueta: ${voalleConn.id}`);
        }
      }
      if (!voalleConn && link.voalleContractTagId) {
        voalleConn = result.connections.find((c: any) => c.contractServiceTag?.id === link.voalleContractTagId);
        if (voalleConn) {
          const updates: Record<string, any> = { voalleConnectionId: voalleConn.id };
          if (voalleConn.contractServiceTag?.serviceTag) {
            updates.voalleContractTagServiceTag = voalleConn.contractServiceTag.serviceTag;
          }
          await storage.updateLink(linkId, updates);
          console.log(`[Voalle Compare] Link ${linkId}: voalleConnectionId descoberto via contractTagId ${link.voalleContractTagId}: ${voalleConn.id}`);
        }
      }
      if (!voalleConn) {
        return res.json({ available: false, message: `Conexão não encontrada no Voalle (ID: ${link.voalleConnectionId || 'N/A'}, Tag: ${link.voalleContractTagServiceTag || 'N/A'}, TagId: ${link.voalleContractTagId || 'N/A'})` });
      }

      const divergences: Array<{ field: string; label: string; local: any; voalle: any }> = [];
      const allFields: Array<{ field: string; label: string; local: any; voalle: any; match: boolean }> = [];

      const compare = (field: string, label: string, localVal: any, voalleVal: any) => {
        const l = localVal === undefined || localVal === null || localVal === '' ? null : String(localVal).trim();
        const v = voalleVal === undefined || voalleVal === null || voalleVal === '' ? null : String(voalleVal).trim();
        const isMatch = l === v;
        allFields.push({ field, label, local: localVal ?? null, voalle: voalleVal ?? null, match: isMatch });
        if (!isMatch) {
          divergences.push({ field, label, local: localVal ?? null, voalle: voalleVal ?? null });
        }
      };

      compare('slotOlt', 'Slot OLT', link.slotOlt, voalleConn.slotOlt);
      compare('portOlt', 'Porta OLT', link.portOlt, voalleConn.portOlt);
      compare('equipmentSerialNumber', 'Serial Equipamento', link.equipmentSerialNumber, voalleConn.equipmentSerialNumber);
      
      if (voalleConn.contractServiceTag) {
        compare('voalleContractTagServiceTag', 'Etiqueta (Service Tag)', link.voalleContractTagServiceTag, voalleConn.contractServiceTag.serviceTag);
      }

      {
        const voalleSplitter = voalleConn.authenticationSplitter;
        const localSplitterName = link.ozmapSplitterName || link.zabbixSplitterName || null;
        const voalleSplitterName = voalleSplitter?.title || null;
        const localSplitterPort = link.ozmapSplitterPort || link.zabbixSplitterPort || (link.voalleSplitterPort !== null && link.voalleSplitterPort !== undefined ? String(link.voalleSplitterPort) : null);
        const voalleSplitterPort = voalleSplitter?.port !== null && voalleSplitter?.port !== undefined ? String(voalleSplitter.port) : null;
        
        const splitterNameMatch = !voalleSplitterName || (localSplitterName?.trim().toLowerCase() === voalleSplitterName?.trim().toLowerCase());
        allFields.push({ field: 'splitterName', label: 'Splitter', local: localSplitterName, voalle: voalleSplitterName, match: splitterNameMatch });
        if (!splitterNameMatch) {
          divergences.push({ field: 'splitterName', label: 'Splitter', local: localSplitterName, voalle: voalleSplitterName });
        }

        const splitterPortMatch = !voalleSplitterPort || (localSplitterPort?.trim() === voalleSplitterPort?.trim());
        allFields.push({ field: 'splitterPort', label: 'Porta Splitter', local: localSplitterPort, voalle: voalleSplitterPort, match: splitterPortMatch });
        if (!splitterPortMatch) {
          divergences.push({ field: 'splitterPort', label: 'Porta Splitter', local: localSplitterPort, voalle: voalleSplitterPort });
        }
      }

      {
        const voalleApId = voalleConn.authenticationAccessPoint?.id || null;
        const voalleApTitle = voalleConn.authenticationAccessPoint?.title || null;
        if (voalleApId) {
          if (link.voalleAccessPointId !== voalleApId) {
            await storage.updateLink(linkId, { voalleAccessPointId: voalleApId });
          }
        }
        let localOltName: string | null = null;
        let voalleMatchesLocal = false;
        if (link.oltId) {
          const olt = await storage.getOlt(link.oltId);
          if (olt) {
            localOltName = olt.name;
            const oltVoalleIds = (olt as any).voalleIds;
            if (oltVoalleIds) {
              voalleMatchesLocal = oltVoalleIds.split(',').map((s: string) => parseInt(s.trim(), 10)).includes(voalleApId);
            }
          }
        }
        if (!link.oltId && link.switchId) {
          const sw = await storage.getSwitch(link.switchId);
          if (sw) {
            localOltName = sw.name;
            const swVoalleIds = (sw as any).voalleIds;
            if (swVoalleIds) {
              voalleMatchesLocal = swVoalleIds.split(',').map((s: string) => parseInt(s.trim(), 10)).includes(voalleApId);
            }
          }
        }
        const localDisplay = localOltName || '(nenhuma OLT vinculada)';
        const voalleDisplay = voalleApId ? `${voalleApTitle || 'Ponto de Acesso'} (ID: ${voalleApId})` : '(vazio)';
        allFields.push({ 
          field: 'voalleAccessPointId', 
          label: 'Ponto de Acesso (OLT)', 
          local: localDisplay, 
          voalle: voalleDisplay, 
          match: voalleMatchesLocal || !voalleApId 
        });
        if (!voalleMatchesLocal && voalleApId) {
          divergences.push({
            field: 'voalleAccessPointId',
            label: 'Ponto de Acesso (OLT)',
            local: localDisplay,
            voalle: voalleDisplay,
          });
        }
      }

      if (voalleConn.ipAuthentication) {
        compare('monitoredIp', 'IP Monitorado', link.monitoredIp, voalleConn.ipAuthentication.ip);
      }
      
      if (voalleConn.peopleAddress) {
        const addr = voalleConn.peopleAddress;
        let streetPart = addr.street || '';
        if (addr.streetType && streetPart && !streetPart.toLowerCase().startsWith(addr.streetType.toLowerCase())) {
          streetPart = `${addr.streetType} ${streetPart}`;
        }
        const voalleAddr = [streetPart, addr.number, addr.neighborhood].filter(Boolean).join(', ');
        compare('address', 'Endereço', link.address, voalleAddr);
      }

      if (voalleConn.authenticationConcentrator) {
        const concName = voalleConn.authenticationConcentrator.title || voalleConn.authenticationConcentrator.name;
        allFields.push({ field: 'concentrator', label: 'Concentrador', local: null, voalle: concName || null, match: true });
      }
      if (voalleConn.serviceProduct) {
        allFields.push({ field: 'serviceProduct', label: 'Produto/Serviço', local: null, voalle: voalleConn.serviceProduct.title || null, match: true });
      }
      if (voalleConn.contract) {
        allFields.push({ field: 'contractId', label: 'Contrato', local: null, voalle: `#${voalleConn.contract.id}` || null, match: true });
      }

      const ozmapDivergences: Array<{ field: string; label: string; local: any; ozmap: any }> = [];
      if (link.ozmapSplitterName || link.ozmapSplitterPort || link.ozmapSlot !== null || link.ozmapPort !== null) {
        const compareOzmap = (field: string, label: string, localVal: any, ozmapVal: any) => {
          const l = localVal === undefined || localVal === null || localVal === '' ? null : String(localVal).trim();
          const o = ozmapVal === undefined || ozmapVal === null || ozmapVal === '' ? null : String(ozmapVal).trim();
          if (l !== o && o !== null) {
            ozmapDivergences.push({ field, label, local: localVal ?? null, ozmap: ozmapVal ?? null });
          }
        };
        compareOzmap('slotOlt', 'Slot OLT (OZmap)', link.slotOlt, link.ozmapSlot);
        compareOzmap('portOlt', 'Porta OLT (OZmap)', link.portOlt, link.ozmapPort);
        compareOzmap('ozmapSplitterName', 'Splitter (OZmap)', link.zabbixSplitterName, link.ozmapSplitterName);
        compareOzmap('ozmapSplitterPort', 'Porta Splitter (OZmap)', link.zabbixSplitterPort, link.ozmapSplitterPort);
      }

      const voalleActive = voalleConn.active;
      
      res.json({
        available: true,
        voalleConnectionId: link.voalleConnectionId,
        voalleActive,
        divergences,
        allFields,
        ozmapDivergences: ozmapDivergences.length > 0 ? ozmapDivergences : undefined,
        voalleData: {
          id: voalleConn.id,
          active: voalleConn.active,
          slotOlt: voalleConn.slotOlt,
          portOlt: voalleConn.portOlt,
          equipmentSerialNumber: voalleConn.equipmentSerialNumber,
          contractServiceTag: voalleConn.contractServiceTag,
          authenticationAccessPoint: voalleConn.authenticationAccessPoint,
          authenticationConcentrator: voalleConn.authenticationConcentrator,
          ipAuthentication: voalleConn.ipAuthentication,
          serviceProduct: voalleConn.serviceProduct,
          peopleAddress: voalleConn.peopleAddress,
          contract: voalleConn.contract,
        }
      });
    } catch (error: any) {
      const sanitizedMessage = (error?.message || "Erro desconhecido")
        .replace(/password[=:]["']?[^\s&"']+["']?/gi, "password=[REDACTED]")
        .replace(/username[=:]["']?[^\s&"']+["']?/gi, "username=[REDACTED]");
      console.error("[Voalle Compare] Error:", sanitizedMessage);
      res.status(500).json({ error: "Erro ao comparar com Voalle" });
    }
  });

  // Sincronizar dados do link com Voalle ao salvar
  app.post("/api/links/:linkId/voalle-sync", requireAuth, async (req, res) => {
    try {
      const linkId = parseInt(req.params.linkId, 10);
      const link = await storage.getLink(linkId);
      if (!link) {
        return res.status(404).json({ success: false, error: "Link não encontrado" });
      }

      const client = await storage.getClient(link.clientId);
      if (!client) {
        return res.json({ success: false, message: "Cliente não encontrado" });
      }

      const voalleIntegration = await storage.getErpIntegrationByProvider('voalle');
      if (!voalleIntegration || !voalleIntegration.isActive) {
        return res.json({ success: false, message: "Integração Voalle não configurada" });
      }

      const adapter = configureErpAdapter(voalleIntegration) as any;

      let connectionId = link.voalleConnectionId;

      if (!connectionId) {
        const voalleCustomerId = client.voalleCustomerId ? client.voalleCustomerId.toString() : null;
        const portalUsername = client.voallePortalUsername || null;
        let portalPassword: string | null = null;
        try {
          portalPassword = client.voallePortalPassword ? decrypt(client.voallePortalPassword) : null;
        } catch {
          portalPassword = null;
        }

        if (!voalleCustomerId || !portalUsername || !portalPassword) {
          if (!link.voalleContractTagServiceTag && !link.voalleContractTagId) {
            return res.json({ success: false, message: "Link não possui ID de conexão nem etiqueta Voalle" });
          }
          return res.json({ success: false, message: "Cliente sem credenciais do portal Voalle para descobrir conexão" });
        }

        if (link.voalleContractTagServiceTag) {
          const lookupResult = await adapter.findConnectionByServiceTag({
            voalleCustomerId, portalUsername, portalPassword,
            serviceTag: link.voalleContractTagServiceTag,
          });
          if (lookupResult.success && lookupResult.connection) {
            connectionId = lookupResult.connection.id;
            await storage.updateLink(linkId, { voalleConnectionId: connectionId });
            console.log(`[Voalle Sync] Link ${linkId}: connectionId descoberto via etiqueta: ${connectionId}`);
          }
        }

        if (!connectionId && link.voalleContractTagId) {
          const connResult = await adapter.getConnections({ voalleCustomerId, portalUsername, portalPassword });
          if (connResult.success && connResult.connections?.length) {
            const match = connResult.connections.find((c: any) => c.contractServiceTag?.id === link.voalleContractTagId);
            if (match) {
              connectionId = match.id;
              const serviceTag = match.contractServiceTag?.serviceTag || null;
              await storage.updateLink(linkId, { 
                voalleConnectionId: connectionId,
                ...(serviceTag ? { voalleContractTagServiceTag: serviceTag } : {}),
              });
              console.log(`[Voalle Sync] Link ${linkId}: connectionId descoberto via contractTagId ${link.voalleContractTagId}: ${connectionId}`);
            }
          }
        }

        if (!connectionId) {
          return res.json({ success: false, message: "Conexão não encontrada no Voalle para este link" });
        }
      }

      if (!connectionId) {
        return res.json({ success: false, message: "Não foi possível determinar a conexão Voalle" });
      }

      const updatedLink = await storage.getLink(linkId);
      if (!updatedLink) {
        return res.json({ success: false, message: "Link não encontrado após atualização" });
      }

      const fields: Record<string, any> = {};
      if (updatedLink.slotOlt !== null && updatedLink.slotOlt !== undefined) fields.slotOlt = updatedLink.slotOlt;
      if (updatedLink.portOlt !== null && updatedLink.portOlt !== undefined) fields.portOlt = updatedLink.portOlt;
      if (updatedLink.equipmentSerialNumber) fields.equipmentSerialNumber = updatedLink.equipmentSerialNumber;
      if (updatedLink.oltId) {
        const olt = await storage.getOlt(updatedLink.oltId);
        if (olt) {
          const oltVoalleIds = (olt as any).voalleIds;
          if (oltVoalleIds) {
            const firstId = parseInt(oltVoalleIds.split(',')[0].trim(), 10);
            if (!isNaN(firstId)) fields.authenticationAccessPointId = firstId;
          }
        }
      } else if (updatedLink.switchId) {
        const sw = await storage.getSwitch(updatedLink.switchId);
        if (sw) {
          const swVoalleIds = (sw as any).voalleIds;
          if (swVoalleIds) {
            const firstId = parseInt(swVoalleIds.split(',')[0].trim(), 10);
            if (!isNaN(firstId)) fields.authenticationAccessPointId = firstId;
          }
        }
      }
      if (updatedLink.voalleSplitterId) fields.authenticationSplitterId = updatedLink.voalleSplitterId;
      if (updatedLink.voalleSplitterPort !== null && updatedLink.voalleSplitterPort !== undefined) fields.splitterPort = updatedLink.voalleSplitterPort;

      console.log(`[Voalle Sync] Local → Voalle: Link ${linkId} -> Conexão ${connectionId}: campos: ${Object.keys(fields).join(', ')}`);

      if (Object.keys(fields).length === 0) {
        return res.json({ success: true, message: "Nenhum campo para sincronizar", synced: 0 });
      }

      const updateResult = await adapter.updateConnectionFields(connectionId, fields);
      if (!updateResult.success) {
        console.error(`[Voalle Sync] Falha ao atualizar conexão ${connectionId}:`, updateResult.message);
        return res.json({ success: false, message: updateResult.message || "Erro ao atualizar Voalle" });
      }

      console.log(`[Voalle Sync] Link ${linkId} -> Conexão ${connectionId}: ${Object.keys(fields).length} campos sincronizados`);
      console.log(`[Voalle Sync] Payload enviado: ${JSON.stringify(fields)}`);
      console.log(`[Voalle Sync] Resposta API: ${updateResult.apiResponse || 'N/A'}`);
      res.json({ 
        success: true, 
        message: `${Object.keys(fields).length} campo(s) sincronizado(s) com Voalle`,
        synced: Object.keys(fields).length,
        fields: Object.keys(fields),
        apiResponse: updateResult.apiResponse,
      });
    } catch (error: any) {
      const sanitizedMessage = (error?.message || "Erro desconhecido")
        .replace(/password[=:]["']?[^\s&"']+["']?/gi, "password=[REDACTED]")
        .replace(/username[=:]["']?[^\s&"']+["']?/gi, "username=[REDACTED]");
      console.error("[Voalle Sync] Error:", sanitizedMessage);
      res.status(500).json({ success: false, error: "Erro ao sincronizar com Voalle" });
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

  // Super Admin Link Dashboard - aggregated view of all links with events and incidents
  app.get("/api/super-admin/link-dashboard", requireSuperAdmin, async (req, res) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const pageSize = Math.min(parseInt(req.query.pageSize as string) || 50, 100);
      const status = req.query.status as string | undefined; // 'operational', 'degraded', 'offline', 'all'
      const clientId = req.query.clientId ? parseInt(req.query.clientId as string) : undefined;
      const search = (req.query.search as string)?.toLowerCase().trim() || undefined;

      // Get all clients for name lookup
      const allClients = await storage.getClients();
      const clientMap = new Map(allClients.map(c => [c.id, c.name]));

      // Get all links
      let allLinks = await storage.getLinks();

      // Apply filters
      if (clientId) {
        allLinks = allLinks.filter(l => l.clientId === clientId);
      }
      if (status && status !== 'all') {
        if (status === 'offline') {
          allLinks = allLinks.filter(l => l.status === 'offline' || l.status === 'down');
        } else {
          allLinks = allLinks.filter(l => l.status === status);
        }
      }
      if (search) {
        allLinks = allLinks.filter(l => 
          l.name.toLowerCase().includes(search) ||
          l.identifier.toLowerCase().includes(search) ||
          l.ipBlock.toLowerCase().includes(search) ||
          l.location.toLowerCase().includes(search) ||
          (clientMap.get(l.clientId) || '').toLowerCase().includes(search)
        );
      }

      // Calculate summary before pagination
      const summary = {
        totalLinks: allLinks.length,
        onlineLinks: allLinks.filter(l => l.status === 'operational').length,
        degradedLinks: allLinks.filter(l => l.status === 'degraded').length,
        offlineLinks: allLinks.filter(l => l.status === 'offline' || l.status === 'down').length,
        activeAlerts: 0,
        openIncidents: 0,
      };

      // Sort by status priority (offline first, then degraded, then operational)
      const statusPriority: Record<string, number> = { offline: 0, down: 0, degraded: 1, operational: 2 };
      allLinks.sort((a, b) => (statusPriority[a.status] ?? 2) - (statusPriority[b.status] ?? 2));

      // Paginate
      const totalItems = allLinks.length;
      const totalPages = Math.ceil(totalItems / pageSize);
      const paginatedLinks = allLinks.slice((page - 1) * pageSize, page * pageSize);

      // Get active events for paginated links (batch query)
      const linkIds = paginatedLinks.map(l => l.id);
      const activeEventsByLink = new Map<number, any>();
      const openIncidentsByLink = new Map<number, any>();

      // Fetch unresolved events for these specific links only
      // Get events for all links to find active ones - query all unresolved events directly
      const allUnresolvedEvents = await storage.getUnresolvedEventsByLinkIds(linkIds);
      for (const event of allUnresolvedEvents) {
        if (!activeEventsByLink.has(event.linkId)) {
          activeEventsByLink.set(event.linkId, {
            id: event.id,
            type: event.type,
            description: event.description,
            severity: event.type === 'offline' ? 'critical' : event.type === 'degraded' ? 'warning' : 'info',
            createdAt: event.timestamp,
          });
          summary.activeAlerts++;
        }
      }

      // Fetch open incidents for these links
      const openIncidents = await storage.getOpenIncidents();
      for (const incident of openIncidents) {
        if (incident.linkId && linkIds.includes(incident.linkId)) {
          openIncidentsByLink.set(incident.linkId, {
            id: incident.id,
            title: incident.description || `Incidente #${incident.id}`,
            voalleProtocolId: incident.erpTicketId ? parseInt(incident.erpTicketId) : null,
            createdAt: incident.openedAt,
          });
          summary.openIncidents++;
        }
      }

      // Build response items
      // Note: The monitoring system stores data with default inversion (concentrator perspective).
      // When invertBandwidth=true, it means the link is configured to NOT invert (customer perspective),
      // so we need to swap the values back to show correct customer-facing download/upload.
      const items = paginatedLinks.map(link => {
        // By default (invertBandwidth=false), values in DB are already from concentrator perspective
        // (download = data leaving customer = upload for customer, upload = data entering customer = download for customer)
        // When invertBandwidth=true, values should be displayed as stored (no swap needed)
        // When invertBandwidth=false (default), we need to swap to show customer perspective
        const displayDownload = link.invertBandwidth ? link.currentDownload : link.currentUpload;
        const displayUpload = link.invertBandwidth ? link.currentUpload : link.currentDownload;
        
        return {
          id: link.id,
          name: link.name,
          identifier: link.identifier,
          location: link.location,
          ipBlock: link.ipBlock,
          bandwidth: link.bandwidth,
          status: link.status,
          currentDownload: displayDownload,
          currentUpload: displayUpload,
          latency: link.latency,
          packetLoss: link.packetLoss,
          uptime: link.uptime,
          lastUpdated: link.lastUpdated,
          monitoringEnabled: link.monitoringEnabled,
          clientId: link.clientId,
          clientName: clientMap.get(link.clientId) || 'Desconhecido',
          activeEvent: activeEventsByLink.get(link.id) || null,
          openIncident: openIncidentsByLink.get(link.id) || null,
        };
      });

      res.json({
        items,
        summary,
        page,
        pageSize,
        totalPages,
        totalItems,
      });
    } catch (error) {
      console.error("[Link Dashboard] Error:", error);
      res.status(500).json({ error: "Failed to fetch link dashboard" });
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

  // CPE Management Endpoints
  app.get("/api/cpes", requireAuth, async (req, res) => {
    try {
      if (!req.user?.isSuperAdmin) {
        return res.status(403).json({ error: "Acesso negado" });
      }
      const cpesList = await storage.getCpes();
      res.json(cpesList);
    } catch (error) {
      console.error("Error fetching CPEs:", error);
      res.status(500).json({ error: "Falha ao buscar CPEs" });
    }
  });

  app.get("/api/cpes/:id", requireAuth, async (req, res) => {
    try {
      if (!req.user?.isSuperAdmin) {
        return res.status(403).json({ error: "Acesso negado" });
      }
      const id = parseInt(req.params.id, 10);
      const cpe = await storage.getCpe(id);
      if (!cpe) {
        return res.status(404).json({ error: "CPE não encontrado" });
      }
      res.json(cpe);
    } catch (error) {
      console.error("Error fetching CPE:", error);
      res.status(500).json({ error: "Falha ao buscar CPE" });
    }
  });

  app.post("/api/cpes", requireAuth, async (req, res) => {
    try {
      if (!req.user?.isSuperAdmin) {
        return res.status(403).json({ error: "Apenas super admins podem criar CPEs" });
      }
      const data = insertCpeSchema.parse(req.body);
      // Criptografar senhas se fornecidas e não já criptografadas
      if (data.webPassword && !isEncrypted(data.webPassword)) {
        data.webPassword = encrypt(data.webPassword);
      }
      if (data.sshPassword && !isEncrypted(data.sshPassword)) {
        data.sshPassword = encrypt(data.sshPassword);
      }
      const cpe = await storage.createCpe(data);
      res.json(cpe);
    } catch (error) {
      console.error("Error creating CPE:", error);
      res.status(400).json({ error: "Dados inválidos para CPE" });
    }
  });

  app.patch("/api/cpes/:id", requireAuth, async (req, res) => {
    try {
      if (!req.user?.isSuperAdmin) {
        return res.status(403).json({ error: "Apenas super admins podem editar CPEs" });
      }
      const id = parseInt(req.params.id, 10);
      const data = req.body;
      // Criptografar senhas se fornecidas e não já criptografadas
      if (data.webPassword && !isEncrypted(data.webPassword)) {
        data.webPassword = encrypt(data.webPassword);
      }
      if (data.sshPassword && !isEncrypted(data.sshPassword)) {
        data.sshPassword = encrypt(data.sshPassword);
      }
      const cpe = await storage.updateCpe(id, data);
      res.json(cpe);
    } catch (error) {
      console.error("Error updating CPE:", error);
      res.status(500).json({ error: "Falha ao atualizar CPE" });
    }
  });

  app.get("/api/cpes/:id/linked-count", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const result = await storage.getLinkedLinkCountForCpe(id);
      res.json({ count: result.count, linkNames: result.linkNames, hasMore: result.count > 10 });
    } catch (error) {
      console.error("Error checking CPE links:", error);
      res.status(500).json({ error: "Falha ao verificar vínculos" });
    }
  });

  app.delete("/api/cpes/:id", requireAuth, async (req, res) => {
    try {
      if (!req.user?.isSuperAdmin) {
        return res.status(403).json({ error: "Apenas super admins podem excluir CPEs" });
      }
      const id = parseInt(req.params.id, 10);
      const force = req.query.force === 'true';

      const { count } = await storage.getLinkedLinkCountForCpe(id);

      if (count > 0 && !force) {
        return res.status(409).json({
          error: `Esta CPE está vinculada a ${count} link(s). Confirme para excluir e remover todas as associações.`,
          linkedCount: count,
        });
      }

      if (count > 0 && force) {
        const removed = await storage.deleteCpeForce(id);
        console.log(`[CPE Delete] CPE ${id} excluída com ${removed} associações removidas`);
        res.json({ success: true, removedAssociations: removed });
      } else {
        await storage.deleteCpe(id);
        res.json({ success: true, removedAssociations: 0 });
      }
    } catch (error) {
      console.error("Error deleting CPE:", error);
      res.status(500).json({ error: "Falha ao excluir CPE" });
    }
  });

  // Link-CPE Associations
  app.get("/api/links/:linkId/cpes", requireAuth, async (req, res) => {
    try {
      if (!req.user?.isSuperAdmin) {
        return res.status(403).json({ error: "Acesso negado" });
      }
      const linkId = parseInt(req.params.linkId, 10);
      const associations = await storage.getLinkCpes(linkId);
      res.json(associations);
    } catch (error) {
      console.error("Error fetching link CPEs:", error);
      res.status(500).json({ error: "Falha ao buscar CPEs do link" });
    }
  });

  app.post("/api/links/:linkId/cpes", requireAuth, async (req, res) => {
    try {
      if (!req.user?.isSuperAdmin) {
        return res.status(403).json({ error: "Apenas super admins podem associar CPEs" });
      }
      const linkId = parseInt(req.params.linkId, 10);
      console.log(`[CPE Link] POST /api/links/${linkId}/cpes body:`, JSON.stringify(req.body));
      const data = insertLinkCpeSchema.parse({ ...req.body, linkId });
      console.log(`[CPE Link] Parsed data:`, JSON.stringify(data));
      const association = await storage.addCpeToLink(data);
      console.log(`[CPE Link] Association created:`, JSON.stringify(association));
      res.json(association);
    } catch (error: any) {
      console.error("[CPE Link] Error adding CPE to link:", error?.message || error);
      if (error?.issues) console.error("[CPE Link] Zod issues:", JSON.stringify(error.issues));
      res.status(400).json({ error: "Falha ao associar CPE ao link", details: error?.message });
    }
  });

  app.delete("/api/links/:linkId/cpes/:cpeId", requireAuth, async (req, res) => {
    try {
      if (!req.user?.isSuperAdmin) {
        return res.status(403).json({ error: "Apenas super admins podem remover CPEs" });
      }
      const linkId = parseInt(req.params.linkId, 10);
      const cpeId = parseInt(req.params.cpeId, 10);
      await storage.removeCpeFromLink(linkId, cpeId);
      res.json({ success: true });
    } catch (error) {
      console.error("Error removing CPE from link:", error);
      res.status(500).json({ error: "Falha ao remover CPE do link" });
    }
  });

  // CPE Port Status - Coletar e retornar status das portas do CPE via SNMP
  app.get("/api/cpe/:cpeId/ports", requireAuth, async (req, res) => {
    try {
      const cpeId = parseInt(req.params.cpeId, 10);
      const linkCpeId = req.query.linkCpeId ? parseInt(req.query.linkCpeId as string, 10) : undefined;
      
      // Verificar autorização multi-tenant
      if (!req.user?.isSuperAdmin) {
        // linkCpeId é obrigatório para usuários não-admin para garantir validação de acesso
        if (!linkCpeId) {
          return res.status(403).json({ error: "Parâmetro linkCpeId obrigatório" });
        }
        
        const linkCpe = await storage.getLinkCpe(linkCpeId);
        if (!linkCpe) {
          return res.status(404).json({ error: "Associação link-CPE não encontrada" });
        }
        
        // Verificar se linkCpe pertence ao cpeId solicitado
        if (linkCpe.cpeId !== cpeId) {
          return res.status(403).json({ error: "Acesso negado" });
        }
        
        // Verificar se o link pertence ao cliente do usuário
        const link = await storage.getLink(linkCpe.linkId);
        if (!link || link.clientId !== req.user?.clientId) {
          return res.status(403).json({ error: "Acesso negado" });
        }
      }
      
      // Buscar portas salvas no banco
      const savedPorts = await storage.getCpePortStatus(cpeId, linkCpeId);
      res.json(savedPorts);
    } catch (error) {
      console.error("Error fetching CPE port status:", error);
      res.status(500).json({ error: "Falha ao buscar status das portas" });
    }
  });

  // Endpoint para coletar status das portas via SNMP e salvar no banco
  app.post("/api/cpe/:cpeId/ports/refresh", requireAuth, async (req, res) => {
    try {
      const cpeId = parseInt(req.params.cpeId, 10);
      const linkCpeId = req.query.linkCpeId ? parseInt(req.query.linkCpeId as string, 10) : undefined;
      
      // Verificar autorização multi-tenant
      if (!req.user?.isSuperAdmin) {
        // linkCpeId é obrigatório para usuários não-admin para garantir validação de acesso
        if (!linkCpeId) {
          return res.status(403).json({ error: "Parâmetro linkCpeId obrigatório" });
        }
        
        const linkCpe = await storage.getLinkCpe(linkCpeId);
        if (!linkCpe) {
          return res.status(404).json({ error: "Associação link-CPE não encontrada" });
        }
        
        // Verificar se linkCpe pertence ao cpeId solicitado
        if (linkCpe.cpeId !== cpeId) {
          return res.status(403).json({ error: "Acesso negado" });
        }
        
        // Verificar se o link pertence ao cliente do usuário
        const link = await storage.getLink(linkCpe.linkId);
        if (!link || link.clientId !== req.user?.clientId) {
          return res.status(403).json({ error: "Acesso negado" });
        }
      }
      
      // Buscar CPE e suas configurações SNMP
      const cpe = await storage.getCpe(cpeId);
      if (!cpe) {
        return res.status(404).json({ error: "CPE não encontrado" });
      }
      
      // Determinar IP a usar (override do linkCpe ou IP do CPE)
      let targetIp = cpe.ipAddress;
      if (linkCpeId) {
        const linkCpe = await storage.getLinkCpe(linkCpeId);
        if (linkCpe?.ipOverride) {
          targetIp = linkCpe.ipOverride;
        }
      }
      
      if (!targetIp) {
        return res.status(400).json({ error: "CPE não possui IP configurado" });
      }
      
      // Buscar perfil SNMP do CPE ou do fabricante
      let snmpProfile;
      if (cpe.snmpProfileId) {
        snmpProfile = await storage.getSnmpProfile(cpe.snmpProfileId);
      } else if (cpe.vendorId) {
        // Tentar buscar perfil padrão do fabricante
        const vendor = await storage.getEquipmentVendor(cpe.vendorId);
        if (vendor?.snmpProfileId) {
          snmpProfile = await storage.getSnmpProfile(vendor.snmpProfileId);
        }
      }
      
      if (!snmpProfile) {
        // Usar perfil SNMP padrão (v2c, community public)
        snmpProfile = {
          id: 0,
          version: "2c",
          port: 161,
          community: "public",
          timeout: 5000,
          retries: 1,
        };
      }
      
      // Descobrir interfaces via SNMP
      const interfaces = await discoverInterfaces(targetIp, snmpProfile);
      
      // Filtrar apenas interfaces físicas (excluir loopback, vlan, etc)
      const physicalInterfaces = interfaces.filter(iface => {
        const name = (iface.ifName || iface.ifDescr || "").toLowerCase();
        // Incluir apenas interfaces que parecem físicas
        return !name.includes("loopback") && 
               !name.includes("null") &&
               !name.includes("vlan") &&
               (name.includes("eth") || 
                name.includes("ge") || 
                name.includes("fa") || 
                name.includes("gi") ||
                name.includes("te") ||
                name.includes("xe") ||
                name.includes("lan") ||
                name.includes("wan") ||
                name.includes("port") ||
                /^[0-9]+$/.test(name) || // Algumas interfaces são só números
                iface.ifSpeed > 0); // Se tem velocidade, provavelmente é física
      });
      
      // Salvar status das portas no banco
      const savedPorts = [];
      for (const iface of physicalInterfaces) {
        const portData = {
          cpeId,
          linkCpeId: linkCpeId || null,
          portIndex: iface.ifIndex,
          portName: iface.ifAlias || iface.ifName || iface.ifDescr || `Port ${iface.ifIndex}`,
          operStatus: iface.ifOperStatus || "unknown",
          adminStatus: iface.ifAdminStatus || "up",
          speed: iface.ifSpeed || null,
          duplex: null,
          mediaType: null,
        };
        
        const saved = await storage.upsertCpePortStatus(portData);
        savedPorts.push(saved);
      }
      
      res.json({
        success: true,
        portsFound: physicalInterfaces.length,
        ports: savedPorts,
      });
    } catch (error) {
      console.error("Error refreshing CPE port status:", error);
      res.status(500).json({ error: "Falha ao coletar status das portas via SNMP" });
    }
  });

  // CPE Command Templates - Biblioteca de comandos SSH
  app.get("/api/cpe-command-templates", requireAuth, async (req, res) => {
    try {
      const vendorId = req.query.vendorId ? parseInt(req.query.vendorId as string, 10) : undefined;
      const model = req.query.model as string | undefined;
      const templates = await storage.getCpeCommandTemplates(vendorId, model);
      res.json(templates);
    } catch (error) {
      console.error("Error fetching CPE command templates:", error);
      res.status(500).json({ error: "Falha ao buscar templates de comandos" });
    }
  });

  app.get("/api/admin/cpe-command-templates", requireAuth, async (req, res) => {
    try {
      if (!req.user?.isSuperAdmin) {
        return res.status(403).json({ error: "Acesso negado" });
      }
      const templates = await storage.getAllCpeCommandTemplates();
      res.json(templates);
    } catch (error) {
      console.error("Error fetching all CPE command templates:", error);
      res.status(500).json({ error: "Falha ao buscar templates de comandos" });
    }
  });

  app.post("/api/admin/cpe-command-templates", requireAuth, async (req, res) => {
    try {
      if (!req.user?.isSuperAdmin) {
        return res.status(403).json({ error: "Apenas super admins podem criar templates" });
      }
      const template = await storage.createCpeCommandTemplate(req.body);
      res.json(template);
    } catch (error) {
      console.error("Error creating CPE command template:", error);
      res.status(400).json({ error: "Falha ao criar template de comando" });
    }
  });

  app.patch("/api/admin/cpe-command-templates/:id", requireAuth, async (req, res) => {
    try {
      if (!req.user?.isSuperAdmin) {
        return res.status(403).json({ error: "Apenas super admins podem editar templates" });
      }
      const id = parseInt(req.params.id, 10);
      const template = await storage.updateCpeCommandTemplate(id, req.body);
      if (!template) {
        return res.status(404).json({ error: "Template não encontrado" });
      }
      res.json(template);
    } catch (error) {
      console.error("Error updating CPE command template:", error);
      res.status(400).json({ error: "Falha ao atualizar template de comando" });
    }
  });

  app.delete("/api/admin/cpe-command-templates/:id", requireAuth, async (req, res) => {
    try {
      if (!req.user?.isSuperAdmin) {
        return res.status(403).json({ error: "Apenas super admins podem excluir templates" });
      }
      const id = parseInt(req.params.id, 10);
      await storage.deleteCpeCommandTemplate(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting CPE command template:", error);
      res.status(500).json({ error: "Falha ao excluir template de comando" });
    }
  });

  // CPE Command History - Histórico de execução de comandos
  app.get("/api/cpe/:cpeId/command-history", requireAuth, async (req, res) => {
    try {
      const cpeId = parseInt(req.params.cpeId, 10);
      const linkId = req.query.linkId ? parseInt(req.query.linkId as string, 10) : undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
      
      // Validar acesso ao CPE se não for super admin
      if (!req.user?.isSuperAdmin && linkId) {
        const { allowed } = await validateLinkAccess(req, linkId);
        if (!allowed) {
          return res.status(403).json({ error: "Acesso negado" });
        }
      }
      
      const history = await storage.getCpeCommandHistory(cpeId, linkId, limit);
      res.json(history);
    } catch (error) {
      console.error("Error fetching CPE command history:", error);
      res.status(500).json({ error: "Falha ao buscar histórico de comandos" });
    }
  });

  app.post("/api/cpe/:cpeId/command-history", requireAuth, async (req, res) => {
    try {
      const cpeId = parseInt(req.params.cpeId, 10);
      const { linkId, linkCpeId, templateId, command, status, output } = req.body;
      
      // Validar acesso ao CPE se não for super admin
      if (!req.user?.isSuperAdmin && linkId) {
        const { allowed } = await validateLinkAccess(req, linkId);
        if (!allowed) {
          return res.status(403).json({ error: "Acesso negado" });
        }
      }
      
      if (!command) {
        return res.status(400).json({ error: "Comando é obrigatório" });
      }
      
      const history = await storage.createCpeCommandHistory({
        cpeId,
        linkId,
        linkCpeId,
        templateId,
        command,
        userId: req.user!.id,
        status: status || "pending",
        output,
      });
      res.json(history);
    } catch (error) {
      console.error("Error creating CPE command history:", error);
      res.status(400).json({ error: "Falha ao registrar comando" });
    }
  });

  app.patch("/api/cpe/:cpeId/command-history/:id", requireAuth, async (req, res) => {
    try {
      // Apenas super admins podem atualizar histórico de comandos
      if (!req.user?.isSuperAdmin) {
        return res.status(403).json({ error: "Apenas super admins podem atualizar histórico" });
      }
      const id = parseInt(req.params.id, 10);
      const history = await storage.updateCpeCommandHistory(id, req.body);
      if (!history) {
        return res.status(404).json({ error: "Registro não encontrado" });
      }
      res.json(history);
    } catch (error) {
      console.error("Error updating CPE command history:", error);
      res.status(400).json({ error: "Falha ao atualizar histórico" });
    }
  });

  // Diagnostic Targets - IPs de diagnóstico configuráveis
  app.get("/api/diagnostic-targets", requireAuth, async (req, res) => {
    try {
      const clientId = req.user?.isSuperAdmin ? undefined : (req.user?.clientId ?? undefined);
      const targets = await storage.getDiagnosticTargets(clientId);
      res.json(targets);
    } catch (error) {
      console.error("Error fetching diagnostic targets:", error);
      res.status(500).json({ error: "Falha ao buscar IPs de diagnóstico" });
    }
  });

  app.get("/api/admin/diagnostic-targets", requireAuth, async (req, res) => {
    try {
      if (!req.user?.isSuperAdmin) {
        return res.status(403).json({ error: "Acesso negado" });
      }
      const targets = await storage.getAllDiagnosticTargets();
      res.json(targets);
    } catch (error) {
      console.error("Error fetching all diagnostic targets:", error);
      res.status(500).json({ error: "Falha ao buscar IPs de diagnóstico" });
    }
  });

  app.post("/api/admin/diagnostic-targets", requireAuth, async (req, res) => {
    try {
      if (!req.user?.isSuperAdmin) {
        return res.status(403).json({ error: "Apenas super admins podem criar IPs de diagnóstico" });
      }
      const target = await storage.createDiagnosticTarget(req.body);
      res.json(target);
    } catch (error) {
      console.error("Error creating diagnostic target:", error);
      res.status(400).json({ error: "Falha ao criar IP de diagnóstico" });
    }
  });

  app.patch("/api/admin/diagnostic-targets/:id", requireAuth, async (req, res) => {
    try {
      if (!req.user?.isSuperAdmin) {
        return res.status(403).json({ error: "Apenas super admins podem editar IPs de diagnóstico" });
      }
      const id = parseInt(req.params.id, 10);
      const target = await storage.updateDiagnosticTarget(id, req.body);
      if (!target) {
        return res.status(404).json({ error: "IP de diagnóstico não encontrado" });
      }
      res.json(target);
    } catch (error) {
      console.error("Error updating diagnostic target:", error);
      res.status(400).json({ error: "Falha ao atualizar IP de diagnóstico" });
    }
  });

  app.delete("/api/admin/diagnostic-targets/:id", requireAuth, async (req, res) => {
    try {
      if (!req.user?.isSuperAdmin) {
        return res.status(403).json({ error: "Apenas super admins podem excluir IPs de diagnóstico" });
      }
      const id = parseInt(req.params.id, 10);
      await storage.deleteDiagnosticTarget(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting diagnostic target:", error);
      res.status(500).json({ error: "Falha ao excluir IP de diagnóstico" });
    }
  });

  // Voalle CSV Import - Importação separada de Concentradores e Pontos de Acesso
  app.post("/api/admin/voalle-import-equipment", requireAuth, async (req, res) => {
    try {
      if (!req.user?.isSuperAdmin) {
        return res.status(403).json({ error: "Apenas super admins podem importar equipamentos" });
      }

      const { concentrators, accessPoints } = req.body as {
        concentrators: Array<Record<string, string>>;
        accessPoints: Array<Record<string, string>>;
      };

      const results = {
        concentratorsCreated: 0,
        concentratorsUpdated: 0,
        concentratorsSkipped: 0,
        accessPointsCreated: 0,
        accessPointsUpdated: 0,
        accessPointsSkipped: 0,
        oltsCreated: 0,
        oltsUpdated: 0,
        switchesCreated: 0,
        switchesUpdated: 0,
        errors: [] as Array<{ name: string; error: string }>,
      };

      const equipVendors = await storage.getEquipmentVendors();
      const vendorBySlug = new Map(equipVendors.map(v => [v.slug.toLowerCase(), v]));
      const vendorByName = new Map(equipVendors.map(v => [v.name.toLowerCase(), v]));

      const resolveVendorId = (vendorStr?: string): number | undefined => {
        if (!vendorStr) return undefined;
        const lower = vendorStr.trim().toLowerCase();
        const bySlug = vendorBySlug.get(lower);
        if (bySlug) return bySlug.id;
        const byName = vendorByName.get(lower);
        if (byName) return byName.id;
        for (const entry of Array.from(vendorByName.entries())) {
          if (entry[0].includes(lower) || lower.includes(entry[0])) return entry[1].id;
        }
        return undefined;
      };

      const resolveVendorSlug = (vendorStr?: string): string | undefined => {
        if (!vendorStr) return undefined;
        const lower = vendorStr.trim().toLowerCase();
        if (vendorBySlug.has(lower)) return lower;
        const byName = vendorByName.get(lower);
        if (byName) return byName.slug;
        for (const entry of Array.from(vendorByName.entries())) {
          if (entry[0].includes(lower) || lower.includes(entry[0])) return entry[1].slug;
        }
        return lower;
      };

      const parseIntSafe = (val?: string): number | undefined => {
        if (!val) return undefined;
        const n = parseInt(val, 10);
        return isNaN(n) ? undefined : n;
      };

      const parseVoalleIds = (ids: string | null | undefined): number[] => {
        if (!ids) return [];
        return ids.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
      };
      const mergeVoalleIds = (existing: string | null | undefined, newId: number | number[]): string => {
        const ids = parseVoalleIds(existing);
        const newIds = Array.isArray(newId) ? newId : [newId];
        for (const nid of newIds) {
          if (!ids.includes(nid)) ids.push(nid);
        }
        return ids.join(',');
      };

      // Import concentrators
      if (concentrators && concentrators.length > 0) {
        const existingConcs = await storage.getConcentrators();
        const existingByVoalleId = new Map<number, typeof existingConcs[0]>();
        for (const c of existingConcs) {
          for (const vid of parseVoalleIds(c.voalleIds)) {
            existingByVoalleId.set(vid, c);
          }
        }
        const existingByIp = new Map(existingConcs.map(c => [c.ipAddress, c]));

        for (const conc of concentrators) {
          try {
            const csvIdStr = String(conc.id || '').trim();
            const csvVoalleIds = parseVoalleIds(csvIdStr);
            const voalleId = csvVoalleIds[0];
            const ip = conc.server_ip || '';
            if (!voalleId || isNaN(voalleId) || !ip) {
              results.concentratorsSkipped++;
              continue;
            }

            const concData: any = {
              voalleIds: csvVoalleIds.join(','),
              name: conc.title || `Concentrador Voalle #${voalleId}`,
              ipAddress: ip,
              isActive: conc.is_active !== undefined ? conc.is_active !== '0' && conc.is_active.toLowerCase() !== 'false' && conc.is_active.toLowerCase() !== 'nao' && conc.is_active.toLowerCase() !== 'não' : true,
            };
            if (conc.model) concData.model = conc.model;
            if (conc.description) concData.description = conc.description;
            if (conc.vendor) {
              concData.vendor = resolveVendorSlug(conc.vendor);
              const vid = resolveVendorId(conc.vendor);
              if (vid) concData.equipmentVendorId = vid;
            }
            if (conc.ssh_user) concData.sshUser = conc.ssh_user;
            if (conc.ssh_password) concData.sshPassword = conc.ssh_password;
            if (conc.ssh_port) concData.sshPort = parseIntSafe(conc.ssh_port) || 22;
            if (conc.web_port) concData.webPort = parseIntSafe(conc.web_port) || 80;
            if (conc.web_protocol) concData.webProtocol = conc.web_protocol.toLowerCase();
            if (conc.winbox_port) concData.winboxPort = parseIntSafe(conc.winbox_port) || 8291;
            if (conc.is_access_point !== undefined || conc.ponto_de_acesso !== undefined) {
              const val = (conc.is_access_point || conc.ponto_de_acesso || '').toString().toLowerCase().trim();
              concData.isAccessPoint = val === '1' || val === 'true' || val === 'sim' || val === 'yes' || val === 's';
            }
            const apIds = conc.voalle_access_point_ids || conc.ids_ponto_de_acesso || conc.access_point_ids || '';
            if (apIds) {
              const apIdsStr = String(apIds).trim();
              console.log(`[Voalle Equipment Import] Concentrador "${concData.name}" voalleAccessPointIds raw="${apIds}" parsed="${apIdsStr}"`);
              concData.voalleAccessPointIds = apIdsStr;
              concData.isAccessPoint = true;
            }

            let existing: typeof existingConcs[0] | undefined;
            for (const vid of csvVoalleIds) {
              existing = existingByVoalleId.get(vid);
              if (existing) break;
            }
            if (!existing) existing = existingByIp.get(ip);
            if (existing) {
              concData.voalleIds = mergeVoalleIds(existing.voalleIds, csvVoalleIds);
              await storage.updateConcentrator(existing.id, concData);
              results.concentratorsUpdated++;
            } else {
              await storage.createConcentrator(concData);
              results.concentratorsCreated++;
            }
          } catch (err: any) {
            results.errors.push({ name: conc.title || conc.id, error: err.message });
          }
        }
      }

      // Import access points (OLTs and Switches)
      if (accessPoints && accessPoints.length > 0) {
        const existingOlts = await storage.getOlts();
        const existingOltsByVoalleId = new Map<number, typeof existingOlts[0]>();
        for (const o of existingOlts) {
          for (const vid of parseVoalleIds(o.voalleIds)) {
            existingOltsByVoalleId.set(vid, o);
          }
        }
        const existingOltsByIp = new Map(existingOlts.filter(o => o.ipAddress && o.ipAddress !== '0.0.0.0').map(o => [o.ipAddress, o]));
        const existingSwitches = await storage.getSwitches();
        const existingSwitchesByVoalleId = new Map<number, typeof existingSwitches[0]>();
        for (const s of existingSwitches) {
          for (const vid of parseVoalleIds(s.voalleIds)) {
            existingSwitchesByVoalleId.set(vid, s);
          }
        }
        const existingSwitchesByIp = new Map(existingSwitches.filter(s => s.ipAddress && s.ipAddress !== '0.0.0.0').map(s => [s.ipAddress, s]));

        for (const ap of accessPoints) {
          try {
            const apIdStr = String(ap.id || '').trim();
            const apVoalleIds = parseVoalleIds(apIdStr);
            const voalleId = apVoalleIds[0];
            if (!voalleId || isNaN(voalleId)) {
              results.accessPointsSkipped++;
              continue;
            }

            const name = ap.title || '';
            const ipAddr = ap.ip || '';
            const tipoCol = (ap.tipo || ap.type || '').trim().toLowerCase();
            const isOlt = tipoCol === 'olt' || (tipoCol !== 'switch' && name.toUpperCase().includes('OLT'));

            if (isOlt) {
              const oltData: any = {
                voalleIds: apVoalleIds.join(','),
                name: name || `OLT Voalle #${voalleId}`,
                ipAddress: ipAddr || "0.0.0.0",
                port: parseIntSafe(ap.port) || 23,
                username: ap.username || ap.user || "admin",
                password: ap.password || "",
                connectionType: ap.connection_type || "telnet",
              };
              if (ap.vendor) oltData.vendor = resolveVendorSlug(ap.vendor);
              if (ap.model) oltData.model = ap.model;
              if (ap.winbox_port) oltData.winboxPort = parseIntSafe(ap.winbox_port) || 8291;
              if (ap.database) oltData.database = ap.database;
              if (ap.search_onu_command) oltData.searchOnuCommand = ap.search_onu_command;
              if (ap.diagnosis_key_template) oltData.diagnosisKeyTemplate = ap.diagnosis_key_template;
              if (ap.is_active !== undefined) oltData.isActive = ap.is_active !== '0' && ap.is_active.toLowerCase() !== 'false' && ap.is_active.toLowerCase() !== 'nao' && ap.is_active.toLowerCase() !== 'não';

              let existing: typeof existingOlts[0] | undefined;
              for (const vid of apVoalleIds) {
                existing = existingOltsByVoalleId.get(vid);
                if (existing) break;
              }
              if (!existing && ipAddr && ipAddr !== '0.0.0.0') existing = existingOltsByIp.get(ipAddr);
              if (existing) {
                oltData.voalleIds = mergeVoalleIds(existing.voalleIds, apVoalleIds);
                await storage.updateOlt(existing.id, oltData);
                results.accessPointsUpdated++;
                results.oltsUpdated++;
              } else {
                await storage.createOlt(oltData);
                results.oltsCreated++;
                results.accessPointsCreated++;
              }
            } else {
              const switchData: any = {
                voalleIds: apVoalleIds.join(','),
                name: name || `Switch Voalle #${voalleId}`,
                ipAddress: ipAddr || "0.0.0.0",
              };
              if (ap.vendor) {
                switchData.vendor = resolveVendorSlug(ap.vendor);
                const vid = resolveVendorId(ap.vendor);
                if (vid) switchData.vendorId = vid;
              }
              if (ap.model) switchData.model = ap.model;
              if (ap.ssh_user) switchData.sshUser = ap.ssh_user;
              if (ap.ssh_password) switchData.sshPassword = ap.ssh_password;
              if (ap.ssh_port) switchData.sshPort = parseIntSafe(ap.ssh_port) || 22;
              if (ap.web_port) switchData.webPort = parseIntSafe(ap.web_port) || 80;
              if (ap.web_protocol) switchData.webProtocol = ap.web_protocol.toLowerCase();
              if (ap.winbox_port) switchData.winboxPort = parseIntSafe(ap.winbox_port) || 8291;
              if (ap.optical_rx_oid_template) switchData.opticalRxOidTemplate = ap.optical_rx_oid_template;
              if (ap.optical_tx_oid_template) switchData.opticalTxOidTemplate = ap.optical_tx_oid_template;
              if (ap.port_index_template) switchData.portIndexTemplate = ap.port_index_template;
              if (ap.is_active !== undefined) switchData.isActive = ap.is_active !== '0' && ap.is_active.toLowerCase() !== 'false' && ap.is_active.toLowerCase() !== 'nao' && ap.is_active.toLowerCase() !== 'não';

              let existingSw: typeof existingSwitches[0] | undefined;
              for (const vid of apVoalleIds) {
                existingSw = existingSwitchesByVoalleId.get(vid);
                if (existingSw) break;
              }
              if (!existingSw && ipAddr && ipAddr !== '0.0.0.0') existingSw = existingSwitchesByIp.get(ipAddr);
              if (existingSw) {
                switchData.voalleIds = mergeVoalleIds(existingSw.voalleIds, apVoalleIds);
                await storage.updateSwitch(existingSw.id, switchData);
                results.accessPointsUpdated++;
                results.switchesUpdated++;
              } else {
                await storage.createSwitch(switchData);
                results.switchesCreated++;
                results.accessPointsCreated++;
              }
            }
          } catch (err: any) {
            results.errors.push({ name: ap.title || ap.id, error: err.message });
          }
        }
      }

      res.json(results);
    } catch (error: any) {
      console.error("[Voalle Equipment Import] Error:", error);
      res.status(500).json({ error: error.message || "Erro ao importar equipamentos" });
    }
  });

  // Voalle CSV Import - Importação em lote de links via CSV do Voalle
  app.post("/api/admin/voalle-import", requireAuth, async (req, res) => {
    try {
      if (!req.user?.isSuperAdmin) {
        return res.status(403).json({ error: "Apenas super admins podem importar links do Voalle" });
      }

      const { links, targetClientId, lookupPppoeIps } = req.body as {
        links: Array<{
          id: string;
          serviceTag: string;
          title: string;
          linkName: string | null;
          clientName: string;
          clientVoalleId: number | null;
          clientCpfCnpj: string | null;
          clientPortalUser: string | null;
          clientPortalPassword: string | null;
          bandwidth: number | null;
          address: string;
          city: string;
          lat: string | null;
          lng: string | null;
          slotOlt: number | null;
          portOlt: number | null;
          equipmentSerial: string | null;
          concentratorId: string | null;
          concentratorIp: string | null;
          concentratorName: string | null;
          accessPointId: string | null;
          oltIp: string | null;
          oltName: string | null;
          cpeUser: string | null;
          cpePassword: string | null;
          pppoeUser: string | null;
          pppoePassword: string | null;
          vlan: number | null;
          vlanInterface: string | null;
          validLanIp: string | null;
          validLanIpClass: string | null;
          wifiName: string | null;
          wifiPassword: string | null;
          addressComplement: string | null;
          voalleConnectionId: number | null;
          voalleAccessPointId: number | null;
          voalleSplitterId: number | null;
          voalleSplitterPort: number | null;
          ipAuthenticationId: string | null;
          monitoredIp: string | null; // IP direto do conexoes.csv
          linkType: 'gpon' | 'ptp';
          authType: 'pppoe' | 'corporate';
        }>;
        targetClientId: number | null;
        lookupPppoeIps?: boolean;
      };

      if (!links || !Array.isArray(links) || links.length === 0) {
        return res.status(400).json({ error: "Nenhum link para importar" });
      }

      const results = {
        success: 0,
        failed: 0,
        errors: [] as Array<{ serviceTag: string; error: string }>,
      };
      
      // Rastrear IDs dos links processados (criados ou atualizados) para Etapa 6
      const processedLinkIds: number[] = [];

      // Get or create client - group links by clientVoalleId
      const clientsCache = new Map<number, number>(); // voalleId -> clientId
      const existingClients = await storage.getClients();
      // Track all slugs (including INACTIVE clients) to avoid duplicates with soft-deleted clients
      const allSlugs = await storage.getAllClientSlugs();
      const usedSlugs = new Set(allSlugs);
      
      // Build a lookup for existing clients by voalleCustomerId
      const existingByVoalleId = new Map<number, typeof existingClients[0]>();
      for (const client of existingClients) {
        if (client.voalleCustomerId) {
          existingByVoalleId.set(client.voalleCustomerId, client);
        }
      }

      // Helper function to get or create client for a link
      const getOrCreateClientForLink = async (link: typeof links[0]): Promise<number> => {
        console.log(`[Voalle Import] getOrCreateClientForLink - clientVoalleId: ${link.clientVoalleId}, clientName: ${link.clientName}`);
        // If target client specified, use it
        if (targetClientId) {
          return targetClientId;
        }

        // If link has voalleId, try to find/create by it
        if (link.clientVoalleId) {
          // Check cache first
          const cached = clientsCache.get(link.clientVoalleId);
          if (cached) {
            console.log(`[Voalle Import] Client from cache: ${cached}`);
            return cached;
          }

          // Check existing client by voalleCustomerId
          const existing = existingByVoalleId.get(link.clientVoalleId);
          if (existing) {
            // Update portal credentials if they're missing and we have new data
            if (link.clientPortalUser || link.clientPortalPassword) {
              const updateData: any = {};
              if (link.clientPortalUser && !existing.voallePortalUsername) {
                updateData.voallePortalUsername = link.clientPortalUser;
              }
              if (link.clientPortalPassword && !existing.voallePortalPassword) {
                updateData.voallePortalPassword = encrypt(link.clientPortalPassword);
              }
              if (link.clientCpfCnpj && !existing.cnpj) {
                updateData.cnpj = link.clientCpfCnpj;
              }
              if (Object.keys(updateData).length > 0) {
                await storage.updateClient(existing.id, updateData);
              }
            }
            clientsCache.set(link.clientVoalleId, existing.id);
            return existing.id;
          }

          // Extract clean name (remove #ID prefix and (CPF/CNPJ) suffix for slug)
          const cleanName = link.clientName
            .replace(/^#\d+\s*/, '')
            .replace(/\s*\([^)]+\)\s*$/, '')
            .trim() || `Cliente ${link.clientVoalleId}`;
          
          let baseSlug = cleanName.toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');
          
          // Check if a client with this slug already exists (including inactive) and link/reactivate it
          let slug = baseSlug || `cliente-${link.clientVoalleId}`;
          const existingBySlug = await storage.getClientBySlug(slug);
          if (existingBySlug) {
            console.log(`[Voalle Import] Found existing client by slug: ${slug}, updating/reactivating with voalleId: ${link.clientVoalleId}`);
            // Update and reactivate existing client with voalleId and portal credentials
            // Criptografar nova senha se fornecida
            const newEncryptedPassword = link.clientPortalPassword && !existingBySlug.voallePortalPassword 
              ? encrypt(link.clientPortalPassword) 
              : existingBySlug.voallePortalPassword;
            await storage.updateClient(existingBySlug.id, {
              isActive: true, // Reactivate if it was soft-deleted
              voalleCustomerId: link.clientVoalleId,
              voallePortalUsername: link.clientPortalUser || existingBySlug.voallePortalUsername || undefined,
              voallePortalPassword: newEncryptedPassword || undefined,
              cnpj: link.clientCpfCnpj || existingBySlug.cnpj || undefined,
            });
            clientsCache.set(link.clientVoalleId, existingBySlug.id);
            existingByVoalleId.set(link.clientVoalleId, existingBySlug);
            return existingBySlug.id;
          }
          
          // Ensure unique slug by appending voalleId if slug already used in this batch
          console.log(`[Voalle Import] Checking slug: ${slug}, exists in usedSlugs: ${usedSlugs.has(slug)}`);
          if (usedSlugs.has(slug)) {
            slug = `${baseSlug}-${link.clientVoalleId}`;
            console.log(`[Voalle Import] Slug conflict, using: ${slug}`);
          }
          // If still not unique (edge case), add random suffix
          while (usedSlugs.has(slug)) {
            slug = `${baseSlug}-${link.clientVoalleId}-${Date.now()}`;
            console.log(`[Voalle Import] Still conflict, using: ${slug}`);
          }

          console.log(`[Voalle Import] Creating client with slug: ${slug}, voalleId: ${link.clientVoalleId}`);
          // Create new client with all Voalle data
          // Criptografar senha do portal se fornecida
          const encryptedPassword = link.clientPortalPassword ? encrypt(link.clientPortalPassword) : undefined;
          const newClient = await storage.createClient({
            name: cleanName,
            slug: slug,
            cnpj: link.clientCpfCnpj || undefined,
            voalleCustomerId: link.clientVoalleId,
            voallePortalUsername: link.clientPortalUser || undefined,
            voallePortalPassword: encryptedPassword,
          });
          console.log(`[Voalle Import] Cliente criado: ${cleanName}, portalUser: ${link.clientPortalUser || 'N/A'}, portalPass: ${encryptedPassword ? '[ENCRYPTED]' : 'N/A'}`);

          // Track the new slug to avoid duplicates within the same import
          usedSlugs.add(slug);
          clientsCache.set(link.clientVoalleId, newClient.id);
          existingByVoalleId.set(link.clientVoalleId, newClient);
          return newClient.id;
        }

        // Fallback: use first link's name
        const fallbackName = link.clientName || "Cliente Voalle Import";
        const existingByName = existingClients.find(c => c.name === fallbackName);
        if (existingByName) {
          return existingByName.id;
        }

        const newClient = await storage.createClient({
          name: fallbackName,
          slug: fallbackName.toLowerCase().replace(/\s+/g, '-'),
        });
        return newClient.id;
      }

      // Get or create concentrators - group by voalleId
      const concentratorsCache = new Map<number, number>(); // voalleId -> concentratorId
      const existingConcentrators = await storage.getConcentrators();
      const existingConcentratorsByVoalleId = new Map<number, typeof existingConcentrators[0]>();
      const existingConcentratorsByAccessPointVoalleId = new Map<number, typeof existingConcentrators[0]>();
      for (const conc of existingConcentrators) {
        if (conc.voalleIds) {
          for (const vid of conc.voalleIds.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n))) {
            existingConcentratorsByVoalleId.set(vid, conc);
          }
        }
        if (conc.isAccessPoint && conc.voalleAccessPointIds) {
          for (const vid of conc.voalleAccessPointIds.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n))) {
            existingConcentratorsByAccessPointVoalleId.set(vid, conc);
          }
        }
      }

      const getOrCreateConcentrator = async (link: typeof links[0]): Promise<number | null> => {
        if (!link.concentratorId) return null;
        const voalleId = parseInt(link.concentratorId, 10);
        if (isNaN(voalleId)) return null;

        // Check cache
        const cached = concentratorsCache.get(voalleId);
        if (cached) return cached;

        // Check existing
        const existing = existingConcentratorsByVoalleId.get(voalleId);
        if (existing) {
          concentratorsCache.set(voalleId, existing.id);
          return existing.id;
        }

        // Create new if we have IP
        if (link.concentratorIp) {
          const newConc = await storage.createConcentrator({
            name: link.concentratorName || `Concentrador Voalle #${voalleId}`,
            ipAddress: link.concentratorIp,
            voalleIds: String(voalleId),
            isActive: true,
          });
          concentratorsCache.set(voalleId, newConc.id);
          existingConcentratorsByVoalleId.set(voalleId, newConc);
          return newConc.id;
        }

        return null;
      };

      // Get or create OLTs - group by voalleId
      const oltsCache = new Map<number, number>(); // voalleId -> oltId
      const existingOlts = await storage.getOlts();
      const existingOltsByVoalleId = new Map<number, typeof existingOlts[0]>();
      for (const olt of existingOlts) {
        if (olt.voalleIds) {
          for (const vid of olt.voalleIds.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n))) {
            existingOltsByVoalleId.set(vid, olt);
          }
        }
      }

      // Get or create Switches - group by voalleId
      const switchesCache = new Map<number, number>(); // voalleId -> switchId
      const existingSwitches = await storage.getSwitches();
      const existingSwitchesByVoalleId = new Map<number, typeof existingSwitches[0]>();
      for (const sw of existingSwitches) {
        if (sw.voalleIds) {
          for (const vid of sw.voalleIds.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n))) {
            existingSwitchesByVoalleId.set(vid, sw);
          }
        }
      }

      // Returns { oltId, switchId, concentratorAsAccessPointId } - one based on access point name or concentrator match
      const getOrCreateAccessPoint = async (link: typeof links[0]): Promise<{ oltId: number | null; switchId: number | null; concentratorAsAccessPointId: number | null }> => {
        console.log(`[Voalle Import] getOrCreateAccessPoint - accessPointId: ${link.accessPointId}, oltName: ${link.oltName}`);
        if (!link.accessPointId) return { oltId: null, switchId: null, concentratorAsAccessPointId: null };
        const voalleId = parseInt(link.accessPointId, 10);
        if (isNaN(voalleId)) return { oltId: null, switchId: null, concentratorAsAccessPointId: null };

        // Check if access point ID matches a concentrator's voalleAccessPointIds
        const concByAPId = existingConcentratorsByAccessPointVoalleId.get(voalleId);
        if (concByAPId) {
          console.log(`[Voalle Import] Access point ID ${voalleId} matches concentrator "${concByAPId.name}" via voalleAccessPointIds`);
          return { oltId: null, switchId: null, concentratorAsAccessPointId: concByAPId.id };
        }
        // Fallback: check if access point ID matches a concentrator's main voalleIds and it's marked as access point
        const concAsAP = existingConcentratorsByVoalleId.get(voalleId);
        if (concAsAP && concAsAP.isAccessPoint) {
          console.log(`[Voalle Import] Access point ID ${voalleId} matches concentrator "${concAsAP.name}" marked as access point (via main voalleIds)`);
          return { oltId: null, switchId: null, concentratorAsAccessPointId: concAsAP.id };
        }

        const accessPointName = link.oltName || '';
        const isOlt = accessPointName.toUpperCase().includes('OLT');
        console.log(`[Voalle Import] Access point "${accessPointName}" isOlt: ${isOlt}`);

        if (isOlt) {
          // Handle as OLT
          const cachedOlt = oltsCache.get(voalleId);
          if (cachedOlt) {
            console.log(`[Voalle Import] OLT from cache: ${cachedOlt}`);
            return { oltId: cachedOlt, switchId: null, concentratorAsAccessPointId: null };
          }

          const existingOlt = existingOltsByVoalleId.get(voalleId);
          if (existingOlt) {
            console.log(`[Voalle Import] OLT from existing: ${existingOlt.id}`);
            oltsCache.set(voalleId, existingOlt.id);
            return { oltId: existingOlt.id, switchId: null, concentratorAsAccessPointId: null };
          }

          if (accessPointName) {
            console.log(`[Voalle Import] Creating new OLT: ${accessPointName}`);
            const newOlt = await storage.createOlt({
              name: accessPointName,
              ipAddress: link.oltIp || "0.0.0.0",
              voalleIds: String(voalleId),
              port: 23,
              username: "admin",
              password: "",
              connectionType: "telnet",
            });
            console.log(`[Voalle Import] Created OLT ID: ${newOlt.id}`);
            oltsCache.set(voalleId, newOlt.id);
            existingOltsByVoalleId.set(voalleId, newOlt);
            return { oltId: newOlt.id, switchId: null, concentratorAsAccessPointId: null };
          }
          console.log(`[Voalle Import] OLT: No name to create`);
        } else {
          // Handle as Switch
          const cachedSwitch = switchesCache.get(voalleId);
          if (cachedSwitch) {
            console.log(`[Voalle Import] Switch from cache: ${cachedSwitch}`);
            return { oltId: null, switchId: cachedSwitch, concentratorAsAccessPointId: null };
          }

          const existingSwitch = existingSwitchesByVoalleId.get(voalleId);
          if (existingSwitch) {
            switchesCache.set(voalleId, existingSwitch.id);
            return { oltId: null, switchId: existingSwitch.id, concentratorAsAccessPointId: null };
          }

          if (accessPointName) {
            console.log(`[Voalle Import] Creating new Switch: ${accessPointName}`);
            const newSwitch = await storage.createSwitch({
              name: accessPointName,
              ipAddress: link.oltIp || "0.0.0.0",
              voalleIds: String(voalleId),
            });
            console.log(`[Voalle Import] Created Switch ID: ${newSwitch.id}`);
            switchesCache.set(voalleId, newSwitch.id);
            existingSwitchesByVoalleId.set(voalleId, newSwitch);
            return { oltId: null, switchId: newSwitch.id, concentratorAsAccessPointId: null };
          }
        }

        console.log(`[Voalle Import] No access point name, returning null`);
        return { oltId: null, switchId: null, concentratorAsAccessPointId: null };
      };

      // Get existing links to check for duplicates
      const existingLinks = await storage.getLinks();
      const existingIdentifiers = new Set(existingLinks.map(l => l.identifier?.toLowerCase()));
      
      // Track duplicates within this import batch
      const batchIdentifiers = new Set<string>();

      for (const link of links) {
        try {
          // Validate required fields
          if (!link.serviceTag || link.serviceTag.trim() === '') {
            results.errors.push({
              serviceTag: link.serviceTag || '(vazio)',
              error: "Etiqueta de serviço (service_tag) é obrigatória",
            });
            results.failed++;
            continue;
          }

          if (!link.title || link.title.trim() === '') {
            results.errors.push({
              serviceTag: link.serviceTag,
              error: "Nome/título do link é obrigatório",
            });
            results.failed++;
            continue;
          }

          const normalizedTag = link.serviceTag.toLowerCase().trim();

          // Check for duplicate within this import batch
          if (batchIdentifiers.has(normalizedTag)) {
            results.errors.push({
              serviceTag: link.serviceTag,
              error: "Etiqueta duplicada neste lote de importação",
            });
            results.failed++;
            continue;
          }
          
          batchIdentifiers.add(normalizedTag);
          
          // Check if link already exists (will update instead of skip)
          const existingLink = existingLinks.find(l => l.identifier?.toLowerCase() === normalizedTag);

          // Get or create client, concentrator and OLT for this link
          const linkClientId = await getOrCreateClientForLink(link);
          const linkConcentratorId = await getOrCreateConcentrator(link);
          const { oltId: linkOltId, switchId: linkSwitchId, concentratorAsAccessPointId } = await getOrCreateAccessPoint(link);
          // Concentrator-as-access-point takes priority (client connects directly to it for traffic collection)
          // Falls back to PPPoE concentrator if no access point concentrator was found
          const finalConcentratorId = concentratorAsAccessPointId || linkConcentratorId;
          
          console.log(`[Voalle Import] Link ${link.serviceTag}: clientId=${linkClientId}, concentratorId=${finalConcentratorId}, oltId=${linkOltId}, switchId=${linkSwitchId}, concAsAP=${concentratorAsAccessPointId}`);

          // Prepare link data with safe type coercion
          const rawLinkData = {
            clientId: linkClientId,
            identifier: String(link.serviceTag || '').trim(),
            // Nome do link: prefixo do equipment_user (antes de ===) ou título
            name: String(link.linkName || link.title || '').trim(),
            location: String(link.city || '').trim(),
            address: String(link.address || '').trim(),
            // Bloco IP combinando validLanIp + validLanIpClass (ex: "192.168.1.1/24")
            ipBlock: link.validLanIp && link.validLanIpClass 
              ? `${link.validLanIp}/${link.validLanIpClass}` 
              : (link.validLanIp || ""),
            totalIps: 1,
            usableIps: 1,
            bandwidth: typeof link.bandwidth === 'number' && link.bandwidth > 0 ? link.bandwidth : 100,
            linkType: link.linkType === 'ptp' ? 'ptp' : 'gpon',
            authType: link.authType === 'corporate' ? 'corporate' : 'pppoe',
            monitoringEnabled: true,
            // Enable optical monitoring for GPON links (with OLT)
            opticalMonitoringEnabled: link.linkType !== 'ptp' && linkOltId ? true : false,
            // OLT fields for GPON
            slotOlt: typeof link.slotOlt === 'number' ? link.slotOlt : null,
            portOlt: typeof link.portOlt === 'number' ? link.portOlt : null,
            onuSearchString: link.equipmentSerial ? String(link.equipmentSerial).trim() : null,
            equipmentSerialNumber: link.equipmentSerial ? String(link.equipmentSerial).trim() : null,
            // Concentrator, OLT and Access Point (Switch) - usando IDs do Link Monitor
            concentratorId: finalConcentratorId,
            oltId: linkOltId, // OLT for GPON links
            accessPointId: linkSwitchId, // Switch for PTP/L2 links
            // Origem de dados de tráfego: concentrator > accessPoint (switch) > manual
            trafficSourceType: finalConcentratorId ? 'concentrator' : (linkSwitchId ? 'accessPoint' : 'manual'),
            // Para links corporativos, usar vlanInterface como snmpInterfaceName (será resolvido para ifIndex via SNMP)
            snmpInterfaceName: link.authType === 'corporate' && link.vlanInterface ? String(link.vlanInterface).trim() : null,
            // CPE credentials
            cpeUser: link.cpeUser ? String(link.cpeUser).trim() : null,
            cpePassword: link.cpePassword ? String(link.cpePassword) : null,
            // PPPoE/VLAN/WiFi data from Voalle
            pppoeUser: link.pppoeUser ? String(link.pppoeUser).trim() : null,
            pppoePassword: link.pppoePassword ? String(link.pppoePassword) : null,
            vlan: typeof link.vlan === 'number' ? link.vlan : null,
            vlanInterface: link.vlanInterface ? String(link.vlanInterface).trim() : null,
            validLanIp: link.validLanIp ? String(link.validLanIp).trim() : null,
            validLanIpClass: link.validLanIpClass ? String(link.validLanIpClass).trim() : null,
            wifiName: link.wifiName ? String(link.wifiName).trim() : null,
            wifiPassword: link.wifiPassword ? String(link.wifiPassword) : null,
            addressComplement: link.addressComplement ? String(link.addressComplement).trim() : null,
            ipAuthenticationId: link.ipAuthenticationId ? String(link.ipAuthenticationId).trim() : null,
            // IP monitorado direto do conexoes.csv (sem precisar de discovery)
            monitoredIp: link.monitoredIp ? String(link.monitoredIp).trim() : null,
            // Location - ensure strings
            latitude: link.lat ? String(link.lat).trim() : null,
            longitude: link.lng ? String(link.lng).trim() : null,
            // Voalle tracking
            voalleContractTagServiceTag: String(link.serviceTag || '').trim(),
            voalleContractTagDescription: String(link.title || '').trim(),
            voalleConnectionId: link.voalleConnectionId || null,
            voalleAccessPointId: link.voalleAccessPointId || null,
            voalleSplitterId: link.voalleSplitterId || null,
            voalleSplitterPort: link.voalleSplitterPort || null,
          };

          // Validate with schema (partial validation for Voalle import)
          const parseResult = insertLinkSchema.safeParse(rawLinkData);
          if (!parseResult.success) {
            const errorMessages = parseResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
            results.errors.push({
              serviceTag: link.serviceTag,
              error: `Dados inválidos: ${errorMessages}`,
            });
            results.failed++;
            continue;
          }

          if (existingLink) {
            // Update existing link with new data (including OLT/Switch)
            console.log(`[Voalle Import] Updating existing link ${link.serviceTag} (ID: ${existingLink.id}) with accessPointId=${linkOltId || linkSwitchId}`);
            await storage.updateLink(existingLink.id, parseResult.data);
            processedLinkIds.push(existingLink.id);
            results.success++;
            
            // Log audit event for update
            await logAuditEvent({
              actor: req.user,
              action: "update",
              entity: "link",
              entityName: link.serviceTag,
              status: "success",
              metadata: {
                source: "voalle_import",
                serviceTag: link.serviceTag,
                title: link.title,
                accessPointId: linkOltId || linkSwitchId,
              },
              request: req,
            });
          } else {
            // Create new link
            console.log(`[Voalle Import] Creating new link ${link.serviceTag} with accessPointId=${linkOltId || linkSwitchId}`);
            const newLink = await storage.createLink(parseResult.data);
            processedLinkIds.push(newLink.id);
            results.success++;

            // Log audit event for create
            await logAuditEvent({
              actor: req.user,
              action: "create",
              entity: "link",
              entityName: link.serviceTag,
              status: "success",
              metadata: {
                source: "voalle_import",
                serviceTag: link.serviceTag,
                title: link.title,
                accessPointId: linkOltId || linkSwitchId,
              },
              request: req,
            });
          }

        } catch (linkError) {
          console.error(`Error importing link ${link.serviceTag}:`, linkError);
          results.errors.push({
            serviceTag: link.serviceTag,
            error: linkError instanceof Error ? linkError.message : "Erro desconhecido",
          });
          results.failed++;
        }
      }

      // Return results immediately - run discovery in background to avoid nginx 504 timeout
      // Use client-provided jobId if available, otherwise generate one
      const jobId = (req.body.importJobId as string) || `voalle-import-${Date.now()}`;
      
      // Reuse existing job if this is a subsequent batch
      let importJobStatus = activeImportJobs.get(jobId);
      if (importJobStatus) {
        importJobStatus.linksImported += results.success;
        importJobStatus.linksFailed += results.failed;
        importJobStatus.errors.push(...results.errors);
      } else {
        importJobStatus = {
          jobId,
          status: 'running',
          phase: 'discovery',
          linksImported: results.success,
          linksFailed: results.failed,
          pppoeIpsFound: 0,
          corporateIpsFound: 0,
          onuIdsDiscovered: 0,
          pppoeTotal: 0,
          pppoeCurrent: 0,
          corporateTotal: 0,
          corporateCurrent: 0,
          onuTotal: 0,
          onuCurrent: 0,
          retryRound: 1,
          maxRetryRounds: 3,
          pppoeFailed: 0,
          corporateFailed: 0,
          onuFailed: 0,
          errors: results.errors,
          startedAt: new Date().toISOString(),
        };
        activeImportJobs.set(jobId, importJobStatus);
      }

      // Send response immediately
      res.json({ ...results, pppoeIpsFound: 0, corporateIpsFound: 0, onuIdsDiscovered: 0, jobId });

      // Run heavy discovery operations in background (fire-and-forget)
      const runBackgroundDiscovery = async () => {
        try {

      // Optional: Lookup PPPoE IPs from concentrators
      let pppoeIpsFound = 0;
      if (lookupPppoeIps && results.success > 0) {
        console.log(`[Voalle Import] Iniciando busca de IPs via PPPoE...`);
        importJobStatus.phase = 'pppoe_lookup';
        
        const pppoeSessionMacs = new Map<number, string>();
        
        try {
          const { lookupMultiplePppoeSessions, lookupIpBlockFromRouteTable } = await import("./concentrator");
          
          const importedLinks = await storage.getLinks();
          let linksNeedingIp = importedLinks.filter((l: typeof importedLinks[0]) => 
            l.pppoeUser && 
            l.authType !== 'corporate' &&
            l.concentratorId &&
            ((!l.monitoredIp || l.monitoredIp === "") || !l.snmpInterfaceIndex)
          );
          
          importJobStatus.pppoeTotal = linksNeedingIp.length;
          importJobStatus.maxRetryRounds = 3;
          
          const MAX_PPPOE_ROUNDS = 3;
          for (let round = 1; round <= MAX_PPPOE_ROUNDS && linksNeedingIp.length > 0; round++) {
            importJobStatus.retryRound = round;
            importJobStatus.pppoeCurrent = 0;
            importJobStatus.pppoeTotal = linksNeedingIp.length;
            
            if (round > 1) {
              console.log(`[Voalle Import] PPPoE Retry round ${round}/${MAX_PPPOE_ROUNDS}: ${linksNeedingIp.length} links pendentes, aguardando 10s...`);
              await new Promise(r => setTimeout(r, 10000));
            }
            
            const linksByConcentrator = new Map<number, typeof linksNeedingIp>();
            for (const link of linksNeedingIp) {
              if (link.concentratorId) {
                const existing = linksByConcentrator.get(link.concentratorId) || [];
                existing.push(link);
                linksByConcentrator.set(link.concentratorId, existing);
              }
            }
            
            const failedThisRound: typeof linksNeedingIp = [];
            
            for (const [concentratorId, concentratorLinks] of Array.from(linksByConcentrator.entries())) {
              const concentrator = await storage.getConcentrator(concentratorId);
              if (!concentrator || !concentrator.sshUser) {
                console.log(`[Voalle Import] Concentrador ${concentratorId} sem credenciais SSH, pulando...`);
                failedThisRound.push(...concentratorLinks);
                importJobStatus.pppoeCurrent += concentratorLinks.length;
                continue;
              }
              
              const pppoeUsers = concentratorLinks
                .map((l: typeof concentratorLinks[0]) => l.pppoeUser)
                .filter((u: string | null): u is string => !!u);
              
              if (pppoeUsers.length === 0) continue;
              
              let snmpProfile = null;
              if (concentrator.snmpProfileId) {
                snmpProfile = await storage.getSnmpProfile(concentrator.snmpProfileId);
              }
              
              console.log(`[Voalle Import] [Round ${round}] Buscando ${pppoeUsers.length} sessões PPPoE no concentrador ${concentrator.name}`);
              
              try {
                const sessions = await lookupMultiplePppoeSessions(concentrator, pppoeUsers, undefined, snmpProfile);
                
                for (const link of concentratorLinks) {
                  importJobStatus.pppoeCurrent++;
                  if (link.pppoeUser) {
                    const session = sessions.get(link.pppoeUser);
                    if (session) {
                      const updateData: Record<string, any> = {};
                      
                      if (session.macAddress) {
                        pppoeSessionMacs.set(link.id, session.macAddress);
                      }
                      
                      if (session.ipAddress) {
                        updateData.monitoredIp = session.ipAddress;
                        pppoeIpsFound++;
                        importJobStatus.pppoeIpsFound = pppoeIpsFound;
                      }
                      
                      if (session.ifIndex) {
                        updateData.snmpInterfaceIndex = session.ifIndex;
                        updateData.trafficSourceType = 'concentrator';
                        if (session.ifName) updateData.snmpInterfaceName = session.ifName;
                        if (session.ifAlias) updateData.snmpInterfaceDescr = session.ifAlias;
                        
                        if (!link.ipBlock) {
                          try {
                            const snmpProfileData = concentrator.snmpProfileId 
                              ? await storage.getSnmpProfile(concentrator.snmpProfileId) : null;
                            const ipBlock = await lookupIpBlockFromRouteTable(concentrator, session.ifIndex, snmpProfileData);
                            if (ipBlock) {
                              updateData.ipBlock = ipBlock;
                              console.log(`[Voalle Import] ${link.name}: Bloco IP via SNMP: ${ipBlock}`);
                            }
                          } catch (ipBlockErr: any) {
                            console.log(`[Voalle Import] ${link.name}: Erro bloco IP: ${ipBlockErr.message}`);
                          }
                        }
                      }
                      
                      if (Object.keys(updateData).length > 0) {
                        await storage.updateLink(link.id, updateData);
                        console.log(`[Voalle Import] ${link.name}: IP=${session.ipAddress || 'N/A'}, ifIndex=${session.ifIndex || 'N/A'}`);
                      }
                      
                      if (!session.ipAddress && !session.ifIndex) {
                        failedThisRound.push(link);
                      }
                    } else {
                      failedThisRound.push(link);
                    }
                  }
                }
              } catch (concErr: any) {
                console.error(`[Voalle Import] [Round ${round}] Erro no concentrador ${concentrator.name}: ${concErr.message}`);
                failedThisRound.push(...concentratorLinks);
                importJobStatus.pppoeCurrent += concentratorLinks.length;
              }
            }
            
            linksNeedingIp = failedThisRound;
            importJobStatus.pppoeFailed = failedThisRound.length;
            console.log(`[Voalle Import] [Round ${round}] PPPoE: ${pppoeIpsFound} IPs encontrados, ${failedThisRound.length} pendentes`);
          }
          
          console.log(`[Voalle Import] Busca de IPs PPPoE concluída: ${pppoeIpsFound} IPs encontrados, ${linksNeedingIp.length} não resolvidos`);
          
          // Vincular links PPPoE a CPE padrão por fabricante (detectado via MAC)
          try {
            const { detectVendorByMac, discoverMacForLink } = await import("./concentrator");
            
            // Buscar apenas links PPPoE importados NESTE LOTE que têm IP mas não têm CPE vinculado
            const allLinks = await storage.getLinks();
            const pppoeLinksWithIp = allLinks.filter((l: typeof allLinks[0]) => 
              processedLinkIds.includes(l.id) &&
              l.authType === 'pppoe' && 
              l.pppoeUser && 
              l.monitoredIp
            );
            
            console.log(`[Voalle Import] ${pppoeLinksWithIp.length} links PPPoE deste lote para vincular CPE`);
            
            let cpesLinkedByVendor = 0;
            let cpesLinkedGeneric = 0;
            
            // CPE padrão genérica (fallback)
            let genericStandardCpe: any = null;
            const standardOnuCpes = await storage.getStandardCpesByType('onu');
            if (standardOnuCpes.length === 1) {
              genericStandardCpe = standardOnuCpes[0];
            } else if (standardOnuCpes.length === 0) {
              // Criar CPE padrão genérica se não existir
              genericStandardCpe = await storage.createCpe({
                name: 'ONU Padrão',
                type: 'onu',
                isStandard: true,
                hasAccess: true,
                ownership: 'provider',
              });
              console.log(`[Voalle Import] CPE padrão genérica criada: ${genericStandardCpe.name}`);
            }
            
            for (const link of pppoeLinksWithIp) {
              // Verificar se já existe associação
              const existingAssocs = await storage.getLinkCpes(link.id);
              if (existingAssocs.length > 0) {
                continue; // Já tem CPE vinculado
              }
              
              let linkedCpe = null;
              
              // Descobrir MAC via ARP nos equipamentos do link (OLT > Switch > Concentrador)
              // Com timeout de 30s para evitar travamento se equipamento não responder
              console.log(`[Voalle Import] ${link.name}: Buscando MAC para IP ${link.monitoredIp}...`);
              
              let finalMac: string | null = null;
              let macSource: string | null = null;
              
              try {
                const macDiscoveryPromise = (async () => {
                  let oltEquip = null;
                  let switchEquip = null;
                  let concEquip = null;
                  
                  if (link.oltId) {
                    const olt = await storage.getOlt(link.oltId);
                    if (olt) {
                      const oltPassword = olt.password ? (isEncrypted(olt.password) ? decrypt(olt.password) : olt.password) : null;
                      oltEquip = { ...olt, vendor: olt.vendor, username: olt.username, password: oltPassword };
                    }
                  }
                  if (link.accessPointId) {
                    const sw = await storage.getSwitch(link.accessPointId);
                    if (sw) {
                      const swPassword = sw.sshPassword ? (isEncrypted(sw.sshPassword) ? decrypt(sw.sshPassword) : sw.sshPassword) : null;
                      switchEquip = { ...sw, username: sw.sshUser, password: swPassword };
                    }
                  }
                  if (link.concentratorId) {
                    const conc = await storage.getConcentrator(link.concentratorId);
                    if (conc) {
                      const vendorObj = conc.equipmentVendorId ? await storage.getEquipmentVendor(conc.equipmentVendorId) : null;
                      const concPassword = conc.sshPassword ? (isEncrypted(conc.sshPassword) ? decrypt(conc.sshPassword) : conc.sshPassword) : null;
                      concEquip = { ...conc, vendor: vendorObj?.slug || null, username: conc.sshUser, password: concPassword, apiPort: 8728 };
                    }
                  }
                  
                  const getSnmpProfileNullable = async (id: number) => {
                    const profile = await storage.getSnmpProfile(id);
                    return profile ?? null;
                  };
                  
                  return await discoverMacForLink(
                    link.monitoredIp || '',
                    oltEquip,
                    switchEquip,
                    concEquip,
                    getSnmpProfileNullable,
                    link.pppoeUser
                  );
                })();
                
                const timeoutPromise = new Promise<never>((_, reject) => 
                  setTimeout(() => reject(new Error('Timeout 30s na busca de MAC')), 30000)
                );
                
                const macResult = await Promise.race([macDiscoveryPromise, timeoutPromise]);
                finalMac = macResult.mac;
                macSource = macResult.source;
              } catch (macErr: any) {
                console.log(`[Voalle Import] ${link.name}: Erro/timeout na busca de MAC via equipamentos: ${macErr.message}`);
              }
              
              // Se não encontrou MAC via SNMP/API, tentar via RADIUS DB (por username e por IP)
              if (!finalMac) {
                try {
                  const { getMacFromRadiusByUsername, getMacFromRadiusByIp } = await import("./radius");
                  
                  // Tentar por username PPPoE primeiro
                  if (link.pppoeUser) {
                    console.log(`[Voalle Import] ${link.name}: Tentando RADIUS DB por username ${link.pppoeUser}...`);
                    const radiusMac = await getMacFromRadiusByUsername(link.pppoeUser);
                    if (radiusMac) {
                      finalMac = radiusMac;
                      macSource = "RADIUS DB (username)";
                      console.log(`[Voalle Import] ${link.name}: MAC=${radiusMac} (via RADIUS DB username)`);
                    }
                  }
                  
                  // Se não encontrou por username, tentar por IP
                  if (!finalMac && link.monitoredIp) {
                    console.log(`[Voalle Import] ${link.name}: Tentando RADIUS DB por IP ${link.monitoredIp}...`);
                    const radiusMacByIp = await getMacFromRadiusByIp(link.monitoredIp);
                    if (radiusMacByIp) {
                      finalMac = radiusMacByIp;
                      macSource = "RADIUS DB (IP)";
                      console.log(`[Voalle Import] ${link.name}: MAC=${radiusMacByIp} (via RADIUS DB IP)`);
                    }
                  }
                } catch (radiusErr: any) {
                  console.log(`[Voalle Import] ${link.name}: Erro ao buscar MAC via RADIUS: ${radiusErr.message}`);
                }
              }
              
              if (finalMac) {
                console.log(`[Voalle Import] ${link.name}: MAC=${finalMac} (via ${macSource})`);
                const vendorSlug = await detectVendorByMac(finalMac);
                console.log(`[Voalle Import] ${link.name}: Vendor slug: ${vendorSlug || 'não detectado'}`);
                if (vendorSlug) {
                  const vendor = await storage.getEquipmentVendorBySlug(vendorSlug);
                  if (vendor) {
                    console.log(`[Voalle Import] ${link.name}: Vendor: ${vendor.name} (ID: ${vendor.id})`);
                    const vendorCpe = await storage.getStandardCpeByVendor(vendor.id);
                    if (vendorCpe) {
                      linkedCpe = vendorCpe;
                      console.log(`[Voalle Import] ${link.name}: CPE padrão vinculada: ${vendorCpe.name}`);
                      cpesLinkedByVendor++;
                    } else {
                      console.log(`[Voalle Import] ${link.name}: Nenhuma CPE padrão para vendor ${vendor.name}`);
                    }
                  } else {
                    console.log(`[Voalle Import] ${link.name}: Vendor ${vendorSlug} não encontrado no sistema`);
                  }
                }
              } else {
                console.log(`[Voalle Import] ${link.name}: MAC não encontrado em nenhum equipamento nem RADIUS`);
              }
              
              // Fallback: usar CPE padrão genérica
              if (!linkedCpe && genericStandardCpe) {
                linkedCpe = genericStandardCpe;
                cpesLinkedGeneric++;
              }
              
              // Vincular CPE ao link (incluindo MAC se descoberto)
              if (linkedCpe) {
                await storage.addCpeToLink({
                  linkId: link.id,
                  cpeId: linkedCpe.id,
                  role: 'primary',
                  ipOverride: link.monitoredIp,
                  macAddress: finalMac || undefined,
                  showInEquipmentTab: true,
                });
              }
            }
            
            if (cpesLinkedByVendor > 0 || cpesLinkedGeneric > 0) {
              console.log(`[Voalle Import] CPEs vinculadas: ${cpesLinkedByVendor} por vendor, ${cpesLinkedGeneric} genéricas`);
            }
          } catch (cpeError) {
            console.error(`[Voalle Import] Erro ao vincular CPEs padrão:`, cpeError);
          }
        } catch (lookupError) {
          console.error(`[Voalle Import] Erro na busca de IPs via PPPoE:`, lookupError);
        }
      }

      // Lookup Corporate links: ifIndex via VLAN interface + IP via ARP table
      let corporateIpsFound = 0;
      if (results.success > 0) {
        console.log(`[Voalle Import] Iniciando busca de IPs para links corporativos via VLAN/ARP...`);
        importJobStatus.phase = 'corporate_lookup';
        
        try {
          const { lookupCorporateLinkInfo, detectVendorByMac } = await import("./concentrator");
          
          const importedLinks = await storage.getLinks();
          let corporateLinksNeedingIp = importedLinks.filter((l: typeof importedLinks[0]) => 
            l.authType === 'corporate' &&
            l.vlanInterface && 
            (!l.monitoredIp || l.monitoredIp === "") && 
            l.concentratorId
          );
          
          importJobStatus.corporateTotal = corporateLinksNeedingIp.length;
          importJobStatus.maxRetryRounds = 3;
          
          const MAX_CORP_ROUNDS = 3;
          for (let round = 1; round <= MAX_CORP_ROUNDS && corporateLinksNeedingIp.length > 0; round++) {
            importJobStatus.retryRound = round;
            importJobStatus.corporateCurrent = 0;
            importJobStatus.corporateTotal = corporateLinksNeedingIp.length;
            
            if (round > 1) {
              console.log(`[Voalle Import] Corporate Retry round ${round}/${MAX_CORP_ROUNDS}: ${corporateLinksNeedingIp.length} links pendentes, aguardando 10s...`);
              await new Promise(r => setTimeout(r, 10000));
            }
            
            console.log(`[Voalle Import] [Round ${round}] ${corporateLinksNeedingIp.length} links corporativos precisando de IP`);
            
            const linksByConcentrator = new Map<number, typeof corporateLinksNeedingIp>();
            for (const link of corporateLinksNeedingIp) {
              if (link.concentratorId) {
                const existing = linksByConcentrator.get(link.concentratorId) || [];
                existing.push(link);
                linksByConcentrator.set(link.concentratorId, existing);
              }
            }
            
            const failedThisRound: typeof corporateLinksNeedingIp = [];
            
            for (const [concentratorId, concentratorLinks] of Array.from(linksByConcentrator.entries())) {
              const concentrator = await storage.getConcentrator(concentratorId);
              if (!concentrator) {
                failedThisRound.push(...concentratorLinks);
                importJobStatus.corporateCurrent += concentratorLinks.length;
                continue;
              }
              
              let snmpProfile = null;
              if (concentrator.snmpProfileId) {
                snmpProfile = await storage.getSnmpProfile(concentrator.snmpProfileId);
              }
              
              for (const link of concentratorLinks) {
                importJobStatus.corporateCurrent++;
                if (link.vlanInterface) {
                  try {
                    let corpInfo = await lookupCorporateLinkInfo(concentrator, link.vlanInterface, snmpProfile);
                    let usedConcentrator = concentrator;
                    
                    if (!corpInfo && concentrator.backupConcentratorId) {
                      const backupConcentrator = await storage.getConcentrator(concentrator.backupConcentratorId);
                      if (backupConcentrator) {
                        let backupSnmpProfile = null;
                        if (backupConcentrator.snmpProfileId) {
                          backupSnmpProfile = await storage.getSnmpProfile(backupConcentrator.snmpProfileId);
                        }
                        corpInfo = await lookupCorporateLinkInfo(backupConcentrator, link.vlanInterface, backupSnmpProfile);
                        if (corpInfo) usedConcentrator = backupConcentrator;
                      }
                    }
                    
                    if (corpInfo) {
                      const updateData: Record<string, any> = {
                        snmpInterfaceIndex: corpInfo.ifIndex,
                        snmpInterfaceName: corpInfo.vlanInterface,
                        trafficSourceType: 'concentrator',
                      };
                      
                      if (usedConcentrator.id !== concentrator.id) {
                        updateData.concentratorId = usedConcentrator.id;
                      }
                      
                      if (corpInfo.ipAddress) {
                        updateData.monitoredIp = corpInfo.ipAddress;
                        corporateIpsFound++;
                        importJobStatus.corporateIpsFound = corporateIpsFound;
                      }
                      
                      if (corpInfo.ipBlock && !link.ipBlock) {
                        updateData.ipBlock = corpInfo.ipBlock;
                      }
                      
                      await storage.updateLink(link.id, updateData);
                      console.log(`[Voalle Import] ${link.name}: VLAN=${corpInfo.vlanInterface}, ifIndex=${corpInfo.ifIndex}, IP=${corpInfo.ipAddress || 'N/A'}, MAC=${corpInfo.macAddress || 'N/A'} (via ${usedConcentrator.name})`);
                      
                      if (corpInfo.macAddress && corpInfo.ipAddress) {
                        try {
                          const existingLinkCpes = await storage.getLinkCpes(link.id);
                          if (existingLinkCpes.length === 0) {
                            const vendorSlug = await detectVendorByMac(corpInfo.macAddress);
                            if (vendorSlug) {
                              const vendor = await storage.getEquipmentVendorBySlug(vendorSlug);
                              if (vendor) {
                                const vendorCpe = await storage.getStandardCpeByVendor(vendor.id);
                                if (vendorCpe) {
                                  await storage.addCpeToLink({
                                    linkId: link.id,
                                    cpeId: vendorCpe.id,
                                    role: 'primary',
                                    ipOverride: corpInfo.ipAddress,
                                    macAddress: corpInfo.macAddress || undefined,
                                    showInEquipmentTab: true,
                                  });
                                  console.log(`[Voalle Import] ${link.name}: CPE ${vendorCpe.name} vinculada`);
                                }
                              }
                            }
                          }
                        } catch (cpeErr: any) {
                          console.error(`[Voalle Import] ${link.name}: Erro CPE: ${cpeErr.message}`);
                        }
                      }
                      
                      if (!corpInfo.ipAddress) {
                        failedThisRound.push(link);
                      }
                    } else {
                      failedThisRound.push(link);
                    }
                  } catch (linkErr: any) {
                    console.error(`[Voalle Import] Erro corporativo ${link.name}: ${linkErr.message}`);
                    failedThisRound.push(link);
                  }
                }
              }
            }
            
            corporateLinksNeedingIp = failedThisRound;
            importJobStatus.corporateFailed = failedThisRound.length;
            console.log(`[Voalle Import] [Round ${round}] Corporate: ${corporateIpsFound} IPs encontrados, ${failedThisRound.length} pendentes`);
          }
          
          console.log(`[Voalle Import] Busca corporativa concluída: ${corporateIpsFound} IPs encontrados, ${corporateLinksNeedingIp.length} não resolvidos`);
          
          // Vincular links corporativos sem CPE a CPE padrão tipo "cpe"
          try {
            let standardCpeCpes = await storage.getStandardCpesByType('cpe');
            
            // Criar CPE padrão tipo CPE se não existir nenhuma
            if (standardCpeCpes.length === 0) {
              console.log(`[Voalle Import] Criando CPE padrão tipo CPE automaticamente...`);
              const newStandardCpe = await storage.createCpe({
                name: 'CPE Padrão',
                type: 'cpe',
                isStandard: true,
                hasAccess: true,
                ownership: 'provider',
              });
              standardCpeCpes = [newStandardCpe];
              console.log(`[Voalle Import] CPE padrão criada: ${newStandardCpe.name} (ID: ${newStandardCpe.id})`);
            }
            
            if (standardCpeCpes.length > 1) {
              console.log(`[Voalle Import] Múltiplas CPEs padrão tipo CPE encontradas (${standardCpeCpes.length}) - usando a primeira: ${standardCpeCpes[0].name} (ID: ${standardCpeCpes[0].id})`);
            }
            {
              const standardCpe = standardCpeCpes[0];
              console.log(`[Voalle Import] CPE padrão (corporativo) encontrada: ${standardCpe.name} (ID: ${standardCpe.id})`);
              
              // Buscar links corporativos sem CPE associado
              const allLinks = await storage.getLinks();
              const corpLinksWithoutCpe = allLinks.filter((l: typeof allLinks[0]) => 
                l.authType === 'corporate' && 
                l.vlanInterface && 
                l.monitoredIp &&
                l.createdAt && new Date(l.createdAt).getTime() > Date.now() - 600000 // Criados nos últimos 10 minutos
              );
              
              let corpCpesLinked = 0;
              for (const link of corpLinksWithoutCpe) {
                const existingAssocs = await storage.getLinkCpes(link.id);
                if (existingAssocs.length > 0) {
                  continue;
                }
                
                await storage.addCpeToLink({
                  linkId: link.id,
                  cpeId: standardCpe.id,
                  role: 'primary',
                  ipOverride: link.monitoredIp,
                  showInEquipmentTab: true,
                });
                corpCpesLinked++;
              }
              
              if (corpCpesLinked > 0) {
                console.log(`[Voalle Import] ${corpCpesLinked} links corporativos vinculados à CPE padrão ${standardCpe.name}`);
              }
            }
          } catch (cpeError) {
            console.error(`[Voalle Import] Erro ao vincular CPEs padrão corporativas:`, cpeError);
          }
        } catch (lookupError) {
          console.error(`[Voalle Import] Erro na busca de IPs corporativos:`, lookupError);
        }
      }

      // Etapa 6: Descobrir ONU ID para links importados que tenham OLT e Serial configurados
      importJobStatus.phase = 'onu_discovery';
      importJobStatus.pppoeIpsFound = pppoeIpsFound;
      importJobStatus.corporateIpsFound = corporateIpsFound;
      importJobStatus.retryRound = 1;
      let onuIdsDiscovered = 0;
      try {
        const { searchOnuBySerial } = await import("./olt");
        
        const allLinks = await storage.getLinks();
        let linksNeedingOnuId = allLinks.filter((l: typeof allLinks[0]) => 
          processedLinkIds.includes(l.id) &&
          (l.authType === 'pppoe' || l.authType === 'corporate') && 
          l.oltId && 
          l.equipmentSerialNumber && 
          !l.onuId
        );
        
        importJobStatus.onuTotal = linksNeedingOnuId.length;
        importJobStatus.maxRetryRounds = 3;
        console.log(`[Voalle Import] Links que precisam de ONU ID: ${linksNeedingOnuId.length}`);
        
        const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
        
        const MAX_ONU_ROUNDS = 3;
        for (let round = 1; round <= MAX_ONU_ROUNDS && linksNeedingOnuId.length > 0; round++) {
          importJobStatus.retryRound = round;
          importJobStatus.onuCurrent = 0;
          importJobStatus.onuTotal = linksNeedingOnuId.length;
          
          if (round > 1) {
            console.log(`[Voalle Import] ONU Retry round ${round}/${MAX_ONU_ROUNDS}: ${linksNeedingOnuId.length} links pendentes, aguardando 15s...`);
            await delay(15000);
          }
          
          console.log(`[Voalle Import] [Round ${round}] Descobrindo ONU ID para ${linksNeedingOnuId.length} links...`);
          
          const linksByOlt = new Map<number, typeof linksNeedingOnuId>();
          for (const link of linksNeedingOnuId) {
            const oltId = link.oltId!;
            if (!linksByOlt.has(oltId)) linksByOlt.set(oltId, []);
            linksByOlt.get(oltId)!.push(link);
          }
          
          const failedThisRound: typeof linksNeedingOnuId = [];
          
          for (const [oltId, links] of Array.from(linksByOlt.entries())) {
            const olt = await storage.getOlt(oltId);
            if (!olt) {
              console.log(`[Voalle Import] OLT ${oltId} não encontrada`);
              failedThisRound.push(...links);
              importJobStatus.onuCurrent += links.length;
              continue;
            }
            
            console.log(`[Voalle Import] [Round ${round}] Buscando ONU ID em ${olt.name} para ${links.length} links...`);
            
            for (let i = 0; i < links.length; i++) {
              const link = links[i];
              importJobStatus.onuCurrent++;
              
              if (i > 0) await delay(1000);
              
              try {
                const result = await searchOnuBySerial(olt, link.equipmentSerialNumber!);
                
                if (result.success && result.onuId) {
                  const updateData: any = { onuId: result.onuId };
                  if (result.slotOlt !== undefined) updateData.slotOlt = result.slotOlt;
                  if (result.portOlt !== undefined) updateData.portOlt = result.portOlt;
                  await storage.updateLink(link.id, updateData);
                  console.log(`[Voalle Import] ${link.name}: ONU ID=${result.onuId} (slot=${result.slotOlt} port=${result.portOlt})`);
                  onuIdsDiscovered++;
                  importJobStatus.onuIdsDiscovered = onuIdsDiscovered;
                } else {
                  console.log(`[Voalle Import] ${link.name}: ONU não encontrada (${result.message})`);
                  failedThisRound.push(link);
                }
              } catch (onuErr: any) {
                console.error(`[Voalle Import] ${link.name}: Erro ONU: ${onuErr.message}`);
                failedThisRound.push(link);
              }
            }
            
            await delay(2000);
          }
          
          linksNeedingOnuId = failedThisRound;
          importJobStatus.onuFailed = failedThisRound.length;
          console.log(`[Voalle Import] [Round ${round}] ONU: ${onuIdsDiscovered} descobertos, ${failedThisRound.length} pendentes`);
        }
        
        console.log(`[Voalle Import] Descoberta ONU concluída: ${onuIdsDiscovered} descobertos, ${linksNeedingOnuId.length} não resolvidos`);
      } catch (onuError) {
        console.error(`[Voalle Import] Erro na descoberta de ONU IDs:`, onuError);
      }

      // Update final job status
      importJobStatus.pppoeIpsFound = pppoeIpsFound;
      importJobStatus.corporateIpsFound = corporateIpsFound;
      importJobStatus.onuIdsDiscovered = onuIdsDiscovered;
      importJobStatus.status = 'completed';
      importJobStatus.phase = 'done';
      importJobStatus.completedAt = new Date().toISOString();
      console.log(`[Voalle Import] Background discovery completed: PPPoE=${pppoeIpsFound}, Corporate=${corporateIpsFound}, ONU=${onuIdsDiscovered}`);

      // Clean up job after 10 minutes
      setTimeout(() => activeImportJobs.delete(jobId), 600000);

        } catch (bgError: any) {
          console.error("[Voalle Import] Background discovery error:", bgError);
          importJobStatus.status = 'error';
          importJobStatus.phase = 'done';
          importJobStatus.completedAt = new Date().toISOString();
          importJobStatus.bgError = bgError?.message;
          setTimeout(() => activeImportJobs.delete(jobId), 600000);
        }
      };
      
      // Fire and forget - don't await
      runBackgroundDiscovery().catch(err => {
        console.error("[Voalle Import] Fatal background error:", err);
      });

    } catch (error: any) {
      console.error("Error in Voalle import:", error);
      console.error("Error stack:", error?.stack);
      if (!res.headersSent) {
        res.status(500).json({ error: "Falha na importação do Voalle", details: error?.message });
      }
    }
  });

  // Voalle Import Job Status - polling endpoint for background discovery progress
  app.get("/api/admin/voalle-import-status/:jobId", requireAuth, async (req, res) => {
    try {
      if (!req.user?.isSuperAdmin) {
        return res.status(403).json({ error: "Apenas super admins" });
      }
      const job = activeImportJobs.get(req.params.jobId);
      if (!job) {
        return res.status(404).json({ status: 'not_found', phase: 'done', jobId: req.params.jobId });
      }
      res.json(job);
    } catch (error) {
      res.status(500).json({ error: "Erro ao verificar status" });
    }
  });

  // Link Traffic Interfaces - Múltiplas interfaces de tráfego por link
  app.get("/api/links/:linkId/traffic-interfaces", requireAuth, async (req, res) => {
    try {
      const { allowed } = await validateLinkAccess(req, parseInt(req.params.linkId, 10));
      if (!allowed) {
        return res.status(403).json({ error: "Acesso negado" });
      }
      const linkId = parseInt(req.params.linkId, 10);
      const interfaces = await storage.getLinkTrafficInterfaces(linkId);
      res.json(interfaces);
    } catch (error) {
      console.error("Error fetching link traffic interfaces:", error);
      res.status(500).json({ error: "Falha ao buscar interfaces de tráfego" });
    }
  });

  app.post("/api/links/:linkId/traffic-interfaces", requireAuth, async (req, res) => {
    try {
      if (!req.user?.isSuperAdmin) {
        return res.status(403).json({ error: "Apenas super admins podem adicionar interfaces de tráfego" });
      }
      const linkId = parseInt(req.params.linkId, 10);
      const data = insertLinkTrafficInterfaceSchema.parse({ ...req.body, linkId });
      const iface = await storage.createLinkTrafficInterface(data);
      res.json(iface);
    } catch (error) {
      console.error("Error creating link traffic interface:", error);
      res.status(400).json({ error: "Falha ao criar interface de tráfego" });
    }
  });

  app.patch("/api/links/:linkId/traffic-interfaces/:id", requireAuth, async (req, res) => {
    try {
      if (!req.user?.isSuperAdmin) {
        return res.status(403).json({ error: "Apenas super admins podem editar interfaces de tráfego" });
      }
      const linkId = parseInt(req.params.linkId, 10);
      const id = parseInt(req.params.id, 10);
      const existing = await storage.getLinkTrafficInterface(id);
      if (!existing) {
        return res.status(404).json({ error: "Interface de tráfego não encontrada" });
      }
      // Verificar se a interface pertence ao link especificado
      if (existing.linkId !== linkId) {
        return res.status(403).json({ error: "Interface não pertence ao link especificado" });
      }
      const iface = await storage.updateLinkTrafficInterface(id, req.body);
      res.json(iface);
    } catch (error) {
      console.error("Error updating link traffic interface:", error);
      res.status(400).json({ error: "Falha ao atualizar interface de tráfego" });
    }
  });

  app.delete("/api/links/:linkId/traffic-interfaces/:id", requireAuth, async (req, res) => {
    try {
      if (!req.user?.isSuperAdmin) {
        return res.status(403).json({ error: "Apenas super admins podem excluir interfaces de tráfego" });
      }
      const linkId = parseInt(req.params.linkId, 10);
      const id = parseInt(req.params.id, 10);
      const existing = await storage.getLinkTrafficInterface(id);
      if (!existing) {
        return res.status(404).json({ error: "Interface de tráfego não encontrada" });
      }
      // Verificar se a interface pertence ao link especificado
      if (existing.linkId !== linkId) {
        return res.status(403).json({ error: "Interface não pertence ao link especificado" });
      }
      await storage.deleteLinkTrafficInterface(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting link traffic interface:", error);
      res.status(500).json({ error: "Falha ao excluir interface de tráfego" });
    }
  });

  // Métricas das interfaces de tráfego adicionais
  app.get("/api/links/:linkId/traffic-interface-metrics", requireAuth, async (req, res) => {
    try {
      const { allowed } = await validateLinkAccess(req, parseInt(req.params.linkId, 10));
      if (!allowed) {
        return res.status(403).json({ error: "Acesso negado" });
      }
      const linkId = parseInt(req.params.linkId, 10);
      
      // Suportar período via hours ou intervalo personalizado via from/to
      let startTime: Date;
      let endTime: Date;
      
      if (req.query.from && req.query.to) {
        startTime = new Date(req.query.from as string);
        endTime = new Date(req.query.to as string);
      } else {
        const hours = req.query.hours ? parseInt(req.query.hours as string, 10) : 1;
        endTime = new Date();
        startTime = new Date(endTime.getTime() - hours * 60 * 60 * 1000);
      }
      
      // Buscar interfaces configuradas e suas métricas
      const interfaces = await storage.getEnabledLinkTrafficInterfaces(linkId);
      const metricsData = await storage.getTrafficInterfaceMetrics(linkId, startTime, endTime);
      
      // Agrupar métricas por interface
      const result = interfaces.map((iface) => {
        const ifaceMetrics = metricsData.filter((m) => m.trafficInterfaceId === iface.id);
        return {
          interface: {
            id: iface.id,
            label: iface.label,
            color: iface.color,
            displayOrder: iface.displayOrder,
            invertBandwidth: iface.invertBandwidth,
          },
          metrics: ifaceMetrics,
        };
      });
      
      res.json(result);
    } catch (error) {
      console.error("Error fetching traffic interface metrics:", error);
      res.status(500).json({ error: "Falha ao buscar métricas de interfaces de tráfego" });
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
      const data = { ...req.body };
      if (data.voalleIds !== undefined) {
        const trimmed = String(data.voalleIds ?? '').trim();
        if (!trimmed) delete data.voalleIds;
        else data.voalleIds = trimmed;
      }
      const olt = await storage.updateOlt(id, data);
      if (!olt) {
        return res.status(404).json({ error: "OLT não encontrada" });
      }
      res.json(olt);
    } catch (error: any) {
      console.error("[OLT PATCH] Erro ao atualizar OLT:", error?.message || error);
      res.status(500).json({ error: "Falha ao atualizar OLT", details: error?.message });
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

  // Teste de conexão SNMP para OLT
  app.post("/api/olts/:id/test-snmp", requireSuperAdmin, async (req, res) => {
    try {
      const olt = await storage.getOlt(parseInt(req.params.id, 10));
      if (!olt) {
        return res.status(404).json({ error: "OLT não encontrada" });
      }
      
      if (!olt.snmpProfileId) {
        return res.json({ 
          success: false, 
          error: "OLT não possui perfil SNMP configurado" 
        });
      }
      
      const snmpProfile = await storage.getSnmpProfile(olt.snmpProfileId);
      if (!snmpProfile) {
        return res.json({ 
          success: false, 
          error: "Perfil SNMP não encontrado" 
        });
      }
      
      const { testSnmpConnection } = await import("./snmp");
      const result = await testSnmpConnection(olt.ipAddress, {
        id: snmpProfile.id,
        version: snmpProfile.version,
        port: snmpProfile.port,
        community: snmpProfile.community,
        securityLevel: snmpProfile.securityLevel,
        authProtocol: snmpProfile.authProtocol,
        authPassword: snmpProfile.authPassword,
        privProtocol: snmpProfile.privProtocol,
        privPassword: snmpProfile.privPassword,
        username: snmpProfile.username,
        timeout: snmpProfile.timeout,
        retries: snmpProfile.retries,
      });
      
      res.json(result);
    } catch (error) {
      console.error("Erro ao testar SNMP:", error);
      res.status(500).json({ 
        success: false, 
        error: "Falha ao testar conexão SNMP" 
      });
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

  // ============ Switches (PTP) Routes ============

  app.get("/api/switches", requireAuth, async (req, res) => {
    try {
      const switchList = await storage.getSwitches();
      res.json(switchList);
    } catch (error) {
      res.status(500).json({ error: "Falha ao buscar switches" });
    }
  });

  app.get("/api/switches/:id", requireAuth, async (req, res) => {
    try {
      const sw = await storage.getSwitch(parseInt(req.params.id, 10));
      if (!sw) {
        return res.status(404).json({ error: "Switch não encontrado" });
      }
      res.json(sw);
    } catch (error) {
      res.status(500).json({ error: "Falha ao buscar switch" });
    }
  });

  app.post("/api/switches", requireSuperAdmin, async (req, res) => {
    try {
      const data = insertSwitchSchema.parse(req.body);
      const sw = await storage.createSwitch(data);
      res.status(201).json(sw);
    } catch (error) {
      console.error("Error creating switch:", error);
      res.status(400).json({ error: "Dados de switch inválidos" });
    }
  });

  app.patch("/api/switches/:id", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const data = { ...req.body };
      if (data.voalleIds !== undefined) {
        const trimmed = String(data.voalleIds ?? '').trim();
        if (!trimmed) delete data.voalleIds;
        else data.voalleIds = trimmed;
      }
      if (!data.sshPassword) {
        delete data.sshPassword;
      }
      const sw = await storage.updateSwitch(id, data);
      if (!sw) {
        return res.status(404).json({ error: "Switch não encontrado" });
      }
      res.json(sw);
    } catch (error) {
      res.status(500).json({ error: "Falha ao atualizar switch" });
    }
  });

  app.delete("/api/switches/:id", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      await storage.deleteSwitch(id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Falha ao excluir switch" });
    }
  });

  app.post("/api/switches/:id/test-ssh", requireSuperAdmin, async (req, res) => {
    try {
      const sw = await storage.getSwitch(parseInt(req.params.id, 10));
      if (!sw) {
        return res.status(404).json({ error: "Switch não encontrado" });
      }

      // Testar conexão SSH
      const { Client } = require("ssh2");
      const conn = new Client();
      
      const result = await new Promise<{ success: boolean; message: string }>((resolve) => {
        const timeout = setTimeout(() => {
          conn.end();
          resolve({ success: false, message: "Timeout de conexão (10s)" });
        }, 10000);

        conn.on("ready", () => {
          clearTimeout(timeout);
          conn.end();
          resolve({ success: true, message: "Conexão SSH bem-sucedida" });
        });

        conn.on("error", (err: Error) => {
          clearTimeout(timeout);
          resolve({ success: false, message: `Erro: ${err.message}` });
        });

        const password = sw.sshPassword ? (isEncrypted(sw.sshPassword) ? decrypt(sw.sshPassword) : sw.sshPassword) : "";
        
        conn.connect({
          host: sw.ipAddress,
          port: sw.sshPort || 22,
          username: sw.sshUser || "admin",
          password: password,
          readyTimeout: 10000,
        });
      });

      res.json(result);
    } catch (error) {
      console.error("Erro ao testar SSH do switch:", error);
      res.status(500).json({ error: "Falha ao testar conexão SSH" });
    }
  });

  app.post("/api/switches/:id/test-snmp", requireSuperAdmin, async (req, res) => {
    try {
      const sw = await storage.getSwitch(parseInt(req.params.id, 10));
      if (!sw) {
        return res.status(404).json({ error: "Switch não encontrado" });
      }

      if (!sw.snmpProfileId) {
        return res.status(400).json({ error: "Switch sem perfil SNMP configurado" });
      }

      const profile = await storage.getSnmpProfile(sw.snmpProfileId);
      if (!profile) {
        return res.status(404).json({ error: "Perfil SNMP não encontrado" });
      }

      // Testar conectividade SNMP com sysName
      const snmp = require("net-snmp");
      const options = {
        port: 161,
        retries: 1,
        timeout: 5000,
        version: profile.version === "3" ? snmp.Version3 : (profile.version === "2c" ? snmp.Version2c : snmp.Version1),
      };

      let session: any;
      if (profile.version === "3") {
        const user = {
          name: profile.username || "admin",
          level: snmp.SecurityLevel.authPriv,
          authProtocol: profile.authProtocol === "SHA" ? snmp.AuthProtocols.sha : snmp.AuthProtocols.md5,
          authKey: profile.authPassword || "",
          privProtocol: profile.privProtocol === "AES" ? snmp.PrivProtocols.aes : snmp.PrivProtocols.des,
          privKey: profile.privPassword || "",
        };
        session = snmp.createV3Session(sw.ipAddress, user, options);
      } else {
        session = snmp.createSession(sw.ipAddress, profile.community || "public", options);
      }

      const sysNameOid = "1.3.6.1.2.1.1.5.0";
      
      const result = await new Promise<{ success: boolean; message: string; sysName?: string }>((resolve) => {
        session.get([sysNameOid], (error: Error, varbinds: any[]) => {
          session.close();
          if (error) {
            resolve({ success: false, message: `Erro SNMP: ${error.message}` });
          } else if (snmp.isVarbindError(varbinds[0])) {
            resolve({ success: false, message: `Erro: ${snmp.varbindError(varbinds[0])}` });
          } else {
            resolve({
              success: true,
              message: "Conexão SNMP bem-sucedida",
              sysName: varbinds[0].value.toString(),
            });
          }
        });
      });

      res.json(result);
    } catch (error) {
      console.error("Erro ao testar SNMP do switch:", error);
      res.status(500).json({ error: "Falha ao testar conexão SNMP" });
    }
  });

  // ============ Cisco Entity MIB Discovery Routes ============
  
  // Helper para verificar se é chamada local (bypass auth)
  const isLocalRequest = (req: Request): boolean => {
    const ip = req.ip || req.socket.remoteAddress || "";
    return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
  };
  
  // Executar discovery de sensores Cisco para um switch
  // Permite chamadas locais (localhost) sem autenticação para scripts administrativos
  app.post("/api/switches/:id/discover-sensors", async (req, res, next) => {
    if (isLocalRequest(req)) {
      return next(); // Bypass auth para localhost
    }
    return requireSuperAdmin(req, res, next);
  }, async (req, res) => {
    try {
      const switchId = parseInt(req.params.id, 10);
      const sw = await storage.getSwitch(switchId);
      if (!sw) {
        return res.status(404).json({ error: "Switch não encontrado" });
      }

      if (!sw.snmpProfileId) {
        return res.status(400).json({ error: "Switch sem perfil SNMP configurado" });
      }

      const profile = await storage.getSnmpProfile(sw.snmpProfileId);
      if (!profile) {
        return res.status(404).json({ error: "Perfil SNMP não encontrado" });
      }

      // Importar função de discovery
      const { discoverCiscoSensors } = await import("./snmp");
      
      // Executar discovery
      const sensors = await discoverCiscoSensors(sw.ipAddress, {
        id: profile.id,
        version: profile.version,
        port: profile.port ?? 161,
        community: profile.community,
        securityLevel: profile.securityLevel,
        authProtocol: profile.authProtocol,
        authPassword: profile.authPassword,
        privProtocol: profile.privProtocol,
        privPassword: profile.privPassword,
        username: profile.username,
        timeout: profile.timeout ?? 5000,
        retries: profile.retries ?? 1,
      });

      if (sensors.length === 0) {
        return res.json({ 
          success: false, 
          message: "Nenhum sensor óptico encontrado. Verifique se o switch suporta Entity MIB.",
          sensors: []
        });
      }

      // Salvar no cache
      const { switchSensorCache } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      
      // Remover entradas antigas deste switch
      await db.delete(switchSensorCache).where(eq(switchSensorCache.switchId, switchId));
      
      // Inserir novas entradas
      const now = new Date();
      for (const sensor of sensors) {
        await db.insert(switchSensorCache).values({
          switchId,
          portName: sensor.portName,
          rxSensorIndex: sensor.rxSensorIndex,
          txSensorIndex: sensor.txSensorIndex,
          tempSensorIndex: sensor.tempSensorIndex,
          lastDiscovery: now,
        });
      }

      res.json({ 
        success: true, 
        message: `Discovery concluído: ${sensors.length} portas com sensores encontradas`,
        sensors 
      });
    } catch (error) {
      console.error("Erro no discovery de sensores Cisco:", error);
      res.status(500).json({ error: "Falha no discovery de sensores" });
    }
  });

  // Buscar cache de sensores de um switch
  app.get("/api/switches/:id/sensor-cache", requireAuth, async (req, res) => {
    try {
      const switchId = parseInt(req.params.id, 10);
      const { switchSensorCache } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      
      const cache = await db.select().from(switchSensorCache).where(eq(switchSensorCache.switchId, switchId));
      res.json(cache);
    } catch (error) {
      console.error("Erro ao buscar cache de sensores:", error);
      res.status(500).json({ error: "Falha ao buscar cache de sensores" });
    }
  });

  // Buscar sensor específico por porta
  app.get("/api/switches/:id/sensor-cache/:portName", requireAuth, async (req, res) => {
    try {
      const switchId = parseInt(req.params.id, 10);
      const portName = decodeURIComponent(req.params.portName);
      const { switchSensorCache } = await import("@shared/schema");
      const { eq, and } = await import("drizzle-orm");
      
      const sensor = await db.select().from(switchSensorCache).where(
        and(
          eq(switchSensorCache.switchId, switchId),
          eq(switchSensorCache.portName, portName)
        )
      ).limit(1);
      
      if (sensor.length === 0) {
        return res.status(404).json({ error: "Sensor não encontrado no cache" });
      }
      
      res.json(sensor[0]);
    } catch (error) {
      console.error("Erro ao buscar sensor:", error);
      res.status(500).json({ error: "Falha ao buscar sensor" });
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
      const data = { ...req.body };
      if (data.voalleIds !== undefined) {
        const trimmed = String(data.voalleIds ?? '').trim();
        if (!trimmed) delete data.voalleIds;
        else data.voalleIds = trimmed;
      }
      if (data.voalleAccessPointIds !== undefined) {
        const trimmed = String(data.voalleAccessPointIds ?? '').trim();
        if (!trimmed) delete data.voalleAccessPointIds;
        else data.voalleAccessPointIds = trimmed;
      }
      if (!data.sshPassword) {
        delete data.sshPassword;
      }
      const concentrator = await storage.updateConcentrator(id, data);
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
        const { stdout: date } = await execAsync("git log -1 --format=%cI");
        lastUpdate = date.trim(); // ISO 8601 format
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
      const fs = await import("fs");
      
      // Execute the update script
      const updateScript = "/opt/link-monitor/deploy/update-from-github.sh";
      const logFile = "/var/log/link-monitor-update.log";
      
      // Check if script exists
      if (!fs.existsSync(updateScript)) {
        return res.status(404).json({ 
          error: "Script de atualização não encontrado",
          details: `O arquivo ${updateScript} não existe no servidor`
        });
      }
      
      // Use systemd-run to create a transient unit that runs outside our cgroup
      // This survives when systemd kills link-monitor.service
      const command = `sudo systemd-run --scope --unit=link-monitor-update bash -c "bash ${updateScript} > ${logFile} 2>&1"`;
      
      exec(command, (error: Error | null) => {
        if (error) {
          console.error("Failed to start update via systemd-run:", error);
        }
      });
      
      console.log("Update started via systemd-run");
      
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
      
      const entries = fs.readdirSync(backupDir, { withFileTypes: true });
      const backups = entries
        .filter(entry => {
          // Include directories starting with "backup-" or files with backup extensions
          if (entry.isDirectory()) {
            return entry.name.startsWith("backup-");
          }
          return entry.name.endsWith(".tar.gz") || entry.name.endsWith(".zip") || 
                 entry.name.endsWith(".sql") || entry.name.endsWith(".backup");
        })
        .map(entry => {
          const filePath = path.join(backupDir, entry.name);
          const stats = fs.statSync(filePath);
          let size = stats.size;
          
          // For directories, calculate total size
          if (entry.isDirectory()) {
            try {
              const { execSync } = require("child_process");
              const duOutput = execSync(`du -sb "${filePath}"`).toString();
              size = parseInt(duOutput.split("\t")[0]) || 0;
            } catch (e) {
              size = 0;
            }
          }
          
          return {
            name: entry.name,
            path: filePath,
            size: size,
            sizeFormatted: formatBytes(size),
            createdAt: stats.mtime.toISOString(),
            isDirectory: entry.isDirectory(),
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

  // ===========================================
  // AUDIT LOGS ENDPOINTS
  // ===========================================
  
  app.get("/api/audit", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const { 
        clientId, 
        action, 
        entity, 
        actorId,
        startDate,
        endDate,
        status,
        page = "1", 
        limit = "50" 
      } = req.query;
      
      const pageNum = Math.max(1, parseInt(page as string, 10));
      const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10)));
      const offset = (pageNum - 1) * limitNum;
      
      const filters: Record<string, any> = {};
      if (clientId) filters.clientId = parseInt(clientId as string, 10);
      if (action) filters.action = action as string;
      if (entity) filters.entity = entity as string;
      if (actorId) filters.actorId = parseInt(actorId as string, 10);
      if (status) filters.status = status as string;
      if (startDate) filters.startDate = new Date(startDate as string);
      if (endDate) filters.endDate = new Date(endDate as string);
      
      const { logs, total } = await storage.getAuditLogs(filters, limitNum, offset);
      
      res.json({
        logs,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        }
      });
    } catch (error) {
      console.error("Failed to fetch audit logs:", error);
      res.status(500).json({ error: "Falha ao buscar logs de auditoria" });
    }
  });
  
  app.get("/api/audit/:id", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const logId = parseInt(req.params.id, 10);
      const log = await storage.getAuditLogById(logId);
      
      if (!log) {
        return res.status(404).json({ error: "Log não encontrado" });
      }
      
      res.json(log);
    } catch (error) {
      console.error("Failed to fetch audit log:", error);
      res.status(500).json({ error: "Falha ao buscar log de auditoria" });
    }
  });
  
  app.get("/api/audit/stats/summary", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const { days = "7" } = req.query;
      const daysNum = parseInt(days as string, 10);
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - daysNum);
      
      const summary = await storage.getAuditLogsSummary(startDate);
      res.json(summary);
    } catch (error) {
      console.error("Failed to fetch audit summary:", error);
      res.status(500).json({ error: "Falha ao buscar resumo de auditoria" });
    }
  });

  // ============ RADIUS Authentication Settings ============
  app.get("/api/radius/settings", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const settings = await storage.getRadiusSettings();
      if (!settings) {
        return res.json({ configured: false });
      }
      res.json({
        configured: true,
        isEnabled: settings.isEnabled,
        primaryHost: settings.primaryHost,
        primaryPort: settings.primaryPort,
        secondaryHost: settings.secondaryHost,
        secondaryPort: settings.secondaryPort,
        nasIdentifier: settings.nasIdentifier,
        timeout: settings.timeout,
        retries: settings.retries,
        allowLocalFallback: settings.allowLocalFallback,
        useRadiusForDevices: settings.useRadiusForDevices,
        lastHealthCheck: settings.lastHealthCheck,
        lastHealthStatus: settings.lastHealthStatus,
      });
    } catch (error) {
      console.error("[RADIUS] Error fetching settings:", error);
      res.status(500).json({ error: "Erro ao buscar configurações RADIUS" });
    }
  });

  app.post("/api/radius/settings", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const { encrypt } = await import("./crypto");
      
      const {
        isEnabled,
        primaryHost,
        primaryPort,
        sharedSecret,
        secondaryHost,
        secondaryPort,
        secondarySecret,
        nasIdentifier,
        timeout,
        retries,
        allowLocalFallback,
        useRadiusForDevices,
      } = req.body;

      if (!primaryHost) {
        return res.status(400).json({ error: "Host do servidor RADIUS é obrigatório" });
      }

      const existingSettings = await storage.getRadiusSettings();
      
      if (!sharedSecret && !existingSettings) {
        return res.status(400).json({ error: "Shared secret é obrigatório na primeira configuração" });
      }

      const settings = await storage.saveRadiusSettings({
        isEnabled: isEnabled ?? false,
        primaryHost,
        primaryPort: primaryPort || 1812,
        sharedSecretEncrypted: sharedSecret ? encrypt(sharedSecret) : existingSettings!.sharedSecretEncrypted,
        secondaryHost: secondaryHost || null,
        secondaryPort: secondaryPort || 1812,
        secondarySecretEncrypted: secondarySecret 
          ? encrypt(secondarySecret) 
          : (secondaryHost ? existingSettings?.secondarySecretEncrypted || null : null),
        nasIdentifier: nasIdentifier || "LinkMonitor",
        timeout: timeout || 5000,
        retries: retries || 3,
        allowLocalFallback: allowLocalFallback ?? true,
        useRadiusForDevices: useRadiusForDevices ?? false,
      });

      await logAuditEvent({
        actor: req.user!,
        action: "config_change",
        entity: "settings",
        entityName: "RADIUS",
        current: { isEnabled, primaryHost, primaryPort, nasIdentifier },
        request: req,
      });

      res.json({ success: true, isEnabled: settings.isEnabled });
    } catch (error) {
      console.error("[RADIUS] Error saving settings:", error);
      res.status(500).json({ error: "Erro ao salvar configurações RADIUS" });
    }
  });

  app.post("/api/radius/test", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const { createRadiusServiceFromSettings } = await import("./radius");
      const { encrypt } = await import("./crypto");
      
      const { host, port, sharedSecret, nasIdentifier } = req.body;

      if (!host || !sharedSecret) {
        return res.status(400).json({ error: "Host e shared secret são obrigatórios" });
      }

      const radiusService = await createRadiusServiceFromSettings({
        primaryHost: host,
        primaryPort: port || 1812,
        sharedSecretEncrypted: encrypt(sharedSecret),
        nasIdentifier: nasIdentifier || "LinkMonitor",
        timeout: 5000,
        retries: 2,
      });

      const result = await radiusService.testConnection();

      await storage.updateRadiusHealthStatus(result.success ? "online" : "offline");

      res.json(result);
    } catch (error) {
      console.error("[RADIUS] Test error:", error);
      res.status(500).json({ 
        success: false, 
        message: `Erro ao testar conexão: ${error instanceof Error ? error.message : String(error)}`,
        code: "SERVER_ERROR",
      });
    }
  });

  app.post("/api/radius/test-saved", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const { createRadiusServiceFromSettings } = await import("./radius");
      
      const settings = await storage.getRadiusSettings();
      if (!settings) {
        return res.status(400).json({ 
          success: false, 
          message: "RADIUS não está configurado",
          code: "NOT_CONFIGURED",
        });
      }

      const radiusService = await createRadiusServiceFromSettings({
        primaryHost: settings.primaryHost,
        primaryPort: settings.primaryPort,
        sharedSecretEncrypted: settings.sharedSecretEncrypted,
        nasIdentifier: settings.nasIdentifier,
        timeout: 3000,
        retries: 1,
      });

      const result = await radiusService.testConnection();

      await storage.updateRadiusHealthStatus(result.success ? "online" : "offline");

      res.json(result);
    } catch (error) {
      console.error("[RADIUS] Test-saved error:", error);
      res.status(500).json({ 
        success: false, 
        message: `Erro ao testar conexão: ${error instanceof Error ? error.message : String(error)}`,
        code: "SERVER_ERROR",
      });
    }
  });

  app.post("/api/radius/authenticate", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const { createRadiusServiceFromSettings } = await import("./radius");
      
      const { username, password } = req.body;

      if (!username || !password) {
        return res.status(400).json({ error: "Usuário e senha são obrigatórios" });
      }

      const settings = await storage.getRadiusSettings();
      if (!settings || !settings.isEnabled) {
        return res.status(400).json({ error: "RADIUS não está configurado ou habilitado" });
      }

      const radiusService = await createRadiusServiceFromSettings({
        primaryHost: settings.primaryHost,
        primaryPort: settings.primaryPort,
        sharedSecretEncrypted: settings.sharedSecretEncrypted,
        nasIdentifier: settings.nasIdentifier,
        timeout: settings.timeout,
        retries: settings.retries,
      });

      const result = await radiusService.authenticate(username, password);

      await storage.updateRadiusHealthStatus(result.code === "TIMEOUT" ? "timeout" : result.success ? "online" : "online");

      res.json(result);
    } catch (error) {
      console.error("[RADIUS] Authentication error:", error);
      res.status(500).json({ 
        success: false, 
        message: `Erro ao autenticar: ${error instanceof Error ? error.message : String(error)}`,
        code: "SERVER_ERROR",
      });
    }
  });

  // ============ RADIUS Group Mappings ============
  app.get("/api/radius/group-mappings", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const mappings = await storage.getRadiusGroupMappings();
      res.json(mappings);
    } catch (error) {
      console.error("[RADIUS] Error fetching group mappings:", error);
      res.status(500).json({ error: "Erro ao buscar mapeamentos de grupos" });
    }
  });

  app.get("/api/radius/group-mappings/:id", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const mapping = await storage.getRadiusGroupMapping(id);
      if (!mapping) {
        return res.status(404).json({ error: "Mapeamento não encontrado" });
      }
      res.json(mapping);
    } catch (error) {
      console.error("[RADIUS] Error fetching group mapping:", error);
      res.status(500).json({ error: "Erro ao buscar mapeamento" });
    }
  });

  app.post("/api/radius/group-mappings", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const { radiusGroupName, isSuperAdmin, canManageSuperAdmins, defaultRole, description, priority } = req.body;
      
      if (!radiusGroupName) {
        return res.status(400).json({ error: "Nome do grupo RADIUS é obrigatório" });
      }
      
      const mapping = await storage.createRadiusGroupMapping({
        radiusGroupName,
        isSuperAdmin: isSuperAdmin || false,
        canManageSuperAdmins: canManageSuperAdmins || false,
        defaultRole: defaultRole || "viewer",
        description: description || null,
        priority: priority || 0,
        isActive: true,
      });
      
      res.status(201).json(mapping);
    } catch (error) {
      console.error("[RADIUS] Error creating group mapping:", error);
      res.status(500).json({ error: "Erro ao criar mapeamento" });
    }
  });

  app.patch("/api/radius/group-mappings/:id", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const existing = await storage.getRadiusGroupMapping(id);
      
      if (!existing) {
        return res.status(404).json({ error: "Mapeamento não encontrado" });
      }
      
      await storage.updateRadiusGroupMapping(id, req.body);
      const updated = await storage.getRadiusGroupMapping(id);
      res.json(updated);
    } catch (error) {
      console.error("[RADIUS] Error updating group mapping:", error);
      res.status(500).json({ error: "Erro ao atualizar mapeamento" });
    }
  });

  app.delete("/api/radius/group-mappings/:id", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const existing = await storage.getRadiusGroupMapping(id);
      
      if (!existing) {
        return res.status(404).json({ error: "Mapeamento não encontrado" });
      }
      
      await storage.deleteRadiusGroupMapping(id);
      res.json({ success: true });
    } catch (error) {
      console.error("[RADIUS] Error deleting group mapping:", error);
      res.status(500).json({ error: "Erro ao excluir mapeamento" });
    }
  });

  // ========== External Integrations (HetrixTools, etc.) ==========

  app.get("/api/external-integrations", requireSuperAdmin, async (req, res) => {
    try {
      const integrations = await storage.getExternalIntegrations();
      const sanitized = integrations.map(({ apiKey, ...rest }) => ({
        ...rest,
        hasApiKey: !!apiKey,
      }));
      res.json(sanitized);
    } catch (error) {
      console.error("[External Integrations] Error fetching:", error);
      res.status(500).json({ error: "Erro ao buscar integrações" });
    }
  });

  app.get("/api/external-integrations/:id", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const integration = await storage.getExternalIntegration(id);
      if (!integration) {
        return res.status(404).json({ error: "Integração não encontrada" });
      }
      const { apiKey, ...rest } = integration;
      res.json({ ...rest, hasApiKey: !!apiKey });
    } catch (error) {
      console.error("[External Integrations] Error fetching:", error);
      res.status(500).json({ error: "Erro ao buscar integração" });
    }
  });

  app.post("/api/external-integrations", requireSuperAdmin, async (req, res) => {
    try {
      const parsed = insertExternalIntegrationSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Dados inválidos", details: parsed.error });
      }
      const integration = await storage.createExternalIntegration(parsed.data);
      if (integration.provider === "radius_db") {
        resetRadiusDbPool();
      }
      const { apiKey, ...rest } = integration;
      res.status(201).json({ ...rest, hasApiKey: !!apiKey });
    } catch (error) {
      console.error("[External Integrations] Error creating:", error);
      res.status(500).json({ error: "Erro ao criar integração" });
    }
  });

  app.patch("/api/external-integrations/:id", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const existing = await storage.getExternalIntegration(id);
      if (!existing) {
        return res.status(404).json({ error: "Integração não encontrada" });
      }
      await storage.updateExternalIntegration(id, req.body);
      if (existing.provider === "radius_db") {
        resetRadiusDbPool();
      }
      const updated = await storage.getExternalIntegration(id);
      if (!updated) {
        return res.status(500).json({ error: "Erro ao recuperar integração atualizada" });
      }
      const { apiKey, ...rest } = updated;
      res.json({ ...rest, hasApiKey: !!apiKey });
    } catch (error) {
      console.error("[External Integrations] Error updating:", error);
      res.status(500).json({ error: "Erro ao atualizar integração" });
    }
  });

  app.delete("/api/external-integrations/:id", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const existing = await storage.getExternalIntegration(id);
      if (!existing) {
        return res.status(404).json({ error: "Integração não encontrada" });
      }
      if (existing.provider === "radius_db") {
        resetRadiusDbPool();
      }
      await storage.deleteExternalIntegration(id);
      res.json({ success: true });
    } catch (error) {
      console.error("[External Integrations] Error deleting:", error);
      res.status(500).json({ error: "Erro ao excluir integração" });
    }
  });

  app.post("/api/external-integrations/:id/test", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const integration = await storage.getExternalIntegration(id);
      if (!integration) {
        return res.status(404).json({ error: "Integração não encontrada" });
      }

      if (integration.provider === "hetrixtools") {
        const adapter = new HetrixToolsAdapter(integration);
        const result = await adapter.testConnection();
        
        await storage.updateExternalIntegration(id, {
          lastTestedAt: new Date(),
          lastTestStatus: result.success ? "success" : "error",
          lastTestError: result.error || null,
        });

        res.json(result);
      } else if (integration.provider === "ozmap") {
        // Testar conexão com OZmap
        try {
          const apiUrl = integration.apiUrl || "";
          const apiKey = integration.apiKey || "";
          
          if (!apiUrl || !apiKey) {
            throw new Error("URL ou Token não configurados");
          }

          // Normalizar URL base - remover /api/v2 se existir para evitar duplicação
          let baseUrl = apiUrl.replace(/\/+$/, ""); // Remove trailing slashes
          if (baseUrl.endsWith("/api/v2")) {
            baseUrl = baseUrl.slice(0, -7); // Remove /api/v2
          }

          // Testa buscando lista de tipos de caixas (endpoint simples que requer autenticação)
          const response = await fetch(`${baseUrl}/api/v2/box-types?page=1&limit=1`, {
            method: "GET",
            headers: {
              "Accept": "application/json",
              "Authorization": apiKey,
            },
          });

          if (response.ok) {
            await storage.updateExternalIntegration(id, {
              lastTestedAt: new Date(),
              lastTestStatus: "success",
              lastTestError: null,
            });
            res.json({ success: true });
          } else {
            const errorText = await response.text();
            await storage.updateExternalIntegration(id, {
              lastTestedAt: new Date(),
              lastTestStatus: "error",
              lastTestError: `HTTP ${response.status}: ${errorText.substring(0, 200)}`,
            });
            res.json({ success: false, error: `HTTP ${response.status}` });
          }
        } catch (error: any) {
          await storage.updateExternalIntegration(id, {
            lastTestedAt: new Date(),
            lastTestStatus: "error",
            lastTestError: error.message || "Erro desconhecido",
          });
          res.json({ success: false, error: error.message });
        }
      } else if (integration.provider === "radius_db") {
        try {
          let connData: { host?: string; port?: string; database?: string; user?: string };
          try {
            connData = JSON.parse(integration.apiUrl || "{}");
          } catch {
            throw new Error("Dados de conexão inválidos (JSON malformado)");
          }
          const password = integration.apiKey || "";
          
          if (!connData.host || !connData.database || !connData.user || !password) {
            throw new Error("Dados de conexão incompletos");
          }

          const { Pool } = (await import("pg")).default;
          const testPool = new Pool({
            host: connData.host,
            port: parseInt(connData.port || "5432", 10),
            database: connData.database,
            user: connData.user,
            password: password,
            max: 1,
            connectionTimeoutMillis: 10000,
          });

          const client = await testPool.connect();
          try {
            const result = await client.query("SELECT COUNT(*) as count FROM radacct WHERE acctstoptime IS NULL");
            const count = parseInt(result.rows[0].count, 10);
            
            await storage.updateExternalIntegration(id, {
              lastTestedAt: new Date(),
              lastTestStatus: "success",
              lastTestError: null,
            });
            
            res.json({ success: true, message: `Conexão OK - ${count} sessões ativas` });
          } finally {
            client.release();
            await testPool.end();
          }
        } catch (error: any) {
          await storage.updateExternalIntegration(id, {
            lastTestedAt: new Date(),
            lastTestStatus: "error",
            lastTestError: error.message || "Erro desconhecido",
          });
          res.json({ success: false, error: error.message });
        }
      } else {
        res.status(400).json({ error: "Provider não suportado para teste" });
      }
    } catch (error) {
      console.error("[External Integrations] Error testing:", error);
      res.status(500).json({ error: "Erro ao testar integração" });
    }
  });

  // ========== OZmap Integration API ==========

  // Buscar dados de potência/rota de fibra do OZmap
  app.get("/api/ozmap/potency/:tag", requireAuth, async (req, res) => {
    try {
      const { tag } = req.params;
      
      const integration = await storage.getExternalIntegrationByProvider("ozmap");
      if (!integration || !integration.apiKey || !integration.apiUrl) {
        return res.status(400).json({ error: "OZmap não configurado" });
      }

      if (!integration.isActive) {
        return res.status(400).json({ error: "Integração OZmap está desativada" });
      }

      // Normalizar URL base - remover /api/v2 se existir para evitar duplicação
      let baseUrl = integration.apiUrl.replace(/\/+$/, ""); // Remove trailing slashes
      if (baseUrl.endsWith("/api/v2")) {
        baseUrl = baseUrl.slice(0, -7); // Remove /api/v2
      }

      const response = await fetch(
        `${baseUrl}/api/v2/properties/client/${encodeURIComponent(tag)}/potency?locale=pt_BR`,
        {
          method: "GET",
          headers: {
            "Accept": "application/json",
            "Authorization": integration.apiKey,
          },
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error("[OZmap] Error fetching potency:", response.status, errorText);
        return res.status(response.status).json({ 
          error: `Erro ao consultar OZmap: HTTP ${response.status}`,
          details: errorText.substring(0, 200)
        });
      }

      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      console.error("[OZmap] Error:", error);
      res.status(500).json({ error: "Erro ao consultar OZmap", details: error.message });
    }
  });

  // Buscar dados de potência para um link específico (usando ozmapTag do link)
  app.get("/api/links/:linkId/ozmap-potency", requireAuth, async (req, res) => {
    try {
      const linkId = parseInt(req.params.linkId, 10);
      const link = await storage.getLink(linkId);
      
      if (!link) {
        return res.status(404).json({ error: "Link não encontrado" });
      }

      if (req.user && !req.user.isSuperAdmin && req.user.clientId !== link.clientId) {
        return res.status(403).json({ error: "Acesso negado" });
      }

      // Usa a tag do contrato Voalle, identificador do link, ou campo separado para OZmap
      const ozmapTag = link.voalleContractTagServiceTag || link.identifier || (link as any).ozmapTag;
      if (!ozmapTag) {
        return res.status(400).json({ error: "Link não possui identificador ou etiqueta do contrato Voalle configurada" });
      }

      const integration = await storage.getExternalIntegrationByProvider("ozmap");
      if (!integration || !integration.apiKey || !integration.apiUrl) {
        return res.status(400).json({ error: "OZmap não configurado" });
      }

      if (!integration.isActive) {
        return res.status(400).json({ error: "Integração OZmap está desativada" });
      }

      // Normalizar URL base - remover /api/v2 se existir para evitar duplicação
      let baseUrl = integration.apiUrl.replace(/\/+$/, ""); // Remove trailing slashes
      if (baseUrl.endsWith("/api/v2")) {
        baseUrl = baseUrl.slice(0, -7); // Remove /api/v2
      }

      const url = `${baseUrl}/api/v2/properties/client/${encodeURIComponent(ozmapTag)}/potency?locale=pt_BR`;
      console.log("[OZmap] Fetching potency:", { linkId, ozmapTag, url });
      
      const response = await fetch(url, {
          method: "GET",
          headers: {
            "Accept": "application/json",
            "Authorization": integration.apiKey,
          },
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error("[OZmap] Error fetching potency for link:", response.status, errorText);
        return res.status(response.status).json({ 
          error: `Erro ao consultar OZmap: HTTP ${response.status}`,
          details: errorText.substring(0, 200)
        });
      }

      const data = await response.json();
      console.log("[OZmap] Potency Response data:", JSON.stringify(data));
      
      // Agora buscar dados completos da rota
      let routeData = null;
      try {
        // Buscar dados do cliente FTTH para obter a rota completa
        const clientUrl = `${baseUrl}/api/v2/ftth-clients?code=${encodeURIComponent(ozmapTag)}&populate=property,connectorType&select=implanted,certified,onu,tags,potpiData`;
        console.log("[OZmap] Fetching client data:", clientUrl);
        
        const clientResponse = await fetch(clientUrl, {
          method: "GET",
          headers: {
            "Accept": "application/json",
            "Authorization": integration.apiKey,
          },
        });
        
        if (clientResponse.ok) {
          const clientData = await clientResponse.json();
          console.log("[OZmap] Client data:", JSON.stringify(clientData).substring(0, 1000));
          
          if (clientData.rows && clientData.rows.length > 0) {
            const client = clientData.rows[0];
            
            // Buscar detalhes da rota se disponível
            if (client.id) {
              const routeUrl = `${baseUrl}/api/v2/ftth-clients/${client.id}/route`;
              console.log("[OZmap] Fetching route:", routeUrl);
              
              const routeResponse = await fetch(routeUrl, {
                method: "GET",
                headers: {
                  "Accept": "application/json",
                  "Authorization": integration.apiKey,
                },
              });
              
              if (routeResponse.ok) {
                routeData = await routeResponse.json();
                console.log("[OZmap] Route data:", JSON.stringify(routeData).substring(0, 2000));
              } else {
                console.log("[OZmap] Route endpoint returned:", routeResponse.status);
              }
            }
          }
        }
      } catch (routeError) {
        console.log("[OZmap] Could not fetch route data:", routeError);
      }
      
      // Extrair e salvar dados do OZmap no link (prioridade sobre Zabbix)
      if (Array.isArray(data) && data.length > 0) {
        const potencyItem = data[0];
        
        // Extrair informações de splitter e OLT dos elementos da rota
        let splitterName: string | null = null;
        let splitterPort: string | null = null;
        let oltName: string | null = null;
        let oltSlot: number | null = null;
        let oltPort: number | null = null;
        
        if (potencyItem.elements && Array.isArray(potencyItem.elements)) {
          // Log tipos únicos de elementos para debug
          const kinds = [...new Set(potencyItem.elements.map((e: any) => e.element?.kind))];
          console.log(`[OZmap] Link ${linkId}: ${potencyItem.elements.length} elementos, tipos: ${kinds.join(', ')}`);
          // Percorrer todos os elementos para encontrar o ÚLTIMO splitter (mais próximo do cliente)
          for (const elem of potencyItem.elements) {
            // Procurar por splitter - verificar múltiplas estruturas possíveis
            if (elem.element?.kind === 'Splitter') {
              // Usar parent.name primeiro, depois element.name
              splitterName = elem.parent?.name || elem.element?.name || null;
              // Porta pode ser um objeto {id, label, number} ou um valor simples
              const portData = elem.element?.port;
              if (portData !== undefined && portData !== null) {
                if (typeof portData === 'object' && portData.number !== undefined) {
                  splitterPort = String(portData.number);
                } else if (typeof portData === 'object' && portData.label) {
                  splitterPort = String(portData.label);
                } else if (typeof portData !== 'object') {
                  splitterPort = String(portData);
                }
              } else if (elem.element?.label) {
                splitterPort = String(elem.element.label);
              }
              console.log(`[OZmap] Link ${linkId}: Splitter encontrado - Nome: ${splitterName}, Porta: ${splitterPort}`);
            }
            // Procurar por OLT (geralmente o último elemento da rota ou marcado como OLT)
            if (elem.element?.kind === 'OLT' || elem.parent?.name?.toLowerCase()?.includes('olt')) {
              oltName = elem.parent?.name || elem.element?.name || null;
              // Slot pode ser objeto ou número
              const slotData = elem.element?.slot;
              if (slotData !== undefined) {
                if (typeof slotData === 'object' && slotData.number !== undefined) {
                  oltSlot = parseInt(String(slotData.number), 10);
                } else if (typeof slotData !== 'object') {
                  oltSlot = parseInt(String(slotData), 10);
                }
              }
              // Port pode ser objeto ou número
              const portData = elem.element?.port;
              if (portData !== undefined) {
                if (typeof portData === 'object' && portData.number !== undefined) {
                  oltPort = parseInt(String(portData.number), 10);
                } else if (typeof portData !== 'object') {
                  oltPort = parseInt(String(portData), 10);
                }
              }
            }
          }
          console.log(`[OZmap] Link ${linkId}: Final - Splitter: ${splitterName || 'N/A'}, Porta: ${splitterPort || 'N/A'}`);
        }
        
        // Se a resposta tiver dados de OLT no nível superior
        if (potencyItem.olt_name) {
          oltName = potencyItem.olt_name;
        }
        // Slot e port no nível superior também podem ser objetos
        if (potencyItem.slot !== undefined) {
          if (typeof potencyItem.slot === 'object' && potencyItem.slot?.number !== undefined) {
            oltSlot = parseInt(String(potencyItem.slot.number), 10);
          } else if (typeof potencyItem.slot !== 'object') {
            oltSlot = parseInt(String(potencyItem.slot), 10);
          }
        }
        if (potencyItem.port !== undefined) {
          if (typeof potencyItem.port === 'object' && potencyItem.port?.number !== undefined) {
            oltPort = parseInt(String(potencyItem.port.number), 10);
          } else if (typeof potencyItem.port !== 'object') {
            oltPort = parseInt(String(potencyItem.port), 10);
          }
        }
        
        // Atualizar o link com os dados do OZmap
        const ozmapUpdate: any = {
          ozmapDistance: potencyItem.distance || null,
          ozmapArrivingPotency: potencyItem.arriving_potency || null,
          ozmapAttenuation: potencyItem.attenuation || null,
          ozmapPonReached: potencyItem.pon_reached || false,
          ozmapLastSync: new Date(),
        };
        
        // Só atualizar se tiver dados
        if (splitterName) ozmapUpdate.ozmapSplitterName = splitterName;
        if (splitterPort) ozmapUpdate.ozmapSplitterPort = splitterPort;
        if (oltName) ozmapUpdate.ozmapOltName = oltName;
        if (oltSlot !== null) ozmapUpdate.ozmapSlot = oltSlot;
        if (oltPort !== null) ozmapUpdate.ozmapPort = oltPort;
        
        // Usar potência de chegada do OZmap como baseline RX automaticamente
        if (potencyItem.arriving_potency !== undefined && potencyItem.arriving_potency !== null) {
          ozmapUpdate.opticalRxBaseline = potencyItem.arriving_potency;
        }
        
        try {
          await storage.updateLink(linkId, ozmapUpdate);
          console.log(`[OZmap] Link ${linkId} atualizado:`, ozmapUpdate);
        } catch (updateError) {
          console.error(`[OZmap] Erro ao atualizar link ${linkId}:`, updateError);
        }
      }
      
      res.json({
        linkId,
        ozmapTag,
        potencyData: data,
        routeData: routeData
      });
    } catch (error: any) {
      console.error("[OZmap] Error:", error);
      res.status(500).json({ error: "Erro ao consultar OZmap", details: error.message });
    }
  });

  // ========== Blacklist Check API ==========

  app.get("/api/blacklist/check/:ip", requireAuth, async (req, res) => {
    try {
      const { ip } = req.params;
      
      const integration = await storage.getExternalIntegrationByProvider("hetrixtools");
      if (!integration || !integration.apiKey) {
        return res.status(400).json({ error: "HetrixTools não configurado" });
      }

      const adapter = new HetrixToolsAdapter(integration);
      const result = await adapter.checkIpBlacklist(ip);
      
      res.json(result);
    } catch (error) {
      console.error("[Blacklist] Error checking IP:", error);
      res.status(500).json({ error: "Erro ao verificar blacklist" });
    }
  });

  app.get("/api/blacklist/link/:linkId", requireAuth, async (req, res) => {
    try {
      const linkId = parseInt(req.params.linkId, 10);
      const link = await storage.getLink(linkId);
      
      if (!link) {
        return res.status(404).json({ error: "Link não encontrado" });
      }

      if (req.user && !req.user.isSuperAdmin && req.user.clientId !== link.clientId) {
        return res.status(403).json({ error: "Acesso negado" });
      }

      const result = await checkBlacklistForLink(link, storage);
      
      const checks = await storage.getBlacklistCheck(linkId);
      const listedChecks = checks.filter(c => c.isListed);
      
      res.json({
        linkId,
        ipBlock: link.ipBlock,
        totalIps: checks.length,
        checked: result.checked,
        listed: result.listed,
        notMonitored: result.notMonitored,
        checks,
        isListed: listedChecks.length > 0,
        listedOn: listedChecks.flatMap(c => (c.listedOn as any[]) || []),
      });
    } catch (error) {
      console.error("[Blacklist] Error checking link:", error);
      res.status(500).json({ error: "Erro ao verificar blacklist do link" });
    }
  });

  app.get("/api/blacklist/cached", requireAuth, async (req, res) => {
    try {
      const checks = await storage.getBlacklistChecks();
      res.json(checks);
    } catch (error) {
      console.error("[Blacklist] Error fetching cached checks:", error);
      res.status(500).json({ error: "Erro ao buscar verificações" });
    }
  });

  // Endpoint específico para buscar blacklist por linkId (mais performático)
  app.get("/api/blacklist/cached/:linkId", requireAuth, async (req, res) => {
    try {
      const linkId = parseInt(req.params.linkId);
      if (isNaN(linkId)) {
        return res.status(400).json({ error: "ID de link inválido" });
      }
      const check = await storage.getBlacklistCheck(linkId);
      res.json(check);
    } catch (error) {
      console.error("[Blacklist] Error fetching cached check:", error);
      res.status(500).json({ error: "Erro ao buscar verificação" });
    }
  });

  app.get("/api/blacklist/listed", requireAuth, async (req, res) => {
    try {
      const checks = await storage.getListedBlacklistChecks();
      res.json(checks);
    } catch (error) {
      console.error("[Blacklist] Error fetching listed IPs:", error);
      res.status(500).json({ error: "Erro ao buscar IPs listados" });
    }
  });

  // Iniciar verificação automática de blacklist a cada 12 horas
  startBlacklistAutoCheck({
    getExternalIntegrations: () => storage.getExternalIntegrations(),
    getLinks: () => storage.getLinks(),
    upsertBlacklistCheck: (check) => storage.upsertBlacklistCheck(check),
    updateLinkStatus: (id, data) => storage.updateLinkStatus(id, data),
    createBlacklistEvent: (linkId, clientId, linkName, listedIps, rbls) => 
      storage.createBlacklistEvent(linkId, clientId, linkName, listedIps, rbls),
    resolveBlacklistEvents: (linkId) => storage.resolveBlacklistEvents(linkId),
  });

  // ========== Diagnostics & Health Check API ==========

  app.get("/api/health", async (_req, res) => {
    try {
      const dbStart = Date.now();
      await db.execute(sql`SELECT 1`);
      const dbLatency = Date.now() - dbStart;

      res.json({
        status: "healthy",
        timestamp: new Date().toISOString(),
        database: {
          status: "connected",
          latencyMs: dbLatency,
        },
      });
    } catch (error) {
      res.status(503).json({
        status: "unhealthy",
        timestamp: new Date().toISOString(),
        database: {
          status: "disconnected",
          error: error instanceof Error ? error.message : "Unknown error",
        },
      });
    }
  });

  app.get("/api/health/detailed", requireDiagnosticsAccess, async (_req, res) => {
    try {
      const { getServerStatus, getMetricsSummary } = await import("./metrics");
      const serverStatus = getServerStatus();
      const metricsSummary = getMetricsSummary();

      const dbStart = Date.now();
      await db.execute(sql`SELECT 1`);
      const dbLatency = Date.now() - dbStart;

      const linksCount = await db.execute(sql`SELECT COUNT(*) as count FROM links`);
      const hostsCount = await db.execute(sql`SELECT COUNT(*) as count FROM hosts`);
      const eventsCount = await db.execute(sql`SELECT COUNT(*) as count FROM events WHERE resolved = false`);
      const metricsCount = await db.execute(sql`SELECT COUNT(*) as count FROM metrics WHERE timestamp > NOW() - INTERVAL '1 hour'`);

      const hetrixIntegration = await storage.getExternalIntegrationByProvider("hetrixtools");
      const wanguardSettings = await storage.getClientSettings(1);

      res.json({
        status: "healthy",
        timestamp: new Date().toISOString(),
        server: serverStatus,
        metrics: metricsSummary,
        database: {
          status: "connected",
          latencyMs: dbLatency,
          counts: {
            links: Number((linksCount as any).rows?.[0]?.count || 0),
            hosts: Number((hostsCount as any).rows?.[0]?.count || 0),
            unresolvedEvents: Number((eventsCount as any).rows?.[0]?.count || 0),
            metricsLastHour: Number((metricsCount as any).rows?.[0]?.count || 0),
          },
        },
        integrations: {
          hetrixtools: {
            configured: !!hetrixIntegration?.apiKey,
            enabled: hetrixIntegration?.isActive || false,
          },
          wanguard: {
            configured: !!wanguardSettings?.wanguardApiEndpoint,
            enabled: !!wanguardSettings?.wanguardApiEndpoint,
          },
        },
      });
    } catch (error) {
      console.error("[Health] Detailed check failed:", error);
      res.status(503).json({
        status: "unhealthy",
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  app.get("/api/admin/diagnostics", requireDiagnosticsAccess, async (req, res) => {
    try {
      const { getServerStatus, getMetricsSummary, getMetrics } = await import("./metrics");
      const serverStatus = getServerStatus();
      const metricsSummary = getMetricsSummary();
      const fullMetrics = getMetrics();

      const dbStart = Date.now();
      await db.execute(sql`SELECT 1`);
      const dbLatency = Date.now() - dbStart;

      const allLinks = await storage.getLinks();
      const allHosts = await storage.getHosts();
      const allClients = await storage.getClients();
      const allConcentrators = await storage.getConcentrators();

      const unresolvedEvents = await db.execute(sql`
        SELECT e.*, l.name as link_name, c.name as client_name
        FROM events e
        LEFT JOIN links l ON e.link_id = l.id
        LEFT JOIN clients c ON e.client_id = c.id
        WHERE e.resolved = false
        ORDER BY e.timestamp DESC
        LIMIT 50
      `);

      const recentMetrics = await db.execute(sql`
        SELECT link_id, COUNT(*) as count, 
               AVG(latency) as avg_latency,
               AVG(packet_loss) as avg_packet_loss,
               MAX(timestamp) as last_metric
        FROM metrics 
        WHERE timestamp > NOW() - INTERVAL '1 hour'
        GROUP BY link_id
      `);

      const lastCollectionTimes = await db.execute(sql`
        SELECT link_id, MAX(timestamp) as last_collection
        FROM metrics
        GROUP BY link_id
      `);

      const linkStatusSummary = allLinks.reduce((acc, link) => {
        const status = link.status || "unknown";
        acc[status] = (acc[status] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      const blacklistChecks = await storage.getBlacklistChecks();
      const listedIps = blacklistChecks.filter(c => c.isListed);

      const hetrixIntegration = await storage.getExternalIntegrationByProvider("hetrixtools");

      const externalIntegrations = await storage.getExternalIntegrations();

      res.json({
        timestamp: new Date().toISOString(),
        server: serverStatus,
        metrics: {
          summary: metricsSummary,
          counters: fullMetrics.counters,
          currentLoad: fullMetrics.currentLoad,
          errors: fullMetrics.errors,
        },
        database: {
          latencyMs: dbLatency,
          status: "connected",
        },
        monitoring: {
          totalLinks: allLinks.length,
          totalHosts: allHosts.length,
          totalClients: allClients.length,
          linksByStatus: linkStatusSummary,
          unresolvedEventsCount: (unresolvedEvents as any).rows?.length || 0,
          unresolvedEvents: (unresolvedEvents as any).rows || [],
          recentMetricsByLink: (recentMetrics as any).rows || [],
          lastCollectionByLink: (lastCollectionTimes as any).rows || [],
        },
        blacklist: {
          totalChecks: blacklistChecks.length,
          listedCount: listedIps.length,
          listedIps: listedIps.map(c => ({
            linkId: c.linkId,
            ip: c.ip,
            listedOn: c.listedOn,
            lastCheckedAt: c.lastCheckedAt,
          })),
        },
        integrations: {
          hetrixtools: {
            configured: !!hetrixIntegration?.apiKey,
            enabled: hetrixIntegration?.isActive || false,
            autoCheckInterval: hetrixIntegration?.checkIntervalHours || 12,
          },
          all: externalIntegrations.map(i => ({
            id: i.id,
            provider: i.provider,
            name: i.name,
            isActive: i.isActive,
            hasApiKey: !!i.apiKey,
          })),
        },
        links: allLinks.map(l => ({
          id: l.id,
          name: l.name,
          clientId: l.clientId,
          status: l.status,
          ipBlock: l.ipBlock,
          address: l.address,
          snmpInterfaceName: l.snmpInterfaceName,
          snmpInterfaceIndex: l.snmpInterfaceIndex,
          monitoredIp: l.monitoredIp,
          snmpRouterIp: l.snmpRouterIp,
          concentratorId: l.concentratorId,
          trafficSourceType: l.trafficSourceType,
          pppoeUser: l.pppoeUser,
          ifIndexMismatchCount: l.ifIndexMismatchCount,
          failureReason: l.failureReason,
          failureSource: l.failureSource,
        })),
        concentrators: allConcentrators.map(c => ({
          id: c.id,
          name: c.name,
          ipAddress: c.ipAddress,
          isActive: c.isActive,
          backupConcentratorId: c.backupConcentratorId,
          snmpProfileId: c.snmpProfileId,
        })),
      });
    } catch (error) {
      console.error("[Diagnostics] Error:", error);
      res.status(500).json({ 
        error: "Erro ao gerar diagnóstico",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Diagnóstico específico de um link
  app.get("/api/admin/diagnostics/link/:linkId", requireDiagnosticsAccess, async (req, res) => {
    try {
      const linkId = parseInt(req.params.linkId, 10);
      if (isNaN(linkId)) {
        return res.status(400).json({ error: "ID de link inválido" });
      }

      const link = await storage.getLink(linkId);
      if (!link) {
        return res.status(404).json({ error: "Link não encontrado" });
      }

      // Buscar métricas recentes (últimas 24 horas)
      const recentMetrics = await db.execute(sql`
        SELECT 
          timestamp,
          latency,
          packet_loss,
          download,
          upload,
          status
        FROM metrics
        WHERE link_id = ${linkId}
          AND timestamp > NOW() - INTERVAL '24 hours'
        ORDER BY timestamp DESC
        LIMIT 100
      `);

      // Buscar eventos do link
      const events = await db.execute(sql`
        SELECT id, type, title, description, timestamp, resolved, resolved_at
        FROM events
        WHERE link_id = ${linkId}
        ORDER BY timestamp DESC
        LIMIT 20
      `);

      // Buscar verificações de blacklist
      const blacklistChecks = await db.execute(sql`
        SELECT ip, is_listed, listed_on, last_checked_at
        FROM blacklist_checks
        WHERE link_id = ${linkId}
        ORDER BY last_checked_at DESC
        LIMIT 20
      `);

      // Calcular estatísticas das últimas 24h
      const stats = await db.execute(sql`
        SELECT 
          COUNT(*) as total_samples,
          AVG(latency) as avg_latency,
          MAX(latency) as max_latency,
          MIN(latency) as min_latency,
          AVG(packet_loss) as avg_packet_loss,
          MAX(packet_loss) as max_packet_loss,
          AVG(download) as avg_download,
          AVG(upload) as avg_upload
        FROM metrics
        WHERE link_id = ${linkId}
          AND timestamp > NOW() - INTERVAL '24 hours'
      `);

      const statsRow = (stats as any).rows?.[0] || {};

      res.json({
        timestamp: new Date().toISOString(),
        link: {
          id: link.id,
          name: link.name,
          clientId: link.clientId,
          status: link.status,
          ipBlock: link.ipBlock,
          monitoredIp: link.monitoredIp,
          snmpRouterIp: link.snmpRouterIp,
          snmpInterfaceName: link.snmpInterfaceName,
          latencyThreshold: link.latencyThreshold,
          packetLossThreshold: link.packetLossThreshold,
          failureReason: link.failureReason,
          failureSource: link.failureSource,
          lastFailureAt: link.lastFailureAt,
          monitoringEnabled: link.monitoringEnabled,
        },
        stats24h: {
          totalSamples: Number(statsRow.total_samples || 0),
          avgLatency: parseFloat(statsRow.avg_latency || 0).toFixed(2),
          maxLatency: parseFloat(statsRow.max_latency || 0).toFixed(2),
          minLatency: parseFloat(statsRow.min_latency || 0).toFixed(2),
          avgPacketLoss: parseFloat(statsRow.avg_packet_loss || 0).toFixed(2),
          maxPacketLoss: parseFloat(statsRow.max_packet_loss || 0).toFixed(2),
          avgDownload: formatBytes(Number(statsRow.avg_download || 0)),
          avgUpload: formatBytes(Number(statsRow.avg_upload || 0)),
        },
        recentMetrics: (recentMetrics as any).rows?.slice(0, 20) || [],
        events: (events as any).rows || [],
        blacklistChecks: (blacklistChecks as any).rows || [],
      });
    } catch (error) {
      console.error("[Diagnostics] Link error:", error);
      res.status(500).json({ 
        error: "Erro ao gerar diagnóstico do link",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  app.post("/api/admin/diagnostics/reset-metrics", requireDiagnosticsAccess, async (_req, res) => {
    try {
      const { resetMetrics } = await import("./metrics");
      resetMetrics();
      res.json({ success: true, message: "Métricas resetadas com sucesso" });
    } catch (error) {
      res.status(500).json({ error: "Erro ao resetar métricas" });
    }
  });

  // Diagnóstico da conexão RADIUS DB (FreeRADIUS PostgreSQL)
  app.get("/api/admin/diagnostics/radius", requireDiagnosticsAccess, async (_req, res) => {
    try {
      const { testRadiusDbConnection } = await import("./radius");
      const result = await testRadiusDbConnection();
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ 
        success: false, 
        message: `Erro ao testar conexão RADIUS: ${error.message}` 
      });
    }
  });

  // Buscar sessão RADIUS por username PPPoE
  app.get("/api/admin/diagnostics/radius/session/:username", requireDiagnosticsAccess, async (req, res) => {
    try {
      const { getRadiusSessionByUsername } = await import("./radius");
      const session = await getRadiusSessionByUsername(req.params.username);
      if (!session) {
        return res.json({ found: false, message: "Sessão ativa não encontrada para este username" });
      }
      res.json({ found: true, session });
    } catch (error: any) {
      res.status(500).json({ 
        success: false, 
        message: `Erro ao buscar sessão RADIUS: ${error.message}` 
      });
    }
  });

  app.get("/api/admin/diagnostics/equipment-voalle-ids", requireDiagnosticsAccess, async (_req, res) => {
    try {
      const concentrators = await storage.getConcentrators();
      const oltList = await storage.getOlts();
      const switchList = await storage.getSwitches();

      res.json({
        concentrators: concentrators.map(c => ({
          id: c.id,
          name: c.name,
          ipAddress: c.ipAddress,
          voalleIds: c.voalleIds,
          voalleAccessPointIds: c.voalleAccessPointIds,
          isAccessPoint: c.isAccessPoint,
        })),
        olts: oltList.map(o => ({
          id: o.id,
          name: o.name,
          ipAddress: o.ipAddress,
          voalleIds: o.voalleIds,
        })),
        switches: switchList.map(s => ({
          id: s.id,
          name: s.name,
          ipAddress: s.ipAddress,
          voalleIds: s.voalleIds,
        })),
        summary: {
          concentratorsTotal: concentrators.length,
          concentratorsWithVoalleIds: concentrators.filter(c => c.voalleIds).length,
          concentratorsMissing: concentrators.filter(c => !c.voalleIds).map(c => ({ id: c.id, name: c.name })),
          oltsTotal: oltList.length,
          oltsWithVoalleIds: oltList.filter(o => o.voalleIds).length,
          oltsMissing: oltList.filter(o => !o.voalleIds).map(o => ({ id: o.id, name: o.name })),
          switchesTotal: switchList.length,
          switchesWithVoalleIds: switchList.filter(s => s.voalleIds).length,
          switchesMissing: switchList.filter(s => !s.voalleIds).map(s => ({ id: s.id, name: s.name })),
        },
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/admin/diagnostics/restore-voalle-ids", requireDiagnosticsAccess, async (req, res) => {
    try {
      const { updates } = req.body as {
        updates: Array<{
          type: 'concentrator' | 'olt' | 'switch';
          id: number;
          voalleIds: string;
        }>;
      };

      if (!updates || !Array.isArray(updates)) {
        return res.status(400).json({ error: "Campo 'updates' é obrigatório e deve ser um array" });
      }

      const results = { updated: 0, errors: [] as string[] };

      for (const update of updates) {
        try {
          if (!update.voalleIds || !update.id || !update.type) {
            results.errors.push(`Update inválido: ${JSON.stringify(update)}`);
            continue;
          }
          if (update.type === 'concentrator') {
            await storage.updateConcentrator(update.id, { voalleIds: update.voalleIds });
          } else if (update.type === 'olt') {
            await storage.updateOlt(update.id, { voalleIds: update.voalleIds });
          } else if (update.type === 'switch') {
            await storage.updateSwitch(update.id, { voalleIds: update.voalleIds });
          }
          results.updated++;
        } catch (err: any) {
          results.errors.push(`${update.type} #${update.id}: ${err.message}`);
        }
      }

      res.json(results);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // =====================================================
  // Firewall Routes - Gerenciamento de Whitelist
  // =====================================================

  // Obter status do firewall
  app.get("/api/firewall/status", requireSuperAdmin, async (_req, res) => {
    try {
      const status = getFirewallStatus();
      const [settings] = await db.select().from(firewallSettings).limit(1);
      res.json({ ...status, settings: settings || null });
    } catch (error) {
      res.status(500).json({ error: "Erro ao obter status do firewall" });
    }
  });

  // Obter configurações do firewall
  app.get("/api/firewall/settings", requireSuperAdmin, async (_req, res) => {
    try {
      const [settings] = await db.select().from(firewallSettings).limit(1);
      if (!settings) {
        // Criar configuração padrão se não existir
        const [newSettings] = await db.insert(firewallSettings).values({
          enabled: false,
          defaultDenyAdmin: true,
          defaultDenySsh: true,
          logBlockedAttempts: true,
        }).returning();
        return res.json(newSettings);
      }
      res.json(settings);
    } catch (error) {
      res.status(500).json({ error: "Erro ao obter configurações do firewall" });
    }
  });

  // Atualizar configurações do firewall
  app.patch("/api/firewall/settings", requireSuperAdmin, async (req, res) => {
    try {
      const userId = req.user?.id;
      const [existing] = await db.select().from(firewallSettings).limit(1);
      
      if (!existing) {
        const [newSettings] = await db.insert(firewallSettings).values({
          ...req.body,
          updatedBy: userId,
        }).returning();
        invalidateCache();
        return res.json(newSettings);
      }
      
      const [updated] = await db.update(firewallSettings)
        .set({ 
          ...req.body, 
          updatedAt: new Date(),
          updatedBy: userId,
        })
        .where(eq(firewallSettings.id, existing.id))
        .returning();
      
      invalidateCache();
      
      logAuditEvent({
        action: "firewall_settings_update",
        actor: req.user || null,
        metadata: { settings: req.body },
        request: req,
      });
      
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Erro ao atualizar configurações do firewall" });
    }
  });

  // Listar entradas da whitelist
  app.get("/api/firewall/whitelist", requireSuperAdmin, async (_req, res) => {
    try {
      const entries = await db.select().from(firewallWhitelist).orderBy(firewallWhitelist.createdAt);
      res.json(entries);
    } catch (error) {
      res.status(500).json({ error: "Erro ao listar whitelist" });
    }
  });

  // Adicionar entrada na whitelist
  app.post("/api/firewall/whitelist", requireSuperAdmin, async (req, res) => {
    try {
      console.log("[Firewall] POST whitelist - body:", JSON.stringify(req.body));
      const userId = req.user?.id;
      const parsed = insertFirewallWhitelistSchema.parse(req.body);
      
      const [entry] = await db.insert(firewallWhitelist).values({
        ...parsed,
        createdBy: userId,
      }).returning();
      
      invalidateCache();
      
      logAuditEvent({
        action: "firewall_whitelist_create",
        actor: req.user || null,
        metadata: { ipAddress: parsed.ipAddress, description: parsed.description },
        request: req,
      });
      
      console.log("[Firewall] Entrada criada com sucesso:", entry.id);
      res.json(entry);
    } catch (error: any) {
      console.error("[Firewall] Erro ao adicionar whitelist:", error);
      
      // Zod validation error
      if (error?.name === "ZodError") {
        const details = error.errors?.map((e: any) => `${e.path.join(".")}: ${e.message}`).join(", ");
        return res.status(400).json({ 
          error: "Dados inválidos", 
          message: details || "Erro de validação",
          details: error.errors 
        });
      }
      
      // Unique constraint violation (IP duplicado)
      if (error?.code === "23505") {
        return res.status(409).json({ 
          error: "IP já cadastrado", 
          message: "Este endereço IP/CIDR já existe na whitelist" 
        });
      }
      
      // Generic database error
      if (error?.code) {
        return res.status(500).json({ 
          error: "Erro de banco de dados", 
          message: `Código: ${error.code}` 
        });
      }
      
      res.status(500).json({ 
        error: "Erro ao adicionar entrada na whitelist",
        message: error?.message || "Erro desconhecido"
      });
    }
  });

  // Atualizar entrada da whitelist
  app.patch("/api/firewall/whitelist/:id", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const userId = req.user?.id;
      
      const [updated] = await db.update(firewallWhitelist)
        .set({ 
          ...req.body, 
          updatedAt: new Date(),
        })
        .where(eq(firewallWhitelist.id, id))
        .returning();
      
      if (!updated) {
        return res.status(404).json({ error: "Entrada não encontrada" });
      }
      
      invalidateCache();
      
      logAuditEvent({
        action: "firewall_whitelist_update",
        actor: req.user || null,
        metadata: { id, changes: req.body },
        request: req,
      });
      
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Erro ao atualizar entrada da whitelist" });
    }
  });

  // Remover entrada da whitelist
  app.delete("/api/firewall/whitelist/:id", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const userId = req.user?.id;
      
      const [deleted] = await db.delete(firewallWhitelist)
        .where(eq(firewallWhitelist.id, id))
        .returning();
      
      if (!deleted) {
        return res.status(404).json({ error: "Entrada não encontrada" });
      }
      
      invalidateCache();
      
      logAuditEvent({
        action: "firewall_whitelist_delete",
        actor: req.user || null,
        metadata: { ipAddress: deleted.ipAddress, description: deleted.description },
        request: req,
      });
      
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Erro ao remover entrada da whitelist" });
    }
  });

  // ==================== FLASHMAN ACS INTEGRATION ====================

  app.get("/api/flashman/settings", requireSuperAdmin, async (req, res) => {
    try {
      const settings = await storage.getFlashmanGlobalSettings();
      res.json(settings || { flashmanApiUrl: "", flashmanUsername: "", flashmanPassword: "", flashmanEnabled: false });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/flashman/settings", requireSuperAdmin, async (req, res) => {
    try {
      const { flashmanApiUrl, flashmanUsername, flashmanPassword, flashmanEnabled } = req.body;
      await storage.saveFlashmanGlobalSettings({
        flashmanApiUrl: flashmanApiUrl || "",
        flashmanUsername: flashmanUsername || "",
        flashmanPassword: flashmanPassword || "",
        flashmanEnabled: !!flashmanEnabled,
      });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/flashman/test-connection", requireSuperAdmin, async (req, res) => {
    try {
      const { apiUrl, username, password } = req.body;
      if (!apiUrl || !username || !password) {
        return res.status(400).json({ error: "URL, usuário e senha são obrigatórios" });
      }
      const result = await testFlashmanConnection({ apiUrl, username, password });
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  async function getLinkFlashmanIdentifiers(linkId: number, link: any): Promise<{ mac: string | null; serial: string | null }> {
    const linkCpes = await storage.getLinkCpes(linkId);
    const primaryCpe = linkCpes.find(lc => lc.showInEquipmentTab) || linkCpes.find(lc => lc.role === "primary") || linkCpes[0];
    const mac = primaryCpe?.macAddress || primaryCpe?.cpe?.macAddress || null;
    const serial = link.equipmentSerialNumber || link.onuSearchString || primaryCpe?.cpe?.serialNumber || null;
    return { mac, serial };
  }

  app.get("/api/links/:id/flashman/info", requireAuth, async (req, res) => {
    try {
      const linkId = parseInt(req.params.id);
      const link = await storage.getLink(linkId);
      if (!link) return res.status(404).json({ error: "Link não encontrado" });

      const config = await getFlashmanGlobalConfig();
      if (!config) return res.json({ enabled: false, message: "Flashman não configurado" });

      const ids = await getLinkFlashmanIdentifiers(linkId, link);
      const mac = await resolveDeviceMac(config, link.pppoeUser, ids.mac, ids.serial);
      if (!mac) return res.json({ enabled: true, found: false, message: "Dispositivo não encontrado no Flashman" });

      const device = await getDeviceByMac(config, mac);
      if (!device) return res.json({ enabled: true, found: false, message: "Dispositivo não encontrado no Flashman" });

      const formatted = formatFlashmanDeviceInfo(device);
      res.json({ enabled: true, found: true, device: formatted });
    } catch (error: any) {
      console.error("[Flashman] Error fetching device info:", error.message);
      res.status(500).json({ error: "Erro ao consultar Flashman" });
    }
  });

  app.post("/api/links/:id/flashman/command", requireSuperAdmin, async (req, res) => {
    try {
      const linkId = parseInt(req.params.id);
      const { command } = req.body;

      const validCommands = ["speedtest", "ping", "traceroute", "boot", "onlinedevs", "sitesurvey", "pondata", "bestchannel", "sync"];
      if (!command || !validCommands.includes(command)) {
        return res.status(400).json({ error: `Comando inválido. Válidos: ${validCommands.join(", ")}` });
      }

      const link = await storage.getLink(linkId);
      if (!link) return res.status(404).json({ error: "Link não encontrado" });

      const config = await getFlashmanGlobalConfig();
      if (!config) return res.status(400).json({ error: "Flashman não configurado" });

      const ids = await getLinkFlashmanIdentifiers(linkId, link);
      const mac = await resolveDeviceMac(config, link.pppoeUser, ids.mac, ids.serial);
      if (!mac) return res.status(404).json({ error: "Dispositivo não encontrado no Flashman" });

      const hosts = req.body.hosts;
      const host = req.body.host;
      console.log(`[Flashman/Route] Command: ${command}, MAC: ${mac}, hosts: ${JSON.stringify(hosts)}, host: ${host}`);
      let result;
      if (command === "bestchannel") {
        result = await triggerBestChannel(config, mac);
      } else if (command === "sync") {
        result = await syncDevice(config, mac);
      } else if (command === "ping") {
        result = await triggerPing(config, mac, Array.isArray(hosts) && hosts.length > 0 ? hosts : ["8.8.8.8", "1.1.1.1"]);
      } else if (command === "traceroute") {
        result = await triggerTraceroute(config, mac, typeof host === "string" && host ? host : "8.8.8.8");
      } else {
        result = await sendCommand(config, mac, command);
      }
      console.log(`[Flashman/Route] Command result:`, JSON.stringify(result));
      if (result && result.success === false) {
        return res.status(400).json({ ...result, mac, error: result.message || "Comando falhou" });
      }
      res.json({ ...result, mac });
    } catch (error: any) {
      console.error("[Flashman] Error sending command:", error.message);
      res.status(500).json({ error: "Erro ao enviar comando para o Flashman" });
    }
  });

  app.get("/api/links/:id/flashman/poll", requireAuth, async (req, res) => {
    try {
      const linkId = parseInt(req.params.id);
      const link = await storage.getLink(linkId);
      if (!link) return res.status(404).json({ error: "Link não encontrado" });

      const config = await getFlashmanGlobalConfig();
      if (!config) return res.status(400).json({ error: "Flashman não configurado" });

      const ids = await getLinkFlashmanIdentifiers(linkId, link);
      const mac = await resolveDeviceMac(config, link.pppoeUser, ids.mac, ids.serial);
      if (!mac) return res.status(404).json({ error: "Dispositivo não encontrado" });

      const device = await getDeviceByMacForPolling(config, mac);
      if (!device) return res.status(404).json({ error: "Dispositivo não encontrado" });

      const formatted = formatFlashmanDeviceInfo(device);
      res.json({ device: formatted });
    } catch (error: any) {
      console.error("[Flashman/Poll] Error:", error.message);
      res.status(500).json({ error: "Erro ao consultar status do dispositivo" });
    }
  });

  app.get("/api/links/:id/flashman/flashboard", requireAuth, async (req, res) => {
    try {
      const linkId = parseInt(req.params.id);
      const link = await storage.getLink(linkId);
      if (!link) return res.status(404).json({ error: "Link não encontrado" });
      const config = await getFlashmanGlobalConfig();
      if (!config) return res.json({ enabled: false });
      const ids = await getLinkFlashmanIdentifiers(linkId, link);
      const mac = await resolveDeviceMac(config, link.pppoeUser, ids.mac, ids.serial);
      if (!mac) return res.status(404).json({ error: "Dispositivo não encontrado" });
      const report = await getFlashboardReport(config, mac);
      res.json({ success: true, report });
    } catch (error: any) {
      res.status(500).json({ error: "Erro ao consultar Flashboard" });
    }
  });

  app.get("/api/links/:id/flashman/wifi", requireAuth, async (req, res) => {
    try {
      const linkId = parseInt(req.params.id);
      const link = await storage.getLink(linkId);
      if (!link) return res.status(404).json({ error: "Link não encontrado" });
      const config = await getFlashmanGlobalConfig();
      if (!config) return res.status(400).json({ error: "Flashman não configurado" });
      const ids = await getLinkFlashmanIdentifiers(linkId, link);
      const mac = await resolveDeviceMac(config, link.pppoeUser, ids.mac, ids.serial);
      if (!mac) return res.status(404).json({ error: "Dispositivo não encontrado" });
      const result = await getDeviceWifi(config, mac);
      res.json({ success: true, data: result, mac });
    } catch (error: any) {
      res.status(500).json({ error: "Erro ao consultar Wi-Fi" });
    }
  });

  app.put("/api/links/:id/flashman/wifi/radio/:radioId", requireSuperAdmin, async (req, res) => {
    try {
      const linkId = parseInt(req.params.id);
      const { radioId } = req.params;
      const link = await storage.getLink(linkId);
      if (!link) return res.status(404).json({ error: "Link não encontrado" });
      const config = await getFlashmanGlobalConfig();
      if (!config) return res.status(400).json({ error: "Flashman não configurado" });
      const ids = await getLinkFlashmanIdentifiers(linkId, link);
      const mac = await resolveDeviceMac(config, link.pppoeUser, ids.mac, ids.serial);
      if (!mac) return res.status(404).json({ error: "Dispositivo não encontrado" });
      const result = await updateWifiRadio(config, mac, radioId, req.body);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: "Erro ao atualizar rádio Wi-Fi" });
    }
  });

  app.put("/api/links/:id/flashman/wifi/interface/:wifiId", requireSuperAdmin, async (req, res) => {
    try {
      const linkId = parseInt(req.params.id);
      const { wifiId } = req.params;
      const link = await storage.getLink(linkId);
      if (!link) return res.status(404).json({ error: "Link não encontrado" });
      const config = await getFlashmanGlobalConfig();
      if (!config) return res.status(400).json({ error: "Flashman não configurado" });
      const ids = await getLinkFlashmanIdentifiers(linkId, link);
      const mac = await resolveDeviceMac(config, link.pppoeUser, ids.mac, ids.serial);
      if (!mac) return res.status(404).json({ error: "Dispositivo não encontrado" });
      const result = await updateWifiInterface(config, mac, wifiId, req.body);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: "Erro ao atualizar interface Wi-Fi" });
    }
  });

  app.get("/api/links/:id/flashman/web-credentials", requireSuperAdmin, async (req, res) => {
    try {
      const linkId = parseInt(req.params.id);
      const link = await storage.getLink(linkId);
      if (!link) return res.status(404).json({ error: "Link não encontrado" });
      const config = await getFlashmanGlobalConfig();
      if (!config) return res.status(400).json({ error: "Flashman não configurado" });
      const ids = await getLinkFlashmanIdentifiers(linkId, link);
      const mac = await resolveDeviceMac(config, link.pppoeUser, ids.mac, ids.serial);
      if (!mac) return res.status(404).json({ error: "Dispositivo não encontrado" });
      const result = await getWebCredentials(config, mac);
      res.json({ success: true, data: result, mac });
    } catch (error: any) {
      res.status(500).json({ error: "Erro ao consultar credenciais web" });
    }
  });

  app.put("/api/links/:id/flashman/web-credentials", requireSuperAdmin, async (req, res) => {
    try {
      const linkId = parseInt(req.params.id);
      const link = await storage.getLink(linkId);
      if (!link) return res.status(404).json({ error: "Link não encontrado" });
      const config = await getFlashmanGlobalConfig();
      if (!config) return res.status(400).json({ error: "Flashman não configurado" });
      const ids = await getLinkFlashmanIdentifiers(linkId, link);
      const mac = await resolveDeviceMac(config, link.pppoeUser, ids.mac, ids.serial);
      if (!mac) return res.status(404).json({ error: "Dispositivo não encontrado" });
      const result = await setWebCredentials(config, mac, req.body);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: "Erro ao atualizar credenciais web" });
    }
  });

  app.get("/api/links/:id/flashman/dns", requireAuth, async (req, res) => {
    try {
      const linkId = parseInt(req.params.id);
      const link = await storage.getLink(linkId);
      if (!link) return res.status(404).json({ error: "Link não encontrado" });
      const config = await getFlashmanGlobalConfig();
      if (!config) return res.status(400).json({ error: "Flashman não configurado" });
      const ids = await getLinkFlashmanIdentifiers(linkId, link);
      const mac = await resolveDeviceMac(config, link.pppoeUser, ids.mac, ids.serial);
      if (!mac) return res.status(404).json({ error: "Dispositivo não encontrado" });
      const result = await getLanDnsServers(config, mac);
      res.json({ success: true, data: result, mac });
    } catch (error: any) {
      res.status(500).json({ error: "Erro ao consultar DNS" });
    }
  });

  app.put("/api/links/:id/flashman/dns", requireSuperAdmin, async (req, res) => {
    try {
      const linkId = parseInt(req.params.id);
      const link = await storage.getLink(linkId);
      if (!link) return res.status(404).json({ error: "Link não encontrado" });
      const config = await getFlashmanGlobalConfig();
      if (!config) return res.status(400).json({ error: "Flashman não configurado" });
      const ids = await getLinkFlashmanIdentifiers(linkId, link);
      const mac = await resolveDeviceMac(config, link.pppoeUser, ids.mac, ids.serial);
      if (!mac) return res.status(404).json({ error: "Dispositivo não encontrado" });
      const { dnsServers } = req.body;
      if (!Array.isArray(dnsServers)) return res.status(400).json({ error: "dnsServers deve ser um array" });
      const result = await setLanDnsServers(config, mac, dnsServers);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: "Erro ao atualizar DNS" });
    }
  });

  app.get("/api/links/:id/flashman/comments", requireAuth, async (req, res) => {
    try {
      const linkId = parseInt(req.params.id);
      const link = await storage.getLink(linkId);
      if (!link) return res.status(404).json({ error: "Link não encontrado" });
      const config = await getFlashmanGlobalConfig();
      if (!config) return res.status(400).json({ error: "Flashman não configurado" });
      const ids = await getLinkFlashmanIdentifiers(linkId, link);
      const mac = await resolveDeviceMac(config, link.pppoeUser, ids.mac, ids.serial);
      if (!mac) return res.status(404).json({ error: "Dispositivo não encontrado" });
      const result = await getDeviceComments(config, mac);
      res.json({ success: true, data: result, mac });
    } catch (error: any) {
      res.status(500).json({ error: "Erro ao consultar observações" });
    }
  });

  app.put("/api/links/:id/flashman/comments", requireSuperAdmin, async (req, res) => {
    try {
      const linkId = parseInt(req.params.id);
      const link = await storage.getLink(linkId);
      if (!link) return res.status(404).json({ error: "Link não encontrado" });
      const config = await getFlashmanGlobalConfig();
      if (!config) return res.status(400).json({ error: "Flashman não configurado" });
      const ids = await getLinkFlashmanIdentifiers(linkId, link);
      const mac = await resolveDeviceMac(config, link.pppoeUser, ids.mac, ids.serial);
      if (!mac) return res.status(404).json({ error: "Dispositivo não encontrado" });
      const { comments } = req.body;
      const result = await setDeviceComments(config, mac, comments || "");
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: "Erro ao atualizar observações" });
    }
  });

  app.get("/api/links/:id/flashman/voip", requireAuth, async (req, res) => {
    try {
      const linkId = parseInt(req.params.id);
      const link = await storage.getLink(linkId);
      if (!link) return res.status(404).json({ error: "Link não encontrado" });
      const config = await getFlashmanGlobalConfig();
      if (!config) return res.status(400).json({ error: "Flashman não configurado" });
      const ids = await getLinkFlashmanIdentifiers(linkId, link);
      const mac = await resolveDeviceMac(config, link.pppoeUser, ids.mac, ids.serial);
      if (!mac) return res.status(404).json({ error: "Dispositivo não encontrado" });
      const result = await getDeviceVoip(config, mac);
      res.json({ success: true, data: result, mac });
    } catch (error: any) {
      res.status(500).json({ error: "Erro ao consultar VoIP" });
    }
  });

  app.get("/api/links/:id/flashman/wans", requireAuth, async (req, res) => {
    try {
      const linkId = parseInt(req.params.id);
      const link = await storage.getLink(linkId);
      if (!link) return res.status(404).json({ error: "Link não encontrado" });
      const config = await getFlashmanGlobalConfig();
      if (!config) return res.status(400).json({ error: "Flashman não configurado" });
      const ids = await getLinkFlashmanIdentifiers(linkId, link);
      const mac = await resolveDeviceMac(config, link.pppoeUser, ids.mac, ids.serial);
      if (!mac) return res.status(404).json({ error: "Dispositivo não encontrado" });
      const device = await getDeviceByMac(config, mac);
      if (!device) return res.status(404).json({ error: "Dispositivo não encontrado" });
      const formatted = formatFlashmanDeviceInfo(device);
      res.json({ success: true, wans: formatted.wans, mac });
    } catch (error: any) {
      res.status(500).json({ error: "Erro ao consultar WANs" });
    }
  });

  app.put("/api/links/:id/flashman/wan/:wanId", requireSuperAdmin, async (req, res) => {
    try {
      const linkId = parseInt(req.params.id);
      const wanId = req.params.wanId;
      const link = await storage.getLink(linkId);
      if (!link) return res.status(404).json({ error: "Link não encontrado" });
      const config = await getFlashmanGlobalConfig();
      if (!config) return res.status(400).json({ error: "Flashman não configurado" });
      const ids = await getLinkFlashmanIdentifiers(linkId, link);
      const mac = await resolveDeviceMac(config, link.pppoeUser, ids.mac, ids.serial);
      if (!mac) return res.status(404).json({ error: "Dispositivo não encontrado" });
      const result = await setDeviceWan(config, mac, wanId, req.body);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: "Erro ao atualizar WAN" });
    }
  });

  app.put("/api/links/:id/flashman/voip", requireSuperAdmin, async (req, res) => {
    try {
      const linkId = parseInt(req.params.id);
      const link = await storage.getLink(linkId);
      if (!link) return res.status(404).json({ error: "Link não encontrado" });
      const config = await getFlashmanGlobalConfig();
      if (!config) return res.status(400).json({ error: "Flashman não configurado" });
      const ids = await getLinkFlashmanIdentifiers(linkId, link);
      const mac = await resolveDeviceMac(config, link.pppoeUser, ids.mac, ids.serial);
      if (!mac) return res.status(404).json({ error: "Dispositivo não encontrado" });
      const result = await setDeviceVoip(config, mac, req.body);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: "Erro ao atualizar VoIP" });
    }
  });

  app.put("/api/links/:id/flashman/lan", requireSuperAdmin, async (req, res) => {
    try {
      const linkId = parseInt(req.params.id);
      const link = await storage.getLink(linkId);
      if (!link) return res.status(404).json({ error: "Link não encontrado" });
      const config = await getFlashmanGlobalConfig();
      if (!config) return res.status(400).json({ error: "Flashman não configurado" });
      const ids = await getLinkFlashmanIdentifiers(linkId, link);
      const mac = await resolveDeviceMac(config, link.pppoeUser, ids.mac, ids.serial);
      if (!mac) return res.status(404).json({ error: "Dispositivo não encontrado" });
      const result = await setDeviceLanSubnet(config, mac, req.body);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: "Erro ao atualizar LAN" });
    }
  });

  app.post("/api/links/:id/flashman/config-file", requireSuperAdmin, async (req, res) => {
    try {
      const linkId = parseInt(req.params.id);
      const link = await storage.getLink(linkId);
      if (!link) return res.status(404).json({ error: "Link não encontrado" });
      const config = await getFlashmanGlobalConfig();
      if (!config) return res.status(400).json({ error: "Flashman não configurado" });
      const ids = await getLinkFlashmanIdentifiers(linkId, link);
      const mac = await resolveDeviceMac(config, link.pppoeUser, ids.mac, ids.serial);
      if (!mac) return res.status(404).json({ error: "Dispositivo não encontrado" });
      const result = await sendConfigFileToDevice(config, mac);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: "Erro ao enviar config file" });
    }
  });

  // ==================== FLASHMAN ADMIN (GLOBAL) ROUTES ====================

  app.get("/api/flashman/search-devices", requireSuperAdmin, async (req, res) => {
    try {
      const config = await getFlashmanGlobalConfig();
      if (!config) return res.status(400).json({ error: "Flashman não configurado" });
      const filters: any = {};
      if (req.query.online === "true") filters.online = true;
      if (req.query.offline === "true") filters.offline = true;
      if (req.query.unstable === "true") filters.unstable = true;
      if (req.query.alert === "true") filters.alert = true;
      if (req.query.noSignal === "true") filters.noSignal = true;
      if (req.query.tr069 === "true") filters.tr069 = true;
      if (req.query.flashbox === "true") filters.flashbox = true;
      if (req.query.signal) filters.signal = req.query.signal;
      if (req.query.mesh) filters.mesh = req.query.mesh;
      if (req.query.mode) filters.mode = req.query.mode;
      if (req.query.ipv6) filters.ipv6 = req.query.ipv6;
      if (req.query.query) filters.query = req.query.query;
      if (req.query.fields) filters.fields = req.query.fields;
      if (req.query.page) filters.page = parseInt(req.query.page as string);
      if (req.query.pageLimit) filters.pageLimit = parseInt(req.query.pageLimit as string);
      if (req.query.sortType) filters.sortType = req.query.sortType;
      if (req.query.sortOn) filters.sortOn = req.query.sortOn;
      const result = await searchDevices(config, filters);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: "Erro ao buscar dispositivos" });
    }
  });

  app.get("/api/flashman/mesh-vendors", requireSuperAdmin, async (req, res) => {
    try {
      const config = await getFlashmanGlobalConfig();
      if (!config) return res.status(400).json({ error: "Flashman não configurado" });
      const result = await searchMeshVendorDevices(config);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: "Erro ao buscar mesh vendors" });
    }
  });

  app.get("/api/flashman/config-files", requireSuperAdmin, async (req, res) => {
    try {
      const config = await getFlashmanGlobalConfig();
      if (!config) return res.status(400).json({ error: "Flashman não configurado" });
      const result = await getConfigFiles(config);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: "Erro ao listar config files" });
    }
  });

  app.get("/api/flashman/firmwares", requireSuperAdmin, async (req, res) => {
    try {
      const config = await getFlashmanGlobalConfig();
      if (!config) return res.status(400).json({ error: "Flashman não configurado" });
      const { vendor, model } = req.query;
      let result;
      if (vendor && model) {
        result = await listFirmwaresByModel(config, vendor as string, model as string);
      } else {
        result = await listFirmwares(config);
      }
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: "Erro ao listar firmwares" });
    }
  });

  app.get("/api/flashman/webhooks", requireSuperAdmin, async (req, res) => {
    try {
      const config = await getFlashmanGlobalConfig();
      if (!config) return res.status(400).json({ error: "Flashman não configurado" });
      const result = await getWebhooks(config);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: "Erro ao listar webhooks" });
    }
  });

  app.post("/api/flashman/webhooks", requireSuperAdmin, async (req, res) => {
    try {
      const config = await getFlashmanGlobalConfig();
      if (!config) return res.status(400).json({ error: "Flashman não configurado" });
      const result = await createWebhook(config, req.body);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: "Erro ao criar webhook" });
    }
  });

  app.put("/api/flashman/webhooks/:webhookId", requireSuperAdmin, async (req, res) => {
    try {
      const config = await getFlashmanGlobalConfig();
      if (!config) return res.status(400).json({ error: "Flashman não configurado" });
      const result = await updateWebhook(config, req.params.webhookId, req.body);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: "Erro ao atualizar webhook" });
    }
  });

  app.delete("/api/flashman/webhooks/:webhookId", requireSuperAdmin, async (req, res) => {
    try {
      const config = await getFlashmanGlobalConfig();
      if (!config) return res.status(400).json({ error: "Flashman não configurado" });
      const result = await deleteWebhook(config, req.params.webhookId);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: "Erro ao excluir webhook" });
    }
  });

  app.get("/api/flashman/periodic-reboot", requireSuperAdmin, async (req, res) => {
    try {
      const config = await getFlashmanGlobalConfig();
      if (!config) return res.status(400).json({ error: "Flashman não configurado" });
      const result = await getPeriodicReboot(config);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: "Erro ao consultar reboot periódico" });
    }
  });

  app.put("/api/flashman/periodic-reboot", requireSuperAdmin, async (req, res) => {
    try {
      const config = await getFlashmanGlobalConfig();
      if (!config) return res.status(400).json({ error: "Flashman não configurado" });
      const result = await setPeriodicRebootByModel(config, req.body);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: "Erro ao configurar reboot periódico" });
    }
  });

  app.get("/api/flashman/pre-registers", requireSuperAdmin, async (req, res) => {
    try {
      const config = await getFlashmanGlobalConfig();
      if (!config) return res.status(400).json({ error: "Flashman não configurado" });
      const result = await getPreRegisters(config);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: "Erro ao listar pré-registros" });
    }
  });

  app.get("/api/flashman/pre-registers/:preRegId", requireSuperAdmin, async (req, res) => {
    try {
      const config = await getFlashmanGlobalConfig();
      if (!config) return res.status(400).json({ error: "Flashman não configurado" });
      const result = await getPreRegisterById(config, req.params.preRegId);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: "Erro ao consultar pré-registro" });
    }
  });

  app.put("/api/flashman/pre-registers/:preRegId", requireSuperAdmin, async (req, res) => {
    try {
      const config = await getFlashmanGlobalConfig();
      if (!config) return res.status(400).json({ error: "Flashman não configurado" });
      const result = await setPreRegister(config, req.params.preRegId, req.body);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: "Erro ao atualizar pré-registro" });
    }
  });

  app.delete("/api/flashman/pre-registers", requireSuperAdmin, async (req, res) => {
    try {
      const config = await getFlashmanGlobalConfig();
      if (!config) return res.status(400).json({ error: "Flashman não configurado" });
      const { ids } = req.body;
      if (!Array.isArray(ids)) return res.status(400).json({ error: "ids deve ser um array" });
      const result = await deletePreRegisters(config, ids);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: "Erro ao excluir pré-registros" });
    }
  });

  app.get("/api/flashman/credentials/snmp", requireSuperAdmin, async (req, res) => {
    try {
      const config = await getFlashmanGlobalConfig();
      if (!config) return res.status(400).json({ error: "Flashman não configurado" });
      const result = await getSnmpCredentials(config);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: "Erro ao listar credenciais SNMP" });
    }
  });

  app.post("/api/flashman/credentials/snmp", requireSuperAdmin, async (req, res) => {
    try {
      const config = await getFlashmanGlobalConfig();
      if (!config) return res.status(400).json({ error: "Flashman não configurado" });
      const result = await createSnmpCredential(config, req.body);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: "Erro ao criar credencial SNMP" });
    }
  });

  app.delete("/api/flashman/credentials/snmp", requireSuperAdmin, async (req, res) => {
    try {
      const config = await getFlashmanGlobalConfig();
      if (!config) return res.status(400).json({ error: "Flashman não configurado" });
      const { ids } = req.body;
      const result = await deleteSnmpCredentials(config, ids);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: "Erro ao excluir credenciais SNMP" });
    }
  });

  app.get("/api/flashman/credentials/ssh", requireSuperAdmin, async (req, res) => {
    try {
      const config = await getFlashmanGlobalConfig();
      if (!config) return res.status(400).json({ error: "Flashman não configurado" });
      const result = await getSshCredentials(config);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: "Erro ao listar credenciais SSH" });
    }
  });

  app.post("/api/flashman/credentials/ssh", requireSuperAdmin, async (req, res) => {
    try {
      const config = await getFlashmanGlobalConfig();
      if (!config) return res.status(400).json({ error: "Flashman não configurado" });
      const result = await createSshCredential(config, req.body);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: "Erro ao criar credencial SSH" });
    }
  });

  app.delete("/api/flashman/credentials/ssh", requireSuperAdmin, async (req, res) => {
    try {
      const config = await getFlashmanGlobalConfig();
      if (!config) return res.status(400).json({ error: "Flashman não configurado" });
      const { ids } = req.body;
      const result = await deleteSshCredentials(config, ids);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: "Erro ao excluir credenciais SSH" });
    }
  });

  app.get("/api/flashman/credentials/telnet", requireSuperAdmin, async (req, res) => {
    try {
      const config = await getFlashmanGlobalConfig();
      if (!config) return res.status(400).json({ error: "Flashman não configurado" });
      const result = await getTelnetCredentials(config);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: "Erro ao listar credenciais Telnet" });
    }
  });

  app.post("/api/flashman/credentials/telnet", requireSuperAdmin, async (req, res) => {
    try {
      const config = await getFlashmanGlobalConfig();
      if (!config) return res.status(400).json({ error: "Flashman não configurado" });
      const result = await createTelnetCredential(config, req.body);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: "Erro ao criar credencial Telnet" });
    }
  });

  app.delete("/api/flashman/credentials/telnet", requireSuperAdmin, async (req, res) => {
    try {
      const config = await getFlashmanGlobalConfig();
      if (!config) return res.status(400).json({ error: "Flashman não configurado" });
      const { ids } = req.body;
      const result = await deleteTelnetCredentials(config, ids);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: "Erro ao excluir credenciais Telnet" });
    }
  });

  app.get("/api/flashman/system-config", requireSuperAdmin, async (req, res) => {
    try {
      const config = await getFlashmanGlobalConfig();
      if (!config) return res.status(400).json({ error: "Flashman não configurado" });
      const result = await getFlashmanSystemConfig(config);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: "Erro ao consultar configuração do sistema" });
    }
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

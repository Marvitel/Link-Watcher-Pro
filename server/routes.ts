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
  incidents as incidentsTable,
  events as eventsTable,
  clients as clientsTable,
  clientSettings as clientSettingsTable,
  blacklistChecks,
  webhookLogs,
  firewallWhitelist,
  firewallSettings,
  trafficInterfaceMetrics,
  splitters,
  snmpConcentrators,
  olts,
  switches,
  cpes,
  linkCpes,
  voalleContractClients,
  voalleServiceTags,
  externalIntegrations,
  equipmentVendors,
  snmpProfiles,
  switchSensorCache,
  type AuthUser,
  type UserRole,
} from "@shared/schema";
import { invalidateCache, getFirewallStatus } from "./firewall";
import { db } from "./db";
import { eq, and, or, isNull, isNotNull, sql, inArray } from "drizzle-orm";
import { HetrixToolsAdapter, startBlacklistAutoCheck, checkBlacklistForLink } from "./hetrixtools";
import { backupCpe, restoreMikrotikBackup, startCpeBackupScheduler } from "./cpe-backup";
import {
  getFlashmanConfigForClient,
  testFlashmanConnection,
  resolveDeviceMac,
  findDeviceDirect,
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
  getDeviceFull,
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

// Cache simples in-memory para o dashboard super-admin (evita queries pesadas a cada troca de página)
const dashboardCache = new Map<string, { data: any; expiresAt: number }>();
const DASHBOARD_CACHE_TTL = 20_000; // 20 segundos
function getDashboardCache(key: string) {
  const entry = dashboardCache.get(key);
  if (entry && entry.expiresAt > Date.now()) return entry.data;
  dashboardCache.delete(key);
  return null;
}
function setDashboardCache(key: string, data: any) {
  dashboardCache.set(key, { data, expiresAt: Date.now() + DASHBOARD_CACHE_TTL });
}

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
        'opticalMonitoringEnabled', 'opticalDeltaThreshold',
        'opticalRxOid', 'opticalTxOid', 'opticalOltRxOid',
        'mainGraphMode', 'mainGraphInterfaceIds',
        'snmpProfileId', 'snmpInterfaceIndex', 'snmpInterfaceName', 'snmpInterfaceDescr', 'snmpInterfaceAlias',
        'pppoeUser', 'pppoePassword', 'vlanInterface',
        'switchPort', 'switchPortNumber',
        'snmpRouterIp', 'equipmentVendorId', 'equipmentModel', 'customCpuOid', 'customMemoryOid',
        'voalleContractTagId', 'voalleContractTagServiceTag', 'voalleConnectionId', 'voalleServiceId', 'voalleContractNumber',
        'accessPointId', 'accessPointInterfaceIndex', 'accessPointInterfaceName',
        'latitude', 'longitude', 'invertBandwidth', 'sfpType',
        'isL2Link', 'icmpBlocked', 'tcpCheckPort',
        'monitoredIpLocked',
        'wifiName', 'wifiPassword',
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
      
      // When user manually changes SNMP interface settings, reset auto-discovery state
      // This prevents the system from immediately overwriting manual edits
      const interfaceManuallyChanged = (
        ('snmpInterfaceIndex' in filteredBody && filteredBody.snmpInterfaceIndex !== previousLink?.snmpInterfaceIndex) ||
        ('snmpInterfaceName' in filteredBody && filteredBody.snmpInterfaceName !== previousLink?.snmpInterfaceName)
      );
      if (interfaceManuallyChanged) {
        filteredBody.ifIndexMismatchCount = 0;
        filteredBody.lastIfIndexValidation = new Date();
        if (filteredBody.snmpInterfaceName) {
          filteredBody.originalIfName = filteredBody.snmpInterfaceName;
        }
        console.log(`[Link] Link ${linkId}: Interface manually changed (ifIndex: ${previousLink?.snmpInterfaceIndex} -> ${filteredBody.snmpInterfaceIndex}, name: ${previousLink?.snmpInterfaceName} -> ${filteredBody.snmpInterfaceName}). Reset auto-discovery state.`);
      }

      // When concentrator changes, clear the stored ifIndex — it's from the old concentrator
      // and will point to a completely different (or nonexistent) interface on the new one.
      // Auto-discovery will find the correct ifIndex on the new concentrator.
      const concentratorChanged = 'concentratorId' in filteredBody &&
        String(filteredBody.concentratorId) !== String(previousLink?.concentratorId);
      if (concentratorChanged && !interfaceManuallyChanged) {
        filteredBody.snmpInterfaceIndex = null;
        filteredBody.ifIndexMismatchCount = 0;
        filteredBody.lastIfIndexValidation = null;
        console.log(`[Link] Link ${linkId}: Concentrator changed (${previousLink?.concentratorId} -> ${filteredBody.concentratorId}). Cleared snmpInterfaceIndex to force re-discovery on new concentrator.`);
      }
      
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

  // Heartbeat de visualização ativa — acelera coleta para 5s enquanto analista está na tela
  app.post("/api/links/:id/watch", requireAuth, async (req, res) => {
    try {
      const linkId = parseInt(req.params.id, 10);
      if (isNaN(linkId)) return res.status(400).json({ error: "linkId inválido" });
      const { markLinkWatched } = await import("./monitoring");
      markLinkWatched(linkId);
      res.json({ ok: true, linkId, fastPollIntervalSeconds: 5 });
    } catch (error) {
      res.status(500).json({ error: "Erro ao registrar watch" });
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

  // Descoberta automática de IP de monitoramento (cascata: Voalle tag → RADIUS → ARP via interface)
  app.post("/api/links/:id/discover-monitored-ip", requireAuth, async (req, res) => {
    try {
      const user = req.user as any;
      if (!user?.isSuperAdmin) {
        return res.status(403).json({ error: "Acesso restrito a Super Admin" });
      }
      const linkId = parseInt(req.params.id, 10);
      if (Number.isNaN(linkId)) return res.status(400).json({ error: "linkId inválido" });

      const link = await storage.getLink(linkId);
      if (!link) return res.status(404).json({ error: "Link não encontrado" });

      const tried: Array<{ source: string; ok: boolean; detail?: string }> = [];
      const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;
      const isValidIp = (ip: string | null | undefined) =>
        !!ip && IPV4_RE.test(String(ip).trim()) && !/[\s;|&`$()<>"'\\]/.test(String(ip));
      const sanitizeIface = (s: string) => String(s || "").replace(/[^A-Za-z0-9_.\-:<>]/g, "").slice(0, 64);

      // 1) RADIUS por PPPoE (PPPoE links)
      if ((link as any).pppoeUser) {
        try {
          const { getRadiusSessionByUsername } = await import("./radius");
          const session = await getRadiusSessionByUsername((link as any).pppoeUser);
          if (session?.framedIpAddress && isValidIp(session.framedIpAddress)) {
            const ip = String(session.framedIpAddress).trim();
            tried.push({ source: "radius", ok: true, detail: `sessão ativa de ${(link as any).pppoeUser}` });
            return res.json({ success: true, ip, source: "radius", pppoeUser: (link as any).pppoeUser, tried });
          }
          tried.push({ source: "radius", ok: false, detail: session ? "sessão sem framedipaddress" : "nenhuma sessão ativa" });
        } catch (err: any) {
          tried.push({ source: "radius", ok: false, detail: String(err?.message || err).slice(0, 200) });
        }
      } else {
        tried.push({ source: "radius", ok: false, detail: "link sem pppoeUser" });
      }

      // 2) Mikrotik ARP via interface (PTP/L2 com concentrador + interface SNMP)
      if ((link as any).concentratorId && (link as any).snmpInterfaceName) {
        try {
          const concentrator = await storage.getConcentrator((link as any).concentratorId);
          if (!concentrator) {
            tried.push({ source: "mikrotik_arp", ok: false, detail: "concentrador não encontrado" });
          } else {
            const { executeMikrotikQuery } = await import("./concentrator");
            const iface = sanitizeIface((link as any).snmpInterfaceName);
            const arpRes = await executeMikrotikQuery(concentrator as any, "/ip/arp", { interface: iface }, 50);
            const candidates: Array<{ address?: string; "mac-address"?: string; complete?: string }> = (arpRes as any).rows || [];
            const valid = candidates.filter((r) => isValidIp(r.address) && r["mac-address"]);
            if (valid.length === 1) {
              const ip = String(valid[0].address).trim();
              tried.push({ source: "mikrotik_arp", ok: true, detail: `1 entrada ARP em ${iface}` });
              return res.json({ success: true, ip, source: "mikrotik_arp", interface: iface, mac: valid[0]["mac-address"], tried });
            }
            if (valid.length > 1) {
              tried.push({ source: "mikrotik_arp", ok: false, detail: `${valid.length} IPs na interface ${iface} — ambíguo` });
              return res.json({
                success: false,
                source: "mikrotik_arp",
                ambiguous: true,
                candidates: valid.map((r) => ({ ip: r.address, mac: r["mac-address"] })),
                interface: iface,
                tried,
              });
            }
            tried.push({ source: "mikrotik_arp", ok: false, detail: arpRes.error || `nenhuma entrada ARP em ${iface}` });
          }
        } catch (err: any) {
          tried.push({ source: "mikrotik_arp", ok: false, detail: String(err?.message || err).slice(0, 200) });
        }
      } else {
        tried.push({ source: "mikrotik_arp", ok: false, detail: "link sem concentrador ou snmpInterfaceName" });
      }

      return res.json({ success: false, ip: null, tried, message: "Nenhuma fonte retornou um IP válido (RADIUS/ARP). Tente o IP da etiqueta Voalle." });
    } catch (error: any) {
      console.error("[discover-monitored-ip] erro:", error);
      return res.status(500).json({ error: error?.message || "Erro inesperado" });
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
        let decryptedWebPassword = null;
        if (cpe.webPassword) {
          try {
            decryptedWebPassword = isEncrypted(cpe.webPassword) ? decrypt(cpe.webPassword) : cpe.webPassword;
          } catch (e) {
            console.error(`Failed to decrypt web password for CPE ${cpe.id}:`, e);
          }
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

        // Fallback user: quando o sshUser armazenado é igual ao usuário RADIUS (ou está vazio),
        // usa "admin" para evitar tentar o mesmo usuário que já falhou.
        const radiusUsername = radiusCredentials?.username;
        const storedLocalUser = cpe.sshUser;
        const effectiveFallbackUser = cpeUsingRadius
          ? ((!storedLocalUser || storedLocalUser === radiusUsername) ? "admin" : storedLocalUser)
          : undefined;
        
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
          webUser: cpe.webUser || null,
          webPassword: decryptedWebPassword,
          winboxPort: cpe.winboxPort || 8291,
          vendor: vendor?.slug || null,
          hasAccess: cpe.hasAccess,
          cpuUsage: lastMonitoredAt ? (cpuUsage ?? null) : null,
          memoryUsage: lastMonitoredAt ? (memoryUsage ?? null) : null,
          lastMonitoredAt: lastMonitoredAt?.toISOString() || null,
          usingRadiusCredentials: cpeUsingRadius,
          // Credenciais de fallback (locais do CPE — usuário diferente do RADIUS)
          fallbackSshUser: effectiveFallbackUser,
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

  app.get("/api/massive-outages", requireAuth, async (req, res) => {
    try {
      const { massiveOutages } = await import("@shared/schema");
      const { desc, eq } = await import("drizzle-orm");
      const status = (req.query.status as string) || "active";
      const rows = await db
        .select()
        .from(massiveOutages)
        .where(eq(massiveOutages.status, status))
        .orderBy(desc(massiveOutages.startedAt));
      res.json(rows);
    } catch (error: any) {
      console.error("[massive-outages] list error:", error);
      res.status(500).json({ error: "Failed to fetch massive outages" });
    }
  });

  app.get("/api/massive-outages/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) return res.status(400).json({ error: "invalid id" });
      const { getMassiveOutageDetail } = await import("./massive-outage-detector");
      const detail = await getMassiveOutageDetail(id);
      if (!detail) return res.status(404).json({ error: "not found" });
      res.json(detail);
    } catch (error: any) {
      console.error("[massive-outages] detail error:", error);
      res.status(500).json({ error: "Failed to fetch outage detail" });
    }
  });

  app.get("/api/massive-outages/:id/route-diagram", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) return res.status(400).json({ error: "invalid id" });
      const { getMassiveOutageRouteDiagram } = await import("./massive-outage-detector");
      const diagram = await getMassiveOutageRouteDiagram(id);
      if (!diagram) return res.status(404).json({ error: "not found" });
      res.json(diagram);
    } catch (error: any) {
      console.error("[massive-outages] route-diagram error:", error);
      res.status(500).json({ error: "Failed to compute route diagram" });
    }
  });

  app.post("/api/massive-outages/:id/sync-routes", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) return res.status(400).json({ error: "invalid id" });
      const { syncRoutesForOutage } = await import("./massive-outage-detector");
      const result = await syncRoutesForOutage(id);
      res.json({ ok: true, ...result });
    } catch (error: any) {
      console.error("[massive-outages] sync-routes error:", error);
      res.status(500).json({ error: error?.message || "Failed to sync routes" });
    }
  });

  app.post("/api/admin/ozmap/sync-topology", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const { syncOzmapTopologyForAllLinks } = await import("./ozmap-topology");
      const onlyMissing = req.body?.onlyMissing === true;
      // Roda em background — devolve já
      syncOzmapTopologyForAllLinks({ onlyMissing }).catch((e) =>
        console.error("[OZmap Topology Sync] erro background:", e)
      );
      res.json({ ok: true, message: "Sync iniciado em background" });
    } catch (error: any) {
      console.error("[ozmap topology] sync error:", error);
      res.status(500).json({ error: error?.message || "Failed to start sync" });
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
      const allFields: Array<{ field: string; label: string; local: any; voalle: any; match: boolean; note?: string | null }> = [];

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
        let localSplitterName = link.ozmapSplitterName || link.zabbixSplitterName || null;
        let localSplitterPort: string | null = link.ozmapSplitterPort || link.zabbixSplitterPort || (link.voalleSplitterPort !== null && link.voalleSplitterPort !== undefined ? String(link.voalleSplitterPort) : null);

        if (!localSplitterName && link.splitterId) {
          try {
            const [splitterRecord] = await db.select().from(splitters).where(eq(splitters.id, link.splitterId)).limit(1);
            if (splitterRecord) {
              localSplitterName = splitterRecord.name;
            }
          } catch {}
        }

        const voalleSplitterName = voalleSplitter?.title || null;
        const voalleSplitterId = voalleSplitter?.id || null;
        const voalleSplitterPort = voalleSplitter?.port !== null && voalleSplitter?.port !== undefined ? String(voalleSplitter.port) : null;

        let splitterNameMatch = false;
        let splitterNote: string | null = null;
        if (!voalleSplitterName && localSplitterName) {
          splitterNameMatch = true;
          splitterNote = 'Portal API não retorna splitter';
        } else if (!voalleSplitterName) {
          splitterNameMatch = true;
        } else if (localSplitterName && localSplitterName.trim().toLowerCase() === voalleSplitterName.trim().toLowerCase()) {
          splitterNameMatch = true;
        } else if (link.voalleSplitterId && voalleSplitterId && link.voalleSplitterId === voalleSplitterId) {
          splitterNameMatch = true;
          if (!localSplitterName) localSplitterName = voalleSplitterName;
        }

        allFields.push({ field: 'splitterName', label: 'Splitter', local: localSplitterName, voalle: voalleSplitterName || (localSplitterName ? '(N/D via Portal)' : null), match: splitterNameMatch, note: splitterNote });
        if (!splitterNameMatch) {
          divergences.push({ field: 'splitterName', label: 'Splitter', local: localSplitterName, voalle: voalleSplitterName });
        }

        let splitterPortMatch = false;
        let splitterPortNote: string | null = null;
        if (!voalleSplitterPort && localSplitterPort) {
          splitterPortMatch = true;
          splitterPortNote = 'Portal API não retorna porta';
        } else if (!voalleSplitterPort) {
          splitterPortMatch = true;
        } else if (localSplitterPort && localSplitterPort.trim() === voalleSplitterPort.trim()) {
          splitterPortMatch = true;
        } else if (link.voalleSplitterId && voalleSplitterId && link.voalleSplitterId === voalleSplitterId) {
          splitterPortMatch = true;
          if (!localSplitterPort) localSplitterPort = voalleSplitterPort;
        }

        allFields.push({ field: 'splitterPort', label: 'Porta Splitter', local: localSplitterPort, voalle: voalleSplitterPort || (localSplitterPort ? '(N/D via Portal)' : null), match: splitterPortMatch, note: splitterPortNote });
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

      let addressSynced = false;
      let voalleConn: any = null;
      try {
        const voalleCustomerId = client.voalleCustomerId ? client.voalleCustomerId.toString() : null;
        const portalUsername = client.voallePortalUsername || null;
        let portalPassword: string | null = null;
        try {
          portalPassword = client.voallePortalPassword ? decrypt(client.voallePortalPassword) : null;
        } catch { portalPassword = null; }

        if (voalleCustomerId && portalUsername && portalPassword) {
          const connResult = await adapter.getConnections({ voalleCustomerId, portalUsername, portalPassword });
          if (connResult.success && connResult.connections?.length) {
            voalleConn = connResult.connections.find((c: any) => c.connectionId === connectionId || c.id === connectionId);
            if (voalleConn?.peopleAddress) {
              const addr = voalleConn.peopleAddress;
              let streetPart = addr.street || '';
              if (addr.streetType && streetPart && !streetPart.toLowerCase().startsWith(addr.streetType.toLowerCase())) {
                streetPart = `${addr.streetType} ${streetPart}`;
              }
              const voalleAddr = [streetPart, addr.number, addr.neighborhood].filter(Boolean).join(', ');
              if (voalleAddr && voalleAddr !== updatedLink.address) {
                await storage.updateLink(linkId, { address: voalleAddr });
                addressSynced = true;
                console.log(`[Voalle Sync] Endereço atualizado Voalle → Local: "${voalleAddr}"`);
              }
            }
          }
        }
      } catch (addrErr) {
        console.error(`[Voalle Sync] Erro ao sincronizar endereço:`, addrErr);
      }

      if (Object.keys(fields).length === 0 && !addressSynced) {
        return res.json({ success: true, message: "Nenhum campo para sincronizar", synced: 0 });
      }

      let updateResult = { success: true, message: '', apiResponse: '' };
      if (Object.keys(fields).length > 0) {
        let currentPppoePassword = voalleConn?.pppoePassword || voalleConn?.password || undefined;
        if (!currentPppoePassword) {
          const pppoeUser = voalleConn?.pppoeUser || updatedLink.pppoeUser;
          if (pppoeUser) {
            console.log(`[Voalle Sync] Senha PPPoE não encontrada via Portal API, buscando no RADIUS para ${pppoeUser}`);
            try {
              const { getRadiusPassword } = await import("./radius");
              currentPppoePassword = (await getRadiusPassword(pppoeUser)) || undefined;
            } catch (radErr) {
              console.error(`[Voalle Sync] Erro ao buscar senha RADIUS:`, radErr);
            }
          }
        }
        if (!currentPppoePassword) {
          const isCorporateOrPtp = updatedLink.authType === 'corporate' || updatedLink.linkType === 'ptp';
          if (isCorporateOrPtp) {
            console.log(`[Voalle Sync] Link corporativo/PTP sem senha PPPoE. Sincronizando apenas endereço (campos API ignorados).`);
          } else {
            // Dados já foram salvos localmente (PATCH anterior). Apenas não é possível atualizar a API do Voalle
            // sem a senha PPPoE atual (necessária para não zerá-la). Retorna sucesso parcial com aviso.
            console.log(`[Voalle Sync] Senha PPPoE não disponível (Portal API e RADIUS). Dados locais salvos; Voalle não atualizado.`);
            return res.json({
              success: true,
              synced: addressSynced ? 1 : 0,
              warning: "Dados salvos localmente. Voalle não foi atualizado pois a senha PPPoE do cliente não foi encontrada.",
            });
          }
        }
        if (currentPppoePassword) {
          updateResult = await adapter.updateConnectionFields(connectionId, fields, currentPppoePassword);
          if (!updateResult.success) {
            console.error(`[Voalle Sync] Falha ao atualizar conexão ${connectionId}:`, updateResult.message);
            return res.json({ success: false, message: updateResult.message || "Erro ao atualizar Voalle" });
          }
        }
      }

      const totalSynced = Object.keys(fields).length + (addressSynced ? 1 : 0);
      console.log(`[Voalle Sync] Link ${linkId} -> Conexão ${connectionId}: ${totalSynced} campos sincronizados${addressSynced ? ' (inclui endereço Voalle→Local)' : ''}`);
      console.log(`[Voalle Sync] Payload enviado: ${JSON.stringify(fields)}`);
      console.log(`[Voalle Sync] Resposta API: ${updateResult.apiResponse || 'N/A'}`);
      res.json({ 
        success: true, 
        message: `${totalSynced} campo(s) sincronizado(s)${addressSynced ? ' (endereço importado do Voalle)' : ''}`,
        synced: totalSynced,
        fields: [...Object.keys(fields), ...(addressSynced ? ['address'] : [])],
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
      const pageSize = Math.min(parseInt(req.query.pageSize as string) || 100, 9999);
      const statusFilter = req.query.status as string | undefined;
      const clientIdFilter = req.query.clientId ? parseInt(req.query.clientId as string) : undefined;
      const search = (req.query.search as string)?.toLowerCase().trim() || undefined;

      // Verificar cache (evita recalcular tudo a cada troca de página)
      const cacheKey = `dashboard:${page}:${pageSize}:${statusFilter || 'all'}:${clientIdFilter || 'all'}:${search || ''}`;
      const cached = getDashboardCache(cacheKey);
      if (cached) return res.json(cached);

      // Build WHERE conditions (all applied at DB level)
      const baseConditions: any[] = [isNull(links.deletedAt)];

      // Only links from active clients
      const activeClients = await db.select({ id: clientsTable.id, name: clientsTable.name })
        .from(clientsTable).where(eq(clientsTable.isActive, true));
      const activeClientIds = activeClients.map(c => c.id);
      const clientMap = new Map(activeClients.map(c => [c.id, c.name]));

      if (activeClientIds.length === 0) {
        return res.json({ items: [], summary: { totalLinks: 0, onlineLinks: 0, degradedLinks: 0, offlineLinks: 0, activeAlerts: 0, openIncidents: 0 }, page: 1, pageSize, totalPages: 0, totalItems: 0 });
      }
      baseConditions.push(inArray(links.clientId, activeClientIds));

      if (clientIdFilter) {
        baseConditions.push(eq(links.clientId, clientIdFilter));
      }
      if (statusFilter && statusFilter !== 'all') {
        if (statusFilter === 'offline') {
          baseConditions.push(or(eq(links.status, 'offline'), eq(links.status, 'down')));
        } else {
          baseConditions.push(eq(links.status, statusFilter));
        }
      }
      if (search) {
        const term = `%${search}%`;
        // Clientes cujo nome bate com a busca (já estão em memória, sem query extra)
        const matchingClientIds = activeClients
          .filter(c => c.name.toLowerCase().includes(search))
          .map(c => c.id);
        const searchClauses: any[] = [
          sql`LOWER(${links.name}) LIKE ${term}`,
          sql`LOWER(${links.identifier}) LIKE ${term}`,
          sql`LOWER(${links.ipBlock}) LIKE ${term}`,
          sql`LOWER(${links.location}) LIKE ${term}`,
          sql`LOWER(${links.address}) LIKE ${term}`,
        ];
        if (matchingClientIds.length > 0) {
          searchClauses.push(inArray(links.clientId, matchingClientIds));
        }
        baseConditions.push(or(...searchClauses));
      }

      const whereClause = and(...baseConditions);

      // Run summary counts and paginated data in parallel
      const [countRows, onlineRows, degradedRows, offlineRows, paginatedLinks] = await Promise.all([
        // Total count (with all filters)
        db.select({ count: sql<number>`COUNT(*)::int` }).from(links).where(whereClause),
        // Online count
        db.select({ count: sql<number>`COUNT(*)::int` }).from(links).where(and(...baseConditions, eq(links.status, 'operational'))),
        // Degraded count
        db.select({ count: sql<number>`COUNT(*)::int` }).from(links).where(and(...baseConditions, eq(links.status, 'degraded'))),
        // Offline count
        db.select({ count: sql<number>`COUNT(*)::int` }).from(links).where(and(...baseConditions, or(eq(links.status, 'offline'), eq(links.status, 'down')))),
        // Paginated links — select only the columns needed for the dashboard card
        db.select({
          id: links.id,
          clientId: links.clientId,
          name: links.name,
          identifier: links.identifier,
          ipBlock: links.ipBlock,
          location: links.location,
          bandwidth: links.bandwidth,
          status: links.status,
          currentDownload: links.currentDownload,
          currentUpload: links.currentUpload,
          latency: links.latency,
          packetLoss: links.packetLoss,
          uptime: links.uptime,
          invertBandwidth: links.invertBandwidth,
          monitoringEnabled: links.monitoringEnabled,
          lastUpdated: links.lastUpdated,
        })
          .from(links)
          .where(whereClause)
          .orderBy(sql`CASE ${links.status} WHEN 'offline' THEN 0 WHEN 'down' THEN 0 WHEN 'degraded' THEN 1 ELSE 2 END`)
          .limit(pageSize)
          .offset((page - 1) * pageSize),
      ]);

      const totalItems = countRows[0]?.count ?? 0;
      const totalPages = Math.ceil(totalItems / pageSize);

      const summary = {
        totalLinks: totalItems,
        onlineLinks: onlineRows[0]?.count ?? 0,
        degradedLinks: degradedRows[0]?.count ?? 0,
        offlineLinks: offlineRows[0]?.count ?? 0,
        activeAlerts: 0,
        openIncidents: 0,
      };

      // Fetch events and incidents only for the paginated set — queries filtradas por linkId
      const linkIds = paginatedLinks.map(l => l.id);
      const activeEventsByLink = new Map<number, any>();
      const openIncidentsByLink = new Map<number, any>();

      if (linkIds.length > 0) {
        const [unresolvedEvents, openIncidents] = await Promise.all([
          // Eventos: só colunas necessárias, filtrados pelos linkIds da página
          db.select({
            id: eventsTable.id,
            linkId: eventsTable.linkId,
            type: eventsTable.type,
            description: eventsTable.description,
            timestamp: eventsTable.timestamp,
          })
            .from(eventsTable)
            .where(and(inArray(eventsTable.linkId, linkIds), eq(eventsTable.resolved, false))),
          // Incidentes: filtrados pelos linkIds da página (sem buscar todos os incidentes abertos)
          db.select({
            id: incidentsTable.id,
            linkId: incidentsTable.linkId,
            description: incidentsTable.description,
            erpTicketId: incidentsTable.erpTicketId,
            openedAt: incidentsTable.openedAt,
          })
            .from(incidentsTable)
            .where(and(inArray(incidentsTable.linkId, linkIds), isNull(incidentsTable.closedAt))),
        ]);

        for (const event of unresolvedEvents) {
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

        for (const incident of openIncidents) {
          if (incident.linkId && !openIncidentsByLink.has(incident.linkId)) {
            openIncidentsByLink.set(incident.linkId, {
              id: incident.id,
              title: incident.description || `Incidente #${incident.id}`,
              voalleProtocolId: incident.erpTicketId ? parseInt(incident.erpTicketId) : null,
              createdAt: incident.openedAt,
            });
            summary.openIncidents++;
          }
        }
      }

      const items = paginatedLinks.map(link => {
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

      const responseData = { items, summary, page, pageSize, totalPages, totalItems };
      setDashboardCache(cacheKey, responseData);
      res.json(responseData);
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
      
      // Buscar portas salvas no banco + modelo do CPE
      const [savedPorts, cpeInfo] = await Promise.all([
        storage.getCpePortStatus(cpeId, linkCpeId),
        storage.getCpe(cpeId),
      ]);
      res.json({ ports: savedPorts, model: cpeInfo?.model || null, sysName: (cpeInfo as any)?.sysName || null });
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
      
      // Coletar sysDescr/sysName via SNMP e salvar no campo model do CPE
      try {
        const { testSnmpConnection } = await import("./snmp");
        const snmpInfo = await testSnmpConnection(targetIp, snmpProfile as any);
        if (snmpInfo.success && (snmpInfo.sysDescr || snmpInfo.sysName)) {
          // sysDescr costuma conter modelo completo, sysName é o hostname
          const collectedModel = (snmpInfo.sysDescr || snmpInfo.sysName || "").substring(0, 200).trim();
          if (collectedModel) {
            await storage.updateCpe(cpeId, { model: collectedModel });
          }
        }
      } catch (sysErr) {
        // Não falha o fluxo por erro ao coletar sysDescr
        console.warn(`[CPE Ports] Falha ao coletar sysDescr do CPE ${cpeId}:`, sysErr);
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
      
      const updatedCpe = await storage.getCpe(cpeId);
      res.json({
        success: true,
        portsFound: physicalInterfaces.length,
        ports: savedPorts,
        model: updatedCpe?.model || null,
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

  // Habilitar WebFig via SSH no Mikrotik
  app.post("/api/cpe/:cpeId/enable-webfig", requireAuth, async (req, res) => {
    try {
      const cpeId = parseInt(req.params.cpeId, 10);
      if (isNaN(cpeId)) return res.status(400).json({ error: "ID inválido" });

      const cpe = await storage.getCpe(cpeId);
      if (!cpe) return res.status(404).json({ error: "CPE não encontrado" });

      // Determinar IP efetivo: ipOverride da associação link_cpe ou ipAddress do CPE
      const { linkCpeId } = req.body as { linkCpeId?: number };
      let ip = cpe.ipAddress?.trim() || null;
      if (linkCpeId) {
        const linkCpe = await storage.getLinkCpe(linkCpeId);
        if (linkCpe?.ipOverride) ip = linkCpe.ipOverride.trim();
      }
      if (!ip) return res.status(400).json({ error: "CPE sem IP configurado" });

      // Credenciais SSH: aceitar do frontend (já resolvidas pelo endpoint /devices, que considera RADIUS)
      // ou recalcular localmente como fallback
      const { sshUser: bodyUser, sshPassword: bodyPassword } = req.body as {
        sshUser?: string;
        sshPassword?: string;
      };

      let resolvedUser: string;
      let resolvedPass: string;
      const radiusSettingsWf = await storage.getRadiusSettings();
      const useRadiusWf = radiusSettingsWf?.isEnabled && radiusSettingsWf?.useRadiusForDevices;
      const radiusCredsWf = (req.session as any)?.radiusCredentials;

      if (bodyUser && bodyPassword) {
        // Frontend enviou credenciais já resolvidas (RADIUS ou locais) → usar diretamente
        resolvedUser = bodyUser;
        resolvedPass = bodyPassword;
        console.log(`[WebFig] CPE ${cpe.name} (${ip}): usando credenciais do frontend — user=${resolvedUser}`);
      } else if (radiusCredsWf?.username && radiusCredsWf?.password) {
        // Fallback: credenciais RADIUS da sessão (disponíveis mesmo sem useRadiusForDevices global)
        resolvedUser = bodyUser || radiusCredsWf.username;
        resolvedPass = radiusCredsWf.password;
        console.log(`[WebFig] CPE ${cpe.name} (${ip}): usando credenciais RADIUS da sessão — user=${resolvedUser}`);
      } else {
        // Último recurso: credenciais locais do CPE
        let decryptedSshPassword: string | null = null;
        if (cpe.sshPassword) {
          try {
            decryptedSshPassword = isEncrypted(cpe.sshPassword) ? decrypt(cpe.sshPassword) : cpe.sshPassword;
          } catch (e) {
            console.error(`[WebFig] Falha ao descriptografar senha SSH do CPE ${cpeId}:`, e);
          }
        }
        resolvedUser = (useRadiusWf && radiusCredsWf?.username) ? radiusCredsWf.username : (bodyUser || cpe.sshUser || "admin");
        resolvedPass = (useRadiusWf && radiusCredsWf?.password) ? radiusCredsWf.password : (decryptedSshPassword || "");
        console.log(`[WebFig] CPE ${cpe.name} (${ip}): credenciais locais — user=${resolvedUser}, useRadius=${useRadiusWf}`);
      }

      const sshUser = resolvedUser;
      const rawPass = resolvedPass;
      const sshPort = cpe.sshPort || 22;

      // Comando RouterOS para habilitar o serviço www (WebFig) restrito aos IPs de gerência da Marvitel
      const command = '/ip service set www disabled=no port=80 address=191.52.254.74/32,191.52.248.26/32,191.52.248.227/32';

      const { Client: SSHClient2 } = await import("ssh2");

      const runSshCommand = (user: string, pass: string): Promise<string> =>
        new Promise<string>((resolve, reject) => {
          const client = new SSHClient2();
          let out = "";
          const timer = setTimeout(() => { client.end(); reject(new Error("Timeout de conexão SSH")); }, 35000);

          client.on("ready", () => {
            client.exec(command, (err: any, stream: any) => {
              if (err) { clearTimeout(timer); client.end(); return reject(err); }
              stream.on("close", () => { clearTimeout(timer); client.end(); resolve(out.trim()); });
              stream.on("data", (d: Buffer) => { out += d.toString(); });
              stream.stderr.on("data", (d: Buffer) => { out += d.toString(); });
            });
          });

          client.on("error", (err: any) => { clearTimeout(timer); reject(err); });

          client.connect({
            host: ip,
            port: sshPort,
            username: user,
            password: pass,
            readyTimeout: 30000,
            tryKeyboard: true,
            algorithms: {
              kex: [
                "diffie-hellman-group1-sha1",
                "diffie-hellman-group14-sha1",
                "diffie-hellman-group14-sha256",
                "diffie-hellman-group-exchange-sha1",
                "diffie-hellman-group-exchange-sha256",
                "ecdh-sha2-nistp256",
                "ecdh-sha2-nistp384",
                "ecdh-sha2-nistp521",
                "curve25519-sha256",
                "curve25519-sha256@libssh.org",
              ],
              cipher: [
                "aes128-cbc",
                "aes256-cbc",
                "aes192-cbc",
                "3des-cbc",
                "aes128-ctr",
                "aes256-ctr",
                "aes192-ctr",
                "aes128-gcm",
                "aes256-gcm",
                "aes128-gcm@openssh.com",
                "aes256-gcm@openssh.com",
              ],
              serverHostKey: [
                "ssh-rsa",
                "ssh-dss",
                "rsa-sha2-256",
                "rsa-sha2-512",
                "ecdsa-sha2-nistp256",
                "ecdsa-sha2-nistp384",
                "ecdsa-sha2-nistp521",
              ],
              hmac: [
                "hmac-sha1",
                "hmac-sha1-96",
                "hmac-sha2-256",
                "hmac-sha2-512",
                "hmac-md5",
                "hmac-md5-96",
              ],
            },
          });

          client.on("keyboard-interactive", (_name: any, _instructions: any, _lang: any, _prompts: any, finish: any) => {
            finish([pass]);
          });
        });

      const isWfAuthError = (err: any) =>
        /All configured authentication methods failed|USERAUTH_FAILURE|auth.*fail/i.test(err?.message || "");

      let output: string;
      try {
        output = await runSshCommand(sshUser, rawPass);
      } catch (primaryErr: any) {
        if (isWfAuthError(primaryErr)) {
          // Auth falhou — tenta credenciais locais do CPE
          let decPassFb: string | null = null;
          if (cpe.sshPassword) {
            try { decPassFb = isEncrypted(cpe.sshPassword) ? decrypt(cpe.sshPassword) : cpe.sshPassword; } catch {}
          }
          const fbUser = cpe.sshUser || "admin";
          const fbPass = decPassFb || "";
          if (fbUser !== sshUser || fbPass !== rawPass) {
            console.log(`[WebFig] Auth falhou com "${sshUser}" — tentando credenciais locais: "${fbUser}"`);
            output = await runSshCommand(fbUser, fbPass);
          } else {
            throw primaryErr;
          }
        } else {
          throw primaryErr;
        }
      }

      console.log(`[WebFig] CPE ${cpe.name} (${ip}): WebFig habilitado. Saída: "${output}"`);
      res.json({ success: true, message: "WebFig habilitado com sucesso", output });
    } catch (error: any) {
      console.error("[WebFig] Erro ao habilitar WebFig:", error);
      res.status(500).json({ error: `Falha ao conectar via SSH: ${error.message}` });
    }
  });

  // CPE Backups — listar, criar, restaurar, excluir
  app.get("/api/cpe/:cpeId/backups", requireAuth, async (req, res) => {
    try {
      const cpeId = parseInt(req.params.cpeId, 10);
      if (isNaN(cpeId)) return res.status(400).json({ error: "ID inválido" });
      const linkCpeId = req.query.linkCpeId ? parseInt(req.query.linkCpeId as string, 10) : undefined;
      const backups = await storage.getCpeBackups(cpeId, 20, linkCpeId && !isNaN(linkCpeId) ? linkCpeId : undefined);
      res.json(backups);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/cpe/:cpeId/backup", requireAuth, async (req, res) => {
    try {
      const cpeId = parseInt(req.params.cpeId, 10);
      if (isNaN(cpeId)) return res.status(400).json({ error: "ID inválido" });

      const cpe = await storage.getCpe(cpeId);
      if (!cpe) return res.status(404).json({ error: "CPE não encontrado" });

      const { linkCpeId, sshUser: bodyUser, sshPassword: bodyPassword, vendorSlug: bodyVendorSlug } = req.body as {
        linkCpeId?: number;
        sshUser?: string;
        sshPassword?: string;
        vendorSlug?: string;
      };

      // Resolver vendor slug — prefere o enviado pelo frontend; fallback: busca pelo vendorId do CPE
      let resolvedVendorSlug: string | null = bodyVendorSlug || null;
      if (!resolvedVendorSlug && cpe.vendorId) {
        const vendor = await storage.getEquipmentVendor(cpe.vendorId);
        resolvedVendorSlug = vendor?.slug || null;
      }

      // Resolver IP efetivo
      let ip = cpe.ipAddress?.trim() || null;
      if (linkCpeId) {
        const linkCpe = await storage.getLinkCpe(linkCpeId);
        if (linkCpe?.ipOverride) ip = linkCpe.ipOverride.trim();
      }
      if (!ip) return res.status(400).json({ error: "CPE sem IP configurado" });

      // Resolver credenciais (frontend envia as já resolvidas)
      let sshUser: string;
      let sshPass: string;
      const radiusSettingsBk = await storage.getRadiusSettings();
      const useRadiusBk = radiusSettingsBk?.isEnabled && radiusSettingsBk?.useRadiusForDevices;
      const radiusCredsBk = (req.session as any)?.radiusCredentials;

      if (bodyUser && bodyPassword) {
        // Credenciais completas enviadas pelo frontend (já resolvidas pelo endpoint /devices)
        sshUser = bodyUser;
        sshPass = bodyPassword;
      } else if (radiusCredsBk?.username && radiusCredsBk?.password) {
        // Fallback: credenciais RADIUS da sessão — usa o par RADIUS completo (não mistura com bodyUser)
        sshUser = radiusCredsBk.username;
        sshPass = radiusCredsBk.password;
      } else {
        // Último recurso: credenciais locais do CPE
        let decPass: string | null = null;
        if (cpe.sshPassword) {
          try { decPass = isEncrypted(cpe.sshPassword) ? decrypt(cpe.sshPassword) : cpe.sshPassword; } catch {}
        }
        sshUser = bodyUser || cpe.sshUser || "admin";
        sshPass = decPass || "";
      }
      console.log(`[Backup] CPE ${cpe.name} (${ip}): user=${sshUser}, hasPass=${!!sshPass}, fromFrontend=${!!(bodyUser && bodyPassword)}, hasRadius=${!!radiusCredsBk?.username}`);

      const user = req.user as any;
      // Helper: verifica se o erro é de autenticação SSH
      const isAuthError = (err: any) =>
        /All configured authentication methods failed|USERAUTH_FAILURE|auth.*fail/i.test(err?.message || "");

      // Tenta backup com as credenciais resolvidas
      let backupResult: { backupId: number; size: number };
      try {
        backupResult = await backupCpe(
          cpeId, linkCpeId, ip, cpe.sshPort || 22, sshUser, sshPass, "manual",
          user?.id, user?.name || user?.username,
          resolvedVendorSlug,
        );
      } catch (primaryErr: any) {
        if (isAuthError(primaryErr)) {
          // Auth falhou — tenta credenciais locais do CPE (usuário/senha cadastrados no cadastro)
          let decPassFallback: string | null = null;
          if (cpe.sshPassword) {
            try { decPassFallback = isEncrypted(cpe.sshPassword) ? decrypt(cpe.sshPassword) : cpe.sshPassword; } catch {}
          }
          const fbUser = cpe.sshUser || "admin";
          const fbPass = decPassFallback || "";

          if (fbUser !== sshUser || fbPass !== sshPass) {
            console.log(`[Backup] Auth falhou com "${sshUser}" — tentando credenciais locais: "${fbUser}"`);
            backupResult = await backupCpe(
              cpeId, linkCpeId, ip, cpe.sshPort || 22, fbUser, fbPass, "manual",
              user?.id, user?.name || user?.username,
              resolvedVendorSlug,
            );
          } else {
            throw primaryErr;
          }
        } else {
          throw primaryErr;
        }
      }

      res.json({ success: true, backupId: backupResult.backupId, size: backupResult.size, message: "Backup realizado com sucesso" });
    } catch (error: any) {
      console.error("[Backup] Erro:", error);
      res.status(500).json({ error: `Falha ao executar backup: ${error.message}` });
    }
  });

  app.delete("/api/cpe/backup/:backupId", requireAuth, async (req, res) => {
    try {
      const backupId = parseInt(req.params.backupId, 10);
      if (isNaN(backupId)) return res.status(400).json({ error: "ID inválido" });
      const backup = await storage.getCpeBackup(backupId);
      if (!backup) return res.status(404).json({ error: "Backup não encontrado" });
      await storage.deleteCpeBackup(backupId);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/cpe/backup/:backupId/download", requireAuth, async (req, res) => {
    try {
      const backupId = parseInt(req.params.backupId, 10);
      if (isNaN(backupId)) return res.status(400).json({ error: "ID inválido" });
      const backup = await storage.getCpeBackup(backupId);
      if (!backup) return res.status(404).json({ error: "Backup não encontrado" });

      // Busca dados do CPE e do link para enriquecer o arquivo
      const cpe = await storage.getCpe(backup.cpeId);
      let linkName = "";
      let linkId = "";
      if (backup.linkCpeId) {
        const linkCpe = await storage.getLinkCpe(backup.linkCpeId);
        if (linkCpe) {
          const link = await storage.getLink(linkCpe.linkId);
          if (link) {
            linkName = link.name;
            linkId = String(link.id);
          }
        }
      }

      const isDatacom = backup.vendor?.includes("datacom");
      const ext = isDatacom ? "cfg" : "rsc";
      const commentChar = isDatacom ? "!" : "#";

      // Monta nome de arquivo: LINK-CPE-DATA.ext (slug seguro para nome de arquivo)
      const slugify = (s: string) =>
        s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9_\-]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");

      const datePart = new Date(backup.createdAt).toISOString().slice(0, 10);
      const nameParts = [
        linkName ? slugify(linkName) : `cpe-${backup.cpeId}`,
        cpe?.name ? slugify(cpe.name) : null,
        datePart,
      ].filter(Boolean);
      const filename = `${nameParts.join("_")}.${ext}`;

      // Monta cabeçalho de metadados (comentários compatíveis com o formato do fabricante)
      const createdAt = new Date(backup.createdAt);
      const dateStr = createdAt.toLocaleString("pt-BR", { timeZone: "America/Maceio", hour12: false });
      const headerLines = [
        `${commentChar} ============================================================`,
        `${commentChar} Link Monitor - Backup de Configuração`,
        `${commentChar} ============================================================`,
        linkName  ? `${commentChar} Link: ${linkName}` : null,
        linkId    ? `${commentChar} Link ID: ${linkId}` : null,
        cpe?.name ? `${commentChar} CPE: ${cpe.name}` : null,
        backup.deviceName ? `${commentChar} Hostname: ${backup.deviceName}` : null,
        backup.routerosVersion ? `${commentChar} Firmware: ${backup.routerosVersion}` : null,
        `${commentChar} Fabricante: ${backup.vendor || "desconhecido"}`,
        `${commentChar} Data do backup: ${dateStr}`,
        backup.source === "scheduled" ? `${commentChar} Origem: Agendado automaticamente` : `${commentChar} Origem: Manual${backup.createdByUsername ? ` (${backup.createdByUsername})` : ""}`,
        `${commentChar} ============================================================`,
        "",
      ].filter(l => l !== null).join("\n");

      const content = headerLines + (backup.content || "");

      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(content);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/cpe/backup/:backupId/restore", requireAuth, async (req, res) => {
    try {
      const backupId = parseInt(req.params.backupId, 10);
      if (isNaN(backupId)) return res.status(400).json({ error: "ID inválido" });
      const backup = await storage.getCpeBackup(backupId);
      if (!backup) return res.status(404).json({ error: "Backup não encontrado" });

      if (backup.vendor === "datacom") {
        return res.status(400).json({ error: "Restauração automática não suportada para Datacom. Aplique a configuração manualmente." });
      }

      const cpe = await storage.getCpe(backup.cpeId);
      if (!cpe) return res.status(404).json({ error: "CPE não encontrado" });

      const { sshUser: bodyUser, sshPassword: bodyPassword } = req.body as {
        sshUser?: string;
        sshPassword?: string;
      };

      let ip = cpe.ipAddress?.trim() || null;
      if (backup.linkCpeId) {
        const linkCpe = await storage.getLinkCpe(backup.linkCpeId);
        if (linkCpe?.ipOverride) ip = linkCpe.ipOverride.trim();
      }
      if (!ip) return res.status(400).json({ error: "CPE sem IP configurado" });

      let sshUser: string;
      let sshPass: string;
      const radiusSettingsRs = await storage.getRadiusSettings();
      const useRadiusRs = radiusSettingsRs?.isEnabled && radiusSettingsRs?.useRadiusForDevices;
      const radiusCredsRs = (req.session as any)?.radiusCredentials;

      if (bodyUser && bodyPassword) {
        sshUser = bodyUser;
        sshPass = bodyPassword;
      } else if (radiusCredsRs?.username && radiusCredsRs?.password) {
        // Usa o par RADIUS completo — não mistura bodyUser com senha RADIUS
        sshUser = radiusCredsRs.username;
        sshPass = radiusCredsRs.password;
      } else {
        let decPass: string | null = null;
        if (cpe.sshPassword) {
          try { decPass = isEncrypted(cpe.sshPassword) ? decrypt(cpe.sshPassword) : cpe.sshPassword; } catch {}
        }
        sshUser = bodyUser || cpe.sshUser || "admin";
        sshPass = decPass || "";
      }

      const output = await restoreMikrotikBackup(ip, cpe.sshPort || 22, sshUser, sshPass, backup.content);
      console.log(`[Backup] Restore do backup ${backupId} no CPE ${cpe.name} (${ip}): ${output}`);
      res.json({ success: true, message: "Restauração iniciada com sucesso", output });
    } catch (error: any) {
      console.error("[Backup] Erro ao restaurar:", error);
      res.status(500).json({ error: `Falha ao restaurar: ${error.message}` });
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

        // Check if access point ID matches a concentrator's voalleAccessPointIds (NOT the main voalleIds which are concentrator IDs)
        const concByAPId = existingConcentratorsByAccessPointVoalleId.get(voalleId);
        if (concByAPId) {
          console.log(`[Voalle Import] Access point ID ${voalleId} matches concentrator "${concByAPId.name}" via voalleAccessPointIds`);
          return { oltId: null, switchId: null, concentratorAsAccessPointId: concByAPId.id };
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

      const integration = await storage.getExternalIntegrationByProvider("ozmap");
      if (!integration || !integration.apiKey || !integration.apiUrl) {
        return res.status(400).json({ error: "OZmap não configurado" });
      }

      if (!integration.isActive) {
        return res.status(400).json({ error: "Integração OZmap está desativada" });
      }

      // Normalizar URL base - remover /api/v2 se existir para evitar duplicação
      let baseUrl = integration.apiUrl.replace(/\/+$/, "");
      if (baseUrl.endsWith("/api/v2")) {
        baseUrl = baseUrl.slice(0, -7);
      }

      const ozmapHeaders = { "Accept": "application/json", "Authorization": integration.apiKey };

      // Usa a tag do contrato Voalle, identificador do link, ou campo separado para OZmap
      let resolvedTag = link.voalleContractTagServiceTag || link.identifier || (link as any).ozmapTag || null;
      let tagFoundViaFallback = false;
      let data: any = null;
      // Indica que o cliente FOI encontrado no OZmap mas não tem rota de fibra configurada
      let clientFoundButNoRoute = false;

      // Helper: busca potência e distingue "com rota" / "sem rota" / "não encontrado"
      // OZmap retorna body vazio (0 bytes) quando a etiqueta existe mas não tem rota configurada
      async function fetchPotency(tag: string): Promise<{ data: any[] | null; noRoute: boolean }> {
        const potencyUrl = `${baseUrl}/api/v2/properties/client/${encodeURIComponent(tag)}/potency?locale=pt_BR`;
        const r = await fetch(potencyUrl, { method: "GET", headers: ozmapHeaders });
        console.log(`[OZmap] fetchPotency tag="${tag}" → status=${r.status}`);
        if (!r.ok) {
          // HTTP 422 = OZmap retorna quando o cliente existe mas não tem rota de fibra configurada
          // (confirmado empiricamente: tags com 422 existem no OZmap via ftth-clients)
          if (r.status === 422) {
            console.log(`[OZmap] fetchPotency tag="${tag}" → 422 = cliente sem rota de fibra`);
            return { data: null, noRoute: true };
          }
          // HTTP 404 = cliente não encontrado no OZmap
          console.log(`[OZmap] fetchPotency tag="${tag}" → ${r.status} = não encontrado`);
          return { data: null, noRoute: false };
        }
        const text = await r.text();
        console.log(`[OZmap] fetchPotency tag="${tag}" → body length=${text.length}`);
        if (!text || text.trim() === "" || text.trim() === "null") {
          // Body vazio — cliente existe mas sem rota de fibra
          return { data: null, noRoute: true };
        }
        try {
          const parsed = JSON.parse(text);
          if (Array.isArray(parsed) && parsed.length > 0) return { data: parsed, noRoute: false };
          // Array vazio [] — cliente existe mas sem rota
          return { data: null, noRoute: true };
        } catch {
          console.warn(`[OZmap] fetchPotency parse error para tag="${tag}", preview="${text.substring(0, 200)}"`);
          return { data: null, noRoute: false };
        }
      }

      // Tentativa 1: tag principal (se existir)
      if (resolvedTag) {
        console.log("[OZmap] Fetching potency:", { linkId, resolvedTag });
        const result = await fetchPotency(resolvedTag);
        if (result.data) {
          data = result.data;
        } else if (result.noRoute) {
          clientFoundButNoRoute = true;
          console.log(`[OZmap] Tag "${resolvedTag}" encontrada mas sem rota de fibra configurada`);
        } else {
          console.log(`[OZmap] Tag "${resolvedTag}" não encontrada — tentando fallbacks`);
        }
      } else {
        console.log(`[OZmap] Link id=${linkId} sem tag configurada — tentando fallbacks`);
      }

      // Tentativa 2: fallbacks (serial, PPPoE, OLT, splitter)
      // Só tenta se não temos dados E o cliente não foi encontrado (evita sobrescrever tag válida)
      if (!data && !clientFoundButNoRoute) {
        const fallback = await findOzmapTagByFallback(baseUrl, integration.apiKey, link);
        if (fallback) {
          resolvedTag = fallback.code;
          tagFoundViaFallback = true;
          console.log(`[OZmap] Tag encontrada via fallback (${fallback.method}): ${resolvedTag}`);
          // Salvar a tag correta no link para futuras sincronizações
          await storage.updateLink(linkId, { voalleContractTagServiceTag: resolvedTag } as any);
          const result = await fetchPotency(resolvedTag);
          if (result.data) {
            data = result.data;
          } else if (result.noRoute) {
            clientFoundButNoRoute = true;
            console.log(`[OZmap] Tag via fallback "${resolvedTag}" também sem rota configurada`);
          }
        }
      }

      // Cliente cadastrado no OZmap mas sem rota de fibra → retorna 200 com flag específico
      if (clientFoundButNoRoute && (!data || data.length === 0)) {
        console.log(`[OZmap] Link id=${linkId} tag="${resolvedTag}": cadastrado no OZmap sem rota de fibra`);
        return res.json({
          linkId,
          ozmapTag: resolvedTag,
          potencyData: [],
          noRoute: true,
          message: "Cliente cadastrado no OZmap mas sem rota de fibra configurada",
        });
      }

      if (!data || !Array.isArray(data) || data.length === 0) {
        const noTagMsg = !resolvedTag
          ? "Link não possui tag OZmap, serial de ONU, login PPPoE ou dados de OLT configurados"
          : `Nenhum dado encontrado no OZmap para este link (todos os critérios de busca esgotados)`;
        return res.status(404).json({ error: noTagMsg, fallbackAttempted: !!(link.equipmentSerialNumber || link.voalleLogin) });
      }

      console.log("[OZmap] Potency Response data:", JSON.stringify(data));

      // Agora buscar dados completos da rota
      let routeData = null;
      try {
        // Buscar dados do cliente FTTH para obter a rota completa
        // IMPORTANTE: ?code= é ignorado pelo OZmap — usar filtro JSON
        const codeFilter = encodeURIComponent(JSON.stringify([{ property: "code", value: resolvedTag!, operator: "=" }]));
        const clientUrl = `${baseUrl}/api/v2/ftth-clients?filter=${codeFilter}&limit=1`;
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
          
          // Encontrar o cliente cujo code bate exatamente com a tag (garantia extra)
          const rows: any[] = clientData.rows || [];
          const matchingClient = rows.find((r: any) => r.code === resolvedTag) || rows[0];
          
          if (matchingClient) {
            const client = matchingClient;
            
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

      // Buscar propriedade pelo código da etiqueta: OLT/slot/PON como fallback + cables (ramal do cliente)
      let propertyData: any = null;
      try {
        const propFilter = JSON.stringify([{ property: "history.clients.code", value: resolvedTag, operator: "=" }]);
        const propertyUrl = `${baseUrl}/api/v2/properties?filter=${encodeURIComponent(propFilter)}&populate=olt%20slot%20pon%20cables`;
        console.log("[OZmap] Fetching property data:", propertyUrl);
        const propertyResponse = await fetch(propertyUrl, {
          method: "GET",
          headers: { "Accept": "application/json", "Authorization": integration.apiKey },
        });
        if (propertyResponse.ok) {
          const pData = await propertyResponse.json();
          console.log("[OZmap] Property data:", JSON.stringify(pData).substring(0, 3000));
          if (pData.rows && pData.rows.length > 0) {
            propertyData = pData.rows[0];
          }
        } else {
          console.log("[OZmap] Property endpoint returned:", propertyResponse.status);
        }
      } catch (propErr) {
        console.log("[OZmap] Could not fetch property data:", propErr);
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
        
        // Fallback: usar propertyData para OLT/slot/PON se potência não os trouxe
        if (propertyData) {
          if (!oltName && propertyData.olt?.name) {
            oltName = propertyData.olt.name;
            console.log(`[OZmap] Link ${linkId}: OLT via property fallback: ${oltName}`);
          }
          if (oltSlot === null) {
            const ps = propertyData.slot;
            if (ps !== undefined && ps !== null) {
              oltSlot = typeof ps === 'object' && ps.number !== undefined ? parseInt(String(ps.number), 10) : parseInt(String(ps), 10);
              if (!isNaN(oltSlot)) console.log(`[OZmap] Link ${linkId}: Slot via property fallback: ${oltSlot}`);
              else oltSlot = null;
            }
          }
          if (oltPort === null) {
            const pp = propertyData.pon;
            if (pp !== undefined && pp !== null) {
              oltPort = typeof pp === 'object' && pp.number !== undefined ? parseInt(String(pp.number), 10) : parseInt(String(pp), 10);
              if (!isNaN(oltPort)) console.log(`[OZmap] Link ${linkId}: PON via property fallback: ${oltPort}`);
              else oltPort = null;
            }
          }
          // Log dos cables disponíveis na propriedade (ramal do cliente)
          if (propertyData.cables && Array.isArray(propertyData.cables) && propertyData.cables.length > 0) {
            console.log(`[OZmap] Link ${linkId}: ${propertyData.cables.length} cable(s) na propriedade:`, JSON.stringify(propertyData.cables).substring(0, 1000));
          } else {
            console.log(`[OZmap] Link ${linkId}: Nenhum cable encontrado na propriedade (ramal não documentado no OZmap)`);
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
        ozmapTag: resolvedTag,
        tagFoundViaFallback,
        potencyData: data,
        routeData: routeData,
        propertyData: propertyData,
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

  // Backup semanal automático de CPEs Mikrotik
  startCpeBackupScheduler();

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
          snmpInterfaceIndex: link.snmpInterfaceIndex,
          snmpInterfaceDescr: link.snmpInterfaceDescr,
          snmpInterfaceAlias: link.snmpInterfaceAlias,
          originalIfName: link.originalIfName,
          snmpProfileId: link.snmpProfileId,
          concentratorId: link.concentratorId,
          trafficSourceType: link.trafficSourceType,
          pppoeUser: link.pppoeUser,
          authType: link.authType,
          ifIndexMismatchCount: link.ifIndexMismatchCount,
          lastIfIndexValidation: link.lastIfIndexValidation,
          latencyThreshold: link.latencyThreshold,
          packetLossThreshold: link.packetLossThreshold,
          failureReason: link.failureReason,
          failureSource: link.failureSource,
          lastFailureAt: link.lastFailureAt,
          monitoringEnabled: link.monitoringEnabled,
          linkType: link.linkType,
          switchId: link.switchId,
          switchPort: link.switchPort,
          switchPortNumber: link.switchPortNumber,
          opticalMonitoringEnabled: link.opticalMonitoringEnabled,
          opticalRxBaseline: link.opticalRxBaseline,
          opticalDeltaThreshold: link.opticalDeltaThreshold,
          sfpType: link.sfpType,
          equipmentSerialNumber: link.equipmentSerialNumber,
          oltId: link.oltId,
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

  app.get("/api/admin/diagnostics/link/:linkId/optical-test", requireDiagnosticsAccess, async (req, res) => {
    try {
      const linkId = parseInt(req.params.linkId, 10);
      if (isNaN(linkId)) {
        return res.status(400).json({ error: "ID de link inválido" });
      }

      const link = await storage.getLink(linkId);
      if (!link) {
        return res.status(404).json({ error: "Link não encontrado" });
      }

      const results: any = {
        timestamp: new Date().toISOString(),
        linkId: link.id,
        linkName: link.name,
        linkType: link.linkType,
        switchId: link.switchId,
        switchPort: link.switchPort,
        switchPortNumber: link.switchPortNumber,
        opticalMonitoringEnabled: link.opticalMonitoringEnabled,
        tests: [],
      };

      // ── GPON path ──────────────────────────────────────────────────────────
      const isGpon = link.linkType === "gpon" || (!link.switchId && link.oltId);
      if (isGpon || link.oltId) {
        results.mode = "gpon";
        results.oltId = link.oltId;
        results.slotOlt = link.slotOlt;
        results.portOlt = link.portOlt;
        results.onuId = link.onuId;
        results.ozmap = {
          oltName: link.ozmapOltName,
          slot: link.ozmapSlot,
          port: link.ozmapPort,
          splitter: link.ozmapSplitterName,
          splitterPort: link.ozmapSplitterPort,
        };

        // Verificar pré-condições
        if (!link.oltId) {
          results.error = "olt_id não configurado no link";
          results.fix = "Vá em Editar Link → OLT e selecione a OLT correta";
          return res.json(results);
        }
        if (!link.opticalMonitoringEnabled) {
          results.warning = "optical_monitoring_enabled está desativado";
          results.fix = "Ative 'Monitoramento Óptico' nas configurações do link";
        }

        const hasSlotPort = link.slotOlt !== null && link.slotOlt !== undefined &&
                            link.portOlt !== null && link.portOlt !== undefined;
        const hasOnuId = link.onuId !== null && link.onuId !== undefined && link.onuId !== '';

        let parsedOnuId = NaN;
        if (hasOnuId) {
          const onuIdStr = link.onuId!.trim();
          if (onuIdStr.includes('/')) {
            const parts = onuIdStr.split('/').filter((p: string) => p.trim() !== '');
            parsedOnuId = parseInt(parts[parts.length - 1], 10);
          } else {
            parsedOnuId = parseInt(onuIdStr, 10);
          }
        }

        results.parsedOnuId = parsedOnuId;
        results.hasSlotPort = hasSlotPort;
        results.hasOnuId = hasOnuId;

        if (!hasSlotPort) {
          results.error = `slot_olt ou port_olt não configurado (slot=${link.slotOlt}, port=${link.portOlt})`;
          results.fix = "Preencha Slot e Porta PON nas configurações do link (ou sincronize via OZmap)";
          return res.json(results);
        }
        if (!hasOnuId || isNaN(parsedOnuId) || parsedOnuId < 0) {
          results.error = `onu_id inválido (valor: "${link.onuId}", parsed: ${parsedOnuId})`;
          results.fix = "Preencha o campo ONU ID corretamente (ex: '14' ou '0/1/8/14')";
          return res.json(results);
        }

        // Buscar OLT
        const olt = await db.select().from(olts).where(eq(olts.id, link.oltId)).limit(1);
        if (olt.length === 0) {
          results.error = `OLT id=${link.oltId} não encontrada no banco`;
          return res.json(results);
        }
        const oltData = olt[0];
        results.olt = { id: oltData.id, name: oltData.name, ip: oltData.ipAddress, vendor: oltData.vendor, snmpProfileId: oltData.snmpProfileId };

        if (!oltData.snmpProfileId) {
          results.error = "OLT não tem perfil SNMP configurado";
          results.fix = `Configure o perfil SNMP na OLT '${oltData.name}'`;
          return res.json(results);
        }
        if (!oltData.vendor) {
          results.error = "OLT não tem fabricante configurado";
          results.fix = `Configure o fabricante (vendor) na OLT '${oltData.name}'`;
          return res.json(results);
        }

        // Buscar OIDs do fabricante
        const vendorBySlug = await db.select().from(equipmentVendors)
          .where(eq(equipmentVendors.slug, oltData.vendor))
          .limit(1);

        let rxOid: string | null = null;
        let txOid: string | null = null;
        let oltRxOid: string | null = null;
        let distanceOid: string | null = null;
        let oidSource = "none";

        if (vendorBySlug.length > 0) {
          const vend = vendorBySlug[0];
          rxOid = vend.opticalRxOid || null;
          txOid = vend.opticalTxOid || null;
          oltRxOid = vend.opticalOltRxOid || null;
          results.vendorConfig = { name: vend.name, slug: vend.slug, rxOid, txOid, oltRxOid };
          if (rxOid || txOid || oltRxOid) oidSource = "vendor-db";
        }

        // Fallback parcial: preencher OIDs faltantes com hardcoded mesmo quando vendor tem algum OID
        {
          const { OPTICAL_OIDS } = await import("./snmp");
          const normalizedSlug = oltData.vendor.toLowerCase().trim();
          const fallbackOids = (OPTICAL_OIDS as any)[normalizedSlug];
          if (fallbackOids) {
            if (!rxOid && fallbackOids.onuRxPower) { rxOid = fallbackOids.onuRxPower; oidSource = oidSource === "none" ? "hardcoded-fallback" : oidSource + "+hardcoded-rx"; }
            if (!txOid && fallbackOids.onuTxPower) { txOid = fallbackOids.onuTxPower; oidSource = oidSource === "none" ? "hardcoded-fallback" : oidSource + "+hardcoded-tx"; }
            if (!oltRxOid && fallbackOids.oltRxPower) { oltRxOid = fallbackOids.oltRxPower; oidSource += "+hardcoded-oltrx"; }
            if (fallbackOids.onuDistance) distanceOid = fallbackOids.onuDistance;
          }
        }

        results.resolvedOids = { rxOid, txOid, oltRxOid, distanceOid, source: oidSource };

        if (!rxOid && !txOid && !oltRxOid) {
          results.error = `Nenhum OID óptico disponível para fabricante '${oltData.vendor}'`;
          results.fix = "Configure os OIDs ópticos em Admin → Fabricantes de Equipamentos";
          return res.json(results);
        }

        // Buscar perfil SNMP
        const { getOpticalSignal: getGponOpticalSignal } = await import("./snmp");
        const profileRows = await db.select().from(snmpProfiles).where(eq(snmpProfiles.id, oltData.snmpProfileId)).limit(1);
        if (profileRows.length === 0) {
          results.error = `Perfil SNMP id=${oltData.snmpProfileId} não encontrado`;
          return res.json(results);
        }
        const prof = profileRows[0];
        const oltProfile = {
          id: prof.id, version: prof.version, port: prof.port || 161,
          community: prof.community, securityLevel: prof.securityLevel,
          authProtocol: prof.authProtocol, authPassword: prof.authPassword,
          privProtocol: prof.privProtocol, privPassword: prof.privPassword,
          username: prof.username, timeout: prof.timeout || 5000, retries: prof.retries || 1,
        };
        results.snmpProfile = { id: prof.id, name: prof.name, version: prof.version, community: prof.community ? "***" : null };

        const onuParams = { slot: link.slotOlt!, port: link.portOlt!, onuId: parsedOnuId };
        results.onuParams = onuParams;

        // Calcular índice SNMP
        const { calculateOnuSnmpIndex } = await import("./snmp");
        const onuIndex = calculateOnuSnmpIndex(oltData.vendor, onuParams);
        results.calculatedOnuIndex = onuIndex;

        if (!onuIndex) {
          results.error = `Não foi possível calcular índice SNMP para fabricante '${oltData.vendor}' com slot=${link.slotOlt} port=${link.portOlt} onuId=${parsedOnuId}`;
          return res.json(results);
        }

        // Executar coleta
        try {
          const opticalResult = await getGponOpticalSignal(
            oltData.ipAddress, oltProfile, oltData.vendor, onuParams, rxOid, txOid, oltRxOid, distanceOid
          );
          results.opticalTest = {
            success: opticalResult !== null && (opticalResult.rxPower !== null || opticalResult.txPower !== null || opticalResult.oltRxPower !== null),
            rxPower: opticalResult?.rxPower ?? null,
            txPower: opticalResult?.txPower ?? null,
            oltRxPower: opticalResult?.oltRxPower ?? null,
            onuDistance: opticalResult?.onuDistance ?? null,
            method: `gpon-snmp-${oltData.vendor}`,
            rawResult: opticalResult,
          };
          if (!results.opticalTest.success) {
            results.opticalTest.diagnosis = "SNMP retornou resultado mas sem valores — verifique o índice calculado e se a ONU está online";
          }
        } catch (e: any) {
          results.opticalTest = { success: false, error: e.message, method: `gpon-snmp-${oltData.vendor}` };
        }

        // ?walk=true → walk no OID base para mostrar índices reais presentes na OLT
        if (req.query.walk === "true" && rxOid) {
          try {
            const snmpLib = await import("net-snmp");
            const snmpVer = (oltProfile.version || "2c").replace("v", "").toLowerCase();
            const snmpVersion = snmpVer === "1" ? 0 : 1;

            const doWalk = (startOid: string, maxEntries: number): Promise<any[]> => {
              const session = snmpLib.default.createSession(oltData.ipAddress, oltProfile.community || "public", {
                port: oltProfile.port || 161, timeout: 8000, retries: 1, version: snmpVersion,
              });
              const entries: any[] = [];
              return new Promise<any[]>((resolve) => {
                const timer = setTimeout(() => { try { session.close(); } catch {} resolve(entries); }, 15000);
                session.subtree(startOid, 20, (varbinds: any[]) => {
                  for (const vb of varbinds) {
                    if (entries.length >= maxEntries) break;
                    let rawVal: any = vb.value;
                    let numVal: number | null = null;
                    if (typeof rawVal === 'number') numVal = rawVal;
                    else if (Buffer.isBuffer(rawVal)) numVal = parseFloat(rawVal.toString().trim());
                    const dBm = numVal !== null && !isNaN(numVal) ? (Math.abs(numVal) > 100 ? numVal / 100 : numVal) : null;
                    entries.push({ oid: vb.oid, raw: numVal, dBm: dBm !== null ? Math.round(dBm * 10) / 10 : null });
                  }
                }, (err: any) => {
                  clearTimeout(timer);
                  try { session.close(); } catch {}
                  resolve(entries);
                });
              });
            };

            // Walk global (primeiras 100 entradas da tabela completa)
            const walkEntries = await doWalk(rxOid!, 100);

            results.walkResult = {
              baseOid: rxOid,
              entriesFound: walkEntries.length,
              entries: walkEntries,
              hint: walkEntries.length > 0
                ? `Índices encontrados: ${walkEntries.slice(0, 5).map(e => e.oid.split('.').slice(-2).join('.')).join(', ')}...`
                : "Nenhuma entrada encontrada — OID base inválido ou OLT sem ONUs nessa porta",
            };

            // Walk direcionado: filtra entradas do walk global pela faixa de índices do port esperado
            // (mais confiável que um subtree walk com OID folha, que retorna zero entradas)
            if (onuIndex) {
              const { calculateOnuSnmpIndex } = await import("./snmp");
              const basePortIndex = calculateOnuSnmpIndex(oltData.vendor, { ...onuParams, onuId: 0 });
              if (basePortIndex) {
                const baseNum = parseInt(basePortIndex);
                const expectedOid = `${rxOid}.${onuIndex}`;
                // Filtrar entradas do walk global que estão na faixa [basePortIndex, basePortIndex+255]
                const portEntries = walkEntries.filter(e => {
                  const entryIdx = parseInt(e.oid.split('.').pop() || '0');
                  return entryIdx >= baseNum && entryIdx <= baseNum + 255;
                });
                const found = portEntries.some(e => e.oid === expectedOid);
                const portCoveredByWalk = walkEntries.some(e => {
                  const entryIdx = parseInt(e.oid.split('.').pop() || '0');
                  return entryIdx >= baseNum - 256 && entryIdx <= baseNum + 511;
                });
                results.targetedWalk = {
                  basePortIndex,
                  expectedIndex: onuIndex,
                  expectedOid,
                  foundExpectedIndex: found,
                  portCoveredByGlobalWalk: portCoveredByWalk,
                  entriesOnPort: portEntries.length,
                  entries: portEntries,
                  diagnosis: found
                    ? `ONU encontrada no índice ${onuIndex} — índice correto, verificar valor retornado`
                    : !portCoveredByWalk
                      ? `Port ${onuParams.port} fora do alcance do walk global (100 entradas) — OLT tem muitas ONUs. Índice esperado: ${onuIndex}`
                      : portEntries.length === 0
                        ? `Nenhuma ONU encontrada no port ${onuParams.port} — verifique se portOlt=${onuParams.port} está correto`
                        : `ONUs presentes no port ${onuParams.port} mas não onuId=${onuParams.onuId}. Índices encontrados: ${portEntries.map(e => ({ idx: e.oid.split('.').pop(), dBm: e.dBm }))}`,
                };
              }
            }
          } catch (walkErr: any) {
            results.walkResult = { error: walkErr.message };
          }
        }

        return res.json(results);
      }
      // ── FIM GPON path ───────────────────────────────────────────────────────

      if (!link.switchId) {
        results.error = "Link não é PTP/GPON ou não tem switch/OLT configurado";
        return res.json(results);
      }

      const switchData = await db.select().from(switches).where(eq(switches.id, link.switchId)).limit(1);
      if (switchData.length === 0) {
        results.error = "Switch não encontrado no banco";
        return res.json(results);
      }

      const sw = switchData[0];
      results.switchName = sw.name;
      results.switchIp = sw.ipAddress;
      results.switchVendor = sw.vendor;
      results.switchVendorId = sw.vendorId;

      let opticalRxOid = sw.opticalRxOidTemplate;
      let opticalTxOid = sw.opticalTxOidTemplate;
      let opticalDivisor = 1000;
      let vendorName = sw.vendor || "";
      let vendorSlug = sw.vendor?.toLowerCase() || "";

      if (sw.vendorId) {
        const vendorData = await db.select().from(equipmentVendors).where(eq(equipmentVendors.id, sw.vendorId)).limit(1);
        if (vendorData.length > 0) {
          const vendor = vendorData[0];
          vendorName = vendor.name;
          vendorSlug = vendor.slug?.toLowerCase() || "";
          // OIDs do fabricante só se o switch não tiver OID próprio configurado (switch tem prioridade)
          if (vendor.switchOpticalRxOid && !opticalRxOid) opticalRxOid = vendor.switchOpticalRxOid;
          if (vendor.switchOpticalTxOid && !opticalTxOid) opticalTxOid = vendor.switchOpticalTxOid;
          if (vendor.switchOpticalDivisor) opticalDivisor = vendor.switchOpticalDivisor;
          // Divisor do switch sobrepõe o do fabricante
          if (sw.opticalDivisor) opticalDivisor = sw.opticalDivisor;
          results.vendorConfig = {
            name: vendor.name,
            slug: vendor.slug,
            switchOpticalRxOid: vendor.switchOpticalRxOid,
            switchOpticalTxOid: vendor.switchOpticalTxOid,
            switchOpticalDivisor: vendor.switchOpticalDivisor,
            snmpProfileId: vendor.snmpProfileId,
          };
        }
      }

      const isMikrotik = vendorSlug.includes("mikrotik") || vendorSlug.includes("routeros");
      results.detectedVendor = isMikrotik ? "MikroTik" : vendorSlug;

      if (isMikrotik && !opticalRxOid && !opticalTxOid) {
        opticalRxOid = "1.3.6.1.4.1.14988.1.1.19.1.1.10.{ifIndex}";
        opticalTxOid = "1.3.6.1.4.1.14988.1.1.19.1.1.9.{ifIndex}";
        opticalDivisor = 1000;
        results.usingDefaultMikrotikOids = true;
      }

      results.resolvedOids = { opticalRxOid, opticalTxOid, opticalDivisor };

      const effectiveSnmpProfileId = sw.snmpProfileId || (results.vendorConfig?.snmpProfileId || null);
      results.effectiveSnmpProfileId = effectiveSnmpProfileId;

      if (!effectiveSnmpProfileId) {
        results.error = "Sem perfil SNMP configurado (nem no switch nem no fabricante)";
        return res.json(results);
      }

      const { getOpticalSignalFromSwitch, getInterfaceOperStatus } = await import("./snmp");

      const profileData = await db.select().from(snmpProfiles).where(eq(snmpProfiles.id, effectiveSnmpProfileId)).limit(1);
      if (profileData.length === 0) {
        results.error = `Perfil SNMP ID ${effectiveSnmpProfileId} não encontrado`;
        return res.json(results);
      }
      const p = profileData[0];
      const swProfile = {
        id: p.id,
        version: p.version,
        port: p.port || 161,
        community: p.community,
        securityLevel: p.securityLevel,
        authProtocol: p.authProtocol,
        authPassword: p.authPassword,
        privProtocol: p.privProtocol,
        privPassword: p.privPassword,
        username: p.username,
        timeout: p.timeout || 5000,
        retries: p.retries || 1,
      };
      results.snmpProfile = { id: p.id, name: p.name, version: p.version, community: p.community ? "***" : null };

      const switchPortNum = link.switchPortNumber ? parseInt(link.switchPortNumber.toString(), 10) : null;
      const linkIfIndex = switchPortNum;
      results.resolvedIfIndex = linkIfIndex;
      results.switchPortNumber = switchPortNum;
      results.snmpInterfaceIndex = link.snmpInterfaceIndex;
      if (!switchPortNum && link.snmpInterfaceIndex) {
        results.warning = `switchPortNumber não configurado. snmpInterfaceIndex=${link.snmpInterfaceIndex} NÃO será usado pois pertence ao concentrador, não ao switch.`;
      }

      if (opticalRxOid) {
        const resolvedRxOid = opticalRxOid.replace(/\{ifIndex\}/gi, (linkIfIndex || 0).toString());
        results.tests.push({ name: "OID RX Resolvido", oid: resolvedRxOid });
      }
      if (opticalTxOid) {
        const resolvedTxOid = opticalTxOid.replace(/\{ifIndex\}/gi, (linkIfIndex || 0).toString());
        results.tests.push({ name: "OID TX Resolvido", oid: resolvedTxOid });
      }

      try {
        const portStatus = await getInterfaceOperStatus(sw.ipAddress, swProfile, linkIfIndex || 0);
        results.portStatusTest = {
          success: true,
          operStatus: portStatus.operStatus,
          adminStatus: portStatus.adminStatus,
        };
      } catch (e: any) {
        results.portStatusTest = { success: false, error: e.message };
      }

      const isCisco = vendorSlug.includes("cisco");
      results.detectedVendorType = isCisco ? "cisco" : isMikrotik ? "mikrotik" : vendorSlug;

      if (isCisco) {
        const normalizedPort = (link.switchPort || "").replace(/^Eth(\d)/i, "Ethernet$1");
        results.ciscoNormalizedPort = normalizedPort;

        let sensorData = await db.select().from(switchSensorCache)
          .where(and(eq(switchSensorCache.switchId, sw.id), eq(switchSensorCache.portName, normalizedPort)))
          .limit(1);

        if (sensorData.length === 0) {
          const breakoutMatch = normalizedPort.match(/^(Ethernet\d+\/\d+)\/\d+$/);
          if (breakoutMatch) {
            sensorData = await db.select().from(switchSensorCache)
              .where(and(eq(switchSensorCache.switchId, sw.id), eq(switchSensorCache.portName, breakoutMatch[1])))
              .limit(1);
          }
        }

        if (sensorData.length > 0) {
          const sensor = sensorData[0];
          results.ciscoSensorCache = {
            portName: sensor.portName,
            rxSensorIndex: sensor.rxSensorIndex,
            txSensorIndex: sensor.txSensorIndex,
            tempSensorIndex: sensor.tempSensorIndex,
            updatedAt: sensor.updatedAt,
          };

          if (sensor.rxSensorIndex || sensor.txSensorIndex) {
            try {
              const { getCiscoOpticalSignal } = await import("./snmp");
              const ciscoDivisor = opticalDivisor || 1000;
              const opticalResult = await getCiscoOpticalSignal(sw.ipAddress, swProfile, sensor.rxSensorIndex, sensor.txSensorIndex, ciscoDivisor);
              results.opticalTest = {
                success: opticalResult !== null && (opticalResult?.rxPower !== null || opticalResult?.txPower !== null),
                rxPower: opticalResult?.rxPower ?? null,
                txPower: opticalResult?.txPower ?? null,
                method: "cisco-entity-mib",
                divisor: ciscoDivisor,
              };
            } catch (e: any) {
              results.opticalTest = { success: false, error: e.message, method: "cisco-entity-mib" };
            }
          }
        } else {
          results.ciscoSensorCache = null;
          results.ciscoSensorCacheMessage = `Nenhum sensor no cache para porta ${normalizedPort}. Execute discovery ou aguarde auto-discovery na próxima coleta.`;
        }

        const allSensorsForSwitch = await db.select().from(switchSensorCache)
          .where(eq(switchSensorCache.switchId, sw.id));
        results.ciscoCachedSensorsCount = allSensorsForSwitch.length;
        if (allSensorsForSwitch.length > 0) {
          results.ciscoCachedPorts = allSensorsForSwitch.map(s => ({
            portName: s.portName,
            rxSensorIndex: s.rxSensorIndex,
            txSensorIndex: s.txSensorIndex,
          }));
        }

        if (req.query.runDiscovery === "true") {
          try {
            const { discoverCiscoSensors } = await import("./snmp");
            const sensors = await discoverCiscoSensors(sw.ipAddress, swProfile);
            results.ciscoDiscoveryResult = {
              success: true,
              sensorsFound: sensors.length,
              sensors: sensors.map(s => ({ portName: s.portName, rx: s.rxSensorIndex, tx: s.txSensorIndex })),
            };
            for (const s of sensors) {
              try {
                const existing = await db.select().from(switchSensorCache)
                  .where(and(eq(switchSensorCache.switchId, sw.id), eq(switchSensorCache.portName, s.portName)))
                  .limit(1);
                if (existing.length > 0) {
                  await db.update(switchSensorCache)
                    .set({ rxSensorIndex: s.rxSensorIndex, txSensorIndex: s.txSensorIndex, tempSensorIndex: s.tempSensorIndex, updatedAt: new Date() })
                    .where(eq(switchSensorCache.id, existing[0].id));
                } else {
                  await db.insert(switchSensorCache).values({
                    switchId: sw.id,
                    portName: s.portName,
                    rxSensorIndex: s.rxSensorIndex,
                    txSensorIndex: s.txSensorIndex,
                    tempSensorIndex: s.tempSensorIndex,
                  });
                }
              } catch {}
            }
          } catch (e: any) {
            results.ciscoDiscoveryResult = { success: false, error: e.message };
          }
        }
      } else {
        try {
          const opticalResult = await getOpticalSignalFromSwitch(
            sw.ipAddress,
            swProfile,
            link.switchPort || "",
            opticalRxOid,
            opticalTxOid,
            sw.portIndexTemplate,
            opticalDivisor,
            linkIfIndex
          );
          results.opticalTest = {
            success: opticalResult !== null,
            rxPower: opticalResult?.rxPower ?? null,
            txPower: opticalResult?.txPower ?? null,
            oltRxPower: opticalResult?.oltRxPower ?? null,
            rawResult: opticalResult,
            method: isMikrotik ? "mikrotik-mtxr" : "generic-oid",
          };
        } catch (e: any) {
          results.opticalTest = { success: false, error: e.message };
        }

        const snmpLib = await import("net-snmp");
        const testIfIndices = linkIfIndex ? [linkIfIndex] : [1, 2, 3, 4, 5, 6, 7, 8];
        const walkResults: any[] = [];

        for (const idx of testIfIndices.slice(0, 16)) {
          const rxOid = `1.3.6.1.4.1.14988.1.1.19.1.1.10.${idx}`;
          const txOid = `1.3.6.1.4.1.14988.1.1.19.1.1.9.${idx}`;
          try {
            const rawResult = await new Promise<any>((resolve) => {
              const timeout = setTimeout(() => resolve({ timeout: true }), 6000);
              const version = swProfile.version.replace("v", "").toLowerCase();
              const snmpVersion = version === "1" ? 0 : 1;
              const session = snmpLib.default.createSession(sw.ipAddress, swProfile.community || "public", {
                port: swProfile.port,
                timeout: 4000,
                retries: 0,
                version: snmpVersion,
              });
              session.get([rxOid, txOid], (error: any, varbinds: any[]) => {
                clearTimeout(timeout);
                try { session.close(); } catch {}
                if (error) {
                  resolve({ error: error.message || String(error) });
                  return;
                }
                const result: any = {};
                for (const vb of (varbinds || [])) {
                  const oid = vb.oid;
                  const typeCode = vb.type;
                  const typeNames: Record<number, string> = {
                    2: "Integer", 4: "OctetString", 5: "Null", 6: "OID",
                    64: "IpAddress", 65: "Counter", 66: "Gauge32", 67: "TimeTicks",
                    68: "Opaque", 70: "Counter64", 128: "NoSuchObject", 129: "NoSuchInstance", 130: "EndOfMibView"
                  };
                  result[oid] = {
                    type: typeNames[typeCode] || `Unknown(${typeCode})`,
                    typeCode,
                    value: typeCode === 128 ? "noSuchObject" : typeCode === 129 ? "noSuchInstance" : typeCode === 130 ? "endOfMibView" : vb.value?.toString(),
                    rawValue: typeCode === 2 ? Number(vb.value) : undefined,
                    dBm: typeCode === 2 ? (Number(vb.value) / opticalDivisor).toFixed(3) : undefined,
                  };
                }
                resolve(result);
              });
            });
            walkResults.push({ ifIndex: idx, rxOid, txOid, result: rawResult });
          } catch (e: any) {
            walkResults.push({ ifIndex: idx, error: e.message });
          }
        }
        results.mtxrOpticalWalk = walkResults;
      }

      const ifNameOid = `1.3.6.1.2.1.2.2.1.2.${linkIfIndex || 5}`;
      try {
        const ifNameResult = await new Promise<string>((resolve) => {
          const timeout = setTimeout(() => resolve("timeout"), 5000);
          const version = swProfile.version.replace("v", "").toLowerCase();
          const snmpVersion = version === "1" ? 0 : 1;
          const session = snmpLib.default.createSession(sw.ipAddress, swProfile.community || "public", {
            port: swProfile.port, timeout: 4000, retries: 0, version: snmpVersion,
          });
          session.get([ifNameOid], (error: any, varbinds: any[]) => {
            clearTimeout(timeout);
            try { session.close(); } catch {}
            if (error) { resolve(`error: ${error.message}`); return; }
            if (varbinds && varbinds.length > 0 && varbinds[0].type !== 128 && varbinds[0].type !== 129) {
              resolve(varbinds[0].value?.toString() || "empty");
            } else {
              resolve("noSuchInstance");
            }
          });
        });
        results.ifDescrForIndex = { ifIndex: linkIfIndex || 5, ifDescr: ifNameResult };
      } catch {}

      return res.json(results);
    } catch (error) {
      console.error("[Diagnostics] Optical test error:", error);
      res.status(500).json({
        error: "Erro no teste óptico",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // ── SNMP Full Walk — walk completo de qualquer OID em uma OLT/switch ──────
  app.get("/api/admin/olt/:oltId/snmp-walk", requireDiagnosticsAccess, async (req, res) => {
    try {
      const oltId = parseInt(req.params.oltId, 10);
      if (isNaN(oltId)) return res.status(400).json({ error: "OLT ID inválido" });

      const olt = await db.select().from(olts).where(eq(olts.id, oltId)).limit(1);
      if (olt.length === 0) return res.status(404).json({ error: "OLT não encontrada" });
      const oltData = olt[0];

      if (!oltData.snmpProfileId) return res.status(400).json({ error: "OLT sem perfil SNMP" });
      const profiles = await db.select().from(snmpProfiles).where(eq(snmpProfiles.id, oltData.snmpProfileId)).limit(1);
      if (profiles.length === 0) return res.status(400).json({ error: "Perfil SNMP não encontrado" });
      const profile = profiles[0];

      const baseOid = (req.query.oid as string) || "1.3.6.1.4.1.3709.3.6.2.1.1.22";
      const maxEntries = Math.min(parseInt((req.query.limit as string) || "500", 10), 2000);
      const decodeIndex = req.query.decode !== "false"; // decodifica slot/port/onu por padrão

      const snmpLib = await import("net-snmp");
      const snmpVer = (profile.version || "2c").replace("v", "").toLowerCase();
      const snmpVersion = snmpVer === "1" ? 0 : 1;
      const session = snmpLib.default.createSession(oltData.ipAddress, profile.community || "public", {
        port: profile.port || 161, timeout: 10000, retries: 1, version: snmpVersion,
      });

      const entries: any[] = [];
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => { try { session.close(); } catch {} resolve(); }, 30000);
        session.subtree(baseOid, 20, (varbinds: any[]) => {
          for (const vb of varbinds) {
            if (entries.length >= maxEntries) break;
            const oidStr: string = vb.oid;
            let rawVal: any = vb.value;
            let numVal: number | null = null;
            let strVal: string | null = null;
            if (typeof rawVal === 'number') {
              numVal = rawVal;
            } else if (Buffer.isBuffer(rawVal)) {
              // Datacom retorna STRING ("-20.61") — usar parseFloat para preservar decimal
              const asFloat = parseFloat(rawVal.toString().trim());
              if (!isNaN(asFloat)) numVal = asFloat;
              else strVal = rawVal.toString('hex');
            } else if (typeof rawVal === 'string') {
              strVal = rawVal;
            }

            const entry: any = { oid: oidStr };
            if (numVal !== null) entry.raw = numVal;
            if (strVal !== null) entry.str = strVal;

            // Decodificar índice final como slot/port/onu (Datacom)
            if (decodeIndex && oltData.vendor?.toLowerCase().includes('datacom')) {
              const lastPart = oidStr.split('.').pop();
              if (lastPart) {
                const idx = parseInt(lastPart);
                if (!isNaN(idx) && idx > 16000000) {
                  const slot = Math.floor(idx / 16777216);
                  const rem = idx % 16777216;
                  const portSNMP = Math.floor(rem / 256);   // 0-indexed
                  const onuSNMP = rem % 256;
                  entry.decoded = { idx, slot, portSNMP, portCLI: portSNMP + 1, onuSNMP };
                  if (numVal !== null) {
                    const dBm = Math.abs(numVal) > 100 ? numVal / 100 : numVal;
                    if (!isNaN(dBm) && dBm !== 0 && dBm >= -50 && dBm <= 10) {
                      entry.dBm = Math.round(dBm * 10) / 10;
                    }
                  }
                }
              }
            }
            entries.push(entry);
          }
        }, (_err: any) => {
          clearTimeout(timer);
          try { session.close(); } catch {}
          resolve();
        });
      });

      // Agrupar por port (se Datacom)
      let portSummary: Record<string, any[]> | null = null;
      if (decodeIndex && oltData.vendor?.toLowerCase().includes('datacom')) {
        portSummary = {};
        for (const e of entries) {
          if (e.decoded) {
            const key = `port_${e.decoded.portCLI}`;
            if (!portSummary[key]) portSummary[key] = [];
            portSummary[key].push({ onuSNMP: e.decoded.onuSNMP, idx: e.decoded.idx, dBm: e.dBm ?? null });
          }
        }
      }

      return res.json({
        oltName: oltData.name,
        oltIp: oltData.ipAddress,
        vendor: oltData.vendor,
        baseOid,
        maxEntries,
        entriesFound: entries.length,
        portSummary,
        entries,
      });
    } catch (err: any) {
      console.error("[SNMP Walk]", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/admin/diagnostics/link/:linkId/traffic-test", requireDiagnosticsAccess, async (req, res) => {
    try {
      const linkId = parseInt(req.params.linkId, 10);
      if (isNaN(linkId)) return res.status(400).json({ error: "ID inválido" });

      const link = await storage.getLink(linkId);
      if (!link) return res.status(404).json({ error: "Link não encontrado" });

      const r: any = {
        linkId: link.id,
        linkName: link.name,
        linkType: link.linkType,
        trafficSourceType: link.trafficSourceType,
        concentratorId: link.concentratorId,
        switchId: link.switchId,
        switchPortNumber: link.switchPortNumber,
        linkFields: {
          snmpRouterIp: link.snmpRouterIp,
          snmpInterfaceIndex: link.snmpInterfaceIndex,
          snmpProfileId: link.snmpProfileId,
          snmpInterfaceName: link.snmpInterfaceName,
        },
        resolution: {},
        snmpTest: null,
      };

      let trafficSourceIp = link.snmpRouterIp;
      let trafficSourceIfIndex = link.snmpInterfaceIndex;
      let trafficSourceProfileId = link.snmpProfileId;
      r.resolution.step1_initial = { ip: trafficSourceIp, ifIndex: trafficSourceIfIndex, profileId: trafficSourceProfileId };

      if (link.trafficSourceType === "accessPoint" && (link as any).accessPointId) {
        const apRows = await db.select().from(switches).where(eq(switches.id, (link as any).accessPointId)).limit(1);
        if (apRows.length > 0) {
          trafficSourceIp = apRows[0].ipAddress;
          trafficSourceProfileId = apRows[0].snmpProfileId;
          trafficSourceIfIndex = (link as any).accessPointInterfaceIndex || null;
          r.resolution.step2_accessPoint = { switchName: apRows[0].name, ip: trafficSourceIp, profileId: trafficSourceProfileId, ifIndex: trafficSourceIfIndex };
        }
      } else if (link.concentratorId) {
        const concRows = await db.select().from(snmpConcentrators).where(eq(snmpConcentrators.id, link.concentratorId)).limit(1);
        if (concRows.length > 0) {
          const conc = concRows[0];
          const isCiscoVi = /^Vi\d+\.\d+$/i.test(link.snmpInterfaceName || "");
          if (isCiscoVi || link.trafficSourceType === "concentrator") {
            trafficSourceIp = conc.ipAddress;
            if (conc.snmpProfileId) trafficSourceProfileId = conc.snmpProfileId;
            r.resolution.step2_concentrator = { name: conc.name, ip: trafficSourceIp, profileId: trafficSourceProfileId, isCiscoVi };
          }
        }
      }

      if (!trafficSourceProfileId && link.concentratorId) {
        const concRows = await db.select().from(snmpConcentrators).where(eq(snmpConcentrators.id, link.concentratorId)).limit(1);
        if (concRows.length > 0 && concRows[0].snmpProfileId) {
          trafficSourceProfileId = concRows[0].snmpProfileId;
          if (!trafficSourceIp) trafficSourceIp = concRows[0].ipAddress;
          r.resolution.step3_concentratorProfileFallback = { profileId: trafficSourceProfileId, ip: trafficSourceIp };
        }
      }

      if ((!trafficSourceProfileId || !trafficSourceIp || !trafficSourceIfIndex) && link.linkType === "ptp" && link.switchId) {
        const swRows = await db.select().from(switches).where(eq(switches.id, link.switchId)).limit(1);
        if (swRows.length > 0) {
          const sw = swRows[0];
          const switchIfIndex = link.switchPortNumber ? parseInt(link.switchPortNumber.toString(), 10) : null;
          let effectiveProfileId = sw.snmpProfileId;
          if (!effectiveProfileId && sw.vendorId) {
            const vendorRows = await db.select().from(equipmentVendors).where(eq(equipmentVendors.id, sw.vendorId)).limit(1);
            if (vendorRows.length > 0) effectiveProfileId = vendorRows[0].snmpProfileId;
          }
          r.resolution.step4_ptpFallback = {
            switchName: sw.name, switchIp: sw.ipAddress, switchSnmpProfileId: sw.snmpProfileId,
            vendorId: sw.vendorId, effectiveProfileId, switchIfIndex,
            wouldApply: !!(sw.ipAddress && effectiveProfileId && switchIfIndex),
          };
          if (sw.ipAddress && effectiveProfileId && switchIfIndex) {
            if (!trafficSourceIp) trafficSourceIp = sw.ipAddress;
            if (!trafficSourceProfileId) trafficSourceProfileId = effectiveProfileId;
            if (!trafficSourceIfIndex) trafficSourceIfIndex = switchIfIndex;
          }
        }
      }

      r.resolution.final = { ip: trafficSourceIp, ifIndex: trafficSourceIfIndex, profileId: trafficSourceProfileId };
      r.resolution.canCollect = !!(trafficSourceIp && trafficSourceProfileId && trafficSourceIfIndex);

      if (r.resolution.canCollect) {
        const profileRows = await db.select().from(snmpProfiles).where(eq(snmpProfiles.id, trafficSourceProfileId!)).limit(1);
        if (profileRows.length === 0) {
          r.snmpTest = { error: `Perfil SNMP ID ${trafficSourceProfileId} não encontrado no banco` };
        } else {
          const p = profileRows[0];
          r.snmpProfile = { id: p.id, name: p.name, version: p.version };
          const snmpLib = await import("net-snmp");
          const version = p.version.replace("v", "").toLowerCase();
          const snmpVersion = version === "1" ? 0 : 1;
          const rxOid = `1.3.6.1.2.1.31.1.1.1.6.${trafficSourceIfIndex}`;
          const txOid = `1.3.6.1.2.1.31.1.1.1.10.${trafficSourceIfIndex}`;

          const snmpResult = await new Promise<any>((resolve) => {
            const to = setTimeout(() => resolve({ error: "Timeout 8s" }), 8000);
            const sess = snmpLib.default.createSession(trafficSourceIp!, p.community || "public", {
              port: p.port || 161, timeout: 6000, retries: 1, version: snmpVersion,
            });
            sess.get([rxOid, txOid], (err: any, vbs: any[]) => {
              clearTimeout(to);
              try { sess.close(); } catch {}
              if (err) return resolve({ error: err.message });
              const out: any = {};
              const bufToNum = (buf: Buffer): string => {
                let result = BigInt(0);
                for (let i = 0; i < buf.length; i++) result = result * BigInt(256) + BigInt(buf[i]);
                return result.toString();
              };
              for (const vb of vbs || []) {
                const typeNames: Record<number, string> = { 70: "Counter64", 65: "Counter32", 128: "NoSuchObject", 129: "NoSuchInstance" };
                const typeName = typeNames[vb.type] || `type${vb.type}`;
                let numericValue: string | null = null;
                if (Buffer.isBuffer(vb.value)) numericValue = bufToNum(vb.value);
                else if (typeof vb.value === 'bigint') numericValue = vb.value.toString();
                else if (typeof vb.value === 'number') numericValue = vb.value.toString();
                out[vb.oid] = { type: typeName, rawBytes: vb.value?.toString(), numericValue };
              }
              resolve(out);
            });
          });

          r.snmpTest = { oids: { rx: rxOid, tx: txOid }, result: snmpResult };
        }
      }

      return res.json(r);
    } catch (error) {
      res.status(500).json({ error: "Erro no diagnóstico de tráfego", details: error instanceof Error ? error.message : String(error) });
    }
  });

  // Verifica colunas faltando no schema do banco de dados (útil para diagnóstico de migração)
  app.get("/api/admin/diagnostics/schema-check", requireDiagnosticsAccess, async (_req, res) => {
    try {
      const expectedColumns: Record<string, string[]> = {
        links: [
          "last_failure_reason", "last_failure_source", "monitored_ip_locked",
          "original_if_name", "snmp_interface_alias", "snmp_interface_descr",
          "if_index_mismatch_count", "last_if_index_validation",
          "main_graph_mode", "main_graph_interface_ids",
          "auth_type", "vlan_interface", "onu_search_string", "onu_id", "slot_olt", "port_olt",
          "is_l2_link", "access_point_id", "access_point_interface_index",
          "traffic_source_type", "concentrator_id", "snmp_profile_id",
        ],
        events: ["resolved_at"],
        metrics: ["optical_rx_power", "optical_tx_power", "optical_olt_rx_power", "optical_status"],
        link_monitoring_state: ["link_id", "packet_loss_window", "packet_loss_avg", "consecutive_loss_breaches", "last_alert_at", "updated_at"],
      };

      const results: Record<string, { existing: string[]; missing: string[] }> = {};

      for (const [table, cols] of Object.entries(expectedColumns)) {
        const rows = await db.execute(sql`
          SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = ${table}
        `);
        const existing = ((rows as any).rows || []).map((r: any) => r.column_name as string);
        const missing = cols.filter(c => !existing.includes(c));
        results[table] = { existing: existing.filter(c => cols.includes(c)), missing };
      }

      const hasMissing = Object.values(results).some(r => r.missing.length > 0);
      res.json({ ok: !hasMissing, results });
    } catch (error) {
      res.status(500).json({ error: "Erro ao verificar schema", details: error instanceof Error ? error.message : String(error) });
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
      res.json(settings || { flashmanApiUrl: "", flashmanUsername: "", flashmanPassword: "", flashmanApiKey: "", flashmanEnabled: false });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/flashman/settings", requireSuperAdmin, async (req, res) => {
    try {
      const { flashmanApiUrl, flashmanUsername, flashmanPassword, flashmanApiKey, flashmanEnabled } = req.body;
      await storage.saveFlashmanGlobalSettings({
        flashmanApiUrl: flashmanApiUrl || "",
        flashmanUsername: flashmanUsername || "",
        flashmanPassword: flashmanPassword || "",
        flashmanApiKey: flashmanApiKey || "",
        flashmanEnabled: !!flashmanEnabled,
      });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/flashman/test-connection", requireSuperAdmin, async (req, res) => {
    try {
      const { apiUrl, username, password, apiKey } = req.body;
      if (!apiUrl) {
        return res.status(400).json({ error: "URL é obrigatória" });
      }
      if (!apiKey && (!username || !password)) {
        return res.status(400).json({ error: "API Key ou usuário/senha são obrigatórios" });
      }
      const result = await testFlashmanConnection({ apiUrl, username: username || "", password: password || "", apiKey: apiKey || undefined });
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
      console.log(`[Flashman/Info] Link ${link.name}: pppoe=${link.pppoeUser || 'N/A'}, serial=${ids.serial || 'N/A'}, mac=${ids.mac || 'N/A'}`);

      const identifier = ids.serial || link.pppoeUser || ids.mac;
      if (identifier) {
        const fullDevice = await getDeviceFull(config, identifier);
        if (fullDevice) {
          console.log(`[Flashman/Info] Link ${link.name}: full device data from /full/ endpoint - ${fullDevice._id || identifier}`);
          return res.json({ enabled: true, found: true, device: fullDevice, source: "full" });
        }
      }

      const device = await findDeviceDirect(config, link.pppoeUser, ids.serial, ids.mac);
      if (!device) {
        console.log(`[Flashman/Info] Link ${link.name}: dispositivo não encontrado`);
        return res.json({ enabled: true, found: false, message: "Dispositivo não encontrado no ACS" });
      }

      const formatted = formatFlashmanDeviceInfo(device);
      console.log(`[Flashman/Info] Link ${link.name}: dispositivo encontrado (legacy) - ${device._id || device.serial_tr069 || 'unknown'}`);
      res.json({ enabled: true, found: true, device: formatted, source: "legacy" });
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

  // ==========================================
  // Voalle Webhook - Connection Processing
  // ==========================================

  function mapVoalleStatus(voalleStatus: string | number | null | undefined): { contractStatus: string; reason: string } {
    if (voalleStatus === null || voalleStatus === undefined) return { contractStatus: "unknown", reason: "Status não informado" };
    const statusStr = String(voalleStatus).toLowerCase().trim();
    const activeStatuses = ["ativo", "active", "habilitado", "enabled", "normal", "1", "a"];
    const blockedStatuses = [
      "bloqueado", "blocked", "suspenso", "suspended", "desabilitado", "disabled",
      "bloqueio financeiro", "bloqueio administrativo",
      "2", "5", "6", "7", "b", "s",
    ];
    const cancelledStatuses = [
      "cancelado", "cancelled", "canceled", "desativado", "deactivated", "encerrado",
      "3", "4", "8", "c", "d",
    ];
    if (activeStatuses.includes(statusStr)) return { contractStatus: "active", reason: "" };
    if (blockedStatuses.includes(statusStr)) return { contractStatus: "blocked", reason: `Status Voalle: ${voalleStatus}` };
    if (cancelledStatuses.includes(statusStr)) return { contractStatus: "cancelled", reason: `Status Voalle: ${voalleStatus}` };
    return { contractStatus: "unknown", reason: `Status Voalle desconhecido: ${voalleStatus}` };
  }

  async function findLinkByVoalleData(rawAuth: any, includeDeleted = false): Promise<typeof links.$inferSelect | null> {
    const auth = normalizeAuthFields(rawAuth);
    const deletedFilter = includeDeleted ? undefined : isNull(links.deletedAt);
    const buildWhere = (condition: any) => deletedFilter ? and(condition, deletedFilter) : condition;

    if (auth.Login) {
      const byPppoe = await db.select().from(links)
        .where(buildWhere(eq(links.pppoeUser, String(auth.Login))))
        .limit(1);
      if (byPppoe.length > 0) {
        console.log(`[Webhook/Voalle] findLinkByVoalleData: matched by Login="${auth.Login}" → link id=${byPppoe[0].id}`);
        return byPppoe[0];
      }
    }

    if (auth.ContractServiceTag || auth.ServiceTag) {
      const tag = auth.ContractServiceTag || auth.ServiceTag;
      const byTag = await db.select().from(links)
        .where(buildWhere(eq(links.voalleContractTagServiceTag, String(tag))))
        .limit(1);
      if (byTag.length > 0) {
        console.log(`[Webhook/Voalle] findLinkByVoalleData: matched by ServiceTag="${tag}" → link id=${byTag[0].id}`);
        return byTag[0];
      }
    }

    if (auth.ContractID) {
      const byContract = await db.select().from(links)
        .where(buildWhere(eq(links.voalleContractNumber, String(auth.ContractID))));
      if (byContract.length === 1) {
        console.log(`[Webhook/Voalle] findLinkByVoalleData: matched by ContractID="${auth.ContractID}" (unique link) → link id=${byContract[0].id}`);
        return byContract[0];
      } else if (byContract.length > 1) {
        console.log(`[Webhook/Voalle] findLinkByVoalleData: ContractID="${auth.ContractID}" has ${byContract.length} links — skipping ambiguous match`);
      }
    }

    return null;
  }

  function normalizeAuthFields(auth: any): any {
    const normalized = { ...auth };
    if (normalized.ContractId !== undefined && normalized.ContractID === undefined) {
      normalized.ContractID = normalized.ContractId;
    }
    return normalized;
  }

  function parseBandwidthFromDescription(description: string): number | null {
    if (!description) return null;
    const upper = description.toUpperCase();
    const gbpsMatch = upper.match(/(\d+(?:[.,]\d+)?)\s*G(?:BPS|B)?/);
    if (gbpsMatch) return Math.round(parseFloat(gbpsMatch[1].replace(",", ".")) * 1000);
    const mbpsMatch = upper.match(/(\d+(?:[.,]\d+)?)\s*(?:MBPS|MB|MEGA)/);
    if (mbpsMatch) return Math.round(parseFloat(mbpsMatch[1].replace(",", ".")));
    const numMatch = upper.match(/(\d+)\s*M\b/);
    if (numMatch) return parseInt(numMatch[1]);
    return null;
  }

  async function processVoalleConnectionWebhook(actionType: number, rawAuth: any, req: Request): Promise<void> {
    const auth = normalizeAuthFields(rawAuth);
    const { contractStatus, reason } = mapVoalleStatus(auth.Status);

    if (!auth.Login) {
      const contractId = auth.ContractID ? String(auth.ContractID) : null;
      if (contractId) {
        const contractLinks = await db.select().from(links)
          .where(and(eq(links.voalleContractNumber, contractId), isNull(links.deletedAt)));

        if (contractLinks.length === 1) {
          console.log(`[Webhook/Voalle] Connection webhook without Login but contract #${contractId} has exactly 1 link (id=${contractLinks[0].id}) — processing with inferred match`);
          auth.Login = contractLinks[0].pppoeUser || null;
          auth._inferredFromContract = true;
          auth._inferredLinkId = contractLinks[0].id;
        } else if (contractLinks.length > 1) {
          console.log(`[Webhook/Voalle] Connection webhook without Login — contract #${contractId} has ${contractLinks.length} links, cannot identify which one — skipping`);
          await logAuditEvent({
            action: "update",
            entity: "link",
            entityId: null,
            entityName: "N/A",
            metadata: { source: "voalle_webhook", actionType, skippedReason: "missing_login_multiple_links", serviceId: auth.ServiceId, contractId, serviceDescription: auth.ServiceDescription, linkedLinksCount: contractLinks.length },
            status: "failure",
            errorMessage: `Webhook de conexão sem Login — contrato #${contractId} possui ${contractLinks.length} links, impossível identificar`,
            request: req,
          });
          return;
        } else {
          console.log(`[Webhook/Voalle] Connection webhook without Login — contract #${contractId} has no linked links — skipping`);
          await logAuditEvent({
            action: "update",
            entity: "link",
            entityId: null,
            entityName: "N/A",
            metadata: { source: "voalle_webhook", actionType, skippedReason: "missing_login_no_links", serviceId: auth.ServiceId, contractId, serviceDescription: auth.ServiceDescription },
            status: "failure",
            errorMessage: `Webhook de conexão sem Login — contrato #${contractId} sem links vinculados`,
            request: req,
          });
          return;
        }
      } else {
        console.log(`[Webhook/Voalle] Connection webhook without Login and without ContractID — skipping`);
        await logAuditEvent({
          action: "update",
          entity: "link",
          entityId: null,
          entityName: "N/A",
          metadata: { source: "voalle_webhook", actionType, skippedReason: "missing_login_and_contract", serviceId: auth.ServiceId, serviceDescription: auth.ServiceDescription },
          status: "failure",
          errorMessage: "Webhook de conexão sem Login e sem ContractID — ignorado",
          request: req,
        });
        return;
      }
    }

    if (actionType === 0) {
      let existingLink = await findLinkByVoalleData(auth);
      if (!existingLink) {
        existingLink = await findLinkByVoalleData(auth, true);
        if (existingLink && existingLink.deletedAt) {
          console.log(`[Webhook/Voalle] Found soft-deleted link id=${existingLink.id}, reactivating`);
          await db.update(links).set({
            deletedAt: null,
            deletedReason: null,
            contractStatus,
            contractStatusReason: reason || null,
            contractStatusUpdatedAt: new Date(),
            voalleStatusRaw: auth.Status != null ? String(auth.Status) : null,
          }).where(eq(links.id, existingLink.id));
          await logAuditEvent({
            action: "update",
            entity: "link",
            entityId: existingLink.id,
            entityName: existingLink.name,
            clientId: existingLink.clientId,
            previous: { deletedAt: existingLink.deletedAt, contractStatus: existingLink.contractStatus },
            current: { deletedAt: null, contractStatus, reactivated: true },
            metadata: { source: "voalle_webhook", actionType: 0, reactivation: true },
            request: req,
          });
          return;
        }
      }
      if (existingLink) {
        console.log(`[Webhook/Voalle] Link already exists (id=${existingLink.id}), enriching`);
        const updates: Record<string, any> = {};
        if (auth.ServiceId && !existingLink.voalleServiceId) updates.voalleServiceId = Number(auth.ServiceId);
        if (auth.ContractID && !existingLink.voalleContractNumber) updates.voalleContractNumber = String(auth.ContractID);
        if (auth.AccessPoint && !existingLink.voalleAccessPointId && !isNaN(Number(auth.AccessPoint))) updates.voalleAccessPointId = Number(auth.AccessPoint);
        if (auth.OltSlot !== undefined && auth.OltSlot !== null && !existingLink.slotOlt) updates.slotOlt = Number(auth.OltSlot);
        if (auth.OltPort !== undefined && auth.OltPort !== null && !existingLink.portOlt) updates.portOlt = Number(auth.OltPort);
        if (auth.ServiceDescription) {
          const newDesc = String(auth.ServiceDescription);
          if (newDesc !== existingLink.voalleServiceDescription) {
            updates.voalleServiceDescription = newDesc;
            const parsedBw = parseBandwidthFromDescription(newDesc);
            if (parsedBw && parsedBw !== existingLink.bandwidth) {
              updates.bandwidth = parsedBw;
              console.log(`[Webhook/Voalle] Bandwidth enrichment: ${existingLink.bandwidth}M → ${parsedBw}M (from "${newDesc}")`);
            }
          }
        }
        if (contractStatus !== existingLink.contractStatus) {
          updates.contractStatus = contractStatus;
          updates.contractStatusReason = reason;
          updates.contractStatusUpdatedAt = new Date();
          updates.voalleStatusRaw = auth.Status != null ? String(auth.Status) : null;
        }
        if (Object.keys(updates).length > 0) {
          await db.update(links).set(updates).where(eq(links.id, existingLink.id));
          await logAuditEvent({
            action: "update",
            entity: "link",
            entityId: existingLink.id,
            entityName: existingLink.name,
            clientId: existingLink.clientId,
            previous: { voalleServiceId: existingLink.voalleServiceId, contractStatus: existingLink.contractStatus },
            current: updates,
            metadata: { source: "voalle_webhook", actionType: 0, enrichment: true },
            request: req,
          });
          console.log(`[Webhook/Voalle] Enriched existing link ${existingLink.id} with ${Object.keys(updates).join(", ")}`);
        }
        return;
      }

      let clientId: number | null = null;

      if (auth.PersonId || auth.CustomerId) {
        const voalleId = auth.PersonId || auth.CustomerId;
        const existingClients = await db.select().from(clientsTable)
          .where(eq(clientsTable.voalleCustomerId, Number(voalleId)))
          .limit(1);
        if (existingClients.length > 0) {
          clientId = existingClients[0].id;
          console.log(`[Webhook/Voalle] Client found by PersonId/CustomerId=${voalleId} → clientId=${clientId}`);
        }
      }

      if (!clientId && auth.ContractID) {
        const contractMapping = await db.select().from(voalleContractClients)
          .where(eq(voalleContractClients.contractNumber, String(auth.ContractID)))
          .limit(1);
        if (contractMapping.length > 0) {
          clientId = contractMapping[0].clientId;
          console.log(`[Webhook/Voalle] Client found by ContractID=${auth.ContractID} via contract→client mapping → clientId=${clientId}`);
        }

        if (!clientId) {
          const linksByContract = await db.select().from(links)
            .where(eq(links.voalleContractNumber, String(auth.ContractID)))
            .limit(1);
          if (linksByContract.length > 0) {
            clientId = linksByContract[0].clientId;
            console.log(`[Webhook/Voalle] Client found by ContractID=${auth.ContractID} via existing link id=${linksByContract[0].id} → clientId=${clientId}`);
          }
        }
      }

      if (!clientId && auth.ContractID) {
        console.log(`[Webhook/Voalle] Client not found on first attempt for ContractID=${auth.ContractID}, waiting 3s for contract webhook to finish...`);
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        const retryMapping = await db.select().from(voalleContractClients)
          .where(eq(voalleContractClients.contractNumber, String(auth.ContractID)))
          .limit(1);
        if (retryMapping.length > 0) {
          clientId = retryMapping[0].clientId;
          console.log(`[Webhook/Voalle] Client found on retry by ContractID=${auth.ContractID} → clientId=${clientId}`);
        }
      }

      if (!clientId) {
        const totalClients = await db.select({ count: sql<number>`count(*)` }).from(clientsTable).where(eq(clientsTable.isActive, true));
        const clientCount = Number(totalClients[0]?.count || 0);
        if (clientCount === 1) {
          const singleClient = await db.select().from(clientsTable).where(eq(clientsTable.isActive, true)).limit(1);
          clientId = singleClient[0].id;
          console.log(`[Webhook/Voalle] Single active client found → clientId=${clientId}`);
        } else {
          console.log(`[Webhook/Voalle] Cannot determine client for new link (Login=${auth.Login}, ServiceId=${auth.ServiceId}, ContractID=${auth.ContractID}). ${clientCount} active clients found. Skipping creation.`);
          await logAuditEvent({
            action: "create",
            entity: "link",
            metadata: {
              source: "voalle_webhook",
              actionType: 0,
              skipped: true,
              reason: "Cannot determine client - no PersonId/CustomerId, no matching ContractID, multiple active clients",
              webhookData: { Login: auth.Login, ServiceId: auth.ServiceId, ContractID: auth.ContractID, AccessPoint: auth.AccessPoint },
            },
            status: "failure",
            errorMessage: `Cannot determine client for link Login=${auth.Login}`,
          });
          return;
        }
      }

      const accessPointId = auth.AccessPoint && !isNaN(Number(auth.AccessPoint)) ? Number(auth.AccessPoint) : null;
      if (auth.AccessPoint && accessPointId === null) {
        console.log(`[Webhook/Voalle] AccessPoint "${auth.AccessPoint}" is not numeric, storing as description only`);
      }

      const loginStr = auth.Login ? String(auth.Login) : `voalle_${auth.ServiceId || Date.now()}`;
      const identifier = `VL-${auth.ServiceId || auth.ContractID || Date.now()}`;
      const serviceDesc = auth.ServiceDescription ? String(auth.ServiceDescription) : null;
      const parsedBandwidth = serviceDesc ? parseBandwidthFromDescription(serviceDesc) : null;

      const [newLink] = await db.insert(links).values({
        clientId,
        identifier,
        name: serviceDesc || loginStr,
        location: "Pendente",
        address: "Pendente",
        ipBlock: "0.0.0.0/0",
        totalIps: 1,
        usableIps: 1,
        bandwidth: parsedBandwidth || 0,
        status: "unknown",
        monitoringEnabled: false,
        pppoeUser: auth.Login ? String(auth.Login) : null,
        voalleServiceId: auth.ServiceId ? Number(auth.ServiceId) : null,
        voalleContractNumber: auth.ContractID ? String(auth.ContractID) : null,
        voalleAccessPointId: accessPointId,
        slotOlt: auth.OltSlot != null ? Number(auth.OltSlot) : null,
        portOlt: auth.OltPort != null ? Number(auth.OltPort) : null,
        voalleServiceDescription: serviceDesc,
        contractStatus,
        contractStatusReason: reason || null,
        contractStatusUpdatedAt: new Date(),
        voalleStatusRaw: auth.Status != null ? String(auth.Status) : null,
      }).returning();

      await logAuditEvent({
        action: "create",
        entity: "link",
        entityId: newLink.id,
        entityName: newLink.name,
        clientId,
        current: { identifier, pppoeUser: loginStr, voalleServiceId: auth.ServiceId, contractStatus },
        metadata: { source: "voalle_webhook", actionType: 0 },
        request: req,
      });

      console.log(`[Webhook/Voalle] Created new link id=${newLink.id} name="${newLink.name}" clientId=${clientId} contractStatus=${contractStatus}`);

    } else if (actionType === 1) {
      const existingLink = await findLinkByVoalleData(auth);
      if (!existingLink) {
        console.log(`[Webhook/Voalle] ActionType=1 (Alteração): link not found for Login=${auth.Login}, ServiceId=${auth.ServiceId}`);
        return;
      }

      const updates: Record<string, any> = {};
      const previous: Record<string, any> = {};

      if (auth.Login && auth.Login !== existingLink.pppoeUser) {
        previous.pppoeUser = existingLink.pppoeUser;
        updates.pppoeUser = String(auth.Login);
      }
      if (auth.ServiceId && Number(auth.ServiceId) !== existingLink.voalleServiceId) {
        previous.voalleServiceId = existingLink.voalleServiceId;
        updates.voalleServiceId = Number(auth.ServiceId);
      }
      if (auth.ContractID && String(auth.ContractID) !== existingLink.voalleContractNumber) {
        let contractBelongsToSameClient = true;
        const contractMapping = await db.select().from(voalleContractClients)
          .where(eq(voalleContractClients.contractNumber, String(auth.ContractID)))
          .limit(1);
        if (contractMapping.length > 0 && contractMapping[0].clientId !== existingLink.clientId) {
          contractBelongsToSameClient = false;
          console.log(`[Webhook/Voalle] ActionType=1: ContractID=${auth.ContractID} belongs to clientId=${contractMapping[0].clientId} but link id=${existingLink.id} belongs to clientId=${existingLink.clientId} — skipping contract assignment`);
        }
        if (contractBelongsToSameClient) {
          previous.voalleContractNumber = existingLink.voalleContractNumber;
          updates.voalleContractNumber = String(auth.ContractID);
        }
      }
      if (auth.AccessPoint && !isNaN(Number(auth.AccessPoint)) && Number(auth.AccessPoint) !== existingLink.voalleAccessPointId) {
        previous.voalleAccessPointId = existingLink.voalleAccessPointId;
        updates.voalleAccessPointId = Number(auth.AccessPoint);
      }
      if (auth.OltSlot != null && Number(auth.OltSlot) !== existingLink.slotOlt) {
        previous.slotOlt = existingLink.slotOlt;
        updates.slotOlt = Number(auth.OltSlot);
      }
      if (auth.OltPort != null && Number(auth.OltPort) !== existingLink.portOlt) {
        previous.portOlt = existingLink.portOlt;
        updates.portOlt = Number(auth.OltPort);
      }

      if (auth.ServiceDescription) {
        const newDesc = String(auth.ServiceDescription);
        if (newDesc !== existingLink.voalleServiceDescription) {
          previous.voalleServiceDescription = existingLink.voalleServiceDescription;
          updates.voalleServiceDescription = newDesc;
          const parsedBw = parseBandwidthFromDescription(newDesc);
          if (parsedBw && parsedBw !== existingLink.bandwidth) {
            previous.bandwidth = existingLink.bandwidth;
            updates.bandwidth = parsedBw;
            console.log(`[Webhook/Voalle] Bandwidth change detected: ${existingLink.bandwidth}M → ${parsedBw}M (from "${newDesc}")`);
          }
          if (existingLink.voalleServiceDescription && existingLink.name === existingLink.voalleServiceDescription) {
            previous.name = existingLink.name;
            updates.name = newDesc;
          }
        }
      }

      if (auth.Status !== undefined && auth.Status !== null) {
        const newVoalleStatus = String(auth.Status);
        if (newVoalleStatus !== existingLink.voalleStatusRaw || contractStatus !== existingLink.contractStatus) {
          previous.contractStatus = existingLink.contractStatus;
          previous.voalleStatusRaw = existingLink.voalleStatusRaw;
          updates.contractStatus = contractStatus;
          updates.contractStatusReason = reason;
          updates.contractStatusUpdatedAt = new Date();
          updates.voalleStatusRaw = newVoalleStatus;
        }
      }

      if (Object.keys(updates).length === 0) {
        console.log(`[Webhook/Voalle] ActionType=1: no changes detected for link id=${existingLink.id}`);
        return;
      }

      await db.update(links).set(updates).where(eq(links.id, existingLink.id));

      await logAuditEvent({
        action: "update",
        entity: "link",
        entityId: existingLink.id,
        entityName: existingLink.name,
        clientId: existingLink.clientId,
        previous,
        current: updates,
        metadata: { source: "voalle_webhook", actionType: 1, changedFields: Object.keys(updates) },
        request: req,
      });

      console.log(`[Webhook/Voalle] Updated link id=${existingLink.id}: ${Object.keys(updates).join(", ")}`);

    } else if (actionType === 2) {
      const existingLink = await findLinkByVoalleData(auth);
      if (!existingLink) {
        console.log(`[Webhook/Voalle] ActionType=2 (Exclusão): link not found for Login=${auth.Login}, ServiceId=${auth.ServiceId}`);
        return;
      }

      if (existingLink.deletedAt) {
        console.log(`[Webhook/Voalle] Link id=${existingLink.id} already soft-deleted, skipping`);
        return;
      }

      await db.update(links).set({
        deletedAt: new Date(),
        deletedReason: "voalle_webhook",
        monitoringEnabled: false,
        contractStatus: "cancelled",
        contractStatusReason: "Excluído via webhook Voalle",
        contractStatusUpdatedAt: new Date(),
        voalleStatusRaw: auth.Status != null ? String(auth.Status) : existingLink.voalleStatusRaw,
      }).where(eq(links.id, existingLink.id));

      await logAuditEvent({
        action: "delete",
        entity: "link",
        entityId: existingLink.id,
        entityName: existingLink.name,
        clientId: existingLink.clientId,
        previous: { monitoringEnabled: existingLink.monitoringEnabled, contractStatus: existingLink.contractStatus },
        current: { deletedAt: new Date(), deletedReason: "voalle_webhook", monitoringEnabled: false },
        metadata: { source: "voalle_webhook", actionType: 2 },
        request: req,
      });

      console.log(`[Webhook/Voalle] Soft-deleted link id=${existingLink.id} name="${existingLink.name}"`);
    }
  }

  // ==========================================
  // Voalle Webhook - Auto-Enrichment on New Client
  // ==========================================

  async function enrichNewClientFromPortalAndOzmap(
    clientId: number,
    clientData: any,
    contractNumber: string,
    contract: any,
    req: Request
  ): Promise<void> {
    const cnpj = clientData.TxId ? String(clientData.TxId).replace(/\D/g, '') : null;
    if (!cnpj) {
      console.log(`[Webhook/Enrichment] Client id=${clientId}: no CPF/CNPJ available, skipping enrichment`);
      return;
    }

    console.log(`[Webhook/Enrichment] Starting auto-enrichment for client id=${clientId} name="${clientData.Name}" CPF/CNPJ=${cnpj}`);

    const voalleIntegration = await storage.getErpIntegrationByProvider('voalle');
    if (!voalleIntegration || !voalleIntegration.isActive) {
      console.log(`[Webhook/Enrichment] Voalle ERP integration not configured or inactive, skipping`);
      return;
    }

    const adapter = configureErpAdapter(voalleIntegration) as any;
    if (!adapter || !adapter.validatePortalCredentials) {
      console.log(`[Webhook/Enrichment] Voalle adapter not available, skipping`);
      return;
    }

    const validation = await adapter.validatePortalCredentials(cnpj, cnpj);
    if (!validation.success) {
      console.log(`[Webhook/Enrichment] Portal credentials invalid for CPF/CNPJ ${cnpj}: ${validation.message}`);
      await logAuditEvent({
        action: "update",
        entity: "client",
        entityId: clientId,
        entityName: String(clientData.Name),
        clientId,
        metadata: { source: "voalle_webhook_enrichment", step: "validate_credentials", cnpj, result: "invalid" },
        request: req,
      });
      return;
    }

    console.log(`[Webhook/Enrichment] Portal credentials valid for ${cnpj}, personId=${validation.person?.id}`);

    const clientUpdates: Record<string, any> = {
      voallePortalUsername: cnpj,
      voallePortalPassword: encrypt(cnpj),
    };
    if (validation.person?.id) {
      clientUpdates.voalleCustomerId = validation.person.id;
    }
    await db.update(clientsTable).set(clientUpdates).where(eq(clientsTable.id, clientId));

    await logAuditEvent({
      action: "update",
      entity: "client",
      entityId: clientId,
      entityName: String(clientData.Name),
      clientId,
      current: { voallePortalUsername: cnpj, voalleCustomerId: validation.person?.id },
      metadata: { source: "voalle_webhook_enrichment", step: "credentials_saved" },
      request: req,
    });

    let tags: any[] = [];
    try {
      tags = await adapter.getContractTags({
        voalleCustomerId: String(validation.person?.id || clientData.ID),
        cnpj,
        portalUsername: cnpj,
        portalPassword: cnpj,
      });
    } catch (tagErr: any) {
      console.error(`[Webhook/Enrichment] Error fetching contract tags:`, tagErr.message);
      return;
    }

    if (!tags || tags.length === 0) {
      console.log(`[Webhook/Enrichment] No active connections found for client id=${clientId}`);
      return;
    }

    console.log(`[Webhook/Enrichment] Found ${tags.length} active connection(s) for client id=${clientId}`);

    const contractTags = tags.filter(t => t.contractNumber === contractNumber);
    const tagsToProcess = contractTags.length > 0 ? contractTags : tags;

    if (contractTags.length === 0) {
      console.log(`[Webhook/Enrichment] No connections match contract #${contractNumber}, processing all ${tags.length} connections`);
    } else {
      console.log(`[Webhook/Enrichment] ${contractTags.length} connection(s) match contract #${contractNumber}`);
    }

    let createdCount = 0;
    let enrichedCount = 0;

    for (const tag of tagsToProcess) {
      const existingByTag = tag.serviceTag ? await db.select().from(links)
        .where(eq(links.voalleContractTagServiceTag, String(tag.serviceTag)))
        .limit(1) : [];

      const existingByPppoe = tag.pppoeUser && existingByTag.length === 0 ? await db.select().from(links)
        .where(eq(links.pppoeUser, String(tag.pppoeUser)))
        .limit(1) : [];

      const existingLink = existingByTag[0] || existingByPppoe[0];

      if (existingLink) {
        const enrichUpdates: Record<string, any> = {};
        const enrichPrevious: Record<string, any> = {};

        if (tag.serviceTag && !existingLink.voalleContractTagServiceTag) {
          enrichPrevious.voalleContractTagServiceTag = existingLink.voalleContractTagServiceTag;
          enrichUpdates.voalleContractTagServiceTag = String(tag.serviceTag);
        }
        if (tag.ip && !existingLink.monitoredIp) {
          enrichPrevious.monitoredIp = existingLink.monitoredIp;
          enrichUpdates.monitoredIp = tag.ip;
        }
        if (tag.pppoeUser && !existingLink.pppoeUser) {
          enrichPrevious.pppoeUser = existingLink.pppoeUser;
          enrichUpdates.pppoeUser = tag.pppoeUser;
        }
        if (tag.pppoePassword && !existingLink.pppoePassword) {
          enrichUpdates.pppoePassword = tag.pppoePassword;
        }
        if (tag.bandwidth && (!existingLink.bandwidth || existingLink.bandwidth === 0)) {
          enrichPrevious.bandwidth = existingLink.bandwidth;
          enrichUpdates.bandwidth = tag.bandwidth;
        }
        if (tag.slotOlt != null && existingLink.slotOlt == null) {
          enrichUpdates.slotOlt = tag.slotOlt;
        }
        if (tag.portOlt != null && existingLink.portOlt == null) {
          enrichUpdates.portOlt = tag.portOlt;
        }
        if (tag.equipmentSerialNumber && !existingLink.equipmentSerialNumber) {
          enrichUpdates.equipmentSerialNumber = tag.equipmentSerialNumber;
        }
        if (tag.address && (existingLink.address === "Pendente" || !existingLink.address)) {
          enrichPrevious.address = existingLink.address;
          enrichUpdates.address = tag.address;
        }
        if (tag.location && (existingLink.location === "Pendente" || !existingLink.location)) {
          enrichPrevious.location = existingLink.location;
          enrichUpdates.location = tag.location;
        }
        if (tag.contractNumber && !existingLink.voalleContractNumber) {
          enrichUpdates.voalleContractNumber = String(tag.contractNumber);
        }
        if (tag.wifiName && !existingLink.wifiName) {
          enrichUpdates.wifiName = tag.wifiName;
        }
        if (tag.wifiPassword && !existingLink.wifiPassword) {
          enrichUpdates.wifiPassword = tag.wifiPassword;
        }
        if (tag.ipBlock && !existingLink.ipBlock) {
          enrichUpdates.ipBlock = tag.ipBlock;
        }
        if (tag.connectionId && !existingLink.voalleConnectionId) {
          enrichUpdates.voalleConnectionId = tag.connectionId;
        }

        if (Object.keys(enrichUpdates).length > 0) {
          await db.update(links).set(enrichUpdates).where(eq(links.id, existingLink.id));
          await logAuditEvent({
            action: "update",
            entity: "link",
            entityId: existingLink.id,
            entityName: existingLink.name,
            clientId,
            previous: enrichPrevious,
            current: enrichUpdates,
            metadata: { source: "voalle_webhook_enrichment", step: "enrich_existing_link", serviceTag: tag.serviceTag },
            request: req,
          });
          enrichedCount++;
          console.log(`[Webhook/Enrichment] Enriched existing link id=${existingLink.id}: ${Object.keys(enrichUpdates).join(', ')}`);
        }
        continue;
      }

      const linkName = tag.description || tag.pppoeUser || `${clientData.Name} - ${tag.serviceTag || contractNumber}`;
      const identifier = tag.serviceTag ? `VL-${tag.serviceTag}` : `VL-${contractNumber}-${tag.id || Date.now()}`;
      const serviceDesc = tag.description || null;
      const parsedBandwidth = serviceDesc ? parseBandwidthFromDescription(serviceDesc) : (tag.bandwidth || null);

      try {
        const [newLink] = await db.insert(links).values({
          clientId,
          identifier,
          name: linkName,
          location: tag.location || "Pendente",
          address: tag.address || "Pendente",
          ipBlock: tag.ipBlock || "0.0.0.0/0",
          totalIps: 1,
          usableIps: 1,
          bandwidth: parsedBandwidth || tag.bandwidth || 0,
          status: "unknown",
          monitoringEnabled: false,
          pppoeUser: tag.pppoeUser || null,
          monitoredIp: tag.ip || null,
          voalleContractNumber: tag.contractNumber ? String(tag.contractNumber) : contractNumber,
          voalleContractTagServiceTag: tag.serviceTag ? String(tag.serviceTag) : null,
          voalleContractTagId: tag.id || null,
          voalleConnectionId: tag.connectionId || null,
          voalleAccessPointId: tag.oltId || null,
          slotOlt: tag.slotOlt != null ? tag.slotOlt : null,
          portOlt: tag.portOlt != null ? tag.portOlt : null,
          equipmentSerialNumber: tag.equipmentSerialNumber || null,
          voalleServiceDescription: serviceDesc,
          pppoePassword: tag.pppoePassword || null,
          wifiName: tag.wifiName || null,
          wifiPassword: tag.wifiPassword || null,
          contractStatus: "active",
          contractStatusUpdatedAt: new Date(),
        }).returning();

        createdCount++;
        console.log(`[Webhook/Enrichment] Created link id=${newLink.id} name="${newLink.name}" serviceTag=${tag.serviceTag} pppoe=${tag.pppoeUser} ip=${tag.ip}`);

        await logAuditEvent({
          action: "create",
          entity: "link",
          entityId: newLink.id,
          entityName: newLink.name,
          clientId,
          current: {
            identifier, pppoeUser: tag.pppoeUser, monitoredIp: tag.ip,
            serviceTag: tag.serviceTag, bandwidth: parsedBandwidth || tag.bandwidth,
            slotOlt: tag.slotOlt, portOlt: tag.portOlt,
          },
          metadata: { source: "voalle_webhook_enrichment", step: "create_link_from_portal", contractNumber },
          request: req,
        });

        if (tag.serviceTag) {
          try {
            await enrichLinkWithOzmapData(newLink.id, String(tag.serviceTag), newLink.name);
          } catch (ozmapErr: any) {
            console.log(`[Webhook/Enrichment] OZmap enrichment failed for link id=${newLink.id}: ${ozmapErr.message}`);
          }
        }
      } catch (linkErr: any) {
        console.error(`[Webhook/Enrichment] Error creating link for tag ${tag.serviceTag}:`, linkErr.message);
      }
    }

    console.log(`[Webhook/Enrichment] Completed for client id=${clientId}: ${createdCount} links created, ${enrichedCount} links enriched`);
  }

  // Helper: busca a tag/code OZmap por critérios alternativos quando a tag principal falha
  async function findOzmapTagByFallback(
    baseUrl: string,
    apiKey: string,
    link: any,
  ): Promise<{ code: string; method: string } | null> {
    const headers = { "Accept": "application/json", "Authorization": apiKey };

    // --- Fallback 1: por serial da ONU ---
    const serial = link.equipmentSerialNumber;
    if (serial) {
      try {
        const filter = encodeURIComponent(JSON.stringify([
          { property: "onu.serial_number", value: serial, operator: "=" }
        ]));
        const res = await fetch(`${baseUrl}/api/v2/ftth-clients?filter=${filter}&limit=5`, { headers });
        if (res.ok) {
          const data = await res.json();
          const rows: any[] = data.rows || (Array.isArray(data) ? data : []);
          if (rows.length === 1 && rows[0].code) {
            console.log(`[OZmap Fallback] Encontrado por serial (${serial}): ${rows[0].code}`);
            return { code: rows[0].code, method: `serial:${serial}` };
          }
          if (rows.length > 1) {
            console.log(`[OZmap Fallback] Serial ${serial} retornou ${rows.length} resultados — tentando PPPoE para refinar`);
          }
        }
      } catch (e: any) {
        console.error("[OZmap Fallback] Erro na busca por serial:", e.message);
      }
    }

    // --- Fallback 2: por login PPPoE ---
    const pppoe = link.voalleLogin;
    if (pppoe) {
      try {
        const filter = encodeURIComponent(JSON.stringify([
          { property: "onu.user_PPPoE", value: pppoe, operator: "=" }
        ]));
        const res = await fetch(`${baseUrl}/api/v2/ftth-clients?filter=${filter}&limit=5`, { headers });
        if (res.ok) {
          const data = await res.json();
          const rows: any[] = data.rows || (Array.isArray(data) ? data : []);
          if (rows.length >= 1 && rows[0].code) {
            console.log(`[OZmap Fallback] Encontrado por PPPoE (${pppoe}): ${rows[0].code}`);
            return { code: rows[0].code, method: `pppoe:${pppoe}` };
          }
        }
      } catch (e: any) {
        console.error("[OZmap Fallback] Erro na busca por PPPoE:", e.message);
      }
    }

    // --- Fallback 3: por OLT + slot + pon ---
    const oltName = link.ozmapOltName;
    if (oltName && link.slotOlt !== null && link.slotOlt !== undefined && link.portOlt !== null && link.portOlt !== undefined) {
      try {
        // Passo 1: encontrar o ID da OLT no OZmap
        const oltFilter = encodeURIComponent(JSON.stringify([
          { property: "name", value: oltName, operator: "=" }
        ]));
        const oltRes = await fetch(`${baseUrl}/api/v2/olts?filter=${oltFilter}&limit=1`, { headers });
        if (oltRes.ok) {
          const oltData = await oltRes.json();
          const oltRows: any[] = oltData.rows || (Array.isArray(oltData) ? oltData : []);
          if (oltRows.length > 0) {
            const ozmapOltId = oltRows[0].id;
            // Passo 2: encontrar o PON (slot + porta)
            const ponFilter = encodeURIComponent(JSON.stringify([
              { property: "olt", value: ozmapOltId, operator: "=" },
              { property: "slot.number", value: link.slotOlt, operator: "=" },
              { property: "number", value: link.portOlt, operator: "=" }
            ]));
            const ponRes = await fetch(`${baseUrl}/api/v2/pons?filter=${ponFilter}&limit=1`, { headers });
            if (ponRes.ok) {
              const ponData = await ponRes.json();
              const ponRows: any[] = ponData.rows || (Array.isArray(ponData) ? ponData : []);
              if (ponRows.length > 0) {
                const ponId = ponRows[0].id;
                // Passo 3: clientes FTTH nessa PON
                const clientFilter = encodeURIComponent(JSON.stringify([
                  { property: "pon", value: ponId, operator: "=" }
                ]));
                const clientRes = await fetch(`${baseUrl}/api/v2/ftth-clients?filter=${clientFilter}&limit=20`, { headers });
                if (clientRes.ok) {
                  const clientData = await clientRes.json();
                  const clientRows: any[] = clientData.rows || (Array.isArray(clientData) ? clientData : []);
                  if (clientRows.length === 1 && clientRows[0].code) {
                    console.log(`[OZmap Fallback] Encontrado por OLT+slot+pon (${oltName}/${link.slotOlt}/${link.portOlt}): ${clientRows[0].code}`);
                    return { code: clientRows[0].code, method: `olt:${oltName}/slot:${link.slotOlt}/pon:${link.portOlt}` };
                  }
                  // Múltiplos clientes na mesma PON — tentar pelo ONU ID
                  if (clientRows.length > 1 && link.onuId !== null && link.onuId !== undefined) {
                    const onuIdStr = String(link.onuId);
                    const matched = clientRows.find((c: any) =>
                      c.observation?.includes(onuIdStr) || c.name?.toLowerCase().includes(`onu ${onuIdStr}`)
                    );
                    if (matched?.code) {
                      console.log(`[OZmap Fallback] Encontrado por OLT+slot+pon+ONU (${onuIdStr}): ${matched.code}`);
                      return { code: matched.code, method: `olt+onu:${onuIdStr}` };
                    }
                  }
                }
              }
            }
          }
        }
      } catch (e: any) {
        console.error("[OZmap Fallback] Erro na busca por OLT/slot/pon:", e.message);
      }
    }

    // --- Fallback 4: por nome do splitter ---
    const splitterName = link.ozmapSplitterName || link.zabbixSplitterName;
    if (splitterName) {
      try {
        const splFilter = encodeURIComponent(JSON.stringify([
          { property: "name", value: splitterName, operator: "=" }
        ]));
        const splRes = await fetch(`${baseUrl}/api/v2/splitters?filter=${splFilter}&limit=1`, { headers });
        if (splRes.ok) {
          const splData = await splRes.json();
          const splRows: any[] = splData.rows || (Array.isArray(splData) ? splData : []);
          if (splRows.length > 0) {
            const splitterId = splRows[0].id;
            const clientFilter = encodeURIComponent(JSON.stringify([
              { property: "splitter", value: splitterId, operator: "=" }
            ]));
            const clientRes = await fetch(`${baseUrl}/api/v2/ftth-clients?filter=${clientFilter}&limit=10`, { headers });
            if (clientRes.ok) {
              const clientData = await clientRes.json();
              const clientRows: any[] = clientData.rows || (Array.isArray(clientData) ? clientData : []);
              if (clientRows.length === 1 && clientRows[0].code) {
                console.log(`[OZmap Fallback] Encontrado por splitter (${splitterName}): ${clientRows[0].code}`);
                return { code: clientRows[0].code, method: `splitter:${splitterName}` };
              }
            }
          }
        }
      } catch (e: any) {
        console.error("[OZmap Fallback] Erro na busca por splitter:", e.message);
      }
    }

    return null;
  }

  async function enrichLinkWithOzmapData(linkId: number, serviceTag: string, linkName: string): Promise<boolean> {
    const ozmapIntegrations = await db
      .select()
      .from(externalIntegrations)
      .where(eq(externalIntegrations.provider, "ozmap"))
      .limit(1);

    if (ozmapIntegrations.length === 0 || !ozmapIntegrations[0].apiKey || !ozmapIntegrations[0].apiUrl || !ozmapIntegrations[0].isActive) {
      console.log(`[Webhook/Enrichment/OZmap] Integration not configured, skipping`);
      return false;
    }

    const ozmapConfig = ozmapIntegrations[0];
    let baseUrl = ozmapConfig.apiUrl!.replace(/\/+$/, "");
    if (baseUrl.endsWith("/api/v2")) {
      baseUrl = baseUrl.slice(0, -7);
    }

    const ozmapHeaders = { "Accept": "application/json", "Authorization": ozmapConfig.apiKey! };

    let resolvedTag = serviceTag;
    let data: any[] | null = null;

    // Helper local: lê potência
    // OZmap HTTP 422 = cliente existe mas sem rota de fibra configurada
    // OZmap body vazio = mesma semântica do 422 em versões anteriores
    async function readPotency(tag: string): Promise<{ data: any[] | null; noRoute: boolean }> {
      const r = await fetch(`${baseUrl}/api/v2/properties/client/${encodeURIComponent(tag)}/potency?locale=pt_BR`, { method: "GET", headers: ozmapHeaders });
      if (!r.ok) {
        if (r.status === 422) {
          console.log(`[Webhook/Enrichment/OZmap] Tag "${tag}" → HTTP 422 (cliente sem rota de fibra)`);
          return { data: null, noRoute: true };
        }
        return { data: null, noRoute: false };
      }
      const text = await r.text();
      if (!text || text.trim() === "" || text.trim() === "null") {
        return { data: null, noRoute: true };
      }
      try {
        const parsed = JSON.parse(text);
        return { data: Array.isArray(parsed) && parsed.length > 0 ? parsed : null, noRoute: !parsed?.length };
      } catch {
        return { data: null, noRoute: false };
      }
    }

    // Tentativa 1: tag principal
    let potencyResult = await readPotency(resolvedTag);
    data = potencyResult.data;

    if (!data && !potencyResult.noRoute) {
      console.log(`[Webhook/Enrichment/OZmap] Tag "${serviceTag}" não encontrada, tentando fallbacks...`);
      // Buscar dados completos do link para usar nos fallbacks
      const linkRows = await db.select().from(links).where(eq(links.id, linkId)).limit(1);
      if (linkRows.length > 0) {
        const fallback = await findOzmapTagByFallback(baseUrl, ozmapConfig.apiKey!, linkRows[0]);
        if (fallback) {
          resolvedTag = fallback.code;
          console.log(`[Webhook/Enrichment/OZmap] Tag encontrada via fallback (${fallback.method}): ${resolvedTag}`);
          await db.update(links).set({ voalleContractTagServiceTag: resolvedTag }).where(eq(links.id, linkId));
          potencyResult = await readPotency(resolvedTag);
          data = potencyResult.data;
        }
      }
    }

    if (!data || data.length === 0) {
      if (potencyResult.noRoute) {
        // Cliente existe no OZmap mas sem rota — gravar flag para diagnóstico
        await db.update(links).set({ ozmapNoRoute: true }).where(eq(links.id, linkId));
        console.log(`[Webhook/Enrichment/OZmap] Link id=${linkId} "${linkName}": sem rota de fibra (ozmapNoRoute=true)`);
      } else {
        console.log(`[Webhook/Enrichment/OZmap] Nenhum dado encontrado no OZmap para link id=${linkId} "${linkName}" (todos os fallbacks esgotados)`);
      }
      return false;
    }

    // Encontrou dados — garantir que ozmapNoRoute está false
    await db.update(links).set({ ozmapNoRoute: false }).where(eq(links.id, linkId));

    const potencyItem = data[0];
    let splitterName: string | null = null;
    let splitterPort: string | null = null;
    let oltName: string | null = null;
    let oltSlot: number | null = null;
    let oltPort: number | null = null;

    if (potencyItem.elements && Array.isArray(potencyItem.elements)) {
      for (const elem of potencyItem.elements) {
        if (elem.element?.kind === 'Splitter') {
          splitterName = elem.parent?.name || elem.element?.name || null;
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
        }
        if (elem.element?.kind === 'OLT' || elem.parent?.name?.toLowerCase()?.includes('olt')) {
          oltName = elem.parent?.name || elem.element?.name || null;
          const slotData = elem.element?.slot;
          if (slotData !== undefined) {
            if (typeof slotData === 'object' && slotData.number !== undefined) {
              oltSlot = parseInt(String(slotData.number), 10);
            } else if (typeof slotData !== 'object') {
              oltSlot = parseInt(String(slotData), 10);
            }
          }
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
    }

    if (potencyItem.olt_name) oltName = potencyItem.olt_name;
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

    const ozmapUpdate: Record<string, any> = {
      ozmapDistance: potencyItem.distance || null,
      ozmapArrivingPotency: potencyItem.arriving_potency || null,
      ozmapAttenuation: potencyItem.attenuation || null,
      ozmapPonReached: potencyItem.pon_reached || false,
      ozmapLastSync: new Date(),
    };

    if (splitterName) ozmapUpdate.ozmapSplitterName = splitterName;
    if (splitterPort) ozmapUpdate.ozmapSplitterPort = splitterPort;
    if (oltName) ozmapUpdate.ozmapOltName = oltName;
    if (oltSlot !== null) ozmapUpdate.ozmapSlot = oltSlot;
    if (oltPort !== null) ozmapUpdate.ozmapPort = oltPort;
    if (potencyItem.arriving_potency !== undefined && potencyItem.arriving_potency !== null) {
      ozmapUpdate.opticalRxBaseline = potencyItem.arriving_potency;
    }

    await db.update(links).set(ozmapUpdate).where(eq(links.id, linkId));
    console.log(`[Webhook/Enrichment/OZmap] Link id=${linkId} "${linkName}": potency=${potencyItem.arriving_potency}, distance=${potencyItem.distance}, splitter=${splitterName}, OLT=${oltName}`);
    return true;
  }

  // ==========================================
  // Voalle Webhook - Contract Processing
  // ==========================================

  async function processVoalleContractWebhook(actionType: number, contractData: any, req: Request): Promise<void> {
    const contract = Array.isArray(contractData) ? contractData[0] : contractData;
    if (!contract) {
      console.log(`[Webhook/Voalle] Contract webhook received but no contract data`);
      return;
    }

    const contractNumber = contract.Number ? String(contract.Number) : null;
    const clientData = contract.Client;
    if (clientData && clientData.Id !== undefined && clientData.ID === undefined) {
      clientData.ID = clientData.Id;
    }
    const statusData = contract.Status;
    const addressData = contract.Address;

    const statusCode = statusData?.Code;
    const { contractStatus, reason } = mapVoalleStatus(statusCode);

    console.log(`[Webhook/Voalle] Contract #${contractNumber} - Client: ${clientData?.Name || 'N/A'} (ID: ${clientData?.ID || 'N/A'}) - Status: ${statusData?.Description || statusCode} → ${contractStatus}`);

    if (actionType === 0 || actionType === 1) {
      let clientId: number | null = null;

      if (clientData?.ID) {
        const existing = await db.select().from(clientsTable)
          .where(eq(clientsTable.voalleCustomerId, Number(clientData.ID)))
          .limit(1);

        if (existing.length > 0) {
          clientId = existing[0].id;
          const clientUpdates: Record<string, any> = {};
          if (clientData.Name && clientData.Name !== existing[0].name) clientUpdates.name = String(clientData.Name);
          if (clientData.TxId && clientData.TxId !== existing[0].cnpj) clientUpdates.cnpj = String(clientData.TxId);
          if (addressData) {
            const fullAddress = [addressData.Street, addressData.Number, addressData.Neigborhood, addressData.City, addressData.State].filter(Boolean).join(', ');
            if (fullAddress && fullAddress !== existing[0].address) clientUpdates.address = fullAddress;
          }
          if (Object.keys(clientUpdates).length > 0) {
            clientUpdates.updatedAt = new Date();
            await db.update(clientsTable).set(clientUpdates).where(eq(clientsTable.id, clientId));
            console.log(`[Webhook/Voalle] Updated client id=${clientId}: ${Object.keys(clientUpdates).join(', ')}`);
            await logAuditEvent({
              action: "update",
              entity: "client",
              entityId: clientId,
              entityName: existing[0].name,
              clientId,
              previous: { name: existing[0].name, cnpj: existing[0].cnpj },
              current: clientUpdates,
              metadata: { source: "voalle_webhook", actionType, contractNumber },
              request: req,
            });
          }
        } else if (actionType === 0 && clientData.Name) {
          const slug = String(clientData.Name).toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
            .substring(0, 90);

          const uniqueSlug = `${slug}-${Date.now()}`;
          const fullAddress = addressData
            ? [addressData.Street, addressData.Number, addressData.Neigborhood, addressData.City, addressData.State].filter(Boolean).join(', ')
            : null;

          try {
            const [newClient] = await db.insert(clientsTable).values({
              name: String(clientData.Name),
              slug: uniqueSlug,
              cnpj: clientData.TxId ? String(clientData.TxId) : null,
              address: fullAddress,
              voalleCustomerId: Number(clientData.ID),
              isActive: true,
            }).returning();
            clientId = newClient.id;
            console.log(`[Webhook/Voalle] Created new client id=${clientId} name="${clientData.Name}" voalleCustomerId=${clientData.ID}`);
            await logAuditEvent({
              action: "create",
              entity: "client",
              entityId: clientId,
              entityName: String(clientData.Name),
              clientId,
              current: { name: clientData.Name, voalleCustomerId: clientData.ID, cnpj: clientData.TxId },
              metadata: { source: "voalle_webhook", actionType: 0, contractNumber },
              request: req,
            });
          } catch (insertErr: any) {
            console.error(`[Webhook/Voalle] Error creating client:`, insertErr.message);
          }
        }
      }

      if (contractNumber && clientId) {
        const existingMapping = await db.select().from(voalleContractClients)
          .where(eq(voalleContractClients.contractNumber, contractNumber))
          .limit(1);

        if (existingMapping.length > 0) {
          if (existingMapping[0].clientId !== clientId) {
            await db.update(voalleContractClients)
              .set({ clientId, clientName: clientData?.Name || null, updatedAt: new Date() })
              .where(eq(voalleContractClients.id, existingMapping[0].id));
            console.log(`[Webhook/Voalle] Updated contract→client mapping: #${contractNumber} → clientId=${clientId}`);
          }
        } else {
          await db.insert(voalleContractClients).values({
            contractNumber,
            clientId,
            voalleCustomerId: clientData?.ID ? Number(clientData.ID) : null,
            clientName: clientData?.Name || null,
            contractDescription: contract.Description || null,
          });
          console.log(`[Webhook/Voalle] Stored contract→client mapping: #${contractNumber} → clientId=${clientId}`);
        }
      }

      if (!clientId && contractNumber) {
        const mappedContract = await db.select().from(voalleContractClients)
          .where(eq(voalleContractClients.contractNumber, contractNumber))
          .limit(1);
        if (mappedContract.length > 0) {
          clientId = mappedContract[0].clientId;
          console.log(`[Webhook/Voalle] Contract #${contractNumber}: clientId=${clientId} resolved from voalle_contract_clients mapping (Client.ID not found in clients table)`);
        }
      }

      if (!clientId && contractNumber && clientData?.Name) {
        const byName = await db.select().from(clientsTable)
          .where(sql`LOWER(${clientsTable.name}) = LOWER(${String(clientData.Name)})`)
          .limit(1);
        if (byName.length > 0) {
          clientId = byName[0].id;
          console.log(`[Webhook/Voalle] Contract #${contractNumber}: clientId=${clientId} resolved by client name "${clientData.Name}"`);
          if (clientData.ID) {
            await db.update(clientsTable).set({ voalleCustomerId: Number(clientData.ID) }).where(eq(clientsTable.id, clientId));
            console.log(`[Webhook/Voalle] Updated client id=${clientId} with voalleCustomerId=${clientData.ID}`);
          }
        }
      }

      const allServices = (contract.Services && Array.isArray(contract.Services)) ? contract.Services : [];
      if (allServices.length > 0) {
        console.log(`[Webhook/Voalle] Contract #${contractNumber} has ${allServices.length} services: ${allServices.map((s: any) => `${s.ServiceCode || s.Id}="${s.Description}"`).join(', ')}`);
      }

      if (actionType === 0 && clientId && clientData?.TxId && contractNumber) {
        try {
          await enrichNewClientFromPortalAndOzmap(clientId, clientData, contractNumber, contract, req);
        } catch (enrichErr: any) {
          console.error(`[Webhook/Voalle] Enrichment error (non-blocking):`, enrichErr.message);
        }
      }

      if (contractNumber) {
        const linkedLinks = await db.select().from(links)
          .where(eq(links.voalleContractNumber, contractNumber));

        if (linkedLinks.length > 0) {
          for (const link of linkedLinks) {
            if (!clientId) {
              console.log(`[Webhook/Voalle] Contract #${contractNumber}: cannot resolve contract owner — skipping link id=${link.id} updates (safety: no client validation possible)`);
              await logAuditEvent({
                action: "update",
                entity: "link",
                entityId: link.id,
                entityName: link.name,
                clientId: link.clientId,
                metadata: { source: "voalle_webhook", actionType, contractNumber, contractEvent: true, skippedReason: "unresolved_contract_owner", webhookClientId: clientData?.ID, webhookClientName: clientData?.Name },
                status: "failure",
                errorMessage: `Contrato #${contractNumber}: dono não identificado — atualização de link ignorada por segurança`,
                request: req,
              });
              continue;
            }

            if (link.clientId !== clientId) {
              console.log(`[Webhook/Voalle] Contract #${contractNumber}: link id=${link.id} belongs to clientId=${link.clientId} but contract belongs to clientId=${clientId} — clearing incorrect voalleContractNumber`);
              await db.update(links).set({ voalleContractNumber: null }).where(eq(links.id, link.id));
              await logAuditEvent({
                action: "update",
                entity: "link",
                entityId: link.id,
                entityName: link.name,
                clientId: link.clientId,
                previous: { voalleContractNumber: contractNumber },
                current: { voalleContractNumber: null },
                metadata: { source: "voalle_webhook", actionType, contractNumber, contractEvent: true, reason: "client_mismatch_cleanup", contractClientId: clientId, contractClientName: clientData?.Name },
                request: req,
              });
              continue;
            }

            const linkUpdates: Record<string, any> = {};
            const linkPrevious: Record<string, any> = {};

            if (contractStatus !== link.contractStatus) {
              linkPrevious.contractStatus = link.contractStatus;
              linkUpdates.contractStatus = contractStatus;
              linkUpdates.contractStatusReason = reason || statusData?.Description || null;
              linkUpdates.contractStatusUpdatedAt = new Date();
              linkUpdates.voalleStatusRaw = statusCode != null ? String(statusCode) : null;
            }

            let matchedServiceDesc: string | null = null;
            let matchedServiceBandwidth: number | null = null;

            if (allServices.length === 1) {
              const svc = allServices[0];
              if (svc.Description) {
                matchedServiceDesc = String(svc.Description);
                matchedServiceBandwidth = parseBandwidthFromDescription(matchedServiceDesc);
              }
            } else if (allServices.length > 1 && link.voalleServiceId) {
              const matchByServiceId = allServices.find((s: any) => Number(s.Id) === link.voalleServiceId || String(s.ServiceCode) === String(link.voalleServiceId));
              if (matchByServiceId?.Description) {
                matchedServiceDesc = String(matchByServiceId.Description);
                matchedServiceBandwidth = parseBandwidthFromDescription(matchedServiceDesc);
                console.log(`[Webhook/Voalle] Contract #${contractNumber}: link id=${link.id} matched service by voalleServiceId=${link.voalleServiceId} → "${matchedServiceDesc}"`);
              }
            }

            if (!matchedServiceDesc && allServices.length > 1 && link.voalleServiceDescription) {
              const matchByDesc = allServices.find((s: any) => s.Description && String(s.Description) === link.voalleServiceDescription);
              if (matchByDesc?.Description) {
                matchedServiceDesc = String(matchByDesc.Description);
                matchedServiceBandwidth = parseBandwidthFromDescription(matchedServiceDesc);
                console.log(`[Webhook/Voalle] Contract #${contractNumber}: link id=${link.id} matched service by description "${matchedServiceDesc}"`);
              }
            }

            if (!matchedServiceDesc && allServices.length > 1) {
              console.log(`[Webhook/Voalle] Contract #${contractNumber}: link id=${link.id} has ${allServices.length} services but no match found — skipping service/bandwidth update to avoid applying wrong service`);
            }

            if (matchedServiceDesc && matchedServiceDesc !== link.voalleServiceDescription) {
              linkPrevious.voalleServiceDescription = link.voalleServiceDescription;
              linkUpdates.voalleServiceDescription = matchedServiceDesc;
              if (matchedServiceBandwidth && matchedServiceBandwidth !== link.bandwidth) {
                linkPrevious.bandwidth = link.bandwidth;
                linkUpdates.bandwidth = matchedServiceBandwidth;
                console.log(`[Webhook/Voalle] Contract webhook: link id=${link.id} bandwidth ${link.bandwidth}M → ${matchedServiceBandwidth}M`);
              }
            }

            if (Object.keys(linkUpdates).length > 0) {
              await db.update(links).set(linkUpdates).where(eq(links.id, link.id));
              await logAuditEvent({
                action: "update",
                entity: "link",
                entityId: link.id,
                entityName: link.name,
                clientId: link.clientId,
                previous: linkPrevious,
                current: linkUpdates,
                metadata: { source: "voalle_webhook", actionType, contractNumber, contractEvent: true },
                request: req,
              });
              console.log(`[Webhook/Voalle] Contract webhook updated link id=${link.id}: ${Object.keys(linkUpdates).join(', ')}`);
            }
          }
        } else {
          console.log(`[Webhook/Voalle] Contract #${contractNumber}: no linked links found (will be matched when Connection webhook arrives)`);
        }
      }

    } else if (actionType === 2) {
      if (!contractNumber) {
        console.log(`[Webhook/Voalle] Contract exclusion webhook without contract number, skipping`);
        return;
      }

      const linkedLinks = await db.select().from(links)
        .where(and(eq(links.voalleContractNumber, contractNumber), isNull(links.deletedAt)));

      for (const link of linkedLinks) {
        await db.update(links).set({
          deletedAt: new Date(),
          deletedReason: "voalle_webhook_contract",
          monitoringEnabled: false,
          contractStatus: "cancelled",
          contractStatusReason: "Contrato excluído via webhook Voalle",
          contractStatusUpdatedAt: new Date(),
        }).where(eq(links.id, link.id));

        await logAuditEvent({
          action: "delete",
          entity: "link",
          entityId: link.id,
          entityName: link.name,
          clientId: link.clientId,
          previous: { contractStatus: link.contractStatus, monitoringEnabled: link.monitoringEnabled },
          current: { deletedAt: new Date(), deletedReason: "voalle_webhook_contract", contractStatus: "cancelled" },
          metadata: { source: "voalle_webhook", actionType: 2, contractNumber, contractEvent: true },
          request: req,
        });
        console.log(`[Webhook/Voalle] Contract exclusion: soft-deleted link id=${link.id} name="${link.name}"`);
      }

      if (linkedLinks.length === 0) {
        console.log(`[Webhook/Voalle] Contract #${contractNumber} exclusion: no active links found`);
      }
    }
  }

  // ==========================================
  // Voalle Webhook Receiver (Capture Mode)
  // ==========================================
  
  app.post("/api/webhooks/voalle", async (req: Request, res: Response) => {
    try {
      const safeHeaders: Record<string, string> = {};
      for (const [key, value] of Object.entries(req.headers)) {
        if (['authorization', 'x-webhook-token', 'password'].includes(key.toLowerCase())) {
          safeHeaders[key] = '***REDACTED***';
        } else {
          safeHeaders[key] = String(value);
        }
      }

      const webhookUsername = req.headers['username'] || req.query?.username;
      const webhookPassword = req.headers['password'] || req.query?.password;
      const expectedUsername = 'linkmonitor';
      const expectedPassword = process.env.VOALLE_SYN_V1_TOKEN || '';

      if (webhookUsername && expectedPassword) {
        if (webhookUsername !== expectedUsername || webhookPassword !== expectedPassword) {
          console.log(`[Webhook/Voalle] Auth failed: username=${webhookUsername}`);
          await db.insert(webhookLogs).values({
            source: 'voalle' as const,
            event: 'auth_failed',
            method: req.method,
            headers: safeHeaders,
            queryParams: req.query || {},
            body: req.body || null,
            rawBody: JSON.stringify(req.body, null, 2),
            ipAddress: req.ip || req.socket?.remoteAddress || 'unknown',
            processed: false,
          });
          return res.status(401).json({ StatusCode: "401", Content: "Authentication failed" });
        }
      }

      const body = req.body;
      const isArray = Array.isArray(body);
      const payload = isArray ? body[0] : body;
      const actionType = payload?.ActionType;
      const actionLabels: Record<number, string> = { 0: 'Inclusão', 1: 'Alteração', 2: 'Exclusão' };
      const actionLabel = actionLabels[actionType] || `Desconhecido(${actionType})`;

      let eventType = 'unknown';
      if (payload?.Authentication) eventType = 'connection';
      else if (payload?.Contract) eventType = 'contract';
      else if (payload?.Solicitations) eventType = 'solicitation';

      const logEntry = {
        source: 'voalle' as const,
        event: `${eventType}:${actionLabel}`,
        method: req.method,
        headers: safeHeaders,
        queryParams: req.query || {},
        body: payload || null,
        rawBody: JSON.stringify(body, null, 2),
        ipAddress: req.ip || req.socket?.remoteAddress || 'unknown',
        processed: false,
      };

      await db.insert(webhookLogs).values(logEntry);

      console.log(`[Webhook/Voalle] Received ${eventType}:${actionLabel} from ${logEntry.ipAddress}`);
      console.log(`[Webhook/Voalle] Body: ${JSON.stringify(payload, null, 2)}`);

      if (eventType === 'connection' && payload?.Authentication) {
        const auth = payload.Authentication;
        console.log(`[Webhook/Voalle] Conexão do Contrato - Login: ${auth.Login}, ContractID: ${auth.ContractID || auth.ContractId}, AccessPoint: ${auth.AccessPoint}, Action: ${actionLabel}`);
        console.log(`[Webhook/Voalle] OltSlot: ${auth.OltSlot}, OltPort: ${auth.OltPort}, ServiceId: ${auth.ServiceId}, Status: ${auth.Status}`);

        try {
          await processVoalleConnectionWebhook(actionType, auth, req);
        } catch (procError: any) {
          console.error(`[Webhook/Voalle] Error processing connection webhook:`, procError);
          await logAuditEvent({
            action: "update",
            entity: "link",
            metadata: { source: "voalle_webhook", error: procError.message, actionType, auth },
            status: "failure",
            errorMessage: procError.message,
          });
        }

        await db.update(webhookLogs)
          .set({ processed: true })
          .where(eq(webhookLogs.id, (await db.select({ id: webhookLogs.id }).from(webhookLogs).orderBy(sql`${webhookLogs.id} DESC`).limit(1))[0]?.id));
      }

      if (eventType === 'contract' && payload?.Contract) {
        console.log(`[Webhook/Voalle] Contrato - Action: ${actionLabel}`);

        try {
          await processVoalleContractWebhook(actionType, payload.Contract, req);
        } catch (procError: any) {
          console.error(`[Webhook/Voalle] Error processing contract webhook:`, procError);
          await logAuditEvent({
            action: "update",
            entity: "client",
            metadata: { source: "voalle_webhook", error: procError.message, actionType, contractEvent: true },
            status: "failure",
            errorMessage: procError.message,
          });
        }

        await db.update(webhookLogs)
          .set({ processed: true })
          .where(eq(webhookLogs.id, (await db.select({ id: webhookLogs.id }).from(webhookLogs).orderBy(sql`${webhookLogs.id} DESC`).limit(1))[0]?.id));
      }

      res.status(200).json({ 
        StatusCode: "200",
        Content: "Webhook received successfully"
      });
    } catch (error: any) {
      console.error(`[Webhook/Voalle] Error processing webhook:`, error);
      res.status(200).json({ StatusCode: "200", Content: "Received" });
    }
  });
  
  app.get("/api/webhooks/voalle/status", async (req: Request, res: Response) => {
    try {
      const total = await db.select({ count: sql<number>`count(*)` }).from(webhookLogs);
      const detailId = req.query.id ? parseInt(req.query.id as string) : null;
      if (detailId) {
        const log = await db.select().from(webhookLogs).where(eq(webhookLogs.id, detailId)).limit(1);
        return res.json(log[0] || { error: "Not found" });
      }
      const latest = await db.select({
        id: webhookLogs.id,
        source: webhookLogs.source,
        event: webhookLogs.event,
        method: webhookLogs.method,
        ipAddress: webhookLogs.ipAddress,
        processed: webhookLogs.processed,
        receivedAt: webhookLogs.receivedAt,
      }).from(webhookLogs).orderBy(sql`${webhookLogs.receivedAt} DESC`).limit(10);
      res.json({ totalLogs: total[0]?.count || 0, latest });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/webhooks/logs", requireSuperAdmin, async (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const logs = await db.select()
        .from(webhookLogs)
        .orderBy(sql`${webhookLogs.receivedAt} DESC`)
        .limit(limit);
      res.json(logs);
    } catch (error: any) {
      res.status(500).json({ error: "Erro ao buscar logs de webhook" });
    }
  });
  
  app.delete("/api/webhooks/logs", requireSuperAdmin, async (req: Request, res: Response) => {
    try {
      await db.delete(webhookLogs);
      res.json({ success: true, message: "Logs de webhook limpos" });
    } catch (error: any) {
      res.status(500).json({ error: "Erro ao limpar logs" });
    }
  });

  // ==========================================
  // Link Diagnostics & Batch Enrichment
  // ==========================================

  interface EnrichmentProgress {
    running: boolean;
    action: string;
    total: number;
    processed: number;
    success: number;
    failed: number;
    skipped: number;
    errors: string[];
    startedAt: number;
  }

  let enrichmentProgress: EnrichmentProgress = {
    running: false,
    action: '',
    total: 0,
    processed: 0,
    success: 0,
    failed: 0,
    skipped: 0,
    errors: [],
    startedAt: 0,
  };

  interface ReconcileProgress {
    running: boolean;
    dryRun: boolean;
    phase: string; // "fetching_voalle" | "preflight_ozmap" | "processing" | "done" | "error"
    total: number;
    processed: number;
    success: number;
    already_linked: number;
    ozmap_not_found: number;
    skip: number;
    vinculate_failed: number;
    dry_run: number;
    conflict: number;
    error: number;
    results: Array<{ linkId: number; linkName: string; status: string; detail: string; voalleConnectionId?: number; linkTag?: string; oldTag?: string; ozmapFoundCode?: string; ozmapClientId?: string }>;
    errorMessage: string;
    startedAt: number;
    finishedAt: number;
  }

  let reconcileProgress: ReconcileProgress = {
    running: false, dryRun: false, phase: "done",
    total: 0, processed: 0, success: 0, already_linked: 0,
    ozmap_not_found: 0, skip: 0, vinculate_failed: 0, dry_run: 0, conflict: 0, error: 0,
    results: [], errorMessage: "", startedAt: 0, finishedAt: 0,
  };

  app.get("/api/admin/links/diagnostics", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
    try {
      const allLinksIncludingDeleted = await db.select().from(links);
      const allLinks = allLinksIncludingDeleted.filter(l => !l.deletedAt);

      const allClients = await db.select().from(clientsTable);
      const clientMap = new Map(allClients.map(c => [c.id, c]));

      const missingIp = allLinks.filter(l => !l.monitoredIp);
      const missingInterface = allLinks.filter(l => l.snmpInterfaceIndex === null || l.snmpInterfaceIndex === undefined);
      const missingConcentrator = allLinks.filter(l => !l.concentratorId && (l.authType === 'pppoe' || l.trafficSourceType === 'concentrator'));
      const missingPppoeUser = allLinks.filter(l => !l.pppoeUser && l.authType === 'pppoe');
      const missingSnmpProfile = allLinks.filter(l => !l.snmpProfileId);
      const missingVoalleTag = allLinks.filter(l => !l.voalleContractTagId);
      const missingOptical = allLinks.filter(l => l.linkType === 'gpon' && (!l.opticalMonitoringEnabled || !l.oltId));
      const missingCoordinates = allLinks.filter(l => !l.latitude || !l.longitude);
      const missingOltAssignment = allLinks.filter(l => l.linkType === 'gpon' && !l.oltId && l.voalleAccessPointId);
      const missingOnuId = allLinks.filter(l => l.oltId && l.equipmentSerialNumber && !l.onuId);
      const linksWithTag = allLinks.filter(l => l.voalleContractTagServiceTag || l.ozmapTag);
      const linksWithoutTag = allLinks.filter(l => !l.voalleContractTagServiceTag && !l.ozmapTag);
      const linksNoRoute = linksWithTag.filter(l => l.ozmapNoRoute === true);
      const linksWithData = linksWithTag.filter(l => l.ozmapArrivingPotency);
      const missingOzmapData = linksWithTag.filter(l => !l.ozmapArrivingPotency);
      // Etiqueta não encontrada no OZmap: tem etiqueta, sem dados, sem flag de "sem rota" (HTTP 404 ou nunca sincronizado)
      const linksNotFound = missingOzmapData.filter(l => !l.ozmapNoRoute);

      const clientsWithoutPortal = allClients.filter(c => c.cnpj && (!c.voallePortalUsername || !c.voallePortalPassword));
      const linksOfClientsWithoutPortal = allLinks.filter(l => {
        const client = clientMap.get(l.clientId);
        return client && client.cnpj && (!client.voallePortalUsername || !client.voallePortalPassword);
      });

      const allCpes = await db.select().from(cpes);
      const allLinkCpes = await db.select().from(linkCpes);
      const linksWithCpe = new Set(allLinkCpes.map(lc => lc.linkId));
      const missingCpe = allLinks.filter(l => l.monitoredIp && !linksWithCpe.has(l.id));

      const hasIpNoPppoe = allLinks.filter(l => l.pppoeUser && !l.monitoredIp);
      const hasIpNoInterface = allLinks.filter(l => l.monitoredIp && (l.snmpInterfaceIndex === null || l.snmpInterfaceIndex === undefined));

      const categories = {
        missingVoalleLogin: { count: linksOfClientsWithoutPortal.length, ids: linksOfClientsWithoutPortal.map(l => l.id), label: "Clientes sem login Portal Voalle", enrichAction: "discover_voalle_login", clientCount: clientsWithoutPortal.length },
        missingIp: { count: missingIp.length, ids: missingIp.map(l => l.id), label: "Sem IP de monitoramento", enrichAction: "discover_ips", enrichable: hasIpNoPppoe.length },
        missingConcentrator: { count: missingConcentrator.length, ids: missingConcentrator.map(l => l.id), label: "Sem concentrador (tráfego)", enrichAction: "assign_concentrators" },
        missingInterface: { count: missingInterface.length, ids: missingInterface.map(l => l.id), label: "Sem interface SNMP (ifIndex)", enrichAction: "discover_interfaces", enrichable: hasIpNoInterface.length },
        missingOptical: { count: missingOptical.length, ids: missingOptical.map(l => l.id), label: "GPON sem monitoramento óptico", enrichAction: "assign_olts" },
        missingOnuId: { count: missingOnuId.length, ids: missingOnuId.map(l => l.id), label: "Sem ID da ONU (tem serial e OLT)", enrichAction: "discover_onu_ids" },
        missingOltAssignment: { count: missingOltAssignment.length, ids: missingOltAssignment.map(l => l.id), label: "Sem OLT atribuída (tem AccessPoint Voalle)" },
        missingCpe: { count: missingCpe.length, ids: missingCpe.map(l => l.id), label: "Sem CPE cadastrado", enrichAction: "create_cpes" },
        missingOzmapData: { count: missingOzmapData.length, ids: missingOzmapData.map(l => l.id), label: "Sem documentação OZmap", enrichAction: "sync_ozmap", enrichable: missingOzmapData.length, withTag: linksWithTag.length, withoutTag: linksWithoutTag.length, withData: linksWithData.length, noRoute: linksNoRoute.length, notFound: linksNotFound.length },
        missingPppoeUser: { count: missingPppoeUser.length, ids: missingPppoeUser.map(l => l.id), label: "Sem usuário PPPoE" },
        missingSnmpProfile: { count: missingSnmpProfile.length, ids: missingSnmpProfile.map(l => l.id), label: "Sem perfil SNMP" },
        missingVoalleTag: { count: missingVoalleTag.length, ids: missingVoalleTag.map(l => l.id), label: "Sem tag Voalle (contractTagId)", enrichAction: "discover_voalle" },
        missingCoordinates: { count: missingCoordinates.length, ids: missingCoordinates.map(l => l.id), label: "Sem coordenadas" },
      };

      const criticalIssues = new Set([...missingIp, ...missingInterface, ...missingConcentrator].map(l => l.id));

      // Links sem nenhum dado de conexão (sem IP + sem PPPoE + sem concentrador = provavelmente roteadores mesh/residencial)
      const noConnectionData = allLinks.filter(l =>
        !l.monitoredIp && !l.pppoeUser && !l.concentratorId && l.monitoringEnabled !== false
      );

      // Links com monitoramento desativado
      const disabledMonitoring = allLinks.filter(l => l.monitoringEnabled === false);

      const contractStatusSummary = {
        active: allLinks.filter(l => l.contractStatus === "active" || !l.contractStatus).length,
        blocked: allLinks.filter(l => l.contractStatus === "blocked").length,
        cancelled: allLinks.filter(l => l.contractStatus === "cancelled").length,
        unknown: allLinks.filter(l => l.contractStatus === "unknown").length,
        deleted: allLinksIncludingDeleted.filter(l => l.deletedAt).length,
      };

      res.json({
        totalLinks: allLinks.length,
        healthyLinks: allLinks.length - criticalIssues.size,
        categories,
        contractStatusSummary,
        noConnectionData: { count: noConnectionData.length, ids: noConnectionData.map(l => l.id) },
        disabledMonitoring: { count: disabledMonitoring.length, ids: disabledMonitoring.map(l => l.id) },
      });
    } catch (error: any) {
      console.error("[Diagnostics] Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Relatório CSV de divergências de etiqueta OZmap (streaming para evitar timeout)
  app.get("/api/admin/ozmap-tag-divergences.csv", requireAuth, requireSuperAdmin, async (_req: Request, res: Response) => {
    const ozmapIntegrations = await db.select().from(externalIntegrations).where(eq(externalIntegrations.provider, "ozmap")).limit(1);
    if (ozmapIntegrations.length === 0 || !ozmapIntegrations[0].apiKey || !ozmapIntegrations[0].apiUrl || !ozmapIntegrations[0].isActive) {
      return res.status(400).json({ error: "Integração OZmap não configurada ou inativa" });
    }
    const ozmapConfig = ozmapIntegrations[0];
    let baseUrl = ozmapConfig.apiUrl!.replace(/\/+$/, "");
    if (baseUrl.endsWith("/api/v2")) baseUrl = baseUrl.slice(0, -7);
    const apiKey = ozmapConfig.apiKey!;
    const headers = { "Accept": "application/json", "Authorization": apiKey };

    const allLinks = await db.select().from(links).where(eq(links.contractStatus, "active"));
    const allClients = await db.select({ id: clientsTable.id, name: clientsTable.name }).from(clientsTable);
    const clientMap = new Map(allClients.map(c => [c.id, c.name]));

    // Candidatos para divergência: links com etiqueta Voalle E com serial ou PPPoE para validar cruzado
    // Também inclui links SEM etiqueta mas com serial/PPPoE (etiqueta ausente)
    const candidates = allLinks.filter(l =>
      l.equipmentSerialNumber || l.voalleLogin
    ).slice(0, 300);

    console.log(`[OZmap Divergences] Verificando ${candidates.length} links candidatos (streaming)...`);

    const now = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="divergencias-ozmap-${now}.csv"`);
    res.setHeader("X-Accel-Buffering", "no");

    // Escrever BOM + cabeçalho imediatamente (browser começa o download)
    const escape = (v: string | null | undefined) => `"${(v || "").replace(/"/g, '""')}"`;
    res.write("\uFEFF");
    res.write("ID;Nome do Link;Cliente;Tag no Sistema;Tag encontrada no OZmap;Tipo de divergência;Método de busca;Serial ONU;Login PPPoE\r\n");

    let rowCount = 0;

    for (const link of candidates) {
      try {
        const tagSistema = link.voalleContractTagServiceTag || "";
        let tagOzmap: string | null = null;
        let method = "";

        // Busca 1: por serial de ONU (mais confiável)
        if (link.equipmentSerialNumber) {
          const filter = encodeURIComponent(JSON.stringify([
            { property: "onu.serial_number", value: link.equipmentSerialNumber, operator: "=" }
          ]));
          const r = await fetch(`${baseUrl}/api/v2/ftth-clients?filter=${filter}&limit=3`, { headers });
          if (r.ok) {
            const d = await r.json();
            const rows: any[] = d.rows || (Array.isArray(d) ? d : []);
            if (rows.length === 1 && rows[0].code) {
              tagOzmap = rows[0].code;
              method = `serial:${link.equipmentSerialNumber}`;
            }
          }
        }

        // Busca 2: por PPPoE (se serial não encontrou ou não existe)
        if (!tagOzmap && link.voalleLogin) {
          const filter = encodeURIComponent(JSON.stringify([
            { property: "onu.user_PPPoE", value: link.voalleLogin, operator: "=" }
          ]));
          const r = await fetch(`${baseUrl}/api/v2/ftth-clients?filter=${filter}&limit=3`, { headers });
          if (r.ok) {
            const d = await r.json();
            const rows: any[] = d.rows || (Array.isArray(d) ? d : []);
            if (rows.length >= 1 && rows[0].code) {
              tagOzmap = rows[0].code;
              method = `pppoe:${link.voalleLogin}`;
            }
          }
        }

        // Sem match no OZmap → não é divergência conhecida
        if (!tagOzmap) continue;

        // Tags iguais → sem divergência
        if (tagSistema === tagOzmap) continue;

        const tipoDivergencia = !tagSistema
          ? "Etiqueta ausente no sistema (encontrada no OZmap)"
          : "Etiqueta divergente";

        const clientName = clientMap.get(link.clientId) || `Cliente #${link.clientId}`;

        res.write([
          link.id,
          escape(link.name),
          escape(clientName),
          escape(tagSistema),
          escape(tagOzmap),
          escape(tipoDivergencia),
          escape(method),
          escape(link.equipmentSerialNumber),
          escape(link.voalleLogin),
        ].join(";") + "\r\n");

        rowCount++;
      } catch (e: any) {
        console.error(`[OZmap Divergences] Erro no link ${link.id}:`, e.message);
      }
    }

    console.log(`[OZmap Divergences] Relatório concluído: ${rowCount} divergências encontradas em ${candidates.length} links`);
    res.end();
  });

  // Relatório CSV: etiquetas com dado ausente no OZmap (simples, sem chamadas externas)
  app.get("/api/admin/ozmap-missing.csv", requireAuth, requireSuperAdmin, async (_req: Request, res: Response) => {
    const allLinks = await db.select().from(links).where(
      and(
        eq(links.contractStatus, "active"),
        isNotNull(links.voalleContractTagServiceTag),
        isNull(links.ozmapArrivingPotency),
        isNull(links.deletedAt)
      )
    );

    const allClients = await db.select({
      id: clientsTable.id,
      name: clientsTable.name,
    }).from(clientsTable);
    const clientMap = new Map(allClients.map(c => [c.id, c.name]));

    const escape = (v: string | null | undefined) => `"${(v || "").replace(/"/g, '""')}"`;
    const now = new Date().toISOString().slice(0, 10);

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="etiquetas-sem-ozmap-${now}.csv"`);

    let csv = "\uFEFF"; // BOM UTF-8
    csv += "ID;Nome do Link;Cliente;Endereço;Complemento;Etiqueta OZmap;Status do Contrato\r\n";

    for (const link of allLinks) {
      const clientName = clientMap.get(link.clientId) || `Cliente #${link.clientId}`;
      csv += [
        link.id,
        escape(link.name),
        escape(clientName),
        escape(link.address),
        escape(link.addressComplement),
        escape(link.voalleContractTagServiceTag),
        escape(link.contractStatus),
      ].join(";") + "\r\n";
    }

    console.log(`[OZmap Missing] Relatório gerado: ${allLinks.length} links sem dados OZmap`);
    res.send(csv);
  });

  // Relatório CSV: links sem etiqueta OZmap
  app.get("/api/admin/ozmap-no-tag.csv", requireAuth, requireSuperAdmin, async (_req: Request, res: Response) => {
    const allLinks = await db.select().from(links).where(
      and(
        eq(links.contractStatus, "active"),
        isNull(links.voalleContractTagServiceTag),
        isNull(links.ozmapTag),
        isNull(links.deletedAt)
      )
    );

    const allClients = await db.select({ id: clientsTable.id, name: clientsTable.name }).from(clientsTable);
    const clientMap = new Map(allClients.map(c => [c.id, c.name]));

    const escape = (v: string | null | undefined) => `"${(v || "").replace(/"/g, '""')}"`;
    const now = new Date().toISOString().slice(0, 10);

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="links-sem-etiqueta-ozmap-${now}.csv"`);

    let csv = "\uFEFF";
    csv += "ID;Nome do Link;Cliente;Endereço;Tipo de Link;PPPoE;Serial\r\n";

    for (const link of allLinks) {
      const clientName = clientMap.get(link.clientId) || `Cliente #${link.clientId}`;
      csv += [
        link.id,
        escape(link.name),
        escape(clientName),
        escape(link.address),
        escape(link.linkType),
        escape(link.pppoeUser || link.voalleLogin),
        escape(link.equipmentSerialNumber),
      ].join(";") + "\r\n";
    }

    console.log(`[OZmap No Tag] Relatório gerado: ${allLinks.length} links sem etiqueta OZmap`);
    res.send(csv);
  });

  // Relatório CSV: links com etiqueta mas sem rota de fibra (HTTP 422 do OZmap)
  app.get("/api/admin/ozmap-no-route.csv", requireAuth, requireSuperAdmin, async (_req: Request, res: Response) => {
    const allLinks = await db.select().from(links).where(
      and(
        isNull(links.deletedAt),
        eq(links.ozmapNoRoute, true)
      )
    );

    const allClients = await db.select({ id: clientsTable.id, name: clientsTable.name }).from(clientsTable);
    const clientMap = new Map(allClients.map(c => [c.id, c.name]));

    const escape = (v: string | null | undefined) => `"${(v || "").replace(/"/g, '""')}"`;
    const now = new Date().toISOString().slice(0, 10);

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="links-sem-rota-fibra-${now}.csv"`);

    let csv = "\uFEFF";
    csv += "ID;Nome do Link;Cliente;Endereço;Etiqueta OZmap;Status do Contrato;Última Sincronização\r\n";

    for (const link of allLinks) {
      const clientName = clientMap.get(link.clientId) || `Cliente #${link.clientId}`;
      const tag = link.voalleContractTagServiceTag || link.ozmapTag || "";
      const lastSync = link.ozmapLastSync ? new Date(link.ozmapLastSync).toLocaleDateString("pt-BR") : "Nunca";
      csv += [
        link.id,
        escape(link.name),
        escape(clientName),
        escape(link.address),
        escape(tag),
        escape(link.contractStatus),
        escape(lastSync),
      ].join(";") + "\r\n";
    }

    console.log(`[OZmap No Route] Relatório gerado: ${allLinks.length} links sem rota de fibra`);
    res.send(csv);
  });

  // Relatório CSV: links com etiqueta mas não encontrados no OZmap (sem dados e sem ozmapNoRoute)
  app.get("/api/admin/ozmap-not-found.csv", requireAuth, requireSuperAdmin, async (_req: Request, res: Response) => {
    const allLinks = await db.select().from(links).where(
      and(
        isNull(links.deletedAt),
        isNull(links.ozmapArrivingPotency),
        or(
          isNotNull(links.voalleContractTagServiceTag),
          isNotNull(links.ozmapTag)
        ),
        or(
          eq(links.ozmapNoRoute, false),
          isNull(links.ozmapNoRoute)
        )
      )
    );

    const allClients = await db.select({ id: clientsTable.id, name: clientsTable.name }).from(clientsTable);
    const clientMap = new Map(allClients.map(c => [c.id, c.name]));

    const escape = (v: string | null | undefined) => `"${(v || "").replace(/"/g, '""')}"`;
    const now = new Date().toISOString().slice(0, 10);

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="links-etiqueta-nao-encontrada-${now}.csv"`);

    let csv = "\uFEFF";
    csv += "ID;Nome do Link;Cliente;Endereço;Etiqueta OZmap;Status do Contrato;Última Sincronização OZmap;Serial ONU;Login PPPoE\r\n";

    for (const link of allLinks) {
      const clientName = clientMap.get(link.clientId) || `Cliente #${link.clientId}`;
      const tag = link.voalleContractTagServiceTag || link.ozmapTag || "";
      const lastSync = link.ozmapLastSync ? new Date(link.ozmapLastSync).toLocaleDateString("pt-BR") : "Nunca";
      csv += [
        link.id,
        escape(link.name),
        escape(clientName),
        escape(link.address),
        escape(tag),
        escape(link.contractStatus),
        escape(lastSync),
        escape(link.equipmentSerialNumber),
        escape(link.pppoeUser || link.voalleLogin),
      ].join(";") + "\r\n";
    }

    console.log(`[OZmap Not Found] Relatório gerado: ${allLinks.length} links com etiqueta não encontrada no OZmap`);
    res.send(csv);
  });

  // ========== Diagnósticos Voalle ↔ OZmap ==========

  // GET /api/admin/voalle-ozmap-reconcile/diagnostic/deleted
  // Retorna amostra bruta das conexões excluídas do Voalle Map API + mapa de etiquetas resolvido
  app.get("/api/admin/voalle-ozmap-reconcile/diagnostic/deleted", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 20, 200);
      const voalleIntegration = await storage.getErpIntegrationByProvider("voalle");
      if (!voalleIntegration || !voalleIntegration.isActive) {
        return res.status(404).json({ error: "Integração Voalle não configurada ou inativa" });
      }

      const voalleAdapter = configureErpAdapter(voalleIntegration) as any;
      if (!voalleAdapter?.getAllDeletedConnectionsPaged) {
        return res.status(500).json({ error: "Adapter não suporta getAllDeletedConnectionsPaged" });
      }

      // Buscar mapa de etiquetas id→code
      const tagMap: Map<number, string> = await voalleAdapter.getAllServiceTagsMap(500).catch(() => new Map<number, string>());

      // Buscar deletadas (1 página = limit registros)
      const rawDeleted: any[] = await voalleAdapter.getAllDeletedConnectionsPaged(limit);

      const sample = rawDeleted.slice(0, limit).map((conn: any) => {
        const rawTag = conn.serviceTag;
        const rawTagStr = rawTag != null ? String(rawTag) : null;
        const isNumeric = !!rawTagStr && /^\d+$/.test(rawTagStr.trim());
        const resolved = isNumeric ? (tagMap.get(Number(rawTagStr)) ?? null) : rawTagStr;
        return {
          id: conn.id,
          user: conn.user,
          serviceTag_raw: rawTag,
          serviceTag_isNumeric: isNumeric,
          serviceTag_resolved: resolved,
          equipmentSerialNumber: conn.equipmentSerialNumber,
          integrationCodeMap: conn.integrationCodeMap,
          integrationCode: conn.integrationCode,
          client: conn.client ? { id: conn.client.id, name: conn.client.name } : null,
          status: conn.status,
        };
      });

      res.json({
        totalFetched: rawDeleted.length,
        tagMapSize: tagMap.size,
        tagMapSample: [...tagMap.entries()].slice(0, 10).map(([id, code]) => ({ id, code })),
        sample,
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // GET /api/admin/voalle-ozmap-reconcile/diagnostic/ozmap
  // Retorna amostra bruta dos clientes OZmap (ftth-clients) com estrutura de campos
  app.get("/api/admin/voalle-ozmap-reconcile/diagnostic/ozmap", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 10, 50);
      const ozmapIntegrations = await db.select().from(externalIntegrations)
        .where(and(eq(externalIntegrations.provider, "ozmap"), eq(externalIntegrations.isActive, true)))
        .limit(1);
      if (!ozmapIntegrations.length) return res.status(404).json({ error: "Integração OZmap não configurada ou inativa" });

      const ozmapConfig = ozmapIntegrations[0];
      let baseUrl = (ozmapConfig.apiUrl || "").replace(/\/+$/, "");
      if (baseUrl.endsWith("/api/v2")) baseUrl = baseUrl.slice(0, -7);
      const headers = { "Accept": "application/json", "Authorization": ozmapConfig.apiKey! };

      const r = await fetch(`${baseUrl}/api/v2/ftth-clients?limit=${limit}&page=0`, { headers });
      if (!r.ok) return res.status(502).json({ error: `OZmap HTTP ${r.status}` });
      const data = await r.json() as any;
      const rows: any[] = data?.rows ?? (Array.isArray(data) ? data : []);

      // Detectar qual campo o OZmap usa para coordenadas geográficas
      const GEO_CANDIDATE_FIELDS = ["geopoint","geoCoord","location","coordinates","geo","geometry","position"];
      const geoFieldsFound: Record<string, number> = {};
      let withGeoCount = 0;
      for (const row of rows) {
        for (const f of GEO_CANDIDATE_FIELDS) {
          if (row[f] != null) geoFieldsFound[f] = (geoFieldsFound[f] || 0) + 1;
        }
        const hasFlatGeo = row.latitude != null && row.longitude != null;
        if (hasFlatGeo) geoFieldsFound["latitude/longitude"] = (geoFieldsFound["latitude/longitude"] || 0) + 1;
        const hasAnyGeo = GEO_CANDIDATE_FIELDS.some(f => row[f] != null) || hasFlatGeo;
        if (hasAnyGeo) withGeoCount++;
      }

      res.json({
        total: data?.total ?? rows.length,
        sampleSize: rows.length,
        // Análise de campos geográficos — mostra qual campo o OZmap usa para coordenadas
        geoAnalysis: {
          withGeoCount,
          fieldsFound: geoFieldsFound,
          pctWithGeo: rows.length > 0 ? Math.round(withGeoCount / rows.length * 100) + "%" : "n/a",
        },
        // Registro bruto completo do primeiro resultado — para mapear campos reais da API OZmap
        firstRecordRaw: rows[0] ?? null,
        // Resumo dos campos-chave de cada registro
        sample: rows.map((row: any) => ({
          _id: row._id || row.id,
          code: row.code,
          name: row.name,
          integrationCode: row.integrationCode,
          onu_serialNumber: row.onu?.serial_number,
          onu_userPPPoE: row.onu?.user_PPPoE,
          onu_keys: row.onu ? Object.keys(row.onu) : [],
          // Extrai coordenadas de qualquer campo candidato
          geo_raw: GEO_CANDIDATE_FIELDS.reduce((acc: any, f) => { if (row[f]) acc[f] = row[f]; return acc; }, {}),
          topLevelKeys: Object.keys(row),
        })),
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ========== Etiquetas Voalle — Importação CSV ==========
  // GET: retorna estatísticas do mapeamento importado
  app.get("/api/admin/voalle-service-tags/stats", requireAuth, requireSuperAdmin, async (_req: Request, res: Response) => {
    try {
      const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(voalleServiceTags);
      const latest = await db.select({ importedAt: voalleServiceTags.importedAt })
        .from(voalleServiceTags).orderBy(sql`imported_at desc`).limit(1);
      res.json({ count, lastImportedAt: latest[0]?.importedAt ?? null });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  // POST: importa um lote de etiquetas Voalle já parseadas pelo browser
  // Corpo JSON: { rows: [{id, serviceTag, title?, clientId?, contractId?, status?}], skippedInChunk?: number }
  // O browser parseia o CSV, extrai só os campos necessários e envia em lotes de 500 linhas
  app.post(
    "/api/admin/voalle-service-tags/import",
    requireAuth, requireSuperAdmin,
    async (req: Request, res: Response) => {
      try {
        const rows: Array<{ id: number; serviceTag: string; title?: string | null; clientId?: number | null; contractId?: number | null; status?: number | null }> = req.body?.rows ?? [];
        const skippedInChunk: number = req.body?.skippedInChunk ?? 0;

        if (!Array.isArray(rows) || rows.length === 0) {
          return res.status(400).json({ error: "Nenhuma linha válida no lote" });
        }

        const now = new Date();
        const batch = rows.map(r => ({
          id:         Number(r.id),
          serviceTag: String(r.serviceTag),
          title:      r.title ?? null,
          clientId:   r.clientId ?? null,
          contractId: r.contractId ?? null,
          status:     r.status ?? null,
          importedAt: now,
        })).filter(r => r.id && r.serviceTag);

        if (batch.length === 0) {
          return res.status(400).json({ error: "Nenhuma linha válida após validação" });
        }

        await db.insert(voalleServiceTags).values(batch)
          .onConflictDoUpdate({
            target: voalleServiceTags.id,
            set: {
              serviceTag: sql`excluded.service_tag`,
              title:      sql`excluded.title`,
              clientId:   sql`excluded.client_id`,
              contractId: sql`excluded.contract_id`,
              status:     sql`excluded.status`,
              importedAt: sql`excluded.imported_at`,
            },
          });

        res.json({ imported: batch.length, skipped: skippedInChunk });
      } catch (e) {
        console.error("[VoalleServiceTags] Erro na importação de lote:", e);
        res.status(500).json({ error: String(e) });
      }
    }
  );

  // ========== Reconciliação Voalle ↔ OZmap ==========
  app.get("/api/admin/voalle-ozmap-reconcile/status", requireAuth, requireSuperAdmin, (_req: Request, res: Response) => {
    res.json(reconcileProgress);
  });

  app.post("/api/admin/voalle-ozmap-reconcile", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
    if (reconcileProgress.running) {
      return res.status(409).json({ error: "Reconciliação já em andamento", progress: reconcileProgress });
    }

    const { linkIds, dryRun = false } = req.body as { linkIds?: number[]; dryRun?: boolean };

    // Voalle usa tabela erp_integrations
    const voalleIntegration = await storage.getErpIntegrationByProvider("voalle");
    if (!voalleIntegration || !voalleIntegration.isActive) {
      return res.status(400).json({ error: "Integração Voalle não configurada ou inativa" });
    }

    // OZmap usa tabela external_integrations
    const ozmapIntegrations = await db.select().from(externalIntegrations)
      .where(and(eq(externalIntegrations.provider, "ozmap"), eq(externalIntegrations.isActive, true)))
      .limit(1);
    if (ozmapIntegrations.length === 0) {
      return res.status(400).json({ error: "Integração OZmap não configurada ou inativa" });
    }

    const voalleAdapter = configureErpAdapter(voalleIntegration) as any;
    if (!voalleAdapter?.getAllConnections) {
      return res.status(500).json({ error: "Adapter Voalle não suporta listagem de conexões Map API" });
    }

    // Inicializar progresso e responder IMEDIATAMENTE (evita timeout nginx de 60s)
    reconcileProgress = {
      running: true, dryRun, phase: "preflight_ozmap",
      total: 0, processed: 0, success: 0, already_linked: 0,
      ozmap_not_found: 0, skip: 0, vinculate_failed: 0, dry_run: 0, conflict: 0, error: 0,
      results: [], errorMessage: "", startedAt: Date.now(), finishedAt: 0,
    };
    res.json({ started: true, dryRun });

    // Todo o processamento acontece em background (IIFE async)
    (async () => {
    try {

    const ozmapConfig = ozmapIntegrations[0];
    let ozmapBaseUrl = ozmapConfig.apiUrl!.replace(/\/+$/, "");
    if (ozmapBaseUrl.endsWith("/api/v2")) ozmapBaseUrl = ozmapBaseUrl.slice(0, -7);
    const ozmapHeaders = { "Accept": "application/json", "Authorization": ozmapConfig.apiKey! };

    // Helpers (definidos antes do pre-flight para poder reutilizar fetchWithTimeout)
    const haversineKm = (lat1: number, lon1: number, lat2: number, lon2: number) => {
      const R = 6371;
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };

    const fetchWithTimeout = (url: string, opts: RequestInit, timeoutMs = 12000) => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(t));
    };

    const pLimit = async <T>(tasks: (() => Promise<T>)[], concurrency: number): Promise<T[]> => {
      const results: T[] = [];
      let i = 0;
      const run = async (): Promise<void> => {
        while (i < tasks.length) {
          const idx = i++;
          results[idx] = await tasks[idx]();
        }
      };
      await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, run));
      return results;
    };

    // Pre-flight: verificar conectividade OZmap antes de processar
    try {
      const pingResp = await fetchWithTimeout(`${ozmapBaseUrl}/api/v2/box-types?page=1&limit=1`, { headers: ozmapHeaders }, 8000);
      if (!pingResp.ok) {
        reconcileProgress.phase = "error";
        reconcileProgress.errorMessage = `OZmap retornou HTTP ${pingResp.status} — verifique se o token JWT está válido`;
        reconcileProgress.running = false;
        reconcileProgress.finishedAt = Date.now();
        return;
      }
    } catch (e) {
      reconcileProgress.phase = "error";
      reconcileProgress.errorMessage = `Não foi possível conectar ao OZmap: ${e instanceof Error ? e.message : String(e)}`;
      reconcileProgress.running = false;
      reconcileProgress.finishedAt = Date.now();
      return;
    }

    // Buscar links afetados: com tag mas sem dados OZmap (potência null e ozmapNoRoute != true)
    let candidateLinks;
    if (linkIds && linkIds.length > 0) {
      candidateLinks = await db.select().from(links).where(
        and(isNull(links.deletedAt), sql`${links.id} = ANY(${linkIds})`)
      );
    } else {
      candidateLinks = await db.select().from(links).where(
        and(
          isNull(links.deletedAt),
          isNull(links.ozmapArrivingPotency),
          or(isNotNull(links.voalleContractTagServiceTag), isNotNull(links.ozmapTag)),
          or(eq(links.ozmapNoRoute, false), isNull(links.ozmapNoRoute))
        )
      );
    }

    // Separar links com e sem dados suficientes
    type LinkInfo = { link: typeof candidateLinks[0]; pppoe: string | null; oldTag: string | null; serial: string | null };
    const linkInfos: LinkInfo[] = candidateLinks.map(link => ({
      link,
      pppoe: link.pppoeUser || link.voalleLogin || null,
      oldTag: link.ozmapTag || link.voalleContractTagServiceTag || null,
      serial: link.equipmentSerialNumber || null,
    }));

    const results: Array<{
      linkId: number; linkName: string; status: string; detail: string;
      voalleConnectionId?: number; linkTag?: string; oldTag?: string; ozmapFoundCode?: string; ozmapClientId?: string;
    }> = [];

    const toProcess: LinkInfo[] = [];
    for (const li of linkInfos) {
      if (!li.pppoe && !li.oldTag && !li.serial) {
        results.push({ linkId: li.link.id, linkName: li.link.name, status: "skip", detail: "Sem PPPoE, tag ou serial para busca" });
      } else {
        toProcess.push(li);
      }
    }

    if (toProcess.length === 0) {
      reconcileProgress.phase = "done";
      reconcileProgress.running = false;
      reconcileProgress.finishedAt = Date.now();
      reconcileProgress.total = results.length;
      reconcileProgress.skip = results.length;
      reconcileProgress.results = results;
      return;
    }

    // FASE 1 — Buscar TODAS as conexões Voalle (ativas + excluídas) em paralelo
    reconcileProgress.phase = "fetching_voalle";
    console.log(`[OZmap Reconcile] Buscando todas as conexões Voalle (ativas + excluídas)...`);

    let voalleActive: any[] = [];
    let voalleDeleted: any[] = [];
    try {
      [voalleActive, voalleDeleted] = await Promise.all([
        voalleAdapter.getAllConnections(),
        voalleAdapter.getAllDeletedConnectionsPaged(500), // paginado — garante todos os registros
      ]);
    } catch (err) {
      console.error("[OZmap Reconcile] Erro ao buscar conexões Voalle:", err);
      reconcileProgress.phase = "error";
      reconcileProgress.errorMessage = `Falha ao consultar Voalle Map API: ${err instanceof Error ? err.message : String(err)}`;
      reconcileProgress.running = false;
      reconcileProgress.finishedAt = Date.now();
      return;
    }

    // Mesclagem: ativas têm prioridade sobre excluídas (ativas sobrescrevem pela mesma chave)
    const voalleAllConns = [...voalleDeleted, ...voalleActive];
    console.log(`[OZmap Reconcile] Voalle: ${voalleActive.length} ativas, ${voalleDeleted.length} excluídas → ${voalleAllConns.length} total`);

    // Indexar conexões Voalle — ativos e inativos em maps separados para cruzamento posterior
    // Estratégia: ativo SEM vínculo OZmap → buscar inativo do mesmo cliente para herdar serviceTag/integrationCodeMap
    const activeByUser   = new Map<string, any>();
    const activeByTag    = new Map<string, any>();
    const activeBySerial = new Map<string, any>();
    for (const conn of voalleActive) {
      if (conn.user)                    activeByUser.set(conn.user.toLowerCase(), conn);
      if (conn.serviceTag)              activeByTag.set(conn.serviceTag.toUpperCase(), conn);
      if (conn.equipmentSerialNumber)   activeBySerial.set(conn.equipmentSerialNumber.toUpperCase(), conn);
    }
    const deletedByUser     = new Map<string, any>();
    const deletedByTag      = new Map<string, any>();
    const deletedBySerial   = new Map<string, any>();
    // clientId → lista de contratos inativos do mesmo cliente (um cliente pode ter vários contratos cancelados)
    const deletedByClientId = new Map<number, any[]>();
    for (const conn of voalleDeleted) {
      if (conn.user)                    deletedByUser.set(conn.user.toLowerCase(), conn);
      // Indexar pelo código OZmap real (_resolvedServiceTag), não pelo ID numérico bruto
      const resolvedTag = conn._resolvedServiceTag;
      if (resolvedTag)                  deletedByTag.set(resolvedTag.toUpperCase(), conn);
      if (conn.equipmentSerialNumber)   deletedBySerial.set(conn.equipmentSerialNumber.toUpperCase(), conn);
      if (conn.client?.id) {
        const list = deletedByClientId.get(conn.client.id) ?? [];
        list.push(conn);
        deletedByClientId.set(conn.client.id, list);
      }
    }
    // Index unificado (ativos têm prioridade sobre inativos) para lookup rápido
    const voalleByUser   = new Map<string, any>([...deletedByUser,   ...activeByUser]);
    const voalleByTag    = new Map<string, any>([...deletedByTag,    ...activeByTag]);
    const voalleBySerial = new Map<string, any>([...deletedBySerial, ...activeBySerial]);

    // Detectar integrationCodeMap "falso" — mesmo valor repetido em N+ conexões indica atribuição em massa
    // (ex: Voalle atribui um ID padrão/placeholder para todas as conexões sem vínculo real)
    const integrationCodeMapCount = new Map<string, number>();
    for (const conn of voalleAllConns) {
      const icm: string | null = conn.integrationCodeMap ?? null;
      if (icm) integrationCodeMapCount.set(icm, (integrationCodeMapCount.get(icm) ?? 0) + 1);
    }
    // Threshold: se o mesmo integrationCodeMap aparece em 4+ conexões, é falso
    const BOGUS_ICM_THRESHOLD = 4;
    const bogusIntegrationCodeMaps = new Set<string>(
      [...integrationCodeMapCount.entries()]
        .filter(([, count]) => count >= BOGUS_ICM_THRESHOLD)
        .map(([icm]) => icm)
    );
    if (bogusIntegrationCodeMaps.size > 0) {
      console.log(`[OZmap Reconcile] Detectados ${bogusIntegrationCodeMaps.size} integrationCodeMap(s) falsos (≥${BOGUS_ICM_THRESHOLD} conexões): ${[...bogusIntegrationCodeMaps].join(", ")}`);
    }

    // Mapa tagId (número) → serviceTag real (código OZmap alfanumérico)
    // O endpoint Voalle /connection/all/deleted/paged retorna o ID numérico da etiqueta
    // no campo "serviceTag", não o código OZmap real (ex: "261" = id da etiqueta cujo code é "PT2R5Q3A").
    // Fonte 1: API Voalle /contractservicetagspaged (contém todos os IDs + codes)
    // Fonte 2: banco de dados local (fallback para IDs já conhecidos)
    let voalleTagIdToCode = new Map<number, string>();
    try {
      voalleTagIdToCode = await voalleAdapter.getAllServiceTagsMap(500);
    } catch (err) {
      console.warn(`[OZmap Reconcile] Falha ao buscar mapa de etiquetas do Voalle, usando DB como fallback:`, err);
    }
    // Fonte 2: complementar com dados do banco de links (IDs já conhecidos)
    {
      const tagRows = await db.select({
        tagId:  links.voalleContractTagId,
        tagCode: links.voalleContractTagServiceTag,
      }).from(links)
        .where(and(isNotNull(links.voalleContractTagId), isNotNull(links.voalleContractTagServiceTag)));
      for (const row of tagRows) {
        if (row.tagId && row.tagCode && !voalleTagIdToCode.has(row.tagId)) {
          voalleTagIdToCode.set(row.tagId, row.tagCode);
        }
      }
    }
    // Fonte 3: tabela voalle_service_tags populada via importação de CSV
    // Contém mapeamento completo exportado diretamente do banco Voalle
    // Preenche IDs que a API (/contractservicetagspaged) não retorna (ex: contratos sem CNPJ)
    {
      const csvTagRows = await db.select({
        id:         voalleServiceTags.id,
        serviceTag: voalleServiceTags.serviceTag,
      }).from(voalleServiceTags);
      let addedFromCsv = 0;
      for (const row of csvTagRows) {
        if (row.id && row.serviceTag && !voalleTagIdToCode.has(row.id)) {
          voalleTagIdToCode.set(row.id, row.serviceTag);
          addedFromCsv++;
        }
      }
      if (addedFromCsv > 0) {
        console.log(`[OZmap Reconcile] +${addedFromCsv} entradas adicionadas pelo CSV importado (Fonte 3)`);
      }
      console.log(`[OZmap Reconcile] Mapa tagId→code final: ${voalleTagIdToCode.size} entradas (API + links + CSV)`);
    }

    // Resolver serviceTag de conexão deletada: se for ID numérico, converte para código OZmap real
    const resolveDeletedServiceTag = (tag: string | null | undefined): string | null => {
      if (!tag || !tag.trim()) return null;
      if (/^\d+$/.test(tag.trim())) {
        const resolved = voalleTagIdToCode.get(Number(tag));
        if (resolved) console.log(`[OZmap Reconcile] Resolveu tagId=${tag} → code=${resolved}`);
        return resolved ?? null; // ID não resolvível → descartar (não usar ID numérico bruto como código)
      }
      return tag; // já é código alfanumérico, usar diretamente
    };

    // Aplicar resolução em todas as conexões deletadas antes de indexar
    for (const conn of voalleDeleted) {
      conn._resolvedServiceTag = resolveDeletedServiceTag(conn.serviceTag);
    }

    // FASE 1.5 — Download em massa de TODOS os clientes OZmap (para evitar filtros por campo aninhado)
    // O OZmap suporta filtragem apenas por campos de nível raiz; campos aninhados como
    // onu.serial_number e onu.user_PPPoE NÃO funcionam na API de filtro — portanto baixamos tudo.
    reconcileProgress.phase = "fetching_ozmap";
    console.log(`[OZmap Reconcile] Baixando todos os clientes OZmap (FTTH) em massa...`);

    // Helper: extrai lat/lon de um cliente OZmap tentando vários nomes de campo
    // OZmap pode usar geopoint (GeoJSON), geoCoord, location, ou campos planos latitude/longitude
    const extractOzmapLat = (row: any): number | null => {
      const v =
        row._lat ??
        row.geopoint?.coordinates?.[1] ??
        row.geoCoord?.coordinates?.[1] ??
        row.location?.coordinates?.[1] ??
        row.coordinates?.[1] ??
        row.latitude ??
        null;
      const n = v != null ? parseFloat(String(v)) : null;
      return (n != null && !isNaN(n) && n !== 0) ? n : null;
    };
    const extractOzmapLon = (row: any): number | null => {
      const v =
        row._lon ??
        row.geopoint?.coordinates?.[0] ??
        row.geoCoord?.coordinates?.[0] ??
        row.location?.coordinates?.[0] ??
        row.coordinates?.[0] ??
        row.longitude ??
        null;
      const n = v != null ? parseFloat(String(v)) : null;
      return (n != null && !isNaN(n) && n !== 0) ? n : null;
    };

    // Indexes locais OZmap
    const ozmapById             = new Map<string, any>();  // id → cliente OZmap
    const ozmapByCode           = new Map<string, any>();  // code.toUpperCase() → cliente OZmap
    const ozmapBySerial         = new Map<string, any>();  // onu.serial_number.toUpperCase() → cliente OZmap
    const ozmapByPppoe          = new Map<string, any>();  // onu.user_PPPoE.toLowerCase() → cliente OZmap
    const ozmapByIntegrationCode = new Map<string, any>(); // integrationCode → cliente OZmap
    const ozmapWithGeo: any[] = [];                        // clientes com coordenadas válidas (lat≠0, lon≠0)

    try {
      const PAGE_SIZE = 500;
      // Busca página 0 para saber o total
      const firstUrl = `${ozmapBaseUrl}/api/v2/ftth-clients?limit=${PAGE_SIZE}&page=0`;
      const firstResp = await fetchWithTimeout(firstUrl, { headers: ozmapHeaders }, 30000);
      if (!firstResp.ok) throw new Error(`HTTP ${firstResp.status}`);
      const firstData = await firstResp.json() as any;
      const firstRows: any[] = firstData?.rows ?? (Array.isArray(firstData) ? firstData : []);
      const totalOzmap: number = firstData?.total ?? firstData?.count ?? firstRows.length;
      const totalPages = Math.ceil(totalOzmap / PAGE_SIZE);
      console.log(`[OZmap Reconcile] OZmap: total=${totalOzmap}, páginas=${totalPages}`);

      // Indexar primeira página
      const indexOzmapClient = (row: any) => {
        const id: string = row._id || row.id;
        if (!id) return;
        if (!ozmapById.has(id)) ozmapById.set(id, row);
        const code = (row.code || "").toUpperCase().trim();
        if (code) ozmapByCode.set(code, row);
        const serial = (row.onu?.serial_number || row.serialNumber || "").toUpperCase().trim();
        if (serial) ozmapBySerial.set(serial, row);
        const pppoe = (row.onu?.user_PPPoE || "").toLowerCase().trim();
        if (pppoe) ozmapByPppoe.set(pppoe, row);
        const intCode = (row.integrationCode || "").trim();
        if (intCode) ozmapByIntegrationCode.set(intCode, row);
        // Extrair coordenadas com fallback de campo
        const lat = extractOzmapLat(row);
        const lon = extractOzmapLon(row);
        if (lat !== null && lon !== null) {
          // Cachear no próprio row para evitar re-extração no loop geo
          row._lat = lat;
          row._lon = lon;
          ozmapWithGeo.push(row);
        }
      };
      for (const row of firstRows) indexOzmapClient(row);

      // Buscar páginas restantes em paralelo (máx 10 simultâneas)
      if (totalPages > 1) {
        const pageNums = Array.from({ length: totalPages - 1 }, (_, i) => i + 1);
        const CONCURRENCY = 10;
        for (let i = 0; i < pageNums.length; i += CONCURRENCY) {
          const batch = pageNums.slice(i, i + CONCURRENCY);
          await Promise.all(batch.map(async (page) => {
            const url = `${ozmapBaseUrl}/api/v2/ftth-clients?limit=${PAGE_SIZE}&page=${page}`;
            try {
              const r = await fetchWithTimeout(url, { headers: ozmapHeaders }, 30000);
              if (!r.ok) { console.warn(`[OZmap Reconcile] Página ${page} HTTP ${r.status}`); return; }
              const d = await r.json() as any;
              const rows: any[] = d?.rows ?? (Array.isArray(d) ? d : []);
              for (const row of rows) indexOzmapClient(row);
            } catch (e) {
              console.warn(`[OZmap Reconcile] Erro ao baixar página OZmap ${page}: ${e}`);
            }
          }));
        }
      }
      console.log(`[OZmap Reconcile] OZmap indexado: ${ozmapById.size} clientes (serial=${ozmapBySerial.size}, pppoe=${ozmapByPppoe.size}, code=${ozmapByCode.size}, geo=${ozmapWithGeo.length})`);
    } catch (err) {
      console.error("[OZmap Reconcile] Falha ao baixar clientes OZmap em massa:", err);
      reconcileProgress.phase = "error";
      reconcileProgress.errorMessage = `Falha ao baixar clientes OZmap: ${err instanceof Error ? err.message : String(err)}`;
      reconcileProgress.running = false;
      reconcileProgress.finishedAt = Date.now();
      return;
    }

    // FASE 2 — Processar cada link em paralelo (máx 5 simultâneos)
    reconcileProgress.phase = "processing";
    reconcileProgress.total = toProcess.length + results.length; // inclui os skip iniciais
    const tasks = toProcess.map(({ link, pppoe, oldTag, serial }) => async () => {
      const result: typeof results[0] = { linkId: link.id, linkName: link.name, status: "skip", detail: "" };
      try {
        // Encontrar conexão Voalle no conjunto completo (por PPPoE, tag ou serial)
        let voalleConn: any =
          (pppoe   && voalleByUser.get(pppoe.toLowerCase()))   ||
          (oldTag  && voalleByTag.get(oldTag.toUpperCase()))   ||
          (serial  && voalleBySerial.get(serial.toUpperCase())) ||
          null;

        // Fallback A: serial do nosso DB existe no OZmap → tentar recuperar conexão Voalle
        // pelo PPPoE do cliente OZmap (caso o Voalle não tenha o serial indexado mas o PPPoE bata)
        let ozmapSerialDirectMatch: any = null;
        if (!voalleConn && serial) {
          ozmapSerialDirectMatch = ozmapBySerial.get(serial.toUpperCase()) ?? null;
          if (ozmapSerialDirectMatch) {
            const ozPppoe = (ozmapSerialDirectMatch.onu?.user_PPPoE || "").toLowerCase().trim();
            if (ozPppoe) {
              const viaOzPppoe = voalleByUser.get(ozPppoe) ?? null;
              if (viaOzPppoe) {
                console.log(`[OZmap Reconcile] "${link.name}": Voalle recuperado via PPPoE do OZmap (serial=${serial}, pppoe=${ozPppoe})`);
                voalleConn = viaOzPppoe;
              }
            }
          }
        }

        if (!voalleConn) {
          // Fallback B: serial do nosso DB existe no OZmap mas conexão Voalle é desconhecida
          // → relatar o match OZmap em vez de silenciar (não vincular, mas informar)
          if (ozmapSerialDirectMatch) {
            const ozId   = ozmapSerialDirectMatch._id || ozmapSerialDirectMatch.id;
            const ozCode = (ozmapSerialDirectMatch.code || "").trim() || null;
            result.status       = "ozmap_not_found";
            result.ozmapClientId  = ozId;
            result.ozmapFoundCode = ozCode || undefined;
            result.detail = `Serial "${serial}" encontrado no OZmap (id=${ozId}${ozCode ? `, code=${ozCode}` : ""}) mas conexão Voalle não localizada — vincular manualmente no Voalle`;
            return result;
          }
          result.status = "skip";
          result.detail = `Conexão não encontrada no Voalle (pppoe=${pppoe}, tag=${oldTag}, serial=${serial})`;
          return result;
        }

        const currentServiceTag: string | null = voalleConn.serviceTag ?? null;
        const rawIntegrationCodeMap: string | null = voalleConn.integrationCodeMap ?? null;
        // Se o integrationCodeMap for um valor falso (repetido em massa), ignorar — forçar re-busca no OZmap
        const isBogusIcm = rawIntegrationCodeMap ? bogusIntegrationCodeMaps.has(rawIntegrationCodeMap) : false;
        const currentIntegrationCodeMap: string | null = isBogusIcm ? null : rawIntegrationCodeMap;
        if (isBogusIcm) {
          console.log(`[OZmap Reconcile] "${link.name}": integrationCodeMap falso detectado (${rawIntegrationCodeMap}) — forçando re-busca`);
        }

        // Dados do Voalle para scoring e busca
        const voalleSerial = (voalleConn.equipmentSerialNumber || serial || "").toUpperCase().trim();
        const voallePppoe: string | null = voalleConn.user ? voalleConn.user.toLowerCase().trim() : null;
        const voalleLat = voalleConn.address?.latitude ? parseFloat(voalleConn.address.latitude) : (link.latitude ? parseFloat(String(link.latitude)) : null);
        const voalleLon = voalleConn.address?.longitude ? parseFloat(voalleConn.address.longitude) : (link.longitude ? parseFloat(String(link.longitude)) : null);
        const voalleIntegrationCode: string | null = voalleConn.integrationCode ?? null;

        // Cruzar com inativos do mesmo cliente para herdar etiqueta antiga (serviceTag) e vínculo OZmap.
        // Caso típico: cliente cancelou contrato antigo (já vinculado ao OZmap) e abriu contrato novo.
        // A busca é feita em 3 níveis: client.id (mais confiável) → PPPoE → serial.
        const voalleClientId: number | null = voalleConn.client?.id ?? null;

        // Candidatos inativos: primeiro por clientId, depois PPPoE/serial como fallback
        const deletedCandidates: any[] = [];
        if (voalleClientId) {
          const byClientId = deletedByClientId.get(voalleClientId) ?? [];
          for (const c of byClientId) {
            if (c.id !== voalleConn.id) deletedCandidates.push(c);
          }
        }
        // Adicionar candidatos por PPPoE/serial mesmo quando clientId já encontrou algo
        // (necessário para priorizar o contrato específico da unidade dentro de clientes com muitos contratos)
        {
          const byUser    = voallePppoe  ? deletedByUser.get(voallePppoe.toLowerCase())  : null;
          const bySerial  = voalleSerial ? deletedBySerial.get(voalleSerial.toUpperCase()) : null;
          const byPppoe2  = pppoe        ? deletedByUser.get(pppoe.toLowerCase())         : null;
          const bySerial2 = serial       ? deletedBySerial.get(serial.toUpperCase())      : null;
          for (const c of [byUser, bySerial, byPppoe2, bySerial2]) {
            if (c && c.id !== voalleConn.id && !deletedCandidates.find((x: any) => x.id === c.id)) {
              deletedCandidates.push(c);
            }
          }
        }
        // Filtrar inativos com ICM falso
        const validDeletedCandidates = deletedCandidates.filter((c: any) =>
          !c.integrationCodeMap || !bogusIntegrationCodeMaps.has(c.integrationCodeMap)
        );

        // Variáveis de referência para scoring de candidatos inativos
        const activePppoeNorm  = (voallePppoe || pppoe || "").toLowerCase();
        const activeSerialNorm = (voalleSerial || serial || "").toUpperCase();

        // Ordenar candidatos inativos — prioridade:
        //   1) match por PPPoE (contrato da mesma unidade/usuário) → +8
        //   2) match por serial (mesmo equipamento) → +6
        //   3) _resolvedServiceTag existe no índice OZmap local (código OZmap real confirmado) → +4
        //   4) tem _resolvedServiceTag preenchido → +2
        //   5) tem integrationCodeMap (vínculo OZmap direto) → +1
        validDeletedCandidates.sort((a: any, b: any) => {
          const score = (c: any) => {
            let s = 0;
            if (activePppoeNorm  && c.user  && c.user.toLowerCase()  === activePppoeNorm)  s += 8;
            if (activeSerialNorm && c.equipmentSerialNumber &&
                c.equipmentSerialNumber.toUpperCase() === activeSerialNorm)                 s += 6;
            // Prioridade extra: tag resolvida é um código OZmap real (existe no índice local)
            const rt = c._resolvedServiceTag;
            if (rt && ozmapByCode.has(rt.toUpperCase()))                                   s += 4;
            if (rt)                   s += 2;
            if (c.integrationCodeMap) s += 1;
            return s;
          };
          return score(b) - score(a);
        });
        const deletedSibling: any = validDeletedCandidates[0] ?? null;
        if (deletedSibling) {
          console.log(`[OZmap Reconcile] "${link.name}": inativo Voalle id=${deletedSibling.id} clientId=${deletedSibling.client?.id} tagId=${deletedSibling.serviceTag} tagResolved=${deletedSibling._resolvedServiceTag} icm=${deletedSibling.integrationCodeMap}`);
        }
        // Coletar TODAS as etiquetas resolvidas dos contratos inativos para busca OZmap
        // _resolvedServiceTag: ID numérico já convertido para código OZmap real via mapa do banco
        const deletedServiceTags: string[] = validDeletedCandidates
          .map((c: any) => c._resolvedServiceTag)
          .filter((t: any): t is string => !!t && typeof t === "string" && t.trim().length > 0);
        const deletedServiceTag: string | null = (deletedSibling?._resolvedServiceTag ?? null);
        // Todos os integrationCodeMaps válidos dos inativos para lookup direto no índice
        const allDeletedIcms: string[] = validDeletedCandidates
          .map((c: any) => c.integrationCodeMap)
          .filter((v: any): v is string => !!v && !bogusIntegrationCodeMaps.has(v));

        // FASE 2a — Buscar candidatos OZmap via índice local (sem chamadas API por filtro)
        // O OZmap não suporta filtros por campos aninhados (onu.serial_number, onu.user_PPPoE).
        // Índice completo baixado na fase anterior; aqui apenas consultas O(1) no Map.
        type OzmapCandidate = { _id: string; score: number; row: any };
        const candidateMap = new Map<string, OzmapCandidate>();

        const addCandidate = (row: any | null | undefined) => {
          if (!row) return;
          const id: string = row._id || row.id;
          if (id && !candidateMap.has(id)) candidateMap.set(id, { _id: id, score: 0, row });
        };

        // Etiquetas a buscar (code OZmap) — incluindo etiquetas numéricas legadas (codes OZmap válidos)
        const codeSearchValues = [...new Set([
          currentServiceTag,
          ...deletedServiceTags,
          link.ozmapTag,
          link.voalleContractTagServiceTag,
        ].filter((t): t is string => !!t && typeof t === "string" && t.trim().length > 0))];

        // PPPoE values
        const pppoeSearchValues = [...new Set([
          voallePppoe,
          pppoe ? pppoe.toLowerCase() : null,
        ].filter(Boolean) as string[])];

        // 1. Por _id (integrationCodeMap do ativo + inativos)
        const icmDirectLookups = [...new Set([currentIntegrationCodeMap, ...allDeletedIcms].filter(Boolean) as string[])];
        for (const icmId of icmDirectLookups) addCandidate(ozmapById.get(icmId));

        // 2. Por code (serviceTag ativo + inativos + DB)
        for (const code of codeSearchValues) addCandidate(ozmapByCode.get(code.toUpperCase()));

        // 3. Por serial ONU
        if (voalleSerial) addCandidate(ozmapBySerial.get(voalleSerial));
        if (serial && serial.toUpperCase() !== voalleSerial) addCandidate(ozmapBySerial.get(serial.toUpperCase()));

        // 4. Por PPPoE
        for (const p of pppoeSearchValues) addCandidate(ozmapByPppoe.get(p));

        // 5. Por integrationCode (bidirecionalidade Voalle↔OZmap)
        //    Caso A: OZmap tem campo integrationCode que bate com o integrationCode do Voalle
        if (voalleIntegrationCode) addCandidate(ozmapByIntegrationCode.get(voalleIntegrationCode));
        //    Caso B: Voalle guarda o ID MongoDB do cliente OZmap no campo integrationCode
        //    (ex: "6942989db011d3c21ccca5af" é o _id do cliente OZmap, não um campo intermediário)
        //    ObjectId MongoDB = 24 hex chars — detecta automaticamente para evitar falsos positivos
        if (voalleIntegrationCode && /^[0-9a-f]{24}$/i.test(voalleIntegrationCode)) {
          addCandidate(ozmapById.get(voalleIntegrationCode));
        }

        // 6. Endereço normalizado do Voalle — para match quando não há serial/PPPoE/code
        //    Normaliza: sem acento, lowercase, remove pontuação — compara logradouro + número
        const normalizeAddr = (s: string) =>
          s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
        const voalleStreet = normalizeAddr(
          [voalleConn.address?.address || voalleConn.address?.street || "", voalleConn.address?.number || ""].join(" ").trim()
        );

        // 7. Geo em memória: varre ozmapWithGeo se o download em massa retornou geo
        //    (a maioria dos OZmap não retorna geo no endpoint paginado — veja passo 8)
        const GEO_DELTA = 0.003;
        if (voalleLat && voalleLon && ozmapWithGeo.length > 0) {
          let geoHits = 0;
          for (const row of ozmapWithGeo) {
            const cLat: number | null = row._lat ?? null;
            const cLon: number | null = row._lon ?? null;
            if (cLat !== null && cLon !== null) {
              if (Math.abs(cLat - voalleLat) <= GEO_DELTA && Math.abs(cLon - voalleLon) <= GEO_DELTA) {
                addCandidate(row);
                geoHits++;
              }
            }
          }
          if (geoHits > 0) console.log(`[OZmap Reconcile] "${link.name}": ${geoHits} candidato(s) geo (memória)`);
        }

        // 8. Geo query direta ao OZmap por link — quando o índice em massa não tem geo
        //    Tenta $near MongoDB com múltiplos nomes de campo (geoCoord, geopoint, location, etc.)
        //    Cada OZmap pode usar um nome diferente; tenta até encontrar resposta com resultados.
        if (candidateMap.size === 0 && voalleLat && voalleLon) {
          const GEO_RADIUS_M = 500; // raio de 500m
          const geoFieldCandidates = ["geoCoord", "geopoint", "location", "geo", "coordinates", "geometry"];
          let geoQueryHits = 0;
          for (const geoField of geoFieldCandidates) {
            try {
              const geoFilter = {
                [geoField]: {
                  $near: {
                    $geometry: { type: "Point", coordinates: [voalleLon, voalleLat] },
                    $maxDistance: GEO_RADIUS_M,
                  },
                },
              };
              const geoUrl = `${ozmapBaseUrl}/api/v2/ftth-clients?filter=${encodeURIComponent(JSON.stringify(geoFilter))}&limit=20`;
              const geoResp = await fetchWithTimeout(geoUrl, { headers: ozmapHeaders }, 8000);
              if (geoResp.ok) {
                const geoData = await geoResp.json() as any;
                const geoRows: any[] = geoData?.rows ?? (Array.isArray(geoData) ? geoData : []);
                if (geoRows.length > 0) {
                  geoQueryHits = geoRows.length;
                  console.log(`[OZmap Reconcile] "${link.name}": geo query campo="${geoField}" → ${geoRows.length} resultado(s)`);
                  for (const row of geoRows) {
                    // Pré-calcular _lat/_lon para que scoreCandidate use haversine corretamente
                    if (row._lat == null) row._lat = extractOzmapLat(row);
                    if (row._lon == null) row._lon = extractOzmapLon(row);
                    addCandidate(row);
                  }
                  break; // encontrou — não tenta outros campos
                }
              }
            } catch (_geoErr) {
              // falha silenciosa — tenta próximo campo
            }
          }
          if (geoQueryHits === 0 && voalleLat) {
            console.log(`[OZmap Reconcile] "${link.name}": geo query sem resultado (geo não suportado ou cliente fora de área)`);
          }
        }

        if (candidateMap.size === 0 && !voalleLat && !voalleStreet && codeSearchValues.length === 0 && !voalleSerial && pppoeSearchValues.length === 0) {
          result.status = "skip";
          result.detail = `Sem dados para busca (serial=null, PPPoE=null, etiqueta=null, endereço=null, geo=null)`;
          return result;
        }

        // Helper: normaliza texto para comparação — sem acento, lowercase, só alfanumérico
        const normWords = (s: string): string[] =>
          (s || "").normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, " ")
            .split(/\s+/)
            .filter(w => w.length >= 4); // palavras curtas são ruído

        // Palavras significativas do nome do link (ex: "MARACAR TANCREDO" → ["maracar","tancredo"])
        const voalleNameWords = normWords(link.name || "");

        // Scoring: pontua cada candidato com base nos dados disponíveis
        const scoreCandidate = (c: OzmapCandidate) => {
          const row = c.row;
          const codeVal  = (row.code || "").toUpperCase().trim();
          const cSerial  = (row.onu?.serial_number || row.serialNumber || "").toUpperCase().trim();
          const cPppoe   = (row.onu?.user_PPPoE || "").toLowerCase().trim();
          const cLat: number | null = row._lat ?? null;
          const cLon: number | null = row._lon ?? null;
          const cIntCode = (row.integrationCode || "").trim();
          const cStreet  = normalizeAddr([row.address || "", row.number || ""].join(" "));

          // +5 code bate com serviceTag do ativo (etiqueta atual)
          if (codeVal && currentServiceTag && codeVal === currentServiceTag.toUpperCase()) c.score += 5;
          // +4 code bate com serviceTag de contrato inativo do mesmo cliente
          else if (codeVal && deletedServiceTags.some(t => codeVal === t.toUpperCase())) c.score += 4;
          // +3 code bate com tag salva no DB
          else if (codeVal && codeSearchValues.some(v => v.toUpperCase() === codeVal)) c.score += 3;
          // +4 serial bate
          if (voalleSerial && cSerial && cSerial === voalleSerial) c.score += 4;
          // +3 PPPoE bate
          if (pppoeSearchValues.length > 0 && cPppoe && pppoeSearchValues.includes(cPppoe)) c.score += 3;
          // +2 integrationCode bate
          if (voalleIntegrationCode && cIntCode && cIntCode === voalleIntegrationCode) c.score += 2;
          // Pontuação por distância haversine
          if (voalleLat && voalleLon && cLat !== null && cLon !== null) {
            const dist = haversineKm(voalleLat, voalleLon, cLat, cLon);
            if (dist <= 0.05)       c.score += 4; // ≤50m:  +4 (mesmo bloco)
            else if (dist <= 0.15)  c.score += 3; // ≤150m: +3 (mesma quadra)
            else if (dist <= 0.35)  c.score += 2; // ≤350m: +2 (mesmo quarteirão)
            else if (dist <= 1.0)   c.score += 1; // ≤1km:  +1 (bairro próximo)
          }
          // +2 endereço (logradouro+número) normalizado bate
          if (voalleStreet && cStreet && voalleStreet.length > 5 && cStreet.length > 5 && voalleStreet === cStreet) c.score += 2;

          // Similaridade de nome: palavras do link Voalle encontradas no nome/observação do OZmap
          // Útil quando geo localiza vários candidatos próximos — o nome distingue o correto
          if (voalleNameWords.length >= 1) {
            const ozmapText = normWords([row.name || "", row.observation || ""].join(" "));
            const matchedWords = voalleNameWords.filter(w => ozmapText.includes(w));
            if (matchedWords.length >= 3)      c.score += 4; // forte coincidência de nome
            else if (matchedWords.length === 2) c.score += 3;
            else if (matchedWords.length === 1 && matchedWords[0].length >= 6) c.score += 2; // 1 palavra longa
            else if (matchedWords.length === 1) c.score += 1;
          }
        };

        for (const c of candidateMap.values()) scoreCandidate(c);

        const candidates = [...candidateMap.values()].sort((a, b) => b.score - a.score);
        const best = candidates.length > 0 && candidates[0].score > 0 ? candidates[0] : null;
        const ozmapClientId = best?._id ?? null;
        const ozmapExistingIntegrationCode: string | null = best?.row?.integrationCode ?? null;
        const ozmapFoundCode: string | null = best?.row?.code ?? null; // etiqueta (code) encontrada no OZmap

        result.voalleConnectionId = voalleConn.id;
        result.linkTag = currentServiceTag || link.ozmapTag || undefined;
        result.oldTag  = deletedServiceTag || undefined;
        result.ozmapFoundCode = ozmapFoundCode || undefined;

        // Sincronizar ozmapTag no nosso DB se a serviceTag mudou
        if (!dryRun && currentServiceTag && currentServiceTag !== oldTag) {
          await db.update(links).set({ ozmapTag: currentServiceTag }).where(eq(links.id, link.id));
        }

        // Nenhum candidato OZmap encontrado
        if (!ozmapClientId) {
          if (currentIntegrationCodeMap) {
            // Já tem vínculo no Voalle mas não conseguimos confirmar no OZmap — manter
            result.status = "already_linked";
            result.detail = `Voalle já vinculado (integrationCodeMap=${currentIntegrationCodeMap}), sem candidato OZmap para validar`;
          } else {
            result.status = "ozmap_not_found";
            const tagSummary = [
              result.linkTag  ? `etiqueta=${result.linkTag}`      : null,
              result.oldTag   ? `etiqueta_antiga=${result.oldTag}` : null,
              voalleSerial    ? `serial=${voalleSerial}`          : null,
              pppoeSearchValues.length ? `pppoe=${pppoeSearchValues[0]}` : null,
              voalleIntegrationCode ? `intCode=${voalleIntegrationCode}` : null,
            ].filter(Boolean).join(", ");
            result.detail = `Voalle id=${voalleConn.id} encontrado, sem cliente OZmap compatível (${candidates.length} candidatos) [${tagSummary || "sem identificadores"}]`;
          }
          return result;
        }

        // Candidato OZmap encontrado — decidir se vincula (novo) ou atualiza (errado)
        const scoreInfo = `score=${best.score}`;
        result.ozmapClientId = ozmapClientId;
        // Campos temporários para deduplicação pós-processamento (removidos antes de publicar resultado)
        (result as any)._dedup_score = best.score;
        (result as any)._dedup_ozmapId = ozmapClientId;

        if (currentIntegrationCodeMap && currentIntegrationCodeMap === ozmapClientId) {
          // Já vinculado ao cliente correto — nada a fazer
          result.status = "already_linked";
          result.detail = `Voalle já vinculado ao cliente OZmap correto (${ozmapClientId}) [${scoreInfo}]`;
          return result;
        }

        // Precisa vincular (novo) ou atualizar (integrationCodeMap diferente ou falso)
        // Se rawIntegrationCodeMap existe (mesmo que falso/bogus), usar update (override via old→new)
        // Se rawIntegrationCodeMap é null, vincular pela primeira vez
        const isUpdate = !!rawIntegrationCodeMap && rawIntegrationCodeMap !== ozmapClientId;
        let voalleOk = dryRun;

        if (!dryRun) {
          if (isUpdate) {
            // Atualizar vínculo existente (ou substituir falso): /connection/update/integrationcode/{old}/{new}
            voalleOk = await voalleAdapter.updateConnectionIntegrationCode(rawIntegrationCodeMap!, ozmapClientId);
            if (!voalleOk) console.warn(`[OZmap Reconcile] updateConnectionIntegrationCode falhou: ${rawIntegrationCodeMap} → ${ozmapClientId}`);
          } else {
            // Vincular pela primeira vez: /connection/vinculate/{id}/{integrationcode}
            voalleOk = await voalleAdapter.vinculateConnectionIntegrationCode(voalleConn.id, ozmapClientId);
            if (!voalleOk) console.warn(`[OZmap Reconcile] vinculateConnectionIntegrationCode falhou: voalleId=${voalleConn.id} → ${ozmapClientId}`);
          }
        }

        // Atualizar integrationCode no OZmap para manter bidirecionalidade
        const targetIntegrationCode = voalleIntegrationCode || String(voalleConn.id);
        let ozmapUpdated = dryRun ? (ozmapExistingIntegrationCode === targetIntegrationCode) : false;
        if (!dryRun && voalleOk && ozmapExistingIntegrationCode !== targetIntegrationCode) {
          try {
            const pr = await fetchWithTimeout(
              `${ozmapBaseUrl}/api/v2/ftth-clients/${ozmapClientId}`,
              { method: "PATCH", headers: { ...ozmapHeaders, "Content-Type": "application/json" }, body: JSON.stringify({ integrationCode: targetIntegrationCode }) },
              10000
            );
            ozmapUpdated = pr.ok;
            if (!pr.ok) console.warn(`[OZmap Reconcile] PATCH OZmap integrationCode falhou: ${pr.status}`);
          } catch (e) { console.warn(`[OZmap Reconcile] PATCH OZmap integrationCode erro: ${e}`); }
        }

        const tagNote = [
          result.linkTag       ? `etiqueta_link=${result.linkTag}`      : null,
          result.oldTag        ? `etiqueta_antiga=${result.oldTag}`      : null,
          result.ozmapFoundCode ? `etiqueta_ozmap=${result.ozmapFoundCode}` : null,
        ].filter(Boolean).join(", ");

        if (dryRun) {
          result.status = "dry_run";
          const bogusNote = isBogusIcm ? " [ICM FALSO → substituindo]" : "";
          result.detail = isUpdate
            ? `[DRY RUN] Atualizaria vínculo Voalle: ${rawIntegrationCodeMap}${bogusNote} → ${ozmapClientId} [${scoreInfo}]; ${tagNote}`
            : `[DRY RUN] Vincularia voalleId=${voalleConn.id} → ozmapId=${ozmapClientId} [${scoreInfo}]; ${tagNote}`;
        } else if (voalleOk) {
          result.status = "success";
          const bogusNote = isBogusIcm ? " [ICM falso substituído]" : "";
          result.detail = isUpdate
            ? `Vínculo atualizado: ${rawIntegrationCodeMap}${bogusNote} → ${ozmapClientId} [${scoreInfo}]; ${tagNote}; OZmap integrationCode: ${ozmapUpdated ? "atualizado" : "sem alteração"}`
            : `Vinculado: voalleId=${voalleConn.id} → ozmapId=${ozmapClientId} [${scoreInfo}]; ${tagNote}; OZmap integrationCode: ${ozmapUpdated ? "atualizado" : "sem alteração"}`;
        } else {
          result.status = "vinculate_failed";
          result.detail = isUpdate
            ? `Falha ao atualizar vínculo: ${rawIntegrationCodeMap} → ${ozmapClientId} [${scoreInfo}]; ${tagNote}`
            : `Falha ao vincular voalleId=${voalleConn.id} → ozmapId=${ozmapClientId} [${scoreInfo}]; ${tagNote}`;
        }

        console.log(`[OZmap Reconcile] ${link.name} (${link.id}): ${result.detail}`);
        return result;

      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[OZmap Reconcile] ${link.name} (${link.id}): erro: ${errMsg}`);
        return { linkId: link.id, linkName: link.name, status: "error", detail: errMsg };
      } finally {
        reconcileProgress.processed++;
      }
    });

    const processed = await pLimit(tasks, 5);

    // DEDUPLICAÇÃO — cada cliente OZmap só pode ser atribuído ao link de MAIOR score
    // Links com score menor que concorrem ao mesmo ozmapId são marcados como conflito
    {
      // 1) Encontrar o vencedor (maior score) para cada ozmapId
      const bestByOzmapId = new Map<string, { idx: number; score: number; linkName: string }>();
      for (let i = 0; i < processed.length; i++) {
        const r = processed[i] as any;
        const ozmapId: string | null = r._dedup_ozmapId ?? null;
        const score: number = r._dedup_score ?? 0;
        const isCandidate = r.status === "dry_run" || r.status === "success" || r.status === "vinculate_failed" || r.status === "already_linked";
        if (ozmapId && score > 0 && isCandidate) {
          const existing = bestByOzmapId.get(ozmapId);
          // already_linked recebe bônus de prioridade (score+1000) — já vinculado ao cliente correto
          const effectiveScore = r.status === "already_linked" ? score + 1000 : score;
          if (!existing || effectiveScore > existing.score) {
            bestByOzmapId.set(ozmapId, { idx: i, score: effectiveScore, linkName: r.linkName });
          }
        }
      }
      // 2) Marcar perdedores como conflito
      let conflictCount = 0;
      for (let i = 0; i < processed.length; i++) {
        const r = processed[i] as any;
        const ozmapId: string | null = r._dedup_ozmapId ?? null;
        const score: number = r._dedup_score ?? 0;
        const isCandidate = r.status === "dry_run" || r.status === "success" || r.status === "vinculate_failed";
        if (ozmapId && score > 0 && isCandidate) {
          const winner = bestByOzmapId.get(ozmapId);
          if (winner && winner.idx !== i) {
            r.status = "conflict";
            r.detail = `[CONFLITO] Cliente OZmap ${ozmapId} já atribuído a "${winner.linkName}" [score=${winner.score}] — este link [score=${score}] não será vinculado`;
            conflictCount++;
          }
        }
        // Limpar campos temporários
        delete r._dedup_score;
        delete r._dedup_ozmapId;
      }
      if (conflictCount > 0) {
        console.log(`[OZmap Reconcile] Deduplicação: ${conflictCount} link(s) marcados como conflito (mesmo cliente OZmap reivindacado por múltiplos links)`);
      }
    }

    results.push(...processed);

    // Atualizar progresso com resultado final
    reconcileProgress.phase = "done";
    reconcileProgress.running = false;
    reconcileProgress.finishedAt = Date.now();
    reconcileProgress.total = results.length;
    reconcileProgress.processed = results.length;
    reconcileProgress.success = results.filter(r => r.status === "success").length;
    reconcileProgress.already_linked = results.filter(r => r.status === "already_linked").length;
    reconcileProgress.ozmap_not_found = results.filter(r => r.status === "ozmap_not_found").length;
    reconcileProgress.skip = results.filter(r => r.status === "skip").length;
    reconcileProgress.vinculate_failed = results.filter(r => r.status === "vinculate_failed").length;
    reconcileProgress.dry_run = results.filter(r => r.status === "dry_run").length;
    reconcileProgress.conflict = results.filter(r => r.status === "conflict").length;
    reconcileProgress.error = results.filter(r => r.status === "error").length;
    reconcileProgress.results = results;
    console.log(`[OZmap Reconcile] Concluído: total=${results.length} success=${reconcileProgress.success} dry_run=${reconcileProgress.dry_run} conflict=${reconcileProgress.conflict} already=${reconcileProgress.already_linked} notFound=${reconcileProgress.ozmap_not_found}`);

    } catch (bgErr) {
      const msg = bgErr instanceof Error ? bgErr.message : String(bgErr);
      console.error("[OZmap Reconcile] Erro inesperado no background:", msg);
      reconcileProgress.phase = "error";
      reconcileProgress.errorMessage = msg;
      reconcileProgress.running = false;
      reconcileProgress.finishedAt = Date.now();
    }
    })(); // fim do IIFE async
  }); // fim do app.post

  app.get("/api/admin/links/enrich/status", requireAuth, requireSuperAdmin, async (_req: Request, res: Response) => {
    res.json(enrichmentProgress);
  });

  // Ativar/desativar monitoramento em lote
  app.patch("/api/admin/links/bulk-monitoring", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
    try {
      const { linkIds, monitoringEnabled } = req.body as { linkIds: number[]; monitoringEnabled: boolean };
      if (!Array.isArray(linkIds) || linkIds.length === 0) {
        return res.status(400).json({ error: "linkIds deve ser array não vazio" });
      }
      if (typeof monitoringEnabled !== "boolean") {
        return res.status(400).json({ error: "monitoringEnabled deve ser boolean" });
      }
      const updated: number[] = [];
      for (const id of linkIds) {
        const link = await storage.getLink(id);
        if (!link) continue;
        await storage.updateLink(id, { monitoringEnabled });
        updated.push(id);
      }
      return res.json({ updated: updated.length, monitoringEnabled });
    } catch (error: any) {
      console.error("[bulk-monitoring] erro:", error);
      return res.status(500).json({ error: error?.message || "Erro inesperado" });
    }
  });

  app.post("/api/admin/links/enrich", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
    if (enrichmentProgress.running) {
      return res.status(409).json({ error: "Enriquecimento já em andamento", progress: enrichmentProgress });
    }

    const { action, linkIds } = req.body as { action: string; linkIds?: number[] };
    if (!action) {
      return res.status(400).json({ error: "Ação é obrigatória" });
    }

    res.json({ started: true, action });

    enrichmentProgress = {
      running: true,
      action,
      total: 0,
      processed: 0,
      success: 0,
      failed: 0,
      skipped: 0,
      errors: [],
      startedAt: Date.now(),
    };

    (async () => {
      try {
        let targetLinks = await db.select().from(links);
        if (linkIds && linkIds.length > 0) {
          targetLinks = targetLinks.filter(l => linkIds.includes(l.id));
        }

        if (action === 'discover_ips' || action === 'discover_all') {
          const linksNeedingIp = targetLinks.filter(l => l.pppoeUser && !l.monitoredIp);
          enrichmentProgress.total += linksNeedingIp.length;
          enrichmentProgress.action = 'discover_ips';
          console.log(`[Enrich] Starting IP discovery for ${linksNeedingIp.length} links via RADIUS`);

          const { getRadiusSessionByUsername, testRadiusDbConnection } = await import("./radius");
          const radiusTest = await testRadiusDbConnection();
          if (!radiusTest.success) {
            console.error(`[Enrich] RADIUS DB não disponível: ${radiusTest.message}`);
            enrichmentProgress.errors.push(`RADIUS DB: ${radiusTest.message}`);
            for (const link of linksNeedingIp) {
              enrichmentProgress.failed++;
              enrichmentProgress.processed++;
            }
          } else {
            console.log(`[Enrich] RADIUS DB conectado (${radiusTest.activeSessionsCount} sessões ativas)`);
            for (const link of linksNeedingIp) {
              try {
                const session = await getRadiusSessionByUsername(link.pppoeUser!);
                if (session?.framedIpAddress) {
                  await db.update(links).set({ monitoredIp: session.framedIpAddress }).where(eq(links.id, link.id));
                  enrichmentProgress.success++;
                } else {
                  enrichmentProgress.skipped++;
                }
              } catch (err: any) {
                enrichmentProgress.failed++;
                if (enrichmentProgress.errors.length < 50) {
                  enrichmentProgress.errors.push(`${link.name}: ${err.message}`);
                }
              }
              enrichmentProgress.processed++;
            }
            console.log(`[Enrich] IP discovery done: ${enrichmentProgress.success} found, ${enrichmentProgress.skipped} no session`);
          }
        }

        if (action === 'discover_mac' || action === 'discover_all') {
          const linksNeedingMac = targetLinks.filter(l => l.pppoeUser && !l.macAddress);
          enrichmentProgress.total += linksNeedingMac.length;
          enrichmentProgress.action = 'discover_mac';
          console.log(`[Enrich] Starting MAC discovery for ${linksNeedingMac.length} links via RADIUS`);

          const { getMacFromRadiusByUsername, testRadiusDbConnection: testRadiusDb2 } = await import("./radius");
          const radiusTest2 = await testRadiusDb2();
          if (!radiusTest2.success) {
            console.error(`[Enrich] RADIUS DB não disponível para MAC: ${radiusTest2.message}`);
            enrichmentProgress.errors.push(`RADIUS DB (MAC): ${radiusTest2.message}`);
            for (const link of linksNeedingMac) {
              enrichmentProgress.failed++;
              enrichmentProgress.processed++;
            }
          } else {
            console.log(`[Enrich] RADIUS DB conectado para MAC (${radiusTest2.activeSessionsCount} sessões ativas)`);
            for (const link of linksNeedingMac) {
              try {
                const mac = await getMacFromRadiusByUsername(link.pppoeUser!);
                if (mac) {
                  await db.update(links).set({ macAddress: mac }).where(eq(links.id, link.id));
                  enrichmentProgress.success++;
                } else {
                  enrichmentProgress.skipped++;
                }
              } catch (err: any) {
                enrichmentProgress.failed++;
                if (enrichmentProgress.errors.length < 50) {
                  enrichmentProgress.errors.push(`${link.name}: ${err.message}`);
                }
              }
              enrichmentProgress.processed++;
            }
            console.log(`[Enrich] MAC discovery done: ${enrichmentProgress.success} found, ${enrichmentProgress.skipped} no session`);
          }
        }

        if (action === 'discover_voalle' || action === 'discover_all') {
          const linksForVoalle = targetLinks.filter(l => l.voalleContractTagId || l.voalleConnectionId);
          enrichmentProgress.total += linksForVoalle.length;
          enrichmentProgress.action = 'discover_voalle';
          console.log(`[Enrich] Starting Voalle data fetch for ${linksForVoalle.length} links`);

          try {
            const voalleIntegration = await storage.getErpIntegrationByProvider('voalle');
            if (!voalleIntegration) {
              enrichmentProgress.errors.push("Integração Voalle não configurada");
              for (const link of linksForVoalle) {
                enrichmentProgress.processed++;
                enrichmentProgress.failed++;
              }
            } else {
              const adapter = configureErpAdapter(voalleIntegration) as any;
              const clientIds = [...new Set(linksForVoalle.map(l => l.clientId))];

              for (const cId of clientIds) {
                const clientLinks = linksForVoalle.filter(l => l.clientId === cId);
                const clientData = await db.select().from(clientsTable).where(eq(clientsTable.id, cId));
                const client = clientData[0];

                let allTags: any[] = [];
                try {
                  allTags = await adapter.getContractTags({
                    voalleCustomerId: client?.voalleCustomerId ? String(client.voalleCustomerId) : null,
                    cnpj: client?.cnpj || null,
                    portalUsername: client?.voallePortalUsername || null,
                    portalPassword: client?.voallePortalPassword || null,
                  });
                  console.log(`[Enrich] Cliente ${cId} (${client?.name}): ${allTags.length} tags Voalle encontradas`);
                } catch (tagErr: any) {
                  if (enrichmentProgress.errors.length < 50) {
                    enrichmentProgress.errors.push(`Cliente ${client?.name || cId}: ${tagErr.message}`);
                  }
                }

                const tagMap = new Map(allTags.map((t: any) => [t.id, t]));

                for (const link of clientLinks) {
                  try {
                    const tag = link.voalleContractTagId ? tagMap.get(link.voalleContractTagId) : null;
                    if (tag) {
                      const updateData: Record<string, any> = {};
                      if (tag.pppoeUser && !link.pppoeUser) updateData.pppoeUser = tag.pppoeUser;
                      if (tag.pppoePassword && !link.pppoePassword) updateData.pppoePassword = tag.pppoePassword;
                      if (tag.ip && !link.monitoredIp) updateData.monitoredIp = tag.ip;
                      if (tag.address && !link.address) updateData.address = tag.address;
                      if (tag.location && !link.location) updateData.location = tag.location;
                      if (tag.bandwidth && !link.bandwidth) updateData.bandwidth = tag.bandwidth;
                      if (tag.slotOlt !== undefined && tag.slotOlt !== null && !link.slotOlt) updateData.slotOlt = String(tag.slotOlt);
                      if (tag.portOlt !== undefined && tag.portOlt !== null && !link.portOlt) updateData.portOlt = String(tag.portOlt);
                      if (tag.equipmentSerialNumber && !link.equipmentSerialNumber) updateData.equipmentSerialNumber = tag.equipmentSerialNumber;
                      if (tag.wifiName && !link.wifiName) updateData.wifiName = tag.wifiName;
                      if (tag.wifiPassword && !link.wifiPassword) updateData.wifiPassword = tag.wifiPassword;

                      if (Object.keys(updateData).length > 0) {
                        await db.update(links).set(updateData).where(eq(links.id, link.id));
                        enrichmentProgress.success++;
                        console.log(`[Enrich] ${link.name}: Voalle data updated (${Object.keys(updateData).join(', ')})`);
                      } else {
                        enrichmentProgress.skipped++;
                      }
                    } else {
                      enrichmentProgress.skipped++;
                    }
                  } catch (err: any) {
                    enrichmentProgress.failed++;
                    if (enrichmentProgress.errors.length < 50) {
                      enrichmentProgress.errors.push(`${link.name}: ${err.message}`);
                    }
                  }
                  enrichmentProgress.processed++;
                }
              }
            }
          } catch (err: any) {
            console.error("[Enrich] Voalle error:", err);
            enrichmentProgress.errors.push(`Voalle global error: ${err.message}`);
          }
        }

        if (action === 'discover_voalle_login' || action === 'discover_all') {
          enrichmentProgress.action = 'discover_voalle_login';
          console.log(`[Enrich] Starting Voalle Portal login discovery (CPF/CNPJ)`);

          try {
            const voalleIntegration = await storage.getErpIntegrationByProvider('voalle');
            if (!voalleIntegration) {
              enrichmentProgress.errors.push("Integração Voalle não configurada para login portal");
            } else {
              const adapter = configureErpAdapter(voalleIntegration) as any;
              const allClients = await db.select().from(clientsTable);
              const clientsNeedingLogin = allClients.filter(c => c.cnpj && (!c.voallePortalUsername || !c.voallePortalPassword));
              enrichmentProgress.total += clientsNeedingLogin.length;
              console.log(`[Enrich] ${clientsNeedingLogin.length} clientes sem login portal (tentando CPF/CNPJ)`);

              for (const client of clientsNeedingLogin) {
                try {
                  const cnpj = client.cnpj!.replace(/[^\d]/g, '');
                  const validation = await adapter.validatePortalCredentials(cnpj, cnpj);
                  if (validation.success) {
                    await db.update(clientsTable).set({
                      voallePortalUsername: cnpj,
                      voallePortalPassword: cnpj,
                      voalleCustomerId: validation.person?.id || client.voalleCustomerId,
                    }).where(eq(clientsTable.id, client.id));
                    enrichmentProgress.success++;
                    console.log(`[Enrich] ${client.name}: Portal login OK (CPF/CNPJ: ${cnpj.substring(0, 4)}...)`);
                  } else {
                    enrichmentProgress.skipped++;
                  }
                } catch (err: any) {
                  enrichmentProgress.failed++;
                  if (enrichmentProgress.errors.length < 50) {
                    enrichmentProgress.errors.push(`${client.name}: ${err.message}`);
                  }
                }
                enrichmentProgress.processed++;
              }
            }
          } catch (err: any) {
            console.error("[Enrich] Voalle login error:", err);
            enrichmentProgress.errors.push(`Voalle login: ${err.message}`);
          }
        }

        if (action === 'assign_concentrators' || action === 'discover_all') {
          enrichmentProgress.action = 'assign_concentrators';
          console.log(`[Enrich] Starting concentrator assignment`);

          try {
            const allConcentrators = await db.select().from(snmpConcentrators);
            const linksNeedingConcentrator = targetLinks.filter(l => !l.concentratorId && (l.authType === 'pppoe' || l.trafficSourceType === 'concentrator'));
            enrichmentProgress.total += linksNeedingConcentrator.length;

            const voalleIdToConcentrator = new Map<string, number>();
            for (const conc of allConcentrators) {
              if (conc.voalleIds) {
                for (const vid of conc.voalleIds.split(',').map(s => s.trim())) {
                  if (vid) voalleIdToConcentrator.set(vid, conc.id);
                }
              }
            }

            const voalleIntegration = await storage.getErpIntegrationByProvider('voalle');
            let adapter: any = null;
            if (voalleIntegration) {
              adapter = configureErpAdapter(voalleIntegration) as any;
            }

            const clientIds = [...new Set(linksNeedingConcentrator.map(l => l.clientId))];
            const tagsByClient = new Map<number, any[]>();

            if (adapter) {
              for (const cId of clientIds) {
                try {
                  const clientData = await db.select().from(clientsTable).where(eq(clientsTable.id, cId));
                  const client = clientData[0];
                  if (client?.voallePortalUsername && client?.voallePortalPassword) {
                    const tags = await adapter.getContractTags({
                      voalleCustomerId: client.voalleCustomerId ? String(client.voalleCustomerId) : null,
                      cnpj: client.cnpj || null,
                      portalUsername: client.voallePortalUsername,
                      portalPassword: client.voallePortalPassword,
                    });
                    tagsByClient.set(cId, tags);
                  }
                } catch (e: any) {
                  if (enrichmentProgress.errors.length < 50) {
                    enrichmentProgress.errors.push(`Tags cliente ${cId}: ${e.message}`);
                  }
                }
              }
            }

            for (const link of linksNeedingConcentrator) {
              try {
                let concentratorId: number | null = null;
                const clientTags = tagsByClient.get(link.clientId) || [];
                const tag = link.voalleContractTagId ? clientTags.find((t: any) => t.id === link.voalleContractTagId) : null;

                if (tag?.concentratorId) {
                  concentratorId = voalleIdToConcentrator.get(String(tag.concentratorId)) || null;
                }

                if (!concentratorId && allConcentrators.length === 1) {
                  concentratorId = allConcentrators[0].id;
                }

                if (concentratorId) {
                  await db.update(links).set({ concentratorId, trafficSourceType: 'concentrator' }).where(eq(links.id, link.id));
                  enrichmentProgress.success++;
                } else {
                  enrichmentProgress.skipped++;
                }
              } catch (err: any) {
                enrichmentProgress.failed++;
                if (enrichmentProgress.errors.length < 50) {
                  enrichmentProgress.errors.push(`${link.name}: ${err.message}`);
                }
              }
              enrichmentProgress.processed++;
            }
            console.log(`[Enrich] Concentrator assignment done: ${enrichmentProgress.success} assigned`);
          } catch (err: any) {
            console.error("[Enrich] Concentrator error:", err);
            enrichmentProgress.errors.push(`Concentrador: ${err.message}`);
          }
        }

        if (action === 'assign_olts' || action === 'discover_all') {
          enrichmentProgress.action = 'assign_olts';
          console.log(`[Enrich] Starting OLT assignment`);

          try {
            const allOlts = await db.select().from(olts);
            const allSwitches = await db.select().from(switches);
            const linksNeedingOlt = targetLinks.filter(l => l.linkType === 'gpon' && !l.oltId && (l.voalleAccessPointId || l.slotOlt));
            enrichmentProgress.total += linksNeedingOlt.length;

            const voalleIdToOlt = new Map<string, number>();
            for (const olt of allOlts) {
              if (olt.voalleIds) {
                for (const vid of olt.voalleIds.split(',').map(s => s.trim())) {
                  if (vid) voalleIdToOlt.set(vid, olt.id);
                }
              }
            }
            for (const sw of allSwitches) {
              if (sw.voalleIds) {
                for (const vid of sw.voalleIds.split(',').map(s => s.trim())) {
                  if (vid) voalleIdToOlt.set(vid, sw.id);
                }
              }
            }

            for (const link of linksNeedingOlt) {
              try {
                let oltId: number | null = null;
                let isSwitchType = false;

                if (link.voalleAccessPointId) {
                  oltId = voalleIdToOlt.get(String(link.voalleAccessPointId)) || null;
                  if (oltId) {
                    isSwitchType = allSwitches.some(s => s.id === oltId);
                  }
                }

                if (oltId) {
                  const updateData: Record<string, any> = {};
                  if (isSwitchType) {
                    updateData.switchId = oltId;
                    updateData.linkType = 'ptp';
                  } else {
                    updateData.oltId = oltId;
                    updateData.opticalMonitoringEnabled = true;
                  }

                  if (link.equipmentSerialNumber) {
                    updateData.onuSearchString = link.equipmentSerialNumber;
                  }

                  await db.update(links).set(updateData).where(eq(links.id, link.id));
                  enrichmentProgress.success++;
                  console.log(`[Enrich] ${link.name}: OLT/Switch assigned (voalleAP: ${link.voalleAccessPointId} -> ${isSwitchType ? 'switch' : 'olt'} ${oltId})`);
                } else {
                  enrichmentProgress.skipped++;
                }
              } catch (err: any) {
                enrichmentProgress.failed++;
                if (enrichmentProgress.errors.length < 50) {
                  enrichmentProgress.errors.push(`${link.name}: ${err.message}`);
                }
              }
              enrichmentProgress.processed++;
            }
            console.log(`[Enrich] OLT assignment done: ${enrichmentProgress.success} assigned`);
          } catch (err: any) {
            console.error("[Enrich] OLT error:", err);
            enrichmentProgress.errors.push(`OLT: ${err.message}`);
          }
        }

        if (action === 'discover_interfaces' || action === 'discover_all') {
          enrichmentProgress.action = 'discover_interfaces';
          const linksNeedingInterface = targetLinks.filter(l => 
            (l.snmpInterfaceIndex === null || l.snmpInterfaceIndex === undefined) &&
            (l.concentratorId || l.monitoredIp || l.snmpRouterIp)
          );
          enrichmentProgress.total += linksNeedingInterface.length;

          const allProfiles = await storage.getSnmpProfiles();
          const profileMap = new Map(allProfiles.map(p => [p.id, p]));
          const allConcentrators = await storage.getConcentrators();
          const concentratorMap = new Map(allConcentrators.map(c => [c.id, c]));

          console.log(`[Enrich] Starting SNMP interface discovery for ${linksNeedingInterface.length} links`);

          for (const link of linksNeedingInterface) {
            try {
              let searchIp: string | null = null;
              let profile: any = null;
              let searchName = link.originalIfName || link.snmpInterfaceName;

              if (!searchName && link.authType === 'corporate' && (link as any).vlanInterface) {
                searchName = (link as any).vlanInterface;
              }

              if (link.snmpProfileId) {
                profile = profileMap.get(link.snmpProfileId);
              }

              if (link.concentratorId) {
                const concentrator = concentratorMap.get(link.concentratorId);
                if (concentrator) {
                  searchIp = concentrator.ipAddress;
                  if (concentrator.snmpProfileId) {
                    const concProfile = profileMap.get(concentrator.snmpProfileId);
                    if (concProfile) profile = concProfile;
                  }
                  if (link.pppoeUser) {
                    searchName = link.pppoeUser;
                  }
                }
              }

              if (!searchIp) {
                searchIp = link.snmpRouterIp || link.monitoredIp;
              }

              if (!profile && allProfiles.length > 0) {
                profile = allProfiles[0];
              }

              if (!searchIp || !profile || !searchName) {
                enrichmentProgress.skipped++;
                enrichmentProgress.processed++;
                if (enrichmentProgress.errors.length < 50) {
                  const reasons: string[] = [];
                  if (!link.concentratorId) reasons.push('sem concentrador atribuído');
                  else if (!searchIp) reasons.push('concentrador sem IP');
                  if (!profile) {
                    if (link.concentratorId) {
                      const conc = concentratorMap.get(link.concentratorId);
                      reasons.push(conc?.snmpProfileId ? 'perfil SNMP do concentrador não encontrado' : 'concentrador sem perfil SNMP');
                    } else {
                      reasons.push('sem perfil SNMP');
                    }
                  }
                  if (!searchName) reasons.push('sem nome de interface (pppoeUser/snmpInterfaceName)');
                  enrichmentProgress.errors.push(`${link.name}: ${reasons.join(', ')}`);
                }
                continue;
              }

              const interfaces = await discoverInterfaces(searchIp, profile);
              if (interfaces && interfaces.length > 0) {
                let matchedIf: SnmpInterface | undefined;

                matchedIf = interfaces.find(i => 
                  i.ifName === searchName || i.ifDescr === searchName || i.ifAlias === searchName
                );

                if (!matchedIf) {
                  matchedIf = interfaces.find(i => 
                    i.ifName?.toLowerCase().includes(searchName!.toLowerCase()) ||
                    i.ifDescr?.toLowerCase().includes(searchName!.toLowerCase()) ||
                    i.ifAlias?.toLowerCase().includes(searchName!.toLowerCase())
                  );
                }

                if (matchedIf) {
                  const updateData: any = {
                    snmpInterfaceIndex: matchedIf.ifIndex,
                    snmpInterfaceName: matchedIf.ifName || undefined,
                    snmpInterfaceDescr: matchedIf.ifDescr || undefined,
                    snmpInterfaceAlias: matchedIf.ifAlias || undefined,
                  };
                  await db.update(links).set(updateData).where(eq(links.id, link.id));
                  enrichmentProgress.success++;
                } else {
                  enrichmentProgress.skipped++;
                  if (enrichmentProgress.errors.length < 50) {
                    const discoveredNames = interfaces.slice(0, 8).map(i => `${i.ifName || i.ifDescr}${i.ifAlias ? ' ('+i.ifAlias+')' : ''}`).join(', ');
                    enrichmentProgress.errors.push(`${link.name}: Interface "${searchName}" não encontrada em ${searchIp}. Disponíveis: ${discoveredNames}`);
                  }
                }
              } else {
                enrichmentProgress.skipped++;
                if (enrichmentProgress.errors.length < 50) {
                  enrichmentProgress.errors.push(`${link.name}: SNMP sem resposta em ${searchIp}`);
                }
              }
            } catch (err: any) {
              enrichmentProgress.failed++;
              if (enrichmentProgress.errors.length < 50) {
                enrichmentProgress.errors.push(`${link.name}: ${err.message}`);
              }
            }
            enrichmentProgress.processed++;
          }
          console.log(`[Enrich] Interface discovery done: ${enrichmentProgress.success} found, ${enrichmentProgress.skipped} skipped, ${enrichmentProgress.failed} failed`);
        }

        if (action === 'sync_ozmap' || action === 'discover_all') {
          enrichmentProgress.action = 'sync_ozmap';
          // Inclui links COM etiqueta sem dados OZmap E links SEM etiqueta mas com serial/PPPoE
          const linksForOzmap = targetLinks.filter(l =>
            !l.ozmapArrivingPotency && (
              l.voalleContractTagServiceTag || l.ozmapTag ||
              l.equipmentSerialNumber || l.voalleLogin
            )
          );
          enrichmentProgress.total += linksForOzmap.length;
          console.log(`[Enrich] Starting OZmap sync for ${linksForOzmap.length} links (com fallbacks)`);

          try {
            for (const link of linksForOzmap) {
              try {
                const tag = link.ozmapTag || link.voalleContractTagServiceTag || "";
                const synced = await enrichLinkWithOzmapData(link.id, tag, link.name);
                if (synced) {
                  enrichmentProgress.success++;
                } else {
                  enrichmentProgress.skipped++;
                  if (enrichmentProgress.errors.length < 50) {
                    enrichmentProgress.errors.push(`${link.name}: Sem dados no OZmap (todos os critérios esgotados)`);
                  }
                }
              } catch (err: any) {
                enrichmentProgress.failed++;
                if (enrichmentProgress.errors.length < 50) {
                  enrichmentProgress.errors.push(`${link.name}: ${err.message}`);
                }
              }
              enrichmentProgress.processed++;
            }
            console.log(`[Enrich] OZmap sync done: ${enrichmentProgress.success} synced, ${enrichmentProgress.skipped} sem dados`);
          } catch (err: any) {
            console.error("[Enrich] OZmap error:", err);
            enrichmentProgress.errors.push(`OZmap: ${err.message}`);
          }
        }

        if (action === 'discover_onu_ids' || action === 'discover_all') {
          enrichmentProgress.action = 'discover_onu_ids';
          const { searchOnuBySerial } = await import("./olt");
          const linksNeedingOnuId = targetLinks.filter(l => l.oltId && l.equipmentSerialNumber && !l.onuId);
          enrichmentProgress.total += linksNeedingOnuId.length;
          console.log(`[Enrich] Starting ONU ID discovery for ${linksNeedingOnuId.length} links`);

          const linksByOlt = new Map<number, typeof linksNeedingOnuId>();
          for (const link of linksNeedingOnuId) {
            const oltId = link.oltId!;
            if (!linksByOlt.has(oltId)) linksByOlt.set(oltId, []);
            linksByOlt.get(oltId)!.push(link);
          }

          const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

          for (const [oltId, oltLinks] of Array.from(linksByOlt.entries())) {
            const olt = await storage.getOlt(oltId);
            if (!olt) {
              console.log(`[Enrich] OLT ${oltId} not found, skipping ${oltLinks.length} links`);
              for (const link of oltLinks) {
                enrichmentProgress.skipped++;
                enrichmentProgress.processed++;
              }
              continue;
            }

            console.log(`[Enrich] Searching ONU IDs on ${olt.name} for ${oltLinks.length} links...`);

            for (let i = 0; i < oltLinks.length; i++) {
              const link = oltLinks[i];
              if (i > 0) await delay(1000);

              try {
                const searchStr = link.onuSearchString || link.equipmentSerialNumber!;
                const result = await searchOnuBySerial(olt, searchStr);

                if (result.success && result.onuId) {
                  const updateData: any = { onuId: result.onuId };
                  if (result.slotOlt !== undefined) updateData.slotOlt = result.slotOlt;
                  if (result.portOlt !== undefined) updateData.portOlt = result.portOlt;
                  await storage.updateLink(link.id, updateData);
                  console.log(`[Enrich] ${link.name}: ONU ID=${result.onuId} (slot=${result.slotOlt} port=${result.portOlt})`);
                  enrichmentProgress.success++;
                } else {
                  console.log(`[Enrich] ${link.name}: ONU not found (${result.message})`);
                  enrichmentProgress.skipped++;
                }
              } catch (err: any) {
                console.error(`[Enrich] ${link.name}: ONU error: ${err.message}`);
                enrichmentProgress.failed++;
                if (enrichmentProgress.errors.length < 50) {
                  enrichmentProgress.errors.push(`${link.name}: ${err.message}`);
                }
              }
              enrichmentProgress.processed++;
            }

            await delay(2000);
          }
          console.log(`[Enrich] ONU ID discovery done: ${enrichmentProgress.success} found`);
        }

        if (action === 'create_cpes' || action === 'discover_all') {
          enrichmentProgress.action = 'create_cpes';
          const allLinkCpeRows = await db.select().from(linkCpes);
          const linksWithCpeSet = new Set(allLinkCpeRows.map(lc => lc.linkId));
          const linksNeedingCpe = targetLinks.filter(l => l.monitoredIp && !linksWithCpeSet.has(l.id));
          enrichmentProgress.total += linksNeedingCpe.length;
          console.log(`[Enrich] Starting CPE creation for ${linksNeedingCpe.length} links`);

          // Cache de CPE padrão por vendorId (reusa em vez de criar uma CPE por link)
          const standardCpeByVendor = new Map<number, any>();
          // Fallback genérico (sem vendor): uma única CPE padrão "CPE padrão (sem fabricante)"
          let genericStandardCpe: any = null;

          for (const link of linksNeedingCpe) {
            try {
              const vendorId = link.equipmentVendorId ?? null;
              let cpe: any = null;

              if (vendorId) {
                cpe = standardCpeByVendor.get(vendorId);
                if (!cpe) {
                  cpe = await storage.getStandardCpeByVendor(vendorId);
                  if (cpe) standardCpeByVendor.set(vendorId, cpe);
                }
              }

              if (!cpe) {
                let vendorName = "";
                if (vendorId) {
                  const vendor = await storage.getEquipmentVendor(vendorId);
                  vendorName = vendor?.name?.toUpperCase() || "";
                }
                const cpeName = vendorName
                  ? `ONT ${vendorName}`
                  : `CPE padrão (sem fabricante)`;

                if (!vendorId && genericStandardCpe) {
                  cpe = genericStandardCpe;
                } else {
                  cpe = await storage.createCpe({
                    name: cpeName,
                    type: 'cpe',
                    vendorId: vendorId,
                    isStandard: true,
                    hasAccess: true,
                    ownership: 'marvitel',
                  } as any);
                  if (vendorId) standardCpeByVendor.set(vendorId, cpe);
                  else genericStandardCpe = cpe;
                }
              }

              await db.insert(linkCpes).values({
                linkId: link.id,
                cpeId: cpe.id,
                role: 'primary',
                ipOverride: link.monitoredIp!,
                macAddress: link.macAddress || null,
                showInEquipmentTab: true,
              } as any);

              enrichmentProgress.success++;
            } catch (err: any) {
              enrichmentProgress.failed++;
              if (enrichmentProgress.errors.length < 50) {
                enrichmentProgress.errors.push(`${link.name}: ${err.message}`);
              }
            }
            enrichmentProgress.processed++;
          }
          console.log(`[Enrich] CPE creation done: ${enrichmentProgress.success} created/linked`);
        }

        console.log(`[Enrich] Completed: ${enrichmentProgress.success} success, ${enrichmentProgress.skipped} skipped, ${enrichmentProgress.failed} failed out of ${enrichmentProgress.total}`);
      } catch (error: any) {
        console.error("[Enrich] Fatal error:", error);
        enrichmentProgress.errors.push(`Fatal: ${error.message}`);
      } finally {
        enrichmentProgress.running = false;
      }
    })();
  });

  // =====================================================================
  // AI Analyst — fila, propostas, regras, configurações
  // =====================================================================
  {
    const ai = await import("./ai-analyst");
    const z = (await import("zod")).z;

    // GET settings (chave nunca em claro)
    app.get("/api/admin/ai-analyst/settings", requireAuth, requireSuperAdmin, async (_req: Request, res: Response) => {
      try {
        const s = await storage.getAiAnalystSettings();
        const { apiKeyEncrypted, ...safe } = s as any;
        const hasEnvKey = !!(process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.length > 10);
        res.json({
          ...safe,
          hasApiKey: hasEnvKey || !!apiKeyEncrypted,
          apiKeySource: hasEnvKey ? "env" : (apiKeyEncrypted ? "database" : null),
        });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // PATCH settings (sem chave — usar endpoint próprio)
    app.patch("/api/admin/ai-analyst/settings", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
      try {
        const schema = z.object({
          provider: z.string().optional(),
          model: z.string().optional(),
          autonomyMode: z.enum(["suggestion", "hybrid", "auto"]).optional(),
          autoApplyConfidenceThreshold: z.number().int().min(0).max(100).optional(),
          processingEnabled: z.boolean().optional(),
          maxTasksPerMinute: z.number().int().min(1).max(60).optional(),
        });
        const data = schema.parse(req.body);
        const updated = await storage.updateAiAnalystSettings(data);
        const { apiKeyEncrypted, ...safe } = updated as any;
        res.json({ ...safe, hasApiKey: !!apiKeyEncrypted });
      } catch (err: any) {
        res.status(400).json({ error: err.message });
      }
    });

    // POST chave (criptografada)
    app.post("/api/admin/ai-analyst/api-key", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
      try {
        const { apiKey } = z.object({ apiKey: z.string().min(10) }).parse(req.body);
        await storage.setAiAnalystApiKey(apiKey);
        res.json({ ok: true });
      } catch (err: any) {
        res.status(400).json({ error: err.message });
      }
    });

    // DELETE chave
    app.delete("/api/admin/ai-analyst/api-key", requireAuth, requireSuperAdmin, async (_req: Request, res: Response) => {
      try {
        await storage.updateAiAnalystSettings({ apiKeyEncrypted: null } as any);
        res.json({ ok: true });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // GET fila de tasks
    app.get("/api/admin/ai-analyst/queue", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
      try {
        const status = typeof req.query.status === "string" ? req.query.status : undefined;
        const limit = req.query.limit ? Math.min(500, Number(req.query.limit)) : 100;
        const tasks = await storage.getAiAnalystTasks({ status, limit });
        res.json(tasks);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // POST enfileirar links
    app.post("/api/admin/ai-analyst/enqueue", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
      try {
        const schema = z.object({
          linkIds: z.array(z.number().int()).optional(),
          autoSelect: z.enum(["offline", "degraded"]).optional(),
          reason: z.string().min(1).default("manual"),
        });
        const { linkIds, autoSelect, reason } = schema.parse(req.body);
        const userId = (req as any).user?.id;
        let result: { enqueued: number; skipped: number };
        if (autoSelect === "offline") {
          result = await ai.enqueueOfflineLinks(userId);
        } else if (autoSelect === "degraded") {
          result = await ai.enqueueDegradedLinks(userId);
        } else if (linkIds && linkIds.length > 0) {
          result = await ai.enqueueLinksBulk(linkIds, reason, userId);
        } else {
          return res.status(400).json({ error: "informe linkIds ou autoSelect" });
        }
        res.json(result);
      } catch (err: any) {
        res.status(400).json({ error: err.message });
      }
    });

    // POST destravar tasks órfãs em "investigating" (recovery manual)
    app.post("/api/admin/ai-analyst/reclaim-stuck", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
      try {
        const schema = z.object({
          staleMinutes: z.number().int().min(1).max(1440).optional(),
          maxRetries: z.number().int().min(0).max(10).optional(),
          force: z.boolean().optional(),
        });
        const { staleMinutes, maxRetries, force } = schema.parse(req.body || {});
        // Se force=true, libera tudo (staleMinutes=0)
        const stale = force ? 0 : (staleMinutes ?? 15);
        const result = await storage.reclaimStuckAiAnalystTasks(stale, maxRetries ?? 2);
        // Também libera o mutex em memória (caso o serviço atual esteja preso)
        ai.forceReleaseProcessingLock("reclaim-stuck endpoint");
        res.json(result);
      } catch (err: any) {
        res.status(400).json({ error: err.message });
      }
    });

    // POST trigger manual de processamento (1 task)
    app.post("/api/admin/ai-analyst/process-next", requireAuth, requireSuperAdmin, async (_req: Request, res: Response) => {
      try {
        const result = await ai.processNextTask();
        res.json(result);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // POST iniciar processamento em lote (background) — count = quantas tasks processar (máx 500)
    app.post("/api/admin/ai-analyst/batch/start", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
      try {
        const schema = z.object({ count: z.number().int().min(1).max(500) });
        const { count } = schema.parse(req.body || {});
        const result = ai.startBatch(count);
        if (!result.started) return res.status(409).json(result);
        res.json({ ...result, status: ai.getBatchStatus() });
      } catch (err: any) {
        res.status(400).json({ error: err.message });
      }
    });

    // GET status do lote (polling pela UI)
    app.get("/api/admin/ai-analyst/batch/status", requireAuth, requireSuperAdmin, async (_req: Request, res: Response) => {
      res.json(ai.getBatchStatus());
    });

    // POST parar lote em andamento
    app.post("/api/admin/ai-analyst/batch/stop", requireAuth, requireSuperAdmin, async (_req: Request, res: Response) => {
      ai.requestBatchStop();
      res.json({ ok: true, status: ai.getBatchStatus() });
    });

    // GET propostas
    app.get("/api/admin/ai-analyst/proposals", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
      try {
        const status = typeof req.query.status === "string" ? req.query.status : undefined;
        const linkId = req.query.linkId ? Number(req.query.linkId) : undefined;
        const limit = req.query.limit ? Math.min(500, Number(req.query.limit)) : 100;
        const proposals = await storage.getAiAnalystProposals({ status, linkId, limit });
        res.json(proposals);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // POST aprovar (com possibilidade de editar campos)
    app.post("/api/admin/ai-analyst/proposals/:id/approve", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
      try {
        const id = Number(req.params.id);
        const schema = z.object({
          overrideFields: z.record(z.unknown()).optional(),
          reviewerNote: z.string().optional(),
        });
        const { overrideFields, reviewerNote } = schema.parse(req.body || {});
        const userId = (req as any).user?.id;
        const result = await ai.applyProposal(id, userId, "manual", overrideFields, reviewerNote);
        if (!result.ok) return res.status(400).json(result);
        res.json(result);
      } catch (err: any) {
        res.status(400).json({ error: err.message });
      }
    });

    // POST rejeitar
    app.post("/api/admin/ai-analyst/proposals/:id/reject", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
      try {
        const id = Number(req.params.id);
        const reviewerNote = typeof req.body?.reviewerNote === "string" ? req.body.reviewerNote : undefined;
        const userId = (req as any).user?.id;
        const result = await ai.rejectProposal(id, userId, reviewerNote);
        if (!result.ok) return res.status(400).json(result);
        res.json(result);
      } catch (err: any) {
        res.status(400).json({ error: err.message });
      }
    });

    // RULES — CRUD
    app.get("/api/admin/ai-analyst/rules", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
      try {
        const activeOnly = req.query.activeOnly !== "false";
        const rules = await storage.getAiAnalystRules(activeOnly);
        res.json(rules);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    app.post("/api/admin/ai-analyst/rules", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
      try {
        const schema = z.object({
          ruleText: z.string().min(3),
          scope: z.record(z.unknown()).optional(),
          priority: z.number().int().optional(),
          isActive: z.boolean().optional(),
        });
        const data = schema.parse(req.body);
        const userId = (req as any).user?.id;
        const rule = await storage.createAiAnalystRule({ ...data, createdByUserId: userId } as any);
        res.json(rule);
      } catch (err: any) {
        res.status(400).json({ error: err.message });
      }
    });

    app.patch("/api/admin/ai-analyst/rules/:id", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
      try {
        const id = Number(req.params.id);
        const schema = z.object({
          ruleText: z.string().min(3).optional(),
          scope: z.record(z.unknown()).optional(),
          priority: z.number().int().optional(),
          isActive: z.boolean().optional(),
        });
        const data = schema.parse(req.body);
        const rule = await storage.updateAiAnalystRule(id, data as any);
        if (!rule) return res.status(404).json({ error: "regra não encontrada" });
        res.json(rule);
      } catch (err: any) {
        res.status(400).json({ error: err.message });
      }
    });

    app.delete("/api/admin/ai-analyst/rules/:id", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
      try {
        const id = Number(req.params.id);
        await storage.deleteAiAnalystRule(id);
        res.json({ ok: true });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // ==================== Monsta (servidor de monitoramento legado) ====================
    const monsta = await import("./monsta");
    const { encrypt: encryptMonsta } = await import("./crypto");

    // GET configuração atual (sem chave em claro)
    app.get("/api/admin/monsta/settings", requireAuth, requireSuperAdmin, async (_req: Request, res: Response) => {
      try {
        const summary = await monsta.getConfigSummary();
        res.json(summary);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // PUT configuração — body: {host, port?, username?, privateKey?, isActive?}
    // privateKey só obrigatória na primeira vez; em updates, mantém a anterior se omitida.
    app.put("/api/admin/monsta/settings", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
      try {
        const host = String(req.body?.host || "").trim();
        const port = Math.max(1, Math.min(65535, Number(req.body?.port) || 2266));
        const username = String(req.body?.username || "").trim() || "monstaro";
        const privateKey = typeof req.body?.privateKey === "string" ? req.body.privateKey : "";
        const isActive = req.body?.isActive !== false;

        if (!host) return res.status(400).json({ error: "host obrigatório" });

        // Valida que o IP/host parece sane (sem metacaracteres)
        if (/[\s;|&`$()<>"'\\]/.test(host)) {
          return res.status(400).json({ error: "host contém caracteres inválidos" });
        }

        const apiUrl = JSON.stringify({ host, port, username });
        const existing = await db
          .select()
          .from(externalIntegrations)
          .where(eq(externalIntegrations.provider, monsta.MONSTA_PROVIDER))
          .limit(1);

        if (existing.length === 0) {
          // Insert: chave obrigatória
          if (!privateKey.trim()) {
            return res.status(400).json({ error: "privateKey obrigatória na primeira configuração" });
          }
          await db.insert(externalIntegrations).values({
            name: "Monsta (monitoramento legado)",
            provider: monsta.MONSTA_PROVIDER,
            isActive,
            apiKey: encryptMonsta(privateKey.trim()),
            apiUrl,
          });
        } else {
          // Update: se privateKey vazia, mantém a anterior
          const updates: any = { apiUrl, isActive, updatedAt: new Date() };
          if (privateKey.trim()) updates.apiKey = encryptMonsta(privateKey.trim());
          await db
            .update(externalIntegrations)
            .set(updates)
            .where(eq(externalIntegrations.id, existing[0].id));
        }

        monsta.invalidateConfig();
        const summary = await monsta.getConfigSummary();
        res.json(summary);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // GET ping — testa conectividade SSH+SQLite com servidor Monsta
    app.get("/api/admin/monsta/ping", requireAuth, requireSuperAdmin, async (_req: Request, res: Response) => {
      try {
        const result = await monsta.ping();
        res.json(result);
      } catch (err: any) {
        res.status(500).json({ ok: false, error: err.message });
      }
    });

    // GET status do device por IP
    app.get("/api/admin/monsta/device-status", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
      try {
        const ip = String(req.query.ip || "").trim();
        if (!ip) return res.status(400).json({ error: "ip é obrigatório" });
        const result = await monsta.getDeviceStatus(ip);
        res.json(result);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // GET eventos recentes do device por IP
    app.get("/api/admin/monsta/events", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
      try {
        const ip = String(req.query.ip || "").trim();
        if (!ip) return res.status(400).json({ error: "ip é obrigatório" });
        const hours = Math.min(168, Math.max(1, Number(req.query.hours) || 24));
        const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
        const result = await monsta.getRecentEvents(ip, hours, limit);
        res.json(result);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // GET busca devices por nome/IP parcial
    app.get("/api/admin/monsta/search", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
      try {
        const pattern = String(req.query.q || "").trim();
        if (!pattern) return res.status(400).json({ error: "q é obrigatório" });
        const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
        const result = await monsta.searchDevices(pattern, limit);
        res.json({ items: result });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // ==================== Auditoria de Pendências ====================
    const audit = await import("./link-audit");

    // GET listar pendências
    app.get("/api/admin/link-audit/pending", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
      try {
        const status = (req.query.status as string) || "pending";
        const items = await storage.getLinkPendingItems({
          status: status === "all" ? undefined : status.split(","),
          classification: (req.query.classification as string) || undefined,
          linkId: req.query.linkId ? Number(req.query.linkId) : undefined,
          clientId: req.query.clientId ? Number(req.query.clientId) : undefined,
          onlyProblematic: req.query.onlyProblematic === "true",
          limit: req.query.limit ? Math.min(2000, Number(req.query.limit)) : 500,
        });
        res.json(items);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // GET resumo (counts por status)
    app.get("/api/admin/link-audit/summary", requireAuth, requireSuperAdmin, async (_req: Request, res: Response) => {
      try {
        const counts = await storage.countLinkPendingItemsByStatus();
        const settings = await storage.getAiAnalystSettings();
        res.json({
          counts,
          lastAuditAt: (settings as any).lastAuditAt ?? null,
          dailyAuditEnabled: (settings as any).dailyAuditEnabled ?? true,
          dailyAuditHourUtc: (settings as any).dailyAuditHourUtc ?? 6,
          actionPolicy: (settings as any).actionPolicy ?? {},
          isRunning: audit.isAuditRunning(),
        });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // POST rodar auditoria sob demanda (background)
    app.post("/api/admin/link-audit/run", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
      try {
        if (audit.isAuditRunning()) {
          return res.status(409).json({ error: "Auditoria já em andamento" });
        }
        const onlyProblematic = req.body?.onlyProblematic === true;
        // Roda em background para não bloquear o request
        audit
          .runFullAudit({ onlyProblematic })
          .then((s) =>
            console.log(
              `[LinkAudit] manual: ${s.scannedLinks} links, ${s.generatedItems} novas, ${s.updatedItems} atualizadas, ${s.resolvedItems} resolvidas em ${s.durationMs}ms`
            )
          )
          .catch((err) => console.error("[LinkAudit] erro na execução manual:", err));
        res.json({ started: true });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // POST autorizar pendência
    app.post("/api/admin/link-audit/items/:id/authorize", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
      try {
        const id = Number(req.params.id);
        const schema = z.object({
          overrideValue: z.string().optional(),
          note: z.string().optional(),
        });
        const { overrideValue, note } = schema.parse(req.body || {});
        const userId = (req as any).user?.id;
        const result = await audit.authorizePendingItem(id, userId, overrideValue, note);
        if (!result.ok) return res.status(400).json(result);
        res.json(result);
      } catch (err: any) {
        res.status(400).json({ error: err.message });
      }
    });

    // POST dispensar pendência (com motivo — alimenta aprendizado da IA)
    app.post("/api/admin/link-audit/items/:id/dismiss", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
      try {
        const id = Number(req.params.id);
        const schema = z.object({ reason: z.string().min(3, "informe o motivo da dispensa") });
        const { reason } = schema.parse(req.body || {});
        const userId = (req as any).user?.id;
        const result = await audit.dismissPendingItem(id, userId, reason);
        if (!result.ok) return res.status(400).json(result);
        res.json(result);
      } catch (err: any) {
        res.status(400).json({ error: err.message });
      }
    });

    // POST adiar pendência
    app.post("/api/admin/link-audit/items/:id/snooze", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
      try {
        const id = Number(req.params.id);
        const schema = z.object({ hours: z.number().int().min(1).max(720).default(24) });
        const { hours } = schema.parse(req.body || {});
        const userId = (req as any).user?.id;
        const result = await audit.snoozePendingItem(id, userId, hours);
        if (!result.ok) return res.status(400).json(result);
        res.json(result);
      } catch (err: any) {
        res.status(400).json({ error: err.message });
      }
    });

    // POST investigar UMA pendência com IA (descobre suggestedValue via tools)
    app.post("/api/admin/link-audit/items/:id/investigate", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
      try {
        const id = Number(req.params.id);
        const result = await audit.investigatePendingItem(id);
        if (!result.ok) return res.status(400).json(result);
        res.json(result);
      } catch (err: any) {
        res.status(500).json({ error: err?.message || String(err) });
      }
    });

    // POST investigar EM LOTE todas as pendências sem suggestedValue (background)
    app.post("/api/admin/link-audit/investigate-batch", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
      try {
        if (audit.isInvestigationBatchRunning()) {
          return res.status(409).json({ error: "Já existe uma investigação em batch em andamento" });
        }
        const limit = req.body?.limit ? Math.min(200, Math.max(1, Number(req.body.limit))) : 50;
        // Background — responde imediato
        audit
          .investigateAllPendingWithoutValue(limit)
          .then((s) =>
            console.log(
              `[LinkAudit][AI batch] ${s.updated}/${s.total} atualizadas, ${s.errors} erros em ${s.durationMs}ms`
            )
          )
          .catch((err) => console.error("[LinkAudit][AI batch] erro:", err));
        res.json({ started: true, limit });
      } catch (err: any) {
        res.status(500).json({ error: err?.message || String(err) });
      }
    });

    // GET status do batch de investigação
    app.get("/api/admin/link-audit/investigate-status", requireAuth, requireSuperAdmin, async (_req: Request, res: Response) => {
      res.json({ running: audit.isInvestigationBatchRunning() });
    });

    // PATCH política de ação por campo
    app.patch("/api/admin/link-audit/policy", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
      try {
        const schema = z.object({
          actionPolicy: z.record(z.enum(["immediate", "authorize_only"])).optional(),
          dailyAuditEnabled: z.boolean().optional(),
          dailyAuditHourUtc: z.number().int().min(0).max(23).optional(),
        });
        const data = schema.parse(req.body);
        const updated = await storage.updateAiAnalystSettings(data as any);
        res.json({
          actionPolicy: (updated as any).actionPolicy,
          dailyAuditEnabled: (updated as any).dailyAuditEnabled,
          dailyAuditHourUtc: (updated as any).dailyAuditHourUtc,
        });
      } catch (err: any) {
        res.status(400).json({ error: err.message });
      }
    });
  }

  return httpServer;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

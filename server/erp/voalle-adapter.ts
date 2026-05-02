import type { ErpIntegration, Incident } from "@shared/schema";
import type { ErpAdapter, ErpCustomer, ErpContract, ErpTicket, ErpTestResult, CreateTicketParams } from "./types";

interface VoalleAuthResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
}

interface VoalleProviderConfig {
  apiUsername?: string;
  apiPassword?: string;
  apiSynData?: string;
  // Portal API credentials (segunda API do Voalle)
  portalApiUrl?: string;
  portalVerifyToken?: string;
  portalClientId?: string;
  portalClientSecret?: string;
  portalUsername?: string;
  portalPassword?: string;
}

export class VoalleAdapter implements ErpAdapter {
  readonly provider = "voalle";
  private config: ErpIntegration | null = null;
  private providerConfig: VoalleProviderConfig | null = null;
  private accessToken: string | null = null;
  private tokenExpiresAt: Date | null = null;
  // Portal API token (segunda API)
  private portalAccessToken: string | null = null;
  private portalTokenExpiresAt: Date | null = null;
  // Cache da lista global de conexões (/external/map/connection/all) usada como
  // fallback de descoberta de voalleConnectionId quando o Portal v2 falha.
  // Endpoint pesado (retorna TODAS as conexões do Voalle), por isso TTL de 10min.
  // ESTÁTICO: configureErpAdapter() cria nova instância a cada request, então
  // o cache PRECISA ser compartilhado entre instâncias para o TTL ter efeito.
  // A lista é global do Voalle (não por cliente), então não há vazamento entre
  // tenants — o multi-tenancy é resolvido na hora do MATCH pelo caller, não no cache.
  private static allConnectionsCache: Array<{ id: number; user?: string; serviceTag?: string; peopleId?: number }> | null = null;
  private static allConnectionsCacheAt: number = 0;
  private static readonly ALL_CONNECTIONS_CACHE_TTL_MS = 10 * 60 * 1000;

  // Cache de detalhes de solicitações (POST /projects/getsolicitationdata).
  // TTL curto (60s) — usado tanto pelo enrichment do filtro quanto pela UI ao
  // expandir o card. Deduplica requests in-flight pela Promise armazenada.
  // Cache estático porque configureErpAdapter() cria nova instância por request.
  // Multi-tenant: a chave é só assignmentId, mas a CHAMADA já passa por
  // getOpenSolicitations(voalleCustomerId) com IDOR check antes — então só
  // cachemos IDs já validados.
  private static solicitationDataCache: Map<number, { promise: Promise<any>; at: number }> = new Map();
  private static readonly SOLICITATION_DATA_CACHE_TTL_MS = 60 * 1000;
  private static readonly SOLICITATION_DATA_CACHE_MAX_ENTRIES = 500;

  configure(config: ErpIntegration): void {
    let apiUrl = (config.apiUrl || "").trim();
    if (apiUrl.endsWith("/")) {
      apiUrl = apiUrl.slice(0, -1);
    }
    const portMatch = apiUrl.match(/:(\d+)$/);
    if (portMatch) {
      apiUrl = apiUrl.replace(/:(\d+)$/, "");
    }
    this.config = { ...config, apiUrl };
    
    // Parse providerConfig for Voalle-specific credentials
    if (config.providerConfig) {
      try {
        this.providerConfig = JSON.parse(config.providerConfig);
      } catch {
        this.providerConfig = null;
      }
    } else {
      this.providerConfig = null;
    }
    
    this.accessToken = null;
    this.tokenExpiresAt = null;
    this.portalAccessToken = null;
    this.portalTokenExpiresAt = null;
    // Invalida caches estáticos quando a integração é reconfigurada (troca de URL/credencial)
    // pra não servir dados do Voalle anterior durante a janela de TTL.
    VoalleAdapter.allConnectionsCache = null;
    VoalleAdapter.allConnectionsCacheAt = 0;
    VoalleAdapter.solicitationDataCache.clear();
  }

  isConfigured(): boolean {
    // Check if we have password grant credentials (preferred)
    if (this.config && this.config.apiUrl && this.providerConfig) {
      const { apiUsername, apiPassword, apiSynData } = this.providerConfig;
      if (apiUsername && apiPassword && apiSynData) {
        return true;
      }
    }
    // Fallback to client_credentials if configured
    return this.config !== null &&
      this.config.apiUrl !== "" &&
      this.config.apiClientId !== "" &&
      this.config.apiClientSecret !== "";
  }

  private async authenticate(): Promise<string> {
    if (!this.config || !this.config.apiUrl) {
      throw new Error("Voalle não configurado");
    }

    if (this.accessToken && this.tokenExpiresAt && new Date() < this.tokenExpiresAt) {
      return this.accessToken;
    }

    const authUrl = `${this.config.apiUrl}:45700/connect/token`;

    // Check if we should use password grant (preferred method)
    if (this.providerConfig?.apiUsername && this.providerConfig?.apiPassword && this.providerConfig?.apiSynData) {
      console.log(`[VoalleAdapter] Autenticando via password grant (user: ${this.providerConfig.apiUsername.substring(0, 6)}...)`);
      const body = new URLSearchParams({
        grant_type: "password",
        scope: "syngw synpaygw offline_access",
        client_id: "synauth",
        client_secret: "df956154024a425eb80f1a2fc12fef0c",
        username: this.providerConfig.apiUsername,
        password: this.providerConfig.apiPassword,
        syndata: this.providerConfig.apiSynData,
      });

      const response = await fetch(authUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Falha na autenticação Voalle (password): ${response.status} - ${errorText}`);
      }

      const data = await response.json() as VoalleAuthResponse;
      this.accessToken = data.access_token;
      this.tokenExpiresAt = new Date(Date.now() + (data.expires_in - 60) * 1000);

      return this.accessToken;
    }

    // Fallback to client_credentials grant
    const ccParams: Record<string, string> = {
      grant_type: "client_credentials",
      scope: "syngw",
      client_id: this.config.apiClientId || "",
      client_secret: this.config.apiClientSecret || "",
    };
    if (this.providerConfig?.apiSynData) {
      ccParams.syndata = this.providerConfig.apiSynData;
    }
    console.log(`[VoalleAdapter] Autenticando via client_credentials (syndata: ${ccParams.syndata ? 'sim' : 'NÃO'})`);
    const body = new URLSearchParams(ccParams);

    const response = await fetch(authUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Falha na autenticação Voalle: ${response.status} - ${errorText}`);
    }

    const data = await response.json() as VoalleAuthResponse;
    this.accessToken = data.access_token;
    this.tokenExpiresAt = new Date(Date.now() + (data.expires_in - 60) * 1000);

    return this.accessToken;
  }

  private async mapApiRequest<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    if (!this.config || !this.config.apiUrl) {
      throw new Error("Voalle não configurado");
    }

    const token = await this.authenticate();
    const url = `${this.config.apiUrl}:45715${path}`;

    const headers: Record<string, string> = {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    };

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Voalle Map API error: ${response.status} - ${errorText}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Lista o status técnico de TODAS as conexões no Voalle.
   * Endpoint: GET /external/map/connection/all
   * Status retornados: 1=Normal, 2=Bloqueada, 3=Aviso de Bloqueio, 4=Aviso de Manutenção
   */
  async getAllConnectionStatus(): Promise<Array<{
    id: number;
    status: "normal" | "blocked" | "block_warning" | "maintenance_warning" | "unknown";
    statusRaw: number;
    user?: string;
    serviceTag?: string;
    peopleId?: number;
  }>> {
    // Propaga erro para o caller — quem chama (sync) precisa diferenciar
    // "Voalle retornou 0 conexões" (sucesso legítimo) de "falha de integração"
    // (token expirado, endpoint fora, payload inválido) para não silenciar regressões.
    // peopleId/personId/customerId é capturado quando vier no payload — usado pelo
    // fallback de descoberta para validar pertencimento ao cliente esperado.
    const result = await this.mapApiRequest<{
      success: boolean;
      response: Array<{
        id: number;
        user?: string;
        serviceTag?: string;
        status: number;
        peopleId?: number;
        personId?: number;
        customerId?: number;
      }>;
    }>("GET", "/external/map/connection/all");

    if (!result.success || !Array.isArray(result.response)) {
      throw new Error(
        `Voalle retornou resposta inválida em /external/map/connection/all (success=${result.success}, response.isArray=${Array.isArray(result.response)})`
      );
    }

    const statusMap: Record<number, "normal" | "blocked" | "block_warning" | "maintenance_warning" | "unknown"> = {
      1: "normal",
      2: "blocked",
      3: "block_warning",
      4: "maintenance_warning",
    };

    return result.response.map(c => ({
      id: c.id,
      status: statusMap[c.status] ?? "unknown",
      statusRaw: c.status,
      user: c.user,
      serviceTag: c.serviceTag,
      // Tolera variações de nome (Voalle nem sempre documenta — capta qualquer um)
      peopleId: c.peopleId ?? c.personId ?? c.customerId,
    }));
  }

  /**
   * Fallback de descoberta de connectionId via API ERPVOALLE de TERCEIROS,
   * usado quando o Portal v2 NÃO está disponível (cliente sem credencial OU
   * Portal v2 retornou 403 Bad Credentials).
   *
   * Estratégia: chama /external/map/connection/all (que já é usado pelo sync
   * horário de status) e filtra LOCALMENTE pelo serviceTag (preferido) ou pelo
   * pppoeUser. A lista é cacheada estaticamente por 10min — o endpoint retorna
   * TODAS as conexões do Voalle, então NÃO pode ser chamado por link.
   *
   * Multi-tenant: quando `expectedVoalleCustomerId` é passado E o payload do Voalle
   * traz `peopleId` (pode vir como peopleId/personId/customerId), o match é VALIDADO
   * contra o cliente esperado — REJEITA a conexão se o peopleId não bater (proteção
   * contra colisão de pppoeUser/serviceTag entre clientes diferentes). Quando o
   * payload NÃO traz peopleId, a busca cai apenas em match exato de serviceTag/user
   * (que no domínio Voalle são identificadores únicos de contrato/autenticação).
   *
   * Retorna `null` quando não encontra (sem throw — caller decide o que fazer).
   * Propaga erro APENAS se a chamada à API falhar.
   */
  async findConnectionViaThirdparty(criteria: {
    serviceTag?: string | null;
    pppoeUser?: string | null;
    expectedVoalleCustomerId?: number | string | null;
  }): Promise<{ id: number; user?: string; serviceTag?: string; peopleId?: number } | null> {
    const wantedTag = criteria.serviceTag?.toLowerCase().trim() || "";
    const wantedUser = criteria.pppoeUser?.toLowerCase().trim() || "";
    const expectedCustomerId = criteria.expectedVoalleCustomerId
      ? Number(criteria.expectedVoalleCustomerId)
      : null;

    if (!wantedTag && !wantedUser) {
      return null;
    }

    const now = Date.now();
    const cacheValid =
      VoalleAdapter.allConnectionsCache !== null &&
      (now - VoalleAdapter.allConnectionsCacheAt) < VoalleAdapter.ALL_CONNECTIONS_CACHE_TTL_MS;

    if (!cacheValid) {
      console.log(`[VoalleAdapter] Fallback thirdparty: recarregando lista global de conexões (cache estático expirou ou vazio)`);
      const all = await this.getAllConnectionStatus();
      VoalleAdapter.allConnectionsCache = all.map(c => ({
        id: c.id,
        user: c.user,
        serviceTag: c.serviceTag,
        peopleId: c.peopleId,
      }));
      VoalleAdapter.allConnectionsCacheAt = now;
      console.log(`[VoalleAdapter] Fallback thirdparty: ${VoalleAdapter.allConnectionsCache.length} conexões em cache (peopleId presente em ${VoalleAdapter.allConnectionsCache.filter(c => c.peopleId !== undefined).length})`);
    }

    const list = VoalleAdapter.allConnectionsCache!;

    // Helper de validação multi-tenant: aceita conexão APENAS se peopleId bater
    // com o cliente esperado (quando ambos os lados estiverem disponíveis).
    // Quando peopleId não vier no payload do Voalle, aceita o match (degraded mode).
    const passesTenantCheck = (conn: { peopleId?: number }, label: string): boolean => {
      if (!expectedCustomerId) return true; // caller não passou cliente esperado
      if (conn.peopleId === undefined) {
        console.warn(`[VoalleAdapter] Fallback thirdparty: ${label} — payload sem peopleId, pulando validação de tenant (degraded)`);
        return true;
      }
      if (conn.peopleId !== expectedCustomerId) {
        console.warn(`[VoalleAdapter] Fallback thirdparty: REJEITADO ${label} — peopleId=${conn.peopleId} ≠ esperado=${expectedCustomerId} (proteção multi-tenant)`);
        return false;
      }
      return true;
    };

    if (wantedTag) {
      const matchByTag = list.find(
        c => c.serviceTag && c.serviceTag.toLowerCase().trim() === wantedTag,
      );
      if (matchByTag && passesTenantCheck(matchByTag, `match por serviceTag '${wantedTag}'`)) {
        console.log(`[VoalleAdapter] Fallback thirdparty: connectionId ${matchByTag.id} descoberto via serviceTag '${wantedTag}'`);
        return matchByTag;
      }
    }

    if (wantedUser) {
      const matchByUser = list.find(
        c => c.user && c.user.toLowerCase().trim() === wantedUser,
      );
      if (matchByUser && passesTenantCheck(matchByUser, `match por pppoeUser '${wantedUser}'`)) {
        console.log(`[VoalleAdapter] Fallback thirdparty: connectionId ${matchByUser.id} descoberto via pppoeUser '${wantedUser}'`);
        return matchByUser;
      }
    }

    console.log(`[VoalleAdapter] Fallback thirdparty: nenhuma conexão encontrada (serviceTag='${wantedTag || '-'}', pppoeUser='${wantedUser || '-'}', expectedCustomerId=${expectedCustomerId || '-'})`);
    return null;
  }

  /**
   * Lista conexões EXCLUÍDAS no Voalle (contrato cancelado / conexão removida).
   * Endpoint: GET /external/map/connection/all/deleted
   *
   * Diferente de /all, o payload não traz o campo `status` no nível raiz —
   * o estado é refletido em `contract.statusDescription` (ex.: "Cancelado").
   * Para o sync, todas essas conexões são marcadas como "deleted" no Link Monitor,
   * independentemente do status do contrato (a presença na lista de excluídas já
   * indica que a conexão técnica não existe mais no Voalle).
   *
   * Propaga erro para o caller (mesmo tratamento de getAllConnectionStatus).
   */
  async getAllDeletedConnectionStatus(): Promise<Array<{
    id: number;
    user?: string;
    serviceTag?: string;
    contractStatusDescription?: string;
  }>> {
    const result = await this.mapApiRequest<{
      success: boolean;
      response: Array<{
        id: number;
        user?: string;
        serviceTag?: string;
        contract?: { id: number; status: number; statusDescription: string } | null;
      }>;
    }>("GET", "/external/map/connection/all/deleted");

    if (!result.success || !Array.isArray(result.response)) {
      throw new Error(
        `Voalle retornou resposta inválida em /external/map/connection/all/deleted (success=${result.success}, response.isArray=${Array.isArray(result.response)})`
      );
    }

    return result.response.map(c => ({
      id: c.id,
      user: c.user,
      serviceTag: c.serviceTag,
      contractStatusDescription: c.contract?.statusDescription,
    }));
  }

  private async apiRequest<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    if (!this.config || !this.config.apiUrl) {
      throw new Error("Voalle não configurado");
    }

    const token = await this.authenticate();
    const url = `${this.config.apiUrl}:45715/external/integrations/thirdparty${path}`;

    const headers: Record<string, string> = {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    };

    const synV1Token = this.config.apiSynV1Token || process.env.VOALLE_SYN_V1_TOKEN;
    if (synV1Token) {
      headers["syn-v1-token"] = synV1Token;
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Voalle API error: ${response.status} - ${errorText}`);
    }

    return response.json() as Promise<T>;
  }

  // ========== Portal API (segunda API do Voalle) ==========
  
  // Credenciais do cliente atual para autenticação no Portal
  private currentPortalUsername: string | null = null;
  
  private isPortalConfigured(): boolean {
    if (!this.providerConfig) return false;
    const { portalApiUrl, portalVerifyToken, portalClientId, portalClientSecret } = this.providerConfig;
    // Não exigimos portalUsername/portalPassword globais - são definidos por cliente
    return !!(portalApiUrl && portalVerifyToken && portalClientId && portalClientSecret);
  }

  private async portalAuthenticate(portalUsername: string, portalPassword: string): Promise<string> {
    if (!this.providerConfig) {
      throw new Error("Portal Voalle não configurado");
    }

    const { portalApiUrl, portalVerifyToken, portalClientId, portalClientSecret } = this.providerConfig;
    
    if (!portalApiUrl || !portalVerifyToken || !portalClientId || !portalClientSecret) {
      throw new Error("Credenciais do Portal Voalle incompletas");
    }
    
    if (!portalUsername || !portalPassword) {
      throw new Error("Credenciais do Portal (username/password) necessárias para autenticação");
    }

    // Check if token is still valid AND for the same client
    if (this.portalAccessToken && this.portalTokenExpiresAt && new Date() < this.portalTokenExpiresAt && this.currentPortalUsername === portalUsername) {
      return this.portalAccessToken;
    }

    // Build authentication URL - usa credenciais específicas do cliente
    let baseUrl = portalApiUrl.trim();
    if (baseUrl.endsWith("/")) {
      baseUrl = baseUrl.slice(0, -1);
    }
    
    const authUrl = `${baseUrl}/portal_authentication?verify_token=${encodeURIComponent(portalVerifyToken)}&client_id=${encodeURIComponent(portalClientId)}&client_secret=${encodeURIComponent(portalClientSecret)}&grant_type=client_credentials&username=${encodeURIComponent(portalUsername)}&password=${encodeURIComponent(portalPassword)}`;

    console.log(`[VoalleAdapter] Portal auth URL: ${baseUrl}/portal_authentication`);

    const response = await fetch(authUrl, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Falha na autenticação Portal Voalle: ${response.status} - ${errorText}`);
    }

    const data = await response.json() as {
      access_token: string;
      expires_in: number;
      token_type: string;
      person?: { id: number; name: string };
    };

    this.portalAccessToken = data.access_token;
    this.portalTokenExpiresAt = new Date(Date.now() + (data.expires_in - 60) * 1000);
    this.currentPortalUsername = portalUsername;

    console.log(`[VoalleAdapter] Portal autenticado para ${portalUsername}, token expira em ${data.expires_in}s`);
    return this.portalAccessToken;
  }

  private async portalApiRequest<T>(
    method: string,
    path: string,
    portalUsername: string,
    portalPassword: string,
    body?: unknown
  ): Promise<T> {
    if (!this.providerConfig?.portalApiUrl) {
      throw new Error("Portal Voalle não configurado");
    }

    const token = await this.portalAuthenticate(portalUsername, portalPassword);
    
    let baseUrl = this.providerConfig.portalApiUrl.trim();
    if (baseUrl.endsWith("/")) {
      baseUrl = baseUrl.slice(0, -1);
    }
    
    const url = `${baseUrl}${path}`;

    const headers: Record<string, string> = {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "Verify-Token": this.providerConfig.portalVerifyToken || "",
    };

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Portal Voalle API error: ${response.status} - ${errorText}`);
    }

    return response.json() as Promise<T>;
  }

  async testConnection(): Promise<ErpTestResult> {
    if (!this.config) {
      return { success: false, message: "Voalle não configurado" };
    }

    try {
      await this.authenticate();
      return { success: true, message: "Conexão com Voalle estabelecida com sucesso" };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro desconhecido";
      return { success: false, message: `Falha na conexão: ${message}` };
    }
  }

  async searchCustomers(query: string): Promise<ErpCustomer[]> {
    try {
      // Voalle uses /getclient endpoint with pagination
      // We need to fetch all pages to find the customer
      type VoalleClient = {
        id: number;
        name: string;
        name2?: string;
        txId?: string;
        txIdFormated?: string;
        email?: string;
        emailNfe?: string;
        phone?: string;
        cellPhone1?: string;
        city?: string;
        state?: string;
        client?: boolean;
      };

      type VoalleResponse = {
        success: boolean;
        response: {
          data: VoalleClient[];
          totalRecords: number;
          page: number;
          pageSize: number;
        };
      };

      const allClients: VoalleClient[] = [];
      const pageSize = 500;
      let currentPage = 1;
      let totalRecords = 0;
      const maxPages = 20; // Safety limit: 10,000 clients max

      // Fetch all pages
      do {
        const result = await this.apiRequest<VoalleResponse>(
          "GET", 
          `/getclient?page=${currentPage}&pageSize=${pageSize}`
        );

        if (!result.success || !result.response?.data) {
          console.log("[Voalle Search] No data in response at page:", currentPage);
          break;
        }

        if (currentPage === 1) {
          totalRecords = result.response.totalRecords;
          console.log("[Voalle Search] Total records in Voalle:", totalRecords);
        }

        allClients.push(...result.response.data);
        console.log(`[Voalle Search] Page ${currentPage}: fetched ${result.response.data.length} clients (total: ${allClients.length})`);

        currentPage++;
      } while (allClients.length < totalRecords && currentPage <= maxPages);

      console.log("[Voalle Search] Total clients fetched:", allClients.length);

      // Filter by query (name, document, email) on our side
      const queryLower = query.toLowerCase();
      const queryClean = queryLower.replace(/[.\-\/]/g, "");
      
      return allClients
        .filter(p => {
          const name = (p.name || "").toLowerCase();
          const name2 = (p.name2 || "").toLowerCase();
          const doc = (p.txId || p.txIdFormated || "").toLowerCase().replace(/[.\-\/]/g, "");
          return name.includes(queryLower) || name2.includes(queryLower) || doc.includes(queryClean);
        })
        .slice(0, 50)
        .map(p => ({
          id: p.id.toString(),
          code: p.txId || p.txIdFormated || "",
          name: p.name,
          document: p.txIdFormated || p.txId,
          email: p.email || p.emailNfe,
          phone: p.phone || p.cellPhone1,
          city: p.city,
          state: p.state,
        }));
    } catch (error) {
      console.error("Erro ao buscar clientes Voalle:", error);
      return [];
    }
  }

  async getCustomer(customerId: string): Promise<ErpCustomer | null> {
    try {
      const result = await this.apiRequest<{
        id: number;
        tx_id: string;
        tx_name: string;
        cpf_cnpj?: string;
        email?: string;
        phone?: string;
      }>("GET", `/people/${customerId}`);

      return {
        id: result.id.toString(),
        code: result.tx_id,
        name: result.tx_name,
        document: result.cpf_cnpj,
        email: result.email,
        phone: result.phone,
      };
    } catch (error) {
      console.error(`Erro ao buscar cliente ${customerId}:`, error);
      return null;
    }
  }

  async getCustomerContracts(customerId: string): Promise<ErpContract[]> {
    try {
      const result = await this.apiRequest<Array<{
        id: number;
        client_id: number;
        description?: string;
        status: string;
        download?: number;
        ip_block?: string;
      }>>("GET", `/people/${customerId}/contracts`);

      return result.map(c => ({
        id: c.id.toString(),
        customerId: c.client_id.toString(),
        description: c.description,
        status: c.status,
        bandwidth: c.download,
        ipBlock: c.ip_block,
      }));
    } catch (error) {
      console.error(`Erro ao buscar contratos do cliente ${customerId}:`, error);
      return [];
    }
  }

  async createTicket(params: CreateTicketParams): Promise<{
    success: boolean;
    ticketId?: string;
    protocol?: string;
    message: string;
  }> {
    if (!this.config) {
      return { success: false, message: "Voalle não configurado" };
    }

    try {
      const { solicitationTypeCode, incident, linkName, linkLocation } = params;

      const failureReasonMap: Record<string, string> = {
        "falha_eletrica": "Falha Elétrica",
        "rompimento_fibra": "Rompimento de Fibra",
        "falha_equipamento": "Falha de Equipamento",
        "indefinido": "Causa Indefinida",
      };

      const subject = `[Link Monitor] Incidente - ${linkName}`;
      const description = `
Incidente detectado automaticamente pelo sistema Link Monitor.

Link: ${linkName}
Local: ${linkLocation}
Causa: ${failureReasonMap[incident.failureReason || "indefinido"] || "Indefinida"}
Origem: ${incident.failureSource || "Não identificada"}
Abertura: ${new Date(incident.openedAt).toLocaleString("pt-BR")}
${incident.description ? `\nDescrição: ${incident.description}` : ""}

---
Incidente #${incident.id} | Protocolo interno: ${incident.protocol || "N/A"}
      `.trim();

      const requestBody = {
        solicitationTypeCode,
        subject,
        description,
        priority: "media",
        originCode: "link_monitor",
        personId: params.customerId ? parseInt(params.customerId) : undefined,
        contractId: params.contractId ? parseInt(params.contractId) : undefined,
      };

      const result = await this.apiRequest<{
        id: number;
        protocol: string;
        status: string;
        createdAt: string;
      }>("POST", "/servicedesk/protocol", requestBody);

      return {
        success: true,
        ticketId: result.id?.toString(),
        protocol: result.protocol || result.id?.toString(),
        message: `Protocolo ${result.protocol || result.id} criado com sucesso no Voalle`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro desconhecido";
      return { success: false, message: `Falha ao criar protocolo: ${message}` };
    }
  }

  async getTicket(ticketId: string): Promise<ErpTicket | null> {
    try {
      const result = await this.apiRequest<{
        id: number;
        protocol: string;
        subject: string;
        description: string;
        status: string;
        priority?: string;
        createdAt: string;
        lastUpdateAt?: string;
        clientId?: number;
      }>("GET", `/servicedesk/protocol/${ticketId}`);

      return {
        id: result.id.toString(),
        protocol: result.protocol,
        subject: result.subject,
        description: result.description,
        status: result.status,
        priority: result.priority,
        createdAt: result.createdAt,
        updatedAt: result.lastUpdateAt,
        customerId: result.clientId?.toString(),
      };
    } catch (error) {
      console.error(`Erro ao buscar ticket ${ticketId}:`, error);
      return null;
    }
  }

  async getSolicitationTypes(): Promise<Array<{ code: string; name: string }>> {
    try {
      const result = await this.apiRequest<Array<{
        code: string;
        name: string;
      }>>("GET", "/servicedesk/solicitation-types");

      return result;
    } catch (error) {
      console.error("Erro ao buscar tipos de solicitação:", error);
      return [];
    }
  }

  async getOpenSolicitations(customerId?: number, allAssignments: boolean = false): Promise<Array<{
    id: number;
    protocol: string;
    subject: string;
    description: string;
    status: string;
    team?: string;
    sectorArea?: string;
    createdAt?: string;
    closedAt?: string;
    contractServiceTag?: string;
    connectionId?: number;
  }>> {
    if (!customerId) {
      console.log("[VoalleAdapter] getOpenSolicitations: customerId não fornecido");
      return [];
    }

    try {
      // Endpoint: /solicitationlist/{clientId}?allAssignments=True/False
      const path = `/solicitationlist/${customerId}?allAssignments=${allAssignments ? 'True' : 'False'}`;
      
      console.log(`[VoalleAdapter] Buscando solicitações: ${path}`);
      
      const result = await this.apiRequest<{
        success: boolean;
        messages: string | null;
        response: {
          data: Array<{
            assignmentId: number;
            protocol: number;
            title: string;
            status: string;
            team?: string;
            sectorArea?: string;
            beginningData?: string;
            finalData?: string;
            contractServiceTag?: string;
            connectionId?: number;
            authenticationId?: number;
            serviceTag?: string;
          }>;
          totalRecords?: number;
        };
      }>("GET", path);
      
      if (!result.success || !result.response?.data) {
        console.log("[VoalleAdapter] Resposta sem dados:", result);
        return [];
      }

      // Log primeiro registro CRU para debug — mostra todos os campos e seus valores
      // (em uma linha só pra journalctl não truncar). Útil para descobrir qual campo
      // do Voalle liga o ticket ao link quando o filtro zera tudo.
      if (result.response.data.length > 0) {
        console.log(`[VoalleAdapter] Ticket cru #1 (de ${result.response.data.length}): ${JSON.stringify(result.response.data[0])}`);
      }

      // Mapear resposta bruta para formato normalizado
      const solicitations = result.response.data.map((raw) => ({
        id: raw.assignmentId,
        protocol: String(raw.protocol),
        subject: raw.title,
        description: raw.title,
        status: raw.status,
        team: raw.team,
        sectorArea: raw.sectorArea,
        createdAt: raw.beginningData,
        closedAt: raw.finalData,
        contractServiceTag: raw.contractServiceTag || raw.serviceTag,
        connectionId: raw.connectionId || raw.authenticationId,
      }));

      console.log(`[VoalleAdapter] Encontradas ${solicitations.length} solicitações`);
      return solicitations;
    } catch (error) {
      // Propaga o erro pra rota chamadora poder diferenciar
      // "0 solicitações" (sucesso) de "falha de integração" (5xx).
      // Antes retornávamos [] silenciosamente, o que fazia a validação de IDOR
      // confundir indisponibilidade do Voalle com "assignment não pertence ao cliente".
      console.error("[VoalleAdapter] Erro ao buscar solicitações abertas:", error);
      throw error;
    }
  }

  /**
   * Busca os relatos (history) de uma solicitação específica.
   * Endpoint: /external/integrations/thirdparty/getsolicitationhistory?assignmentId={id}
   */
  async getSolicitationHistory(assignmentId: number): Promise<Array<{
    id: number;
    typeOperation?: number;
    title: string;
    description: string;
    beginningDate?: string;
    finalDate?: string;
    private?: boolean;
    personId?: number;
    personName?: string;
    teamId?: number;
    teamName?: string;
  }>> {
    if (!assignmentId) {
      console.log("[VoalleAdapter] getSolicitationHistory: assignmentId não fornecido");
      return [];
    }

    try {
      const path = `/getsolicitationhistory?assignmentId=${assignmentId}`;
      console.log(`[VoalleAdapter] Buscando relatos: ${path}`);

      // Este endpoint retorna array direto (sem wrapper response.data).
      const result = await this.apiRequest<unknown>("GET", path);

      // O Voalle às vezes embrulha em {response: {data: [...]}}, às vezes devolve array cru.
      let rawList: any[] = [];
      if (Array.isArray(result)) {
        rawList = result;
      } else if (result && typeof result === 'object') {
        const r = result as any;
        if (Array.isArray(r.response?.data)) rawList = r.response.data;
        else if (Array.isArray(r.data)) rawList = r.data;
        else if (Array.isArray(r.response)) rawList = r.response;
      }

      if (rawList.length === 0) {
        console.log(`[VoalleAdapter] Nenhum relato encontrado para assignmentId=${assignmentId}`);
        return [];
      }

      const history = rawList.map((raw: any) => ({
        id: raw.id,
        typeOperation: raw.typeOperation,
        title: raw.title || '',
        description: raw.description || '',
        beginningDate: raw.beginningDate,
        finalDate: raw.finalDate,
        private: raw.private,
        personId: raw.personId,
        personName: raw.person?.name,
        teamId: raw.teamId,
        teamName: raw.team?.name,
      }));

      console.log(`[VoalleAdapter] ${history.length} relatos encontrados para assignmentId=${assignmentId}`);
      return history;
    } catch (error) {
      console.error(`[VoalleAdapter] Erro ao buscar relatos da solicitação ${assignmentId}:`, error);
      throw error;
    }
  }

  /**
   * Sanitiza mensagens de erro vindas do Voalle para evitar vazamento de credenciais.
   * Cobre 3 formatos: (1) JSON estruturado (parse + mask recursivo de chaves sensíveis),
   * (2) `key=value` / `key: value` literais, (3) JSON-quoted `"key":"value"`.
   */
  private static readonly SENSITIVE_KEY_REGEX = /^(.*(token|password|secret|authorization|bearer|api[_-]?key).*)$/i;

  private static maskSensitiveStructured(value: unknown, depth = 0): unknown {
    if (depth > 6) return '[TRUNCATED]';
    if (Array.isArray(value)) return value.map(v => VoalleAdapter.maskSensitiveStructured(v, depth + 1));
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = VoalleAdapter.SENSITIVE_KEY_REGEX.test(k)
          ? '[REDACTED]'
          : VoalleAdapter.maskSensitiveStructured(v, depth + 1);
      }
      return out;
    }
    return value;
  }

  /** Mascara segredos numa string literal (cobre key=value, key: value e "key":"value"). */
  private static maskSensitiveString(s: string): string {
    return s
      // "key":"value" ou "key": "value"  (JSON quoted)
      .replace(/"(token|password|secret|authorization|bearer|api[_-]?key|access[_-]?token|client[_-]?secret|refresh[_-]?token)"\s*:\s*"[^"]*"/gi,
        '"$1":"[REDACTED]"')
      // key=value ou key: value (sem aspas) — para até espaço, vírgula, & ou aspas
      .replace(/(token|password|secret|authorization|bearer|api[_-]?key|access[_-]?token|client[_-]?secret|refresh[_-]?token)\s*[=:]\s*"?[^\s,&"']+"?/gi,
        '$1=[REDACTED]');
  }

  static sanitizeErrorMessage(input: unknown): string {
    if (input === undefined || input === null) return 'success=false sem mensagem';
    // Se for objeto/array, mascara recursivamente e serializa.
    if (typeof input === 'object') {
      try {
        return JSON.stringify(VoalleAdapter.maskSensitiveStructured(input));
      } catch {
        return '[mensagem não serializável]';
      }
    }
    const str = String(input);
    // Tenta tratar como JSON serializado: se parseia, mascara estrutural;
    // caso contrário, mascara como string literal.
    const trimmed = str.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        return JSON.stringify(VoalleAdapter.maskSensitiveStructured(parsed));
      } catch {
        // não é JSON válido — cai no mascaramento literal abaixo
      }
    }
    return VoalleAdapter.maskSensitiveString(str);
  }

  /**
   * Busca os detalhes de uma solicitação específica via API ERPVOALLE de TERCEIROS.
   * Endpoint: POST /external/integrations/thirdparty/projects/getsolicitationdata?assignmentId={id}
   * Doc: https://documenter.getpostman.com/view/16282829/UVC3moiN
   *
   * Funciona com client_credentials (não exige credencial Portal v2 por cliente),
   * complementa o /getsolicitationhistory com dados gerais (incidentType, requestor,
   * responsible, contractServiceTag, sectorArea, criticity, datas...).
   *
   * Propaga erro pro caller — frontend trata via isError + mensagem.
   */
  async getSolicitationData(assignmentId: number): Promise<{
    protocol?: number;
    assignmentId?: number;
    incidentType?: { id: number; title: string };
    incidentStatus?: { id: number; title: string };
    requestor?: { id: number; name: string; name2?: string };
    client?: { id: number; name: string; name2?: string };
    beginningDate?: string;
    finalDate?: string;
    criticity?: number;
    contractServiceTag?: { id: number; title: string; serviceTag: string };
    catalogService?: { id: number; title: string } | null;
    catalogServiceItem?: { id: number; title: string } | null;
    catalogServiceItemClass?: { id: number; title: string } | null;
    sectorArea?: { id: number; title: string };
    team?: { id: number; title: string };
    responsible?: { id: number; name: string; name2?: string };
    companyPlace?: { id: number; description: string };
  } | null> {
    if (!assignmentId) {
      console.log("[VoalleAdapter] getSolicitationData: assignmentId não fornecido");
      return null;
    }

    // Cache hit: devolve a Promise existente (deduplica in-flight + reuso por TTL).
    const now = Date.now();
    const cached = VoalleAdapter.solicitationDataCache.get(assignmentId);
    if (cached && (now - cached.at) < VoalleAdapter.SOLICITATION_DATA_CACHE_TTL_MS) {
      return cached.promise;
    }

    const promise = this.getSolicitationDataUncached(assignmentId);
    VoalleAdapter.solicitationDataCache.set(assignmentId, { promise, at: now });

    // LRU simples: se passou do limite, descarta as mais antigas.
    if (VoalleAdapter.solicitationDataCache.size > VoalleAdapter.SOLICITATION_DATA_CACHE_MAX_ENTRIES) {
      const oldestKey = VoalleAdapter.solicitationDataCache.keys().next().value;
      if (oldestKey !== undefined) VoalleAdapter.solicitationDataCache.delete(oldestKey);
    }

    // Em caso de erro, remove imediatamente do cache pra não travar 60s servindo falha.
    promise.catch(() => {
      const current = VoalleAdapter.solicitationDataCache.get(assignmentId);
      if (current && current.promise === promise) {
        VoalleAdapter.solicitationDataCache.delete(assignmentId);
      }
    });

    return promise;
  }

  private async getSolicitationDataUncached(assignmentId: number): Promise<any> {
    const path = `/projects/getsolicitationdata?assignmentId=${assignmentId}`;
    console.log(`[VoalleAdapter] Buscando detalhes da solicitação: ${path}`);

    // Conforme a doc, é POST com body vazio (parâmetros vão na query string).
    const result = await this.apiRequest<{
      success: boolean;
      messages?: any;
      response?: any;
    }>("POST", path);

    // Falhas lógicas do Voalle (success=false / payload inválido) viram erro propagado
    // pro caller — frontend distingue isso de "sem dados" via isError + mensagem.
    // Mensagens do Voalle são sanitizadas pra não vazar credencial em log/payload.
    if (!result || result.success === false) {
      const sanitized = VoalleAdapter.sanitizeErrorMessage(result?.messages);
      throw new Error(`Voalle getSolicitationData falhou (assignmentId=${assignmentId}): ${sanitized}`);
    }

    const r = result.response;
    if (!r || typeof r !== 'object') {
      throw new Error(`Voalle getSolicitationData retornou payload inválido (assignmentId=${assignmentId}, response ausente)`);
    }

    return {
      protocol: r.protocol,
      assignmentId: r.assignmentId,
      incidentType: r.incidentType,
      incidentStatus: r.incidentStatus,
      requestor: r.requestor,
      client: r.client,
      beginningDate: r.beginningDate,
      finalDate: r.finalDate,
      criticity: r.criticity,
      contractServiceTag: r.contractServiceTag,
      catalogService: r.catalogService,
      catalogServiceItem: r.catalogServiceItem,
      catalogServiceItemClass: r.catalogServiceItemClass,
      sectorArea: r.sectorArea,
      team: r.team,
      responsible: r.responsible,
      companyPlace: r.companyPlace,
    };
  }

  async getContractTags(
    params: { 
      voalleCustomerId?: string | null; 
      cnpj?: string | null;
      portalUsername?: string | null;
      portalPassword?: string | null;
    }, 
    page: number = 1, 
    pageSize: number = 50
  ): Promise<Array<{ 
    id: number; 
    serviceTag?: string; 
    description?: string; 
    equipmentUser?: string;
    active?: boolean; 
    contractNumber?: string; 
    ip?: string; 
    bandwidth?: number; 
    address?: string; 
    location?: string;
    concentratorId?: number;
    concentratorTitle?: string;
    oltId?: number;
    oltTitle?: string;
    slotOlt?: number;
    portOlt?: number;
    equipmentSerialNumber?: string;
    ipBlock?: string;
    pppoeUser?: string;
    pppoePassword?: string;
    wifiName?: string;
    wifiPassword?: string;
    contractStatus?: number;
  }>> {
    const { voalleCustomerId, cnpj, portalUsername, portalPassword } = params;
    
    // Prefer Portal API if configured AND client has portal credentials
    // Use /api/people/{personId}/authentications endpoint which returns only active connections
    if (this.isPortalConfigured() && voalleCustomerId && portalUsername && portalPassword) {
      try {
        console.log(`[VoalleAdapter] Usando Portal API para conexões (voalleCustomerId: ${voalleCustomerId}, user: ${portalUsername})`);
        
        // Use people/authentications endpoint which returns active connections with contract info
        const result = await this.portalApiRequest<{
          data: Array<{
            id: number;
            active: boolean;
            serviceTagId: number;
            slotOlt: number | null;
            portOlt: number | null;
            equipmentSerialNumber: string | null;
            equipmentUser: string | null;
            user: string | null;
            password: string | null;
            wifiName: string | null;
            wifiPassword: string | null;
            ipAuthentication?: { id: number; ip: string } | null;
            validLanIp?: string | null;
            validLanIpClass?: string | null;
            authenticationConcentrator?: { id: number; title: string } | null;
            authenticationAccessPoint?: { id: number; title: string } | null;
            // Connection address fields (directly on authentication object)
            postalCode?: string | null;
            street?: string | null;
            streetNumber?: string | null;
            neighborhood?: string | null;
            city?: string | null;
            state?: string | null;
            // Legacy peopleAddress (billing address - not used for connection address)
            peopleAddress?: {
              streetType: string;
              street: string;
              number: string;
              neighborhood: string;
              city: string;
              state: string;
            } | null;
            contract?: {
              id: number;
              contract_number: string;
              description: string;
              status: number;
            };
            contractServiceTag?: {
              id: number;
              description: string;
              serviceTag: string;
            };
            serviceProduct?: {
              id: number;
              title: string;
            };
          }>;
          count: number;
          filtered: number;
          total: number;
        }>("GET", `/api/people/${encodeURIComponent(voalleCustomerId)}/authentications`, portalUsername, portalPassword);

        if (!result.data) {
          console.log("[VoalleAdapter] Portal API: resposta sem dados");
          return [];
        }

        // Função para extrair velocidade do título do produto (ex: "300 MEGA" -> 300)
        const extractBandwidth = (title: string): number | undefined => {
          const match = title.match(/(\d+)\s*(MEGA|MB|MBPS|GB|GBPS)/i);
          if (match) {
            const value = parseInt(match[1], 10);
            const unit = match[2].toUpperCase();
            if (unit.includes('GB')) return value * 1000;
            return value;
          }
          return undefined;
        };

        // Map connections to tags format, filtering only active ones with contractServiceTag
        const tags = result.data
          .filter(conn => conn.active === true && conn.contractServiceTag)
          .map((conn) => {
            // Use connection address fields (directly on authentication object)
            // These are the installation/connection address, not the billing address (peopleAddress)
            const hasConnectionAddress = conn.street || conn.neighborhood || conn.city;
            const fullAddress = hasConnectionAddress
              ? `${conn.street || ''}, ${conn.streetNumber || 'S/N'} - ${conn.neighborhood || ''}, ${conn.city || ''}/${conn.state || ''}`
              : undefined;
            const location = (conn.city || conn.state) ? `${conn.city || ''}/${conn.state || ''}` : undefined;
            
            // Build IP block from validLanIp and validLanIpClass (e.g., "192.168.1.0/24")
            let ipBlock: string | undefined;
            if (conn.validLanIp && conn.validLanIpClass) {
              ipBlock = `${conn.validLanIp}/${conn.validLanIpClass}`;
              console.log(`[VoalleAdapter] IP Block: ${ipBlock} (validLanIp: ${conn.validLanIp}, validLanIpClass: ${conn.validLanIpClass})`);
            } else if (conn.validLanIp) {
              ipBlock = conn.validLanIp;
              console.log(`[VoalleAdapter] IP Block (sem classe): ${ipBlock}`);
            }

            // Extrair prefixo do equipmentUser (parte antes de ===)
            const rawEquipmentUser = conn.equipmentUser || '';
            const equipmentUserPrefix = rawEquipmentUser.includes('===') 
              ? rawEquipmentUser.split('===')[0].trim() 
              : (rawEquipmentUser.trim() || undefined);

            return {
              id: conn.contractServiceTag!.id,
              connectionId: conn.id,
              serviceTag: conn.contractServiceTag!.serviceTag,
              description: conn.contractServiceTag!.description || conn.serviceProduct?.title,
              equipmentUser: equipmentUserPrefix,
              active: conn.active,
              contractNumber: conn.contract?.contract_number,
              ip: conn.ipAuthentication?.ip,
              ipBlock: ipBlock,
              bandwidth: conn.serviceProduct?.title ? extractBandwidth(conn.serviceProduct.title) : undefined,
              address: fullAddress,
              location: location,
              concentratorId: conn.authenticationConcentrator?.id,
              concentratorTitle: conn.authenticationConcentrator?.title,
              oltId: conn.authenticationAccessPoint?.id,
              oltTitle: conn.authenticationAccessPoint?.title,
              slotOlt: conn.slotOlt ?? undefined,
              portOlt: conn.portOlt ?? undefined,
              equipmentSerialNumber: conn.equipmentSerialNumber ?? undefined,
              pppoeUser: conn.user ?? undefined,
              pppoePassword: conn.password ?? undefined,
              wifiName: conn.wifiName ?? undefined,
              wifiPassword: conn.wifiPassword ?? undefined,
              contractStatus: conn.contract?.status ?? undefined,
            };
          });

        // Remove duplicates (same serviceTag can appear in multiple connections)
        const uniqueTags = tags.filter((tag, index, self) => 
          index === self.findIndex(t => t.id === tag.id)
        );

        console.log(`[VoalleAdapter] Portal API: ${uniqueTags.length} etiquetas ativas de ${result.data.length} conexões`);
        return uniqueTags;
      } catch (error) {
        console.error("[VoalleAdapter] Erro na Portal API, tentando API antiga:", error);
        // Fall through to legacy API
      }
    } else if (this.isPortalConfigured() && voalleCustomerId && (!portalUsername || !portalPassword)) {
      console.log(`[VoalleAdapter] Portal API configurada mas credenciais do portal não fornecidas para cliente`);
    } else if (!this.isPortalConfigured() && voalleCustomerId) {
      console.log(`[VoalleAdapter] Portal API não configurada, voalleCustomerId ${voalleCustomerId} não pode ser usado`);
    }

    // Fallback to legacy API (using txId/CNPJ)
    if (!cnpj) {
      console.log("[VoalleAdapter] API antiga: CNPJ não fornecido");
      return [];
    }
    try {
      const path = `/contractservicetagspaged?txId=${encodeURIComponent(cnpj)}&Page=${page}&PageSize=${pageSize}`;
      console.log(`[VoalleAdapter] Usando API antiga para etiquetas (CNPJ: ${cnpj}): ${path}`);
      
      const result = await this.apiRequest<{
        success: boolean;
        messages: string | null;
        response: {
          data: Array<{ id: number; description?: string }>;
          totalRecords: number;
        };
      }>("GET", path);

      if (!result.success || !result.response?.data) {
        console.log("[VoalleAdapter] API antiga: resposta sem dados:", result);
        return [];
      }

      const tags = result.response.data.map((raw) => ({
        id: raw.id,
        description: raw.description,
      }));

      console.log(`[VoalleAdapter] API antiga: ${tags.length} etiquetas encontradas`);
      return tags;
    } catch (error) {
      console.error("[VoalleAdapter] Erro ao buscar etiquetas de contrato:", error);
      return [];
    }
  }

  /**
   * Busca conexões/autenticações completas de um cliente via Portal API
   * Retorna dados detalhados de cada conexão para preenchimento automático de links
   */
  async getConnections(
    params: { 
      voalleCustomerId: string;
      portalUsername: string;
      portalPassword: string;
    }
  ): Promise<{ 
    success: boolean; 
    connections: Array<{
      id: number;
      active: boolean;
      ipType: number;
      ipTypeAsText: string;
      ipAuthentication: { id: number; ip: string } | null;
      lat: string | null;
      lng: string | null;
      slotOlt: number | null;
      portOlt: number | null;
      equipmentSerialNumber: string | null;
      equipmentUser: string | null;
      contract: { id: number; contract_number: string; description: string; status: number } | null;
      serviceProduct: { id: number; title: string } | null;
      contractServiceTag: { id: number; description: string; serviceTag: string } | null;
      authenticationConcentrator: { id: number; title: string } | null;
      authenticationAccessPoint: { id: number; title: string } | null;
      authenticationSplitter: { id: number; title: string; port: number | null } | null;
      peopleAddress: {
        streetType: string;
        street: string;
        number: string;
        neighborhood: string;
        city: string;
        state: string;
        postalCode: string;
      } | null;
    }>; 
    message?: string 
  }> {
    const { voalleCustomerId, portalUsername, portalPassword } = params;
    
    if (!this.isPortalConfigured()) {
      return { success: false, connections: [], message: "Portal API não configurada" };
    }

    if (!voalleCustomerId || !portalUsername || !portalPassword) {
      return { success: false, connections: [], message: "Parâmetros incompletos" };
    }

    try {
      console.log(`[VoalleAdapter] Buscando conexões (voalleCustomerId: ${voalleCustomerId})`);
      
      const result = await this.portalApiRequest<{
        data: Array<{
          id: number;
          active: boolean;
          ipType: number;
          ipTypeAsText: string;
          lat: string | null;
          lng: string | null;
          slotOlt: number | null;
          portOlt: number | null;
          equipmentSerialNumber: string | null;
          equipmentUser: string | null;
          user: string | null;
          password: string | null;
          ipAuthentication: { id: number; ip: string } | null;
          contract: { id: number; contract_number: string; description: string; status: number } | null;
          serviceProduct: { id: number; title: string } | null;
          contractServiceTag: { id: number; description: string; serviceTag: string } | null;
          authenticationConcentrator: { id: number; title: string } | null;
          authenticationAccessPoint: { id: number; title: string } | null;
          authenticationSplitter: { id: number; title: string; port: number | null } | null;
          peopleAddress: {
            streetType: string;
            street: string;
            number: string;
            neighborhood: string;
            city: string;
            state: string;
            postalCode: string;
          } | null;
        }>;
        count: number;
        total: number;
      }>("GET", `/api/people/${encodeURIComponent(voalleCustomerId)}/authentications`, portalUsername, portalPassword);

      if (!result.data) {
        return { success: true, connections: [], message: "Nenhuma conexão encontrada" };
      }

      // Filter only active connections
      const activeConnections = result.data
        .filter(conn => conn.active === true)
        .map(conn => ({
          id: conn.id,
          active: conn.active,
          ipType: conn.ipType,
          ipTypeAsText: conn.ipTypeAsText,
          ipAuthentication: conn.ipAuthentication,
          lat: conn.lat,
          lng: conn.lng,
          slotOlt: conn.slotOlt,
          portOlt: conn.portOlt,
          equipmentSerialNumber: conn.equipmentSerialNumber,
          equipmentUser: conn.equipmentUser,
          user: conn.user || null,
          password: conn.password || null,
          contract: conn.contract,
          serviceProduct: conn.serviceProduct,
          contractServiceTag: conn.contractServiceTag,
          authenticationConcentrator: conn.authenticationConcentrator,
          authenticationAccessPoint: conn.authenticationAccessPoint,
          authenticationSplitter: (conn as any).authenticationSplitter || null,
          peopleAddress: conn.peopleAddress,
        }));
      
      console.log(`[VoalleAdapter] ${activeConnections.length} conexões ativas de ${result.data.length} total`);
      return { success: true, connections: activeConnections };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error("[VoalleAdapter] Erro ao buscar conexões:", errorMessage);
      return { success: false, connections: [], message: `Erro: ${errorMessage}` };
    }
  }

  /**
   * Busca uma conexão específica por service tag entre as conexões de um cliente
   * Útil para links criados manualmente que possuem etiqueta mas não têm voalleConnectionId
   */
  async findConnectionByServiceTag(
    params: {
      voalleCustomerId: string;
      portalUsername: string;
      portalPassword: string;
      serviceTag: string;
    }
  ): Promise<{
    success: boolean;
    connection?: any;
    message?: string;
  }> {
    const { serviceTag, ...connParams } = params;
    const result = await this.getConnections(connParams);
    if (!result.success) {
      return { success: false, message: result.message };
    }
    const conn = result.connections.find(
      (c: any) => c.contractServiceTag?.serviceTag === serviceTag
    );
    if (!conn) {
      return { success: false, message: `Nenhuma conexão encontrada com a etiqueta "${serviceTag}"` };
    }
    return { success: true, connection: conn };
  }

  /**
   * Atualiza campos de uma conexão no Voalle via API principal (porta 45715)
   * Endpoint: PUT /updateconnection/{connectionId}
   * Campos atualizáveis: slotOlt, portOlt, equipmentSerialNumber, authenticationAccessPointId, authenticationSplitterId, port
   */
  async updateConnectionFields(
    connectionId: number,
    fields: {
      slotOlt?: number | null;
      portOlt?: number | null;
      equipmentSerialNumber?: string | null;
      authenticationAccessPointId?: number | null;
      authenticationSplitterId?: number | null;
      splitterPort?: number | null;
    },
    currentPassword?: string
  ): Promise<{ success: boolean; message?: string; apiResponse?: string }> {
    if (!this.isConfigured()) {
      return { success: false, message: "API principal do Voalle não configurada" };
    }
    try {
      console.log(`[VoalleAdapter] Atualizando conexão ${connectionId}: campos=${Object.keys(fields).join(', ')}`);
      const payload: Record<string, any> = { id: connectionId };
      if (currentPassword) {
        payload.password = currentPassword;
      } else {
        return { success: false, message: "Senha PPPoE atual necessária para updateconnection" };
      }
      if (fields.slotOlt !== undefined) payload.slotOlt = fields.slotOlt;
      if (fields.portOlt !== undefined) payload.portOlt = fields.portOlt;
      if (fields.equipmentSerialNumber !== undefined) payload.equipmentSerialNumber = fields.equipmentSerialNumber;
      if (fields.authenticationAccessPointId !== undefined) payload.authenticationAccessPointId = fields.authenticationAccessPointId;
      if (fields.authenticationSplitterId !== undefined) payload.authenticationSplitterId = fields.authenticationSplitterId;
      if (fields.splitterPort !== undefined) payload.port = fields.splitterPort;

      if (!this.config || !this.config.apiUrl) {
        return { success: false, message: "URL da API Voalle não configurada" };
      }
      const token = await this.authenticate();
      const url = `${this.config.apiUrl}:45715/external/integrations/thirdparty/updateconnection/${connectionId}`;
      console.log(`[VoalleAdapter] PUT ${url.replace(/^https?:\/\/[^/]+/, '***')}`);
      const safePayload = { ...payload };
      if (safePayload.password) safePayload.password = '[REDACTED]';
      console.log(`[VoalleAdapter] Payload:`, JSON.stringify(safePayload));
      const headers: Record<string, string> = {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      };
      const synV1Token = this.config.apiSynV1Token || process.env.VOALLE_SYN_V1_TOKEN;
      if (synV1Token) {
        headers["syn-v1-token"] = synV1Token;
        console.log(`[VoalleAdapter] syn-v1-token: configurado (${synV1Token.substring(0, 4)}...)`);
      } else {
        console.log(`[VoalleAdapter] AVISO: syn-v1-token NÃO configurado`);
      }
      const response = await fetch(url, {
        method: "PUT",
        headers,
        body: JSON.stringify(payload),
      });
      const responseText = await response.text();
      console.log(`[VoalleAdapter] Response: HTTP ${response.status} - Body: ${responseText.substring(0, 500)}`);
      if (!response.ok) {
        throw new Error(`Voalle API error: ${response.status} - ${responseText.substring(0, 500)}`);
      }
      try {
        const respJson = JSON.parse(responseText);
        if (respJson.success === false) {
          const errorMessages = (respJson.messages || []).map((m: any) => m.message).join('; ');
          console.error(`[VoalleAdapter] API retornou success=false: ${errorMessages}`);
          return { success: false, message: `Voalle rejeitou: ${errorMessages}`, apiResponse: responseText.substring(0, 500) };
        }
      } catch {}
      console.log(`[VoalleAdapter] Conexão ${connectionId} atualizada com sucesso (HTTP ${response.status})`);
      return { success: true, message: `Conexão ${connectionId} atualizada (HTTP ${response.status})`, apiResponse: responseText.substring(0, 500) };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[VoalleAdapter] Erro ao atualizar conexão ${connectionId}:`, msg);
      return { success: false, message: msg };
    }
  }

  /**
   * Obtém um token de serviço para o Portal Voalle usando credenciais administrativas
   * Este token permite chamar endpoints administrativos como recuperação de senha
   */
  private async getPortalServiceToken(): Promise<string | null> {
    if (!this.providerConfig) return null;
    
    const { portalApiUrl, portalVerifyToken, portalClientId, portalClientSecret, portalUsername, portalPassword } = this.providerConfig;
    
    // Precisa de todas as credenciais incluindo usuário/senha admin
    if (!portalApiUrl || !portalClientId || !portalClientSecret || !portalUsername || !portalPassword) {
      console.log(`[VoalleAdapter] Credenciais de serviço do Portal incompletas para obter token`);
      return null;
    }

    let baseUrl = portalApiUrl.trim();
    if (baseUrl.endsWith("/")) {
      baseUrl = baseUrl.slice(0, -1);
    }

    // Autenticar com credenciais administrativas da Marvitel
    const authUrl = `${baseUrl}/portal_authentication?verify_token=${encodeURIComponent(portalVerifyToken || "")}&client_id=${encodeURIComponent(portalClientId)}&client_secret=${encodeURIComponent(portalClientSecret)}&grant_type=client_credentials&username=${encodeURIComponent(portalUsername)}&password=${encodeURIComponent(portalPassword)}`;

    console.log(`[VoalleAdapter] Obtendo token de serviço do Portal com credenciais admin...`);
    
    const response = await fetch(authUrl, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      console.log(`[VoalleAdapter] Token de serviço falhou: ${response.status}`);
      return null;
    }

    const data = await response.json() as { access_token?: string };
    console.log(`[VoalleAdapter] Token de serviço obtido com sucesso`);
    return data.access_token || null;
  }

  async requestPortalPasswordRecovery(username: string): Promise<{ success: boolean; message: string }> {
    console.log(`[VoalleAdapter] Iniciando recuperação de senha para: ${username}`);
    
    if (!this.isPortalConfigured()) {
      console.log(`[VoalleAdapter] Portal não configurado`);
      return { success: false, message: "Portal API não configurada" };
    }

    // Verificar se temos credenciais administrativas configuradas
    if (!this.providerConfig?.portalUsername || !this.providerConfig?.portalPassword) {
      console.log(`[VoalleAdapter] Credenciais administrativas do Portal não configuradas`);
      return { 
        success: false, 
        message: "Recuperação de senha não disponível. Credenciais administrativas não configuradas." 
      };
    }

    try {
      const portalUrl = this.providerConfig?.portalApiUrl?.replace(/\/$/, "") || "";
      const verifyToken = this.providerConfig?.portalVerifyToken || "";

      // Obter token de serviço usando credenciais administrativas da Marvitel
      const serviceToken = await this.getPortalServiceToken();
      
      if (!serviceToken) {
        console.error(`[VoalleAdapter] Não foi possível obter token de serviço para recovery`);
        return { 
          success: false, 
          message: "Erro de autenticação com o Portal Voalle. Contate o suporte." 
        };
      }
      
      const recoveryEndpoint = `${portalUrl}/api/person_users/recovery`;
      console.log(`[VoalleAdapter] Chamando endpoint de recovery: ${recoveryEndpoint}`);
      
      // Chamar endpoint de recovery com Bearer token e FormData
      const formData = new FormData();
      formData.append("username", username);
      
      const response = await fetch(recoveryEndpoint, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${serviceToken}`,
          "Verify-Token": verifyToken,
        },
        body: formData,
      });

      console.log(`[VoalleAdapter] Resposta recovery: ${response.status}`);

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        // Sanitizar log para não expor credenciais (remover qualquer valor após = ou :)
        const sanitizedError = errorText.replace(/(password|senha|secret|token|key|credential)[=:][^\s&"',}]*/gi, '$1=[REDACTED]');
        console.error(`[VoalleAdapter] Recuperação de senha falhou: ${response.status} - ${sanitizedError.substring(0, 200)}`);
        
        // Mensagem amigável para o usuário
        if (response.status === 404) {
          return { 
            success: false, 
            message: "Usuário não encontrado no Portal Voalle" 
          };
        }
        if (response.status === 422) {
          return { 
            success: false, 
            message: "CPF/CNPJ inválido ou não cadastrado no Portal Voalle" 
          };
        }
        return { 
          success: false, 
          message: "Erro ao solicitar recuperação. Verifique se o CPF/CNPJ está correto." 
        };
      }

      const result = await response.json().catch(() => ({}));
      console.log(`[VoalleAdapter] Recuperação de senha solicitada com sucesso para: ${username}`);
      
      return { 
        success: true, 
        message: "Email de recuperação enviado com sucesso" 
      };
    } catch (error) {
      console.error("[VoalleAdapter] Erro ao solicitar recuperação de senha:", error instanceof Error ? error.message : "Erro desconhecido");
      return { 
        success: false, 
        message: "Erro ao conectar com o Portal Voalle. Tente novamente mais tarde." 
      };
    }
  }

  /**
   * Busca detalhes de uma pessoa (cliente) no Voalle via API Para Terceiros
   * Usado para obter dados completos do cliente para auto-cadastro
   */
  async getPersonDetails(txId: string): Promise<{
    success: boolean;
    person?: {
      id: number;
      name: string;
      txId: string;
      email?: string;
      phone?: string;
      address?: string;
      city?: string;
      state?: string;
    };
    message?: string;
  }> {
    try {
      console.log(`[VoalleAdapter] Buscando detalhes do cliente pelo txId: ${txId}`);
      
      // Usar API Para Terceiros para buscar dados do cliente pelo CNPJ/CPF
      const result = await this.apiRequest<{
        success: boolean;
        messages: string | null;
        response: {
          data: Array<{
            id: number;
            name: string;
            tx_id: string;
            email?: string;
            cell_phone_1?: string;
            address?: string;
            city?: string;
            state?: string;
          }>;
          totalRecords: number;
        };
      }>("GET", `/getclient?txId=${encodeURIComponent(txId)}&page=1&pageSize=10`);

      console.log(`[VoalleAdapter] Resposta /getclient: totalRecords=${result.response?.totalRecords}, dataLength=${result.response?.data?.length}`);
      
      // Log detalhado do primeiro resultado para ver todos os campos disponíveis
      if (result.response?.data?.length > 0) {
        const firstItem = result.response.data[0];
        console.log(`[VoalleAdapter] Campos disponíveis no primeiro resultado: ${JSON.stringify(Object.keys(firstItem))}`);
        console.log(`[VoalleAdapter] Primeiro resultado completo: ${JSON.stringify(firstItem)}`);
      }

      if (!result.success || !result.response?.data?.length) {
        console.log(`[VoalleAdapter] Pessoa não encontrada: ${txId}`);
        return { success: false, message: "Cliente não encontrado no Voalle" };
      }

      // IMPORTANTE: Filtrar para encontrar exatamente o registro com o txId solicitado
      // A API pode retornar múltiplos resultados, precisamos do registro correto
      // O campo pode ser tx_id, cpf_cnpj, document, etc - precisamos verificar
      const normalizedTxId = txId.replace(/\D/g, '');
      const personData = result.response.data.find(item => {
        // Tentar diferentes nomes de campo que podem conter o CPF/CNPJ
        const itemTxId = (item as any).tx_id || (item as any).cpf_cnpj || (item as any).document || (item as any).cpf || (item as any).cnpj || '';
        return itemTxId.toString().replace(/\D/g, '') === normalizedTxId;
      });
      
      if (!personData) {
        console.log(`[VoalleAdapter] Nenhum registro encontrado com txId exato: ${txId}. API retornou ${result.response.data.length} registros não relacionados.`);
        return { success: false, message: "Cliente não encontrado no Voalle" };
      }
      
      console.log(`[VoalleAdapter] Cliente selecionado: id=${personData.id}, name="${personData.name}", tx_id="${personData.tx_id}"`);

      return {
        success: true,
        person: {
          id: personData.id,
          name: personData.name,
          txId: personData.tx_id,
          email: personData.email,
          phone: personData.cell_phone_1,
          address: personData.address,
          city: personData.city,
          state: personData.state,
        },
      };
    } catch (error) {
      console.error("[VoalleAdapter] Erro ao buscar dados do cliente:", error);
      return { success: false, message: "Erro ao buscar dados do cliente no Voalle" };
    }
  }

  /**
   * Valida credenciais do portal Voalle de um cliente
   * Retorna informações do usuário se as credenciais forem válidas
   */
  async validatePortalCredentials(portalUsername: string, portalPassword: string): Promise<{
    success: boolean;
    message: string;
    person?: { id: number; name: string };
  }> {
    if (!this.providerConfig) {
      return { success: false, message: "Portal Voalle não configurado" };
    }

    const { portalApiUrl, portalVerifyToken, portalClientId, portalClientSecret } = this.providerConfig;
    
    if (!portalApiUrl || !portalVerifyToken || !portalClientId || !portalClientSecret) {
      return { success: false, message: "Credenciais do Portal Voalle incompletas" };
    }
    
    if (!portalUsername || !portalPassword) {
      return { success: false, message: "Usuário e senha são obrigatórios" };
    }

    try {
      let baseUrl = portalApiUrl.trim();
      if (baseUrl.endsWith("/")) {
        baseUrl = baseUrl.slice(0, -1);
      }
      
      const authUrl = `${baseUrl}/portal_authentication?verify_token=${encodeURIComponent(portalVerifyToken)}&client_id=${encodeURIComponent(portalClientId)}&client_secret=${encodeURIComponent(portalClientSecret)}&grant_type=client_credentials&username=${encodeURIComponent(portalUsername)}&password=${encodeURIComponent(portalPassword)}`;

      console.log(`[VoalleAdapter] Validando credenciais do portal para: ${portalUsername}`);

      const response = await fetch(authUrl, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.log(`[VoalleAdapter] Credenciais inválidas: ${response.status} - ${errorText}`);
        return { 
          success: false, 
          message: "Usuário ou senha inválidos" 
        };
      }

      const data = await response.json() as {
        access_token: string;
        expires_in: number;
        token_type: string;
        person?: { id: number; name: string };
      };

      console.log(`[VoalleAdapter] Credenciais válidas para ${portalUsername}`);
      
      return { 
        success: true, 
        message: "Credenciais válidas",
        person: data.person
      };
    } catch (error) {
      console.error("[VoalleAdapter] Erro ao validar credenciais:", error);
      return { 
        success: false, 
        message: error instanceof Error ? error.message : "Erro ao validar credenciais" 
      };
    }
  }

  // Busca TODAS as etiquetas (contract_service_tags) em bulk sem filtro de CNPJ
  // Retorna mapa id → serviceTag (código OZmap real) para resolver IDs numéricos
  // retornados pelo endpoint de conexões deletadas
  async getAllServiceTagsMap(pageSize = 500): Promise<Map<number, string>> {
    const result = new Map<number, string>();
    let page = 1;
    let totalPages = 1;
    do {
      try {
        const resp = await this.apiRequest<{
          success: boolean;
          response: {
            data: Array<Record<string, any>>;
            totalRecords?: number;
            totalPages?: number;
          };
        }>("GET", `/contractservicetagspaged?Page=${page}&PageSize=${pageSize}`);

        if (!resp.success || !resp.response?.data) break;

        if (page === 1) {
          totalPages = resp.response.totalPages ??
            Math.ceil((resp.response.totalRecords ?? resp.response.data.length) / pageSize);
          console.log(`[VoalleAdapter] getAllServiceTagsMap: totalPages=${totalPages}, totalRecords=${resp.response.totalRecords}`);
        }

        for (const raw of resp.response.data) {
          const id: number = raw.id;
          // Tentar campo serviceTag primeiro, depois description, depois code
          const code: string | undefined = raw.serviceTag || raw.service_tag || raw.code || raw.description;
          if (id && code && typeof code === "string" && code.trim()) {
            result.set(id, code.trim());
          }
        }

        // Log amostra na primeira página para diagnóstico
        if (page === 1 && resp.response.data.length > 0) {
          console.log(`[VoalleAdapter] getAllServiceTagsMap amostra:`, JSON.stringify(resp.response.data[0]));
        }
      } catch (err) {
        console.error(`[VoalleAdapter] getAllServiceTagsMap erro na página ${page}:`, err);
        break;
      }
      page++;
    } while (page <= totalPages);

    console.log(`[VoalleAdapter] getAllServiceTagsMap: ${result.size} etiquetas indexadas`);
    return result;
  }

  // ========== Map API (porta 45715/external/map) ==========

  private async makeMapRequest<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    if (!this.config || !this.config.apiUrl) {
      throw new Error("Voalle não configurado");
    }
    const token = await this.authenticate();
    const url = `${this.config.apiUrl}:45715/external/map${path}`;
    const response = await fetch(url, {
      method,
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Voalle Map API error ${response.status} em ${path}: ${errorText}`);
    }
    return response.json() as Promise<T>;
  }

  async searchConnectionsByUserData(opts: {
    users?: string[];
    serviceTags?: string[];
    contractIds?: number[];
  }): Promise<VoalleMapConnection[]> {
    type Resp = { success: boolean; response: VoalleMapConnection[][] };
    const result = await this.makeMapRequest<Resp>(
      "POST",
      "/connection/by/userdata",
      {
        users: opts.users || [],
        serviceTags: opts.serviceTags || [],
        contractIds: opts.contractIds || [],
      }
    );
    if (!result.success || !result.response) return [];
    return result.response.flat();
  }

  async getAllConnections(): Promise<VoalleMapConnection[]> {
    const result = await this.makeMapRequest<any>("GET", "/connection/all");
    if (Array.isArray(result)) return result;
    if (result?.response && Array.isArray(result.response)) return (result.response as any[]).flat();
    return [];
  }

  async getAllDeletedConnections(): Promise<VoalleMapConnection[]> {
    const result = await this.makeMapRequest<any>("GET", "/connection/all/deleted");
    if (Array.isArray(result)) return result;
    if (result?.response && Array.isArray(result.response)) return (result.response as any[]).flat();
    return [];
  }

  // Busca TODOS os registros deletados via endpoint paginado (garante completude mesmo com muitos registros)
  async getAllDeletedConnectionsPaged(pageSize = 500): Promise<VoalleMapConnection[]> {
    const all: VoalleMapConnection[] = [];
    let page = 1;
    let totalPages = 1;
    do {
      const result = await this.makeMapRequest<any>(
        "GET", `/connection/all/deleted/paged?page=${page}&pageSize=${pageSize}`
      );
      const response = result?.response ?? result;
      const data: any[] = response?.data ?? (Array.isArray(response) ? response : []);
      if (data.length === 0) break;
      all.push(...data);
      if (page === 1) {
        totalPages = response?.totalPages ?? Math.ceil((response?.totalRecords ?? data.length) / pageSize);
      }
      page++;
    } while (page <= totalPages);
    return all;
  }

  async vinculateConnectionIntegrationCode(connectionId: number, integrationCode: string): Promise<boolean> {
    type Resp = { success: boolean };
    const result = await this.makeMapRequest<Resp>(
      "PUT",
      `/connection/vinculate/${connectionId}/${encodeURIComponent(integrationCode)}`
    );
    return result.success === true;
  }

  async updateConnectionIntegrationCode(oldCode: string, newCode: string): Promise<boolean> {
    type Resp = { success: boolean };
    const result = await this.makeMapRequest<Resp>(
      "PUT",
      `/connection/update/integrationcode/${encodeURIComponent(oldCode)}/${encodeURIComponent(newCode)}`
    );
    return result.success === true;
  }
}

export interface VoalleMapConnection {
  id: number;
  user: string | null;
  integrationCode: string | null;
  serviceTag: string | null;
  equipmentSerialNumber: string | null;
  mac: string | null;
  integrationCodeMap: string | null;
  status: number;
  client: { id: number; name: string; txId: string } | null;
  contract: { id: number; status: number; statusDescription: string } | null;
  address: {
    street: string | null;
    postalCode: string | null;
    number: string | null;
    neighborhood: string | null;
    city: string | null;
    state: string | null;
    latitude: string | null;
    longitude: string | null;
  } | null;
}

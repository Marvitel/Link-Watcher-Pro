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
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      scope: "syngw",
      client_id: this.config.apiClientId || "",
      client_secret: this.config.apiClientSecret || "",
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
      throw new Error(`Falha na autenticação Voalle: ${response.status} - ${errorText}`);
    }

    const data = await response.json() as VoalleAuthResponse;
    this.accessToken = data.access_token;
    this.tokenExpiresAt = new Date(Date.now() + (data.expires_in - 60) * 1000);

    return this.accessToken;
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

    if (this.config.apiSynV1Token) {
      headers["syn-v1-token"] = this.config.apiSynV1Token;
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
          }>;
          totalRecords?: number;
        };
      }>("GET", path);
      
      if (!result.success || !result.response?.data) {
        console.log("[VoalleAdapter] Resposta sem dados:", result);
        return [];
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
      }));

      console.log(`[VoalleAdapter] Encontradas ${solicitations.length} solicitações`);
      return solicitations;
    } catch (error) {
      console.error("[VoalleAdapter] Erro ao buscar solicitações abertas:", error);
      return [];
    }
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
  ): Promise<Array<{ id: number; serviceTag?: string; description?: string; active?: boolean; contractNumber?: string; ip?: string; bandwidth?: number; address?: string; location?: string }>> {
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
            ipAuthentication?: { id: number; ip: string } | null;
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
            const addr = conn.peopleAddress;
            const fullAddress = addr 
              ? `${addr.streetType} ${addr.street}, ${addr.number} - ${addr.neighborhood}, ${addr.city}/${addr.state}`
              : undefined;
            const location = addr ? `${addr.city}/${addr.state}` : undefined;
            
            return {
              id: conn.contractServiceTag!.id,
              serviceTag: conn.contractServiceTag!.serviceTag,
              description: conn.contractServiceTag!.description || conn.serviceProduct?.title,
              active: conn.active,
              contractNumber: conn.contract?.contract_number,
              ip: conn.ipAuthentication?.ip,
              bandwidth: conn.serviceProduct?.title ? extractBandwidth(conn.serviceProduct.title) : undefined,
              address: fullAddress,
              location: location,
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
      contract: { id: number; contract_number: string; description: string; status: number } | null;
      serviceProduct: { id: number; title: string } | null;
      contractServiceTag: { id: number; description: string; serviceTag: string } | null;
      authenticationConcentrator: { id: number; title: string } | null;
      authenticationAccessPoint: { id: number; title: string } | null;
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
          ipAuthentication: { id: number; ip: string } | null;
          contract: { id: number; contract_number: string; description: string; status: number } | null;
          serviceProduct: { id: number; title: string } | null;
          contractServiceTag: { id: number; description: string; serviceTag: string } | null;
          authenticationConcentrator: { id: number; title: string } | null;
          authenticationAccessPoint: { id: number; title: string } | null;
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
          contract: conn.contract,
          serviceProduct: conn.serviceProduct,
          contractServiceTag: conn.contractServiceTag,
          authenticationConcentrator: conn.authenticationConcentrator,
          authenticationAccessPoint: conn.authenticationAccessPoint,
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
}

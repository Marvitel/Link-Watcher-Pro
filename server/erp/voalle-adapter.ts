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
}

export class VoalleAdapter implements ErpAdapter {
  readonly provider = "voalle";
  private config: ErpIntegration | null = null;
  private providerConfig: VoalleProviderConfig | null = null;
  private accessToken: string | null = null;
  private tokenExpiresAt: Date | null = null;

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
      // Voalle uses a paginated /people endpoint with filter parameter
      const result = await this.apiRequest<{
        success: boolean;
        response: {
          data: Array<{
            id: number;
            name: string;
            txId?: string;
            txIdFormated?: string;
            email?: string;
            phone?: string;
            cellPhone1?: string;
            city?: string;
            state?: string;
            client?: boolean;
          }>;
          totalRecords: number;
          page: number;
          pageSize: number;
        };
      }>("GET", `/people?page=1&pageSize=50&filter=${encodeURIComponent(query)}`);

      if (!result.success || !result.response?.data) {
        return [];
      }

      // Filter only clients and map to ErpCustomer format
      return result.response.data
        .filter(p => p.client === true)
        .map(p => ({
          id: p.id.toString(),
          code: p.txId || p.txIdFormated || "",
          name: p.name,
          document: p.txIdFormated || p.txId,
          email: p.email,
          phone: p.phone || p.cellPhone1,
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
}

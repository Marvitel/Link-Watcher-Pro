import type { Incident } from "@shared/schema";

interface VoalleConfig {
  apiUrl: string;
  clientId: string;
  clientSecret: string;
  synV1Token?: string;
}

interface VoalleAuthResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface VoalleProtocolRequest {
  solicitationTypeCode: string;
  personId?: number;
  personCode?: string;
  contractId?: number;
  description: string;
  subject: string;
  priority?: string;
  originCode?: string;
}

interface VoalleProtocolResponse {
  id: number;
  protocol: string;
  status: string;
  createdAt: string;
}

export class VoalleService {
  private config: VoalleConfig | null = null;
  private accessToken: string | null = null;
  private tokenExpiresAt: Date | null = null;

  constructor() {}

  configure(config: VoalleConfig) {
    let apiUrl = config.apiUrl.trim();
    if (apiUrl.endsWith("/")) {
      apiUrl = apiUrl.slice(0, -1);
    }
    const portMatch = apiUrl.match(/:(\d+)$/);
    if (portMatch) {
      apiUrl = apiUrl.replace(/:(\d+)$/, "");
    }
    this.config = { ...config, apiUrl };
    this.accessToken = null;
    this.tokenExpiresAt = null;
  }

  isConfigured(): boolean {
    return this.config !== null && 
           this.config.apiUrl !== "" && 
           this.config.clientId !== "" && 
           this.config.clientSecret !== "";
  }

  private async authenticate(): Promise<string> {
    if (!this.config) {
      throw new Error("Voalle não configurado");
    }

    if (this.accessToken && this.tokenExpiresAt && new Date() < this.tokenExpiresAt) {
      return this.accessToken;
    }

    const authUrl = `${this.config.apiUrl}:45700/connect/token`;
    
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      scope: "syngw",
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
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
    if (!this.config) {
      throw new Error("Voalle não configurado");
    }

    const token = await this.authenticate();
    const url = `${this.config.apiUrl}:45715/external/integrations/thirdparty${path}`;

    const headers: Record<string, string> = {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    };

    if (this.config.synV1Token) {
      headers["syn-v1-token"] = this.config.synV1Token;
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

  async testConnection(): Promise<{ success: boolean; message: string }> {
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

  async createProtocol(
    solicitationTypeCode: string,
    incident: Incident,
    linkName: string,
    linkLocation: string
  ): Promise<{ success: boolean; protocolId?: string; message: string }> {
    if (!this.config) {
      return { success: false, message: "Voalle não configurado" };
    }

    try {
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

      const requestBody: VoalleProtocolRequest = {
        solicitationTypeCode,
        subject,
        description,
        priority: "media",
        originCode: "link_monitor",
      };

      const result = await this.apiRequest<VoalleProtocolResponse>(
        "POST",
        "/servicedesk/protocol",
        requestBody
      );

      return {
        success: true,
        protocolId: result.protocol || result.id?.toString(),
        message: `Protocolo ${result.protocol || result.id} criado com sucesso no Voalle`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro desconhecido";
      return { success: false, message: `Falha ao criar protocolo: ${message}` };
    }
  }

  async getProtocolStatus(protocolId: string): Promise<{ status: string; lastUpdate?: string } | null> {
    try {
      const result = await this.apiRequest<{
        status: string;
        lastUpdateAt: string;
      }>("GET", `/servicedesk/protocol/${protocolId}`);
      
      return {
        status: result.status,
        lastUpdate: result.lastUpdateAt,
      };
    } catch (error) {
      console.error(`Erro ao buscar status do protocolo ${protocolId}:`, error);
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

  async searchCustomers(query: string): Promise<VoalleCustomer[]> {
    if (!this.config) {
      throw new Error("Voalle não configurado");
    }

    try {
      const result = await this.apiRequest<VoalleCustomerSearchResponse>(
        "GET",
        `/v1/people?search=${encodeURIComponent(query)}&limit=50`
      );
      
      return result.data || [];
    } catch (error) {
      console.error("Erro ao buscar clientes no Voalle:", error);
      throw error;
    }
  }

  async getCustomer(customerId: number): Promise<VoalleCustomer | null> {
    if (!this.config) {
      throw new Error("Voalle não configurado");
    }

    try {
      const result = await this.apiRequest<VoalleCustomer>(
        "GET",
        `/v1/people/${customerId}`
      );
      
      return result;
    } catch (error) {
      console.error(`Erro ao buscar cliente ${customerId} no Voalle:`, error);
      return null;
    }
  }

  async getCustomerContracts(customerId: number): Promise<VoalleContract[]> {
    if (!this.config) {
      throw new Error("Voalle não configurado");
    }

    try {
      const result = await this.apiRequest<VoalleContractResponse>(
        "GET",
        `/v1/people/${customerId}/contracts`
      );
      
      return result.data || [];
    } catch (error) {
      console.error(`Erro ao buscar contratos do cliente ${customerId}:`, error);
      return [];
    }
  }

  async getOpenSolicitations(customerId?: number, contractId?: number): Promise<VoalleSolicitation[]> {
    if (!this.config) {
      throw new Error("Voalle não configurado");
    }

    try {
      let path = "/servicedesk/solicitations?status=open";
      if (customerId) {
        path += `&personId=${customerId}`;
      }
      if (contractId) {
        path += `&contractId=${contractId}`;
      }
      
      const result = await this.apiRequest<VoalleSolicitationResponse>(
        "GET",
        path
      );
      
      return result.data || [];
    } catch (error) {
      console.error("Erro ao buscar solicitações abertas:", error);
      return [];
    }
  }

  async getSolicitationsByProtocol(protocol: string): Promise<VoalleSolicitation | null> {
    if (!this.config) {
      throw new Error("Voalle não configurado");
    }

    try {
      const result = await this.apiRequest<VoalleSolicitation>(
        "GET",
        `/servicedesk/protocol/${protocol}`
      );
      
      return result;
    } catch (error) {
      console.error(`Erro ao buscar solicitação ${protocol}:`, error);
      return null;
    }
  }
}

export interface VoalleCustomer {
  id: number;
  name: string;
  txId?: string; // CPF/CNPJ
  email?: string;
  phone?: string;
  cellPhone?: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  neighborhood?: string;
  number?: string;
  complement?: string;
  personType?: string; // PF ou PJ
  fantasyName?: string;
  stateRegistration?: string;
}

interface VoalleCustomerSearchResponse {
  data: VoalleCustomer[];
  total: number;
  page: number;
  limit: number;
}

export interface VoalleContract {
  id: number;
  personId: number;
  planId: number;
  planName: string;
  status: string;
  value: number;
  startDate: string;
  endDate?: string;
}

interface VoalleContractResponse {
  data: VoalleContract[];
  total: number;
}

export interface VoalleSolicitation {
  id: number;
  protocol: string;
  subject: string;
  description?: string;
  status: string;
  priority?: string;
  personId?: number;
  personName?: string;
  contractId?: number;
  solicitationTypeCode?: string;
  solicitationTypeName?: string;
  createdAt: string;
  updatedAt?: string;
  closedAt?: string;
  assignedTo?: string;
  assignedToName?: string;
}

interface VoalleSolicitationResponse {
  data: VoalleSolicitation[];
  total: number;
  page?: number;
  limit?: number;
}

export const voalleService = new VoalleService();

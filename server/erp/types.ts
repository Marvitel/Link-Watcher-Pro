import type { Incident, ErpIntegration } from "@shared/schema";

export interface ErpCustomer {
  id: string;
  code: string;
  name: string;
  document?: string;
  email?: string;
  phone?: string;
}

export interface ErpTicket {
  id: string;
  protocol?: string;
  subject: string;
  description: string;
  status: string;
  priority?: string;
  createdAt: string;
  updatedAt?: string;
  customerId?: string;
}

export interface ErpContract {
  id: string;
  customerId: string;
  description?: string;
  status: string;
  bandwidth?: number;
  ipBlock?: string;
}

export interface CreateTicketParams {
  solicitationTypeCode: string;
  incident: Incident;
  linkName: string;
  linkLocation: string;
  customerId?: string;
  contractId?: string;
}

export interface ErpTestResult {
  success: boolean;
  message: string;
  details?: Record<string, unknown>;
}

export interface ErpAdapter {
  readonly provider: string;
  
  configure(config: ErpIntegration): void;
  
  isConfigured(): boolean;
  
  testConnection(): Promise<ErpTestResult>;
  
  searchCustomers(query: string): Promise<ErpCustomer[]>;
  
  getCustomer(customerId: string): Promise<ErpCustomer | null>;
  
  getCustomerContracts(customerId: string): Promise<ErpContract[]>;
  
  createTicket(params: CreateTicketParams): Promise<{
    success: boolean;
    ticketId?: string;
    protocol?: string;
    message: string;
  }>;
  
  getTicket(ticketId: string): Promise<ErpTicket | null>;
  
  getSolicitationTypes(): Promise<Array<{ code: string; name: string }>>;
}

export type ErpProvider = "voalle" | "ixc" | "sgp";
export type ErpConnectionType = "api" | "database";

import type { ErpIntegration } from "@shared/schema";
import type { ErpAdapter, ErpProvider } from "./types";
import { VoalleAdapter } from "./voalle-adapter";

export * from "./types";

const adapters: Map<number, ErpAdapter> = new Map();

function createAdapter(provider: ErpProvider): ErpAdapter {
  switch (provider) {
    case "voalle":
      return new VoalleAdapter();
    case "ixc":
      throw new Error("Adaptador IXC ainda não implementado");
    case "sgp":
      throw new Error("Adaptador SGP ainda não implementado");
    default:
      throw new Error(`Provider ERP desconhecido: ${provider}`);
  }
}

export function getErpAdapter(integration: ErpIntegration): ErpAdapter {
  let adapter = adapters.get(integration.id);
  
  if (!adapter) {
    adapter = createAdapter(integration.provider as ErpProvider);
    adapter.configure(integration);
    adapters.set(integration.id, adapter);
  }
  
  return adapter;
}

export function configureErpAdapter(integration: ErpIntegration): ErpAdapter {
  const adapter = createAdapter(integration.provider as ErpProvider);
  adapter.configure(integration);
  adapters.set(integration.id, adapter);
  return adapter;
}

export function clearErpAdapter(integrationId: number): void {
  adapters.delete(integrationId);
}

export function clearAllErpAdapters(): void {
  adapters.clear();
}

export class ErpService {
  private adapter: ErpAdapter | null = null;

  configure(integration: ErpIntegration): void {
    this.adapter = configureErpAdapter(integration);
  }

  getAdapter(): ErpAdapter | null {
    return this.adapter;
  }

  isConfigured(): boolean {
    return this.adapter !== null && this.adapter.isConfigured();
  }
}

export const erpService = new ErpService();

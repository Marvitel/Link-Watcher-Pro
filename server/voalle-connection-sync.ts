import { storage } from "./storage";
import { getErpAdapter } from "./erp";
import { VoalleAdapter } from "./erp/voalle-adapter";

const SYNC_INTERVAL_MS = 60 * 60 * 1000; // 1 hora

let syncTimer: NodeJS.Timeout | null = null;
let lastSync: { startedAt: Date; endedAt: Date | null; ok: boolean; updated: number; error?: string } | null = null;
let inFlight = false;

export interface VoalleConnectionSyncResult {
  ok: boolean;
  fetched: number;
  updated: number;
  error?: string;
  durationMs: number;
}

/**
 * Sincroniza o status técnico das conexões do Voalle (Normal/Bloqueada/
 * Aviso de Bloqueio/Aviso de Manutenção) com a coluna
 * `links.voalle_connection_status`. Match feito por `voalleConnectionId`.
 *
 * Usa o adapter Voalle ativo (provider='voalle' & isActive=true).
 */
export async function syncVoalleConnectionStatuses(): Promise<VoalleConnectionSyncResult> {
  const startedAt = new Date();
  if (inFlight) {
    return { ok: false, fetched: 0, updated: 0, error: "sync já em andamento", durationMs: 0 };
  }
  inFlight = true;
  lastSync = { startedAt, endedAt: null, ok: false, updated: 0 };

  try {
    const integration = await storage.getErpIntegrationByProvider("voalle");
    if (!integration) {
      const result = { ok: false, fetched: 0, updated: 0, error: "Nenhuma integração Voalle ativa", durationMs: Date.now() - startedAt.getTime() };
      lastSync = { startedAt, endedAt: new Date(), ok: false, updated: 0, error: result.error };
      return result;
    }

    const adapter = getErpAdapter(integration);
    if (!(adapter instanceof VoalleAdapter)) {
      const result = { ok: false, fetched: 0, updated: 0, error: "Adapter ativo não é Voalle", durationMs: Date.now() - startedAt.getTime() };
      lastSync = { startedAt, endedAt: new Date(), ok: false, updated: 0, error: result.error };
      return result;
    }

    const connections = await adapter.getAllConnectionStatus();
    if (connections.length === 0) {
      const result = { ok: true, fetched: 0, updated: 0, durationMs: Date.now() - startedAt.getTime() };
      lastSync = { startedAt, endedAt: new Date(), ok: true, updated: 0 };
      console.log(`[VoalleConnectionSync] Nenhuma conexão retornada pelo Voalle.`);
      return result;
    }

    const updates = connections.map(c => ({
      voalleConnectionId: c.id,
      status: c.status,
    }));

    const updated = await storage.bulkUpdateVoalleConnectionStatus(updates);
    const durationMs = Date.now() - startedAt.getTime();

    lastSync = { startedAt, endedAt: new Date(), ok: true, updated };
    console.log(
      `[VoalleConnectionSync] OK — ${connections.length} conexões recebidas, ${updated} links atualizados em ${durationMs}ms.`
    );
    return { ok: true, fetched: connections.length, updated, durationMs };
  } catch (error: any) {
    const message = error?.message || String(error);
    console.error("[VoalleConnectionSync] Erro:", message);
    lastSync = { startedAt, endedAt: new Date(), ok: false, updated: 0, error: message };
    return { ok: false, fetched: 0, updated: 0, error: message, durationMs: Date.now() - startedAt.getTime() };
  } finally {
    inFlight = false;
  }
}

export function getLastVoalleConnectionSync() {
  return lastSync;
}

export function startVoalleConnectionSyncScheduler(): void {
  if (syncTimer) {
    console.warn("[VoalleConnectionSync] Scheduler já iniciado, ignorando nova chamada.");
    return;
  }

  // Primeira execução depois de 60s (dá tempo do servidor terminar boot)
  setTimeout(() => {
    syncVoalleConnectionStatuses().catch(err => {
      console.error("[VoalleConnectionSync] Falha no sync inicial:", err?.message || err);
    });
  }, 60_000);

  syncTimer = setInterval(() => {
    syncVoalleConnectionStatuses().catch(err => {
      console.error("[VoalleConnectionSync] Falha no sync periódico:", err?.message || err);
    });
  }, SYNC_INTERVAL_MS);

  console.log(
    `[VoalleConnectionSync] Scheduler iniciado: sync a cada ${SYNC_INTERVAL_MS / 60000}min (primeira execução em 60s).`
  );
}

export function stopVoalleConnectionSyncScheduler(): void {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }
}

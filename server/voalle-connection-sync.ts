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
  fetchedDeleted: number;
  updated: number;
  error?: string;
  durationMs: number;
}

/**
 * Sincroniza o status técnico das conexões do Voalle com a coluna
 * `links.voalle_connection_status`. Match feito por `voalleConnectionId`.
 *
 * Combina DOIS endpoints:
 * - GET /external/map/connection/all          → status numérico (1=Normal, 2=Bloqueada, 3=Aviso Bloqueio, 4=Aviso Manutenção)
 * - GET /external/map/connection/all/deleted  → conexões excluídas (contrato cancelado)
 *   marcadas com status "deleted" no Link Monitor
 *
 * Conexões excluídas têm prioridade sobre ativas (caso, raro, alguma apareça nas duas listas)
 * porque o estado "deleted" é terminal — significa que a conexão técnica não existe mais.
 *
 * Usa o adapter Voalle ativo (provider='voalle' & isActive=true).
 */
export async function syncVoalleConnectionStatuses(): Promise<VoalleConnectionSyncResult> {
  const startedAt = new Date();
  if (inFlight) {
    return { ok: false, fetched: 0, fetchedDeleted: 0, updated: 0, error: "sync já em andamento", durationMs: 0 };
  }
  inFlight = true;
  lastSync = { startedAt, endedAt: null, ok: false, updated: 0 };

  try {
    const integration = await storage.getErpIntegrationByProvider("voalle");
    if (!integration) {
      const result = { ok: false, fetched: 0, fetchedDeleted: 0, updated: 0, error: "Nenhuma integração Voalle ativa", durationMs: Date.now() - startedAt.getTime() };
      lastSync = { startedAt, endedAt: new Date(), ok: false, updated: 0, error: result.error };
      return result;
    }

    const adapter = getErpAdapter(integration);
    if (!(adapter instanceof VoalleAdapter)) {
      const result = { ok: false, fetched: 0, fetchedDeleted: 0, updated: 0, error: "Adapter ativo não é Voalle", durationMs: Date.now() - startedAt.getTime() };
      lastSync = { startedAt, endedAt: new Date(), ok: false, updated: 0, error: result.error };
      return result;
    }

    // Busca os dois endpoints em paralelo.
    const [activeConnections, deletedConnections] = await Promise.all([
      adapter.getAllConnectionStatus(),
      adapter.getAllDeletedConnectionStatus(),
    ]);

    if (activeConnections.length === 0 && deletedConnections.length === 0) {
      const result = { ok: true, fetched: 0, fetchedDeleted: 0, updated: 0, durationMs: Date.now() - startedAt.getTime() };
      lastSync = { startedAt, endedAt: new Date(), ok: true, updated: 0 };
      console.log(`[VoalleConnectionSync] Nenhuma conexão (ativa ou excluída) retornada pelo Voalle.`);
      return result;
    }

    // IMPORTANTE: deletadas vão por ÚLTIMO no array para que o dedup do
    // bulkUpdateVoalleConnectionStatus (Map.set) sobrescreva o status ativo
    // pelo "deleted" no caso improvável de uma conexão aparecer nos 2 endpoints.
    const updates = [
      ...activeConnections.map(c => ({ voalleConnectionId: c.id, status: c.status })),
      ...deletedConnections.map(c => ({ voalleConnectionId: c.id, status: "deleted" })),
    ];

    const updated = await storage.bulkUpdateVoalleConnectionStatus(updates);
    const durationMs = Date.now() - startedAt.getTime();

    lastSync = { startedAt, endedAt: new Date(), ok: true, updated };
    console.log(
      `[VoalleConnectionSync] OK — ${activeConnections.length} ativas + ${deletedConnections.length} excluídas recebidas, ${updated} links atualizados em ${durationMs}ms.`
    );
    return { ok: true, fetched: activeConnections.length, fetchedDeleted: deletedConnections.length, updated, durationMs };
  } catch (error: any) {
    const message = error?.message || String(error);
    console.error("[VoalleConnectionSync] Erro:", message);
    lastSync = { startedAt, endedAt: new Date(), ok: false, updated: 0, error: message };
    return { ok: false, fetched: 0, fetchedDeleted: 0, updated: 0, error: message, durationMs: Date.now() - startedAt.getTime() };
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

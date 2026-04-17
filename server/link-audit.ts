/**
 * Auditoria de cadastro dos links
 * ================================
 * Para cada link ativo, verifica os campos críticos do cadastro e gera "pendências"
 * objetivas (1 pendência = 1 problema concreto, com sugestão de ação).
 *
 * As pendências geradas vão para a tabela `link_pending_items`. A UI permite ao usuário
 * autorizar (aplica a sugestão), dispensar (com motivo, alimenta aprendizado da IA) ou adiar.
 *
 * Roda 1x/dia automaticamente (configurável em ai_analyst_settings.dailyAuditHourUtc) e
 * sob demanda via endpoint POST /api/admin/link-audit/run.
 */

import { db } from "./db";
import { storage } from "./storage";
import { links, metrics, linkPendingItems } from "@shared/schema";
import { and, eq, gte, sql } from "drizzle-orm";
import type { InsertLinkPendingItem, Link } from "@shared/schema";

// ============================================================
// Definição dos checks
// ============================================================

type AuditCheck = {
  field: string;
  classification: "missing" | "inconsistent" | "optimization" | "urgent";
  nextStep: "apply_now" | "needs_voalle_change" | "needs_field_visit" | "wait_voalle_sync" | "manual_investigation";
  suggestedAction: string;
  reason: string;
  currentValue: string | null;
  suggestedValue: string | null;
};

/**
 * Avalia um link e devolve a lista de pendências encontradas.
 * Esta função NÃO acessa serviços externos (RADIUS/Voalle/SNMP) para ser rápida e
 * resiliente — investigações profundas são responsabilidade do Analista IA.
 */
async function auditLinkFields(link: Link): Promise<AuditCheck[]> {
  const checks: AuditCheck[] = [];
  const isPppoe = (link as any).authType === "pppoe";
  const isCorporate = (link as any).authType === "corporate";

  // 1) IP monitorado faltando
  if (!link.monitoredIp) {
    checks.push({
      field: "monitoredIp",
      classification: "missing",
      nextStep: "manual_investigation",
      suggestedAction: "Definir o IP monitorado deste link",
      reason: "Campo monitoredIp está vazio — sem IP, o monitoramento de latência/perda não funciona.",
      currentValue: null,
      suggestedValue: null,
    });
  }

  // 2) PPPoE: usuário PPPoE faltando
  if (isPppoe && !(link as any).pppoeUser) {
    checks.push({
      field: "pppoeUser",
      classification: "missing",
      nextStep: "needs_voalle_change",
      suggestedAction: "Cadastrar o usuário PPPoE deste link (verificar no Voalle ou no concentrador)",
      reason: "Link configurado como PPPoE mas sem usuário cadastrado — RADIUS não consegue identificar a sessão.",
      currentValue: null,
      suggestedValue: null,
    });
  }

  // 3) PPPoE: concentrador faltando
  if (isPppoe && !link.concentratorId) {
    checks.push({
      field: "concentratorId",
      classification: "missing",
      nextStep: "manual_investigation",
      suggestedAction: "Associar este link a um concentrador PPPoE",
      reason: "Link PPPoE sem concentrador associado — não há como verificar sessão ativa nem coletar tráfego.",
      currentValue: null,
      suggestedValue: null,
    });
  }

  // 4) GPON (tem oltId): slot/port/onu faltando
  if (link.oltId) {
    if (link.slotOlt == null) {
      checks.push({
        field: "slotOlt",
        classification: "missing",
        nextStep: "manual_investigation",
        suggestedAction: "Informar o slot da OLT onde está esta ONU",
        reason: "OLT cadastrada mas slot ausente — sinal óptico não pode ser coletado.",
        currentValue: null,
        suggestedValue: null,
      });
    }
    if (link.portOlt == null) {
      checks.push({
        field: "portOlt",
        classification: "missing",
        nextStep: "manual_investigation",
        suggestedAction: "Informar a porta PON da OLT",
        reason: "OLT cadastrada mas porta ausente — sinal óptico não pode ser coletado.",
        currentValue: null,
        suggestedValue: null,
      });
    }
    if (link.onuId == null) {
      checks.push({
        field: "onuId",
        classification: "missing",
        nextStep: "manual_investigation",
        suggestedAction: "Informar o ID da ONU",
        reason: "OLT/slot/porta cadastrados mas ONU ID ausente — não é possível identificar a ONU específica.",
        currentValue: null,
        suggestedValue: null,
      });
    }
  }

  // 5) Serial do equipamento (CPE) — útil para ACS Flashman como fallback óptico
  if (!(link as any).equipmentSerialNumber) {
    checks.push({
      field: "equipmentSerialNumber",
      classification: "optimization",
      nextStep: "needs_field_visit",
      suggestedAction: "Cadastrar o serial da ONU/CPE",
      reason: "Sem serial, fallback óptico via ACS (Flashman) não funciona quando a OLT falhar.",
      currentValue: null,
      suggestedValue: null,
    });
  }

  // 6) Voalle contract tag — necessário para webhooks e abertura de chamados
  if (!link.voalleContractTagId) {
    checks.push({
      field: "voalleContractTagId",
      classification: "optimization",
      nextStep: "wait_voalle_sync",
      suggestedAction: "Vincular este link a um contrato no Voalle",
      reason: "Sem voalleContractTagId, webhooks do Voalle não atualizam este link automaticamente.",
      currentValue: null,
      suggestedValue: null,
    });
  }

  // 7) Status de contrato inconsistente
  const contractStatus = (link as any).contractStatus;
  if ((contractStatus === "blocked" || contractStatus === "cancelled") && (link as any).monitoringEnabled === true) {
    checks.push({
      field: "monitoringEnabled",
      classification: "inconsistent",
      nextStep: "apply_now",
      suggestedAction: `Desabilitar monitoramento (contrato está ${contractStatus})`,
      reason: `Contrato ${contractStatus} não deveria estar gerando métricas/eventos — economiza recursos.`,
      currentValue: "true",
      suggestedValue: "false",
    });
  }

  // 8) Métricas paradas há >24h em link com monitoramento ativo
  if ((link as any).monitoringEnabled === true && contractStatus === "active") {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentMetrics = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(metrics)
      .where(and(eq(metrics.linkId, link.id), gte(metrics.timestamp, since)));
    const count = recentMetrics[0]?.count ?? 0;
    if (count === 0) {
      checks.push({
        field: "_metrics_stale",
        classification: "urgent",
        nextStep: "manual_investigation",
        suggestedAction: "Investigar por que não há métricas há >24h (link ativo)",
        reason: "Link operacional segundo cadastro mas sem métricas coletadas — possível falha de coleta SNMP/ICMP.",
        currentValue: "0 métricas em 24h",
        suggestedValue: null,
      });
    }
  }

  // 9) GPON: leitura óptica ausente nas últimas 24h
  if (link.oltId && link.slotOlt != null && link.portOlt != null && link.onuId != null) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentOptical = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(metrics)
      .where(
        and(
          eq(metrics.linkId, link.id),
          gte(metrics.timestamp, since),
          sql`(${metrics.opticalRxPower} IS NOT NULL OR ${metrics.opticalOltRxPower} IS NOT NULL)`
        )
      );
    const count = recentOptical[0]?.count ?? 0;
    if (count === 0) {
      checks.push({
        field: "_optical_stale",
        classification: "optimization",
        nextStep: "manual_investigation",
        suggestedAction: "Verificar coleta óptica (OLT/Zabbix/ACS)",
        reason: "ONU cadastrada (OLT/slot/porta/ID) mas sem leitura óptica há >24h.",
        currentValue: null,
        suggestedValue: null,
      });
    }
  }

  return checks;
}

// ============================================================
// Execução em lote
// ============================================================

export type AuditRunSummary = {
  scannedLinks: number;
  generatedItems: number;
  updatedItems: number;
  resolvedItems: number;
  durationMs: number;
};

let runningAudit = false;

export async function runFullAudit(opts?: { onlyProblematic?: boolean }): Promise<AuditRunSummary> {
  if (runningAudit) {
    throw new Error("Auditoria já em andamento");
  }
  runningAudit = true;
  const startedAt = Date.now();

  try {
    // Busca links candidatos (não deletados)
    const conditions = [sql`${links.deletedAt} IS NULL`];
    if (opts?.onlyProblematic) {
      conditions.push(sql`${links.status} IN ('offline', 'degraded')`);
    }
    const targetLinks = await db.select().from(links).where(and(...conditions));

    let generated = 0;
    let updated = 0;
    let resolved = 0;

    for (const link of targetLinks) {
      let checks: AuditCheck[];
      try {
        checks = await auditLinkFields(link);
      } catch (err) {
        console.error(`[LinkAudit] erro auditando link ${link.id}:`, err);
        continue;
      }

      // Persiste cada pendência (upsert por linkId+field)
      const detectedFields = new Set<string>();
      for (const c of checks) {
        detectedFields.add(c.field);
        const existing = await storage.findLinkPendingItem(link.id, c.field);
        const wasNew = !existing || ["dismissed", "applied"].includes(existing.status);
        const data: InsertLinkPendingItem = {
          linkId: link.id,
          field: c.field,
          currentValue: c.currentValue,
          suggestedValue: c.suggestedValue,
          source: "audit",
          classification: c.classification,
          status: "pending",
          nextStep: c.nextStep,
          suggestedAction: c.suggestedAction,
          reason: c.reason,
        };
        // Se já existe ativo (pending/snoozed), só atualiza dados; senão cria novo
        await storage.upsertLinkPendingItem(data);
        if (wasNew) generated++;
        else updated++;
      }

      // Auto-resolve pendências de auditoria que não foram mais detectadas
      // (campo foi preenchido entre uma auditoria e outra)
      const previousActive = await db
        .select()
        .from(linkPendingItems)
        .where(
          and(
            eq(linkPendingItems.linkId, link.id),
            eq(linkPendingItems.source, "audit"),
            eq(linkPendingItems.status, "pending")
          )
        );
      for (const p of previousActive) {
        if (!detectedFields.has(p.field)) {
          await storage.updateLinkPendingItem(p.id, {
            status: "applied",
            resolvedAt: new Date(),
            resolutionNote: "Auto-resolvido: pendência não foi mais detectada na auditoria seguinte.",
          });
          resolved++;
        }
      }
    }

    // Marca a hora da última auditoria nas settings
    try {
      await storage.updateAiAnalystSettings({ lastAuditAt: new Date() } as any);
    } catch {
      // ignore — não bloquear se settings não existirem
    }

    return {
      scannedLinks: targetLinks.length,
      generatedItems: generated,
      updatedItems: updated,
      resolvedItems: resolved,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    runningAudit = false;
  }
}

export function isAuditRunning(): boolean {
  return runningAudit;
}

// ============================================================
// Cron diário
// ============================================================

let dailyTimer: NodeJS.Timeout | null = null;

export function startDailyAuditScheduler(): void {
  // Verifica a cada 30min se chegou a hora configurada de rodar
  if (dailyTimer) clearInterval(dailyTimer);

  let lastRunDate: string | null = null;

  dailyTimer = setInterval(async () => {
    try {
      const settings = await storage.getAiAnalystSettings();
      if (!(settings as any).dailyAuditEnabled) return;

      const targetHour = (settings as any).dailyAuditHourUtc ?? 6;
      const now = new Date();
      const todayKey = now.toISOString().slice(0, 10);

      if (now.getUTCHours() === targetHour && lastRunDate !== todayKey) {
        lastRunDate = todayKey;
        console.log("[LinkAudit] iniciando auditoria diária automática...");
        const summary = await runFullAudit();
        console.log(
          `[LinkAudit] auditoria diária concluída: ${summary.scannedLinks} links, ` +
            `${summary.generatedItems} novas, ${summary.updatedItems} atualizadas, ` +
            `${summary.resolvedItems} resolvidas em ${summary.durationMs}ms`
        );
      }
    } catch (err) {
      console.error("[LinkAudit] erro no scheduler diário:", err);
    }
  }, 30 * 60 * 1000); // 30 min

  console.log("[LinkAudit] scheduler diário iniciado (verifica a cada 30min)");
}

// ============================================================
// Aplicação de uma pendência (autorizar)
// ============================================================

const APPLIABLE_FIELDS = new Set([
  "monitoredIp",
  "pppoeUser",
  "concentratorId",
  "oltId",
  "slotOlt",
  "portOlt",
  "onuId",
  "equipmentSerialNumber",
  "voalleContractTagId",
  "monitoringEnabled",
]);

/**
 * Autoriza uma pendência:
 *   - Se policy='immediate' (ou não definida): aplica direto no link e marca status='applied'
 *   - Se policy='authorize_only': apenas marca status='authorized' (aplicação manual depois)
 */
export async function authorizePendingItem(
  itemId: number,
  reviewerUserId?: number,
  overrideValue?: string,
  note?: string
): Promise<{ ok: boolean; applied: boolean; error?: string }> {
  const item = await storage.getLinkPendingItem(itemId);
  if (!item) return { ok: false, applied: false, error: "pendência não encontrada" };
  if (!["pending", "snoozed"].includes(item.status)) {
    return { ok: false, applied: false, error: `pendência já está em status ${item.status}` };
  }

  // Pendências meta (_metrics_stale, _optical_stale) não aplicam mudanças — só marcam autorizadas
  const isMetaField = item.field.startsWith("_");
  if (!isMetaField && !APPLIABLE_FIELDS.has(item.field)) {
    return { ok: false, applied: false, error: `campo ${item.field} não está na whitelist de aplicação` };
  }

  // Decide se aplica imediatamente ou só autoriza
  let policy: "immediate" | "authorize_only" = "immediate";
  try {
    const settings = await storage.getAiAnalystSettings();
    const ap = (settings as any).actionPolicy as Record<string, string> | undefined;
    if (ap && ap[item.field] === "authorize_only") policy = "authorize_only";
  } catch {
    /* default immediate */
  }

  const valueToApply = overrideValue ?? item.suggestedValue;

  if (policy === "authorize_only" || isMetaField || valueToApply == null) {
    // Só marca como autorizada — operador aplica em lote/manualmente
    await storage.updateLinkPendingItem(itemId, {
      status: "authorized",
      resolvedByUserId: reviewerUserId ?? null,
      resolutionNote: note ?? null,
      resolvedAt: new Date(),
    } as any);
    return { ok: true, applied: false };
  }

  // Aplica imediatamente no link
  const link = await storage.getLink(item.linkId);
  if (!link) return { ok: false, applied: false, error: "link não existe mais" };

  // Coage o valor para o tipo certo (campos numéricos / booleanos)
  let coerced: any = valueToApply;
  if (
    ["concentratorId", "oltId", "slotOlt", "portOlt", "onuId", "voalleContractTagId"].includes(item.field)
  ) {
    const n = Number(valueToApply);
    coerced = Number.isFinite(n) ? n : null;
  } else if (item.field === "monitoringEnabled") {
    coerced = valueToApply === "true";
  }

  await storage.updateLink(item.linkId, { [item.field]: coerced } as any);

  await storage.updateLinkPendingItem(itemId, {
    status: "applied",
    resolvedByUserId: reviewerUserId ?? null,
    resolutionNote: note ?? null,
    resolvedAt: new Date(),
  } as any);

  return { ok: true, applied: true };
}

export async function dismissPendingItem(
  itemId: number,
  reviewerUserId: number | undefined,
  reason: string
): Promise<{ ok: boolean; error?: string }> {
  const item = await storage.getLinkPendingItem(itemId);
  if (!item) return { ok: false, error: "pendência não encontrada" };
  if (!["pending", "snoozed", "authorized"].includes(item.status)) {
    return { ok: false, error: `pendência já está em status ${item.status}` };
  }
  await storage.updateLinkPendingItem(itemId, {
    status: "dismissed",
    resolvedByUserId: reviewerUserId ?? null,
    resolutionNote: reason,
    resolvedAt: new Date(),
  } as any);
  return { ok: true };
}

export async function snoozePendingItem(
  itemId: number,
  reviewerUserId: number | undefined,
  hours: number
): Promise<{ ok: boolean; error?: string }> {
  const item = await storage.getLinkPendingItem(itemId);
  if (!item) return { ok: false, error: "pendência não encontrada" };
  if (item.status !== "pending" && item.status !== "authorized") {
    return { ok: false, error: `não é possível adiar pendência com status "${item.status}"` };
  }
  const until = new Date(Date.now() + Math.max(1, Math.min(720, hours)) * 60 * 60 * 1000);
  await storage.updateLinkPendingItem(itemId, {
    status: "snoozed",
    snoozedUntil: until,
    resolvedAt: null,
    resolutionNote: null,
    resolvedByUserId: reviewerUserId ?? null,
  } as any);
  return { ok: true };
}

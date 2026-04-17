/**
 * Analista de IA — orquestra investigação e proposição de correções para links.
 *
 * Fluxo:
 *   enqueueLink(linkId, reason) → cria task pendente
 *   processNextTask()           → pega próxima task, monta contexto, chama LLM com tools,
 *                                  grava proposta para revisão humana (ou auto-aplica conforme settings)
 *   applyProposal(proposalId)   → aplica os campos aprovados no link e fecha a task
 *
 * Sem chave Anthropic configurada, gera uma proposta stub (classification=inconclusive).
 * Quando a chave estiver presente, basta trocar a função `runLlmInvestigation` por chamada real.
 */

import { db } from "./db";
import { eq, and, desc, sql } from "drizzle-orm";
import { storage } from "./storage";
import {
  links,
  events,
  metrics,
  snmpConcentrators,
  olts,
  type Link,
  type AiAnalystTask,
  type AiAnalystProposal,
  type InsertAiAnalystCorrection,
} from "@shared/schema";
import { decrypt } from "./crypto";
import { logAuditEvent } from "./audit";

// Campos que a IA tem permissão de propor alteração. Whitelist explícita por segurança.
const ALLOWED_FIELDS = new Set<string>([
  "snmpInterfaceAlias",
  "snmpInterfaceIndex",
  "snmpInterfaceName",
  "snmpInterfaceDescr",
  "snmpRouterIp",
  "monitoredIp",
  "concentratorId",
  "snmpProfileId",
  "pppoeUser",
  "vlan",
  "vlanInterface",
  "trafficSourceType",
  "accessPointId",
  "accessPointInterfaceIndex",
  "accessPointInterfaceName",
  "equipmentVendorId",
  "equipmentModel",
  "equipmentSerialNumber",
  "oltId",
  "slotOlt",
  "portOlt",
  "onuSearchString",
  "onuId",
  "switchId",
  "switchPort",
  "cpeVendor",
  "ozmapTag",
  "invertBandwidth",
  "isL2Link",
  "icmpBlocked",
  "linkType",
  "authType",
]);

// =====================================================================
// Enfileiramento
// =====================================================================

const TRIGGER_PRIORITIES: Record<string, number> = {
  manual: 200,
  offline_link: 100,
  voalle_webhook_new: 80,
  batch_diagnostic: 60,
  degraded_link: 50,
};

export async function enqueueLink(
  linkId: number,
  reason: string,
  enqueuedByUserId?: number
): Promise<AiAnalystTask | null> {
  const link = await storage.getLink(linkId);
  if (!link) return null;

  // Evita duplicatas: se já tem task aberta para esse link, não cria outra
  const hasOpen = await storage.hasOpenAiAnalystTaskForLink(linkId);
  if (hasOpen) return null;

  const priority = TRIGGER_PRIORITIES[reason] ?? 50;
  return storage.createAiAnalystTask({
    linkId,
    triggerReason: reason,
    status: "pending",
    priority,
    enqueuedByUserId: enqueuedByUserId ?? null,
  } as any);
}

export async function enqueueLinksBulk(
  linkIds: number[],
  reason: string,
  enqueuedByUserId?: number
): Promise<{ enqueued: number; skipped: number }> {
  let enqueued = 0;
  let skipped = 0;
  for (const id of linkIds) {
    const t = await enqueueLink(id, reason, enqueuedByUserId);
    if (t) enqueued++;
    else skipped++;
  }
  return { enqueued, skipped };
}

// =====================================================================
// Coleta de contexto (o que a IA "sabe" sobre o link antes de investigar)
// =====================================================================

interface LinkContext {
  link: Link;
  recentEvents: Array<{ type: string; description: string; createdAt: Date }>;
  recentMetricsSummary: {
    samples: number;
    avgLatency: number;
    avgPacketLoss: number;
    avgDownload: number;
    avgUpload: number;
    lastStatus: string | null;
  };
  concentrator: { id: number; name: string; ipAddress: string; vendor: string | null } | null;
  olt: { id: number; name: string; vendor: string | null } | null;
  similarLinks: Array<{ id: number; name: string; concentratorId: number | null; pppoeUser: string | null; snmpInterfaceAlias: string | null }>;
  rules: Array<{ ruleText: string; priority: number }>;
  recentCorrections: Array<{ fieldName: string; aiValue: string | null; userValue: string | null; userNote: string | null }>;
}

async function buildLinkContext(link: Link): Promise<LinkContext> {
  // Eventos recentes
  const recentEventsRaw = await db
    .select()
    .from(events)
    .where(eq(events.linkId, link.id))
    .orderBy(desc(events.createdAt))
    .limit(15);

  // Métricas das últimas 24h (resumo)
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const metricsRows = await db
    .select({
      latency: metrics.latency,
      packetLoss: metrics.packetLoss,
      download: metrics.download,
      upload: metrics.upload,
      status: metrics.status,
    })
    .from(metrics)
    .where(and(eq(metrics.linkId, link.id), sql`${metrics.timestamp} >= ${since}`))
    .limit(500);

  const samples = metricsRows.length;
  const sum = metricsRows.reduce(
    (acc, r) => ({
      latency: acc.latency + (r.latency || 0),
      packetLoss: acc.packetLoss + (r.packetLoss || 0),
      download: acc.download + (r.download || 0),
      upload: acc.upload + (r.upload || 0),
    }),
    { latency: 0, packetLoss: 0, download: 0, upload: 0 }
  );

  // Concentrador
  let concentrator: LinkContext["concentrator"] = null;
  if (link.concentratorId) {
    const [c] = await db.select().from(snmpConcentrators).where(eq(snmpConcentrators.id, link.concentratorId));
    if (c) concentrator = { id: c.id, name: c.name, ipAddress: c.ipAddress, vendor: (c as any).vendor || null };
  }

  // OLT
  let olt: LinkContext["olt"] = null;
  if (link.oltId) {
    const [o] = await db.select().from(olts).where(eq(olts.id, link.oltId));
    if (o) olt = { id: o.id, name: o.name, vendor: (o as any).vendor || null };
  }

  // Links similares (mesmo cliente + mesmo concentrador, com PPPoE/alias preenchido)
  const similarLinks = await db
    .select({
      id: links.id,
      name: links.name,
      concentratorId: links.concentratorId,
      pppoeUser: links.pppoeUser,
      snmpInterfaceAlias: links.snmpInterfaceAlias,
    })
    .from(links)
    .where(
      and(
        eq(links.clientId, link.clientId),
        link.concentratorId ? eq(links.concentratorId, link.concentratorId) : sql`true`,
        sql`${links.id} != ${link.id}`,
        sql`(${links.pppoeUser} IS NOT NULL OR ${links.snmpInterfaceAlias} IS NOT NULL)`
      )
    )
    .limit(10);

  // Regras ativas
  const rulesRows = await storage.getAiAnalystRules(true);
  const rules = rulesRows.map((r) => ({ ruleText: r.ruleText, priority: r.priority }));

  // Correções recentes (aprendizado)
  const correctionsRows = await storage.getRecentAiAnalystCorrections(20);
  const recentCorrections = correctionsRows.map((c) => ({
    fieldName: c.fieldName,
    aiValue: c.aiValue,
    userValue: c.userValue,
    userNote: c.userNote,
  }));

  return {
    link,
    recentEvents: recentEventsRaw.map((e) => ({ type: e.type, description: e.description, createdAt: e.createdAt })),
    recentMetricsSummary: {
      samples,
      avgLatency: samples ? sum.latency / samples : 0,
      avgPacketLoss: samples ? sum.packetLoss / samples : 0,
      avgDownload: samples ? sum.download / samples : 0,
      avgUpload: samples ? sum.upload / samples : 0,
      lastStatus: metricsRows[0]?.status ?? null,
    },
    concentrator,
    olt,
    similarLinks,
    rules,
    recentCorrections,
  };
}

// =====================================================================
// LLM call (stub até a chave Anthropic ser configurada)
// =====================================================================

interface LlmResult {
  classification: "config_error" | "network_issue" | "inconclusive";
  proposedFields: Record<string, unknown>;
  reasoning: string;
  confidence: number; // 0-100
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  modelUsed: string;
  toolCalls: Array<{ tool: string; input: unknown; output: unknown; durationMs: number }>;
}

async function runLlmInvestigation(ctx: LinkContext): Promise<LlmResult> {
  const settings = await storage.getAiAnalystSettings();

  // Sem chave: retorna stub coerente para validar UI/fluxo
  if (!settings.apiKeyEncrypted) {
    return {
      classification: "inconclusive",
      proposedFields: {},
      reasoning:
        "Analista de IA ainda não está conectado: configure a chave da API (Anthropic) na aba 'Analista IA → Configurações'. " +
        `Contexto coletado: ${ctx.recentEvents.length} eventos recentes, ` +
        `${ctx.recentMetricsSummary.samples} amostras de métricas nas últimas 24h, ` +
        `${ctx.similarLinks.length} links similares, ${ctx.rules.length} regras ativas.`,
      confidence: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      modelUsed: "stub",
      toolCalls: [],
    };
  }

  // TODO (próxima etapa, quando a chave chegar): implementar chamada real Anthropic
  //   - Importar @anthropic-ai/sdk dinamicamente
  //   - Decrypt apiKey: const apiKey = decrypt(settings.apiKeyEncrypted)
  //   - Definir tools (function-calling) que invocam funções reais do sistema
  //   - Loop: messages.create → if tool_use → executar tool → enviar tool_result → repetir
  //   - Parsear JSON final estruturado e retornar
  return {
    classification: "inconclusive",
    proposedFields: {},
    reasoning: "[stub] Chave configurada mas integração real ainda não implementada nesta versão.",
    confidence: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    modelUsed: settings.model,
    toolCalls: [],
  };
}

// =====================================================================
// Processamento de tasks
// =====================================================================

let isProcessing = false;

export async function processNextTask(): Promise<{ processed: boolean; proposalId?: number; error?: string }> {
  if (isProcessing) return { processed: false, error: "another task already in progress" };
  isProcessing = true;
  try {
    const task = await storage.getNextPendingAiAnalystTask();
    if (!task) return { processed: false };

    // Marca como em investigação
    await storage.updateAiAnalystTask(task.id, { status: "investigating", startedAt: new Date() });

    const link = await storage.getLink(task.linkId);
    if (!link) {
      await storage.updateAiAnalystTask(task.id, {
        status: "failed",
        errorMessage: "Link não encontrado",
        completedAt: new Date(),
      });
      return { processed: true, error: "link not found" };
    }

    let llmResult: LlmResult;
    try {
      const ctx = await buildLinkContext(link);
      llmResult = await runLlmInvestigation(ctx);
    } catch (err: any) {
      await storage.updateAiAnalystTask(task.id, {
        status: "failed",
        errorMessage: err?.message || String(err),
        completedAt: new Date(),
      });
      return { processed: true, error: err?.message || String(err) };
    }

    // Sanitiza proposedFields: só campos da whitelist
    const sanitizedFields: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(llmResult.proposedFields)) {
      if (ALLOWED_FIELDS.has(k)) sanitizedFields[k] = v;
    }

    const proposal = await storage.createAiAnalystProposal({
      taskId: task.id,
      linkId: link.id,
      classification: llmResult.classification,
      proposedFields: sanitizedFields,
      reasoning: llmResult.reasoning,
      confidence: Math.max(0, Math.min(100, Math.round(llmResult.confidence))),
      modelUsed: llmResult.modelUsed,
      inputTokens: llmResult.inputTokens,
      outputTokens: llmResult.outputTokens,
      costUsd: llmResult.costUsd,
      toolCalls: llmResult.toolCalls,
      status: "pending_review",
    } as any);

    // Atualiza contadores globais
    if (llmResult.inputTokens || llmResult.outputTokens || llmResult.costUsd) {
      await storage.incrementAiAnalystUsage(llmResult.inputTokens, llmResult.outputTokens, llmResult.costUsd);
    }

    await storage.updateAiAnalystTask(task.id, { status: "proposed", completedAt: new Date() });

    // Auto-aplicar conforme modo de autonomia
    const settings = await storage.getAiAnalystSettings();
    if (
      settings.autonomyMode === "auto" ||
      (settings.autonomyMode === "hybrid" &&
        proposal.confidence >= settings.autoApplyConfidenceThreshold &&
        Object.keys(sanitizedFields).length > 0)
    ) {
      await applyProposal(proposal.id, undefined, "auto");
    }

    return { processed: true, proposalId: proposal.id };
  } finally {
    isProcessing = false;
  }
}

// =====================================================================
// Aplicar proposta (com possibilidade de edição manual antes)
// =====================================================================

export async function applyProposal(
  proposalId: number,
  reviewerUserId?: number,
  origin: "manual" | "auto" = "manual",
  overrideFields?: Record<string, unknown>,
  reviewerNote?: string
): Promise<{ ok: boolean; error?: string; correctionsLogged: number }> {
  const proposal = await storage.getAiAnalystProposal(proposalId);
  if (!proposal) return { ok: false, error: "proposta não encontrada", correctionsLogged: 0 };
  if (proposal.status !== "pending_review") {
    return { ok: false, error: `proposta já está em status ${proposal.status}`, correctionsLogged: 0 };
  }

  const link = await storage.getLink(proposal.linkId);
  if (!link) return { ok: false, error: "link não existe mais", correctionsLogged: 0 };

  const aiFields = (proposal.proposedFields || {}) as Record<string, unknown>;
  const finalFields = overrideFields ? { ...aiFields, ...overrideFields } : aiFields;

  // Filtra novamente pela whitelist (defesa em profundidade)
  const safeFields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(finalFields)) {
    if (ALLOWED_FIELDS.has(k)) safeFields[k] = v;
  }

  // Detecta correções (campos onde o usuário mudou em relação ao que a IA propôs)
  const corrections: InsertAiAnalystCorrection[] = [];
  if (overrideFields) {
    for (const [k, userVal] of Object.entries(overrideFields)) {
      if (!ALLOWED_FIELDS.has(k)) continue;
      const aiVal = aiFields[k];
      if (JSON.stringify(aiVal) !== JSON.stringify(userVal)) {
        corrections.push({
          proposalId: proposal.id,
          linkId: link.id,
          fieldName: k,
          aiValue: aiVal != null ? String(aiVal) : null,
          userValue: userVal != null ? String(userVal) : null,
          userNote: reviewerNote ?? null,
          correctedByUserId: reviewerUserId ?? null,
        } as any);
      }
    }
  }

  // Aplica os campos
  if (Object.keys(safeFields).length > 0) {
    await storage.updateLink(link.id, safeFields as any);
  }

  // Grava correções
  if (corrections.length > 0) {
    await storage.createAiAnalystCorrectionsBulk(corrections);
  }

  // Atualiza proposta
  await storage.updateAiAnalystProposal(proposal.id, {
    status: origin === "auto" ? "auto_applied" : "applied",
    reviewedByUserId: reviewerUserId ?? null,
    reviewedAt: new Date(),
    reviewerNote: reviewerNote ?? null,
  } as any);

  // Fecha task
  await storage.updateAiAnalystTask(proposal.taskId, { status: "applied" });

  // Audit
  try {
    await logAuditEvent({
      clientId: link.clientId,
      actor: reviewerUserId
        ? ({ id: reviewerUserId, email: "", name: "AI reviewer", role: "operator" } as any)
        : ({ id: null, email: "system@ai-analyst", name: "AI Analyst", role: "system" } as any),
      action: "config_change",
      entity: "link",
      entityId: link.id,
      metadata: {
        source: "ai_analyst",
        event: origin === "auto" ? "proposal_auto_applied" : "proposal_applied",
        proposalId: proposal.id,
        appliedFields: Object.keys(safeFields),
        corrections: corrections.length,
        confidence: proposal.confidence,
        classification: proposal.classification,
      },
    });
  } catch {
    // falha em audit não deve quebrar a aplicação
  }

  return { ok: true, correctionsLogged: corrections.length };
}

export async function rejectProposal(
  proposalId: number,
  reviewerUserId?: number,
  reviewerNote?: string
): Promise<{ ok: boolean; error?: string }> {
  const proposal = await storage.getAiAnalystProposal(proposalId);
  if (!proposal) return { ok: false, error: "proposta não encontrada" };
  if (proposal.status !== "pending_review") {
    return { ok: false, error: `proposta já está em status ${proposal.status}` };
  }
  await storage.updateAiAnalystProposal(proposalId, {
    status: "rejected",
    reviewedByUserId: reviewerUserId ?? null,
    reviewedAt: new Date(),
    reviewerNote: reviewerNote ?? null,
  } as any);
  await storage.updateAiAnalystTask(proposal.taskId, { status: "rejected" });

  // Trilha de auditoria da decisão humana
  try {
    const link = await storage.getLink(proposal.linkId);
    await logAuditEvent({
      clientId: link?.clientId ?? null,
      actor: reviewerUserId ? { userId: reviewerUserId } : { type: "system" },
      action: "config_change",
      entity: "ai_analyst_proposal",
      entityId: String(proposalId),
      metadata: {
        source: "ai_analyst",
        event: "proposal_rejected",
        linkId: proposal.linkId,
        taskId: proposal.taskId,
        classification: proposal.classification,
        confidence: proposal.confidence,
        proposedFields: proposal.proposedFields,
        reviewerNote: reviewerNote ?? null,
      },
    });
  } catch (err: any) {
    console.error("[ai-analyst] failed to log reject audit:", err.message);
  }

  return { ok: true };
}

// =====================================================================
// Helpers para gatilhos automáticos (offline/degradados)
// =====================================================================

export async function enqueueOfflineLinks(enqueuedByUserId?: number): Promise<{ enqueued: number; skipped: number }> {
  const offlineLinks = await db
    .select({ id: links.id })
    .from(links)
    .where(and(eq(links.status, "offline"), eq(links.monitoringEnabled, true), sql`${links.deletedAt} IS NULL`));
  return enqueueLinksBulk(offlineLinks.map((l) => l.id), "offline_link", enqueuedByUserId);
}

export async function enqueueDegradedLinks(enqueuedByUserId?: number): Promise<{ enqueued: number; skipped: number }> {
  const degradedLinks = await db
    .select({ id: links.id })
    .from(links)
    .where(and(eq(links.status, "degraded"), eq(links.monitoringEnabled, true), sql`${links.deletedAt} IS NULL`));
  return enqueueLinksBulk(degradedLinks.map((l) => l.id), "degraded_link", enqueuedByUserId);
}

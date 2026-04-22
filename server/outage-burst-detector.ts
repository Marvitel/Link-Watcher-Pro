/**
 * Detector de surto de quedas ("burst counter").
 *
 * Conta quantos links *novos* ficaram offline na janela deslizante de 5 min.
 * Quando passa do threshold, dispara um diagnóstico de massiva (em background).
 *
 * Roda em paralelo com o detector clássico (CTO/CEO/PON/OLT) — o burst pega
 * massivas grandes/cross-topology que o clássico ignora (ex: rompimento de
 * backbone metropolitano que afeta clientes em CTOs, CEOs e PONs diferentes).
 */
import { sql } from "drizzle-orm";
import { db } from "./db";

const WINDOW_MINUTES = 5;
const POLL_INTERVAL_MS = 60_000;
const RE_INVESTIGATE_INTERVAL_MS = 5 * 60_000;

const THRESHOLD_WARN = 5;
const THRESHOLD_BURST = 10;
const THRESHOLD_CATASTROPHIC = 30;

type BurstState = "normal" | "warning" | "burst" | "catastrophic";

interface CauseBreakdownEntry {
  reason: string;
  label: string;
  count: number;
  pct: number;
}

interface BurstSnapshot {
  state: BurstState;
  newOfflineCount: number;
  windowMinutes: number;
  thresholds: { warn: number; burst: number; catastrophic: number };
  lastTriggeredAt: string | null;
  lastInvestigationAt: string | null;
  /** Sparkline: contagem por minuto nos últimos 60 minutos. */
  sparkline: { minute: string; count: number }[];
  /** Resumo da última investigação disparada. */
  lastInvestigation: BurstInvestigation | null;
  /** Total de links offline agora (não só novos na janela). */
  totalOffline: number;
  /** Causa dominante das indisponibilidades atuais (links offline agora). */
  causeBreakdown: CauseBreakdownEntry[];
}

const REASON_LABELS: Record<string, string> = {
  // Diagnósticos OLT
  rompimento_fibra: "Rompimento de fibra",
  queda_energia: "Queda de energia",
  sinal_degradado: "Sinal degradado",
  onu_inativa: "ONU inativa",
  olt_alarm: "Alarme OLT",
  gpon_no_optical_signal: "Sem sinal óptico (GPON)",
  optical_no_signal: "Sem sinal óptico",
  optical_low_signal: "Sinal óptico baixo",
  optical_warning: "Sinal óptico em alerta",
  port_down: "Porta da OLT fora do ar",
  ping_failed_optical_ok: "Ping falhou (sinal óptico OK)",
  // Causas manuais / legadas
  falha_eletrica: "Falha elétrica",
  falha_equipamento: "Falha de equipamento",
  indefinido: "Causa indefinida",
  // Diagnósticos de rede / ping
  timeout: "Timeout de ping",
  host_unreachable: "Host inacessível",
  network_unreachable: "Rede inacessível",
  connection_refused: "Conexão recusada",
  packet_loss: "Perda de pacotes",
  no_response: "Sem resposta ao ping",
  dns_failure: "Falha de DNS",
  snmp_unreachable: "SNMP inacessível",
  high_latency: "Latência alta",
  unknown: "Sem diagnóstico",
  sem_diagnostico: "Sem diagnóstico",
};

function reasonLabel(r: string | null | undefined): string {
  if (!r) return "Sem diagnóstico";
  return REASON_LABELS[r] || r;
}

async function buildCauseBreakdown(): Promise<{ total: number; entries: CauseBreakdownEntry[] }> {
  const result = await db.execute(sql`
    SELECT COALESCE(failure_reason, 'sem_diagnostico') AS reason, COUNT(*)::int AS c
    FROM links
    WHERE status = 'offline'
      AND monitoring_enabled = true
      AND (contract_status IS NULL OR contract_status IN ('active','blocked'))
    GROUP BY 1
    ORDER BY 2 DESC
  `);
  const rows: any[] = (result as any).rows || (result as any) || [];
  const total = rows.reduce((s, r) => s + Number(r.c || 0), 0);
  const entries = rows.map((r) => {
    const reason = String(r.reason);
    const count = Number(r.c) || 0;
    return {
      reason,
      label: reason === "sem_diagnostico" ? "Sem diagnóstico" : reasonLabel(reason),
      count,
      pct: total > 0 ? Math.round((count / total) * 100) : 0,
    };
  });
  return { total, entries };
}

interface BurstInvestigation {
  triggeredAt: string;
  newOfflineInWindow: number;
  /** OLTs com maior concentração de quedas. */
  topOlts: { olt: string; count: number }[];
  /** PONs com maior concentração de quedas (olt|slot|port). */
  topPons: { pon: string; count: number }[];
  /** CEOs OZmap com maior concentração de quedas. */
  topCeos: { ceo: string; count: number }[];
  /** Splitters/CTOs OZmap com maior concentração de quedas. */
  topSplitters: { splitter: string; count: number }[];
  /** Quantos dos afetados não têm topologia OZmap sincronizada. */
  withoutOzmapTopology: number;
  totalAffectedSampled: number;
}

let lastTriggeredAt: Date | null = null;
let lastInvestigationAt: Date | null = null;
let lastInvestigation: BurstInvestigation | null = null;
let lastSnapshot: BurstSnapshot | null = null;
let pollerStarted = false;

function classifyState(count: number): BurstState {
  if (count >= THRESHOLD_CATASTROPHIC) return "catastrophic";
  if (count >= THRESHOLD_BURST) return "burst";
  if (count >= THRESHOLD_WARN) return "warning";
  return "normal";
}

/**
 * Conta novas transições online → offline na janela. Usa a tabela `events`
 * filtrando por título ILIKE '%offline%' (mesmo padrão das outras correlações).
 * Garante 1 evento por linkId (caso o mesmo link gere múltiplos eventos na janela).
 */
async function countNewOfflinesInWindow(windowMinutes: number): Promise<number> {
  const since = new Date(Date.now() - windowMinutes * 60_000);
  const result = await db.execute(sql`
    SELECT COUNT(DISTINCT link_id)::int AS c
    FROM events
    WHERE timestamp >= ${since}
      AND type IN ('critical', 'warning')
      AND (title ILIKE '%offline%' OR title ILIKE '%down%' OR description ILIKE '%offline%')
  `);
  const rows: any[] = (result as any).rows || (result as any) || [];
  return Number(rows[0]?.c || 0);
}

/** Sparkline: novos offline por minuto nos últimos 60 minutos. */
async function buildSparkline(): Promise<{ minute: string; count: number }[]> {
  const result = await db.execute(sql`
    WITH minutes AS (
      SELECT generate_series(
        date_trunc('minute', now()) - interval '59 minutes',
        date_trunc('minute', now()),
        interval '1 minute'
      ) AS m
    ),
    offlines AS (
      SELECT date_trunc('minute', timestamp) AS m, COUNT(DISTINCT link_id)::int AS c
      FROM events
      WHERE timestamp >= now() - interval '60 minutes'
        AND type IN ('critical', 'warning')
        AND (title ILIKE '%offline%' OR title ILIKE '%down%' OR description ILIKE '%offline%')
      GROUP BY 1
    )
    SELECT m AS minute, COALESCE(o.c, 0)::int AS count
    FROM minutes
    LEFT JOIN offlines o USING (m)
    ORDER BY m
  `);
  const rows: any[] = (result as any).rows || (result as any) || [];
  return rows.map((r) => ({
    minute: (r.minute instanceof Date ? r.minute : new Date(r.minute)).toISOString(),
    count: Number(r.count) || 0,
  }));
}

/**
 * Investigação refinada disparada quando o burst cruza o threshold.
 * Agrupa os links que caíram na janela por topologia direta (sem depender de
 * jsonb_array_elements pra ser instantâneo) e identifica concentrações.
 */
async function runBurstInvestigation(windowMinutes: number, count: number): Promise<BurstInvestigation> {
  const since = new Date(Date.now() - windowMinutes * 60_000);
  const result = await db.execute(sql`
    WITH offline_in_window AS (
      SELECT DISTINCT ON (e.link_id) e.link_id
      FROM events e
      WHERE e.timestamp >= ${since}
        AND e.type IN ('critical', 'warning')
        AND (e.title ILIKE '%offline%' OR e.title ILIKE '%down%' OR e.description ILIKE '%offline%')
    )
    SELECT l.id,
           l.ozmap_ceo_name,
           l.ozmap_splitter_name,
           l.ozmap_olt_name,
           l.olt_id, l.slot_olt, l.port_olt
    FROM offline_in_window o
    JOIN links l ON l.id = o.link_id
    WHERE l.monitoring_enabled = true
      AND (l.contract_status IS NULL OR l.contract_status IN ('active','blocked'))
    LIMIT 5000
  `);
  const rows: any[] = (result as any).rows || (result as any) || [];

  const byCeo = new Map<string, number>();
  const bySplitter = new Map<string, number>();
  const byOlt = new Map<string, number>();
  const byPon = new Map<string, number>();
  let withoutTopo = 0;

  for (const r of rows) {
    const ceo: string | null = r.ozmap_ceo_name;
    const sp: string | null = r.ozmap_splitter_name;
    const olt: string | null = r.ozmap_olt_name;
    if (ceo) byCeo.set(ceo, (byCeo.get(ceo) || 0) + 1);
    if (sp) bySplitter.set(sp, (bySplitter.get(sp) || 0) + 1);
    if (olt) {
      byOlt.set(olt, (byOlt.get(olt) || 0) + 1);
      if (r.slot_olt != null && r.port_olt != null) {
        const k = `${olt}|${r.slot_olt}|${r.port_olt}`;
        byPon.set(k, (byPon.get(k) || 0) + 1);
      }
    }
    if (!ceo && !sp && !olt) withoutTopo++;
  }

  const top = (m: Map<string, number>, key: "olt" | "pon" | "ceo" | "splitter") =>
    Array.from(m.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([k, c]) => ({ [key]: k, count: c }) as any);

  const investigation: BurstInvestigation = {
    triggeredAt: new Date().toISOString(),
    newOfflineInWindow: count,
    topOlts: top(byOlt, "olt"),
    topPons: top(byPon, "pon"),
    topCeos: top(byCeo, "ceo"),
    topSplitters: top(bySplitter, "splitter"),
    withoutOzmapTopology: withoutTopo,
    totalAffectedSampled: rows.length,
  };

  console.log(
    `[BurstDetector] Investigação disparada: ${count} novos offline em ${windowMinutes}min. ` +
      `Top OLT: ${investigation.topOlts[0]?.olt || "n/a"} (${investigation.topOlts[0]?.count || 0}). ` +
      `Sem topologia OZmap: ${withoutTopo}/${rows.length}.`
  );

  return investigation;
}

async function tick(): Promise<void> {
  try {
    const [count, sparkline, causes] = await Promise.all([
      countNewOfflinesInWindow(WINDOW_MINUTES),
      buildSparkline(),
      buildCauseBreakdown(),
    ]);
    const state = classifyState(count);

    // Decide se dispara investigação:
    // - se está em burst/catastrophic E (não disparou ainda OU já passou o intervalo)
    if (state === "burst" || state === "catastrophic") {
      const now = Date.now();
      const shouldInvestigate =
        lastInvestigationAt === null ||
        now - lastInvestigationAt.getTime() >= RE_INVESTIGATE_INTERVAL_MS;
      if (shouldInvestigate) {
        if (lastTriggeredAt === null) lastTriggeredAt = new Date();
        lastInvestigationAt = new Date();
        // Roda investigação em background — não bloqueia o tick
        runBurstInvestigation(WINDOW_MINUTES, count)
          .then((inv) => {
            lastInvestigation = inv;
          })
          .catch((e) => console.error("[BurstDetector] investigação falhou:", e));
      }
    } else if (state === "normal") {
      // Reset do "último gatilho" quando volta ao normal — assim a próxima passagem
      // de threshold conta como novo burst (não silencia)
      lastTriggeredAt = null;
    }

    lastSnapshot = {
      state,
      newOfflineCount: count,
      windowMinutes: WINDOW_MINUTES,
      thresholds: {
        warn: THRESHOLD_WARN,
        burst: THRESHOLD_BURST,
        catastrophic: THRESHOLD_CATASTROPHIC,
      },
      lastTriggeredAt: lastTriggeredAt?.toISOString() ?? null,
      lastInvestigationAt: lastInvestigationAt?.toISOString() ?? null,
      sparkline,
      lastInvestigation,
      totalOffline: causes.total,
      causeBreakdown: causes.entries,
    };
  } catch (e) {
    console.error("[BurstDetector] tick falhou:", e);
  }
}

/**
 * Lista detalhada dos links que ficaram offline na janela do burst counter.
 * Usado pelo painel "ver quem caiu" no card do contador.
 */
export interface BurstLinkEntry {
  linkId: number;
  linkName: string;
  clientId: number;
  clientName: string | null;
  failureReason: string | null;
  failureReasonLabel: string;
  oltName: string | null;
  ceoName: string | null;
  splitterName: string | null;
  status: string;
  firstOfflineAt: string;
  lastFailureAt: string | null;
}

export async function getBurstLinks(windowMinutes: number = WINDOW_MINUTES): Promise<BurstLinkEntry[]> {
  const since = new Date(Date.now() - windowMinutes * 60_000);
  const result = await db.execute(sql`
    WITH offline_in_window AS (
      SELECT DISTINCT ON (e.link_id) e.link_id, MIN(e.timestamp) OVER (PARTITION BY e.link_id) AS first_at
      FROM events e
      WHERE e.timestamp >= ${since}
        AND e.type IN ('critical', 'warning')
        AND (e.title ILIKE '%offline%' OR e.title ILIKE '%down%' OR e.description ILIKE '%offline%')
    )
    SELECT l.id AS link_id,
           l.name AS link_name,
           l.client_id,
           c.name AS client_name,
           l.failure_reason,
           l.status,
           l.last_failure_at,
           l.ozmap_olt_name,
           l.ozmap_ceo_name,
           l.ozmap_splitter_name,
           o.first_at
    FROM offline_in_window o
    JOIN links l ON l.id = o.link_id
    LEFT JOIN clients c ON c.id = l.client_id
    WHERE l.monitoring_enabled = true
      AND (l.contract_status IS NULL OR l.contract_status IN ('active','blocked'))
    ORDER BY o.first_at DESC
    LIMIT 500
  `);
  const rows: any[] = (result as any).rows || (result as any) || [];
  return rows.map((r) => {
    const reason: string | null = r.failure_reason;
    return {
      linkId: Number(r.link_id),
      linkName: String(r.link_name ?? ""),
      clientId: Number(r.client_id),
      clientName: r.client_name ?? null,
      failureReason: reason,
      failureReasonLabel: reasonLabel(reason),
      oltName: r.ozmap_olt_name ?? null,
      ceoName: r.ozmap_ceo_name ?? null,
      splitterName: r.ozmap_splitter_name ?? null,
      status: String(r.status ?? "unknown"),
      firstOfflineAt: (r.first_at instanceof Date ? r.first_at : new Date(r.first_at)).toISOString(),
      lastFailureAt: r.last_failure_at ? (r.last_failure_at instanceof Date ? r.last_failure_at : new Date(r.last_failure_at)).toISOString() : null,
    };
  });
}

/** Snapshot atual (em memória) para o endpoint do dashboard. */
export async function getBurstSnapshot(): Promise<BurstSnapshot> {
  if (lastSnapshot) return lastSnapshot;
  // Primeira chamada antes do primeiro tick: calcula on-demand
  await tick();
  return (
    lastSnapshot || {
      state: "normal",
      newOfflineCount: 0,
      windowMinutes: WINDOW_MINUTES,
      thresholds: {
        warn: THRESHOLD_WARN,
        burst: THRESHOLD_BURST,
        catastrophic: THRESHOLD_CATASTROPHIC,
      },
      lastTriggeredAt: null,
      lastInvestigationAt: null,
      sparkline: [],
      lastInvestigation: null,
    }
  );
}

export function startOutageBurstDetector(): void {
  if (pollerStarted) return;
  pollerStarted = true;
  // Primeira execução em 30s (o monitor já estabilizou)
  setTimeout(() => {
    tick().catch((e) => console.error("[BurstDetector] erro:", e));
  }, 30_000);
  setInterval(() => {
    tick().catch((e) => console.error("[BurstDetector] erro:", e));
  }, POLL_INTERVAL_MS);
  console.log(
    `[BurstDetector] Ativo (janela ${WINDOW_MINUTES}min, thresholds ${THRESHOLD_WARN}/${THRESHOLD_BURST}/${THRESHOLD_CATASTROPHIC})`
  );
}

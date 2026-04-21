// =====================================================================
// Sincronização de topologia OZmap por link (CTO/CEO + lat/lng)
// Alimenta o detector de rompimentos massivos.
// =====================================================================

import { db } from "./db";
import { eq, isNotNull, and, sql } from "drizzle-orm";
import { externalIntegrations, links } from "@shared/schema";

interface OzmapConfig {
  baseUrl: string;
  apiKey: string;
}

async function getOzmapConfig(): Promise<OzmapConfig | null> {
  const rows = await db
    .select()
    .from(externalIntegrations)
    .where(eq(externalIntegrations.provider, "ozmap"))
    .limit(1);
  if (rows.length === 0) return null;
  const cfg = rows[0];
  if (!cfg.apiKey || !cfg.apiUrl || !cfg.isActive) return null;
  let baseUrl = cfg.apiUrl.replace(/\/+$/, "");
  if (baseUrl.endsWith("/api/v2")) baseUrl = baseUrl.slice(0, -7);
  return { baseUrl, apiKey: cfg.apiKey };
}

function readCoords(obj: any): { lat: number | null; lng: number | null } {
  if (!obj || typeof obj !== "object") return { lat: null, lng: null };
  // Tenta múltiplos formatos comuns no OZmap
  const lat =
    obj.lat ?? obj.latitude ?? obj.coordinates?.[1] ?? obj.coords?.lat ?? null;
  const lng =
    obj.lng ?? obj.lon ?? obj.longitude ?? obj.coordinates?.[0] ?? obj.coords?.lng ?? null;
  const latNum = typeof lat === "number" ? lat : lat ? parseFloat(lat) : null;
  const lngNum = typeof lng === "number" ? lng : lng ? parseFloat(lng) : null;
  if (latNum === null || lngNum === null || isNaN(latNum) || isNaN(lngNum)) {
    return { lat: null, lng: null };
  }
  return { lat: latNum, lng: lngNum };
}

function looksLikeCeo(elem: any): boolean {
  const kind = String(elem?.element?.kind || "").toLowerCase();
  const subtype = String(elem?.element?.subtype || elem?.element?.type || "").toLowerCase();
  const parentName = String(elem?.parent?.name || elem?.element?.name || "").toLowerCase();
  if (kind === "ceo" || subtype === "ceo") return true;
  if (kind === "junctionbox" || kind === "junction_box") return true;
  if (parentName.includes("ceo") || parentName.includes("emenda")) return true;
  return false;
}

function looksLikeCto(elem: any): boolean {
  const kind = String(elem?.element?.kind || "").toLowerCase();
  return kind === "splitter";
}

/**
 * Elemento de rota de fibra extraído do OZmap (potency).
 * Representa cada nó do caminho da OLT até o splitter do cliente.
 */
export interface RouteElement {
  kind: string;             // 'olt' | 'dio' | 'cable' | 'box' | 'ceo' | 'splitter' | etc.
  name: string;             // Nome do elemento (ex.: "OLT DATACOM HSP 8PON", "CEO MVT 175")
  parentName?: string | null;
  distanceM?: number | null;       // Distância acumulada da OLT até este nó (metros)
  segmentM?: number | null;        // Comprimento do segmento (cabos)
  attenuationDb?: number | null;   // Atenuação acumulada/segmento (dB)
  lat?: number | null;
  lng?: number | null;
  slot?: number | null;            // Slot da OLT (no elemento OLT)
  port?: number | null;            // Porta da OLT
  bandeja?: string | null;         // Bandeja/cordão do DIO
  fiberLabel?: string | null;      // L1-F6 etc. (rótulo de fibra)
}

interface ParsedTopology {
  ctoName: string | null;
  ctoLat: number | null;
  ctoLng: number | null;
  ceoName: string | null;
  ceoLat: number | null;
  ceoLng: number | null;
  route: RouteElement[];
}

/** Normaliza o tipo (kind) do elemento OZmap pra um conjunto canônico. */
function normalizeKind(rawKind: string, elem: any): string {
  const k = String(rawKind || "").toLowerCase();
  if (!k) return "unknown";
  if (k === "olt") return "olt";
  if (k === "dio") return "dio";
  if (k === "cable" || k === "cabo" || k === "fiber" || k === "fibercable") return "cable";
  if (k === "splitter") return "splitter";
  if (k === "ceo" || k === "junctionbox" || k === "junction_box") return "ceo";
  if (k === "cto") return "cto";
  if (k === "box" || k === "caixa") {
    // Box pode ser CEO (caixa de emenda) ou CTO — usa heurística pelo nome
    const name = String(elem?.element?.name || elem?.parent?.name || "").toLowerCase();
    if (name.includes("ceo") || name.includes("emenda")) return "ceo";
    return "box";
  }
  return k;
}

/** Lê um número (em metros) de campos comuns do OZmap (distance pode vir como m, km, ou objeto). */
function readMeters(val: any): number | null {
  if (val == null) return null;
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const n = parseFloat(val);
    return isNaN(n) ? null : n;
  }
  if (typeof val === "object") {
    if (val.meters != null) return readMeters(val.meters);
    if (val.value != null) return readMeters(val.value);
    if (val.m != null) return readMeters(val.m);
  }
  return null;
}

function readNum(val: any): number | null {
  if (val == null) return null;
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const n = parseFloat(val);
    return isNaN(n) ? null : n;
  }
  if (typeof val === "object") {
    if (val.number != null) return readNum(val.number);
    if (val.value != null) return readNum(val.value);
  }
  return null;
}

/** Extrai um RouteElement a partir de um item de `elements` do OZmap potency. */
function toRouteElement(elem: any): RouteElement | null {
  const rawKind = elem?.element?.kind || elem?.kind || "";
  const kind = normalizeKind(rawKind, elem);
  const name = String(elem?.element?.name || elem?.parent?.name || "").trim();
  if (!name && kind === "unknown") return null;
  const coords = readCoords(elem?.parent).lat !== null ? readCoords(elem?.parent) : readCoords(elem?.element);
  // Distância do OZmap geralmente vem em metros já no campo `distance`
  const distanceM = readMeters(elem?.distance ?? elem?.distance_m);
  const segmentM = kind === "cable" ? readMeters(elem?.length ?? elem?.length_m ?? elem?.element?.length) : null;
  const attenuationDb = readNum(elem?.attenuation ?? elem?.element?.attenuation);
  // Slot/porta só em OLT
  const slot = kind === "olt" ? readNum(elem?.slot ?? elem?.element?.slot) : null;
  const port = kind === "olt" ? readNum(elem?.port ?? elem?.element?.port) : null;
  // Bandeja/cordão pra DIO (string ex.: "Bandeja 1 / Porta 6")
  let bandeja: string | null = null;
  if (kind === "dio") {
    const tray = elem?.tray ?? elem?.element?.tray;
    const trayPort = elem?.tray_port ?? elem?.element?.tray_port;
    if (tray != null || trayPort != null) {
      bandeja = `Bandeja ${tray ?? "?"} / Porta ${trayPort ?? "?"}`;
    }
  }
  // Rótulo de fibra (L1-F6, etc.) — costuma vir em `fiber` ou `tube_fiber`
  const fiberLabel = elem?.fiber_label || elem?.fiber || elem?.tube_fiber || null;
  return {
    kind,
    name,
    parentName: elem?.parent?.name || null,
    distanceM,
    segmentM,
    attenuationDb,
    lat: coords.lat,
    lng: coords.lng,
    slot,
    port,
    bandeja,
    fiberLabel: fiberLabel ? String(fiberLabel) : null,
  };
}

function parseTopologyFromPotency(potencyData: any[]): ParsedTopology {
  const result: ParsedTopology = {
    ctoName: null, ctoLat: null, ctoLng: null,
    ceoName: null, ceoLat: null, ceoLng: null,
    route: [],
  };
  if (!Array.isArray(potencyData) || potencyData.length === 0) return result;
  const item = potencyData[0];
  if (!item.elements || !Array.isArray(item.elements)) return result;

  for (const elem of item.elements) {
    const re = toRouteElement(elem);
    if (re) result.route.push(re);
    if (looksLikeCto(elem) && !result.ctoName) {
      result.ctoName = elem.parent?.name || elem.element?.name || null;
      const coords =
        readCoords(elem.parent).lat !== null
          ? readCoords(elem.parent)
          : readCoords(elem.element);
      result.ctoLat = coords.lat;
      result.ctoLng = coords.lng;
    } else if (looksLikeCeo(elem) && !result.ceoName) {
      result.ceoName = elem.parent?.name || elem.element?.name || null;
      const coords =
        readCoords(elem.parent).lat !== null
          ? readCoords(elem.parent)
          : readCoords(elem.element);
      result.ceoLat = coords.lat;
      result.ceoLng = coords.lng;
    }
  }
  return result;
}

/**
 * Sincroniza topologia OZmap (CTO/CEO + lat/lng) para um único link.
 * Usa a tag já cadastrada (`ozmap_tag`); não tenta fallback.
 */
export async function syncOzmapTopologyForLink(linkId: number): Promise<{
  success: boolean;
  reason?: string;
  topology?: ParsedTopology;
}> {
  const cfg = await getOzmapConfig();
  if (!cfg) return { success: false, reason: "ozmap_not_configured" };

  const linkRows = await db.select().from(links).where(eq(links.id, linkId)).limit(1);
  if (linkRows.length === 0) return { success: false, reason: "link_not_found" };
  const link = linkRows[0];
  if (!link.ozmapTag) return { success: false, reason: "no_ozmap_tag" };

  const url = `${cfg.baseUrl}/api/v2/properties/client/${encodeURIComponent(link.ozmapTag)}/potency?locale=pt_BR`;
  const headers = { Accept: "application/json", Authorization: cfg.apiKey };

  let data: any[] | null = null;
  try {
    const r = await fetch(url, { method: "GET", headers });
    if (!r.ok) {
      if (r.status === 422) {
        await db.update(links).set({ ozmapNoRoute: true }).where(eq(links.id, linkId));
        return { success: false, reason: "no_route" };
      }
      return { success: false, reason: `http_${r.status}` };
    }
    const text = await r.text();
    if (!text || text.trim() === "" || text.trim() === "null") {
      return { success: false, reason: "empty_response" };
    }
    const parsed = JSON.parse(text);
    data = Array.isArray(parsed) ? parsed : null;
  } catch (e: any) {
    return { success: false, reason: `fetch_error: ${e.message}` };
  }

  if (!data || data.length === 0) return { success: false, reason: "no_data" };

  const topology = parseTopologyFromPotency(data);

  await db.update(links).set({
    ozmapSplitterName: topology.ctoName ?? link.ozmapSplitterName,
    ozmapSplitterLat: topology.ctoLat,
    ozmapSplitterLng: topology.ctoLng,
    ozmapCeoName: topology.ceoName,
    ozmapCeoLat: topology.ceoLat,
    ozmapCeoLng: topology.ceoLng,
    ozmapRoute: topology.route.length > 0 ? topology.route : null,
    ozmapLastSync: new Date(),
  }).where(eq(links.id, linkId));

  return { success: true, topology };
}

/**
 * Sincroniza topologia OZmap pra todos os links com `ozmap_tag` preenchida.
 * Roda 1x/dia por padrão. Limita concorrência a 4 para não sobrecarregar a API.
 */
export async function syncOzmapTopologyForAllLinks(opts?: {
  /** Apenas links sem coordenadas de splitter (modo inicial leve). */
  onlyMissing?: boolean;
  /** Apenas links sem `ozmap_route` populado — pra retroativos depois que o campo foi
   *  adicionado. */
  onlyMissingRoute?: boolean;
  /** Restringe a uma OLT específica (match por nome cadastrado OU `ozmap_olt_name`). */
  oltName?: string;
  /** Restringe por status (ex.: 'online' pra validar rompimentos rapidamente). */
  status?: "online" | "offline";
  concurrency?: number;
}): Promise<{
  total: number;
  succeeded: number;
  failed: number;
  failureReasons: Record<string, number>;
}> {
  const concurrency = opts?.concurrency ?? 4;
  const onlyMissing = opts?.onlyMissing ?? false;
  const onlyMissingRoute = opts?.onlyMissingRoute ?? false;

  const conditions = [
    isNotNull(links.ozmapTag),
    sql`${links.deletedAt} IS NULL`,
    sql`${links.ozmapNoRoute} IS NOT TRUE`,
  ];
  if (onlyMissing) {
    conditions.push(sql`${links.ozmapSplitterLat} IS NULL`);
  }
  if (onlyMissingRoute) {
    conditions.push(sql`${links.ozmapRoute} IS NULL`);
  }
  if (opts?.oltName) {
    conditions.push(sql`(${links.ozmapOltName} = ${opts.oltName} OR EXISTS (
      SELECT 1 FROM olts o WHERE o.id = ${links.oltId} AND o.name = ${opts.oltName}
    ))`);
  }
  if (opts?.status) {
    conditions.push(eq(links.status, opts.status));
  }

  const targetLinks = await db
    .select({ id: links.id })
    .from(links)
    .where(and(...conditions));

  const stats = {
    total: targetLinks.length,
    succeeded: 0,
    failed: 0,
    failureReasons: {} as Record<string, number>,
  };

  console.log(`[OZmap Topology Sync] Iniciando sync para ${stats.total} links (concurrency=${concurrency})`);

  // Pool de workers simples
  let cursor = 0;
  async function worker() {
    while (cursor < targetLinks.length) {
      const idx = cursor++;
      const linkId = targetLinks[idx].id;
      try {
        const result = await syncOzmapTopologyForLink(linkId);
        if (result.success) {
          stats.succeeded++;
        } else {
          stats.failed++;
          const reason = result.reason || "unknown";
          stats.failureReasons[reason] = (stats.failureReasons[reason] || 0) + 1;
        }
      } catch (e: any) {
        stats.failed++;
        stats.failureReasons["exception"] = (stats.failureReasons["exception"] || 0) + 1;
        console.error(`[OZmap Topology Sync] Erro no link id=${linkId}:`, e.message);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  console.log(`[OZmap Topology Sync] Concluído: ${stats.succeeded} ok, ${stats.failed} falhas`);
  return stats;
}

/**
 * Inicia o scheduler diário (04:00) de sincronização da topologia OZmap.
 * Roda também 30s após boot para popular dados iniciais (modo onlyMissing=true).
 */
export function startOzmapTopologySyncScheduler(): void {
  // Sync inicial leve após 30s — só links sem coordenadas ainda
  setTimeout(() => {
    syncOzmapTopologyForAllLinks({ onlyMissing: true })
      .catch((e) => console.error("[OZmap Topology Sync] Erro no sync inicial:", e));
  }, 30_000);

  // Cron simples: verifica a cada 5min se está perto das 04:00
  let lastRunDay = -1;
  setInterval(() => {
    const now = new Date();
    if (now.getHours() === 4 && now.getDate() !== lastRunDay) {
      lastRunDay = now.getDate();
      console.log("[OZmap Topology Sync] Disparando sync diário programado (04:00)");
      syncOzmapTopologyForAllLinks()
        .catch((e) => console.error("[OZmap Topology Sync] Erro no sync diário:", e));
    }
  }, 5 * 60 * 1000);

  console.log("[OZmap Topology Sync] Scheduler diário ativo (04:00)");
}

// =====================================================================
// Detector de rompimentos massivos
// Agrupa links offline por ancestral OZmap (CTO > CEO > PON > OLT) e
// mantém a tabela `massive_outages` viva. Roda a cada 60s.
// =====================================================================

import { db } from "./db";
import { eq, and, sql, isNull, gte, lte, desc, inArray } from "drizzle-orm";
import { links, massiveOutages, massiveOutageLinks, metrics } from "@shared/schema";

const THRESHOLD = 2; // mínimo de links offline no mesmo escopo para considerar rompimento
const RUN_INTERVAL_MS = 60 * 1000;

type Scope = "cto" | "ceo" | "pon" | "olt";

interface ScopeInfo {
  scope: Scope;
  scopeKey: string;
  scopeLabel: string;
  lat: number | null;
  lng: number | null;
  mostLikelyLocation: string;
}

function ctoScope(link: typeof links.$inferSelect): ScopeInfo | null {
  if (!link.ozmapSplitterName) return null;
  return {
    scope: "cto",
    scopeKey: `cto|${link.ozmapSplitterName}`,
    scopeLabel: `CTO ${link.ozmapSplitterName}`,
    lat: link.ozmapSplitterLat,
    lng: link.ozmapSplitterLng,
    mostLikelyLocation: `CTO ${link.ozmapSplitterName}`,
  };
}

function ceoScope(link: typeof links.$inferSelect): ScopeInfo | null {
  if (!link.ozmapCeoName) return null;
  return {
    scope: "ceo",
    scopeKey: `ceo|${link.ozmapCeoName}`,
    scopeLabel: `CEO ${link.ozmapCeoName}`,
    lat: link.ozmapCeoLat,
    lng: link.ozmapCeoLng,
    mostLikelyLocation: `Caixa de Emenda ${link.ozmapCeoName}`,
  };
}

function ponScope(link: typeof links.$inferSelect): ScopeInfo | null {
  const oltName = link.ozmapOltName;
  if (!oltName || link.ozmapSlot == null || link.ozmapPort == null) return null;
  const key = `${oltName}|${link.ozmapSlot}|${link.ozmapPort}`;
  return {
    scope: "pon",
    scopeKey: `pon|${key}`,
    scopeLabel: `PON ${oltName} ${link.ozmapSlot}/${link.ozmapPort}`,
    lat: null,
    lng: null,
    mostLikelyLocation: `Backbone até a PON ${oltName} ${link.ozmapSlot}/${link.ozmapPort}`,
  };
}

function oltScope(link: typeof links.$inferSelect): ScopeInfo | null {
  const oltName = link.ozmapOltName;
  if (!oltName) return null;
  return {
    scope: "olt",
    scopeKey: `olt|${oltName}`,
    scopeLabel: `OLT ${oltName}`,
    lat: null,
    lng: null,
    mostLikelyLocation: `OLT ${oltName} ou backbone até ela`,
  };
}

/** Conta totais por escopo entre TODOS os links monitorados (denominador da confidence). */
async function countTotalsByScope(): Promise<{
  cto: Map<string, number>;
  ceo: Map<string, number>;
  pon: Map<string, number>;
  olt: Map<string, number>;
}> {
  const monitored = await db
    .select({
      ozmapSplitterName: links.ozmapSplitterName,
      ozmapCeoName: links.ozmapCeoName,
      ozmapOltName: links.ozmapOltName,
      ozmapSlot: links.ozmapSlot,
      ozmapPort: links.ozmapPort,
    })
    .from(links)
    .where(and(
      eq(links.monitoringEnabled, true),
      sql`${links.deletedAt} IS NULL`,
      sql`${links.contractStatus} IN ('active', 'blocked')`,
    ));

  const cto = new Map<string, number>();
  const ceo = new Map<string, number>();
  const pon = new Map<string, number>();
  const olt = new Map<string, number>();

  for (const l of monitored) {
    if (l.ozmapSplitterName) {
      const k = `cto|${l.ozmapSplitterName}`;
      cto.set(k, (cto.get(k) ?? 0) + 1);
    }
    if (l.ozmapCeoName) {
      const k = `ceo|${l.ozmapCeoName}`;
      ceo.set(k, (ceo.get(k) ?? 0) + 1);
    }
    if (l.ozmapOltName && l.ozmapSlot != null && l.ozmapPort != null) {
      const k = `pon|${l.ozmapOltName}|${l.ozmapSlot}|${l.ozmapPort}`;
      pon.set(k, (pon.get(k) ?? 0) + 1);
    }
    if (l.ozmapOltName) {
      const k = `olt|${l.ozmapOltName}`;
      olt.set(k, (olt.get(k) ?? 0) + 1);
    }
  }

  return { cto, ceo, pon, olt };
}

function centroid(coords: Array<{ lat: number; lng: number }>): { lat: number | null; lng: number | null } {
  if (coords.length === 0) return { lat: null, lng: null };
  const lat = coords.reduce((s, c) => s + c.lat, 0) / coords.length;
  const lng = coords.reduce((s, c) => s + c.lng, 0) / coords.length;
  return { lat, lng };
}

/** Pega último opticalRxPower antes de uma data, pra link específico. */
async function getOpticalSnapshot(linkId: number, before: Date): Promise<{ rx: number | null; tx: number | null }> {
  const rows = await db
    .select({
      rx: metrics.opticalRxPower,
      tx: metrics.opticalTxPower,
    })
    .from(metrics)
    .where(and(
      eq(metrics.linkId, linkId),
      lte(metrics.timestamp, before),
      sql`${metrics.opticalRxPower} IS NOT NULL`,
    ))
    .orderBy(desc(metrics.timestamp))
    .limit(1);
  if (rows.length === 0) return { rx: null, tx: null };
  return { rx: rows[0].rx ?? null, tx: rows[0].tx ?? null };
}

/**
 * Versão em lote: pega último opticalRx/Tx antes de `before` para múltiplos linkIds
 * em uma única query. Evita N+1 quando o detector cria/atualiza outage com muitos afetados.
 */
async function getOpticalSnapshotsBulk(
  linkIds: number[],
  before: Date,
): Promise<Map<number, { rx: number | null; tx: number | null }>> {
  const result = new Map<number, { rx: number | null; tx: number | null }>();
  if (linkIds.length === 0) return result;
  const rows = await db.execute(sql`
    SELECT DISTINCT ON (link_id) link_id, optical_rx_power, optical_tx_power
    FROM metrics
    WHERE link_id IN (${sql.join(linkIds.map((id) => sql`${id}`), sql`, `)})
      AND timestamp <= ${before}
      AND optical_rx_power IS NOT NULL
    ORDER BY link_id, timestamp DESC
  `);
  for (const row of (rows as any).rows ?? rows) {
    const linkId = Number(row.link_id);
    const rx = row.optical_rx_power == null ? null : Number(row.optical_rx_power);
    const tx = row.optical_tx_power == null ? null : Number(row.optical_tx_power);
    result.set(linkId, { rx, tx });
  }
  for (const id of linkIds) if (!result.has(id)) result.set(id, { rx: null, tx: null });
  return result;
}

/**
 * Roda uma passada do detector. Idempotente — pode chamar quantas vezes quiser.
 * Retorna estatísticas pra logging/debug.
 */
export async function detectMassiveOutages(): Promise<{
  offlineLinks: number;
  activeOutages: number;
  newOutages: number;
  resolvedOutages: number;
}> {
  // 1. Busca todos os links offline elegíveis
  const offline = await db
    .select()
    .from(links)
    .where(and(
      eq(links.status, "offline"),
      eq(links.monitoringEnabled, true),
      sql`${links.deletedAt} IS NULL`,
      sql`${links.contractStatus} IN ('active', 'blocked')`,
    ));

  // 2. Para cada link offline, computa TODAS as escalas disponíveis (cto/ceo/pon/olt).
  // Atribuição inicial: o mais específico (CTO > CEO > PON > OLT).
  type Level = "cto" | "ceo" | "pon" | "olt";
  const LEVEL_RANK: Record<Level, number> = { cto: 0, ceo: 1, pon: 2, olt: 3 };
  const allScopes = new Map<number, Partial<Record<Level, ScopeInfo>>>();
  const assignment = new Map<number, ScopeInfo>();

  for (const link of offline) {
    const scopes: Partial<Record<Level, ScopeInfo>> = {};
    const c = ctoScope(link); if (c) scopes.cto = c;
    const e = ceoScope(link); if (e) scopes.ceo = e;
    const p = ponScope(link); if (p) scopes.pon = p;
    const o = oltScope(link); if (o) scopes.olt = o;
    allScopes.set(link.id, scopes);
    const initial = scopes.cto || scopes.ceo || scopes.pon || scopes.olt;
    if (initial) assignment.set(link.id, initial);
  }

  // 3. Roll-up bottom-up por convergência: para cada escopo PARENT, conta quantos
  // sub-escopos DISTINTOS estão presentes nos links offline. Se ≥2 distintos
  // convergem nele, sobe todos pra esse parent (= ponto provável de rompimento).
  // Itera CEO → PON → OLT.
  const ROLLUP_ORDER: Array<{ parent: Level; childOf: Level[] }> = [
    { parent: "ceo", childOf: ["cto"] },
    { parent: "pon", childOf: ["cto", "ceo"] },
    { parent: "olt", childOf: ["cto", "ceo", "pon"] },
  ];

  for (const { parent, childOf } of ROLLUP_ORDER) {
    // Para cada parentKey, coleta linkIds que possuem esse parent E suas chaves de filho
    const parentBuckets = new Map<string, { linkIds: number[]; distinctChildKeys: Set<string>; info: ScopeInfo }>();
    for (const link of offline) {
      const scopes = allScopes.get(link.id);
      const parentScope = scopes?.[parent];
      if (!parentScope) continue;
      // Chave de filho mais específica disponível (a mais profunda dentre childOf)
      let childKey: string | null = null;
      for (const lvl of childOf) {
        if (scopes[lvl]) { childKey = `${lvl}|${scopes[lvl]!.scopeKey}`; break; }
      }
      // Se link já está atribuído a algo no nível do parent ou acima, ignora
      const cur = assignment.get(link.id);
      if (cur && LEVEL_RANK[cur.scope] >= LEVEL_RANK[parent]) continue;

      const b = parentBuckets.get(parentScope.scopeKey);
      if (b) {
        b.linkIds.push(link.id);
        if (childKey) b.distinctChildKeys.add(childKey);
      } else {
        parentBuckets.set(parentScope.scopeKey, {
          linkIds: [link.id],
          distinctChildKeys: new Set(childKey ? [childKey] : []),
          info: parentScope,
        });
      }
    }
    // Promove quem tem ≥2 sub-escopos distintos convergindo
    for (const bucket of Array.from(parentBuckets.values())) {
      if (bucket.distinctChildKeys.size >= 2) {
        for (const linkId of bucket.linkIds) {
          assignment.set(linkId, bucket.info);
        }
      }
    }
  }

  // 4. Constrói grupos finais a partir das atribuições
  const groups = new Map<string, { info: ScopeInfo; links: typeof offline }>();
  for (const link of offline) {
    const a = assignment.get(link.id);
    if (!a) continue;
    const fullKey = `${a.scope}|${a.scopeKey}`;
    const ex = groups.get(fullKey);
    if (ex) ex.links.push(link);
    else groups.set(fullKey, { info: a, links: [link] });
  }

  // 5. Filtra grupos que atingem o threshold
  const eligibleGroups = Array.from(groups.values()).filter((g) => g.links.length >= THRESHOLD);

  // 4. Carrega totais por escopo (pra calcular confidence)
  const totals = await countTotalsByScope();
  const totalForScope = (info: ScopeInfo, fallback: number): number => {
    // Fallback = nº de links offline observados (garante denominador ≥ esse valor → confidence ≤ 1)
    if (info.scope === "cto") return totals.cto.get(info.scopeKey) ?? fallback;
    if (info.scope === "ceo") return totals.ceo.get(info.scopeKey) ?? fallback;
    if (info.scope === "pon") return totals.pon.get(info.scopeKey) ?? fallback;
    return totals.olt.get(info.scopeKey) ?? fallback;
  };

  // 6. Carrega outages ativas atuais (ordenado por mais recente primeiro pra dedupe)
  const currentActive = await db
    .select()
    .from(massiveOutages)
    .where(eq(massiveOutages.status, "active"))
    .orderBy(desc(massiveOutages.startedAt));

  // Dedupe defensivo: se houver duplicatas pra mesma (scope, scopeKey), mantém a mais
  // recente e marca as demais como resolvidas (corrige inconsistências históricas).
  const activeByKey = new Map<string, typeof currentActive[0]>();
  const dupesToResolve: number[] = [];
  for (const a of currentActive) {
    const k = `${a.scope}|${a.scopeKey}`;
    if (activeByKey.has(k)) {
      dupesToResolve.push(a.id);
    } else {
      activeByKey.set(k, a);
    }
  }
  if (dupesToResolve.length > 0) {
    await db.update(massiveOutages).set({
      status: "resolved",
      resolvedAt: new Date(),
    }).where(inArray(massiveOutages.id, dupesToResolve));
    console.log(`[MassiveOutage] 🧹 Resolvido ${dupesToResolve.length} duplicata(s) ativa(s)`);
  }

  let newOutages = 0;
  let resolvedOutages = 0;
  const seenKeys = new Set<string>();

  // 6. Cria/atualiza outages
  for (const group of eligibleGroups) {
    const fullKey = `${group.info.scope}|${group.info.scopeKey}`;
    seenKeys.add(fullKey);
    const affectedIds = group.links.map((l) => l.id);
    const total = totalForScope(group.info, affectedIds.length);
    const confidence = total > 0 ? Math.min(1, group.links.length / total) : 0;

    // Calcula centroide das coords disponíveis nos afetados (cai pra coord do escopo se não tiver)
    const linkCoords = group.links
      .map((l) => ({ lat: l.ozmapSplitterLat, lng: l.ozmapSplitterLng }))
      .filter((c): c is { lat: number; lng: number } => c.lat != null && c.lng != null);
    const { lat: centerLat, lng: centerLng } = centroid(linkCoords);
    const finalLat = centerLat ?? group.info.lat;
    const finalLng = centerLng ?? group.info.lng;

    const existing = activeByKey.get(fullKey);
    if (existing) {
      // Atualiza
      const wasAffected = new Set(existing.affectedLinkIds || []);
      const nowAffected = new Set(affectedIds);

      await db.update(massiveOutages).set({
        affectedCount: affectedIds.length,
        totalLinksInScope: total,
        confidence,
        affectedLinkIds: affectedIds,
        latitude: finalLat,
        longitude: finalLng,
        lastSeenAt: new Date(),
        scopeLabel: group.info.scopeLabel,
        mostLikelyLocation: group.info.mostLikelyLocation,
      }).where(eq(massiveOutages.id, existing.id));

      // Marca novos entrantes (bulk fetch de sinal óptico → 1 query)
      const newcomers = affectedIds.filter((id) => !wasAffected.has(id));
      if (newcomers.length > 0) {
        const snaps = await getOpticalSnapshotsBulk(newcomers, existing.startedAt);
        const newRows = newcomers.map((linkId) => {
          const s = snaps.get(linkId) ?? { rx: null, tx: null };
          return {
            outageId: existing.id,
            linkId,
            opticalRxBefore: s.rx,
            opticalTxBefore: s.tx,
          };
        });
        await db.insert(massiveOutageLinks).values(newRows);
      }
      // Marca quem saiu
      const leavers = (existing.affectedLinkIds || []).filter((id) => !nowAffected.has(id));
      if (leavers.length > 0) {
        await db.update(massiveOutageLinks).set({ leftAt: new Date() })
          .where(and(
            eq(massiveOutageLinks.outageId, existing.id),
            inArray(massiveOutageLinks.linkId, leavers),
            isNull(massiveOutageLinks.leftAt),
          ));
      }
    } else {
      // Cria nova outage
      const startedAt = new Date();
      const inserted = await db.insert(massiveOutages).values({
        scope: group.info.scope,
        scopeKey: group.info.scopeKey,
        scopeLabel: group.info.scopeLabel,
        affectedCount: affectedIds.length,
        totalLinksInScope: total,
        confidence,
        mostLikelyLocation: group.info.mostLikelyLocation,
        latitude: finalLat,
        longitude: finalLng,
        status: "active",
        affectedLinkIds: affectedIds,
        resolvedAt: null,
      }).returning({ id: massiveOutages.id });

      const outageId = inserted[0].id;
      newOutages++;
      console.log(`[MassiveOutage] 🚨 NOVO rompimento detectado: ${group.info.scopeLabel} — ${affectedIds.length}/${total} links offline (confiança ${(confidence * 100).toFixed(0)}%)`);

      // Snapshot de sinal de cada afetado no momento da criação (bulk → 1 query)
      const snaps = await getOpticalSnapshotsBulk(affectedIds, startedAt);
      const rows = affectedIds.map((linkId) => {
        const s = snaps.get(linkId) ?? { rx: null, tx: null };
        return {
          outageId,
          linkId,
          opticalRxBefore: s.rx,
          opticalTxBefore: s.tx,
        };
      });
      if (rows.length > 0) await db.insert(massiveOutageLinks).values(rows);
    }
  }

  // 7. Resolve outages que sumiram (não apareceram nesta passada)
  for (const [key, outage] of Array.from(activeByKey.entries())) {
    if (!seenKeys.has(key)) {
      await db.update(massiveOutages).set({
        status: "resolved",
        resolvedAt: new Date(),
        affectedCount: 0,
      }).where(eq(massiveOutages.id, outage.id));
      // Marca todos como saídos
      await db.update(massiveOutageLinks).set({ leftAt: new Date() })
        .where(and(
          eq(massiveOutageLinks.outageId, outage.id),
          isNull(massiveOutageLinks.leftAt),
        ));
      resolvedOutages++;
      console.log(`[MassiveOutage] ✅ Rompimento resolvido: ${outage.scopeLabel}`);
    }
  }

  return {
    offlineLinks: offline.length,
    activeOutages: eligibleGroups.length,
    newOutages,
    resolvedOutages,
  };
}

/**
 * Busca dados detalhados de uma outage incluindo sinal antes/depois por afetado.
 * Usado pelo endpoint GET /api/massive-outages/:id.
 */
export async function getMassiveOutageDetail(outageId: number): Promise<{
  outage: typeof massiveOutages.$inferSelect;
  affectedLinks: Array<{
    linkId: number;
    name: string;
    clientId: number;
    status: string;
    opticalRxBefore: number | null;
    opticalTxBefore: number | null;
    opticalRxNow: number | null;
    opticalTxNow: number | null;
    deltaRx: number | null;
    joinedAt: Date;
    leftAt: Date | null;
  }>;
} | null> {
  const rows = await db.select().from(massiveOutages).where(eq(massiveOutages.id, outageId)).limit(1);
  if (rows.length === 0) return null;
  const outage = rows[0];

  const memberships = await db.select().from(massiveOutageLinks).where(eq(massiveOutageLinks.outageId, outageId));
  const linkIds = memberships.map((m) => m.linkId);
  if (linkIds.length === 0) {
    return { outage, affectedLinks: [] };
  }

  const linkRows = await db
    .select({ id: links.id, name: links.name, clientId: links.clientId, status: links.status })
    .from(links)
    .where(inArray(links.id, linkIds));
  const linkById = new Map(linkRows.map((l) => [l.id, l]));

  // OTIMIZAÇÃO: uma única consulta com DISTINCT ON em vez de N consultas sequenciais.
  // Pega a última leitura óptica não-nula por link em uma única ida ao banco.
  const latestSignalRows = await db.execute(sql`
    SELECT DISTINCT ON (link_id)
      link_id,
      optical_rx_power AS rx,
      optical_tx_power AS tx
    FROM ${metrics}
    WHERE link_id IN (${sql.join(linkIds.map((id) => sql`${id}`), sql`, `)})
      AND optical_rx_power IS NOT NULL
    ORDER BY link_id, timestamp DESC
  `);
  const latestByLink = new Map<number, { rx: number | null; tx: number | null }>();
  for (const row of latestSignalRows.rows as any[]) {
    latestByLink.set(Number(row.link_id), {
      rx: row.rx != null ? Number(row.rx) : null,
      tx: row.tx != null ? Number(row.tx) : null,
    });
  }

  const affectedLinks = memberships.map((m) => {
    const link = linkById.get(m.linkId);
    const latest = latestByLink.get(m.linkId);
    const rxNow = latest?.rx ?? null;
    const txNow = latest?.tx ?? null;
    const deltaRx = rxNow != null && m.opticalRxBefore != null ? rxNow - m.opticalRxBefore : null;
    return {
      linkId: m.linkId,
      name: link?.name ?? `Link #${m.linkId}`,
      clientId: link?.clientId ?? 0,
      status: link?.status ?? "unknown",
      opticalRxBefore: m.opticalRxBefore,
      opticalTxBefore: m.opticalTxBefore,
      opticalRxNow: rxNow,
      opticalTxNow: txNow,
      deltaRx,
      joinedAt: m.joinedAt,
      leftAt: m.leftAt,
    };
  });

  return { outage, affectedLinks };
}

/**
 * Sincroniza a rota OZmap dos links relevantes para um outage específico:
 * todos os afetados + até `peerLimit` vizinhos da mesma PON/OLT (quando aplicável).
 * Usado pelo botão "Sincronizar rotas agora" no diagrama.
 */
export async function syncRoutesForOutage(outageId: number, peerLimit = 30): Promise<{
  affectedSynced: number;
  peersSynced: number;
  failed: number;
  failureReasons: Record<string, number>;
  totalAttempted: number;
}> {
  const { syncOzmapTopologyForLink } = await import("./ozmap-topology");
  const outageRows = await db.select().from(massiveOutages).where(eq(massiveOutages.id, outageId)).limit(1);
  if (outageRows.length === 0) {
    return { affectedSynced: 0, peersSynced: 0, failed: 0, failureReasons: {}, totalAttempted: 0 };
  }
  const outage = outageRows[0];

  // 1. Coleta IDs dos afetados
  const memberships = await db
    .select({ linkId: massiveOutageLinks.linkId })
    .from(massiveOutageLinks)
    .where(eq(massiveOutageLinks.outageId, outageId));
  const affectedIds = new Set(memberships.map((m) => m.linkId));

  // 2. Coleta IDs de vizinhos quando o escopo é PON ou OLT.
  //    NÃO exige ozmapTag preenchido — vamos tentar resolver a tag no passo 3.
  const peerIds = new Set<number>();
  if (outage.scope === "pon" || outage.scope === "olt") {
    const parts = outage.scopeKey.split("|");
    const oltName = parts[1];
    const slot = parts[2] != null ? parseInt(parts[2], 10) : null;
    const port = parts[3] != null ? parseInt(parts[3], 10) : null;
    if (oltName) {
      const conds = [
        eq(links.ozmapOltName, oltName),
        sql`${links.deletedAt} IS NULL`,
      ];
      if (outage.scope === "pon" && slot != null && port != null && !isNaN(slot) && !isNaN(port)) {
        conds.push(eq(links.ozmapSlot, slot), eq(links.ozmapPort, port));
      }
      const peerRows = await db
        .select({ id: links.id })
        .from(links)
        .where(and(...conds))
        .limit(peerLimit);
      for (const r of peerRows) {
        if (!affectedIds.has(r.id)) peerIds.add(r.id);
      }
    }
  }

  // 3. Resolve ozmap_tag a partir de voalle_contract_tag_service_tag pra links que estão sem tag.
  //    A tag Voalle (varchar alfanumérico) na Marvitel é o mesmo código usado no OZmap como service tag.
  const allIds = [...Array.from(affectedIds), ...Array.from(peerIds)];
  let tagsResolved = 0;
  if (allIds.length > 0) {
    const linkRows = await db
      .select({
        id: links.id,
        ozmapTag: links.ozmapTag,
        voalleTag: links.voalleContractTagServiceTag,
      })
      .from(links)
      .where(inArray(links.id, allIds));
    const toUpdate = linkRows.filter(
      (l) => (!l.ozmapTag || l.ozmapTag.trim() === "") && l.voalleTag && l.voalleTag.trim() !== "",
    );
    for (const l of toUpdate) {
      try {
        await db
          .update(links)
          .set({ ozmapTag: l.voalleTag!.trim() })
          .where(eq(links.id, l.id));
        tagsResolved++;
      } catch (e) {
        // ignora — vai cair como falha na próxima fase
      }
    }
    if (tagsResolved > 0) {
      console.log(`[MassiveOutage] sync-routes outage=${outageId} tags resolvidas via Voalle: ${tagsResolved}`);
    }
  }

  // 4. Sincroniza topologia OZmap com concorrência limitada (4 paralelos)
  let cursor = 0;
  let affectedSynced = 0;
  let peersSynced = 0;
  let failed = 0;
  const failureReasons: Record<string, number> = {};
  async function worker() {
    while (cursor < allIds.length) {
      const idx = cursor++;
      const linkId = allIds[idx];
      try {
        const r = await syncOzmapTopologyForLink(linkId);
        if (r.success) {
          if (affectedIds.has(linkId)) affectedSynced++;
          else peersSynced++;
        } else {
          failed++;
          const key = r.reason || "unknown";
          failureReasons[key] = (failureReasons[key] || 0) + 1;
        }
      } catch (e: any) {
        failed++;
        const key = `exception: ${e?.message || "unknown"}`;
        failureReasons[key] = (failureReasons[key] || 0) + 1;
      }
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
  if (failed > 0) {
    console.log(
      `[MassiveOutage] sync-routes outage=${outageId} ok=${affectedSynced + peersSynced} failed=${failed} reasons=${JSON.stringify(failureReasons)}`,
    );
  }
  return { affectedSynced, peersSynced, failed, failureReasons, totalAttempted: allIds.length };
}

// =====================================================================
// Diagrama de rota: caminho comum entre os links afetados (OLT → ponto de convergência)
// =====================================================================

interface RouteElementShape {
  kind: string;
  name: string;
  parentName?: string | null;
  distanceM?: number | null;
  segmentM?: number | null;
  attenuationDb?: number | null;
  lat?: number | null;
  lng?: number | null;
  slot?: number | null;
  port?: number | null;
  bandeja?: string | null;
  fiberLabel?: string | null;
}

interface RouteDiagramNode extends RouteElementShape {
  /** Quantos links afetados ainda passam por este nó (= ainda não divergiram). */
  affectedAtThisPoint: number;
  /** Quantidade de links que divergem (saem do caminho comum) DEPOIS deste nó. */
  divergesAfterCount: number;
  /** Marca o último elemento do caminho comum (= ponto provável de rompimento). */
  isConvergencePoint: boolean;
}

/** Compara dois nós como "iguais" pra fins de prefixo comum. */
function nodesMatch(a: RouteElementShape, b: RouteElementShape): boolean {
  if (a.kind !== b.kind) return false;
  const an = (a.name || "").trim().toLowerCase();
  const bn = (b.name || "").trim().toLowerCase();
  if (an !== bn) return false;
  // Pra OLT, exige slot/porta iguais quando ambos disponíveis
  if (a.kind === "olt" && a.slot != null && b.slot != null) {
    if (a.slot !== b.slot) return false;
    if (a.port != null && b.port != null && a.port !== b.port) return false;
  }
  return true;
}

/**
 * Calcula o diagrama de rota da outage: prefixo comum (OLT → ... → ponto de convergência)
 * a partir das rotas OZmap dos links afetados.
 */
export async function getMassiveOutageRouteDiagram(outageId: number): Promise<{
  outageId: number;
  totalAffected: number;
  withRoute: number;
  withoutRoute: number;
  commonPath: RouteDiagramNode[];
  convergenceNode: RouteDiagramNode | null;
  /** Quando true, o caminho foi inferido a partir dos vizinhos (outros links da mesma PON/OLT). */
  inferredFromPeers: boolean;
  peersUsed: number;
} | null> {
  const outageRows = await db.select().from(massiveOutages).where(eq(massiveOutages.id, outageId)).limit(1);
  if (outageRows.length === 0) return null;
  const outage = outageRows[0];

  const memberships = await db
    .select({ linkId: massiveOutageLinks.linkId })
    .from(massiveOutageLinks)
    .where(eq(massiveOutageLinks.outageId, outageId));
  const linkIds = memberships.map((m) => m.linkId);
  const totalAffected = linkIds.length;

  // Carrega rotas dos afetados
  let routes: RouteElementShape[][] = [];
  if (linkIds.length > 0) {
    const linkRows = await db
      .select({ id: links.id, ozmapRoute: links.ozmapRoute })
      .from(links)
      .where(inArray(links.id, linkIds));
    for (const row of linkRows) {
      const r = row.ozmapRoute as RouteElementShape[] | null;
      if (Array.isArray(r) && r.length > 0) routes.push(r);
    }
  }
  const withRoute = routes.length;
  const withoutRoute = totalAffected - withRoute;

  // Fallback: se NENHUM afetado tem rota e o escopo é PON ou OLT, usa as rotas dos
  // VIZINHOS da mesma PON/OLT (links online ou offline) — todos compartilham a mesma
  // infra até pelo menos a última CEO comum.
  let inferredFromPeers = false;
  let peersUsed = 0;
  if (routes.length === 0 && (outage.scope === "pon" || outage.scope === "olt")) {
    // Decompõe scopeKey: "pon|<oltName>|<slot>|<port>" ou "olt|<oltName>"
    const parts = outage.scopeKey.split("|");
    const oltName = parts[1];
    const slot = parts[2] != null ? parseInt(parts[2], 10) : null;
    const port = parts[3] != null ? parseInt(parts[3], 10) : null;
    if (oltName) {
      const conds = [
        eq(links.ozmapOltName, oltName),
        sql`${links.ozmapRoute} IS NOT NULL`,
        sql`${links.deletedAt} IS NULL`,
      ];
      if (outage.scope === "pon" && slot != null && port != null && !isNaN(slot) && !isNaN(port)) {
        conds.push(eq(links.ozmapSlot, slot), eq(links.ozmapPort, port));
      }
      const peerRows = await db
        .select({ id: links.id, ozmapRoute: links.ozmapRoute })
        .from(links)
        .where(and(...conds))
        .limit(50);
      for (const row of peerRows) {
        const r = row.ozmapRoute as RouteElementShape[] | null;
        if (Array.isArray(r) && r.length > 0) routes.push(r);
      }
      peersUsed = routes.length;
      if (routes.length > 0) inferredFromPeers = true;
    }
  }

  if (routes.length === 0) {
    return {
      outageId,
      totalAffected,
      withRoute: 0,
      withoutRoute,
      commonPath: [],
      convergenceNode: null,
      inferredFromPeers: false,
      peersUsed: 0,
    };
  }

  // Calcula prefixo comum: usa a primeira rota como referência e vai cortando
  // o tamanho conforme as outras divergem.
  let commonLen = routes[0].length;
  for (let r = 1; r < routes.length; r++) {
    const other = routes[r];
    let i = 0;
    const max = Math.min(commonLen, other.length);
    while (i < max && nodesMatch(routes[0][i], other[i])) i++;
    commonLen = i;
    if (commonLen === 0) break;
  }

  const baseCommon = routes[0].slice(0, commonLen);

  // Conta quantos links ainda permanecem no caminho em cada índice
  const commonPath: RouteDiagramNode[] = baseCommon.map((node, idx) => {
    let stillHere = 0;
    for (const r of routes) {
      if (r.length > idx && nodesMatch(r[idx], node)) stillHere++;
    }
    return {
      ...node,
      affectedAtThisPoint: stillHere,
      divergesAfterCount: 0,
      isConvergencePoint: idx === commonLen - 1,
    };
  });

  // Calcula divergesAfterCount: quantos links divergem APÓS este nó
  // (= afetadosAqui - afetadosNoPróximoNóComum)
  for (let i = 0; i < commonPath.length; i++) {
    const next = commonPath[i + 1];
    commonPath[i].divergesAfterCount = next
      ? Math.max(0, commonPath[i].affectedAtThisPoint - next.affectedAtThisPoint)
      : 0;
  }

  return {
    outageId,
    totalAffected,
    withRoute,
    withoutRoute,
    commonPath,
    convergenceNode: commonPath.length > 0 ? commonPath[commonPath.length - 1] : null,
    inferredFromPeers,
    peersUsed,
  };
}

/** Inicia o loop em background (1x/min). */
export function startMassiveOutageDetector(): void {
  // Primeira execução depois de 60s pra dar tempo do monitor estabilizar
  setTimeout(() => {
    detectMassiveOutages().catch((e) => console.error("[MassiveOutage] Erro:", e));
  }, 60_000);

  setInterval(() => {
    detectMassiveOutages().catch((e) => console.error("[MassiveOutage] Erro:", e));
  }, RUN_INTERVAL_MS);

  console.log(`[MassiveOutage] Detector ativo (intervalo ${RUN_INTERVAL_MS / 1000}s, threshold ${THRESHOLD} links)`);
}

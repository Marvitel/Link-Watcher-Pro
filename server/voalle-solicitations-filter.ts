/**
 * Helpers compartilhados pra filtrar solicitações Voalle por link e classificar
 * status (aberto/encerrado). Usado por:
 *  - server/routes.ts (rotas /api/links/:linkId/voalle/solicitations e /closed)
 *  - server/ai-analyst.ts (tools voalle_list_link_solicitations, _details, _history)
 *
 * Centraliza paridade entre o que a UI vê e o que o Analista de IA vê.
 */

/**
 * Statuses tratados como "em aberto" pelo ERP Voalle. Mantém PT-BR e variações
 * com/sem prefixo "em" porque o Voalle devolve ambos historicamente.
 */
export const OPEN_STATUSES: ReadonlySet<string> = new Set([
  'abertura',
  'andamento',
  'em andamento',
  'aberto',
  'em aberto',
  'reaberto',
  'pendente',
]);

/**
 * Statuses CONHECIDOS como encerrados (usados pra detectar status novos/desconhecidos
 * e logar warning). Não impacta a classificação — qualquer coisa fora de OPEN_STATUSES
 * é considerada encerrada.
 */
export const KNOWN_CLOSED_STATUSES: ReadonlySet<string> = new Set([
  'encerrado', 'encerrada',
  'fechado', 'fechada',
  'cancelado', 'cancelada',
  'concluído', 'concluido', 'concluída', 'concluida',
  'resolvido', 'resolvida',
  'finalizado', 'finalizada',
]);

/**
 * True se a solicitação ainda está em andamento.
 *
 * Status vazio é tratado como ENCERRADA — preserva comportamento legado da rota
 * /voalle/solicitations/closed que filtrava `!OPEN_STATUSES.has(status)` direto
 * (vazio cai como "fechado" pra não ocultar tickets sem status no Voalle).
 */
export function isOpenSolicitation(s: { status?: string | null } | null | undefined): boolean {
  const status = String(s?.status || '').toLowerCase().trim();
  if (!status) return false;
  return OPEN_STATUSES.has(status);
}

/**
 * Particiona uma lista de solicitações em [open, closed] usando OPEN_STATUSES.
 * Retorna também `unknownStatuses` pra o caller logar warning quando aparecer
 * um status fora das duas allowlists.
 */
export function partitionByStatus<T extends { status?: string | null }>(
  solicitations: T[],
): { open: T[]; closed: T[]; unknownStatuses: Set<string> } {
  const open: T[] = [];
  const closed: T[] = [];
  const unknownStatuses = new Set<string>();
  for (const s of solicitations) {
    const status = String(s?.status || '').toLowerCase().trim();
    if (status && !OPEN_STATUSES.has(status) && !KNOWN_CLOSED_STATUSES.has(status)) {
      unknownStatuses.add(status);
    }
    if (isOpenSolicitation(s)) open.push(s);
    else closed.push(s);
  }
  return { open, closed, unknownStatuses };
}

/**
 * Filtra solicitações Voalle pra um link específico aplicando estratégias inline
 * (connectionId, serviceTag exato, substring no título por serviceTag/pppoeUser/identifier)
 * + enrichment via /getsolicitationdata quando inline zera.
 *
 * Retorna { matched, fallbackUngranular } onde:
 *  - matched: solicitações que casaram com o link
 *  - fallbackUngranular: true se ninguém casou MAS o Voalle não retornou campos
 *    granulares (caller decide se devolve TODAS como fallback)
 */
/**
 * Enriquece tickets encerrados com a data REAL de encerramento — obtida via
 * getSolicitationHistory (último relato → beginningDate ou finalDate).
 *
 * O campo `closedAt` original vem do `finalData` do endpoint /solicitationlist,
 * que é o PRAZO SLA, NÃO a data real de encerramento. Sem este enriquecimento
 * a ordenação "encerradas mais recentemente" ficava errada.
 *
 * Retorna o array original com `effectiveClosedAt` preenchido em cada item.
 * Limita a `maxEnrich` chamadas paralelas pra não sobrecarregar o Voalle.
 */
export async function enrichEffectiveClosedAt(
  tickets: Array<any>,
  adapter: any,
  logPrefix: string,
): Promise<Array<any>> {
  if (tickets.length === 0) return tickets;
  if (typeof adapter.getSolicitationHistory !== "function") {
    console.warn(`${logPrefix} adapter sem getSolicitationHistory — pulando enriquecimento de effectiveClosedAt`);
    return tickets;
  }

  const start = Date.now();
  const CONCURRENCY = 10;

  console.log(`${logPrefix} enrichEffectiveClosedAt v2: iniciando para ${tickets.length} tickets`);

  const results: Array<any> = new Array(tickets.length);
  let cursor = 0;
  let successCount = 0;
  let emptyCount = 0;
  let errorCount = 0;

  while (cursor < tickets.length) {
    const batch = tickets.slice(cursor, cursor + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (ticket, batchIdx) => {
        try {
          const history: Array<{ beginningDate?: string; finalDate?: string }> =
            await adapter.getSolicitationHistory(ticket.id);
          if (!Array.isArray(history) || history.length === 0) {
            emptyCount++;
            console.log(`${logPrefix} ticket #${ticket.protocol} (id=${ticket.id}): history vazio (${Array.isArray(history) ? '0 entries' : 'not array'})`);
            return { ...ticket, effectiveClosedAt: null };
          }
          if (cursor + batchIdx === 0) {
            console.log(`${logPrefix} SAMPLE history[0] ticket #${ticket.protocol}: ${JSON.stringify(history[0])}`);
            if (history.length > 1) {
              console.log(`${logPrefix} SAMPLE history[last] ticket #${ticket.protocol}: ${JSON.stringify(history[history.length - 1])}`);
            }
          }
          let maxTs = 0;
          let bestDate: string | null = null;
          for (const entry of history) {
            for (const field of [entry.finalDate, entry.beginningDate]) {
              if (!field) continue;
              const ts = Date.parse(field);
              if (Number.isFinite(ts) && ts > maxTs) {
                maxTs = ts;
                bestDate = field;
              }
            }
          }
          successCount++;
          return { ...ticket, effectiveClosedAt: bestDate };
        } catch (err: any) {
          errorCount++;
          console.warn(`${logPrefix} ticket #${ticket.protocol} (id=${ticket.id}): history ERRO: ${err?.message || err}`);
          return { ...ticket, effectiveClosedAt: null };
        }
      }),
    );
    for (let i = 0; i < batchResults.length; i++) {
      results[cursor + i] = batchResults[i];
    }
    cursor += CONCURRENCY;
  }

  console.log(
    `${logPrefix} enrichEffectiveClosedAt v2 concluído em ${Date.now() - start}ms: ${successCount} ok, ${emptyCount} vazios, ${errorCount} erros de ${tickets.length} total`,
  );
  return results;
}

/**
 * Ordena tickets encerrados por data de encerramento real (effectiveClosedAt)
 * com fallback em cadeia: effectiveClosedAt → closedAt → createdAt.
 * Retorna os primeiros `limit` itens (default 3).
 */
function safeParse(v: string | null | undefined): number {
  if (!v) return 0;
  const ts = Date.parse(v);
  return Number.isFinite(ts) ? ts : 0;
}

export function sortByMostRecentlyClosed(
  tickets: Array<any>,
  limit: number = 3,
): Array<any> {
  return tickets
    .slice()
    .sort((a: any, b: any) => {
      const da = safeParse(a.effectiveClosedAt) || safeParse(a.closedAt) || safeParse(a.createdAt);
      const db = safeParse(b.effectiveClosedAt) || safeParse(b.closedAt) || safeParse(b.createdAt);
      return db - da;
    })
    .slice(0, limit);
}

export async function applyVoalleSolicitationFilter(
  allSolicitations: Array<any>,
  link: { name: string; voalleConnectionId?: number | null; voalleContractTagServiceTag?: string | null; pppoeUser?: string | null; identifier?: string | null },
  adapter: any,
  logPrefix: string,
): Promise<{ matched: Array<any>; fallbackUngranular: boolean }> {
  const linkServiceTag = link.voalleContractTagServiceTag
    ? link.voalleContractTagServiceTag.toLowerCase().trim()
    : '';
  const linkPppoeUser = link.pppoeUser ? link.pppoeUser.toLowerCase().trim() : '';
  const linkIdentifier = link.identifier ? link.identifier.toLowerCase().trim() : '';

  const hasAnyFilter = !!(linkServiceTag || link.voalleConnectionId || linkPppoeUser || linkIdentifier);

  if (allSolicitations.length === 0) {
    return { matched: [], fallbackUngranular: false };
  }

  if (!hasAnyFilter) {
    console.log(`${logPrefix} Link ${link.name} sem critério de match — devolvendo fallback ungranular (mostra todas).`);
    return { matched: [], fallbackUngranular: true };
  }

  let matched: Array<any> = allSolicitations.filter((s) => {
    const subject = (s.subject || '').toLowerCase();
    if (link.voalleConnectionId && s.connectionId && s.connectionId === link.voalleConnectionId) return true;
    if (linkServiceTag && s.contractServiceTag && s.contractServiceTag.toLowerCase().trim() === linkServiceTag) return true;
    if (linkServiceTag && subject.includes(linkServiceTag)) return true;
    if (linkPppoeUser && linkPppoeUser.length >= 4) {
      if (subject.includes(linkPppoeUser)) return true;
      const normalized = linkPppoeUser.replace(/_/g, ' ');
      if (normalized !== linkPppoeUser && subject.includes(normalized)) return true;
    }
    if (linkIdentifier && linkIdentifier.length >= 4 && subject.includes(linkIdentifier)) return true;
    return false;
  });

  console.log(`${logPrefix} Filtro inline: ${allSolicitations.length} total -> ${matched.length} para link ${link.name}`);

  const ENRICHMENT_MAX = 50;
  if (
    matched.length === 0 &&
    (linkServiceTag || linkPppoeUser || linkIdentifier) &&
    allSolicitations.length <= ENRICHMENT_MAX &&
    typeof adapter.getSolicitationData === 'function'
  ) {
    const enrichStart = Date.now();
    console.log(`${logPrefix} Enriquecendo ${allSolicitations.length} solicitações via getSolicitationData (alvo: serviceTag=${linkServiceTag || '-'}, identifier=${linkIdentifier || '-'}, pppoeUser=${linkPppoeUser || '-'})...`);

    const enriched = await Promise.all(
      allSolicitations.map(async (s) => {
        try {
          const details = await adapter.getSolicitationData(s.id);
          return { sol: s, details, error: undefined as string | undefined };
        } catch (err: any) {
          return { sol: s, details: null, error: err?.message as string | undefined };
        }
      })
    );

    const failures = enriched.filter((e) => !!e.error).length;
    matched = enriched
      .filter(({ details }) => {
        if (!details) return false;
        const detailTag = details.contractServiceTag?.serviceTag
          ? details.contractServiceTag.serviceTag.toLowerCase().trim()
          : '';
        if (linkServiceTag && detailTag && detailTag === linkServiceTag) return true;
        if (linkIdentifier && detailTag && detailTag === linkIdentifier) return true;
        if (linkPppoeUser && linkPppoeUser.length >= 4 && details.requestor?.name) {
          const reqName = details.requestor.name.toLowerCase();
          if (reqName.includes(linkPppoeUser)) return true;
          const normalized = linkPppoeUser.replace(/_/g, ' ');
          if (normalized !== linkPppoeUser && reqName.includes(normalized)) return true;
        }
        return false;
      })
      .map((m) => m.sol);

    console.log(`${logPrefix} Enrichment concluído em ${Date.now() - enrichStart}ms: ${matched.length}/${allSolicitations.length} casaram (${failures} falhas)`);
  } else if (allSolicitations.length > ENRICHMENT_MAX && matched.length === 0) {
    console.log(`${logPrefix} Enrichment ignorado: ${allSolicitations.length} solicitações > limite ${ENRICHMENT_MAX}`);
  }

  let fallbackUngranular = false;
  if (matched.length === 0) {
    const anyGranular = allSolicitations.some((s) => !!s.contractServiceTag || !!s.connectionId);
    if (!anyGranular) fallbackUngranular = true;
  }

  return { matched, fallbackUngranular };
}

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

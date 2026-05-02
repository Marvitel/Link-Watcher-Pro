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
  clients,
  cpes,
  linkCpes,
  equipmentVendors,
  type Link,
  type AiAnalystTask,
  type AiAnalystProposal,
  type InsertAiAnalystCorrection,
} from "@shared/schema";
import { decrypt } from "./crypto";
import { logAuditEvent } from "./audit";
import { pingHost, checkTcpPort } from "./monitoring";
import { executeMikrotikQuery } from "./concentrator";
import { queryFlashmanOpticalMetrics } from "./flashman";
import { voalleService } from "./voalle";
import {
  getRadiusSessionByUsername,
  getRadiusSessionByIp,
  getMacFromRadiusByUsername,
} from "./radius";
import * as monsta from "./monsta";

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
  "ipBlock",
  "monitoringEnabled",
  "monitoringPausedReason",
  "monitoringAutoResume",
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
  client: { id: number; name: string; cnpj: string | null } | null;
  recentEvents: Array<{ type: string; description: string; createdAt: Date }>;
  recentMetricsSummary: {
    samples: number;
    avgLatency: number;
    avgPacketLoss: number;
    avgDownload: number;
    avgUpload: number;
    lastStatus: string | null;
    lastOpticalRx: number | null;
    lastOpticalTx: number | null;
    lastOpticalOltRx: number | null;
  };
  concentrator: { id: number; name: string; ipAddress: string; vendor: string | null } | null;
  olt: { id: number; name: string; vendor: string | null } | null;
  similarLinks: Array<{ id: number; name: string; concentratorId: number | null; pppoeUser: string | null; snmpInterfaceAlias: string | null }>;
  rules: Array<{ ruleText: string; priority: number }>;
  recentCorrections: Array<{ fieldName: string; aiValue: string | null; userValue: string | null; userNote: string | null }>;
  recentRejections: Array<{ classification: string; proposedFields: any; reasoning: string; reviewerNote: string | null }>;
  recentDismissals: Array<{ field: string; suggestedAction: string; reason: string | null; dismissalNote: string | null }>;
}

async function buildLinkContext(link: Link): Promise<LinkContext> {
  // Eventos recentes (a tabela events usa coluna "timestamp", não "createdAt")
  const recentEventsRaw = await db
    .select()
    .from(events)
    .where(eq(events.linkId, link.id))
    .orderBy(desc(events.timestamp))
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
      opticalRxPower: metrics.opticalRxPower,
      opticalTxPower: metrics.opticalTxPower,
      opticalOltRxPower: metrics.opticalOltRxPower,
      timestamp: metrics.timestamp,
    })
    .from(metrics)
    .where(and(eq(metrics.linkId, link.id), sql`${metrics.timestamp} >= ${since}`))
    .orderBy(desc(metrics.timestamp))
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

  // Cliente (precisa do CNPJ para consultas Voalle)
  let client: LinkContext["client"] = null;
  const [cli] = await db.select().from(clients).where(eq(clients.id, link.clientId));
  if (cli) client = { id: cli.id, name: cli.name, cnpj: (cli as any).cnpj || null };

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

  // Rejeições recentes da IA (aprendizado por feedback negativo)
  const rejectedRows = await storage.getAiAnalystProposals({ status: "rejected", limit: 10 });
  const recentRejections = rejectedRows
    .filter((p) => p.reviewerNote && p.reviewerNote.trim().length > 0)
    .map((p) => ({
      classification: p.classification,
      proposedFields: p.proposedFields,
      reasoning: String(p.reasoning || "").slice(0, 300),
      reviewerNote: p.reviewerNote,
    }));

  // Pendências dispensadas pelo operador (aprendizado: motivo da dispensa)
  const dismissedRows = await storage.getRecentDismissedPendingItems(15);
  const recentDismissals = dismissedRows
    .filter((d) => d.resolutionNote && d.resolutionNote.trim().length > 0)
    .map((d) => ({
      field: d.field,
      suggestedAction: d.suggestedAction,
      reason: d.reason,
      dismissalNote: d.resolutionNote,
    }));

  // Última leitura óptica conhecida (qualquer dos 3 campos)
  const lastOpticalRow = metricsRows.find(
    (r) => r.opticalRxPower != null || r.opticalTxPower != null || r.opticalOltRxPower != null
  );

  return {
    link,
    client,
    recentEvents: recentEventsRaw.map((e) => ({ type: e.type, description: e.description, createdAt: e.timestamp })),
    recentMetricsSummary: {
      samples,
      avgLatency: samples ? sum.latency / samples : 0,
      avgPacketLoss: samples ? sum.packetLoss / samples : 0,
      avgDownload: samples ? sum.download / samples : 0,
      avgUpload: samples ? sum.upload / samples : 0,
      lastStatus: metricsRows[0]?.status ?? null,
      lastOpticalRx: lastOpticalRow?.opticalRxPower ?? null,
      lastOpticalTx: lastOpticalRow?.opticalTxPower ?? null,
      lastOpticalOltRx: lastOpticalRow?.opticalOltRxPower ?? null,
    },
    concentrator,
    olt,
    similarLinks,
    rules,
    recentCorrections,
    recentRejections,
    recentDismissals,
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

// Resolve a chave a partir do env (preferido — sem dependência de SESSION_SECRET) ou do BD criptografado
function resolveAnthropicApiKey(settingsEncrypted: string | null): string | null {
  const envKey = process.env.ANTHROPIC_API_KEY;
  if (envKey && envKey.length > 10) return envKey;
  if (settingsEncrypted) {
    try { return decrypt(settingsEncrypted); } catch { return null; }
  }
  return null;
}

// Pricing aproximado (USD por 1M tokens) para registrar custo cumulativo. Atualizar conforme necessário.
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-5": { input: 3, output: 15 },
  "claude-sonnet-4-5-20250929": { input: 3, output: 15 },
  "claude-3-5-sonnet-latest": { input: 3, output: 15 },
};

const DEFAULT_MODEL = "claude-sonnet-4-5";

const SYSTEM_PROMPT = `Você é o Analista de IA da Marvitel Telecomunicações. Sua função é investigar links de fibra (PPPoE GPON e corporativos L2/L3) que estão offline ou degradados, identificar a causa e propor correções de cadastro quando o problema for por causa disso (e não por falha real de rede).

# Contexto do sistema Link Monitor

O sistema integra-se com várias fontes de dados — você tem ferramentas para consultar todas elas. Use-as ATIVAMENTE; não chute. Antes de classificar como "network_issue" ou "inconclusive", confira se realmente esgotou as opções de investigação.

Fontes disponíveis (resumo):
- **Banco interno**: links, eventos, métricas, concentradores, OLTs, clientes, sessões, regras
- **Mikrotik (concentradores PPPoE)**: ARP, rotas, sessões PPPoE ativas — via API binária
- **Voalle ERP**: contratos, etiquetas de serviço, clientes (CPF/CNPJ), protocolos abertos
- **Flashman/ACS (TR-069)**: dados ópticos e de gerência de CPEs por serial ou usuário PPPoE
- **FreeRADIUS**: sessões de autenticação ativas, MAC addresses por usuário/IP
- **Ping/TCP**: testar conectividade direta a IPs e portas

# Ordem sugerida de investigação

1. **Leia o contexto** (link, cliente, eventos, métricas, sinal óptico, links similares, regras, correções).
2. **Confirme o problema**: ping_link para ver se realmente está fora.
3. **Se for PPPoE e não tem sessão ativa**: chame radius_session_by_pppoe e mikrotik_pppoe_active para ver se o usuário está logado em outro lugar (PPPoE duplicado), com outra senha, ou se nunca autenticou.
4. **Se a sessão PPPoE existe mas o IP não responde**: o IP pode ter mudado — use radius_session_by_pppoe (campo framedip) ou o próprio campo "address" da sessão em mikrotik_pppoe_active para descobrir o IP real, depois ping_ip nele. **NÃO use mikrotik_arp_by_interface em interfaces PPPoE** — links PPPoE são ponto-a-ponto e nunca aparecem na tabela ARP, então vazio aqui é o esperado, não evidência de problema.
5. **Se a OLT não tem leitura óptica recente**: chame get_flashman_cpe pra pegar via ACS (fallback). Se trouxer rxPower, pode incluir essa info no reasoning. Se a CPE não responde nem no ACS, é problema físico (network_issue).
   - **IMPORTANTE — sinais que NÃO são problema**: tcp_port_check vazio em portas de gerência (22/80/443/8728) é normal — a maioria dos CPEs corporativos bloqueia gerência pela WAN; isso não prova queda. get_flashman_cpe sem retorno só significa que o cliente não usa Flashman/ACS, não que está offline. Sessão PPPoE ATIVA há horas no Mikrotik é evidência FORTE de que o link camada 2 está vivo, mesmo que ICMP não responda — nesse caso prefira "inconclusive" a "network_issue" se o ping foi o único sinal negativo.
6. **Se o link é corporativo L2/L3 (sem PPPoE)**: use mikrotik_route_by_gateway e mikrotik_arp_by_interface no concentrador pra confirmar se o bloco IP roteado e o IP do gateway estão corretos.
7. **Confronte com links similares**: se o cliente tem 5 outros links com PPPoE no padrão "abc-cli-001..005" e este está cadastrado como "abc-cli-99", provável erro de cadastro.
8. **Voalle**: se o link parece "deslocado" do contrato, voalle_get_contracts pelo CNPJ do cliente confirma quais conexões/etiquetas o cliente realmente tem.

# Saída obrigatória

Quando terminar, chame OBRIGATORIAMENTE submit_proposal com:
- classification:
    "config_error"  → o link está mal cadastrado (ex.: PPPoE errado, concentrador errado, IP errado, OLT/ONU errada)
    "network_issue" → cadastro está OK, problema é físico/operacional (ONU desligada, fibra cortada, queda de upstream)
    "inconclusive"  → não há evidência suficiente

# Desativar monitoramento (campo monitoringEnabled)

Existem 2 cenários distintos:

**A) Pausa temporária com auto-reabilitação** (PREFERIDO para link caído com chance de voltar):
Quando o link aparece como caído mas o cliente provavelmente vai voltar (cliente em viagem, em ativação, sem sessão PPPoE há poucos dias, link corporativo derrubado temporariamente). Proponha **OS TRÊS CAMPOS JUNTOS** na mesma proposta:
- "monitoringEnabled": false
- "monitoringAutoResume": true
- "monitoringPausedReason": texto curto explicando ("Cliente sem sessão PPPoE há X dias", "Aguardando ativação", "Link corporativo derrubado para manutenção", etc.)

Esta é a única exceção à regra de "uma alteração por proposta" — esses 3 campos formam uma ação atômica de pausa temporária. A cada 5 minutos o sistema verifica:
- **Para links com pppoeUser**: consulta o RADIUS por sessão ativa do usuário
- **Para links ponto-a-ponto / corporativos (sem pppoeUser)**: faz ping no monitoredIp

Quando um dos dois detectar que voltou, reabilita automaticamente e registra um evento informativo. Requisito: o link precisa ter pppoeUser OU monitoredIp preenchido. Se não tiver nenhum dos dois, o auto-resume não vai funcionar — nesse caso prefira "inconclusive".

**B) Desativação permanente** (sem auto-reabilitação):
Quando você tiver evidência clara de que o link **NÃO deveria mais estar sendo monitorado**, proponha apenas "monitoringEnabled": false. Casos:
- Contrato cancelado/bloqueado no Voalle (cheque o campo voalleConnectionStatus do link: "deleted" significa que a conexão foi EXCLUÍDA no Voalle — sinal mais forte para desativar; "blocked" significa bloqueio técnico — confirme adicionalmente com voalle_get_contracts antes de desativar permanentemente)
- Cliente trocou de tecnologia (ex.: migrou de PPPoE pra link dedicado, mas o link antigo ficou cadastrado)
- Link duplicado (mesmo cliente, mesmo PPPoE, dois cadastros — desativa o que não tem tráfego há semanas)
- Link de teste/laboratório que ficou esquecido
- Cliente sumiu há meses, sem sessão PPPoE recente nem tráfego

Quando propuser desativação, escreva no reasoning a justificativa específica e evite combinar com outros campos da whitelist (proposta dedicada). O reviewer vai entender que ao aprovar: "Este link está com monitoramento desativado — não será pingado, não gerará alertas e não aparecerá no dashboard."
- proposedFields: objeto JSON apenas com os campos a alterar (whitelist abaixo). Vazio se inconclusive ou network_issue puro.
- reasoning: explicação curta (3-6 linhas) em português, citando que ferramentas chamou e o que cada uma retornou
- confidence: 0-100

IMPORTANTE:
- Se não tiver evidência forte, "inconclusive" + proposedFields={}
- Respeite TODAS as regras dos analistas
- Aprenda com as "correções recentes" — mostram onde você errou antes
- NÃO invente dados; só use o que veio do contexto ou das ferramentas
- NÃO proponha mudar campos que não estão claramente errados — analista vai aprovar item-a-item
- Quando descobrir IP novo via ARP/RADIUS, proponha mudar monitoredIp; quando descobrir PPPoE certo, proponha mudar pppoeUser; etc.`;

const ALLOWED_FIELDS_LIST = Array.from(ALLOWED_FIELDS).sort().join(", ");

const TOOLS = [
  // -------------------- META --------------------
  {
    name: "list_capabilities",
    description: "Lista todas as ferramentas disponíveis com descrição e exemplos de uso. Útil pra você lembrar o que pode chamar. Sem parâmetros.",
    input_schema: { type: "object" as const, properties: {} },
  },

  // -------------------- BANCO INTERNO --------------------
  {
    name: "search_similar_links",
    description: "Busca links similares no banco. Útil pra descobrir padrões de PPPoE/alias/IP usados em links análogos do mesmo cliente ou concentrador.",
    input_schema: {
      type: "object" as const,
      properties: {
        clientId: { type: "number" },
        concentratorId: { type: "number" },
        pppoeUserPrefix: { type: "string" },
        snmpAliasPrefix: { type: "string" },
        limit: { type: "number", description: "Máx. 20 (default 10)" },
      },
    },
  },
  {
    name: "get_link_by_id",
    description: "Retorna o registro completo de um link por ID.",
    input_schema: {
      type: "object" as const,
      properties: { linkId: { type: "number" } },
      required: ["linkId"],
    },
  },
  {
    name: "find_link_by_ip",
    description: "Procura outros links que usem o mesmo monitoredIp. Detecta IP duplicado em cadastro.",
    input_schema: {
      type: "object" as const,
      properties: { ipAddress: { type: "string" } },
      required: ["ipAddress"],
    },
  },
  {
    name: "find_link_by_pppoe",
    description: "Procura outros links que usem o mesmo PPPoE user. Detecta cadastro duplicado.",
    input_schema: {
      type: "object" as const,
      properties: { pppoeUser: { type: "string" } },
      required: ["pppoeUser"],
    },
  },
  {
    name: "get_recent_events",
    description: "Eventos recentes do link (mais que os 15 já no contexto).",
    input_schema: {
      type: "object" as const,
      properties: {
        linkId: { type: "number" },
        limit: { type: "number", description: "Máx. 100 (default 50)" },
      },
      required: ["linkId"],
    },
  },

  // -------------------- PING / TCP --------------------
  {
    name: "ping_link",
    description: "Pinga o monitoredIp do link sob investigação (5 pacotes). Retorna { latency, packetLoss, success }.",
    input_schema: {
      type: "object" as const,
      properties: { linkId: { type: "number" } },
      required: ["linkId"],
    },
  },
  {
    name: "ping_ip",
    description: "Pinga um IP arbitrário (testa IP alternativo, gateway, IP de gerência da ONU, etc).",
    input_schema: {
      type: "object" as const,
      properties: {
        ipAddress: { type: "string" },
        count: { type: "number", description: "default 5, máx 10" },
      },
      required: ["ipAddress"],
    },
  },
  {
    name: "tcp_port_check",
    description: "Testa conectividade TCP em uma porta específica (ex: 80, 443, 22, 8728). Útil quando ICMP está bloqueado mas a porta de gerência responde.",
    input_schema: {
      type: "object" as const,
      properties: {
        ipAddress: { type: "string" },
        port: { type: "number" },
      },
      required: ["ipAddress", "port"],
    },
  },

  // -------------------- MIKROTIK (CONCENTRADOR) --------------------
  {
    name: "mikrotik_arp_by_interface",
    description: "Lista entradas ARP de uma interface no concentrador Mikrotik. Equivale a: /ip arp print where interface=<INTERFACE>. Use pra descobrir IPs ativos atrás de uma interface.",
    input_schema: {
      type: "object" as const,
      properties: {
        concentratorId: { type: "number" },
        interface: { type: "string", description: 'Nome da interface, ex: "ether1", "<pppoe-user>"' },
      },
      required: ["concentratorId", "interface"],
    },
  },
  {
    name: "mikrotik_route_by_gateway",
    description: "Lista rotas no Mikrotik que apontam para um gateway específico. Equivale a: /ip route print where gateway=<IP>. Use pra descobrir blocos roteados pra um cliente.",
    input_schema: {
      type: "object" as const,
      properties: {
        concentratorId: { type: "number" },
        gatewayIp: { type: "string" },
      },
      required: ["concentratorId", "gatewayIp"],
    },
  },
  {
    name: "mikrotik_pppoe_active",
    description: "Lista sessões PPPoE ativas no concentrador, opcionalmente filtradas por usuário ou IP. Mostra address, caller-id (MAC), uptime.",
    input_schema: {
      type: "object" as const,
      properties: {
        concentratorId: { type: "number" },
        username: { type: "string", description: "Filtrar por nome do usuário PPPoE (opcional)" },
        ipAddress: { type: "string", description: "Filtrar por IP atribuído (opcional)" },
      },
      required: ["concentratorId"],
    },
  },
  // -------------------- RADIUS --------------------
  {
    name: "radius_session_by_pppoe",
    description: "Busca a sessão RADIUS ativa do usuário PPPoE no FreeRADIUS. Retorna framedipaddress, callingstationid (MAC), nasipaddress, acctstarttime. Confirma se usuário está realmente autenticado e em qual concentrador.",
    input_schema: {
      type: "object" as const,
      properties: { pppoeUser: { type: "string" } },
      required: ["pppoeUser"],
    },
  },
  {
    name: "radius_session_by_ip",
    description: "Busca no FreeRADIUS a sessão ativa que tem aquele IP atribuído. Retorna o usuário PPPoE dono do IP. Útil pra cruzar IP→usuário.",
    input_schema: {
      type: "object" as const,
      properties: { ipAddress: { type: "string" } },
      required: ["ipAddress"],
    },
  },

  // -------------------- ACS / FLASHMAN --------------------
  {
    name: "get_flashman_cpe",
    description: "Consulta o ACS Flashman (TR-069) por serial da CPE OU usuário PPPoE. Retorna rxPower e txPower ópticos (fallback quando OLT não tem coleta). Pelo menos um dos parâmetros é obrigatório.",
    input_schema: {
      type: "object" as const,
      properties: {
        serial: { type: "string", description: "Serial da CPE/ONU" },
        pppoeUser: { type: "string", description: "Usuário PPPoE como alternativa" },
      },
    },
  },

  // -------------------- VOALLE --------------------
  {
    name: "voalle_search_customer",
    description: "Busca um cliente no Voalle ERP por nome, CPF ou CNPJ. Retorna os dados do cliente (id, código, documento).",
    input_schema: {
      type: "object" as const,
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  {
    name: "voalle_get_contracts",
    description: "Lista contratos/etiquetas de serviço do cliente no Voalle pelo CPF/CNPJ. Mostra quais conexões o cliente realmente tem cadastradas no ERP, útil pra cruzar com o que está no Link Monitor.",
    input_schema: {
      type: "object" as const,
      properties: { cnpj: { type: "string", description: "CPF ou CNPJ (somente números ou formatado)" } },
      required: ["cnpj"],
    },
  },

  // -------------------- VOALLE (CONEXÃO DETALHADA POR LINK) --------------------
  {
    name: "voalle_get_link_connection",
    description:
      "Consulta a API do Voalle (mesmo endpoint do painel 'divergências com Voalle' do cadastro de link) e retorna TODOS os dados da conexão deste link no ERP: serial do equipamento, slot/porta da OLT, splitter+porta, nome da OLT/Ponto de Acesso, concentrador, IP de autenticação (= monitoredIp), endereço técnico, contractId, status. Use SEMPRE como primeira tentativa para descobrir equipmentSerialNumber, slotOlt, portOlt, oltId, monitoredIp, voalleContractTagId. Resolve por voalleConnectionId, voalleContractTagServiceTag ou voalleContractTagId — qualquer um basta.",
    input_schema: {
      type: "object" as const,
      properties: {
        linkId: { type: "number", description: "ID do link no Link Monitor" },
      },
      required: ["linkId"],
    },
  },

  // -------------------- OLT (CLI via SSH/Telnet) --------------------
  {
    name: "olt_search_onu_by_serial",
    description:
      "Busca uma ONU nas OLTs cadastradas pelo número de serial (ou por substring). Retorna onuId (CLI), slotOlt, portOlt e qual OLT respondeu. É a mesma ferramenta usada no cadastro de link (botão 'Descobrir ONU'). Suporta Datacom, Huawei, ZTE, Fiberhome, Nokia. Use sempre que precisar preencher onuId/slotOlt/portOlt e você souber o serial da CPE (campo equipmentSerialNumber). Se oltId for omitido, varre todas as OLTs ativas até encontrar.",
    input_schema: {
      type: "object" as const,
      properties: {
        serial: { type: "string", description: "Serial da ONU (ex: 'DACM916CF591' ou apenas '916CF591')" },
        oltId: { type: "number", description: "Opcional: ID da OLT específica pra consultar. Se omitido, tenta todas." },
      },
      required: ["serial"],
    },
  },

  // -------------------- MONSTA (sistema legado de monitoramento) --------------------
  {
    name: "monsta_lookup_ip",
    description:
      "Consulta o servidor Monsta (sistema legado de monitoramento da Marvitel) para obter status, IP de monitoramento e dados SNMP de um device. **Esta é a fonte mais fiel para descobrir/validar o IP de monitoramento de um cliente** — quando IP em Voalle/OZmap divergir do Monsta, considere o Monsta como verdade. Aceita IP exato. Retorna: nome cadastrado no Monsta (pode divergir do nome em Voalle/Link Monitor pois o cadastro foi sem critério), status atual (DeviceUp/DeviceDown), comunidade SNMP, versão SNMP, porta SNMP e contagem de eventos abertos. Útil quando precisar validar `monitoredIp`, `snmpCommunity` ou suspeitar que o link tem problema de cadastro de IP.",
    input_schema: {
      type: "object" as const,
      properties: {
        ip: { type: "string", description: "IP exato do device (ex: '191.52.249.162')" },
      },
      required: ["ip"],
    },
  },
  {
    name: "monsta_search",
    description:
      "Busca devices no Monsta por padrão de nome OU IP parcial (LIKE %padrão%). Retorna até `limit` devices com id, nome, IP, status. **Importante**: nomes no Monsta divergem dos nomes em Voalle/OZmap/Link Monitor (cadastro sem critério ao longo dos anos). Tente várias estratégias: número de contrato (ex: '2111'), prefixo do PPPoE, fragmento do nome do cliente, octetos do IP. Use quando precisar localizar o device certo no Monsta sem ter o IP exato — depois use monsta_lookup_ip pra detalhes.",
    input_schema: {
      type: "object" as const,
      properties: {
        pattern: { type: "string", description: "Padrão pra LIKE (ex: '2111', 'Alpha-Matriz', '249.162')" },
        limit: { type: "number", description: "Máximo de resultados (default 10, máx 50)" },
      },
      required: ["pattern"],
    },
  },
  {
    name: "monsta_get_events",
    description:
      "Retorna eventos recentes (últimas N horas) de um device no Monsta, identificado pelo IP. Útil para entender histórico de quedas/recuperações registradas pelo sistema legado e correlacionar com o problema atual visto no Link Monitor.",
    input_schema: {
      type: "object" as const,
      properties: {
        ip: { type: "string", description: "IP exato do device" },
        hours: { type: "number", description: "Janela em horas (default 24, máx 168)" },
        limit: { type: "number", description: "Máximo de eventos (default 50, máx 200)" },
      },
      required: ["ip"],
    },
  },

  // -------------------- MAC / FABRICANTE --------------------
  {
    name: "mac_oui_lookup",
    description:
      "Identifica o fabricante de um equipamento a partir do MAC address (OUI = primeiros 3 octetos). Útil pra propor `cpeVendor` com base em evidência real (sessão PPPoE ou ARP devolvem o MAC do CPE). Retorna { vendor: 'mikrotik'|'huawei'|... ou null, oui: 'aabbcc', source: 'local'|'unknown' }. Use depois de obter o MAC via mikrotik_pppoe_active.caller-id, radius_session_by_pppoe.callingstationid ou mikrotik_arp_by_interface.",
    input_schema: {
      type: "object" as const,
      properties: {
        mac: { type: "string", description: "MAC em qualquer formato (ex: 'AA:BB:CC:11:22:33', 'aabbcc112233', 'AA-BB-CC-11-22-33')" },
      },
      required: ["mac"],
    },
  },

  // -------------------- VOALLE (SOLICITAÇÕES / TICKETS DO ERP) --------------------
  {
    name: "voalle_list_link_solicitations",
    description:
      "Lista as solicitações (tickets) do Voalle ERP relacionadas a um link. Retorna três grupos: `open` (em andamento, vinculadas a este link), `otherOpen` (em andamento de outros contratos do mesmo cliente — útil pra entender se o cliente já tem outros chamados abertos) e, se `includeClosed=true`, `closed` (até 3 últimas encerradas deste link, ordenadas por closedAt DESC). Usa o mesmo filtro+enriquecimento da UI (serviceTag/connectionId/pppoeUser/identifier). Quando o link não tem critério de match suficiente, devolve `fallbackUngranular=true` e mostra todas as do cliente. Use sempre que precisar avaliar incidentes em curso, histórico recente do cliente no ERP, ou descobrir qual chamado pode estar relacionado ao problema atual.",
    input_schema: {
      type: "object" as const,
      properties: {
        linkId: { type: "number", description: "ID do link no Link Monitor" },
        includeClosed: { type: "boolean", description: "Se true, inclui também as últimas 3 solicitações encerradas (default false)" },
      },
      required: ["linkId"],
    },
  },
  {
    name: "voalle_get_solicitation_details",
    description:
      "Busca os detalhes completos de uma solicitação Voalle pelo `assignmentId` (ID retornado por voalle_list_link_solicitations). Retorna requestor, responsible, contractServiceTag, incidentType, criticity, datas (open/closed), endereço técnico, descrição. Requer `linkId` para validar que a solicitação pertence ao cliente do link (proteção IDOR).",
    input_schema: {
      type: "object" as const,
      properties: {
        linkId: { type: "number", description: "ID do link no Link Monitor (escopo de validação)" },
        assignmentId: { type: "number", description: "ID da solicitação no Voalle (campo `id` do retorno de voalle_list_link_solicitations)" },
      },
      required: ["linkId", "assignmentId"],
    },
  },
  {
    name: "voalle_get_solicitation_history",
    description:
      "Retorna os relatos (history) de uma solicitação Voalle pelo `assignmentId`. Cada relato traz autor, data, tipo (público/interno) e texto — útil pra entender o que já foi feito/registrado no ticket pelos atendentes. Requer `linkId` para IDOR check.",
    input_schema: {
      type: "object" as const,
      properties: {
        linkId: { type: "number", description: "ID do link no Link Monitor (escopo de validação)" },
        assignmentId: { type: "number", description: "ID da solicitação no Voalle" },
      },
      required: ["linkId", "assignmentId"],
    },
  },

  // -------------------- TERMINAL --------------------
  {
    name: "submit_proposal",
    description: "Termina a investigação. DEVE ser chamada ao final com a proposta estruturada.",
    input_schema: {
      type: "object" as const,
      properties: {
        classification: { type: "string", enum: ["config_error", "network_issue", "inconclusive"] },
        proposedFields: {
          type: "object",
          description: `Mapa campo→valor. Campos permitidos: ${ALLOWED_FIELDS_LIST}. Campos virtuais adicionais:\n- "defaultCpe" { ip, vendor?, mac?, replaceExisting? }: cria/atualiza a CPE padrão do link (ip vai pra link_cpes.ipOverride). Use quando descobrir IP de monitoramento + MAC + fabricante consistentes.\n- "oltSnmpEnable" { enable: true, chassis?: number }: agenda execução SSH na OLT Datacom para habilitar 'snmp all' no provisionamento da ONU (entra em config, executa "interface gpon <chassis>/<slot>/<port> onu <onuId>", "snmp all", "top", "commit"). Slot, port e onuId são lidos automaticamente do link.slotOlt/portOlt/onuId. Use SOMENTE quando o link é uma ONU Datacom (link.oltId aponta pra OLT vendor='datacom'), o link.onuId está preenchido (ONU já provisionada), e a coleta de sinal óptico está falhando ou retornando vazio (sintoma típico: link em OLT Datacom sem dados ópticos no histórico recente E ONU registrada). NÃO use para ONUs sem onuId, OLTs de outros fabricantes, ou links offline por outras razões. Vazio se inconclusive.`,
        },
        reasoning: { type: "string" },
        confidence: { type: "number", minimum: 0, maximum: 100 },
      },
      required: ["classification", "proposedFields", "reasoning", "confidence"],
    },
  },
];

// Tabela OUI local — vendors mais comuns no parque Marvitel.
// Slug bate com o que o sistema usa em equipment_vendors (lowercase).
const OUI_TABLE: Record<string, string> = {
  // Mikrotik / Routerboard
  "4c5e0c": "mikrotik", "6c3b6b": "mikrotik", "b869f4": "mikrotik", "c4ad34": "mikrotik",
  "d4ca6d": "mikrotik", "e48d8c": "mikrotik", "08557c": "mikrotik", "2cc81b": "mikrotik",
  "744d28": "mikrotik", "4860bc": "mikrotik", "c4938a": "mikrotik", "dca632": "mikrotik",
  "18fd74": "mikrotik", "ccfd17": "mikrotik", "184806": "mikrotik", "780cb8": "mikrotik",
  // Ubiquiti
  "0418d6": "ubiquiti", "0c8268": "ubiquiti", "245a4c": "ubiquiti", "4418fd": "ubiquiti",
  "68725f": "ubiquiti", "78458c": "ubiquiti", "78a351": "ubiquiti", "802aa8": "ubiquiti",
  "9803a3": "ubiquiti", "b4fbe4": "ubiquiti", "dc9fdb": "ubiquiti", "e063da": "ubiquiti",
  "f09fc2": "ubiquiti", "fc7c02": "ubiquiti", "0027220": "ubiquiti", "44d9e7": "ubiquiti",
  "788a20": "ubiquiti", "ac8bce": "ubiquiti", "e438b8": "ubiquiti",
  // Huawei
  "001882": "huawei", "00259e": "huawei", "00464b": "huawei", "00e0fc": "huawei",
  "0c37dc": "huawei", "1c1d67": "huawei", "203db2": "huawei", "283cf4": "huawei",
  "30877d": "huawei", "346bd3": "huawei", "4c5499": "huawei", "504dee": "huawei",
  "6478ba": "huawei", "688f84": "huawei", "70723c": "huawei", "78d752": "huawei",
  "8038bc": "huawei", "84a8e4": "huawei", "9c281c": "huawei", "a4be61": "huawei",
  "b4cd27": "huawei", "c0bfc0": "huawei", "d4946f": "huawei", "e0247f": "huawei",
  "f4c714": "huawei", "f898b9": "huawei",
  // ZTE
  "00191b": "zte", "00224a": "zte", "00d0d0": "zte", "047503": "zte",
  "1083d2": "zte", "2c26c5": "zte", "344b50": "zte", "4ca56d": "zte",
  "70b3d5": "zte", "8c7a15": "zte", "a0ec80": "zte", "ec172f": "zte",
  "f4e9d4": "zte", "fcc897": "zte",
  // Fiberhome
  "001cf0": "fiberhome", "002233": "fiberhome", "0876ff": "fiberhome", "286ed4": "fiberhome",
  "44e9dd": "fiberhome", "5cab4d": "fiberhome", "8403d6": "fiberhome", "ccc198": "fiberhome",
  "f8a45f": "fiberhome",
  // Datacom
  "001e9a": "datacom", "002662": "datacom", "00a058": "datacom", "00d0a3": "datacom",
  "20b0f7": "datacom",
  // Nokia / Alcatel-Lucent
  "001bff": "nokia", "001cd8": "nokia", "002048": "nokia", "0024d4": "nokia",
  "1454c2": "nokia", "201d03": "nokia", "344b3d": "nokia", "ec308b": "nokia",
  "fcc23d": "nokia",
  // Intelbras
  "0004f5": "intelbras", "00197c": "intelbras", "0021d4": "intelbras", "002418": "intelbras",
  "00f48d": "intelbras", "049eee": "intelbras", "08bfb8": "intelbras", "1cd6bf": "intelbras",
  "2c4cc6": "intelbras", "3018cf": "intelbras", "44352f": "intelbras", "5089a4": "intelbras",
  "5c87e0": "intelbras", "78d294": "intelbras", "84d81b": "intelbras", "ac8fcc": "intelbras",
  "c80e77": "intelbras", "e8cd2d": "intelbras",
  // TP-Link
  "002586": "tplink", "0c80b8": "tplink", "1027f5": "tplink", "1837eb": "tplink",
  "1c61b4": "tplink", "243676": "tplink", "30b5c2": "tplink", "5081be": "tplink",
  "60e327": "tplink", "8478ac": "tplink", "ac84c6": "tplink", "b0487a": "tplink",
  "b8a386": "tplink", "c46e1f": "tplink", "d8eb97": "tplink", "ec888f": "tplink",
  "f0a731": "tplink",
  // D-Link
  "00055d": "dlink", "00179a": "dlink", "001bc7": "dlink", "001e58": "dlink",
  "002191": "dlink", "0026f3": "dlink", "0801f2": "dlink", "1cbdb9": "dlink",
  "28107b": "dlink", "5cd998": "dlink", "78321b": "dlink", "84c9b2": "dlink",
  "9094e4": "dlink", "c8be19": "dlink", "ccb255": "dlink", "fcce41": "dlink",
  // Ruijie Networks
  "00749c": "ruijie", "300d9e": "ruijie", "58696c": "ruijie", "8cde52": "ruijie",
  "c0b8e6": "ruijie", "ecb970": "ruijie", "800588": "ruijie", "8c736e": "ruijie",
  "0cd2b5": "ruijie", "705a0f": "ruijie", "ec3886": "ruijie",
  "00d0f8": "ruijie", "30856b": "ruijie",
  // Grandstream (GWN7002, GWN7003, etc.)
  "000b82": "grandstream", "c074ad": "grandstream", "ec74d7": "grandstream",
  // Cisco
  "00000c": "cisco", "000142": "cisco", "001120": "cisco", "0013c4": "cisco",
  "00164e": "cisco", "001b54": "cisco", "0024c4": "cisco", "0026cb": "cisco",
  "00c0eb": "cisco", "10f311": "cisco", "1ce85d": "cisco", "2c542d": "cisco",
  "344232": "cisco", "4c00821": "cisco", "78da6e": "cisco", "885a92": "cisco",
  "a04a5e": "cisco", "b07d47": "cisco", "c067af": "cisco", "f8c288": "cisco",
};

function normalizeMac(mac: string): string | null {
  const cleaned = mac.replace(/[^0-9a-fA-F]/g, "").toLowerCase();
  if (cleaned.length !== 12) return null;
  return cleaned;
}

function macOuiLookup(mac: string): { vendor: string | null; oui: string | null; source: "local" | "unknown" | "invalid" } {
  const normalized = normalizeMac(mac);
  if (!normalized) return { vendor: null, oui: null, source: "invalid" };
  const oui = normalized.slice(0, 6);
  const vendor = OUI_TABLE[oui] ?? null;
  return { vendor, oui, source: vendor ? "local" : "unknown" };
}

// Helper: resolve concentrator com decrypt embutido
async function loadConcentrator(concentratorId: number) {
  const [c] = await db.select().from(snmpConcentrators).where(eq(snmpConcentrators.id, concentratorId));
  return c || null;
}

// Validação estrita de IP (anti-injection — pingHost interpola string em shell)
const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;
const IPV6_RE = /^[0-9a-fA-F:]+$/; // permissivo mas sem espaços/shell metacaracteres
function isValidIp(ip: string): boolean {
  if (!ip || ip.length > 45) return false;
  if (/[\s;|&`$()<>"'\\]/.test(ip)) return false; // bloqueia metacaracteres
  return IPV4_RE.test(ip) || (ip.includes(":") && IPV6_RE.test(ip));
}

// Sanitiza nome de interface Mikrotik (filtros que vão pra API binária — sem injeção de shell, mas evita lixo)
function sanitizeMikrotikIdentifier(s: string): string {
  return String(s || "").replace(/[^A-Za-z0-9_.\-:<>]/g, "").slice(0, 64);
}

// Trunca strings/buffers profundos no resultado Mikrotik antes de mandar pro LLM
function truncateMikrotikOutput(rows: any[]): any[] {
  return rows.map((r) => {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(r)) {
      if (Buffer.isBuffer(v)) out[k] = `<buffer ${v.length}b>`;
      else if (typeof v === "string" && v.length > 200) out[k] = v.slice(0, 200) + "…";
      else out[k] = v;
    }
    return out;
  });
}

const TOOL_TIMEOUT_MS = 60_000;

async function executeToolSafe(name: string, input: any): Promise<unknown> {
  const start = Date.now();
  try {
    const result = await Promise.race([
      executeTool(name, input),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`tool "${name}" timeout após ${TOOL_TIMEOUT_MS / 1000}s`)),
          TOOL_TIMEOUT_MS,
        ),
      ),
    ]);
    const dur = Date.now() - start;
    if (dur > 5000) console.log(`[AiAnalyst] tool ${name} demorou ${dur}ms`);
    return result;
  } catch (err: any) {
    const dur = Date.now() - start;
    console.warn(`[AiAnalyst] tool ${name} falhou em ${dur}ms: ${err?.message || err}`);
    throw err;
  }
}

async function executeTool(name: string, input: any): Promise<unknown> {
  // -------------------- META --------------------
  if (name === "list_capabilities") {
    return {
      tools: TOOLS.filter((t) => t.name !== "submit_proposal" && t.name !== "list_capabilities").map((t) => ({
        name: t.name,
        description: t.description,
        params: Object.keys((t.input_schema as any).properties || {}),
      })),
      observations: [
        "Use ping_link primeiro pra confirmar problema, depois investigue.",
        "Pra PPPoE, sempre cruze radius_session_by_pppoe + mikrotik_pppoe_active.",
        "Quando OLT não tem leitura óptica, tente get_flashman_cpe (ACS).",
        "Se monitoredIp não responde, descubra o IP real via mikrotik_arp_by_interface (interface = nome do PPPoE) ou radius_session_by_pppoe.framedipaddress.",
        "Monsta é a fonte mais fiel para IP de monitoramento de cliente — quando IP/SNMP em Voalle/OZmap divergir do Monsta, considere o Monsta como verdade. Use monsta_lookup_ip pra validar o IP atual e monsta_search pra localizar o device por contrato/nome (nomes divergem entre sistemas pois o cadastro foi sem critério).",
      ],
    };
  }

  // -------------------- BANCO INTERNO --------------------
  if (name === "search_similar_links") {
    const limit = Math.min(20, Math.max(1, Number(input?.limit) || 10));
    const conditions: any[] = [];
    if (input?.clientId) conditions.push(eq(links.clientId, Number(input.clientId)));
    if (input?.concentratorId) conditions.push(eq(links.concentratorId, Number(input.concentratorId)));
    if (input?.pppoeUserPrefix) conditions.push(sql`${links.pppoeUser} ILIKE ${input.pppoeUserPrefix + "%"}`);
    if (input?.snmpAliasPrefix) conditions.push(sql`${links.snmpInterfaceAlias} ILIKE ${input.snmpAliasPrefix + "%"}`);
    const rows = await db
      .select({
        id: links.id,
        name: links.name,
        clientId: links.clientId,
        concentratorId: links.concentratorId,
        pppoeUser: links.pppoeUser,
        snmpInterfaceAlias: links.snmpInterfaceAlias,
        snmpInterfaceIndex: links.snmpInterfaceIndex,
        monitoredIp: links.monitoredIp,
        oltId: links.oltId,
        slotOlt: links.slotOlt,
        portOlt: links.portOlt,
      })
      .from(links)
      .where(conditions.length > 0 ? and(...conditions) : sql`true`)
      .limit(limit);
    return rows;
  }

  if (name === "get_link_by_id") {
    const link = await storage.getLink(Number(input?.linkId));
    if (!link) return { error: "link não encontrado" };
    return link;
  }

  if (name === "find_link_by_ip") {
    const ip = String(input?.ipAddress || "").trim();
    if (!ip) return { error: "ipAddress obrigatório" };
    const rows = await db
      .select({ id: links.id, name: links.name, clientId: links.clientId, monitoredIp: links.monitoredIp })
      .from(links)
      .where(eq(links.monitoredIp, ip))
      .limit(20);
    return { matches: rows };
  }

  if (name === "find_link_by_pppoe") {
    const u = String(input?.pppoeUser || "").trim();
    if (!u) return { error: "pppoeUser obrigatório" };
    const rows = await db
      .select({ id: links.id, name: links.name, clientId: links.clientId, concentratorId: links.concentratorId, pppoeUser: links.pppoeUser })
      .from(links)
      .where(eq(links.pppoeUser, u))
      .limit(20);
    return { matches: rows };
  }

  if (name === "get_recent_events") {
    const limit = Math.min(100, Math.max(1, Number(input?.limit) || 50));
    const rows = await db
      .select()
      .from(events)
      .where(eq(events.linkId, Number(input?.linkId)))
      .orderBy(desc(events.timestamp))
      .limit(limit);
    return rows;
  }

  // -------------------- PING / TCP --------------------
  if (name === "ping_link") {
    const link = await storage.getLink(Number(input?.linkId));
    if (!link) return { error: "link não encontrado" };
    if (!link.monitoredIp) return { error: "link sem monitoredIp cadastrado" };
    // Faz até 3 rodadas se a primeira falhar — evita falso-negativo transiente
    const attempts: Array<{ latency: number; packetLoss: number; success: boolean }> = [];
    for (let i = 0; i < 3; i++) {
      const r = await pingHost(link.monitoredIp, 5);
      attempts.push(r);
      if (r.success && r.packetLoss < 100) break;
      if (i < 2) await new Promise((res) => setTimeout(res, 1500));
    }
    const best = attempts.reduce((a, b) => (b.packetLoss < a.packetLoss ? b : a));
    return {
      ipAddress: link.monitoredIp,
      ...best,
      attempts: attempts.length,
      note: best.success ? undefined : "3 tentativas executadas — todas falharam",
    };
  }

  if (name === "ping_ip") {
    const ip = String(input?.ipAddress || "").trim();
    if (!isValidIp(ip)) return { error: "ipAddress inválido (precisa ser IPv4/IPv6 sem caracteres especiais)" };
    const count = Math.min(10, Math.max(1, Number(input?.count) || 5));
    const r = await pingHost(ip, count);
    return { ipAddress: ip, ...r };
  }

  if (name === "tcp_port_check") {
    const ip = String(input?.ipAddress || "").trim();
    const port = Number(input?.port);
    if (!isValidIp(ip)) return { error: "ipAddress inválido" };
    if (!Number.isInteger(port) || port < 1 || port > 65535) return { error: "port inválido (1-65535)" };
    const r = await checkTcpPort(ip, port, 3000);
    return { ipAddress: ip, port, ...r };
  }

  // -------------------- MIKROTIK --------------------
  if (name === "mikrotik_arp_by_interface") {
    const c = await loadConcentrator(Number(input?.concentratorId));
    if (!c) return { error: "concentrador não encontrado" };
    const iface = sanitizeMikrotikIdentifier(input?.interface);
    if (!iface) return { error: "interface obrigatória" };
    const res = await executeMikrotikQuery(c, "/ip/arp", { interface: iface }, 50);
    return { rows: truncateMikrotikOutput(res.rows), error: res.error };
  }

  if (name === "mikrotik_route_by_gateway") {
    const c = await loadConcentrator(Number(input?.concentratorId));
    if (!c) return { error: "concentrador não encontrado" };
    const gw = String(input?.gatewayIp || "").trim();
    if (!isValidIp(gw)) return { error: "gatewayIp inválido" };
    const res = await executeMikrotikQuery(c, "/ip/route", { gateway: gw }, 50);
    return { rows: truncateMikrotikOutput(res.rows), error: res.error };
  }

  if (name === "mikrotik_pppoe_active") {
    const c = await loadConcentrator(Number(input?.concentratorId));
    if (!c) return { error: "concentrador não encontrado" };
    const filters: Record<string, string> = {};
    if (input?.username) {
      const u = sanitizeMikrotikIdentifier(input.username);
      if (u) filters.name = u;
    }
    if (input?.ipAddress) {
      const ip = String(input.ipAddress).trim();
      if (!isValidIp(ip)) return { error: "ipAddress inválido" };
      filters.address = ip;
    }
    const res = await executeMikrotikQuery(c, "/ppp/active", filters, 50);
    return { rows: truncateMikrotikOutput(res.rows), error: res.error };
  }

  // -------------------- RADIUS --------------------
  if (name === "radius_session_by_pppoe") {
    const u = String(input?.pppoeUser || "").trim();
    if (!u) return { error: "pppoeUser obrigatório" };
    try {
      const session = await getRadiusSessionByUsername(u);
      const mac = session ? null : await getMacFromRadiusByUsername(u);
      if (!session && !mac) return { found: false, message: "nenhuma sessão ativa nem histórico de MAC" };
      return { found: !!session, session, lastKnownMac: mac };
    } catch (e: any) {
      return { error: `RADIUS indisponível: ${e?.message || e}` };
    }
  }

  if (name === "radius_session_by_ip") {
    const ip = String(input?.ipAddress || "").trim();
    if (!ip) return { error: "ipAddress obrigatório" };
    try {
      const session = await getRadiusSessionByIp(ip);
      if (!session) return { found: false };
      return { found: true, session };
    } catch (e: any) {
      return { error: `RADIUS indisponível: ${e?.message || e}` };
    }
  }

  // -------------------- ACS / FLASHMAN --------------------
  if (name === "get_flashman_cpe") {
    const serial = input?.serial ? String(input.serial) : "";
    const pppoe = input?.pppoeUser ? String(input.pppoeUser) : "";
    if (!serial && !pppoe) return { error: "informe serial ou pppoeUser" };
    try {
      const r = await queryFlashmanOpticalMetrics(serial || "", pppoe || null);
      if (!r) return { found: false, message: "CPE não encontrada no ACS / sem leitura" };
      return { found: true, rxPower: r.rxPower, txPower: r.txPower };
    } catch (e: any) {
      return { error: `Flashman indisponível: ${e?.message || e}` };
    }
  }

  // -------------------- VOALLE --------------------
  if (name === "voalle_search_customer") {
    const q = String(input?.query || "").trim();
    if (!q) return { error: "query obrigatória" };
    try {
      if (!voalleService.isConfigured()) return { error: "Voalle não configurado" };
      const customers = await voalleService.searchCustomers(q);
      return { count: customers.length, customers: customers.slice(0, 10) };
    } catch (e: any) {
      return { error: `Voalle: ${e?.message || e}` };
    }
  }

  if (name === "voalle_get_contracts") {
    const cnpj = String(input?.cnpj || "").replace(/\D/g, "");
    if (!cnpj) return { error: "cnpj obrigatório" };
    try {
      if (!voalleService.isConfigured()) return { error: "Voalle não configurado" };
      const tags = await voalleService.getContractTags(cnpj);
      return { count: tags.length, contractTags: tags.slice(0, 30) };
    } catch (e: any) {
      return { error: `Voalle: ${e?.message || e}` };
    }
  }

  // -------------------- VOALLE (CONEXÃO DETALHADA POR LINK) --------------------
  if (name === "voalle_get_link_connection") {
    const linkId = Number(input?.linkId);
    if (!Number.isFinite(linkId)) return { error: "linkId obrigatório" };
    try {
      const link = await storage.getLink(linkId);
      if (!link) return { error: `link ${linkId} não encontrado` };
      if (!link.voalleConnectionId && !(link as any).voalleContractTagServiceTag && !link.voalleContractTagId) {
        return { available: false, message: "link sem voalleConnectionId/serviceTag/contractTagId — não há como localizar a conexão no Voalle" };
      }
      const client = await storage.getClient(link.clientId);
      if (!client) return { available: false, message: "cliente não encontrado" };
      const voalleIntegration = await storage.getErpIntegrationByProvider("voalle");
      if (!voalleIntegration || !(voalleIntegration as any).isActive) {
        return { available: false, message: "integração Voalle não configurada" };
      }
      const { configureErpAdapter } = await import("./erp");
      const { decrypt } = await import("./crypto");
      const adapter = configureErpAdapter(voalleIntegration as any) as any;
      const voalleCustomerId = (client as any).voalleCustomerId ? String((client as any).voalleCustomerId) : null;
      const portalUsername = (client as any).voallePortalUsername || null;
      let portalPassword: string | null = null;
      try {
        portalPassword = (client as any).voallePortalPassword ? decrypt((client as any).voallePortalPassword) : null;
      } catch {
        portalPassword = null;
      }
      if (!voalleCustomerId || !portalUsername || !portalPassword) {
        return { available: false, message: "cliente sem credenciais do portal Voalle" };
      }
      const result = await adapter.getConnections({ voalleCustomerId, portalUsername, portalPassword });
      if (!result.success || !result.connections?.length) {
        return { available: false, message: result.message || "API Voalle não retornou conexões" };
      }
      let conn: any = null;
      if (link.voalleConnectionId) {
        conn = result.connections.find((c: any) => c.id === link.voalleConnectionId);
      }
      if (!conn && (link as any).voalleContractTagServiceTag) {
        conn = result.connections.find(
          (c: any) => c.contractServiceTag?.serviceTag === (link as any).voalleContractTagServiceTag
        );
      }
      if (!conn && link.voalleContractTagId) {
        conn = result.connections.find((c: any) => c.contractServiceTag?.id === link.voalleContractTagId);
      }
      if (!conn) {
        return {
          available: false,
          message: `conexão não localizada (connectionId=${link.voalleConnectionId ?? "—"}, serviceTag=${(link as any).voalleContractTagServiceTag ?? "—"}, contractTagId=${link.voalleContractTagId ?? "—"})`,
          totalConnectionsForCustomer: result.connections.length,
        };
      }
      // Resolve oltId local a partir do nome do ponto de acesso (se possível)
      let resolvedOltId: number | null = null;
      const accessPointName: string | null = conn.accessPoint?.title || conn.accessPointTitle || null;
      if (accessPointName) {
        try {
          const olts = await storage.getOlts();
          const match = olts.find(
            (o: any) => o.name && accessPointName && o.name.trim().toLowerCase() === accessPointName.trim().toLowerCase()
          );
          if (match) resolvedOltId = match.id;
        } catch {
          /* ignore */
        }
      }
      return {
        available: true,
        voalleConnectionId: conn.id,
        contractId: conn.contractId ?? conn.contract?.id ?? null,
        active: conn.active ?? null,
        equipmentSerialNumber: conn.equipmentSerialNumber ?? null,
        slotOlt: conn.slotOlt ?? null,
        portOlt: conn.portOlt ?? null,
        accessPointName,
        resolvedOltId,
        splitterName: conn.authenticationSplitter?.title ?? null,
        splitterPort: conn.authenticationSplitter?.port ?? null,
        concentratorName: conn.concentrator?.title ?? conn.concentratorTitle ?? null,
        monitoredIp: conn.authenticationIp ?? conn.ipAddress ?? null,
        contractServiceTagId: conn.contractServiceTag?.id ?? null,
        contractServiceTag: conn.contractServiceTag?.serviceTag ?? null,
        address: [conn.streetType, conn.street, conn.number, conn.neighborhood].filter(Boolean).join(" "),
      };
    } catch (e: any) {
      return { error: `voalle_get_link_connection: ${e?.message || e}` };
    }
  }

  // -------------------- VOALLE (SOLICITAÇÕES / TICKETS DO ERP) --------------------
  if (
    name === "voalle_list_link_solicitations" ||
    name === "voalle_get_solicitation_details" ||
    name === "voalle_get_solicitation_history"
  ) {
    const linkId = Number(input?.linkId);
    if (!Number.isFinite(linkId)) return { error: "linkId obrigatório" };
    try {
      const link = await storage.getLink(linkId);
      if (!link) return { error: `link ${linkId} não encontrado` };
      const client = await storage.getClient(link.clientId);
      if (!client) return { error: "cliente não encontrado" };

      const voalleIntegration = await storage.getErpIntegrationByProvider("voalle");
      if (!voalleIntegration || !(voalleIntegration as any).isActive) {
        return { available: false, message: "integração Voalle não configurada" };
      }

      // Resolve voalleCustomerId (mesmo fluxo das rotas /voalle/solicitations*)
      let voalleCustomerId: number | null = (client as any).voalleCustomerId ?? null;
      if (!voalleCustomerId) {
        const mapping = await storage.getClientErpMapping(link.clientId, (voalleIntegration as any).id);
        if (mapping) voalleCustomerId = parseInt((mapping as any).erpCustomerId, 10) || null;
      }
      if (!voalleCustomerId) {
        return { available: false, message: "cliente sem vínculo Voalle (voalleCustomerId)" };
      }

      const { configureErpAdapter } = await import("./erp");
      const adapter = configureErpAdapter(voalleIntegration as any) as any;

      // Helpers compartilhados: mesma classificação de status e mesma lógica
      // de filtro/enrichment usadas pelas rotas REST. Importados de módulo
      // dedicado (sem ciclo com routes.ts).
      const {
        applyVoalleSolicitationFilter,
        partitionByStatus,
      } = await import("./voalle-solicitations-filter");

      // ===== voalle_list_link_solicitations =====
      if (name === "voalle_list_link_solicitations") {
        if (typeof adapter.getOpenSolicitations !== "function") {
          return { error: "Adapter Voalle não suporta busca de solicitações" };
        }
        const includeClosed = !!input?.includeClosed;
        const allAssignments = includeClosed; // se queremos encerradas, precisa allAssignments=true
        const all = await adapter.getOpenSolicitations(voalleCustomerId, allAssignments);

        // PASSO 1: separa abertas vs encerradas pela mesma allowlist da UI.
        const { open: openAll, closed: closedAll, unknownStatuses } = partitionByStatus(all);
        if (unknownStatuses.size > 0) {
          console.warn(`[AiAnalyst Voalle] Status desconhecidos: ${Array.from(unknownStatuses).join(", ")}`);
        }

        // PASSO 2: aplica filtro+enrichment SEPARADAMENTE em cada subgrupo —
        // mesma ordem da rota /voalle/solicitations/closed (filtra status antes
        // do filtro por link). Isso garante que o enrichment dispare quando o
        // inline zerar dentro do escopo certo.
        const { matched: matchedOpen, fallbackUngranular: openFallback } =
          await applyVoalleSolicitationFilter(
            openAll,
            link as any,
            adapter,
            "[AiAnalyst Voalle Open]",
          );

        const matchedOpenIds = new Set((matchedOpen as any[]).map((s) => s.id));
        const openOwn: any[] = openFallback ? openAll : (matchedOpen as any[]);
        const openOther: any[] = openFallback
          ? []
          : openAll.filter((s: any) => !matchedOpenIds.has(s.id));

        const result: any = {
          available: true,
          clientName: (client as any).name,
          voalleCustomerId,
          fallbackUngranular: openFallback,
          open: openOwn.slice(0, 30),
          openCount: openOwn.length,
          otherOpen: openOther.slice(0, 30),
          otherOpenCount: openOther.length,
        };

        if (includeClosed) {
          const { matched: matchedClosed, fallbackUngranular: closedFallback } =
            await applyVoalleSolicitationFilter(
              closedAll,
              link as any,
              adapter,
              "[AiAnalyst Voalle Closed]",
            );
          const closedBase: any[] = closedFallback ? closedAll : (matchedClosed as any[]);
          const top3Closed = closedBase
            .slice()
            .sort((a: any, b: any) => {
              const da = a.closedAt ? Date.parse(a.closedAt) : a.createdAt ? Date.parse(a.createdAt) : 0;
              const db = b.closedAt ? Date.parse(b.closedAt) : b.createdAt ? Date.parse(b.createdAt) : 0;
              return db - da;
            })
            .slice(0, 3);
          result.closed = top3Closed;
          result.closedCount = closedBase.length;
          result.closedFallbackUngranular = closedFallback;
        }

        return result;
      }

      // ===== voalle_get_solicitation_details / _history (com IDOR check) =====
      const assignmentId = Number(input?.assignmentId);
      if (!Number.isFinite(assignmentId)) return { error: "assignmentId obrigatório" };

      if (typeof adapter.getOpenSolicitations !== "function") {
        return { error: "Adapter Voalle não suporta validação de assignment" };
      }

      // IDOR: assignmentId precisa pertencer ao cliente Voalle deste link.
      const customerSolicitations = await adapter.getOpenSolicitations(voalleCustomerId, true);
      const belongs = Array.isArray(customerSolicitations)
        && customerSolicitations.some((s: any) => s && s.id === assignmentId);
      if (!belongs) {
        return {
          error: `assignmentId=${assignmentId} não pertence ao cliente Voalle ${voalleCustomerId} deste link`,
        };
      }

      if (name === "voalle_get_solicitation_details") {
        if (typeof adapter.getSolicitationData !== "function") {
          return { error: "Adapter Voalle não suporta detalhes" };
        }
        const details = await adapter.getSolicitationData(assignmentId);
        return { available: true, assignmentId, details };
      }

      // voalle_get_solicitation_history
      if (typeof adapter.getSolicitationHistory !== "function") {
        return { error: "Adapter Voalle não suporta relatos" };
      }
      const history = await adapter.getSolicitationHistory(assignmentId);
      return { available: true, assignmentId, history, count: Array.isArray(history) ? history.length : 0 };
    } catch (e: any) {
      return { error: `${name}: ${e?.message || e}` };
    }
  }

  // -------------------- OLT (CLI via SSH/Telnet) --------------------
  if (name === "olt_search_onu_by_serial") {
    const serial = String(input?.serial || "").trim();
    if (!serial) return { error: "serial obrigatório" };
    const oltIdHint = input?.oltId ? Number(input.oltId) : null;
    try {
      const { searchOnuBySerial } = await import("./olt");
      // Lista de OLTs candidatas
      const allOlts = await storage.getOlts();
      const candidates = oltIdHint
        ? allOlts.filter((o: any) => o.id === oltIdHint)
        : allOlts.filter((o: any) => o.isActive !== false);
      if (candidates.length === 0) {
        return { found: false, message: oltIdHint ? `OLT ${oltIdHint} não encontrada` : "nenhuma OLT ativa cadastrada" };
      }
      const attempts: Array<{ oltId: number; oltName: string; message: string }> = [];
      for (const olt of candidates) {
        try {
          const r = await searchOnuBySerial(olt as any, serial);
          if (r.success && r.onuId) {
            return {
              found: true,
              oltId: olt.id,
              oltName: olt.name,
              onuId: r.onuId,
              slotOlt: r.slotOlt ?? null,
              portOlt: r.portOlt ?? null,
              message: r.message,
            };
          }
          attempts.push({ oltId: olt.id, oltName: olt.name, message: r.message || "não encontrada" });
        } catch (e: any) {
          attempts.push({ oltId: olt.id, oltName: olt.name, message: `erro: ${e?.message || e}` });
        }
      }
      return {
        found: false,
        message: `serial "${serial}" não encontrado em ${candidates.length} OLT(s)`,
        attempts: attempts.slice(0, 10),
      };
    } catch (e: any) {
      return { error: `olt_search_onu_by_serial: ${e?.message || e}` };
    }
  }

  // -------------------- MONSTA --------------------
  if (name === "monsta_lookup_ip") {
    const ip = String(input?.ip || "").trim();
    if (!isValidIp(ip)) return { error: "ip inválido" };
    return await monsta.getDeviceStatus(ip);
  }

  if (name === "monsta_search") {
    const pattern = String(input?.pattern || "").trim();
    if (!pattern) return { error: "pattern obrigatório" };
    const limit = Math.min(50, Math.max(1, Number(input?.limit) || 10));
    return await monsta.searchDevices(pattern, limit);
  }

  if (name === "monsta_get_events") {
    const ip = String(input?.ip || "").trim();
    if (!isValidIp(ip)) return { error: "ip inválido" };
    const hours = Math.min(168, Math.max(1, Number(input?.hours) || 24));
    const limit = Math.min(200, Math.max(1, Number(input?.limit) || 50));
    return await monsta.getRecentEvents(ip, hours, limit);
  }

  if (name === "mac_oui_lookup") {
    const mac = String(input?.mac || "").trim();
    if (!mac) return { error: "mac inválido" };
    return macOuiLookup(mac);
  }

  return { error: `ferramenta desconhecida: ${name}` };
}

function buildUserPrompt(ctx: LinkContext): string {
  const link = ctx.link;
  const linkSummary = {
    id: link.id,
    name: link.name,
    clientId: link.clientId,
    linkType: link.linkType,
    authType: link.authType,
    monitoredIp: link.monitoredIp,
    pppoeUser: link.pppoeUser,
    concentratorId: link.concentratorId,
    snmpInterfaceIndex: link.snmpInterfaceIndex,
    snmpInterfaceAlias: link.snmpInterfaceAlias,
    snmpInterfaceName: link.snmpInterfaceName,
    snmpProfileId: link.snmpProfileId,
    oltId: link.oltId,
    slotOlt: link.slotOlt,
    portOlt: link.portOlt,
    onuId: link.onuId,
    equipmentSerialNumber: (link as any).equipmentSerialNumber ?? null,
    equipmentVendorId: (link as any).equipmentVendorId ?? null,
    equipmentModel: (link as any).equipmentModel ?? null,
    voalleContractTagId: link.voalleContractTagId,
    voalleConnectionId: (link as any).voalleConnectionId ?? null,
    contractStatus: (link as any).contractStatus,
    // Status técnico Voalle sincronizado de hora em hora via /external/map/connection/all
    // e /external/map/connection/all/deleted.
    // Valores: "normal" | "blocked" | "block_warning" | "maintenance_warning" | "deleted" | "unknown"
    // Distinto de contractStatus (comercial).
    // - "blocked": bloqueio técnico no Voalle — confirme com voalle_get_contracts.
    // - "deleted": a conexão foi EXCLUÍDA no Voalle (contrato cancelado/conexão removida).
    //   É evidência muito forte de que o link não deveria mais existir no monitoramento;
    //   considere desativação permanente (monitoringEnabled=false) após confirmar.
    voalleConnectionStatus: (link as any).voalleConnectionStatus ?? "unknown",
    voalleConnectionStatusUpdatedAt: (link as any).voalleConnectionStatusUpdatedAt ?? null,
    monitoringEnabled: (link as any).monitoringEnabled,
  };

  const opticalLine = (() => {
    const o = ctx.recentMetricsSummary;
    if (o.lastOpticalRx == null && o.lastOpticalTx == null && o.lastOpticalOltRx == null) {
      return "sem leitura óptica recente (OLT pode não estar coletando — considere fallback ACS via get_flashman_cpe)";
    }
    return `RX=${o.lastOpticalRx ?? "—"}dBm, TX=${o.lastOpticalTx ?? "—"}dBm, OLT_RX=${o.lastOpticalOltRx ?? "—"}dBm`;
  })();

  return [
    "## LINK SOB INVESTIGAÇÃO",
    "```json",
    JSON.stringify(linkSummary, null, 2),
    "```",
    "",
    "## CLIENTE",
    ctx.client ? `${ctx.client.name} (id=${ctx.client.id}, cnpj=${ctx.client.cnpj || "não cadastrado"})` : "_não encontrado_",
    "",
    "## EVENTOS RECENTES (últimos 15)",
    ctx.recentEvents.length === 0
      ? "_nenhum_"
      : ctx.recentEvents.map((e) => `- [${e.createdAt.toISOString()}] ${e.type}: ${e.description}`).join("\n"),
    "",
    "## MÉTRICAS — ÚLTIMAS 24h",
    `samples=${ctx.recentMetricsSummary.samples}, avgLatency=${ctx.recentMetricsSummary.avgLatency.toFixed(1)}ms, avgPacketLoss=${ctx.recentMetricsSummary.avgPacketLoss.toFixed(2)}%, lastStatus=${ctx.recentMetricsSummary.lastStatus}`,
    `Última leitura óptica: ${opticalLine}`,
    "",
    "## CONCENTRADOR",
    ctx.concentrator ? JSON.stringify(ctx.concentrator) : "_não associado_",
    "",
    "## OLT",
    ctx.olt ? JSON.stringify(ctx.olt) : "_não associada_",
    "",
    "## LINKS SIMILARES (mesmo cliente/concentrador, com PPPoE ou alias preenchido)",
    ctx.similarLinks.length === 0
      ? "_nenhum_"
      : "```json\n" + JSON.stringify(ctx.similarLinks, null, 2) + "\n```",
    "",
    "## REGRAS ATIVAS DOS ANALISTAS (siga estritamente)",
    ctx.rules.length === 0
      ? "_nenhuma cadastrada_"
      : ctx.rules
          .sort((a, b) => b.priority - a.priority)
          .map((r, i) => `${i + 1}. (prio ${r.priority}) ${r.ruleText}`)
          .join("\n"),
    "",
    "## CORREÇÕES RECENTES (humanos editaram suas propostas anteriores — aprenda com isso)",
    ctx.recentCorrections.length === 0
      ? "_nenhuma_"
      : ctx.recentCorrections
          .map((c) => `- campo "${c.fieldName}": IA propôs ${JSON.stringify(c.aiValue)}, humano corrigiu para ${JSON.stringify(c.userValue)}${c.userNote ? ` (nota: ${c.userNote})` : ""}`)
          .join("\n"),
    "",
    "## PROPOSTAS REJEITADAS RECENTES (humanos rejeitaram — entenda o motivo e NÃO repita o mesmo erro)",
    ctx.recentRejections.length === 0
      ? "_nenhuma_"
      : ctx.recentRejections
          .map((r) => `- ${r.classification} (campos: ${JSON.stringify(r.proposedFields)}) — motivo da rejeição: "${r.reviewerNote}"`)
          .join("\n"),
    "",
    "## PENDÊNCIAS DISPENSADAS PELO OPERADOR (auditoria automática sugeriu, humano disse NÃO se aplica)",
    ctx.recentDismissals.length === 0
      ? "_nenhuma_"
      : ctx.recentDismissals
          .map((d) => `- campo "${d.field}" (sugestão "${d.suggestedAction}"): operador dispensou — "${d.dismissalNote}"`)
          .join("\n"),
    "",
    "Investigue e ao final chame submit_proposal com sua decisão. Se houver rejeições/dispensas semelhantes ao caso atual, considere fortemente o motivo informado pelo operador antes de propor algo similar.",
  ].join("\n");
}

async function runLlmInvestigation(ctx: LinkContext): Promise<LlmResult> {
  const settings = await storage.getAiAnalystSettings();
  const apiKey = resolveAnthropicApiKey(settings.apiKeyEncrypted);

  if (!apiKey) {
    return {
      classification: "inconclusive",
      proposedFields: {},
      reasoning:
        "Chave da Anthropic não configurada (defina ANTHROPIC_API_KEY no ambiente ou cadastre via aba Analista IA → Configurações). " +
        `Contexto coletado: ${ctx.recentEvents.length} eventos, ${ctx.recentMetricsSummary.samples} métricas, ` +
        `${ctx.similarLinks.length} links similares, ${ctx.rules.length} regras.`,
      confidence: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      modelUsed: "stub-no-key",
      toolCalls: [],
    };
  }

  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  // Timeout de 90s por request — evita task ficar pendurada infinitamente
  // se a API da Anthropic engasgar. SDK fará 2 retries automáticos.
  const client = new Anthropic({ apiKey, timeout: 90_000, maxRetries: 2 });
  const model = settings.model || DEFAULT_MODEL;
  const pricing = MODEL_PRICING[model] || MODEL_PRICING[DEFAULT_MODEL];

  // Prompt caching: marca o user prompt inicial (contexto pesado do link) como cacheable.
  // O cache da Anthropic é "ephemeral" (~5min), perfeito para reutilizar entre as iterações
  // da MESMA task. Reads de cache custam ~10% do preço normal de input.
  const messages: any[] = [
    {
      role: "user",
      content: [
        { type: "text", text: buildUserPrompt(ctx), cache_control: { type: "ephemeral" } },
      ],
    },
  ];
  // Tools também são grandes (schemas) — cacheia o último bloco para cobrir todas
  const toolsWithCache: any[] = TOOLS.map((t, i) =>
    i === TOOLS.length - 1 ? { ...t, cache_control: { type: "ephemeral" } } : t,
  );
  const toolCalls: LlmResult["toolCalls"] = [];
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheCreate = 0;
  let totalCacheRead = 0;
  let finalProposal: any = null;
  let lastAssistantText = "";
  const MAX_ITERATIONS = 12;

  console.log(`[AiAnalyst] LLM start link=${ctx.link.id} model=${model} (timeout=90s, maxIter=${MAX_ITERATIONS}, cache=on)`);

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const isLastIteration = iter === MAX_ITERATIONS - 1;
    // System como array de blocos com cache_control no SYSTEM_PROMPT (estático, alto hit rate)
    const systemBlocks: any[] = [
      { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
    ];
    if (isLastIteration) {
      systemBlocks.push({
        type: "text",
        text: "\n\n⚠️ ATENÇÃO: esta é sua ÚLTIMA chance. Você JÁ NÃO PODE chamar mais ferramentas de investigação. Submeta a proposta final agora com submit_proposal, mesmo que seja 'inconclusive' com confidence baixa. Use o que você descobriu até aqui.",
      });
    }
    const requestParams: any = {
      model,
      max_tokens: 2048,
      system: systemBlocks,
      tools: toolsWithCache,
      messages,
    };
    if (isLastIteration) {
      requestParams.tool_choice = { type: "tool", name: "submit_proposal" };
    }
    const iterStart = Date.now();
    const response = await client.messages.create(requestParams);
    const cacheCreate = (response.usage as any)?.cache_creation_input_tokens || 0;
    const cacheRead = (response.usage as any)?.cache_read_input_tokens || 0;
    totalCacheCreate += cacheCreate;
    totalCacheRead += cacheRead;
    console.log(`[AiAnalyst] LLM iter=${iter + 1}/${MAX_ITERATIONS} link=${ctx.link.id} latency=${Date.now() - iterStart}ms in=${response.usage?.input_tokens || 0} out=${response.usage?.output_tokens || 0} cacheW=${cacheCreate} cacheR=${cacheRead}`);

    totalInput += response.usage?.input_tokens || 0;
    totalOutput += response.usage?.output_tokens || 0;

    // Encontra blocos tool_use; preserva text intermediário pra fallback
    const toolUses = response.content.filter((b: any) => b.type === "tool_use") as any[];
    const textNow = (response.content.filter((b: any) => b.type === "text") as any[])
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (textNow) lastAssistantText = textNow;

    if (toolUses.length === 0) {
      // Modelo parou sem chamar submit_proposal — encerra com inconclusive
      const textBlocks = response.content.filter((b: any) => b.type === "text") as any[];
      const text = textBlocks.map((b) => b.text).join("\n").slice(0, 800);
      finalProposal = {
        classification: "inconclusive",
        proposedFields: {},
        reasoning: text || "Modelo encerrou sem submeter proposta estruturada.",
        confidence: 0,
      };
      break;
    }

    // Adiciona resposta do assistant ao histórico
    messages.push({ role: "assistant", content: response.content });

    const toolResults: any[] = [];
    let stopAfterTools = false;

    for (const tu of toolUses) {
      if (tu.name === "submit_proposal") {
        finalProposal = tu.input;
        toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: "ok" });
        stopAfterTools = true;
      } else {
        const start = Date.now();
        let output: unknown;
        try {
          output = await executeToolSafe(tu.name, tu.input);
        } catch (err: any) {
          output = { error: err.message };
        }
        const durationMs = Date.now() - start;
        toolCalls.push({ tool: tu.name, input: tu.input, output, durationMs });
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: JSON.stringify(output).slice(0, 8000),
        });
      }
    }

    messages.push({ role: "user", content: toolResults });
    if (stopAfterTools) break;
  }

  if (!finalProposal) {
    const toolsSummary = toolCalls.length > 0
      ? `\n\nFerramentas chamadas (${toolCalls.length}): ${toolCalls.map((t) => t.tool).join(", ")}`
      : "";
    const reasoningParts = [
      `Limite de ${MAX_ITERATIONS} iterações atingido sem submit_proposal.`,
      lastAssistantText ? `\n\nÚltimo raciocínio do modelo:\n${lastAssistantText}` : "",
      toolsSummary,
    ].filter(Boolean).join("");
    finalProposal = {
      classification: "inconclusive",
      proposedFields: {},
      reasoning: reasoningParts,
      confidence: 0,
    };
  }

  // Sanitiza proposedFields contra a whitelist (defesa em profundidade — applyProposal também filtra)
  const cleanFields: Record<string, unknown> = {};
  if (finalProposal.proposedFields && typeof finalProposal.proposedFields === "object") {
    for (const [k, v] of Object.entries(finalProposal.proposedFields)) {
      if (ALLOWED_FIELDS.has(k)) {
        cleanFields[k] = v;
      } else if (k === "defaultCpe") {
        const sanitized = sanitizeDefaultCpe(v);
        if (sanitized) cleanFields[k] = sanitized;
      } else if (k === "oltSnmpEnable") {
        const sanitized = sanitizeOltSnmpEnable(v);
        if (sanitized) cleanFields[k] = sanitized;
      }
    }
  }

  const costUsd =
    (totalInput / 1_000_000) * pricing.input + (totalOutput / 1_000_000) * pricing.output;

  return {
    classification: ["config_error", "network_issue", "inconclusive"].includes(finalProposal.classification)
      ? finalProposal.classification
      : "inconclusive",
    proposedFields: cleanFields,
    reasoning: String(finalProposal.reasoning || "").slice(0, 4000),
    confidence: Math.max(0, Math.min(100, Math.round(Number(finalProposal.confidence) || 0))),
    inputTokens: totalInput,
    outputTokens: totalOutput,
    costUsd,
    modelUsed: model,
    toolCalls,
  };
}

// =====================================================================
// Processamento de tasks
// =====================================================================

let isProcessing = false;
let isProcessingSince: number | null = null;
const PROCESS_LOCK_TIMEOUT_MS = 10 * 60 * 1000; // 10 min — auto-libera se travou

export function forceReleaseProcessingLock(reason: string): void {
  if (isProcessing) {
    console.warn(`[AiAnalyst] forçando liberação do mutex de processamento: ${reason}`);
  }
  isProcessing = false;
  isProcessingSince = null;
}

export async function processNextTask(): Promise<{ processed: boolean; proposalId?: number; error?: string }> {
  // Auto-recovery: se o mutex está preso há mais que o timeout, libera
  if (isProcessing && isProcessingSince && Date.now() - isProcessingSince > PROCESS_LOCK_TIMEOUT_MS) {
    forceReleaseProcessingLock(`travado há ${Math.round((Date.now() - isProcessingSince) / 60000)}min`);
  }
  if (isProcessing) return { processed: false, error: "another task already in progress" };
  isProcessing = true;
  isProcessingSince = Date.now();
  try {
    // Recovery cross-restart: se houver tasks órfãs em "investigating" há > 15min,
    // reenvia pra fila antes de pegar a próxima
    try {
      await storage.reclaimStuckAiAnalystTasks(15, 2);
    } catch (err: any) {
      console.warn(`[AiAnalyst] reclaimStuckAiAnalystTasks falhou: ${err?.message || err}`);
    }
    const task = await storage.getNextPendingAiAnalystTask();
    if (!task) return { processed: false };

    // Marca como em investigação
    await storage.updateAiAnalystTask(task.id, { status: "investigating", startedAt: new Date() });
    console.log(`[AiAnalyst] Iniciando task ${task.id} (link=${task.linkId}, motivo=${task.triggerReason}, prio=${task.priority})`);

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

    // Sanitiza proposedFields: só campos da whitelist + campo virtual defaultCpe
    const sanitizedFields: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(llmResult.proposedFields)) {
      if (ALLOWED_FIELDS.has(k)) {
        sanitizedFields[k] = v;
      } else if (k === "defaultCpe") {
        const sanitized = sanitizeDefaultCpe(v);
        if (sanitized) sanitizedFields[k] = sanitized;
      } else if (k === "oltSnmpEnable") {
        const sanitized = sanitizeOltSnmpEnable(v);
        if (sanitized) sanitizedFields[k] = sanitized;
      }
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
    isProcessingSince = null;
  }
}

// =====================================================================
// Aplicar proposta (com possibilidade de edição manual antes)
// =====================================================================

// Sanitiza um payload de defaultCpe vindo da IA ou do humano.
// Retorna null se inválido ou se nada útil foi passado.
function sanitizeDefaultCpe(raw: unknown): {
  ip: string;
  vendor?: string;
  mac?: string;
  replaceExisting?: boolean;
} | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const ip = typeof r.ip === "string" ? r.ip.trim() : "";
  if (!isValidIp(ip)) return null;
  const out: any = { ip };
  if (typeof r.vendor === "string" && r.vendor.trim()) {
    const v = r.vendor.trim().toLowerCase();
    if (/^[a-z0-9_\-]{2,40}$/.test(v)) out.vendor = v;
  }
  if (typeof r.mac === "string" && r.mac.trim()) {
    const normalized = normalizeMac(r.mac);
    if (normalized) {
      out.mac = normalized.match(/.{2}/g)!.join(":").toUpperCase();
    }
  }
  if (r.replaceExisting === true) out.replaceExisting = true;
  return out;
}

// Sanitiza um payload de oltSnmpEnable.
// Retorna null se inválido. chassis é opcional (default 1).
function sanitizeOltSnmpEnable(raw: unknown): { enable: true; chassis?: number } | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.enable !== true) return null;
  const out: { enable: true; chassis?: number } = { enable: true };
  if (typeof r.chassis === "number" && Number.isInteger(r.chassis) && r.chassis >= 1 && r.chassis <= 8) {
    out.chassis = r.chassis;
  }
  return out;
}

// Aplica a ação especial oltSnmpEnable: roda SSH na OLT Datacom para habilitar
// "snmp all" no provisionamento da ONU. Lê slot/port/onuId direto do link.
async function applyOltSnmpEnable(
  link: Link,
  rawPayload: unknown,
): Promise<{ action: string; ok?: boolean; chassis?: number; slot?: number; port?: number; onuId?: string; error?: string; rawTail?: string }> {
  const payload = sanitizeOltSnmpEnable(rawPayload);
  if (!payload) return { action: "skipped_invalid_payload" };
  if (!link.oltId) return { action: "skipped_no_olt", error: "link.oltId vazio" };
  if (link.slotOlt == null || link.portOlt == null || !link.onuId) {
    return { action: "skipped_missing_position", error: "link.slotOlt/portOlt/onuId não preenchidos" };
  }

  const olt = await storage.getOlt(link.oltId);
  if (!olt) return { action: "skipped_olt_not_found", error: `OLT id=${link.oltId} não existe` };

  const { enableDatacomOnuSnmpAll } = await import("./olt");
  const chassis = payload.chassis ?? 1;
  const result = await enableDatacomOnuSnmpAll(olt, link.slotOlt, link.portOlt, link.onuId, chassis);

  return {
    action: result.ok ? "executed" : "failed",
    ok: result.ok,
    chassis,
    slot: link.slotOlt,
    port: link.portOlt,
    onuId: link.onuId,
    error: result.errorReason,
    rawTail: result.rawOutput?.slice(-800),
  };
}

// Aplica a ação especial defaultCpe: cria/atualiza CPE padrão associada ao link.
// Idempotente — se já existir CPE padrão associada e replaceExisting != true,
// só atualiza o ipOverride/macAddress sem mexer na CPE em si.
async function applyDefaultCpe(
  link: Link,
  rawPayload: unknown,
  reviewerUserId?: number,
): Promise<{ action: string; cpeId?: number; linkCpeId?: number; vendorSlug?: string }> {
  const payload = sanitizeDefaultCpe(rawPayload);
  if (!payload) return { action: "skipped_invalid_payload" };

  // Resolve vendor: tenta achar por slug; se não existir, segue sem vendorId.
  let vendorId: number | undefined = undefined;
  let resolvedVendorSlug: string | undefined = undefined;
  if (payload.vendor) {
    const v = await storage.getEquipmentVendorBySlug(payload.vendor);
    if (v) {
      vendorId = v.id;
      resolvedVendorSlug = v.slug;
    } else {
      resolvedVendorSlug = payload.vendor; // não existe ainda, mas devolvemos pra audit
    }
  }

  // Verifica CPEs já associadas ao link.
  const existingAssocs = await storage.getLinkCpes(link.id);
  // Procura primeiro por CPE padrão (isStandard=true). Se não tiver, usa qualquer CPE primária.
  const standardAssoc = existingAssocs.find((a) => a.cpe.isStandard);
  const primaryAssoc = standardAssoc || existingAssocs.find((a) => a.role === "primary") || existingAssocs[0];

  // Caso 1: já existe CPE associada
  if (primaryAssoc) {
    // Atualiza ipOverride e mac (sem trocar a CPE) — comportamento padrão e seguro
    const updates: any = { ipOverride: payload.ip };
    if (payload.mac) updates.macAddress = payload.mac;
    await storage.updateLinkCpe(primaryAssoc.id, updates);

    // Atualiza vendorId da CPE só se a CPE for padrão e estiver sem vendor — não sobrescreve cadastro existente
    if (primaryAssoc.cpe.isStandard && vendorId && !primaryAssoc.cpe.vendorId) {
      await storage.updateCpe(primaryAssoc.cpe.id, { vendorId });
    }
    return {
      action: "updated_existing",
      cpeId: primaryAssoc.cpe.id,
      linkCpeId: primaryAssoc.id,
      vendorSlug: resolvedVendorSlug,
    };
  }

  // Caso 2: não existe associação — cria CPE padrão e associa ao link
  // Se houver vendor, tenta reusar uma CPE padrão existente do mesmo fabricante (evita duplicar)
  let cpeId: number | undefined;
  if (vendorId) {
    const existing = await storage.getStandardCpeByVendor(vendorId);
    if (existing) cpeId = existing.id;
  }
  if (!cpeId) {
    const cpeName = vendorId
      ? `CPE padrão ${resolvedVendorSlug}`
      : `CPE padrão (auto)`;
    const newCpe = await storage.createCpe({
      name: cpeName,
      type: "cpe",
      vendorId: vendorId ?? null,
      isStandard: true,
      hasAccess: true,
      ownership: "marvitel",
    } as any);
    cpeId = newCpe.id;
  }

  const assoc = await storage.addCpeToLink({
    linkId: link.id,
    cpeId: cpeId!,
    role: "primary",
    ipOverride: payload.ip,
    macAddress: payload.mac ?? null,
    showInEquipmentTab: true,
  } as any);

  return {
    action: "created",
    cpeId,
    linkCpeId: assoc.id,
    vendorSlug: resolvedVendorSlug,
  };
}

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

  // Separa: campos da whitelist vão pro update do link; defaultCpe é ação especial.
  const safeFields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(finalFields)) {
    if (ALLOWED_FIELDS.has(k)) safeFields[k] = v;
  }

  // Detecta correções (campos onde o usuário mudou em relação ao que a IA propôs)
  const corrections: InsertAiAnalystCorrection[] = [];
  if (overrideFields) {
    for (const [k, userVal] of Object.entries(overrideFields)) {
      if (!ALLOWED_FIELDS.has(k) && k !== "defaultCpe" && k !== "oltSnmpEnable") continue;
      const aiVal = aiFields[k];
      if (JSON.stringify(aiVal) !== JSON.stringify(userVal)) {
        corrections.push({
          proposalId: proposal.id,
          linkId: link.id,
          fieldName: k,
          aiValue: aiVal != null ? (typeof aiVal === "object" ? JSON.stringify(aiVal) : String(aiVal)) : null,
          userValue: userVal != null ? (typeof userVal === "object" ? JSON.stringify(userVal) : String(userVal)) : null,
          userNote: reviewerNote ?? null,
          correctedByUserId: reviewerUserId ?? null,
        } as any);
      }
    }
  }

  // Detecta transições de monitoringEnabled — replicar a lógica do PATCH /api/links/:id
  // (auto-resolver eventos e zerar status quando desativa; limpar pausa quando reabilita)
  const monitoringDisabledNow = (
    "monitoringEnabled" in safeFields &&
    safeFields.monitoringEnabled === false &&
    link.monitoringEnabled === true
  );
  const monitoringReenabledNow = (
    "monitoringEnabled" in safeFields &&
    safeFields.monitoringEnabled === true &&
    link.monitoringEnabled === false
  );
  if (monitoringDisabledNow) {
    (safeFields as any).status = "unknown";
    (safeFields as any).failureReason = null;
    (safeFields as any).failureSource = null;
  }
  if (monitoringReenabledNow) {
    // Reabilitação manual via aprovação da IA: limpa pausa
    (safeFields as any).monitoringPausedReason = null;
    (safeFields as any).monitoringAutoResume = false;
  }

  // Aplica os campos
  if (Object.keys(safeFields).length > 0) {
    await storage.updateLink(link.id, safeFields as any);
  }

  // Pós-update: resolve eventos abertos quando monitoramento foi desativado
  if (monitoringDisabledNow) {
    try {
      const { events: eventsTable } = await import("@shared/schema");
      const resolvedRows = await db.update(eventsTable)
        .set({ resolved: true, resolvedAt: new Date() })
        .where(and(eq(eventsTable.linkId, link.id), eq(eventsTable.resolved, false)))
        .returning({ id: eventsTable.id });
      console.log(`[ai-analyst] Link ${link.id}: monitoramento desativado via IA — ${resolvedRows.length} eventos abertos foram resolvidos.`);
    } catch (err) {
      console.error("[ai-analyst] falha ao resolver eventos do link desativado:", err);
    }
  }

  // Ação especial: defaultCpe (cria/atualiza CPE padrão associada ao link)
  let cpeAction: { action: string; cpeId?: number; linkCpeId?: number; vendorSlug?: string } | null = null;
  const defaultCpeRaw = (finalFields as any).defaultCpe;
  if (defaultCpeRaw && typeof defaultCpeRaw === "object") {
    try {
      cpeAction = await applyDefaultCpe(link, defaultCpeRaw, reviewerUserId);
    } catch (err: any) {
      console.error("[ai-analyst] applyDefaultCpe falhou:", err?.message);
      cpeAction = { action: "error", vendorSlug: err?.message };
    }
  }

  // Ação especial: oltSnmpEnable (executa SSH na OLT Datacom para habilitar snmp all na ONU)
  let oltSnmpAction: any = null;
  const oltSnmpRaw = (finalFields as any).oltSnmpEnable;
  if (oltSnmpRaw && typeof oltSnmpRaw === "object") {
    try {
      oltSnmpAction = await applyOltSnmpEnable(link, oltSnmpRaw);
    } catch (err: any) {
      console.error("[ai-analyst] applyOltSnmpEnable falhou:", err?.message);
      oltSnmpAction = { action: "error", error: err?.message };
    }
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
        ...(cpeAction ? { cpeAction } : {}),
        ...(oltSnmpAction ? { oltSnmpAction } : {}),
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

// =====================================================================
// Processamento em lote (background loop com progresso polável)
// =====================================================================

interface BatchState {
  running: boolean;
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  startedAt: Date | null;
  finishedAt: Date | null;
  stopRequested: boolean;
  lastError: string | null;
  lastProposalId: number | null;
}

const batchState: BatchState = {
  running: false,
  total: 0,
  processed: 0,
  succeeded: 0,
  failed: 0,
  skipped: 0,
  startedAt: null,
  finishedAt: null,
  stopRequested: false,
  lastError: null,
  lastProposalId: null,
};

export function getBatchStatus(): BatchState {
  return { ...batchState };
}

export function requestBatchStop(): void {
  if (batchState.running) batchState.stopRequested = true;
}

export function startBatch(count: number): { started: boolean; reason?: string } {
  if (batchState.running) return { started: false, reason: "já existe um lote em andamento" };
  const total = Math.max(1, Math.min(500, Math.floor(count)));

  batchState.running = true;
  batchState.total = total;
  batchState.processed = 0;
  batchState.succeeded = 0;
  batchState.failed = 0;
  batchState.skipped = 0;
  batchState.startedAt = new Date();
  batchState.finishedAt = null;
  batchState.stopRequested = false;
  batchState.lastError = null;
  batchState.lastProposalId = null;

  // O lote é dono do lock — libera qualquer mutex preso de execução anterior
  forceReleaseProcessingLock("início de novo lote");

  // Loop assíncrono em background — não bloqueia o request
  (async () => {
    for (let i = 0; i < total; i++) {
      if (batchState.stopRequested) break;
      try {
        const r = await processNextTask();
        if (!r.processed) {
          batchState.skipped++;
          // Sem mais tasks pendentes (sem erro) OU mutex travado — encerra
          if (!r.error || r.error === "another task already in progress") {
            batchState.lastError = r.error || null;
            break;
          }
          batchState.lastError = r.error;
        } else if (r.error) {
          batchState.failed++;
          batchState.lastError = r.error;
        } else {
          batchState.succeeded++;
          if (r.proposalId) batchState.lastProposalId = r.proposalId;
        }
      } catch (err: any) {
        batchState.failed++;
        batchState.lastError = err?.message || String(err);
      } finally {
        batchState.processed++;
      }
      // Pequena pausa para não saturar a API da Anthropic
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    batchState.running = false;
    batchState.finishedAt = new Date();
  })().catch((err) => {
    batchState.running = false;
    batchState.finishedAt = new Date();
    batchState.lastError = err?.message || String(err);
  });

  return { started: true };
}

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

// =====================================================================
// Investigação de UM CAMPO específico (preenchimento automático de cadastro)
// =====================================================================

const FIELD_HINTS: Record<string, string> = {
  monitoredIp: "IP de gerência do equipamento (Mikrotik/Cisco/etc). **Sempre tente voalle_get_link_connection PRIMEIRO** — o campo authenticationIp da conexão Voalle é o monitoredIp. Fallback: mikrotik_pppoe_active (sessão PPPoE ativa retorna o IP atribuído) ou mikrotik_arp_by_interface no nome do PPPoE.",
  pppoeUser: "Usuário PPPoE (login) cadastrado no Voalle/RADIUS. Buscar via get_voalle_data, get_pppoe_session, ou inferir por padrão de nomenclatura observado em links similares do mesmo cliente.",
  concentratorId: "ID numérico do concentrador PPPoE (do banco snmp_concentrators) onde a sessão deste usuário está ativa. Use mikrotik_pppoe_active pra descobrir em qual concentrador a sessão está ativa. Muitos links estão com concentrador errado — confira sempre começando pelos concentradores OSPF, OSPF2 e HSP.",
  snmpInterfaceIndex: "ifIndex SNMP da interface do concentrador onde o tráfego deste link passa (pra coleta correta de bandwidth). Descoberta: (1) se é PPPoE, a interface é o próprio login PPPoE — use mikrotik_pppoe_active pra confirmar sessão ativa e pegar o ifIndex; (2) se é corporativo (L2/L3), busque no concentrador uma interface cujo nome/comment coincida com o nome do cliente ou do link (ex: ether1, vlan-abc, bonding-clienteX) — use mikrotik_arp_by_interface pra validar que o IP do cliente passa por ali. Comece sempre pelos concentradores OSPF, OSPF2 e HSP.",
  oltId: "ID numérico da OLT (do banco olts) à qual a ONU/CPE deste link está conectada. **Sempre tente voalle_get_link_connection PRIMEIRO** — o campo accessPointName/resolvedOltId da conexão Voalle aponta a OLT (já resolvida pelo nome quando bate com o cadastro). Fallbacks: links similares do mesmo cliente, OZmap.",
  slotOlt: "Slot da OLT onde a ONU está plugada (número 1..N). **Se o link tem equipmentSerialNumber, SEMPRE chame olt_search_onu_by_serial primeiro** — essa é a mesma ferramenta do botão 'Descobrir ONU' do cadastro de link. Fallback: OZmap.",
  portOlt: "Porta PON da OLT (1-indexed). **Se o link tem equipmentSerialNumber, SEMPRE chame olt_search_onu_by_serial primeiro.** Fallback: OZmap.",
  onuId: "ID da ONU dentro da porta PON (igual ao ID exibido na CLI da OLT). **Se o link tem equipmentSerialNumber, SEMPRE chame olt_search_onu_by_serial primeiro** — a tool faz SSH/Telnet na OLT e retorna onuId+slotOlt+portOlt de uma vez. Só desista se todas as OLTs responderem 'não encontrada'.",
  equipmentSerialNumber: "Serial alfanumérico da ONU/CPE. **Sempre tente voalle_get_link_connection PRIMEIRO** — retorna direto o campo equipmentSerialNumber da conexão. Fallback: OZmap (potencyData).",
  voalleContractTagId: "ID numérico da tag de serviço no Voalle (contract_service_tags). **Sempre tente voalle_get_link_connection PRIMEIRO** — retorna contractServiceTagId. Fallback: voalle_get_contracts pelo CNPJ.",
};

interface FieldInvestigationResult {
  value: string | null;
  nextStep: "apply_now" | "needs_voalle_change" | "needs_field_visit" | "wait_voalle_sync" | "manual_investigation";
  reasoning: string;
  confidence: number;
  modelUsed: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  toolsUsed: string[];
}

const SUBMIT_FIELD_TOOL = {
  name: "submit_field_value",
  description: "Termina a investigação. DEVE ser chamada ao final com o valor descoberto (ou null se não conseguiu descobrir).",
  input_schema: {
    type: "object" as const,
    properties: {
      value: {
        type: ["string", "null"] as any,
        description: "Valor descoberto para o campo (string serializada — números viram string). null se não foi possível determinar.",
      },
      nextStep: {
        type: "string",
        enum: ["apply_now", "needs_voalle_change", "needs_field_visit", "wait_voalle_sync", "manual_investigation"],
        description: "apply_now = valor pronto pra aplicar; needs_voalle_change = precisa alterar no Voalle primeiro; needs_field_visit = precisa visita técnica (ex: descobrir serial físico); wait_voalle_sync = aguardar próxima sincronização; manual_investigation = inconclusivo.",
      },
      reasoning: { type: "string", description: "Explicação curta de como chegou ao valor (cite as fontes/tools que usou)." },
      confidence: { type: "number", minimum: 0, maximum: 100 },
    },
    required: ["value", "nextStep", "reasoning", "confidence"],
  },
};

export async function investigateField(
  linkId: number,
  field: string,
  hint?: string
): Promise<FieldInvestigationResult> {
  if (!ALLOWED_FIELDS.has(field)) {
    return {
      value: null,
      nextStep: "manual_investigation",
      reasoning: `Campo "${field}" não está na whitelist de campos preenchíveis pela IA.`,
      confidence: 0,
      modelUsed: "guard",
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      toolsUsed: [],
    };
  }

  const [link] = await db.select().from(links).where(eq(links.id, linkId));
  if (!link) {
    return {
      value: null,
      nextStep: "manual_investigation",
      reasoning: `Link ${linkId} não encontrado.`,
      confidence: 0,
      modelUsed: "guard",
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      toolsUsed: [],
    };
  }

  const settings = await storage.getAiAnalystSettings();
  const apiKey = resolveAnthropicApiKey(settings.apiKeyEncrypted);
  const model = settings.model || DEFAULT_MODEL;
  const pricing = MODEL_PRICING[model] || MODEL_PRICING[DEFAULT_MODEL];

  if (!apiKey) {
    return {
      value: null,
      nextStep: "manual_investigation",
      reasoning: "Chave da Anthropic não configurada (defina ANTHROPIC_API_KEY ou cadastre na aba Analista IA).",
      confidence: 0,
      modelUsed: "stub-no-key",
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      toolsUsed: [],
    };
  }

  const ctx = await buildLinkContext(link as Link);

  const fieldHint = hint || FIELD_HINTS[field] || `Descobrir o valor adequado para o campo "${field}".`;

  const focusedPrompt = [
    `# MISSÃO`,
    `Descobrir o valor correto do campo "${field}" para o link #${linkId} (${link.name || "sem nome"}).`,
    ``,
    `## O QUE É ESTE CAMPO`,
    fieldHint,
    ``,
    `## VALOR ATUAL DESTE CAMPO NO LINK`,
    JSON.stringify((link as any)[field] ?? null),
    ``,
    `## CONTEXTO DO LINK`,
    `- Cliente ID: ${link.clientId} (${ctx.client?.name ?? "?"})`,
    `- IP monitorado atual: ${link.monitoredIp ?? "—"}`,
    `- PPPoE atual: ${link.pppoeUser ?? "—"}`,
    `- Concentrador atual: ${ctx.concentrator?.name ?? link.concentratorId ?? "—"}`,
    `- OLT atual: ${ctx.olt?.name ?? link.oltId ?? "—"}`,
    `- Serial equip.: ${(link as any).equipmentSerialNumber ?? "—"}`,
    `- Status: ${link.status}, monitoramento: ${link.monitoringEnabled ? "on" : "off"}`,
    ``,
    `## LINKS SIMILARES (mesmo cliente — útil para inferir padrões)`,
    ctx.similarLinks.length === 0
      ? "_nenhum_"
      : ctx.similarLinks
          .slice(0, 8)
          .map((s) => `- #${s.id} ${s.name} (pppoe=${s.pppoeUser ?? "—"}, conc=${s.concentratorId ?? "—"})`)
          .join("\n"),
    ``,
    `## CORREÇÕES RECENTES (humanos editaram propostas anteriores — aprenda)`,
    ctx.recentCorrections.length === 0
      ? "_nenhuma_"
      : ctx.recentCorrections
          .filter((c) => c.fieldName === field)
          .slice(0, 5)
          .map((c) => `- propôs ${JSON.stringify(c.aiValue)}, humano corrigiu para ${JSON.stringify(c.userValue)}${c.userNote ? ` (${c.userNote})` : ""}`)
          .join("\n") || "_nenhuma para este campo_",
    ``,
    `## DISPENSAS RECENTES PELO OPERADOR (se semelhante ao caso atual, considere antes de propor)`,
    ctx.recentDismissals.length === 0
      ? "_nenhuma_"
      : ctx.recentDismissals
          .filter((d) => d.field === field)
          .slice(0, 5)
          .map((d) => `- "${d.dismissalNote}"`)
          .join("\n") || "_nenhuma para este campo_",
    ``,
    `## REGRAS ATIVAS`,
    ctx.rules.length === 0 ? "_nenhuma_" : ctx.rules.map((r) => `- ${r.ruleText}`).join("\n"),
    ``,
    `# COMO TRABALHAR`,
    `1. Use as ferramentas (get_voalle_data, get_pppoe_session, get_ozmap_data, query_concentrator_*, etc) para BUSCAR o valor real.`,
    `2. Cruze fontes: se Voalle diz X e a sessão PPPoE ativa diz Y, prefira a fonte mais autoritativa para o tipo de campo.`,
    `3. Se descobrir o valor com confiança, use nextStep="apply_now". Se precisar de mudança no Voalle ou visita, escolha o nextStep apropriado.`,
    `4. Ao final OBRIGATORIAMENTE chame submit_field_value (não use submit_proposal).`,
    `5. Você tem no máximo 8 iterações. Seja eficiente.`,
  ].join("\n");

  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic({ apiKey, timeout: 90_000, maxRetries: 2 });

  const baseTools = [...TOOLS.filter((t) => t.name !== "submit_proposal"), SUBMIT_FIELD_TOOL];
  // Cacheia o último tool block para cobrir todos os schemas de tools
  const tools: any[] = baseTools.map((t, i) =>
    i === baseTools.length - 1 ? { ...t, cache_control: { type: "ephemeral" } } : t,
  );
  const messages: any[] = [
    {
      role: "user",
      content: [
        { type: "text", text: focusedPrompt, cache_control: { type: "ephemeral" } },
      ],
    },
  ];
  const toolsUsed: string[] = [];
  let totalInput = 0;
  let totalOutput = 0;
  let result: any = null;
  const MAX_ITER = 8;

  for (let iter = 0; iter < MAX_ITER; iter++) {
    const isLast = iter === MAX_ITER - 1;
    const reqParams: any = {
      model,
      max_tokens: 1536,
      system:
        "Você é um agente que descobre valores faltantes do cadastro de links de fibra óptica. Use as ferramentas disponíveis para BUSCAR informações reais. Termine sempre chamando submit_field_value." +
        (isLast ? "\n\n⚠️ ÚLTIMA iteração — chame submit_field_value AGORA, mesmo que com value=null." : ""),
      tools: tools as any,
      messages,
    };
    if (isLast) reqParams.tool_choice = { type: "tool", name: "submit_field_value" };

    const response = await client.messages.create(reqParams);
    totalInput += response.usage?.input_tokens || 0;
    totalOutput += response.usage?.output_tokens || 0;

    const toolUses = response.content.filter((b: any) => b.type === "tool_use") as any[];
    if (toolUses.length === 0) {
      // sem tool_use — encerra
      break;
    }

    messages.push({ role: "assistant", content: response.content });
    const toolResults: any[] = [];
    for (const tu of toolUses) {
      toolsUsed.push(tu.name);
      if (tu.name === "submit_field_value") {
        result = tu.input;
        toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: "ok" });
      } else {
        try {
          const out = await executeToolSafe(tu.name, tu.input);
          toolResults.push({
            type: "tool_result",
            tool_use_id: tu.id,
            content: JSON.stringify(out).slice(0, 8000),
          });
        } catch (err: any) {
          toolResults.push({
            type: "tool_result",
            tool_use_id: tu.id,
            content: `erro: ${err?.message || String(err)}`,
            is_error: true,
          });
        }
      }
    }
    messages.push({ role: "user", content: toolResults });

    if (result) break;
  }

  const costUsd =
    (totalInput / 1_000_000) * (pricing?.input ?? 0) + (totalOutput / 1_000_000) * (pricing?.output ?? 0);

  // Acumula custos no settings (aproveita a métrica existente)
  try {
    await storage.updateAiAnalystSettings({
      totalInputTokens: (settings.totalInputTokens || 0) + totalInput,
      totalOutputTokens: (settings.totalOutputTokens || 0) + totalOutput,
      totalCostUsd: Number(((Number(settings.totalCostUsd) || 0) + costUsd).toFixed(6)),
    } as any);
  } catch {}

  if (!result) {
    return {
      value: null,
      nextStep: "manual_investigation",
      reasoning: "IA não retornou submit_field_value dentro do limite de iterações.",
      confidence: 0,
      modelUsed: model,
      inputTokens: totalInput,
      outputTokens: totalOutput,
      costUsd,
      toolsUsed,
    };
  }

  // Normaliza valor para string (DB armazena como text)
  let normalizedValue: string | null = null;
  if (result.value !== null && result.value !== undefined && String(result.value).trim() !== "") {
    normalizedValue = String(result.value).trim();
  }

  return {
    value: normalizedValue,
    nextStep: result.nextStep || "manual_investigation",
    reasoning: String(result.reasoning || "").slice(0, 2000),
    confidence: Math.max(0, Math.min(100, Number(result.confidence) || 0)),
    modelUsed: model,
    inputTokens: totalInput,
    outputTokens: totalOutput,
    costUsd,
    toolsUsed,
  };
}

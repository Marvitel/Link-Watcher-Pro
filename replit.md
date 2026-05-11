# Link Monitor

## Overview
The Link Monitor, developed by Marvitel Telecomunicações, is a multi-tenant SaaS application for real-time monitoring of dedicated fiber optic internet links. Its primary purpose is to ensure SLA/ANS compliance, detect DDoS attacks, and manage incidents for Marvitel's clients. This application provides a robust and scalable solution for network performance and security monitoring, supporting Marvitel's strategic objectives in the telecommunications sector.

## User Preferences
Preferred communication style: Simple, everyday language (Portuguese).

**IMPORTANTE: Sistema em PRODUÇÃO** - Todas as alterações devem ser feitas com cuidado e testadas antes de aplicar.

### Ambiente de Produção para Testes
**URL de Produção**: https://linkmonitor.marvitel.com.br
- Todas as verificações de funcionamento devem ser feitas via API de diagnóstico do ambiente de produção
- O ambiente de desenvolvimento (Replit) não possui dados reais - sempre usar produção para validar
- Para testar endpoints: `curl https://linkmonitor.marvitel.com.br/api/...`
- Logs de produção são compartilhados pelo usuário quando necessário

## System Architecture

### Multi-Tenant & Security
The system features a multi-tenant architecture with client data isolation, role-based access control (RBAC), and a Super Admin role. Authentication uses localStorage and Express sessions, with a dual-port design for public and restricted admin portals, and optional IP whitelisting and an application firewall.

### Frontend
Built with React 18 and TypeScript, the frontend uses Wouter for routing, TanStack Query for real-time data, and shadcn/ui components. Tailwind CSS manages styling, including light/dark modes and custom theming. Recharts is used for data visualization (bandwidth, latency), with a kiosk mode available. The primary UI font is Inter, with JetBrains Mono for monospace elements.

### Backend
The backend is developed with Node.js, Express, and TypeScript (ESM), providing RESTful API endpoints. `esbuild` is used for production bundling.

### Data Layer
PostgreSQL serves as the primary database, accessed via Drizzle ORM with `drizzle-zod` for schema validation. Core tables manage clients, users, links, hosts, metrics, events, incidents, and RBAC. Data retention is set for 6 months, complemented by an `audit_logs` table.

### Monorepo Structure & Design Patterns
The project uses a monorepo structure (`client/`, `server/`, `shared/`) with path aliases. Key features include bandwidth direction inversion, versioning with auto-reload for frontend updates, and a system for simulating real-time network metrics.

### SNMP Traffic Collection
The system supports multiple traffic data sources and collects metrics from additional interfaces, ensuring per-minute timestamp alignment. It includes robust delta protection for SNMP octet counters and a per-link sanity clamp to discard physically impossible bandwidth samples. Auto-discovery of `ifIndex` is implemented with a failover mechanism.

**Cisco PPPoE Vi destruída — detecção imediata**: Em concentradores Cisco, cada sessão PPPoE aloca um `Virtual-Access` (Vi3.123) novo; ao desconectar, o Cisco DESTRÓI a Vi (ifIndex passa a retornar `noSuchInstance` no SNMP). `verifyInterfaceAtIndex` agora distingue 3 casos: (a) **timeout real** → mantém ifIndex (rede pode ter caído), (b) **erro SNMP genérico** → mantém ifIndex, (c) **noSuchInstance/noSuchObject em ifName + ifDescr + ifAlias** → marca `interfaceMissing=true`. No callsite (loop principal de coleta), quando `interfaceMissing=true` E o link é Cisco Vi com concentrador, limpa imediatamente `snmpInterfaceIndex/Name/Descr` e força re-descoberta no próximo ciclo, sem esperar `IFINDEX_MISMATCH_THRESHOLD` acumular (que poderia levar vários minutos). Antes, esses 3 casos eram tratados como timeout indistintamente, então o sistema ficava grudado no Vi velho.

**Cisco Vi anti-contaminação de pppoeUser**: O auto-store de `snmpInterfaceAlias`/`pppoeUser` (que rodava sempre que o SNMP retornava um ifAlias e o link não tinha alias salvo) foi BLOQUEADO pra links Cisco Vi com concentrador. Motivo: em Cisco, o slot Vi3.X é alocado pra cliente PPPoE arbitrário a cada nova sessão. Se um link sem `pppoeUser` cadastrado tinha ifIndex apontando pra Vi3.123 e outro cliente assumia esse slot, o sistema gravava o `pppoeUser` do invasor — e a partir daí o detector de "ALIAS MISMATCH" passava a comparar invasor=invasor, dando match pra sempre. Resultado: link grudado coletando tráfego do cliente errado. Agora, em Cisco Vi com concentrador, o `pppoeUser` SÓ pode vir do cadastro (Voalle/manual). Se faltar, o sistema loga warning explícito ao invés de auto-aprender. Para outros tipos (BDI, sub-interfaces estáticas, GPON VLANs) o auto-store continua valendo — esses ifIndex são fixos por cliente.

**Cisco Vi PPPoE user mismatch — checagem de ifAlias E ifDescr**: O detector de "cliente errado" agora valida o `pppoeUser` cadastrado contra DOIS campos SNMP: `ifAlias` (1.3.6.1.2.1.31.1.1.1.18.X) E `ifDescr` (1.3.6.1.2.1.2.2.1.2.X). Antes só comparava contra `ifAlias`. Necessário porque algumas configurações Cisco (via Cisco-AVPair `description=username` no RADIUS) expõem o usuário PPPoE no `ifDescr` em vez de "Virtual-AccessX.Y". O `ifDescr` só é considerado como fonte do PPPoE user quando NÃO bate com os padrões técnicos `^Virtual-Access` ou `^ViX.Y$`. Match em qualquer um dos dois (ifAlias OU ifDescr) → OK. Nenhum dos dois bate com knownAlias → cliente errado, limpa ifIndex pra re-descoberta imediata.

### Concentrator Integration
Integration with Cisco ASR/ISR routers supports PPPoE concentrator functions, including interface discovery, PPPoE username retrieval, and MAC address limitations. It collects ONU ID via OLT and supports vendor auto-detection.

### Optical Signal Monitoring
Per-link optical signal monitoring uses a cascading fallback mechanism: OLT via SNMP (primary), Zabbix MySQL (fallback), and Flashman ACS (fallback for neutral networks). It supports various OLT vendors and detects optical signal deltas. Cisco Nexus SFP optical sensors are auto-discovered.

### PPPoE Session Detection (RADIUS + Mikrotik fallback)
A UI do link mostra um badge/card de sessão PPPoE ativa via `GET /api/links/:id/pppoe-session`. O backend tenta primeiro `radacct` (FreeRADIUS via `getRadiusSessionByUsername`), e se não encontrar, faz fallback pra API binária do concentrador Mikrotik (`/ppp/active`) usando `getMikrotikPppoeSessionByUsername(concentrator, username)`. Necessário porque muitos Mikrotiks fazem PPPoE com user local sem mandar accounting pro RADIUS. O detector de rompimento massivo (`server/massive-outage-detector.ts`) usa o mesmo fallback em modo bulk: agrupa links offline por `concentratorId` e chama `getMikrotikActivePppoeUsernames(concentrator)` UMA vez por concentrador (paralelo). Quando um link offline é filtrado por ter PPPoE ativo, registra evento `ip_mismatch` (deduplicado via `getLatestUnresolvedLinkEvent`).

**Username matching tolerante (Cisco/IOS):** `getRadiusSessionByUsername` (e a query bulk no detector) buscam no `radacct` com 3 estratégias em uma única query: (1) match exato, (2) `LOWER(username) = LOWER($)` case-insensitive, (3) `LOWER(SPLIT_PART(username,'@',1)) = LOWER(local-part)` ignorando realm. Isso resolve o caso de concentradores Cisco que registram o accounting com o username exatamente como o cliente digitou (case diferente do cadastro) ou com realm `@dominio` que não bate com o cadastro. O endpoint loga em `[PPPoE Session]` qual fonte respondeu (RADIUS / Mikrotik / nenhuma) pra diagnóstico em produção.

### Dynamic IP (PPPoE) Handling
The system supports dynamic IP addresses for CPEs via a `useDynamicIp` field, prioritizing `links.monitoredIp` over static overrides. A centralized helper (`resolveCpeIp`) manages IP resolution. Voalle imports automatically enable `useDynamicIp` for PPPoE/corporate links.

### CPE Command Library
A library of pre-configured command templates for CPE devices, categorized by manufacturer/model, assists with diagnostics, supporting placeholders and clipboard copying.

### Link Status & SLA Monitoring
Link statuses include `operational`, `degraded`, `offline`, and `unknown`. SLA compliance is monitored for Availability (≥99%), Latency (≤80ms), Packet Loss (≤2%), and Max Repair Time (6 hours).

### Metric Charts (Bandwidth/Latency/Loss)
Charts utilize shared utilities for deterministic X-axis scaling and consistent tick formatting. Backend aggregation strategy dynamically fetches data from `metrics`, `metrics_hourly`, or `metrics_daily` tables based on the time range, with server-side decimation for longer periods. Frontend renders stacked areas/lines for aggregated data, showing average and peak values.

### Voalle Webhook Processing
The `POST /api/webhooks/voalle` endpoint processes connection and contract events from Voalle ERP, managing link creation, updates, and soft-deletions, mapping contract statuses, and enriching data via Portal and OZmap APIs. Monitoring adjustments are based on link status.

### Link Groups
The system supports grouping links for redundancy (Active/Passive), aggregation (Dual-Stack/Bonding), and shared bandwidth scenarios.

### Batch Link Diagnostics & Enrichment
An admin tool provides batch diagnostics and enrichment, categorizing missing data and offering actions like `discover_voalle_login`, `discover_ips`, `assign_concentrators`, and `sync_ozmap`, including progress tracking and RADIUS connection tests.

### AI Analyst (Agentic Link Triage)
An automatic link triage system uses Anthropic Claude (`claude-sonnet-4-5`) with function-calling capabilities. It includes tables for settings, tasks, proposals, corrections, and explicit rules. The `server/ai-analyst.ts` module manages task queuing, processing, proposal application/rejection, and context building for the AI with tool-use.

**Voalle Solicitation Tools**: Além das tools de banco/rede/Voalle existentes, o Analista de IA tem 3 tools dedicadas a tickets do ERP, em paridade com a UI da aba "Solicitações no ERP":
- `voalle_list_link_solicitations(linkId, includeClosed?)` — retorna `open` (deste link), `otherOpen` (de outros contratos do mesmo cliente) e, se `includeClosed=true`, `closed` (top 3 encerradas, ordenadas por `closedAt DESC`). Usa `partitionByStatus` para separar abertas/encerradas e aplica `applyVoalleSolicitationFilter` SEPARADAMENTE em cada subgrupo (ordem idêntica à rota /closed).
- `voalle_get_solicitation_details(linkId, assignmentId)` — busca detalhes via `getSolicitationData` com IDOR check (assignment precisa pertencer ao cliente Voalle do link).
- `voalle_get_solicitation_history(linkId, assignmentId)` — busca relatos via `getSolicitationHistory` com mesmo IDOR check.

**Helper Compartilhado** (`server/voalle-solicitations-filter.ts`): centraliza `OPEN_STATUSES`, `KNOWN_CLOSED_STATUSES`, `isOpenSolicitation`, `partitionByStatus` e `applyVoalleSolicitationFilter`. Importado tanto pelas rotas REST (`server/routes.ts`) quanto pelo Analista de IA, garantindo paridade total entre o que a UI vê e o que a IA recebe. Status vazio é tratado como ENCERRADO (comportamento legado preservado pra não ocultar tickets sem status no Voalle).

### Deploy/Restart Hardening (sem picos falsos no gráfico)
A cada deploy, o Replit envia SIGTERM antes de SIGKILL. Sem proteção, isso causa dois problemas que registram "100% packet loss" falso no gráfico do link:
1. **Pings em vôo interrompidos pelo SIGTERM**: o `execAsync(ping)` lança erro, o catch retorna `packetLoss: 100`, e o insert no `metrics` ainda acontece antes do processo morrer.
2. **Coleta imediata no boot**: `collectAllLinksMetrics()` era chamado direto em `startRealTimeMonitoring`, antes dos pools de DB/SNMP/RADIUS estarem warm — primeira métrica falhava.

Soluções implementadas em `server/index.ts` (handler) + `server/monitoring.ts`:
- **Graceful shutdown** (`stopRealTimeMonitoring`, `isMonitorShuttingDown`): handler `SIGTERM`/`SIGINT` para todos os timers (monitor, fast-poll, wanguard, ozmap, paused), marca flag `isShuttingDown=true`, espera 2s e chama `process.exit(0)`. O insert da métrica no `processLinkMetrics` checa a flag e descarta a coleta em vôo.
- **Warm-up de 15s no boot**: a primeira `collectAllLinksMetrics` agora roda via `setTimeout(..., 15_000)` em vez de imediato, dando tempo dos pools estabilizarem.

### Configurable Collection Interval (system_settings.metrics_polling_interval)
O intervalo do loop principal de coleta (`startRealTimeMonitoring`) agora é parametrizável via UI admin (`system_settings.metrics_polling_interval`, default 30s, **mínimo 10s** validado em 3 camadas: input HTML, onChange JS, PATCH backend). Antes, o valor estava hard-coded em `storage.startMetricCollection()` como `startRealTimeMonitoring(30)` e o setting da UI era ignorado.

Implementação:
- `storage.startMetricCollection()` agora é async e lê `metricsPollingInterval` do banco antes de iniciar o monitor (clamp `Math.max(10, ...)`).
- `monitoring.ts` mantém variável global `MONITOR_INTERVAL_SECONDS` e função `loadMonitorIntervalFromSettings()` que recarrega a cada 60s (paridade com `loadFastPollFromSettings`). Se o valor efetivo mudou, recria o `monitoringInterval` sem precisar reiniciar o processo.
- `computeEffectiveInterval(requested, linkCount)` aplica os clamps por tamanho de rede: >100 links = mín 45s, >500 = 60s, >1000 = 90s. O usuário só pode REDUZIR até esses pisos.
- O `monitorSettingsInterval` é limpo no shutdown gracioso (`stopRealTimeMonitoring`).
- Backend PATCH `/api/admin/system-settings` re-aplica o clamp de 10s mesmo se a UI deixar passar.

Coletas afetadas pelo intervalo: TODAS as etapas do `processLinkMetrics` rodam no mesmo loop (ping, SNMP de tráfego principal, SNMP de interfaces adicionais via `linkTrafficInterfaces`, sinal óptico, PPPoE/RADIUS, status, eventos). Não há loops separados por tipo de coleta — exceto o fast-poll de links assistidos (5s configurável em `fastPollIntervalSeconds`) e o loop de alta frequência (1s, opt-in por link, abaixo).

### High-Frequency Monitoring (5s) por link (`links.high_frequency_monitoring`)
Coluna nova `links.highFrequencyMonitoring boolean default false` ativa um loop dedicado de 5s por link (constante `HIGH_FREQ_INTERVAL_MS`), ligado/desligado via Switch no LinkForm da edição do link (com aviso de carga). Implementação em `server/monitoring.ts`:
- `loadHighFreqLinks()` recarrega a lista (link.highFrequencyMonitoring=true AND monitoringEnabled=true AND deletedAt IS NULL) a cada 60s. Cache de delta dos links removidos é limpo automaticamente.
- `collectLinkHighFreq(link)` é enxuto: SÓ ping (count=2) + SNMP de tráfego principal (`getInterfaceTraffic` direto via `link.snmpProfileId+snmpInterfaceIndex+snmpRouterIp`). NÃO roda óptico, PPPoE/RADIUS, OZmap, eventos, mudança de status — essas continuam no loop principal de 30s.
- **Carry-forward de bandwidth**: na 1ª amostra (sem baseline de delta) ou quando o SNMP a 1s falha (rate-limit do Mikrotik, timeout), reusa `link.currentDownload/currentUpload` (atualizados pelo loop principal a cada 30s) em vez de zerar. Sem essa proteção, dezenas de amostras zero/segundo mascaravam o gráfico inteiro pra zero.
- Mutex por link via `highFreqCollecting: Set<linkId>` evita acúmulo se um ciclo demora mais de 1s.
- **Cache de delta SNMP isolado** (`highFreqLastSample: Map<linkId, TrafficResult>`), separado do `previousTrafficData` do loop principal. Sem isso, o cálculo de bandwidth dos dois loops competiria pelo mesmo "lastSample" e geraria leituras erradas em ambos.
- Status reusado de `link.status` — não duplica state machine de eventos.
- Insert em `metrics` (Opção A escolhida pelo usuário): reusa tabela existente, gráficos atuais funcionam direto. **Custo**: ~17k amostras/dia/link em modo high-freq (5s) — usar SOMENTE em links críticos. Retenção global de 6 meses já cobre, mas pode-se reduzir.
- Cleanup em `stopRealTimeMonitoring`: `highFreqInterval` e `highFreqRefreshInterval` clearados, guard `isShuttingDown` checado em 3 pontos da `collectLinkHighFreq` pra descartar amostras em vôo durante deploy (não gerar picos falsos).
- `invertBandwidth` respeitado também no high-freq (paridade com loop principal).

### Inactive Links & Temporary Pauses
Links with `monitoringEnabled=false` have open events resolved, status set to 'unknown', and are excluded from dashboard counts. Temporary pauses (`monitoringPausedReason`, `monitoringAutoResume`) allow auto-rehabilitation.

### Voalle Connection Status (Status Técnico)
Hourly synchronization of Voalle connection technical status, distinct from commercial status. It combines data from two Voalle API endpoints (`/external/map/connection/all` for active connections and `/external/map/connection/all/deleted` for deleted connections). A `voalle_connection_status` column in `links` stores statuses like `normal`, `blocked`, `block_warning`, `maintenance_warning`, `deleted`, `unknown`. The backend orchestrates parallel calls to Voalle endpoints, matches by `voalleConnectionId`, and performs bulk updates.

### Voalle Connection ID Discovery (Portal v2 + Fallback ERPVOALLE thirdparty)
Discovery of `links.voalleConnectionId` uses a **Portal v2 FIRST, ERPVOALLE thirdparty as fallback** chain — implemented in `/api/links/:linkId/voalle-compare` and `/api/links/:linkId/voalle-sync`. Portal v2 (`/api/people/{customerId}/authentications`) is the preferred path, providing rich data. If it fails, a third-party fallback (`VoalleAdapter.findConnectionViaThirdparty`) uses `/external/map/connection/all` and filters locally. A static class-level cache (`VoalleAdapter.allConnectionsCache`, 10min TTL) is used for the global list of Voalle connections. Multi-tenant protection is ensured by validating `peopleId` against `expectedVoalleCustomerId` during binding.

### Voalle Solicitation Drill-Down (Detalhes + Relatos)
The `link-detail.tsx` "Solicitações no ERP" tab renders open solicitations, with an expandable dropdown that lazy-loads two parallel queries: **Detalhes** (`GET /api/links/:linkId/voalle/solicitations/:assignmentId/details`) and **Relatos** (`GET /api/links/:linkId/voalle/solicitations/:assignmentId/history`). Both routes apply IDOR checks. Enrichment for linking tickets to links involves fetching detailed data for each ticket via `getSolicitationData` (in parallel, ≤50 tickets) when the initial inline filter returns zero matches but the link has any identifier (`voalleContractTagServiceTag`, `identifier` — the "Etiqueta" form field — or `pppoeUser`), then re-filtering by `details.contractServiceTag.serviceTag` against either `voalleContractTagServiceTag` or `identifier`, plus `details.requestor.name` containing `pppoeUser` as a weak fallback. A static cache for `getSolicitationData` (`solicitationDataCache`) is used within `VoalleAdapter` to deduplicate requests. The filter+enrichment logic lives in a shared helper `applyVoalleSolicitationFilter` reused by the open and closed endpoints.

**Solicitações de outros links + histórico de encerradas**: a rota `/voalle/solicitations` agora retorna `solicitations` (deste link, em andamento) e `otherLinkSolicitations` (em andamento de outros contratos do mesmo cliente). A UI mostra a primeira lista direto e a segunda em um colapsável "Em andamento de outros links de {cliente}". Uma rota separada `GET /api/links/:linkId/voalle/solicitations/closed` busca `getOpenSolicitations(customerId, allAssignments=true)`, filtra status fechados via `partitionByStatus`, aplica o mesmo helper de filtro+enrichment, e então **enriquece cada ticket fechado com `enrichEffectiveClosedAt`** (chama `getSolicitationHistory` em paralelo pra obter a data REAL de encerramento — o campo `closedAt` original é o prazo SLA, NÃO a data de fechamento). As 3 mais recentemente encerradas (por `effectiveClosedAt DESC`) são devolvidas para o Card "Histórico de Solicitações no ERP". O SolicitationCard mostra "Encerrado: há X tempo" quando `effectiveClosedAt` presente.

### Voalle Service Tag Mapping
A `voalle_service_tags` table stores mappings between numeric Voalle tag IDs and alphanumeric OZmap codes, populated by CSV import.

## External Dependencies

### Database
-   **PostgreSQL**: Primary data store.

### Third-Party Integrations
-   **Wanguard (Andrisoft)**: DDoS detection and mitigation.
-   **HetrixTools**: IP/CIDR blacklist monitoring.
-   **Voalle ERP**: Ticket/incident management, contract tags, client authentication, bulk data import, connection status.
-   **OZmap**: Fiber optic route tracking and potency data.
-   **FreeRADIUS PostgreSQL**: MAC address lookup.
-   **Mikrotik API**: MAC discovery in PPPoE sessions.
-   **Anthropic Claude**: AI Analyst functionality.
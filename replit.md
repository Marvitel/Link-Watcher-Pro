# Link Monitor

## Overview
The Link Monitor, developed by Marvitel Telecomunicações, is a multi-tenant SaaS application for real-time monitoring of dedicated fiber optic internet links. Its core purpose is to ensure SLA/ANS compliance, detect DDoS attacks, and manage incidents for Marvitel's clients. This full-stack TypeScript application aims to provide a robust and scalable solution for network performance and security monitoring, aligning with Marvitel's business vision, market potential, and project ambitions in the telecommunications sector.

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
The system features a multi-tenant architecture with client data isolation, role-based access control (RBAC), and a Super Admin role. Authentication uses localStorage and Express sessions. It employs a dual-port design for public and restricted admin portals, with optional IP whitelisting and an application firewall.

### Frontend
Built with React 18 and TypeScript, the frontend uses Wouter for routing, TanStack Query for real-time data, and shadcn/ui (Radix UI-based) components. Tailwind CSS handles styling, supporting light/dark modes and custom theming. Recharts is used for data visualization (bandwidth, latency), with a kiosk mode for 24/7 displays.

### Backend
The backend is developed with Node.js, Express, and TypeScript (ESM), providing RESTful API endpoints. `esbuild` is used for production bundling.

### Data Layer
PostgreSQL is the primary database, accessed via Drizzle ORM with `drizzle-zod` for schema validation. Core tables manage clients, users, links, hosts, metrics, events, incidents, and RBAC. Data retention is 6 months, with an `audit_logs` table for system events.

### Monorepo Structure & Design Patterns
The project uses a monorepo structure (`client/`, `server/`, `shared/`) with path aliases, featuring bandwidth direction inversion, versioning with auto-reload for frontend updates, and a system for simulating real-time network metrics.

### SNMP Traffic Collection
The system supports multiple traffic data sources (Manual IP, Concentrator, Access Point) and collects metrics from additional interfaces, ensuring per-minute timestamp alignment.

### Concentrator Integration
Integration with Cisco ASR/ISR routers supports PPPoE concentrator functions, including interface discovery, PPPoE username retrieval, and MAC address limitations. It collects ONU ID via OLT and supports vendor auto-detection.

### Optical Signal Monitoring
Per-link optical signal monitoring uses a cascading fallback mechanism: OLT via SNMP (primary), Zabbix MySQL (fallback), and Flashman ACS (fallback for neutral networks). It supports various OLT vendors (Huawei, ZTE, Fiberhome, Nokia, Datacom) and detects optical signal deltas. Cisco Nexus SFP optical sensors are auto-discovered.

### Dynamic IP (PPPoE) Handling
The system supports dynamic IP addresses for CPEs via `useDynamicIp` field, prioritizing `links.monitoredIp` over static overrides. A centralized helper (`resolveCpeIp`) manages IP resolution across various functionalities. Voalle imports automatically enable `useDynamicIp` for PPPoE/corporate links.

### CPE Command Library
A library of pre-configured command templates for CPE devices, categorized by manufacturer/model, assists with diagnostics, supporting placeholders and clipboard copying.

### Link Status & SLA Monitoring
Link statuses include `operational`, `degraded`, `offline`, and `unknown` (note: `online` is not used). SLA compliance is monitored for Availability (≥99%), Latency (≤80ms), Packet Loss (≤2%), and Max Repair Time (6 hours), excluding blocked or cancelled links.

**Cálculo de disponibilidade (uniforme em todo o sistema)**: a fórmula oficial é `availability = (operationalCount / totalCount) × 100` aplicada sobre a tabela `metrics` em uma janela definida — implementada em `calculateSLAFromMetrics(clientId?, fromDate?, toDate?, linkId?)` (server/storage.ts). Filtra contratos `blocked`/`cancelled`. Janelas usadas:
- **Dashboard ("Disponibilidade Média")**: últimos 30 dias — `getDashboardStats` chama `calculateSLAFromMetrics` com janela de 30 dias
- **SLA Mensal (relatórios)**: mês selecionado — `getSLAIndicatorsMonthly`
- **SLA Acumulado (link detail / relatórios)**: últimos 6 meses — `getSLAIndicatorsAccumulated`

O campo `links.uptime` (atualizado por `processLinkMetrics` com +0.001/-0.01 a cada coleta) é usado APENAS como fallback quando não há métricas no período. **Não deve ser usado para exibir disponibilidade** — é só um indicador instantâneo de saúde.

**Disponibilidade por link (`availability30d`)**: para garantir que o mesmo link mostre o mesmo número em qualquer tela (lista de cards, dashboard agregado, página de detalhe), os endpoints `GET /api/links`, `GET /api/links/:id` e `GET /api/super-admin/link-dashboard` enriquecem cada link com o campo `availability30d` calculado por `storage.getAvailabilityByLink()` — uma única query agregada `GROUP BY link_id` sobre `metrics` nos últimos 30 dias, retornando `(operacional / total) × 100`. Os componentes `CompactLinkCard`, `LinkCard`, `SuperAdminLinkCard` e o card "Uptime" do `link-detail` usam `availability30d ?? link.uptime` (fallback para o contador instantâneo apenas quando ainda não há métricas no período). O SLA acumulado de 6 meses (`slaDE`) continua sendo usado em relatórios e na seção de indicadores SLA da página de detalhe.

### Gráficos de métricas (Banda/Latência/Perda) — padrão MRTG/Cacti
**Utilitários compartilhados (`client/src/lib/chart-time.ts`)**: `getSpanMs`, `pickTickFormat`, `pickTooltipFormat`, `getExpectedGapMs` e `generateTimeTicks(spanMs, firstTs, lastTs)`. Todos os componentes que renderizam séries temporais (`BandwidthChart`, `LatencyChart`, `PacketLossChart`, `UnifiedMetricsChart` em `bandwidth-chart.tsx` e `MultiTrafficChart` em `multi-traffic-chart.tsx`) importam desse módulo único — não há mais reexport entre componentes.

**Eixo X determinístico**: todos os XAxis usam `dataKey="tsNum"` + `type="number"` + `scale="time"` e recebem **ticks controlados** via `ticks={generateTimeTicks(...)}` + `interval={0}`:
- ≤36h → ticks alinhados a hora cheia (passo 0,25/1/2/3/6h), formato `HH:mm`
- >36h → ticks alinhados a 00:00 do dia (passo 1/2/4/7/14 dias), formato `dd/MM`

Tooltip mostra a data completa via `pickTooltipFormat`.

**Backend agregado retorna MAX + AVG**: em `server/storage.ts`, `getLinkMetrics()` consulta:
- `<7d` → tabela `metrics` (raw, 1 amostra por minuto)
- `≥7d` → `metrics_hourly` (1 ponto/hora)
- `≥30d` → `metrics_daily` (1 ponto/dia)
- Fallback raw-bucket: se hourly/daily ainda não tem pontos suficientes (≥30%/50% do esperado, ex.: jobs de agregação atrasaram), agrega `metrics` em buckets dinâmicos no servidor.

Em **todas** as janelas ≥7d (incluindo o fallback raw-bucket), o backend mapeia a linha principal para `*Max` (download/upload/latency/packetLoss = pico real do bucket — ninguém esconde mais o ataque DDoS de 5min na média de 1h) e anexa os campos opcionais `downloadAvg`, `uploadAvg`, `latencyAvg`, `packetLossAvg`, `isAggregated: true`, `aggregationLevel: "hourly"|"daily"|"raw-bucket"`. O tipo `MetricWithAggregates` em `shared/schema.ts` modela esses campos extras (estende `Metric`). A assinatura é `Promise<MetricWithAggregates[]>` e clientes legados continuam funcionando porque os campos novos são opcionais.

**Atenção sobre `hoursSpan`**: o cálculo de quantos pontos esperar (`expectedDailyPoints`/`expectedHourlyPoints`) usa a janela REAL `[startDate, endDate ?? now]` — em ranges históricos personalizados (ex.: "1ª semana de janeiro"), usar `now` em vez de `endDate` daria meses de span e levaria a query a rejeitar agregados válidos achando que faltam pontos.

**Frontend MRTG-style**: quando `isAggregated`, os componentes desenham **duas Areas/Lines empilhadas**:
1. AVG ao fundo (gradient com opacidade ~0.55, `strokeWidth={1}`) — mostra o regime médio
2. MAX por cima (cor sólida normal) — destaca o pico/pior caso

Tooltip nesses casos exibe "X (pico)" e "Y (médio)" lado a lado. Em janelas raw (<7d) só desenha a série única. **Não há mais suavização (média móvel) aplicada no frontend** — o que vem do banco é o que o usuário vê, garantindo fidelidade tipo Cacti/Grafana.

**Propagação dos campos**: `client/src/pages/link-detail.tsx` tipifica a query como `MetricWithAggregates[]` e propaga `downloadAvg`/`uploadAvg`/`latencyAvg`/`packetLossAvg`/`isAggregated` ao remapear `sortedMetrics` em `bandwidthData`/`latencyData`/`packetLossData`/`unifiedData` — sem essa propagação os campos eram silenciosamente descartados na transformação para os charts.

### Voalle Webhook Processing
The `POST /api/webhooks/voalle` endpoint processes connection and contract events from Voalle ERP, creating/updating/soft-deleting links, mapping contract statuses, and enriching data via Portal and OZmap APIs. It adjusts monitoring based on link status.

### Link Groups
The system supports grouping links for redundancy (Active/Passive), aggregation (Dual-Stack/Bonding), and shared bandwidth scenarios.

### Batch Link Diagnostics & Enrichment
An admin tool provides batch diagnostics and enrichment, categorizing missing data and offering actions like `discover_voalle_login`, `discover_ips`, `assign_concentrators`, and `sync_ozmap`, including progress tracking and RADIUS connection tests.

### AI Analyst (Agentic Link Triage)
An automatic link triage system uses Anthropic Claude (`claude-sonnet-4-5`) with function-calling. Key components include:
-   **Tables**: `ai_analyst_settings` (for config/keys/autonomy mode), `ai_analyst_tasks` (investigation queue), `ai_analyst_proposals` (AI's proposed actions), `ai_analyst_corrections` (learning from human input), and `ai_analyst_rules` (explicit, free-text rules).
-   **Module (`server/ai-analyst.ts`)**: Manages task queuing, processing, proposal application/rejection, context building for the AI (link fields, events, metrics, rules, learning memory), and `runLlmInvestigation()` with tool-use (e.g., `search_similar_links`, `submit_proposal`).
-   **Security**: Anthropic API key resolution prioritizes environment variables. Only whitelisted fields can be modified by the AI. Costs are tracked.
-   **Endpoints**: Admin routes (`/api/admin/ai-analyst/*`) for settings, API keys, queue management, proposals, and rules (requiring `requireSuperAdmin`).
-   **UI**: Dedicated "Analista IA" tab in admin for reviewing proposals, managing the queue and rules, and configuring settings.
-   **Monitoring Deactivation**: The AI can propose `monitoringEnabled=false` for cancelled or duplicate links, and temporary pauses with auto-rehabilitation for PPPoE links.

### Inactive Links & Temporary Pauses
Links with `monitoringEnabled=false` are automatically resolved of open events, set to `status='unknown'`, and excluded from dashboard counts. Temporary pauses (`monitoringPausedReason`, `monitoringAutoResume`) allow auto-rehabilitation: a scheduler runs every 5 minutes and reabilita o link automaticamente quando — para links PPPoE — a sessão volta no RADIUS, ou — para links ponto-a-ponto/corporativos — o `monitoredIp` volta a responder ping (perda <50%). Em ambos os casos cria um evento informativo no link.

### Voalle Service Tag Mapping
A `voalle_service_tags` table stores mappings between numeric Voalle tag IDs and alphanumeric OZmap codes, populated by CSV import. This is used by the reconciliation engine to resolve service tags.

## External Dependencies

### Database
-   **PostgreSQL**: Primary data store.

### Third-Party Integrations
-   **Wanguard (Andrisoft)**: DDoS detection and mitigation.
-   **HetrixTools**: IP/CIDR blacklist monitoring.
-   **Voalle ERP**: Ticket/incident management, contract tags, client authentication, and bulk data import.
-   **OZmap**: Fiber optic route tracking and potency data.
-   **FreeRADIUS PostgreSQL**: MAC address lookup.
-   **Mikrotik API**: MAC discovery in PPPoE sessions.
-   **Anthropic Claude**: AI Analyst functionality.

### Third-Party Libraries
-   **Radix UI**: Accessible component primitives.
-   **Recharts**: Data visualization.
-   **Wouter**: Frontend routing.
-   **TanStack Query**: Real-time data polling.
-   **shadcn/ui**: UI components.
-   **Tailwind CSS**: Styling.
-   **date-fns**: Date formatting.
-   **Zod**: Runtime type validation.
-   **class-variance-authority**: Component variant styling.
-   **Drizzle ORM**: Database access.
-   **drizzle-zod**: Drizzle schema validation.

### Development Tools
-   **Vite**: Frontend development server.
-   **esbuild**: Production bundling.
-   **Drizzle Kit**: Database migrations.

### Fonts
-   **Inter**: Primary UI font.
-   **JetBrains Mono**: Monospace font.
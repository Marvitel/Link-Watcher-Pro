# Link Monitor

## Overview
The Link Monitor is a multi-tenant SaaS application developed by Marvitel Telecomunicações for real-time monitoring of dedicated fiber optic internet links. Its primary purpose is to ensure SLA/ANS compliance, detect DDoS attacks, and manage incidents for Marvitel's clients. This full-stack TypeScript application aims to provide a robust and scalable solution for network performance and security monitoring, focusing on Marvitel's business vision, market potential, and project ambitions within the telecommunications sector.

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
The system is built on a multi-tenant architecture ensuring data isolation per client (`clientId`), with role-based access control (RBAC) and a Super Admin role. Authentication is handled via localStorage and Express sessions. A dual-port design separates public and restricted admin portals, with optional IP whitelisting and an application firewall for enhanced security.

### Frontend
Developed with React 18 and TypeScript, the frontend uses Wouter for routing, TanStack Query for real-time data polling, and shadcn/ui (Radix UI-based) for components. Styling is managed with Tailwind CSS, supporting light/dark modes and custom theming. Recharts is used for data visualization (bandwidth, latency), inspired by Material Design 3 and Grafana. A kiosk mode is available for 24/7 displays with auto-reload and session persistence.

### Backend
The backend utilizes Node.js with Express and TypeScript (ESM modules), providing RESTful API endpoints. `esbuild` is used for production bundling.

### Data Layer
PostgreSQL serves as the primary database, accessed via Drizzle ORM with `drizzle-zod` for schema validation. Core tables define clients, users, links, hosts, metrics, events, DDoS events, incidents, client settings, and RBAC. Data retention is 6 months with automatic cleanup, and an `audit_logs` table tracks system events while masking sensitive data.

### Monorepo Structure & Design Patterns
The project employs a monorepo structure (`client/`, `server/`, `shared/`) with path aliases. Key features include bandwidth direction inversion, versioning with auto-reload for frontend updates, and a system for simulating real-time network metrics.

### SNMP Traffic Collection
The system supports multiple traffic data sources (Manual IP, Concentrator, Access Point) and collects metrics from additional interfaces parallel to main link metrics, ensuring per-minute timestamp alignment.

### Concentrator Integration
Integration with Cisco ASR/ISR routers supports PPPoE concentrator functions, including interface discovery and PPPoE username retrieval. It handles MAC address limitations, collects ONU ID via OLT, and supports vendor auto-detection for corporate links with backup concentrator failover.

### Optical Signal Monitoring
Per-link optical signal monitoring is provided through a cascading fallback mechanism:
1.  **OLT via SNMP** (primary)
2.  **Zabbix MySQL** (fallback)
3.  **Flashman ACS** (fallback for neutral networks)
This system supports various OLT vendors (Huawei, ZTE, Fiberhome, Nokia, Datacom) and defines thresholds for signal levels, detecting optical signal deltas. Cisco Nexus SFP optical sensors are automatically discovered.

#### Datacom SNMP Quirks (confirmados em produção)
- **Fórmula de índice DEFINITIVA**: `(slot × 16777216) + (onuId × 256) + (portCLI - 1)`
  - `onuId`: ID da ONU **exatamente como na CLI e no BD** — é o mesmo ID CLI (14, 53, etc.), NÃO um ID interno diferente
  - `portCLI`: porta PON 1-indexed; subtrai-se 1 para obter o portIndex 0-based
  - Confirmado com múltiplos casos: onuId=14 port=8 → 16780807 → "-22.44" dBm ✓; onuId=53 port=8 → 16790791 → "-26.38" dBm ✓
- **Valores em STRING**: O MIB retorna potência como STRING ("-20.61") e não como INTEGER — o código usa `parseFloat` para preservar o decimal
- **Limitação ODI XPON Sticks**: ONUs do tipo "STICK" (fabricante ODI, ex: XPON22050984) aparecem normalmente no MIB — confirmado ONU 53 (XPON22050984) com -26.38 dBm via SNMP. Não há limitação especial para esse tipo
- **SNMP walk full**: Endpoint `GET /api/admin/olt/:oltId/snmp-walk?limit=500` disponível para diagnóstico. Decodificar índice: `onuId = (índice - slot×16777216) ÷ 256` (parte inteira), `portCLI = ((índice - slot×16777216) % 256) + 1`

### CPE Command Library
A library of pre-configured command templates for CPE devices, categorized by manufacturer/model, assists analysts with diagnostics. Templates support placeholders and can be copied to the clipboard.

### SLA Monitoring
The system monitors SLA compliance for Availability (≥99%), Latency (≤80ms), Packet Loss (≤2%), and Max Repair Time (6 hours), excluding links with `contractStatus="blocked"` or `"cancelled"`.

### Voalle Webhook Processing
The `POST /api/webhooks/voalle` endpoint processes connection and contract events from Voalle ERP. This includes creating/updating/soft-deleting links, mapping contract statuses, and enriching client and link data through integration with Portal and OZmap APIs. It handles client resolution, field normalization, and service description parsing to extract bandwidth information. Monitoring behavior is adjusted based on link status (deleted, blocked, active).

### Link Groups
The system supports grouping links for redundancy (Active/Passive), aggregation (Dual-Stack/Bonding), and shared bandwidth scenarios.

### Batch Link Diagnostics & Enrichment
An admin tool provides batch diagnostics and enrichment for links, categorizing missing data (e.g., `missingVoalleLogin`, `missingIp`, `missingOzmapData`) and offering actions like `discover_voalle_login`, `discover_ips`, `assign_concentrators`, and `sync_ozmap`. It includes progress tracking and a RADIUS connection test.

### Analista de IA (Triagem Agêntica de Links)
Sistema de triagem automática de links com problema usando Anthropic Claude (modelo padrão `claude-sonnet-4-5`) com function-calling.

**Tabelas** (`shared/schema.ts`):
- `ai_analyst_settings` — singleton com chave criptografada, modelo, modo de autonomia (`suggestion`/`hybrid`/`auto`), limiar de confiança e métricas de uso.
- `ai_analyst_tasks` — fila de investigação (`linkId`, `triggerReason`, `status`, `priority`).
- `ai_analyst_proposals` — proposta da IA (`classification`, `proposedFields` jsonb, `reasoning`, `confidence`, `modelUsed`).
- `ai_analyst_corrections` — registra divergências entre o que a IA propôs e o que o humano efetivamente aplicou (aprendizado).
- `ai_analyst_rules` — regras explícitas em português livre, com escopo opcional e ativação por toggle.

**Chave da Anthropic**: resolvida em `server/ai-analyst.ts → resolveAnthropicApiKey()` com prioridade para `process.env.ANTHROPIC_API_KEY` (mais seguro, não depende de `SESSION_SECRET`); se ausente, faz fallback para a chave criptografada no banco. Endpoint de settings expõe `apiKeySource: "env" | "database" | null` para a UI mostrar a origem.

**Módulo** (`server/ai-analyst.ts`):
- Funções de fluxo: `enqueueLink`, `enqueueLinksBulk`, `enqueueOfflineLinks`, `enqueueDegradedLinks`, `processNextTask`, `applyProposal`, `rejectProposal`.
- `buildLinkContext()` monta o contexto enviado à IA: campos do link, eventos recentes, resumo de métricas 24h, concentrador, OLT, links similares, regras ativas e correções recentes (memória de aprendizado).
- `runLlmInvestigation()` chama o Claude em loop de até 6 iterações com tool-use. Tools disponíveis: `search_similar_links` (filtro por cliente/concentrador/prefixo PPPoE/alias), `get_link_by_id`, e `submit_proposal` (terminal, força saída estruturada com `classification`/`proposedFields`/`reasoning`/`confidence`).
- Whitelist `ALLOWED_FIELDS` restringe os campos editáveis (ex.: `monitoredIp`, `pppoeUser`, `concentratorId`, `oltId`, `voalleContractTagId`) — aplicada tanto na sanitização da resposta quanto no `applyProposal`.
- Custos por chamada calculados via `MODEL_PRICING` e acumulados em `ai_analyst_settings.totalCostUsd`.
- Approve e reject geram `logAuditEvent` com `metadata.source="ai_analyst"`.

**Endpoints** (`/api/admin/ai-analyst/*`): settings (GET/PATCH), api-key (POST/DELETE — chave nunca em claro), queue, enqueue (`autoSelect: 'offline'|'degraded'` ou `linkIds[]`), process-next, proposals (GET/approve/reject), rules (CRUD). Todas as rotas exigem `requireSuperAdmin`.

**UI** (`client/src/components/admin/ai-analyst-tab.tsx`): nova aba "Analista IA" no admin com sub-seções Triagem (revisar/aprovar/editar/rejeitar propostas), Fila, Regras (CRUD em texto livre) e Configurações. Botões "Triagem IA (offline)" e "Triagem IA (degradados)" também no topo da aba "Diagnóstico de Links".

### Voalle Service Tag Mapping
A dedicated table `voalle_service_tags` stores the mapping between numeric Voalle tag IDs and alphanumeric OZmap codes (e.g., 3401 → "JW37Y8NA"), populated by importing a CSV exported directly from the Voalle database (`contract_service_tags`). The admin UI (Diagnostics tab) includes a CSV upload button that sends the file as text to `POST /api/admin/voalle-service-tags/import`. The reconciliation engine uses this table as Fonte 3 (after the API and links table) to resolve service tags of deleted connections that could not be resolved from the API alone.

## External Dependencies

### Database
-   **PostgreSQL**: Primary data store.

### Third-Party Integrations
-   **Wanguard (Andrisoft)**: DDoS detection and mitigation.
-   **HetrixTools**: IP/CIDR blacklist monitoring.
-   **Voalle ERP**: For ticket/incident management, contract tags, client authentication/auto-registration, and bulk data import.
-   **OZmap**: Fiber optic route tracking and potency data.
-   **FreeRADIUS PostgreSQL**: Used for MAC address lookup.
-   **Mikrotik API**: For MAC discovery in PPPoE sessions.

### Third-Party Libraries
-   **Radix UI**: Accessible component primitives.
-   **Recharts**: Data visualization.
-   **date-fns**: Date formatting.
-   **Zod**: Runtime type validation.
-   **class-variance-authority**: Component variant styling.

### Development Tools
-   **Vite**: Frontend development server.
-   **Drizzle Kit**: Database migrations.

### Fonts
-   **Inter**: Primary UI font.
-   **JetBrains Mono**: Monospace font.
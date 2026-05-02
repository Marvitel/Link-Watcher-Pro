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

### Concentrator Integration
Integration with Cisco ASR/ISR routers supports PPPoE concentrator functions, including interface discovery, PPPoE username retrieval, and MAC address limitations. It collects ONU ID via OLT and supports vendor auto-detection.

### Optical Signal Monitoring
Per-link optical signal monitoring uses a cascading fallback mechanism: OLT via SNMP (primary), Zabbix MySQL (fallback), and Flashman ACS (fallback for neutral networks). It supports various OLT vendors and detects optical signal deltas. Cisco Nexus SFP optical sensors are auto-discovered.

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

### Inactive Links & Temporary Pauses
Links with `monitoringEnabled=false` have open events resolved, status set to 'unknown', and are excluded from dashboard counts. Temporary pauses (`monitoringPausedReason`, `monitoringAutoResume`) allow auto-rehabilitation.

### Voalle Connection Status (Status Técnico)
Hourly synchronization of Voalle connection technical status, distinct from commercial status. It combines data from two Voalle API endpoints (`/external/map/connection/all` for active connections and `/external/map/connection/all/deleted` for deleted connections). A `voalle_connection_status` column in `links` stores statuses like `normal`, `blocked`, `block_warning`, `maintenance_warning`, `deleted`, `unknown`. The backend orchestrates parallel calls to Voalle endpoints, matches by `voalleConnectionId`, and performs bulk updates.

### Voalle Connection ID Discovery (Portal v2 + Fallback ERPVOALLE thirdparty)
Discovery of `links.voalleConnectionId` uses a **Portal v2 FIRST, ERPVOALLE thirdparty as fallback** chain — implemented in `/api/links/:linkId/voalle-compare` and `/api/links/:linkId/voalle-sync`. Portal v2 (`/api/people/{customerId}/authentications`) is the preferred path, providing rich data. If it fails, a third-party fallback (`VoalleAdapter.findConnectionViaThirdparty`) uses `/external/map/connection/all` and filters locally. A static class-level cache (`VoalleAdapter.allConnectionsCache`, 10min TTL) is used for the global list of Voalle connections. Multi-tenant protection is ensured by validating `peopleId` against `expectedVoalleCustomerId` during binding.

### Voalle Solicitation Drill-Down (Detalhes + Relatos)
The `link-detail.tsx` "Solicitações no ERP" tab renders open solicitations, with an expandable dropdown that lazy-loads two parallel queries: **Detalhes** (`GET /api/links/:linkId/voalle/solicitations/:assignmentId/details`) and **Relatos** (`GET /api/links/:linkId/voalle/solicitations/:assignmentId/history`). Both routes apply IDOR checks. Enrichment for linking tickets to links involves fetching detailed data for each ticket via `getSolicitationData` (in parallel, ≤50 tickets) when the initial inline filter returns zero matches but the link has any identifier (`voalleContractTagServiceTag`, `identifier` — the "Etiqueta" form field — or `pppoeUser`), then re-filtering by `details.contractServiceTag.serviceTag` against either `voalleContractTagServiceTag` or `identifier`, plus `details.requestor.name` containing `pppoeUser` as a weak fallback. A static cache for `getSolicitationData` (`solicitationDataCache`) is used within `VoalleAdapter` to deduplicate requests. The filter+enrichment logic lives in a shared helper `applyVoalleSolicitationFilter` reused by the open and closed endpoints.

**Solicitações de outros links + histórico de encerradas**: a rota `/voalle/solicitations` agora retorna `solicitations` (deste link, em andamento) e `otherLinkSolicitations` (em andamento de outros contratos do mesmo cliente). A UI mostra a primeira lista direto e a segunda em um colapsável "Em andamento de outros links de {cliente}". Uma rota separada `GET /api/links/:linkId/voalle/solicitations/closed` busca `getOpenSolicitations(customerId, allAssignments=true)`, filtra status fechados (qualquer status fora da allowlist `Abertura/Andamento/Aberto/Reaberto/Pendente`), aplica o mesmo helper de filtro+enrichment e devolve as 3 mais recentes ordenadas por `closedAt DESC` — renderizadas em um Card "Histórico de Solicitações no ERP".

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
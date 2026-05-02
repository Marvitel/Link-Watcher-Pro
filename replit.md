# Link Monitor

## Overview
The Link Monitor, developed by Marvitel Telecomunicações, is a multi-tenant SaaS application for real-time monitoring of dedicated fiber optic internet links. Its primary purpose is to ensure SLA/ANS compliance, detect DDoS attacks, and manage incidents for Marvitel's clients. This full-stack TypeScript application provides a robust and scalable solution for network performance and security monitoring, supporting Marvitel's strategic objectives in the telecommunications sector.

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
The system employs a multi-tenant architecture with client data isolation, role-based access control (RBAC), and a Super Admin role. Authentication uses localStorage and Express sessions, featuring a dual-port design for public and restricted admin portals, with optional IP whitelisting and an application firewall.

### Frontend
Built with React 18 and TypeScript, the frontend utilizes Wouter for routing, TanStack Query for real-time data, and shadcn/ui (Radix UI-based) components. Tailwind CSS manages styling, including light/dark modes and custom theming. Recharts is used for data visualization (bandwidth, latency), with a kiosk mode available. The primary UI font is Inter, with JetBrains Mono for monospace elements.

### Backend
The backend is developed with Node.js, Express, and TypeScript (ESM), providing RESTful API endpoints. `esbuild` is used for production bundling.

### Data Layer
PostgreSQL serves as the primary database, accessed via Drizzle ORM with `drizzle-zod` for schema validation. Core tables manage clients, users, links, hosts, metrics, events, incidents, and RBAC. Data retention is set for 6 months, complemented by an `audit_logs` table for system events.

### Monorepo Structure & Design Patterns
The project uses a monorepo structure (`client/`, `server/`, `shared/`) with path aliases. Key features include bandwidth direction inversion, versioning with auto-reload for frontend updates, and a system for simulating real-time network metrics.

### SNMP Traffic Collection
The system supports multiple traffic data sources and collects metrics from additional interfaces, ensuring per-minute timestamp alignment. It includes robust delta protection for SNMP octet counters and a per-link sanity clamp to discard physically impossible bandwidth samples. Auto-discovery of `ifIndex` is implemented with a failover mechanism involving lookups by interface name, PPPoE direct via SNMP/SSH, and IP route lookups, including a crucial sanity check for plausible subscriber interfaces.

### Concentrator Integration
Integration with Cisco ASR/ISR routers supports PPPoE concentrator functions, including interface discovery, PPPoE username retrieval, and MAC address limitations. It collects ONU ID via OLT and supports vendor auto-detection.

### Optical Signal Monitoring
Per-link optical signal monitoring uses a cascading fallback mechanism: OLT via SNMP (primary), Zabbix MySQL (fallback), and Flashman ACS (fallback for neutral networks). It supports various OLT vendors and detects optical signal deltas. Cisco Nexus SFP optical sensors are auto-discovered.

### Dynamic IP (PPPoE) Handling
The system supports dynamic IP addresses for CPEs via a `useDynamicIp` field, prioritizing `links.monitoredIp` over static overrides. A centralized helper (`resolveCpeIp`) manages IP resolution. Voalle imports automatically enable `useDynamicIp` for PPPoE/corporate links.

### CPE Command Library
A library of pre-configured command templates for CPE devices, categorized by manufacturer/model, assists with diagnostics, supporting placeholders and clipboard copying.

### Link Status & SLA Monitoring
Link statuses include `operational`, `degraded`, `offline`, and `unknown`. SLA compliance is monitored for Availability (≥99%), Latency (≤80ms), Packet Loss (≤2%), and Max Repair Time (6 hours), excluding blocked or cancelled links.

### Metric Charts (Bandwidth/Latency/Loss)
Charts utilize shared utilities for deterministic X-axis scaling and consistent tick formatting. Backend aggregation strategy dynamically fetches data from `metrics`, `metrics_hourly`, or `metrics_daily` tables based on the time range, with server-side decimation for longer periods. Frontend renders stacked areas/lines for aggregated data, showing average and peak values, without client-side smoothing.

### Voalle Webhook Processing
The `POST /api/webhooks/voalle` endpoint processes connection and contract events from Voalle ERP, managing link creation, updates, and soft-deletions, mapping contract statuses, and enriching data via Portal and OZmap APIs. Monitoring adjustments are based on link status.

### Link Groups
The system supports grouping links for redundancy (Active/Passive), aggregation (Dual-Stack/Bonding), and shared bandwidth scenarios.

### Batch Link Diagnostics & Enrichment
An admin tool provides batch diagnostics and enrichment, categorizing missing data and offering actions like `discover_voalle_login`, `discover_ips`, `assign_concentrators`, and `sync_ozmap`, including progress tracking and RADIUS connection tests.

### AI Analyst (Agentic Link Triage)
An automatic link triage system uses Anthropic Claude (`claude-sonnet-4-5`) with function-calling capabilities. It includes tables for settings, tasks, proposals, corrections, and explicit rules. The `server/ai-analyst.ts` module manages task queuing, processing, proposal application/rejection, and context building for the AI with tool-use. Security measures include API key prioritization and whitelisted fields for AI modifications. Admin routes and a dedicated UI tab are available for management. The AI can propose deactivating monitoring or temporary pauses with auto-rehabilitation.

### Inactive Links & Temporary Pauses
Links with `monitoringEnabled=false` have open events resolved, status set to 'unknown', and are excluded from dashboard counts. Temporary pauses (`monitoringPausedReason`, `monitoringAutoResume`) allow auto-rehabilitation: a scheduler re-enables PPPoE links when the RADIUS session returns, or point-to-point/corporate links when the `monitoredIp` responds to pings (loss <50%). Informative events are created upon rehabilitation.

### Voalle Connection Status (Status Técnico)
Hourly synchronization of Voalle connection technical status, distinct from commercial status. It combines data from two Voalle API endpoints (`/external/map/connection/all` for active connections and `/external/map/connection/all/deleted` for deleted connections). A `voalle_connection_status` column in `links` stores statuses like `normal`, `blocked`, `block_warning`, `maintenance_warning`, `deleted`, `unknown`. The backend orchestrates parallel calls to Voalle endpoints, matches by `voalleConnectionId`, and performs bulk updates. Active connections take precedence over deleted ones if both are present. Diagnostic endpoints are available for troubleshooting. The frontend displays `VoalleConnectionStatusBadge` with different colors and icons based on status in various UI components.

### Voalle Connection ID Discovery (Portal v2 + Fallback ERPVOALLE thirdparty)
Discovery of `links.voalleConnectionId` (necessary to bind ERP solicitations to a specific link) uses a **Portal v2 FIRST, ERPVOALLE thirdparty as fallback** chain — implemented in `/api/links/:linkId/voalle-compare` and `/api/links/:linkId/voalle-sync`:

1. **Portal v2** (`/api/people/{customerId}/authentications`, `portalApiRequest`): preferred path — returns rich data (OLT slot/port, address, contract, equipment). Requires per-client portal credentials (`voallePortalUsername`/`voallePortalPassword`). If it returns 403 Bad Credentials it throws and falls back.
2. **Fallback thirdparty** (`VoalleAdapter.findConnectionViaThirdparty`): uses `/external/map/connection/all` (same endpoint as the hourly `voalle-connection-sync`, with client_credentials auth that doesn't fail per-client). Filters LOCALLY by `serviceTag` (preferred) or `pppoeUser`. Returns only `{id, serviceTag, user, peopleId}` — enough to populate `voalleConnectionId` but WITHOUT rich data for slot/port/address comparison (the voalle-compare route returns `available:false` with `fallbackUsed:true` and a message explaining the limitation).

**Static cache of the global list**: `/external/map/connection/all` returns ALL Voalle connections (heavy list), so the adapter keeps a **static class-level cache** (`VoalleAdapter.allConnectionsCache`, 10min TTL — `ALL_CONNECTIONS_CACHE_TTL_MS`). MUST be static because `configureErpAdapter()` creates a new `VoalleAdapter` instance per request — instance cache would be discarded. The list is global to Voalle (not per-client), so there's no tenant data leak in the cache itself. Cache is invalidated whenever `configure()` is called (e.g. integration URL/credential change).

**Multi-tenant protection on binding**: `findConnectionViaThirdparty(criteria)` accepts an optional `expectedVoalleCustomerId`. When the Voalle payload includes `peopleId` (captured tolerantly as `peopleId`/`personId`/`customerId`), it validates `peopleId === expectedVoalleCustomerId` before accepting the match — REJECTS a connection from another client even if `serviceTag`/`pppoeUser` collides (critical defense in multi-tenant environment). When the Voalle payload omits peopleId, falls back to degraded mode (accepts exact match with log warning) — in the Marvitel domain `serviceTag` is unique per contract and `pppoeUser` is unique per authentication, but the peopleId check is the correct defense should Voalle return the field. Both `voalle-compare` and `voalle-sync` pass `client.voalleCustomerId` as `expectedVoalleCustomerId`.

**Why this fixes the solicitations binding**: the route `/api/links/:linkId/voalle/solicitations` filters by `link.voalleConnectionId` (among other strategies). When Portal v2 was 403 and the link never received `voalleConnectionId`, the only binding was via subject substring. With the fallback in place, the link receives the ID via `/voalle-sync` and structured binding works again.

### Voalle Solicitation Drill-Down (Detalhes + Relatos)
The `link-detail.tsx` "Solicitações no ERP" tab renders each open solicitation as a `SolicitationCard` with an expandable dropdown that lazy-loads two parallel queries:

1. **Detalhes** — `GET /api/links/:linkId/voalle/solicitations/:assignmentId/details` calls `VoalleAdapter.getSolicitationData()` which posts to `/external/integrations/thirdparty/projects/getsolicitationdata?assignmentId=X` (thirdparty API, client_credentials auth — works without per-client Portal v2 credentials). Returns `{protocol, incidentType, incidentStatus, requestor, responsible, contractServiceTag, sectorArea, team, criticity, beginningDate, finalDate, companyPlace, catalogService...}` rendered as a 2-column grid via the `DetailField` helper that auto-hides null/empty fields.
2. **Relatos** — `GET /api/links/:linkId/voalle/solicitations/:assignmentId/history` calls `VoalleAdapter.getSolicitationHistory()` (`/getsolicitationhistory?assignmentId=X`) for the chronological note thread.

Both routes apply the same IDOR check: they call `getOpenSolicitations(voalleCustomerId)` and reject the request when the requested `assignmentId` does not belong to the client's solicitations list. This prevents users with access to one link from probing arbitrary Voalle assignment IDs.

### Voalle Service Tag Mapping
A `voalle_service_tags` table stores mappings between numeric Voalle tag IDs and alphanumeric OZmap codes, populated by CSV import for reconciliation.

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
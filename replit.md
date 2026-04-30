# Link Monitor

## Overview
The Link Monitor, developed by Marvitel Telecomunicações, is a multi-tenant SaaS application designed for real-time monitoring of dedicated fiber optic internet links. Its primary purpose is to ensure SLA/ANS compliance, detect DDoS attacks, and manage incidents for Marvitel's clients. This full-stack TypeScript application aims to provide a robust and scalable solution for network performance and security monitoring, supporting Marvitel's strategic objectives in the telecommunications sector.

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
The system supports multiple traffic data sources (Manual IP, Concentrator, Access Point) and collects metrics from additional interfaces, ensuring per-minute timestamp alignment.

**Cross-interface delta protection** (`server/monitoring.ts`): SNMP octet counters are per-interface. When `handleIfIndexAutoDiscovery` returns a new `ifIndex`, the cached `previousTrafficData` is from the OLD interface — computing `delta = new_ifIndex_counter - old_ifIndex_counter` produces physically impossible spikes (e.g., 35 Tbps). The post-discovery branch in `runOnce` now `delete()`s the cache before fetching with the new ifIndex and stores the sample as a fresh baseline (no delta this cycle; the next cycle calculates correctly). A **per-link** sanity clamp in `calculateBandwidth(current, previous, linkBandwidthMbps?)` discards samples that physically can't exist on that link: ceiling = `max(linkBandwidth × LINK_BANDWIDTH_CLAMP_MULTIPLIER (=5), MIN_PER_LINK_CLAMP_MBPS (=200))`. Examples: a 50 Mbps client is clamped at 250 Mbps, a 1 Gbps client at 5 Gbps, a 20 Gbps BGP uplink at 100 Gbps — preserves legitimate burst/DDoS peaks (which saturate at the link's physical ceiling) while catching cross-interface delta outliers (which always run >100× the link's capacity). The two main callers in `runOnce` (main flow and additional interfaces) pass `link.bandwidth`; a global fallback `MAX_REASONABLE_MBPS = 30_000` (30 Gbps = 2× Marvitel's largest link) applies when bandwidth is unknown.

### Concentrator Integration
Integration with Cisco ASR/ISR routers supports PPPoE concentrator functions, including interface discovery, PPPoE username retrieval, and MAC address limitations. It collects ONU ID via OLT and supports vendor auto-detection.

### Optical Signal Monitoring
Per-link optical signal monitoring uses a cascading fallback mechanism: OLT via SNMP (primary), Zabbix MySQL (fallback), and Flashman ACS (fallback for neutral networks). It supports various OLT vendors (Huawei, ZTE, Fiberhome, Nokia, Datacom) and detects optical signal deltas. Cisco Nexus SFP optical sensors are auto-discovered.

### Dynamic IP (PPPoE) Handling
The system supports dynamic IP addresses for CPEs via a `useDynamicIp` field, prioritizing `links.monitoredIp` over static overrides. A centralized helper (`resolveCpeIp`) manages IP resolution across various functionalities. Voalle imports automatically enable `useDynamicIp` for PPPoE/corporate links.

### CPE Command Library
A library of pre-configured command templates for CPE devices, categorized by manufacturer/model, assists with diagnostics, supporting placeholders and clipboard copying.

### Link Status & SLA Monitoring
Link statuses include `operational`, `degraded`, `offline`, and `unknown`. SLA compliance is monitored for Availability (≥99%), Latency (≤80ms), Packet Loss (≤2%), and Max Repair Time (6 hours), excluding blocked or cancelled links. Availability calculation uses the formula `availability = (operationalCount / totalCount) × 100` applied over the `metrics` table within defined windows (30 days for dashboard, monthly for reports, 6 months accumulated).

### Metric Charts (Bandwidth/Latency/Loss) — MRTG/Cacti pattern
Charts utilize shared utilities (`client/src/lib/chart-time.ts`) for deterministic X-axis scaling and consistent tick formatting (≤36h → hourly ticks, >36h → daily ticks aligned to 00:00).

**Bucket integrity** (`metrics_hourly`/`metrics_daily`): both tables have `UNIQUE (link_id, bucket_start)` indexes (`metrics_hourly_link_bucket_unique` / `metrics_daily_link_bucket_unique`). The aggregator (`server/aggregation.ts`) uses `ON CONFLICT (link_id, bucket_start) DO UPDATE SET ...` — re-running the aggregator for an existing bucket overwrites the row (idempotent) instead of duplicating it. Maintenance scripts: `scripts/dedup-aggregates.sql` (one-shot global dedup, run before adding the UNIQUE), `scripts/rebuild-aggregates.sql` (rebuilds last 7d hourly + 8d daily from raw — needed after outlier cleanup, since the auto aggregator only processes the previous full hour).

**Backend aggregation strategy** (`server/storage.ts` `getLinkMetrics()`):
- `<7d` → `metrics` table (raw, 1 sample/min)
- `≥7d` and `≤90d` → `metrics_hourly` direct (7d=168, 30d=720, 90d=2160 points)
- `>90d` and `<180d` → `metrics_hourly` with **server-side decimation**: groups into N-hour buckets (`N = ceil(hoursSpan / 2160)`), keeping MAX = `max(downloadMax)` and AVG = `downloadAvg` weighted by each source hour's `sampleCount` (irregular fast-poll collection is corrected). Requires `MIN_RETENTION_HOURLY_DAYS = 180` in `server/aggregation.ts` — lowering this breaks Personalizado in mid-range windows.
- `≥180d` → `metrics_daily` (1 point/day)
- **Daily fallback** (coverage): if `metrics_hourly` lacks coverage for the requested range (e.g., old data already deleted when retention was still 30d), the query tries `metrics_daily` before falling back to raw — keeps 60-180d ranges working in production while the 180d hourly base rebuilds.
- **Raw-bucket fallback**: if hourly/daily still don't have enough points (≥30%/50% expected, e.g., aggregation jobs delayed), aggregates `metrics` into dynamic buckets server-side.

In **all** windows ≥7d (including raw-bucket fallback), the primary line maps to `*Max` (real bucket peak — no more hiding 5min DDoS attacks in 1h averages) with optional `downloadAvg`/`uploadAvg`/`latencyAvg`/`packetLossAvg`, `isAggregated: true`, `aggregationLevel: "hourly"|"daily"|"raw-bucket"`. The `MetricWithAggregates` type in `shared/schema.ts` models these extras.

**`hoursSpan` correctness**: computed over the real `[startDate, endDate ?? now]` window — for custom historical ranges (e.g., "1st week of January"), using `now` instead of `endDate` would inflate `expectedDailyPoints`/`expectedHourlyPoints` and reject valid aggregates as "insufficient".

**Frontend MRTG-style** (`bandwidth-chart.tsx`, `multi-traffic-chart.tsx`): when `isAggregated`, draws two stacked Areas/Lines: AVG underneath (gradient with ~0.55 opacity, `strokeWidth={1}`) showing the average regime, MAX on top (solid color) highlighting peaks/worst-case. Tooltip shows "X (pico)" and "Y (médio)" side by side. In raw windows (<7d), draws single series. **No frontend smoothing** — what comes from DB is what user sees, ensuring Cacti/Grafana-like fidelity. All XAxis use `dataKey="tsNum"` + `type="number"` + `scale="time"` + `ticks={generateTimeTicks(...)}`.

**Field propagation**: `client/src/pages/link-detail.tsx` types the query as `MetricWithAggregates[]` and propagates `downloadAvg`/`uploadAvg`/`latencyAvg`/`packetLossAvg`/`isAggregated` into `bandwidthData`/`latencyData`/`packetLossData`/`unifiedData` — without this, the fields are silently dropped when shaping data for charts.

**Per-link availability (`availability30d`)**: endpoints `GET /api/links`, `GET /api/links/:id` and `GET /api/super-admin/link-dashboard` enrich each link with `availability30d` calculated by `storage.getAvailabilityByLink()` — single aggregated `GROUP BY link_id` query over `metrics` for the last 30 days, returning `(operational / total) × 100`. The `links.uptime` field (incremented +0.001/-0.01 per collection) is used ONLY as fallback when no metrics exist in the period — not for displaying availability.

### Voalle Webhook Processing
The `POST /api/webhooks/voalle` endpoint processes connection and contract events from Voalle ERP, managing link creation, updates, and soft-deletions, mapping contract statuses, and enriching data via Portal and OZmap APIs. Monitoring adjustments are based on link status.

### Link Groups
The system supports grouping links for redundancy (Active/Passive), aggregation (Dual-Stack/Bonding), and shared bandwidth scenarios.

### Batch Link Diagnostics & Enrichment
An admin tool provides batch diagnostics and enrichment, categorizing missing data and offering actions like `discover_voalle_login`, `discover_ips`, `assign_concentrators`, and `sync_ozmap`, including progress tracking and RADIUS connection tests.

### AI Analyst (Agentic Link Triage)
An automatic link triage system uses Anthropic Claude (`claude-sonnet-4-5`) with function-calling capabilities. It includes tables for settings, tasks, proposals, corrections, and explicit rules. The `server/ai-analyst.ts` module manages task queuing, processing, proposal application/rejection, and context building for the AI with tool-use (e.g., `search_similar_links`, `submit_proposal`). Security measures include API key prioritization and whitelisted fields for AI modifications. Admin routes and a dedicated UI tab are available for management. The AI can propose deactivating monitoring or temporary pauses with auto-rehabilitation.

### Inactive Links & Temporary Pauses
Links with `monitoringEnabled=false` have open events resolved, status set to 'unknown', and are excluded from dashboard counts. Temporary pauses (`monitoringPausedReason`, `monitoringAutoResume`) allow auto-rehabilitation: a scheduler re-enables PPPoE links when the RADIUS session returns, or point-to-point/corporate links when the `monitoredIp` responds to pings (loss <50%). Informative events are created upon rehabilitation.

### Voalle Service Tag Mapping
A `voalle_service_tags` table stores mappings between numeric Voalle tag IDs and alphanumeric OZmap codes, populated by CSV import for reconciliation.

## External Dependencies

### Database
-   **PostgreSQL**: Primary data store.

### Third-Party Integrations
-   **Wanguard (Andrisoft)**: DDoS detection and mitigation.
-   **HetrixTools**: IP/CIDR blacklist monitoring.
-   **Voalle ERP**: Ticket/incident management, contract tags, client authentication, bulk data import.
-   **OZmap**: Fiber optic route tracking and potency data.
-   **FreeRADIUS PostgreSQL**: MAC address lookup.
-   **Mikrotik API**: MAC discovery in PPPoE sessions.
-   **Anthropic Claude**: AI Analyst functionality.
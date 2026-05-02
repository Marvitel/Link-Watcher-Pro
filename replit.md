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
The system supports multiple traffic data sources (Manual IP, Concentrator, Access Point) and collects metrics from additional interfaces, ensuring per-minute timestamp alignment. It includes robust delta protection for SNMP octet counters and a per-link sanity clamp to discard physically impossible bandwidth samples.

### Concentrator Integration
Integration with Cisco ASR/ISR routers supports PPPoE concentrator functions, including interface discovery, PPPoE username retrieval, and MAC address limitations. It collects ONU ID via OLT and supports vendor auto-detection.

### Optical Signal Monitoring
Per-link optical signal monitoring uses a cascading fallback mechanism: OLT via SNMP (primary), Zabbix MySQL (fallback), and Flashman ACS (fallback for neutral networks). It supports various OLT vendors (Huawei, ZTE, Fiberhome, Nokia, Datacom) and detects optical signal deltas. Cisco Nexus SFP optical sensors are auto-discovered.

### Dynamic IP (PPPoE) Handling
The system supports dynamic IP addresses for CPEs via a `useDynamicIp` field, prioritizing `links.monitoredIp` over static overrides. A centralized helper (`resolveCpeIp`) manages IP resolution across various functionalities. Voalle imports automatically enable `useDynamicIp` for PPPoE/corporate links.

### CPE Command Library
A library of pre-configured command templates for CPE devices, categorized by manufacturer/model, assists with diagnostics, supporting placeholders and clipboard copying.

### Link Status & SLA Monitoring
Link statuses include `operational`, `degraded`, `offline`, and `unknown`. SLA compliance is monitored for Availability (≥99%), Latency (≤80ms), Packet Loss (≤2%), and Max Repair Time (6 hours), excluding blocked or cancelled links. Availability calculation uses the formula `availability = (operationalCount / totalCount) × 100` applied over the `metrics` table within defined windows.

### Metric Charts (Bandwidth/Latency/Loss)
Charts utilize shared utilities for deterministic X-axis scaling and consistent tick formatting. Backend aggregation strategy dynamically fetches data from `metrics`, `metrics_hourly`, or `metrics_daily` tables based on the time range, with server-side decimation for longer periods. Frontend renders stacked areas/lines for aggregated data, showing average and peak values, without client-side smoothing.

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

### Voalle Connection Status
The system performs hourly synchronization of Voalle technical connection status via a dedicated Voalle endpoint. The backend orchestrates the sync, bulk updating link statuses in PostgreSQL. The frontend displays this status using colored badges and provides a manual refresh option.

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
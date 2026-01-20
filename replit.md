# Link Monitor - Sistema de Monitoramento de Links de Internet

## Overview

Sistema de monitoramento de links de internet dedicados desenvolvido pela **Marvitel Telecomunicações**. A aplicação é uma solução multi-tenant SaaS, oferecida a clientes da Marvitel para monitoramento em tempo real de links dedicados de fibra ótica. Suas capacidades incluem acompanhamento de SLA/ANS, detecção de ataques DDoS e gestão de incidentes. O sistema é construído como uma aplicação full-stack TypeScript, utilizando React para o frontend, Express para o backend e PostgreSQL para persistência de dados.

## User Preferences

Preferred communication style: Simple, everyday language (Portuguese).

**IMPORTANTE: Sistema em PRODUÇÃO** - Todas as alterações devem ser feitas com cuidado e testadas antes de aplicar.

## System Architecture

### Multi-Tenant Architecture
The system supports multiple clients (tenants) with data isolation enforced by a `clientId`. A Super Admin role (`isSuperAdmin=true`) provides Marvitel staff with global management capabilities. Access control is managed via Role-Based Access Control (RBAC) with groups and permissions. Core tables, including clients, users, links, and events, incorporate `clientId` for data partitioning. An `/admin` interface facilitates client, link, and host management.

### Frontend Architecture
The frontend is built with React 18 and TypeScript. It uses Wouter for routing, TanStack Query for server state management with 5-second polling for real-time updates, and shadcn/ui (based on Radix UI) for UI components. Styling is achieved with Tailwind CSS, supporting light/dark modes and custom theming. Recharts is used for data visualization, specifically for bandwidth and latency. The design system is inspired by Material Design 3 and Grafana's data visualization patterns.

### Backend Architecture
The backend uses Node.js with Express and TypeScript (ESM modules). It exposes RESTful API endpoints under the `/api/*` prefix. `esbuild` is used for production server bundling.

### Data Layer
PostgreSQL serves as the primary database, accessed via Drizzle ORM with `drizzle-zod` for schema validation. The shared schema (`shared/schema.ts`) defines core tables like `clients`, `users`, `links`, `hosts`, `metrics`, `events`, `ddosEvents`, `incidents`, and `clientSettings`. RBAC is supported by `groups`, `groupMembers`, `permissions`, and `groupPermissions` tables. SNMP configurations are stored in `snmpProfiles`, `mibConfigs`, and `hostMibConfigs`.

### Authentication
Authentication is localStorage-based, managed by a React context (`client/src/lib/auth.tsx`). Express sessions are used with `MemoryStore`. User authentication data is stored in `link_monitor_auth_user` in localStorage.

### Key Design Patterns
- **Monorepo Structure**: Organized into `client/`, `server/`, and `shared/` directories.
- **Path Aliases**: `@/` for client source and `@shared/` for shared code.
- **Real-time Simulation**: The server simulates network metrics every 5 seconds.
- **Data Cleanup**: Old metrics data is automatically cleaned up, retaining 6 months of history.
- **Bandwidth Direction Inversion**: The system automatically inverts download ↔ upload directions by default for concentrator interface monitoring. This behavior can be disabled per link with `invertBandwidth=true`.
- **Versioning & Auto-reload**: The `/api/version` endpoint returns a hash of the frontend build. The `use-version-check` hook polls this endpoint every 30s; when version changes, the page reloads automatically after clearing cache.
- **Route Persistence**: Before reload, the current route (pathname + query params) is saved to localStorage (`link_monitor_restore_route`) and restored after page load.
- **Kiosk Mode**: Add `?kiosk=true` to any URL for 24/7 display screens. Features: silent auto-reload every 6h, no version update toast notifications, route persistence with query params preserved, session persistence via localStorage token.

### Link Groups (Grupos de Links)
Supports grouping links for combined monitoring, with different profiles:
- **Redundancy (Ativo/Passivo)**: Determines online status if any active member is up, calculates combined uptime and uses bandwidth of the active link.
- **Agregação (Dual-Stack/Bonding)**: Sums bandwidth of all members, indicates degraded status if any member is offline, ideal for IPv4+IPv6 scenarios.
Member roles (`primary`, `backup`, `ipv4`, `ipv6`, `member`) define behavior within groups.

### Optical Signal Monitoring
Features per-link optical signal monitoring with centralized OID configuration per OLT vendor:
- **OLT Vendor OIDs**: `equipmentVendors` table stores `opticalRxOid`, `opticalTxOid`, `opticalOltRxOid` for each OLT manufacturer. Configure once in Admin → Fabricantes, applies to all OLTs of that vendor.
- **OLT Configuration**: OLTs have `vendor` (slug) and `snmpProfileId` fields. The vendor slug must match an entry in `equipmentVendors.slug`.
- **Link ONU Data**: Links store `slotOlt`, `portOlt`, and `onuId` fields identifying the ONU on the OLT.
- **SNMP Index Calculation**: `server/snmp.ts` contains `calculateOnuSnmpIndex()` function with vendor-specific formulas:
  - **Huawei**: `(shelf * 8388608) + (slot * 65536) + (port * 256) + onuId`
  - **ZTE**: `{gponIfIndex}.{onuId}` where gponIfIndex = `(slot * 32768) + (port * 256) + 1`
  - **Fiberhome**: `{ponId}.{onuId}` where ponId = `slot * 16 + port`
  - **Nokia**: `{ponPortId}.{onuId}` where ponPortId = `(slot * 256) + port + 1`
  - **Datacom**: `(slot * 16777216) + (onuId * 256) + (port - 1)` - ATENÇÃO: port e onuId invertidos! Port usa base 0 no índice.
- **Datacom OIDs (enterprise 3709)**: RX=`1.3.6.1.4.1.3709.3.6.2.1.1.22`, TX=`1.3.6.1.4.1.3709.3.6.2.1.1.21`. Note: OLT RX (RSSI) não está disponível via SNMP no Datacom, apenas via CLI/SSH ou banco Zabbix.
- **SNMP Collection Flow**: Link → OLT → Vendor Slug → equipmentVendors (OIDs + index formula) → SNMP Profile → Query OLT IP with full OID (base + index).
- **Zabbix MySQL Fallback**: Quando SNMP não retorna OLT RX (ex: Datacom RSSI), o sistema consulta automaticamente uma OLT configurada com `connectionType=mysql` (banco Zabbix) para obter métricas complementares. A OLT Zabbix é tratada como uma "segunda OLT" que fornece dados via banco de dados MySQL (`db_django_olts`). Query busca na tabela `ftth_onu` + `ftth_onuhistory` por serial.
- **Thresholds**: Normal (≥-25 dBm), Warning (-28 to -25 dBm), Critical (<-28 dBm). Delta detection alerts when variation from baseline exceeds `opticalDeltaThreshold` (default 3dB).
- **Interface**: "Sinal Óptico" tab with visual meters and historical graphs. Link form allows baseline/delta configuration.
- **Correlation**: `splitters` table groups ONUs for mass event detection.

### Sistema de Auditoria
A `audit_logs` table stores all system audit events. The `server/audit.ts` helper function `logAuditEvent` records events, automatically masking sensitive data. Events include authentication, CRUD operations on links, clients, and users. Security features include automatic masking of sensitive data (e.g., passwords), IP address capture, and User Agent logging. An interface allows filtering, pagination, and viewing details of audit logs.

### SLA Requirements
- Availability: ≥99%
- Latency: ≤80ms
- Packet Loss: ≤2%
- Max Repair Time: 6 hours
- Data Retention: 6 months

## External Dependencies

### Database
- **PostgreSQL**: Primary data store, configured via `DATABASE_URL` environment variable.

### Third-Party Integrations
- **Wanguard (Andrisoft)**: Integrated for DDoS detection and mitigation data. Uses a REST API with HTTP Basic Auth. Configuration is per-client, stored in `clientSettings`. DDoS events are created in both `ddos_events` table AND `events` table for unified visibility.
- **HetrixTools**: IP/CIDR blacklist monitoring integration. Configurable auto-check interval (1-24h). Results stored in `blacklistChecks` table with index on (link_id, is_listed) for performance. Links with blacklisted IPs automatically show as "degraded" status - this is synchronized during each monitoring cycle by checking `blacklistChecks` table, ensuring blacklist status is never overwritten by ICMP monitoring.
- **Voalle ERP**: Dual API architecture for ticket/incident management and contract tag retrieval.
  - **API Para Terceiros**: Primary API for authentication, clients, and requests, using OAuth2 password grant.
  - **API Portal**: Used for contract tags (`serviceTag`) and requires `voalleCustomerId` and `cnpj` for authentication.
  - **Voalle Portal Login**: Enables client authentication via Voalle Portal credentials, with auto-registration of clients if they don't exist in Link Monitor.
  - **Credential Security**: Voalle Portal passwords are encrypted with AES-256-GCM, never returned in plaintext, and sanitized from logs.

### Third-Party Libraries
- **Radix UI**: Accessible component primitives.
- **Recharts**: Data visualization charts.
- **date-fns**: Date formatting with Portuguese (Brazil) locale support.
- **Zod**: Runtime type validation.
- **class-variance-authority**: Component variant styling.

### Development Tools
- **Vite**: Frontend development server.
- **Drizzle Kit**: Database migrations.

### Fonts
- **Inter**: Primary UI font (Google Fonts).
- **JetBrains Mono**: Monospace font for data display.

## Technical Documentation

For detailed system documentation, see:
- **[docs/SYSTEM_INVENTORY.md](docs/SYSTEM_INVENTORY.md)**: Complete inventory of features, APIs, pages, and database entities
- **[docs/ARCHITECTURE_MAP.md](docs/ARCHITECTURE_MAP.md)**: Visual architecture diagrams, data flows, and refactoring roadmap

### Key Statistics (Jan 2026)
- **Links Monitorados**: ~1.500
- **Produção**: linkmonitor.marvitel.com.br
- **Ciclo de Coleta**: 30 segundos
- **Polling Frontend**: 5 segundos
- **Retenção de Dados**: 6 meses

### Files Requiring Refactoring (by priority)
| File | Lines | Priority |
|------|-------|----------|
| `client/src/pages/admin.tsx` | ~15k | CRITICAL |
| `server/routes.ts` | ~3k | HIGH |
| `server/storage.ts` | ~2k | MEDIUM |
| `server/monitoring.ts` | ~1.7k | MEDIUM |
| `server/olt.ts` | ~1.6k | MEDIUM |
# Link Monitor - Sistema de Monitoramento de Links de Internet

## Overview
The Link Monitor is a multi-tenant SaaS application by Marvitel Telecomunicações for real-time monitoring of dedicated fiber optic internet links. It tracks SLA/ANS compliance, detects DDoS attacks, and manages incidents for Marvitel's clients. This full-stack TypeScript application uses React, Express, and PostgreSQL, providing a robust and scalable solution for network performance and security monitoring with a focus on business vision, market potential, and project ambitions.

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
The system features a multi-tenant architecture with data isolation per `clientId`, RBAC for access control, and a Super Admin role. Critical data tables include `clientId` for partitioning. Authentication is localStorage-based using a React context and Express sessions. A dual-port architecture allows separate public and restricted admin portals, with optional IP whitelisting for the admin port. An application firewall (`firewallSettings`, `firewallWhitelist`) provides whitelist-based access control for administrative areas and SSH.

### Frontend
Built with React 18 and TypeScript, the frontend uses Wouter for routing, TanStack Query for real-time data polling, and shadcn/ui (Radix UI-based) for components. Styling is managed with Tailwind CSS, supporting light/dark modes and custom theming. Recharts is used for data visualization (bandwidth, latency), inspired by Material Design 3 and Grafana. Kiosk mode (`?kiosk=true`) supports 24/7 display screens with silent auto-reload and session persistence.

### Backend
The backend leverages Node.js with Express and TypeScript (ESM modules), exposing RESTful API endpoints under `/api/*`. `esbuild` handles production bundling.

### Data Layer
PostgreSQL serves as the primary database, accessed via Drizzle ORM with `drizzle-zod` for schema validation. The shared schema defines core tables for clients, users, links, hosts, metrics, events, DDoS events, incidents, client settings, and RBAC. Data retention is set to 6 months with automatic cleanup. An `audit_logs` table tracks all system events, masking sensitive data.

### Monorepo Structure & Design Patterns
The project is organized as a monorepo (`client/`, `server/`, `shared/`) using path aliases. It includes features like bandwidth direction inversion, versioning with auto-reload for frontend updates, and a system for simulating real-time network metrics every 5 seconds.

### SNMP Traffic Collection
Supports three traffic data sources (`trafficSourceType`): Manual (IP), Concentrator, and Access Point (Switch/PE). Metrics are collected from additional interfaces (`linkTrafficInterfaces`) in parallel with main link metrics, with per-minute timestamp alignment.

### Concentrator Integration
Integrates with Cisco ASR/ISR routers for PPPoE concentrator functions, including interface discovery via `ipCidrRouteIfIndex` and PPPoE username retrieval via `ifAlias`. It handles MAC address limitations on Cisco concentrators and collects ONU ID via OLT when configured. For corporate links (`authType='corporate'`), it uses VLAN interface detection and ARP table IP discovery via SNMP, supporting backup concentrator failover and vendor auto-detection.

### Optical Signal Monitoring
Provides per-link optical signal monitoring with OLT vendor-specific OID configurations (Huawei, ZTE, Fiberhome, Nokia, Datacom), including fallback to Zabbix MySQL for OLT RX data. It defines thresholds for normal, warning, and critical signal levels and detects optical signal deltas. For Cisco Nexus, it automatically discovers SFP optical sensors via SNMP.

### CPE Command Library
Offers pre-configured command templates for CPE devices, categorized by manufacturer/model. It includes `cpeCommandTemplates`, `cpeCommandHistory`, and `diagnosticTargets` tables. Templates support placeholders for dynamic substitution and are copied to the clipboard for analyst review.

### SLA Monitoring
Monitors for SLA compliance against targets: Availability (≥99%), Latency (≤80ms), Packet Loss (≤2%), and Max Repair Time (6 hours). Links with `contractStatus="blocked"` or `"cancelled"` are excluded from SLA calculations.

### Voalle Webhook Processing
Endpoint `POST /api/webhooks/voalle` processes connection events from Voalle ERP:
- **ActionType 0 (Inclusão)**: Creates new link or enriches existing one. Matching chain: `voalleConnectionId` → `voalleContractTagServiceTag` → `pppoeUser`. New links created with `monitoringEnabled=false`.
- **ActionType 1 (Alteração)**: Updates existing link fields (pppoeUser, contractStatus, etc.). Logs diff in audit_logs.
- **ActionType 2 (Exclusão)**: Soft-delete via `deletedAt` timestamp + `deletedReason="voalle_webhook"`. Sets `monitoringEnabled=false`.
- **Contract Status**: `contractStatus` field (active/blocked/cancelled/unknown) mapped from Voalle status. `mapVoalleStatus()` handles Portuguese/English/numeric status values.
- **Monitoring Behavior**: 
  - `deletedAt` set → excluded from monitoring entirely
  - `contractStatus="blocked"` → metrics collected but NO events/incidents/SLA impact
  - `contractStatus="active"` → normal monitoring
- **Files**: `server/routes.ts` (webhook handler + `processVoalleConnectionWebhook`), `server/monitoring.ts` (filtering), `server/storage.ts` (getLinks filter)

### Link Groups
Supports grouping links with different profiles for redundancy (Active/Passive), aggregation (Dual-Stack/Bonding), and shared bandwidth scenarios.

### Batch Link Diagnostics & Enrichment
Admin tab "Diagnóstico de Links" analyzes all links and provides batch enrichment tools:
- **Categories**: missingVoalleLogin, missingIp, missingConcentrator, missingInterface, missingOptical, missingOnuId, missingOltAssignment, missingCpe, missingOzmapData, missingPppoeUser, missingSnmpProfile, missingVoalleTag, missingCoordinates
- **Enrichment Actions**:
  - `discover_voalle_login`: Validates Portal Voalle access using CPF/CNPJ as username/password, updates client `voallePortalUsername`/`voallePortalPassword`
  - `discover_ips`: Searches RADIUS DB for framed IP address by PPPoE username
  - `discover_mac`: Searches RADIUS DB for MAC (Calling-Station-Id) by PPPoE username
  - `discover_voalle`: Fetches contract tags from Voalle Portal API, fills pppoeUser, monitoredIp, slotOlt, portOlt, serial, etc.
  - `assign_concentrators`: Matches links to concentrators using Voalle concentrator IDs (`snmpConcentrators.voalleIds`)
  - `assign_olts`: Matches links to OLTs/Switches using Voalle access point IDs (`olts.voalleIds`, `switches.voalleIds`)
  - `discover_interfaces`: SNMP ifIndex discovery for links with IP but no interface
  - `sync_ozmap`: Fetches OZmap potency/route data using service tags
  - `discover_onu_ids`: Batch ONU ID discovery via OLT CLI (SSH/Telnet) using equipment serial number, groups by OLT with delays
  - `create_cpes`: Auto-creates CPE entries and link associations for links with monitoring IP
  - `discover_all`: Runs all actions in sequence
- **Progress tracking**: `skipped` (no data available) vs `failed` (actual errors) vs `success`
- **RADIUS connection test** before bulk operations to detect DB issues early
- **Key fix**: `RadiusDbSession.framedIpAddress` (camelCase) - not `framedipaddress`
- **Files**: `server/routes.ts` (endpoints), `client/src/components/admin/link-diagnostics-tab.tsx` (UI)

## External Dependencies

### Database
- **PostgreSQL**: Primary data store.

### Third-Party Integrations
- **Wanguard (Andrisoft)**: DDoS detection and mitigation via REST API.
- **HetrixTools**: IP/CIDR blacklist monitoring.
- **Voalle ERP**: Dual API integration for ticket/incident management, contract tags, client authentication/auto-registration, and bulk CSV import of link data. CSV correlation chain: conexoes.csv "Código da conexão" → authentication_contracts.csv "id" → "service_tag_id" → contract_service_tags.csv "id". "Tipo de Conexão" column (1=PPPoE, 2=Corporate, 4=Corporate) is the priority rule for Golden Rule filter and authType.
- **OZmap**: Fiber optic route tracking integration for potency/route data.
- **FreeRADIUS PostgreSQL**: Used for MAC address lookup when SNMP/API methods fail, querying the `radacct` table.
- **Mikrotik API**: Used for MAC discovery in PPPoE sessions via binary API (port 8728).

### Third-Party Libraries
- **Radix UI**: Accessible component primitives.
- **Recharts**: Data visualization.
- **date-fns**: Date formatting.
- **Zod**: Runtime type validation.
- **class-variance-authority**: Component variant styling.

### Development Tools
- **Vite**: Frontend development server.
- **Drizzle Kit**: Database migrations.

### Fonts
- **Inter**: Primary UI font.
- **JetBrains Mono**: Monospace font.
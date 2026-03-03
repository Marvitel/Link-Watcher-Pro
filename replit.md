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
# Link Monitor - Sistema de Monitoramento de Links de Internet

## Overview
The Link Monitor is a multi-tenant SaaS application developed by Marvitel Telecomunicações for real-time monitoring of dedicated fiber optic internet links. It provides services to Marvitel's clients, including SLA/ANS compliance tracking, DDoS attack detection, and incident management. The system is a full-stack TypeScript application, utilizing React for the frontend, Express for the backend, and PostgreSQL for data persistence. Its core purpose is to offer a robust and scalable solution for network performance and security monitoring.

## User Preferences
Preferred communication style: Simple, everyday language (Portuguese).

**IMPORTANTE: Sistema em PRODUÇÃO** - Todas as alterações devem ser feitas com cuidado e testadas antes de aplicar.

## System Architecture

### Multi-Tenant Architecture
The system enforces data isolation per client (`clientId`) and offers a Super Admin role for global management. Access control is managed through Role-Based Access Control (RBAC). Core tables include `clientId` for data partitioning, and an `/admin` interface facilitates client, link, and host management.

### Frontend Architecture
Built with React 18 and TypeScript, the frontend uses Wouter for routing, TanStack Query for real-time server state management (5-second polling), and shadcn/ui (Radix UI-based) for components. Styling is handled with Tailwind CSS, supporting light/dark modes and custom theming. Recharts provides data visualization for bandwidth and latency, with a design inspired by Material Design 3 and Grafana.

### Backend Architecture
The backend uses Node.js with Express and TypeScript (ESM modules), exposing RESTful API endpoints under `/api/*`. `esbuild` is used for production bundling.

### Data Layer
PostgreSQL is the primary database, accessed via Drizzle ORM with `drizzle-zod` for schema validation. The shared schema (`shared/schema.ts`) defines core tables for clients, users, links, hosts, metrics, events, DDoS events, incidents, client settings, and RBAC-related tables. SNMP configurations are also stored here.

### Authentication
Authentication is localStorage-based, managed by a React context, and uses Express sessions with `MemoryStore`. User authentication data is stored in `link_monitor_auth_user` in localStorage.

### Dual-Port Architecture
For production security, the system can run on two separate ports: Port 5000 for the public client portal and Port 5001 for a restricted admin portal. Access to the admin port can be further secured with an IP whitelist (`ADMIN_IP_WHITELIST`).

### Key Design Patterns
The system uses a monorepo structure (`client/`, `server/`, `shared/`), path aliases (`@/`, `@shared/`), and simulates real-time network metrics every 5 seconds. It includes automatic data cleanup (6 months retention), bandwidth direction inversion for concentrator interface monitoring, and a versioning system with auto-reload for frontend updates. Kiosk mode (`?kiosk=true`) supports 24/7 display screens with features like silent auto-reload and session persistence.

### SNMP Traffic Collection Sources
Links support three traffic data sources configured via `trafficSourceType`:
- **Manual (IP)**: Direct SNMP collection from the link's router IP
- **Concentrator**: Uses the associated concentrator's IP and profile
- **Access Point (Switch/PE)**: For L2 links with RSTP where concentrator cannot identify which route is active. Traffic is collected from the access switch using `accessPointId` and `accessPointInterfaceIndex`

### Link Groups (Grupos de Links)
Supports grouping links with different profiles:
- **Redundancy (Ativo/Passivo)**: For failover scenarios, determining status based on active members.
- **Agregação (Dual-Stack/Bonding)**: Sums bandwidth for aggregated links (e.g., IPv4+IPv6).
- **Shared (Banda Compartilhada)**: For multiple links/VLANs sharing a single contracted bandwidth.
Member roles (`primary`, `backup`, `ipv4`, `ipv6`, `member`) define behavior within groups.

### Optical Signal Monitoring
Features per-link optical signal monitoring with centralized OID configuration per OLT vendor. It supports various OLT vendors (Huawei, ZTE, Fiberhome, Nokia, Datacom) with specific SNMP index calculation formulas. It can also fall back to Zabbix MySQL database for OLT RX data when SNMP is unavailable. Thresholds for normal, warning, and critical signal levels are defined, along with delta detection. A "Sinal Óptico" tab provides visual meters and historical graphs. The `splitters` table enables correlation for mass event detection.

### Cisco Nexus Entity MIB Discovery
For Cisco Nexus switches, the system performs automatic SFP optical sensor discovery via SNMP walk on `entPhysicalName` to map port names to `entPhysicalIndex`, storing this in a `switchSensorCache` table. It collects optical data using specific Cisco OIDs, handling values returned in hundredths of dBm.

### Sistema de Auditoria
An `audit_logs` table records all system audit events, including authentication and CRUD operations, automatically masking sensitive data. Events capture IP addresses and User Agent information. An interface allows filtering and viewing audit logs.

### Firewall de Aplicação
A whitelist-based application firewall controls access to administrative areas and SSH. It uses `firewallSettings` and `firewallWhitelist` tables, supports IPv4/IPv6 addresses and CIDR notation, and allows granular permissions (`allowAdmin`, `allowSsh`, `allowApi`). Changes are recorded in audit logs.

### SLA Requirements
The system monitors for SLA compliance, with targets for Availability (≥99%), Latency (≤80ms), Packet Loss (≤2%), and Max Repair Time (6 hours). Data is retained for 6 months.

## External Dependencies

### Database
- **PostgreSQL**: Primary data store.

### Third-Party Integrations
- **Wanguard (Andrisoft)**: For DDoS detection and mitigation, integrated via a REST API.
- **HetrixTools**: For IP/CIDR blacklist monitoring, storing results in `blacklistChecks` and influencing link status.
- **Voalle ERP**: Dual API integration for ticket/incident management, contract tag retrieval, and client authentication/auto-registration. Voalle Portal passwords are encrypted.

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
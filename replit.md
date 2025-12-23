# Link Monitor - Sistema de Monitoramento de Links de Internet

## Overview

Sistema de monitoramento de links de internet dedicados desenvolvido pela **Marvitel Telecomunicações**. O sistema é oferecido como serviço multi-tenant para clientes da Marvitel, permitindo monitoramento em tempo real de links dedicados de fibra ótica, acompanhamento de SLA/ANS, detecção de ataques DDoS e gestão de incidentes.

A aplicação é uma solução full-stack TypeScript com frontend React e backend Express, usando PostgreSQL para persistência de dados. Suporta múltiplos clientes (multi-tenant) com isolamento de dados por clientId.

## Business Model

- **Proprietário**: Marvitel Telecomunicações
- **Modelo**: SaaS Multi-tenant
- **Clientes**: Organizações que contratam links dedicados da Marvitel (ex: Defensoria Pública do Estado de Sergipe)
- **Interface**: 100% em português brasileiro (pt-BR)

## User Preferences

Preferred communication style: Simple, everyday language (Portuguese).

## System Architecture

### Multi-Tenant Architecture
- **Tenant Isolation**: Cada cliente (tenant) tem seus dados isolados via clientId
- **Super Admin**: Usuários com isSuperAdmin=true podem gerenciar todos os clientes (Marvitel staff)
- **RBAC**: Sistema de grupos e permissões para controle de acesso granular
- **Tables with clientId**: clients, users, links, hosts, metrics, events, incidents, ddosEvents, groups, snmpProfiles, mibConfigs, clientEventSettings
- **Admin Interface**: Gerenciamento de clientes, links e hosts via /admin
- **Super Admin Credentials**: admin@marvitel.com.br / marvitel123

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter (lightweight React router)
- **State Management**: TanStack Query (React Query) for server state with 5-second polling for real-time updates
- **UI Components**: shadcn/ui component library built on Radix UI primitives
- **Styling**: Tailwind CSS with custom CSS variables for theming (light/dark mode support)
- **Charts**: Recharts for bandwidth and latency visualization
- **Design System**: Material Design 3 inspired with Grafana-style data visualization patterns

### Backend Architecture
- **Runtime**: Node.js with Express
- **Language**: TypeScript with ESM modules
- **API Design**: RESTful endpoints under `/api/*` prefix
- **Build Tool**: esbuild for production server bundle, Vite for client

### Data Layer
- **Database**: PostgreSQL
- **ORM**: Drizzle ORM with drizzle-zod for schema validation
- **Schema Location**: `shared/schema.ts` (shared between client and server)
- **Core Tables**: clients, users, links, hosts, metrics, events, ddosEvents, incidents, clientSettings
- **RBAC Tables**: groups, groupMembers, permissions, groupPermissions
- **SNMP Tables**: snmpProfiles, mibConfigs, hostMibConfigs
- **Event Config Tables**: eventTypes, clientEventSettings

### Key Design Patterns
- **Monorepo Structure**: Client code in `client/`, server in `server/`, shared types in `shared/`
- **Path Aliases**: `@/` for client source, `@shared/` for shared code
- **Real-time Simulation**: Server generates simulated network metrics every 5 seconds
- **Data Cleanup**: Automatic cleanup of old metrics data to manage storage (6-month retention)

### API Endpoints
- `GET /api/stats` - Dashboard aggregate statistics
- `GET /api/clients` - List all clients (tenants)
- `GET /api/links` - List all monitored links
- `GET /api/links/:id` - Single link details
- `GET /api/links/:id/metrics` - Historical metrics for a link
- `GET /api/hosts` - List all monitored hosts
- `GET /api/events` - System events log
- `GET /api/security/ddos` - DDoS event tracking
- `GET /api/sla` - SLA indicator compliance data
- `GET /api/incidents` - Incident management

### CRUD Endpoints
- `POST/PATCH/DELETE /api/links` - Link management
- `POST/PATCH/DELETE /api/hosts` - Host management
- `POST/PATCH/DELETE /api/clients` - Client management

### Wanguard Integration Endpoints
- `POST /api/clients/:clientId/wanguard/test` - Test Wanguard connection
- `POST /api/clients/:clientId/wanguard/sync` - Sync DDoS events from Wanguard
- `GET /api/clients/:clientId/wanguard/anomalies` - Get active anomalies from Wanguard

## Integrations

### Wanguard (Andrisoft)
- **Purpose**: DDoS detection and mitigation data
- **API**: REST API with HTTP Basic Auth
- **Endpoint**: `https://<console_ip>/wanguard-api/v1/`
- **Service**: `server/wanguard.ts` - WanguardService class
- **Configuration**: Per-client settings in clientSettings table (wanguardApiEndpoint, wanguardApiUser, wanguardApiPassword, wanguardEnabled, wanguardSyncInterval)
- **Data Mapping**: Wanguard anomalies are mapped to ddosEvents with wanguardAnomalyId, wanguardSensor, targetIp, decoder fields

### Voalle ERP
- **Purpose**: Ticket/incident management via Service Desk
- **API**: REST API with OAuth2 client_credentials
- **Auth Endpoint**: `https://<erp_url>:45700/connect/token`
- **API Endpoint**: `https://<erp_url>:45715/external/integrations/thirdparty/`
- **Service**: `server/voalle.ts` - VoalleService class
- **Configuration**: Per-client settings in clientSettings table (voalleApiUrl, voalleClientId, voalleClientSecret, voalleSynV1Token, voalleSolicitationTypeCode, voalleEnabled, voalleAutoCreateTicket)
- **Features**: Test connection, create tickets for incidents, automatic ticket creation on incident detection

### Voalle Integration Endpoints
- `POST /api/clients/:clientId/voalle/test` - Test Voalle connection
- `POST /api/clients/:clientId/voalle/create-ticket` - Create ticket for an incident

## External Dependencies

### Database
- **PostgreSQL**: Primary data store, connection via `DATABASE_URL` environment variable
- **connect-pg-simple**: Session storage (available but sessions not currently implemented)

### Third-Party Libraries
- **Radix UI**: Accessible component primitives (dialog, dropdown, tabs, etc.)
- **Recharts**: Data visualization charts
- **date-fns**: Date formatting with Portuguese (Brazil) locale support
- **Zod**: Runtime type validation
- **class-variance-authority**: Component variant styling

### Development Tools
- **Vite**: Frontend development server with HMR
- **Drizzle Kit**: Database migrations (`npm run db:push`)
- **Replit Plugins**: Runtime error overlay, cartographer, dev banner for Replit environment

### Fonts
- **Inter**: Primary UI font (Google Fonts)
- **JetBrains Mono**: Monospace font for metrics/data display

## SLA Requirements
- Disponibilidade: ≥99%
- Latência: ≤80ms
- Perda de Pacotes: ≤2%
- Tempo Máximo de Reparo: 6 horas
- Retenção de Dados: 6 meses

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

**IMPORTANTE: Sistema em PRODUÇÃO** - Todas as alterações devem ser feitas com cuidado e testadas antes de aplicar.

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

### Authentication
- **Method**: localStorage-based authentication (cookies not supported in Replit webview)
- **AuthProvider**: React context in `client/src/lib/auth.tsx` with login/logout functions
- **Storage Key**: `link_monitor_auth_user` in localStorage
- **Session**: Express sessions with MemoryStore (backup, cookies may not persist)

### Key Design Patterns
- **Monorepo Structure**: Client code in `client/`, server in `server/`, shared types in `shared/`
- **Path Aliases**: `@/` for client source, `@shared/` for shared code
- **Real-time Simulation**: Server generates simulated network metrics every 5 seconds
- **Data Cleanup**: Automatic cleanup of old metrics data to manage storage (6-month retention)
- **Bandwidth Direction Inversion**: Por padrão, download ↔ upload são invertidos automaticamente (comportamento ideal para monitorar interfaces de concentrador). Links com `invertBandwidth=true` mantêm a direção original sem inversão.

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

### Link Groups Endpoints
- `GET /api/link-groups` - List all link groups for client
- `GET /api/link-groups/:id` - Get single group with members
- `GET /api/link-groups/:id/metrics` - Aggregated metrics for group
- `POST /api/link-groups` - Create new link group
- `PATCH /api/link-groups/:id` - Update link group
- `DELETE /api/link-groups/:id` - Delete link group

### Link Groups (Grupos de Links)
- **Tables**: `linkGroups` e `linkGroupMembers` em schema.ts
- **Perfis**:
  - **Redundância (Ativo/Passivo)**: Status online se qualquer membro ativo, banda do link ativo, uptime combinado
  - **Agregação (Dual-Stack/Bonding)**: Soma banda de todos membros, status degradado se algum offline, ideal para IPv4+IPv6
- **Papéis de Membro**: primary, backup (redundância) / ipv4, ipv6, member (agregação)
- **Interface**: Aba "Grupos" no painel admin, cards no dashboard, página de detalhes em /link-groups/:id
- **Agregação de Métricas**: Por perfil - redundancy usa valores do melhor link, aggregation soma todos

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

### Voalle ERP - Dual API Architecture
- **Purpose**: Ticket/incident management e busca de etiquetas de contrato
- **Dual API Support**: 
  - **API Para Terceiros** (autenticação principal, clientes, solicitações)
  - **API Portal** (etiquetas de contrato com campo serviceTag e filtro active)

#### API Para Terceiros (Principal)
- **Auth Endpoint**: `https://<erp_url>:45700/connect/token`
- **API Endpoint**: `https://<erp_url>:45715/external/integrations/thirdparty/`
- **Auth**: OAuth2 password grant (username/password/syndata)
- **Usa**: CNPJ como identificador do cliente

#### API Portal (Etiquetas)
- **Auth Endpoint**: `https://<portal_url>/portal_authentication`
- **API Endpoint**: `https://<portal_url>/api/contract_service_tags`
- **Auth**: OAuth2 password grant com Verify-Token header
  - client_id/client_secret: Configurados na integração global
  - username/password: **CNPJ do cliente** (dinâmico, não configurado globalmente)
- **Query**: Usa `voalleCustomerId` para buscar etiquetas do cliente
- **Retorna**: serviceTag, title, description, active

#### Fluxo de Etiquetas
1. Se Portal API configurada + voalleCustomerId + CNPJ disponíveis: usar Portal API
2. Se Portal API falhar ou não configurada + CNPJ disponível: usar API Para Terceiros
3. Se nenhum identificador disponível: retorna lista vazia

#### Requisitos para Funcionamento
- **Portal API**: Cliente deve ter TANTO `voalleCustomerId` (para busca) QUANTO `cnpj` (para autenticação)
- **API Para Terceiros**: Cliente deve ter `cnpj` cadastrado
- **Recomendação**: Cadastrar CNPJ e voalleCustomerId em todos os clientes para garantir Portal API funcione

- **Service**: `server/erp/voalle-adapter.ts` - VoalleAdapter class
- **Configuration**: Integração global em erpIntegrations table com providerConfig contendo credenciais de ambas as APIs

### Voalle Integration Endpoints
- `POST /api/clients/:clientId/voalle/test` - Test Voalle connection
- `POST /api/clients/:clientId/voalle/create-ticket` - Create ticket for an incident
- `GET /api/clients/:clientId/voalle/contract-tags` - Get contract tags (etiquetas de contrato)
- `POST /api/clients/:clientId/voalle/portal-health-check` - Verificar credenciais do portal (super admin)
- `POST /api/clients/:clientId/voalle/portal-recovery` - Solicitar recuperação de senha do portal (super admin)

### Segurança de Credenciais do Portal
- **Criptografia**: Senhas do portal armazenadas com AES-256-GCM (server/crypto.ts)
- **Chave de criptografia**: Derivada de SESSION_SECRET via SHA-256
- **Campos de status**: portalCredentialsStatus (valid/invalid/unchecked/error/unconfigured), portalCredentialsLastCheck, portalCredentialsError
- **Proteção de API**: Senhas nunca retornadas em texto - API retorna "[ENCRYPTED]" no lugar
- **Sanitização de Logs**: Senhas nunca aparecem em logs ou mensagens de erro
- **Health Check**: Endpoint verifica se credenciais funcionam tentando autenticar na Portal API
- **Recuperação**: Endpoint solicita reset de senha via API do Portal (envia email ao cliente)

### Login via Portal Voalle (Clientes)
- **Endpoint**: `POST /api/auth/voalle` - Autenticação de clientes via Portal Voalle
- **Credenciais padrão**: CPF/CNPJ para usuário e senha (criado automaticamente pelo Voalle)
- **Auto-cadastro**: Se cliente não existe no Link Monitor, é criado automaticamente via API do Voalle
- **Fluxo**:
  1. Cliente informa CPF/CNPJ e senha na aba "Cliente" da tela de login
  2. Sistema valida credenciais via API do Portal Voalle
  3. Se cliente não existe: busca dados via API Para Terceiros e cria automaticamente
  4. Cria/atualiza usuário local e armazena senha criptografada
  5. Se credenciais inválidas: oferece opção de recuperação de senha
- **Recuperação**: `POST /api/auth/voalle/recover` - Solicita email de recuperação via Voalle
- **Frontend**: Tela de login com abas "Cliente" e "Administrador", botão "Esqueci minha senha"
- **Configurações**: Botão de recuperação de senha na página de Configurações do cliente

## Sistema de Auditoria

### Arquitetura
- **Tabela**: `audit_logs` - Armazena todos os eventos de auditoria do sistema
- **Helper**: `server/audit.ts` - Função `logAuditEvent` para registrar eventos com mascaramento automático de dados sensíveis
- **Campos registrados**: clientId, actorUserId, actorEmail, actorName, actorRole, action, entity, entityId, entityName, previousValues, newValues, metadata, ipAddress, userAgent, status, errorMessage, createdAt

### Eventos Monitorados
- **Autenticação**: login, login_failed, logout
- **CRUD de Links**: create, update, delete
- **CRUD de Clientes**: create, update, delete
- **CRUD de Usuários**: create, update, delete, password_change

### Segurança
- **Mascaramento automático**: Dados sensíveis (password, passwordHash, snmpCommunity, apiKey, token, secret, authKey, privKey) são automaticamente mascarados nos logs
- **Captura de IP**: IP do cliente é registrado via headers x-forwarded-for ou x-real-ip
- **User Agent**: Navegador/cliente é registrado para rastreabilidade

### Endpoints
- `GET /api/audit` - Lista logs com filtros (clientId, action, entity, actorId, startDate, endDate, status) e paginação
- `GET /api/audit/:id` - Detalhes de um log específico
- `GET /api/audit/stats/summary` - Resumo estatístico dos logs (últimos N dias)

### Interface
- **Localização**: Painel Marvitel → aba "Auditoria"
- **Funcionalidades**: Filtros por ação, entidade, cliente, período; tabela paginada; visualização de detalhes com valores anteriores/novos

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

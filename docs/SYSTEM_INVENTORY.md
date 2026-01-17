# Link Monitor - Inventário do Sistema

> Última atualização: Janeiro 2026  
> Versão do sistema em produção: linkmonitor.marvitel.com.br  
> Links monitorados: ~1.500

---

## 1. Visão Geral

O **Link Monitor** é um sistema multi-tenant SaaS para monitoramento de links de internet dedicados, desenvolvido pela Marvitel Telecomunicações. O sistema oferece monitoramento em tempo real, rastreamento de SLA/ANS, detecção de DDoS, gestão de incidentes e integração com ERPs.

### Stack Tecnológico

| Camada | Tecnologia |
|--------|------------|
| Frontend | React 18, TypeScript, Vite, TailwindCSS, shadcn/ui |
| Backend | Node.js, Express, TypeScript (ESM) |
| Banco de Dados | PostgreSQL (Neon) + Drizzle ORM |
| Estado | TanStack Query (polling 5s) |
| Autenticação | JWT + localStorage + Sessions |

---

## 2. Funcionalidades por Módulo

### 2.1 Monitoramento de Links

| Funcionalidade | Descrição | Arquivos Principais |
|----------------|-----------|---------------------|
| Coleta ICMP (Ping) | Latência e perda de pacotes a cada 30s | `server/monitoring.ts` |
| Coleta SNMP | Banda, CPU, memória dos equipamentos | `server/monitoring.ts`, `server/snmp.ts` |
| Sinal Óptico | RX/TX da ONU e RX da OLT (SNMP + Zabbix fallback) | `server/monitoring.ts`, `server/olt.ts`, `server/snmp.ts` |
| Detecção de Status | Online, offline, degraded (SLA-based) | `server/monitoring.ts` |
| Diagnóstico OLT | Consulta automática à OLT quando link offline | `server/olt.ts` |
| Agregação de Métricas | Consolidação horária/diária com limpeza de 6 meses | `server/monitoring.ts` |

### 2.2 Monitoramento Óptico

| Funcionalidade | Descrição |
|----------------|-----------|
| Fórmulas por Fabricante | Huawei, ZTE, Fiberhome, Nokia, Datacom |
| OIDs por Vendor | Configuração centralizada em `equipmentVendors` |
| Fallback Zabbix MySQL | Consulta banco Zabbix quando SNMP não retorna OLT RX |
| Auto-preenchimento Splitter | Nome, porta e distância da ONU vindos do Zabbix |
| Thresholds | Normal ≥-25dBm, Warning -28 a -25dBm, Critical <-28dBm |

### 2.3 Grupos de Links

| Funcionalidade | Descrição |
|----------------|-----------|
| Perfil Redundância | Ativo/Passivo - online se qualquer membro ativo |
| Perfil Agregação | Soma bandwidth de todos os membros |
| Roles de Membros | Primary, backup, ipv4, ipv6, member |

### 2.4 SLA/ANS

| Indicador | Meta Padrão |
|-----------|-------------|
| Disponibilidade | ≥99% |
| Latência | ≤80ms |
| Perda de Pacotes | ≤2% |
| Tempo Máximo de Reparo | 6 horas |
| Retenção de Dados | 6 meses |

### 2.5 Segurança (DDoS)

| Funcionalidade | Descrição |
|----------------|-----------|
| Integração Wanguard | Anomalias ativas e históricas |
| Painel DDoS | Visualização de ataques por cliente |

### 2.6 Gestão de Incidentes

| Funcionalidade | Descrição |
|----------------|-----------|
| Criação Manual | Via interface ou API |
| Vinculação a Links | Incidentes associados a links afetados |
| Integração ERP | Criação automática de tickets no Voalle |

### 2.7 Integrações Externas

| Sistema | Tipo | Funcionalidades |
|---------|------|-----------------|
| **Voalle ERP** | API REST OAuth2 | Tickets, contratos, tags de serviço |
| **Voalle Portal** | API REST | Login de clientes, recuperação de senha |
| **Wanguard** | API REST Basic Auth | Detecção DDoS, anomalias |
| **Zabbix MySQL** | Conexão direta | Métricas ópticas, dados de ONU/splitter |
| **OLTs** | SSH/Telnet/SNMP | Diagnóstico, consulta de alarmes |

### 2.8 RBAC (Controle de Acesso)

| Entidade | Descrição |
|----------|-----------|
| `clients` | Tenants (empresas clientes) |
| `users` | Usuários com `clientId` para isolamento |
| `groups` | Grupos de permissões por cliente |
| `permissions` | Permissões granulares (view, edit, delete) |
| `isSuperAdmin` | Flag para acesso global (staff Marvitel) |

### 2.9 Auditoria

| Funcionalidade | Descrição |
|----------------|-----------|
| Logs de Autenticação | Login, logout, falhas |
| CRUD Operations | Criação, edição, exclusão de recursos |
| Mascaramento | Dados sensíveis automaticamente ofuscados |
| Filtros | Por usuário, ação, período |

---

## 3. Páginas do Frontend

| Rota | Página | Descrição |
|------|--------|-----------|
| `/` | Dashboard | Visão geral, KPIs, links em alerta |
| `/links` | Lista de Links | Todos os links do cliente |
| `/link/:id` | Detalhe do Link | Métricas, gráficos, eventos, SLA, sinal óptico |
| `/link-groups/:id` | Grupo de Links | Métricas agregadas do grupo |
| `/security` | Segurança | Painel DDoS, anomalias |
| `/events` | Eventos | Lista de eventos com filtros |
| `/reports` | Relatórios | Exportação PDF/CSV, SLA |
| `/settings` | Configurações | Notificações, integrações, contrato |
| `/users` | Usuários | Gestão de usuários do cliente |
| `/admin` | Administração | Gestão global (super admin) |
| `/login` | Login | Autenticação |

---

## 4. Endpoints da API

### Autenticação
- `POST /api/auth/login` - Login local
- `POST /api/auth/voalle` - Login via Voalle Portal
- `POST /api/auth/logout` - Logout
- `GET /api/auth/me` - Usuário atual

### Clientes
- `GET/POST /api/clients` - Listar/criar clientes
- `GET/PATCH/DELETE /api/clients/:id` - CRUD cliente

### Links
- `GET/POST /api/links` - Listar/criar links
- `GET/PATCH/DELETE /api/links/:id` - CRUD link
- `GET /api/links/:id/metrics` - Métricas do link
- `GET /api/links/:id/events` - Eventos do link
- `GET /api/links/:id/sla` - Indicadores SLA
- `POST /api/links/:id/olt-diagnosis` - Diagnóstico OLT

### Grupos de Links
- `GET/POST /api/link-groups` - Listar/criar grupos
- `GET/PATCH/DELETE /api/link-groups/:id` - CRUD grupo

### OLTs
- `GET/POST /api/olts` - Listar/criar OLTs
- `POST /api/olts/:id/test` - Testar conexão
- `POST /api/olts/:id/query-alarm` - Consultar alarmes
- `POST /api/olts/:id/search-onu` - Buscar ONU

### Integrações ERP
- `GET/POST /api/erp-integrations` - Gerenciar integrações
- `POST /api/erp-integrations/:id/test` - Testar conexão
- `POST /api/erp/create-ticket` - Criar ticket no ERP

### Wanguard
- `GET /api/clients/:clientId/wanguard/anomalies` - Anomalias DDoS
- `POST /api/clients/:clientId/wanguard/sync` - Sincronizar

### Sistema
- `GET /api/version` - Versão do build
- `GET /api/system/info` - Informações do sistema
- `GET /api/audit` - Logs de auditoria
- `GET/PUT /api/monitoring-settings` - Configurações de monitoramento

---

## 5. Estrutura de Arquivos Principais

```
├── client/src/
│   ├── App.tsx                 # Roteamento principal
│   ├── components/             # Componentes reutilizáveis
│   │   ├── app-sidebar.tsx     # Menu lateral
│   │   ├── bandwidth-chart.tsx # Gráficos de banda
│   │   ├── optical-signal-section.tsx # Seção sinal óptico
│   │   └── ...
│   ├── pages/                  # Páginas da aplicação
│   │   ├── dashboard.tsx
│   │   ├── link-detail.tsx
│   │   ├── admin.tsx           # ~15k linhas - REFATORAR
│   │   └── ...
│   └── lib/                    # Utilitários
│       ├── auth.tsx            # Contexto de autenticação
│       ├── client-context.tsx  # Contexto multi-tenant
│       └── queryClient.ts      # TanStack Query config
│
├── server/
│   ├── index.ts                # Entry point Express
│   ├── routes.ts               # Definição de rotas (~3k linhas)
│   ├── storage.ts              # Camada de dados
│   ├── monitoring.ts           # Core de monitoramento (~1.7k linhas)
│   ├── snmp.ts                 # Funções SNMP
│   ├── olt.ts                  # Conexões OLT (SSH/Telnet/MySQL)
│   ├── wanguard.ts             # Integração Wanguard
│   ├── voalle.ts               # Integração Voalle legado
│   ├── erp/                    # Adaptadores ERP
│   │   ├── index.ts
│   │   └── voalle-adapter.ts
│   ├── middleware/
│   │   └── auth.ts             # Middleware de autenticação
│   └── audit.ts                # Sistema de auditoria
│
├── shared/
│   └── schema.ts               # Schema Drizzle + tipos
│
└── docs/
    └── SYSTEM_INVENTORY.md     # Este arquivo
```

---

## 6. Entidades do Banco de Dados

### Principais
| Tabela | Descrição |
|--------|-----------|
| `clients` | Empresas clientes (tenants) |
| `users` | Usuários do sistema |
| `links` | Links de internet monitorados |
| `metrics` | Métricas coletadas (banda, latência, etc) |
| `events` | Eventos de monitoramento |
| `incidents` | Incidentes registrados |
| `ddos_events` | Eventos de DDoS detectados |

### Configuração
| Tabela | Descrição |
|--------|-----------|
| `olts` | OLTs cadastradas |
| `concentrators` | Concentradores de rede |
| `hosts` | Hosts para monitoramento SNMP |
| `snmp_profiles` | Perfis de conexão SNMP |
| `equipment_vendors` | Fabricantes e OIDs |
| `erp_integrations` | Configurações de ERP |
| `client_settings` | Configurações por cliente |
| `monitoring_settings` | Configurações globais |

### RBAC
| Tabela | Descrição |
|--------|-----------|
| `groups` | Grupos de permissões |
| `group_members` | Membros dos grupos |
| `permissions` | Lista de permissões |
| `group_permissions` | Permissões por grupo |

### Auditoria
| Tabela | Descrição |
|--------|-----------|
| `audit_logs` | Logs de auditoria |

---

## 7. Fluxos de Dados Principais

### 7.1 Ciclo de Coleta (30s)
```
Timer (30s)
    ↓
Para cada link:
    ├── Ping (ICMP) → latência, packet loss
    ├── SNMP Host → banda in/out, CPU, memória
    ├── SNMP OLT → sinal óptico RX/TX
    │   └── Fallback Zabbix se OLT_RX null
    │       └── Auto-preenche splitter/porta/distância
    ├── Detecta status (online/offline/degraded)
    │   └── Se offline → Consulta OLT diagnóstico
    └── Gera eventos se mudança de status
    ↓
Salva métricas no banco
    ↓
Frontend atualiza (polling 5s)
```

### 7.2 Diagnóstico de Link Offline
```
Link detectado offline
    ↓
Busca OLT associada
    ↓
Consulta alarmes (SSH/Telnet/SNMP)
    ↓
Mapeia código para diagnóstico
    (LOS → Rompimento, DGi → Queda de energia, etc)
    ↓
Atualiza link com diagnóstico
    ↓
Frontend exibe diagnóstico
```

---

## 8. Variáveis de Ambiente

| Variável | Descrição |
|----------|-----------|
| `DATABASE_URL` | URL de conexão PostgreSQL |
| `SESSION_SECRET` | Segredo para sessões Express |
| `NODE_ENV` | development / production |

---

## 9. Áreas para Melhoria

### Arquitetura
- [ ] Modularizar `admin.tsx` (~15k linhas)
- [ ] Separar `routes.ts` por domínio
- [ ] Extrair integrações para módulos independentes
- [ ] Implementar filas para coleta de métricas

### Performance
- [ ] Batch writes para métricas
- [ ] Cache em endpoints pesados
- [ ] Otimizar polling do frontend

### Novas Funcionalidades Planejadas
- [ ] Monitoramento de rede do provedor com IA
- [ ] Ferramentas de diagnóstico avançadas
- [ ] Portal do Cliente (suporte, financeiro, solicitações)

---

## 10. Contatos

- **Desenvolvedor**: Marvitel Telecomunicações
- **Sistema**: linkmonitor.marvitel.com.br

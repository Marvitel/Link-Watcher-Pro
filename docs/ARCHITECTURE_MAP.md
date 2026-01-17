# Link Monitor - Mapa de Arquitetura

> Visualização da estrutura atual do sistema e proposta de modularização

---

## 1. Arquitetura Atual

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND (React)                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │  Dashboard   │  │    Links     │  │   Security   │  │   Reports    │    │
│  │  dashboard.  │  │  links.tsx   │  │  security.   │  │  reports.    │    │
│  │     tsx      │  │  link-detail │  │     tsx      │  │     tsx      │    │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘    │
│                                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                      │
│  │   Events     │  │  Settings    │  │    Admin     │ ← MONOLITO 15k       │
│  │  events.tsx  │  │  settings.   │  │  admin.tsx   │   linhas             │
│  └──────────────┘  │     tsx      │  └──────────────┘                      │
│                     └──────────────┘                                         │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     COMPONENTES COMPARTILHADOS                       │   │
│  │  app-sidebar | bandwidth-chart | optical-signal | metric-card | ... │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                            CONTEXTOS                                 │   │
│  │           auth.tsx | client-context.tsx | theme.tsx                  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     │ HTTP/JSON (polling 5s)
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              BACKEND (Express)                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                          routes.ts (~3k linhas)                      │   │
│  │  Auth | Clients | Links | OLTs | ERP | Wanguard | SNMP | Audit      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                     │                                        │
│         ┌───────────────────────────┼───────────────────────────┐           │
│         ▼                           ▼                           ▼           │
│  ┌──────────────┐  ┌─────────────────────────────┐  ┌──────────────┐       │
│  │   storage    │  │     monitoring.ts           │  │  middleware  │       │
│  │     .ts      │  │     (~1.7k linhas)          │  │   /auth.ts   │       │
│  │              │  │  Coleta, agregação, eventos │  │              │       │
│  └──────────────┘  └─────────────────────────────┘  └──────────────┘       │
│         │                           │                                        │
│         │          ┌────────────────┼────────────────┐                      │
│         │          ▼                ▼                ▼                      │
│         │   ┌──────────┐    ┌──────────┐    ┌──────────────┐               │
│         │   │ snmp.ts  │    │  olt.ts  │    │ wanguard.ts  │               │
│         │   │ Consultas│    │SSH/Telnet│    │  DDoS API    │               │
│         │   │  SNMP    │    │MySQL/SNMP│    │              │               │
│         │   └──────────┘    └──────────┘    └──────────────┘               │
│         │                         │                                         │
│         │                         ▼                                         │
│         │   ┌─────────────────────────────────────────────────────────┐    │
│         │   │                      erp/                                │    │
│         │   │     index.ts | voalle-adapter.ts | types.ts             │    │
│         │   └─────────────────────────────────────────────────────────┘    │
│         │                                                                   │
│         ▼                                                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                        db.ts + Drizzle ORM                           │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            PostgreSQL (Neon)                                 │
│  clients | users | links | metrics | events | incidents | olts | ...        │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     │
         ┌───────────────────────────┼───────────────────────────┐
         ▼                           ▼                           ▼
┌──────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐
│   EQUIPAMENTOS   │  │   SISTEMAS EXTERNOS  │  │       ERPs           │
│                  │  │                      │  │                      │
│  - Roteadores    │  │  - Wanguard (DDoS)   │  │  - Voalle            │
│  - Switches      │  │  - Zabbix MySQL      │  │  - IXC (futuro)      │
│  - OLTs          │  │                      │  │  - SGP (futuro)      │
│                  │  │                      │  │                      │
│  SNMP/SSH/Telnet │  │      REST API        │  │      REST API        │
└──────────────────┘  └──────────────────────┘  └──────────────────────┘
```

---

## 2. Fluxo de Coleta de Métricas

```
                    ┌────────────────────────────────────┐
                    │         Timer (30 segundos)         │
                    └─────────────────┬──────────────────┘
                                      │
                    ┌─────────────────▼──────────────────┐
                    │      Para cada link ativo          │
                    │      (10 workers paralelos)        │
                    └─────────────────┬──────────────────┘
                                      │
         ┌────────────────────────────┼────────────────────────────┐
         ▼                            ▼                            ▼
┌─────────────────┐        ┌─────────────────┐        ┌─────────────────┐
│   ICMP Ping     │        │   SNMP Host     │        │   SNMP OLT      │
│                 │        │                 │        │                 │
│ - Latência      │        │ - Banda In/Out  │        │ - RX ONU        │
│ - Packet Loss   │        │ - CPU           │        │ - TX ONU        │
│                 │        │ - Memória       │        │ - RX OLT        │
└────────┬────────┘        └────────┬────────┘        └────────┬────────┘
         │                          │                          │
         │                          │                    ┌─────▼─────┐
         │                          │                    │ OLT_RX    │
         │                          │                    │  null?    │
         │                          │                    └─────┬─────┘
         │                          │                    Sim   │  Não
         │                          │                    ┌─────▼─────┐
         │                          │                    │  Zabbix   │
         │                          │                    │  MySQL    │
         │                          │                    │           │
         │                          │                    │ + Splitter│
         │                          │                    │ + Porta   │
         │                          │                    │ + Distânc.│
         │                          │                    └─────┬─────┘
         │                          │                          │
         └──────────────────────────┼──────────────────────────┘
                                    ▼
                    ┌───────────────────────────────┐
                    │      Determinar Status        │
                    │                               │
                    │ packet_loss=100% → offline    │
                    │ latency>80ms → degraded       │
                    │ loss>2% → degraded            │
                    │ senão → operational           │
                    └───────────────┬───────────────┘
                                    │
                         ┌──────────▼──────────┐
                         │    Status mudou?    │
                         └──────────┬──────────┘
                              Sim   │  Não
                    ┌───────────────┴───────────────┐
                    ▼                               │
         ┌─────────────────────┐                    │
         │   Criar Evento      │                    │
         │                     │                    │
         │ Se offline:         │                    │
         │   Consultar OLT     │                    │
         │   para diagnóstico  │                    │
         └─────────┬───────────┘                    │
                   │                                │
                   └────────────────┬───────────────┘
                                    ▼
                    ┌───────────────────────────────┐
                    │     Salvar Métricas no DB     │
                    └───────────────────────────────┘
```

---

## 3. Arquitetura Proposta (Modularizada)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND (React)                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         MÓDULOS DE PÁGINA                            │   │
│  │                                                                      │   │
│  │  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐           │   │
│  │  │ Dashboard │ │   Links   │ │ Security  │ │  Reports  │           │   │
│  │  └───────────┘ └───────────┘ └───────────┘ └───────────┘           │   │
│  │                                                                      │   │
│  │  ┌──────────────────────────────────────────────────────────────┐  │   │
│  │  │                      ADMIN (Refatorado)                       │  │   │
│  │  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ │  │   │
│  │  │  │ Clients │ │  Links  │ │  OLTs   │ │  Users  │ │ System  │ │  │   │
│  │  │  │ Module  │ │ Module  │ │ Module  │ │ Module  │ │ Module  │ │  │   │
│  │  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘ │  │   │
│  │  └──────────────────────────────────────────────────────────────┘  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     COMPONENTES COMPARTILHADOS                       │   │
│  │  ui/ | charts/ | tables/ | forms/ | monitoring/                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         BACKEND (Express - Modular)                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         API GATEWAY (routes/)                        │   │
│  │  auth.routes | clients.routes | links.routes | olts.routes | ...    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                     │                                        │
│         ┌───────────────────────────┼───────────────────────────┐           │
│         ▼                           ▼                           ▼           │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                          DOMÍNIOS / SERVIÇOS                          │  │
│  │                                                                        │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                │  │
│  │  │  Monitoring  │  │     Auth     │  │    Clients   │                │  │
│  │  │   Service    │  │   Service    │  │   Service    │                │  │
│  │  │              │  │              │  │              │                │  │
│  │  │ - Coleta     │  │ - Login      │  │ - CRUD       │                │  │
│  │  │ - Agregação  │  │ - JWT        │  │ - Settings   │                │  │
│  │  │ - Eventos    │  │ - RBAC       │  │ - Multi-     │                │  │
│  │  │ - Alertas    │  │ - Voalle     │  │   tenant     │                │  │
│  │  └──────────────┘  └──────────────┘  └──────────────┘                │  │
│  │                                                                        │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                │  │
│  │  │    Links     │  │   Optical    │  │  Incidents   │                │  │
│  │  │   Service    │  │   Service    │  │   Service    │                │  │
│  │  │              │  │              │  │              │                │  │
│  │  │ - CRUD       │  │ - SNMP OLT   │  │ - CRUD       │                │  │
│  │  │ - Metrics    │  │ - Zabbix     │  │ - ERP Ticket │                │  │
│  │  │ - Groups     │  │ - Thresholds │  │ - Timeline   │                │  │
│  │  └──────────────┘  └──────────────┘  └──────────────┘                │  │
│  │                                                                        │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                     │                                        │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                        ADAPTADORES / INTEGRAÇÕES                      │  │
│  │                                                                        │  │
│  │  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐         │  │
│  │  │   SNMP    │  │    OLT    │  │  Wanguard │  │    ERP    │         │  │
│  │  │  Adapter  │  │  Adapter  │  │  Adapter  │  │  Adapter  │         │  │
│  │  │           │  │           │  │           │  │           │         │  │
│  │  │ net-snmp  │  │ SSH/Telnet│  │  REST API │  │ Voalle/   │         │  │
│  │  │           │  │ MySQL     │  │           │  │ IXC/SGP   │         │  │
│  │  └───────────┘  └───────────┘  └───────────┘  └───────────┘         │  │
│  │                                                                        │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                     │                                        │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                         INFRAESTRUTURA                                │  │
│  │         db.ts | cache.ts | queue.ts | logger.ts | audit.ts           │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Plano de Modularização

### Fase 1: Documentação (Atual)
- [x] Criar inventário do sistema
- [x] Criar mapa de arquitetura
- [ ] Documentar fluxos de dados detalhados
- [ ] Criar glossário de termos

### Fase 2: Refatoração Backend
- [ ] Separar `routes.ts` em módulos por domínio
- [ ] Extrair serviços de `monitoring.ts`
- [ ] Criar interfaces claras entre módulos
- [ ] Implementar testes unitários

### Fase 3: Refatoração Frontend
- [ ] Quebrar `admin.tsx` em módulos
- [ ] Criar componentes reutilizáveis para forms/tables
- [ ] Padronizar hooks customizados
- [ ] Implementar testes de componentes

### Fase 4: Infraestrutura
- [ ] Implementar sistema de filas (Bull/BullMQ)
- [ ] Adicionar cache (Redis) para endpoints pesados
- [ ] Otimizar queries do banco
- [ ] Implementar rate limiting

### Fase 5: Novas Funcionalidades
- [ ] Pipeline de IA para análise preditiva
- [ ] Portal do Cliente (módulo separado)
- [ ] API pública documentada

---

## 5. Convenções de Código

### Nomenclatura de Arquivos
```
server/
  routes/
    auth.routes.ts      # Rotas de autenticação
    links.routes.ts     # Rotas de links
  services/
    monitoring.service.ts
    optical.service.ts
  adapters/
    snmp.adapter.ts
    olt.adapter.ts
    wanguard.adapter.ts
  
client/src/
  pages/
    admin/
      clients.tsx       # Módulo de clientes
      links.tsx         # Módulo de links
      olts.tsx          # Módulo de OLTs
  components/
    monitoring/         # Componentes de monitoramento
    admin/             # Componentes de admin
    shared/            # Componentes compartilhados
```

### Padrões de Código
- **Services**: Lógica de negócio, sem dependência de Express
- **Adapters**: Integração com sistemas externos
- **Routes**: Thin controllers, apenas validação e delegação
- **Components**: Componentes React puros, sem lógica de negócio

---

## 6. Métricas de Complexidade Atual

| Arquivo | Linhas | Complexidade | Prioridade Refatoração |
|---------|--------|--------------|------------------------|
| `admin.tsx` | ~15.000 | ALTA | CRÍTICA |
| `routes.ts` | ~3.000 | ALTA | ALTA |
| `monitoring.ts` | ~1.700 | MÉDIA | MÉDIA |
| `olt.ts` | ~1.600 | MÉDIA | MÉDIA |
| `link-detail.tsx` | ~1.500 | MÉDIA | BAIXA |
| `storage.ts` | ~2.000 | MÉDIA | MÉDIA |

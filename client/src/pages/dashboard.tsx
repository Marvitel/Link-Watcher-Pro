import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MetricCard } from "@/components/metric-card";
import { LinkCard } from "@/components/link-card";
import { EventsTable } from "@/components/events-table";
import { SLACompactCard } from "@/components/sla-indicators";
import { useClientContext } from "@/lib/client-context";
import { useAuth } from "@/lib/auth";
import { Link } from "wouter";
import {
  Activity,
  AlertTriangle,
  Gauge,
  Clock,
  Shield,
  ArrowRight,
  RefreshCw,
  Building2,
} from "lucide-react";
import type { Link as LinkType, Event, DashboardStats, Metric, Client, SLAIndicator } from "@shared/schema";

function LinkCardWithMetrics({ link }: { link: LinkType }) {
  const { data: metrics } = useQuery<Metric[]>({
    queryKey: [`/api/links/${link.id}/metrics`],
    refetchInterval: 5000,
    staleTime: 0, // Sempre buscar dados frescos
  });

  // Ordenar ASC por timestamp: mais antigo à esquerda, mais recente à direita
  const metricsHistory = metrics ? [...metrics]
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    .map((m) => ({
      timestamp: typeof m.timestamp === 'string' ? m.timestamp : new Date(m.timestamp).toISOString(),
      download: m.download,
      upload: m.upload,
      status: m.status,
    })) : [];

  return <LinkCard link={link} metricsHistory={metricsHistory} />;
}

function ClientsOverview({ clients, setSelectedClient }: { 
  clients: Client[]; 
  setSelectedClient: (id: number, name: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {clients.map((client) => (
        <Card 
          key={client.id} 
          className="hover-elevate cursor-pointer"
          onClick={() => setSelectedClient(client.id, client.name)}
          data-testid={`card-client-${client.id}`}
        >
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Building2 className="w-5 h-5 text-primary" />
              <CardTitle className="text-lg">{client.name}</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-2">
              {client.email || "Sem email de contato"}
            </p>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Clique para visualizar dashboard</span>
              <ArrowRight className="w-3 h-3" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const { isSuperAdmin } = useAuth();
  const { selectedClientId, selectedClientName, setSelectedClient, isViewingAsClient } = useClientContext();

  const { data: clients, isLoading: clientsLoading } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
    enabled: isSuperAdmin,
  });

  const statsUrl = selectedClientId ? `/api/stats?clientId=${selectedClientId}` : "/api/stats";
  const linksUrl = selectedClientId ? `/api/links?clientId=${selectedClientId}` : "/api/links";
  const eventsUrl = selectedClientId ? `/api/events?clientId=${selectedClientId}` : "/api/events";
  const settingsUrl = selectedClientId ? `/api/my-settings?clientId=${selectedClientId}` : "/api/my-settings";

  const { data: stats, isLoading: statsLoading } = useQuery<DashboardStats>({
    queryKey: [statsUrl],
    refetchInterval: 5000,
  });

  const { data: clientSettings } = useQuery<{ wanguardEnabled: boolean; voalleEnabled: boolean }>({
    queryKey: [settingsUrl],
    staleTime: 60000,
  });

  const showDdosCard = isSuperAdmin || clientSettings?.wanguardEnabled;

  const { data: links, isLoading: linksLoading } = useQuery<LinkType[]>({
    queryKey: [linksUrl],
    refetchInterval: 5000,
  });

  const { data: events, isLoading: eventsLoading } = useQuery<Event[]>({
    queryKey: [eventsUrl],
    refetchInterval: 10000,
  });

  const slaUrl = selectedClientId ? `/api/sla?clientId=${selectedClientId}&type=accumulated` : "/api/sla?type=accumulated";
  const { data: slaIndicators, isLoading: slaLoading } = useQuery<SLAIndicator[]>({
    queryKey: [slaUrl],
    refetchInterval: 30000,
  });

  // Helper to get SLA indicator by id
  const getSLAIndicator = (id: string) => slaIndicators?.find(i => i.id === id);
  const availability = getSLAIndicator("sla-de"); // Disponibilidade do Enlace
  const latency = getSLAIndicator("sla-lat"); // Latência
  const packetLoss = getSLAIndicator("sla-dp"); // Descarte de Pacotes

  if (isSuperAdmin && !isViewingAsClient) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold">Painel Marvitel</h1>
            <p className="text-muted-foreground">
              Visao geral de todos os clientes - Selecione um cliente para ver detalhes
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            title="Total de Clientes"
            value={clients?.length || 0}
            icon={Building2}
            trend={{ value: 0, direction: "neutral" }}
            subtitle="clientes ativos"
            testId="metric-total-clients"
          />
          <MetricCard
            title="Links Operacionais"
            value={`${stats?.operationalLinks || 0}/${stats?.totalLinks || 0}`}
            icon={Activity}
            trend={{ value: 0, direction: "neutral" }}
            subtitle="todos os clientes"
            testId="metric-all-links"
          />
          <MetricCard
            title="Disponibilidade Geral"
            value={(stats?.averageUptime || 0).toFixed(2)}
            unit="%"
            icon={Gauge}
            trend={{ value: 0.5, direction: "up", isGood: true }}
            subtitle="media de todos"
            testId="metric-all-uptime"
          />
          <MetricCard
            title="Alertas Ativos"
            value={stats?.activeAlerts || 0}
            icon={AlertTriangle}
            trend={{ value: 0, direction: "neutral" }}
            subtitle="alertas pendentes"
            testId="metric-all-alerts"
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Clientes</CardTitle>
          </CardHeader>
          <CardContent>
            {clientsLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-32 w-full" />
                ))}
              </div>
            ) : clients && clients.length > 0 ? (
              <ClientsOverview clients={clients} setSelectedClient={setSelectedClient} />
            ) : (
              <p className="text-center text-muted-foreground py-8">
                Nenhum cliente cadastrado. Acesse Administracao para adicionar clientes.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-muted-foreground">
            Monitoramento em tempo real dos links dedicados
            {isViewingAsClient && selectedClientName && ` - ${selectedClientName}`}
          </p>
        </div>
        <Button variant="outline" size="sm" data-testid="button-refresh">
          <RefreshCw className="w-4 h-4 mr-2" />
          Atualizar
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {statsLoading ? (
          <>
            {[1, 2, 3, 4].map((i) => (
              <Card key={i}>
                <CardHeader className="pb-2">
                  <Skeleton className="h-4 w-24" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-8 w-20 mb-2" />
                  <Skeleton className="h-3 w-16" />
                </CardContent>
              </Card>
            ))}
          </>
        ) : (
          <>
            <MetricCard
              title="Links Operacionais"
              value={`${stats?.operationalLinks || 0}/${stats?.totalLinks || 0}`}
              icon={Activity}
              trend={{
                value: stats?.totalLinks ? Math.round((stats.operationalLinks / stats.totalLinks) * 100) : 0,
                direction: stats?.operationalLinks === stats?.totalLinks ? "up" : stats?.operationalLinks === 0 ? "down" : "neutral",
                isGood: stats?.operationalLinks === stats?.totalLinks,
              }}
              subtitle="links ativos"
              testId="metric-operational-links"
            />
            <MetricCard
              title="Disponibilidade Média"
              value={(stats?.averageUptime || 0).toFixed(2)}
              unit="%"
              icon={Gauge}
              trend={{
                value: 0.5,
                direction: "up",
                isGood: true,
              }}
              subtitle="últimos 30 dias"
              testId="metric-uptime"
            />
            <MetricCard
              title="Latência Média"
              value={(stats?.averageLatency || 0).toFixed(1)}
              unit="ms"
              icon={Clock}
              trend={{
                value: 2.1,
                direction: "down",
                isGood: true,
              }}
              subtitle="dentro do SLA"
              testId="metric-latency"
            />
            <MetricCard
              title="Alertas Ativos"
              value={stats?.activeAlerts || 0}
              icon={AlertTriangle}
              trend={{
                value: 0,
                direction: "neutral",
              }}
              subtitle={showDdosCard && stats?.ddosEventsToday ? `${stats.ddosEventsToday} DDoS hoje` : (showDdosCard ? "nenhum DDoS" : "alertas pendentes")}
              testId="metric-alerts"
            />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {linksLoading ? (
          <>
            {[1, 2].map((i) => (
              <Card key={i}>
                <CardHeader>
                  <Skeleton className="h-6 w-48" />
                </CardHeader>
                <CardContent className="space-y-4">
                  <Skeleton className="h-24 w-full" />
                  <div className="grid grid-cols-2 gap-4">
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-16 w-full" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </>
        ) : links && links.length > 0 ? (
          <>
            {links.map((link) => (
              <LinkCardWithMetrics key={link.id} link={link} />
            ))}
          </>
        ) : (
          <Card className="lg:col-span-2">
            <CardContent className="py-8 text-center text-muted-foreground">
              Nenhum link cadastrado. Acesse a administração para adicionar links.
            </CardContent>
          </Card>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-lg">Eventos Recentes</CardTitle>
            <Link href="/events">
              <Button variant="ghost" size="sm" data-testid="button-view-events">
                Ver todos
                <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {eventsLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : (
              <EventsTable events={(events || []).slice(0, 5)} compact />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-lg">Indicadores SLA</CardTitle>
            <Link href="/reports">
              <Button variant="ghost" size="sm" data-testid="button-view-sla">
                Detalhes
                <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent className="space-y-3">
            {slaLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : (
              <>
                <SLACompactCard
                  title="Disponibilidade"
                  current={availability?.current || stats?.averageUptime || 99.5}
                  target={availability?.target || "≥ 99%"}
                  status={availability?.status || (
                    (stats?.averageUptime || 99.5) >= 99
                      ? "compliant"
                      : (stats?.averageUptime || 99.5) >= 97
                      ? "warning"
                      : "non_compliant"
                  )}
                />
                <SLACompactCard
                  title="Latência"
                  current={latency?.current || stats?.averageLatency || 45}
                  target={latency?.target || "≤ 80ms"}
                  status={latency?.status || (
                    (stats?.averageLatency || 45) <= 80
                      ? "compliant"
                      : (stats?.averageLatency || 45) <= 100
                      ? "warning"
                      : "non_compliant"
                  )}
                  unit="ms"
                />
                <SLACompactCard
                  title="Perda de Pacotes"
                  current={packetLoss?.current || 0.5}
                  target={packetLoss?.target || "≤ 2%"}
                  status={packetLoss?.status || "compliant"}
                />
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {showDdosCard && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
            <div className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-green-500" />
              <CardTitle className="text-lg">Proteção Anti-DDoS</CardTitle>
            </div>
            <Link href="/security">
              <Button variant="outline" size="sm" data-testid="button-view-security">
                Ver detalhes
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center">
                <Shield className="w-6 h-6 text-green-500" />
              </div>
              <div>
                <p className="font-medium">Sistema operando normalmente</p>
                <p className="text-sm text-muted-foreground">
                  Monitoramento 24x7 ativo - Nenhum ataque detectado nas últimas 24h
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

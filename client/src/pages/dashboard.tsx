import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MetricCard } from "@/components/metric-card";
import { LinkCard } from "@/components/link-card";
import { EventsTable } from "@/components/events-table";
import { SLACompactCard } from "@/components/sla-indicators";
import { Link } from "wouter";
import {
  Activity,
  AlertTriangle,
  Gauge,
  Clock,
  Shield,
  ArrowRight,
  RefreshCw,
} from "lucide-react";
import type { Link as LinkType, Event, DashboardStats, Metric } from "@shared/schema";

function LinkCardWithMetrics({ link }: { link: LinkType }) {
  const { data: metrics } = useQuery<Metric[]>({
    queryKey: ["/api/links", link.id, "metrics"],
    refetchInterval: 5000,
  });

  const metricsHistory = metrics?.map((m) => ({
    timestamp: typeof m.timestamp === 'string' ? m.timestamp : new Date(m.timestamp).toISOString(),
    download: m.download,
    upload: m.upload,
  })) || [];

  return <LinkCard link={link} metricsHistory={metricsHistory} />;
}

export default function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useQuery<DashboardStats>({
    queryKey: ["/api/stats"],
    refetchInterval: 5000,
  });

  const { data: links, isLoading: linksLoading } = useQuery<LinkType[]>({
    queryKey: ["/api/links"],
    refetchInterval: 5000,
  });

  const { data: events, isLoading: eventsLoading } = useQuery<Event[]>({
    queryKey: ["/api/events"],
    refetchInterval: 10000,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-muted-foreground">
            Monitoramento em tempo real dos links dedicados
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
                value: 0,
                direction: "neutral",
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
              subtitle={stats?.ddosEventsToday ? `${stats.ddosEventsToday} DDoS hoje` : "nenhum DDoS"}
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
            <SLACompactCard
              title="Disponibilidade"
              current={stats?.averageUptime || 99.5}
              target="≥ 99%"
              status={
                (stats?.averageUptime || 99.5) >= 99
                  ? "compliant"
                  : (stats?.averageUptime || 99.5) >= 97
                  ? "warning"
                  : "non_compliant"
              }
            />
            <SLACompactCard
              title="Latência"
              current={stats?.averageLatency || 45}
              target="≤ 80ms"
              status={
                (stats?.averageLatency || 45) <= 80
                  ? "compliant"
                  : (stats?.averageLatency || 45) <= 100
                  ? "warning"
                  : "non_compliant"
              }
              unit="ms"
            />
            <SLACompactCard
              title="Perda de Pacotes"
              current={0.5}
              target="≤ 2%"
              status="compliant"
            />
          </CardContent>
        </Card>
      </div>

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
    </div>
  );
}

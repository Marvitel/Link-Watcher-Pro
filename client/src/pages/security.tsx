import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MetricCard } from "@/components/metric-card";
import { DDoSPanel } from "@/components/ddos-panel";
import { useClientContext } from "@/lib/client-context";
import {
  Shield,
  ShieldCheck,
  ShieldAlert,
  Activity,
  Globe,
  Server,
  RefreshCw,
} from "lucide-react";
import type { DDoSEvent } from "@shared/schema";

export default function Security() {
  const { selectedClientId } = useClientContext();
  
  const ddosUrl = selectedClientId ? `/api/security/ddos?clientId=${selectedClientId}` : "/api/security/ddos";
  
  const { data: ddosEvents, isLoading } = useQuery<DDoSEvent[]>({
    queryKey: [ddosUrl],
    refetchInterval: 10000,
  });

  const activeAttacks = ddosEvents?.filter((e) => e.mitigationStatus !== "resolved").length || 0;
  const resolvedToday = ddosEvents?.filter((e) => {
    const today = new Date();
    const eventDate = new Date(e.startTime);
    return (
      e.mitigationStatus === "resolved" &&
      eventDate.toDateString() === today.toDateString()
    );
  }).length || 0;

  const totalBlocked = ddosEvents?.reduce((sum, e) => sum + e.blockedPackets, 0) || 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Segurança</h1>
          <p className="text-muted-foreground">
            Proteção Anti-DDoS e monitoramento de segurança 24x7
          </p>
        </div>
        <Button variant="outline" size="sm" data-testid="button-refresh">
          <RefreshCw className="w-4 h-4 mr-2" />
          Atualizar
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {isLoading ? (
          <>
            {[1, 2, 3, 4].map((i) => (
              <Card key={i}>
                <CardHeader className="pb-2">
                  <Skeleton className="h-4 w-24" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-8 w-20" />
                </CardContent>
              </Card>
            ))}
          </>
        ) : (
          <>
            <MetricCard
              title="Status"
              value={activeAttacks === 0 ? "Seguro" : "Em Ataque"}
              icon={activeAttacks === 0 ? ShieldCheck : ShieldAlert}
              subtitle="proteção ativa"
              testId="metric-status"
            />
            <MetricCard
              title="Ataques Ativos"
              value={activeAttacks}
              icon={Shield}
              trend={
                activeAttacks > 0
                  ? { value: activeAttacks, direction: "up", isGood: false }
                  : undefined
              }
              subtitle="em mitigação"
              testId="metric-active-attacks"
            />
            <MetricCard
              title="Mitigados Hoje"
              value={resolvedToday}
              icon={Activity}
              subtitle="ataques resolvidos"
              testId="metric-mitigated"
            />
            <MetricCard
              title="Pacotes Bloqueados"
              value={totalBlocked.toLocaleString()}
              icon={Globe}
              subtitle="total acumulado"
              testId="metric-blocked"
            />
          </>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Server className="w-5 h-5" />
            Centro de Operações de Segurança (SOC)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 rounded-md bg-muted/50">
              <p className="text-sm text-muted-foreground">Localização</p>
              <p className="font-semibold">Brasil</p>
              <p className="text-xs text-muted-foreground">Atendimento em português</p>
            </div>
            <div className="p-4 rounded-md bg-muted/50">
              <p className="text-sm text-muted-foreground">Disponibilidade</p>
              <p className="font-semibold">24x7x365</p>
              <p className="text-xs text-muted-foreground">Monitoramento contínuo</p>
            </div>
            <div className="p-4 rounded-md bg-muted/50">
              <p className="text-sm text-muted-foreground">Capacidade de Mitigação</p>
              <p className="font-semibold font-mono">2 Gbps</p>
              <p className="text-xs text-muted-foreground">10x a banda contratada</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Shield className="w-5 h-5" />
            Técnicas de Mitigação
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              "White/Black Lists",
              "Rate Limiting",
              "Challenge-Response",
              "Packet Filtering",
              "HTTP/S Protection",
              "DNS Protection",
              "VPN Protection",
              "UDP/ICMP Filtering",
            ].map((technique) => (
              <div
                key={technique}
                className="flex items-center gap-2 p-2 rounded-md bg-green-500/10 text-green-700 dark:text-green-400"
              >
                <ShieldCheck className="w-4 h-4" />
                <span className="text-sm">{technique}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-48" />
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          </CardContent>
        </Card>
      ) : (
        <DDoSPanel events={ddosEvents || []} />
      )}
    </div>
  );
}

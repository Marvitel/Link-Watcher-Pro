import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { MetricCard } from "@/components/metric-card";
import { DDoSPanel } from "@/components/ddos-panel";
import { ErrorBoundary } from "@/components/error-boundary";
import { useClientContext } from "@/lib/client-context";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Shield,
  ShieldCheck,
  ShieldAlert,
  ShieldBan,
  Activity,
  Server,
  RefreshCw,
  Network,
  Zap,
  Clock,
  TrendingUp,
} from "lucide-react";
import { format, formatDistanceToNow, isValid, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { DDoSEvent, ClientSettings } from "@shared/schema";
import { useMemo } from "react";

function safeFormatDate(dateValue: string | Date | null | undefined, formatStr: string = "dd/MM/yyyy HH:mm"): string {
  if (!dateValue) return "-";
  try {
    const date = dateValue instanceof Date ? dateValue : parseISO(dateValue);
    if (!isValid(date)) return "-";
    return format(date, formatStr, { locale: ptBR });
  } catch {
    return "-";
  }
}

function safeFormatDistanceToNow(dateValue: string | Date | null | undefined): string {
  if (!dateValue) return "-";
  try {
    const date = dateValue instanceof Date ? dateValue : parseISO(dateValue);
    if (!isValid(date)) return "-";
    return formatDistanceToNow(date, { addSuffix: true, locale: ptBR });
  } catch {
    return "-";
  }
}

interface MitigatedPrefix {
  prefix: string;
  connector: string;
  announcedAt: string;
  expiresAt: string | null;
  anomalyId: number | null;
}

function Security() {
  const { selectedClientId } = useClientContext();
  const queryClient = useQueryClient();
  
  const ddosUrl = selectedClientId ? `/api/security/ddos?clientId=${selectedClientId}` : "/api/security/ddos";
  const mitigatedUrl = selectedClientId ? `/api/clients/${selectedClientId}/wanguard/mitigated-prefixes` : null;
  
  const { data: ddosEvents, isLoading, refetch, isError } = useQuery<DDoSEvent[]>({
    queryKey: [ddosUrl],
    refetchInterval: 10000,
    retry: false,
    throwOnError: false,
  });
  
  const { data: clientSettings } = useQuery<ClientSettings>({
    queryKey: ["/api/clients", selectedClientId, "settings"],
    enabled: !!selectedClientId,
    throwOnError: false,
  });

  const { data: mitigatedPrefixes } = useQuery<MitigatedPrefix[]>({
    queryKey: [mitigatedUrl],
    enabled: !!selectedClientId && !!clientSettings?.wanguardEnabled,
    refetchInterval: 30000,
    throwOnError: false,
  });

  const activeAttacks = ddosEvents?.filter((e) => e.mitigationStatus !== "resolved") || [];
  const activeAttacksCount = activeAttacks.length;
  
  const resolvedToday = useMemo(() => {
    if (!ddosEvents) return [];
    const today = new Date();
    return ddosEvents.filter((e) => {
      const eventDate = new Date(e.startTime);
      return (
        e.mitigationStatus === "resolved" &&
        eventDate.toDateString() === today.toDateString()
      );
    });
  }, [ddosEvents]);

  const last7Days = useMemo(() => {
    if (!ddosEvents) return [];
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return ddosEvents.filter((e) => new Date(e.startTime) >= sevenDaysAgo);
  }, [ddosEvents]);

  const totalBlocked = ddosEvents?.reduce((sum, e) => sum + e.blockedPackets, 0) || 0;
  
  const peakBandwidth = useMemo(() => {
    if (!ddosEvents || ddosEvents.length === 0) return 0;
    return Math.max(...ddosEvents.map(e => e.peakBandwidth || 0));
  }, [ddosEvents]);

  const attacksByType = useMemo(() => {
    if (!ddosEvents) return {};
    return ddosEvents.reduce((acc, e) => {
      acc[e.attackType] = (acc[e.attackType] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  }, [ddosEvents]);

  const handleRefresh = () => {
    refetch();
    if (mitigatedUrl) {
      queryClient.invalidateQueries({ queryKey: [mitigatedUrl] });
    }
  };

  if (isError) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold">Segurança</h1>
            <p className="text-muted-foreground">
              Proteção Anti-DDoS e monitoramento de segurança 24x7
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-refresh">
            <RefreshCw className="w-4 h-4 mr-2" />
            Atualizar
          </Button>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <ShieldCheck className="w-12 h-12 text-green-500 mb-3" />
            <p className="text-lg font-medium">Nenhum dado disponível</p>
            <p className="text-sm text-muted-foreground">
              Não foi possível carregar os dados de segurança
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Segurança</h1>
          <p className="text-muted-foreground">
            Proteção Anti-DDoS e monitoramento de segurança 24x7
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleRefresh} data-testid="button-refresh">
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
              value={activeAttacksCount === 0 ? "Seguro" : "Em Ataque"}
              icon={activeAttacksCount === 0 ? ShieldCheck : ShieldAlert}
              trend={activeAttacksCount > 0 ? { value: activeAttacksCount, direction: "up", isGood: false } : undefined}
              subtitle={activeAttacksCount === 0 ? "proteção ativa" : `${activeAttacksCount} em mitigação`}
              testId="metric-status"
            />
            <MetricCard
              title="Últimos 7 Dias"
              value={last7Days.length}
              icon={Activity}
              subtitle={`${resolvedToday.length} resolvidos hoje`}
              testId="metric-week"
            />
            <MetricCard
              title="Pico Máximo"
              value={`${peakBandwidth.toFixed(1)} Gbps`}
              icon={TrendingUp}
              subtitle="maior ataque registrado"
              testId="metric-peak"
            />
            <MetricCard
              title="Pacotes Bloqueados"
              value={totalBlocked > 1000000 ? `${(totalBlocked / 1000000).toFixed(1)}M` : totalBlocked.toLocaleString()}
              icon={Shield}
              subtitle="total acumulado"
              testId="metric-blocked"
            />
          </>
        )}
      </div>

      {activeAttacks.length > 0 && (
        <Card className="border-red-500/50 bg-red-500/5">
          <CardHeader className="flex flex-row items-center gap-2 space-y-0">
            <ShieldAlert className="w-5 h-5 text-red-500" />
            <CardTitle className="text-lg text-red-600 dark:text-red-400">
              Ataques em Andamento
            </CardTitle>
            <Badge variant="destructive" className="ml-auto">
              {activeAttacks.length} ativo{activeAttacks.length > 1 ? "s" : ""}
            </Badge>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {activeAttacks.map((attack) => (
                <div
                  key={attack.id}
                  className="flex items-center justify-between p-4 rounded-lg bg-background border border-red-500/20"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center">
                      <Zap className="w-5 h-5 text-red-500" />
                    </div>
                    <div>
                      <p className="font-semibold">{attack.attackType}</p>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Network className="w-3 h-3" />
                          {attack.targetIp || "IP não identificado"}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {safeFormatDistanceToNow(attack.startTime)}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold font-mono text-red-600 dark:text-red-400">
                      {(attack.peakBandwidth || 0).toFixed(1)} Gbps
                    </p>
                    <Badge variant="outline" className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20">
                      {attack.mitigationStatus === "mitigating" ? "Mitigando" : "Detectado"}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {(() => {
        const activeMitigations = mitigatedPrefixes?.filter(p => p.anomalyId !== null) || [];
        if (activeMitigations.length === 0) return null;
        return (
          <Card className="border-amber-500/30">
            <CardHeader className="flex flex-row items-center gap-2 space-y-0">
              <ShieldBan className="w-5 h-5 text-amber-500" />
              <CardTitle className="text-lg">Prefixos em Mitigação BGP</CardTitle>
              <Badge variant="outline" className="ml-auto bg-amber-500/10 text-amber-600 border-amber-500/20">
                {activeMitigations.length} ativo{activeMitigations.length > 1 ? "s" : ""}
              </Badge>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Prefixo IP</TableHead>
                    <TableHead>Conector BGP</TableHead>
                    <TableHead>Anunciado em</TableHead>
                    <TableHead>Expira em</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activeMitigations.map((prefix, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="font-mono font-semibold">{prefix.prefix}</TableCell>
                      <TableCell>{prefix.connector}</TableCell>
                      <TableCell className="text-sm">
                        {safeFormatDate(prefix.announcedAt)}
                      </TableCell>
                      <TableCell className="text-sm">
                        {prefix.expiresAt 
                          ? safeFormatDate(prefix.expiresAt)
                          : <span className="text-muted-foreground">Manual</span>
                        }
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        );
      })()}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Server className="w-5 h-5" />
              Centro de Operações de Segurança (SOC)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4">
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
                <p className="font-semibold font-mono">{clientSettings?.ddosMitigationCapacity ?? 2} Gbps</p>
                <p className="text-xs text-muted-foreground">10x a banda contratada</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Zap className="w-5 h-5" />
              Tipos de Ataques ({Object.keys(attacksByType).length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {Object.keys(attacksByType).length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                <ShieldCheck className="w-12 h-12 mb-3 text-green-500" />
                <p>Nenhum ataque registrado</p>
              </div>
            ) : (
              <div className="space-y-3">
                {Object.entries(attacksByType)
                  .sort((a, b) => b[1] - a[1])
                  .map(([type, count]) => (
                    <div key={type} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Zap className="w-4 h-4 text-amber-500" />
                        <span className="text-sm font-medium">{type}</span>
                      </div>
                      <Badge variant="secondary">{count}</Badge>
                    </div>
                  ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Shield className="w-5 h-5" />
            Técnicas de Mitigação Disponíveis
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
              "BGP Flowspec",
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

export default function SecurityPage() {
  return (
    <ErrorBoundary>
      <Security />
    </ErrorBoundary>
  );
}

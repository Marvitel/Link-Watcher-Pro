import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { BandwidthChart } from "@/components/bandwidth-chart";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { 
  Layers, 
  ArrowLeft, 
  Shield, 
  ArrowUpDown, 
  Activity,
  Clock,
  Gauge,
  AlertTriangle,
  RefreshCw,
  Share2
} from "lucide-react";
import type { Link as LinkType, Metric } from "@shared/schema";

// Opções de período para os gráficos
const PERIOD_OPTIONS = [
  { value: "1h", label: "1h" },
  { value: "6h", label: "6h" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
] as const;

interface LinkGroupMember {
  id: number;
  groupId: number;
  linkId: number;
  role: string;
  displayOrder: number;
  link?: LinkType;
}

interface LinkGroup {
  id: number;
  clientId: number;
  name: string;
  description: string | null;
  groupType: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  members?: LinkGroupMember[];
}

interface AggregatedMetrics {
  download: number;
  upload: number;
  latency: number;
  packetLoss: number;
  status: string;
  membersOnline: number;
  membersTotal: number;
  metricsHistory: Array<{
    timestamp: string;
    download: number;
    upload: number;
    status: string;
  }>;
}

function formatBandwidth(mbps: number): string {
  // Values are stored in Mbps
  if (mbps >= 1000) {
    return `${(mbps / 1000).toFixed(2)} Gbps`;
  } else if (mbps >= 1) {
    return `${mbps.toFixed(2)} Mbps`;
  } else if (mbps >= 0.001) {
    return `${(mbps * 1000).toFixed(2)} Kbps`;
  }
  return `${(mbps * 1000000).toFixed(0)} bps`;
}

function getStatusBadge(status: string, membersOnline: number, membersTotal: number) {
  if (status === "operational") {
    if (membersOnline === membersTotal) {
      return <Badge className="bg-green-500/10 text-green-500 border-green-500/20">Online</Badge>;
    }
    return <Badge className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20">Degradado</Badge>;
  }
  if (status === "degraded") {
    return <Badge className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20">Degradado</Badge>;
  }
  return <Badge className="bg-red-500/10 text-red-500 border-red-500/20">Offline</Badge>;
}

function getMemberStatusBadge(status: string) {
  if (status === "operational") {
    return <Badge className="bg-green-500/10 text-green-500 border-green-500/20">Online</Badge>;
  }
  if (status === "degraded") {
    return <Badge className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20">Degradado</Badge>;
  }
  return <Badge className="bg-red-500/10 text-red-500 border-red-500/20">Offline</Badge>;
}

export default function LinkGroupDetail() {
  const { id } = useParams<{ id: string }>();
  const groupId = parseInt(id || "0", 10);
  const [selectedPeriod, setSelectedPeriod] = useState("24h");

  const { data: group, isLoading: groupLoading } = useQuery<LinkGroup>({
    queryKey: [`/api/link-groups/${groupId}`],
    enabled: groupId > 0,
    refetchInterval: 10000,
  });

  const { data: metrics, isLoading: metricsLoading } = useQuery<AggregatedMetrics>({
    queryKey: [`/api/link-groups/${groupId}/metrics`, selectedPeriod],
    queryFn: async () => {
      const res = await fetch(`/api/link-groups/${groupId}/metrics?period=${selectedPeriod}`);
      if (!res.ok) throw new Error("Failed to fetch metrics");
      return res.json();
    },
    enabled: groupId > 0,
    refetchInterval: 5000,
  });

  if (groupLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-10" />
          <Skeleton className="h-8 w-64" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-80" />
      </div>
    );
  }

  if (!group) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <AlertTriangle className="w-12 h-12 text-muted-foreground mb-4" />
        <h2 className="text-xl font-semibold mb-2">Grupo não encontrado</h2>
        <p className="text-muted-foreground mb-4">O grupo de links solicitado não existe.</p>
        <Link href="/">
          <Button>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Voltar ao Dashboard
          </Button>
        </Link>
      </div>
    );
  }

  const ProfileIcon = group.groupType === "redundancy" ? Shield : (group.groupType === "shared" ? Share2 : ArrowUpDown);
  const membersOnline = metrics?.membersOnline ?? group.members?.filter(m => m.link?.status === "operational").length ?? 0;
  const membersTotal = metrics?.membersTotal ?? group.members?.length ?? 0;
  const status = metrics?.status ?? "unknown";
  // bandwidth is stored in Mbps
  // For shared groups, use primary link bandwidth (contracted bandwidth)
  // For other groups, sum all members' bandwidth
  const totalBandwidth = (() => {
    if (group.groupType === "shared") {
      const primaryMember = group.members?.find(m => m.role === "primary");
      return primaryMember?.link?.bandwidth || group.members?.[0]?.link?.bandwidth || 0;
    }
    return group.members?.reduce((sum, m) => sum + (m.link?.bandwidth || 0), 0) || 0;
  })();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <Link href="/">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </Link>
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-primary/10">
              <Layers className="w-6 h-6 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-semibold">{group.name}</h1>
                {getStatusBadge(status, membersOnline, membersTotal)}
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <ProfileIcon className="w-4 h-4" />
                <span>{group.groupType === "redundancy" ? "Redundância" : (group.groupType === "shared" ? "Banda Compartilhada" : "Agregação")}</span>
                <span>•</span>
                <span>{membersOnline}/{membersTotal} links ativos</span>
              </div>
            </div>
          </div>
        </div>
        <Button variant="outline" size="sm" data-testid="button-refresh-group">
          <RefreshCw className="w-4 h-4 mr-2" />
          Atualizar
        </Button>
      </div>

      {group.description && (
        <p className="text-muted-foreground">{group.description}</p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Activity className="w-4 h-4" />
              Download
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-blue-600">
              {metricsLoading ? <Skeleton className="h-8 w-24" /> : formatBandwidth(metrics?.download || 0)}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {group.groupType === "aggregation" ? "Soma de todos os links" : "Link ativo"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Activity className="w-4 h-4" />
              Upload
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-green-600">
              {metricsLoading ? <Skeleton className="h-8 w-24" /> : formatBandwidth(metrics?.upload || 0)}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {group.groupType === "aggregation" ? "Soma de todos os links" : "Link ativo"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Clock className="w-4 h-4" />
              Latência
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {metricsLoading ? <Skeleton className="h-8 w-20" /> : `${(metrics?.latency || 0).toFixed(1)} ms`}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {group.groupType === "aggregation" ? "Média dos links" : "Link ativo"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Gauge className="w-4 h-4" />
              Perda de Pacotes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {metricsLoading ? <Skeleton className="h-8 w-16" /> : `${(metrics?.packetLoss || 0).toFixed(2)}%`}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {group.groupType === "aggregation" ? "Máximo entre links" : "Link ativo"}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 flex-wrap">
          <CardTitle className="text-lg">Consumo de Banda</CardTitle>
          <div className="flex items-center gap-3 flex-wrap">
            <ToggleGroup 
              type="single" 
              value={selectedPeriod} 
              onValueChange={(value) => {
                if (value) setSelectedPeriod(value);
              }}
              className="border rounded-md"
              data-testid="toggle-period-bandwidth"
            >
              {PERIOD_OPTIONS.map((option) => (
                <ToggleGroupItem 
                  key={option.value} 
                  value={option.value}
                  size="sm"
                  className="px-3 text-xs"
                  data-testid={`toggle-period-${option.label}`}
                >
                  {option.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <div className="flex items-center gap-2 text-xs">
              <span className="flex items-center gap-1">
                <span className="w-3 h-3 rounded-full bg-blue-500"></span>
                Download
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3 h-3 rounded-full bg-green-500"></span>
                Upload
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {metricsLoading || !metrics?.metricsHistory ? (
            <Skeleton className="h-80 w-full" />
          ) : metrics.metricsHistory.length > 0 ? (
            <BandwidthChart data={metrics.metricsHistory} height={300} showAxes />
          ) : (
            <div className="flex items-center justify-center h-80 text-muted-foreground">
              Aguardando dados de métricas...
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Links do Grupo</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {group.members?.map((member) => (
              <Link key={member.id} href={`/link/${member.linkId}`}>
                <div className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors cursor-pointer">
                  <div className="flex items-center gap-4">
                    <div className="flex flex-col">
                      <span className="font-medium">{member.link?.name || `Link ${member.linkId}`}</span>
                      <span className="text-sm text-muted-foreground">
                        {member.link?.monitoredIp || "IP não configurado"}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <Badge variant="outline">{member.role}</Badge>
                    {member.link && (
                      <>
                        <span className="text-sm text-muted-foreground">
                          {formatBandwidth(member.link.bandwidth)}
                        </span>
                        {getMemberStatusBadge(member.link.status)}
                      </>
                    )}
                  </div>
                </div>
              </Link>
            ))}
            {(!group.members || group.members.length === 0) && (
              <div className="py-8 text-center text-muted-foreground">
                Nenhum link associado a este grupo.
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Informações do Grupo</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-muted-foreground">Tipo de Grupo</dt>
              <dd className="font-medium">
                {group.groupType === "redundancy" ? "Redundância (Ativo/Passivo)" : (group.groupType === "shared" ? "Banda Compartilhada (Múltiplas VLANs)" : "Agregação (Dual-Stack/Bonding)")}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Banda Total Contratada</dt>
              <dd className="font-medium">{formatBandwidth(totalBandwidth)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Links no Grupo</dt>
              <dd className="font-medium">{membersTotal} link{membersTotal === 1 ? "" : "s"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Status</dt>
              <dd className="font-medium">
                {membersOnline === membersTotal 
                  ? "Todos os links operacionais" 
                  : `${membersOnline} de ${membersTotal} links operacionais`}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}

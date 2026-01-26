import { useQuery, useQueries } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MetricCard } from "@/components/metric-card";
import { LinkCard } from "@/components/link-card";
import { BandwidthChart } from "@/components/bandwidth-chart";
import { LinksTable } from "@/components/links-table";
import { EventsTable } from "@/components/events-table";
import { SLACompactCard } from "@/components/sla-indicators";
import { LinkGroupCard } from "@/components/link-group-card";
import { useClientContext } from "@/lib/client-context";
import { useAuth } from "@/lib/auth";
import { Link } from "wouter";
import { Component, ErrorInfo, ReactNode, useState, useMemo, useEffect } from "react";
import {
  Activity,
  AlertTriangle,
  Gauge,
  Clock,
  Shield,
  ShieldAlert,
  ArrowRight,
  RefreshCw,
  Building2,
  LayoutGrid,
  List,
  Layers,
  Search,
  Wifi,
  WifiOff,
  Download,
  Upload,
  Bell,
  Ticket,
  ChevronLeft,
  ChevronRight,
  SquareStack,
  Zap,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Link as LinkType, Event, DashboardStats, Metric, Client, SLAIndicator, LinkDashboardResponse, LinkDashboardItem } from "@shared/schema";

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[Dashboard Error]", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-8 text-center">
          <h2 className="text-xl font-bold text-destructive mb-4">Erro no Dashboard</h2>
          <p className="text-muted-foreground mb-2">Ocorreu um erro ao renderizar o dashboard.</p>
          <pre className="text-sm bg-muted p-4 rounded text-left overflow-auto max-h-48">
            {this.state.error?.message}
          </pre>
          <Button className="mt-4" onClick={() => window.location.reload()}>
            Recarregar Página
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}

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

// Formata bytes para unidade legível
function formatBandwidth(mbps: number): string {
  if (mbps >= 1000) {
    return `${(mbps / 1000).toFixed(2)} Gbps`;
  }
  return `${mbps.toFixed(1)} Mbps`;
}

// Card de link individual para o dashboard do Super Admin
function SuperAdminLinkCard({ item, onViewClient }: { 
  item: LinkDashboardItem; 
  onViewClient: (clientId: number, clientName: string) => void;
}) {
  const statusColors: Record<string, string> = {
    operational: "border-l-green-500",
    degraded: "border-l-yellow-500",
    offline: "border-l-red-500",
    down: "border-l-red-500",
  };

  const statusInfo = item.status === "operational" 
    ? { label: "Online", className: "bg-green-500 text-white" }
    : item.status === "degraded"
    ? { label: "Degradado", className: "bg-yellow-500 text-white" }
    : item.status === "offline" || item.status === "down"
    ? { label: "Offline", className: "bg-red-500 text-white" }
    : { label: item.status, className: "" };

  const borderColor = statusColors[item.status] || "border-l-gray-400";

  // Extrai o motivo da falha do evento ativo
  const getFailureReason = () => {
    if (!item.activeEvent) return null;
    const desc = item.activeEvent.description?.toLowerCase() || "";
    
    // Mapeia palavras-chave para causas legíveis
    if (desc.includes("rompimento") || desc.includes("fibra")) return "Rompimento de Fibra";
    if (desc.includes("energia") || desc.includes("power")) return "Queda de Energia";
    if (desc.includes("perda de pacotes") || desc.includes("packet loss")) return "Perda de Pacotes";
    if (desc.includes("atenuação") || desc.includes("sinal") || desc.includes("optical")) return "Sinal Atenuado";
    if (desc.includes("saturação") || desc.includes("banda") || desc.includes("bandwidth")) return "Saturação de Banda";
    if (desc.includes("latência") || desc.includes("latency")) return "Alta Latência";
    if (desc.includes("timeout") || desc.includes("sem resposta")) return "Timeout/Sem Resposta";
    if (desc.includes("degradação") || desc.includes("degraded")) return "Degradação de Desempenho";
    
    // Se não encontrar padrão, retorna parte da descrição
    if (item.activeEvent.description && item.activeEvent.description.length > 0) {
      return item.activeEvent.description.length > 50 
        ? item.activeEvent.description.substring(0, 47) + "..."
        : item.activeEvent.description;
    }
    return item.activeEvent.type === 'offline' ? 'Link Offline' : 'Problema Detectado';
  };

  // Cor da latência baseada em thresholds
  const getLatencyColor = (lat: number) => {
    if (lat <= 50) return "text-green-600 dark:text-green-400";
    if (lat <= 80) return "text-yellow-600 dark:text-yellow-400";
    return "text-red-600 dark:text-red-400";
  };

  // Cor da perda baseada em thresholds
  const getLossColor = (loss: number) => {
    if (loss <= 1) return "text-green-600 dark:text-green-400";
    if (loss <= 2) return "text-yellow-600 dark:text-yellow-400";
    return "text-red-600 dark:text-red-400";
  };

  return (
    <Card 
      className={`border-l-4 ${borderColor} hover-elevate transition-all`}
      data-testid={`card-link-${item.id}`}
    >
      <CardContent className="p-4 space-y-3">
        {/* Header: Cliente e Status */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <button
              onClick={() => onViewClient(item.clientId, item.clientName)}
              className="text-xs font-medium text-primary hover:underline truncate block"
              data-testid={`button-view-client-${item.clientId}`}
            >
              {item.clientName}
            </button>
            <Link href={`/link/${item.id}`}>
              <h3 className="font-semibold text-sm truncate hover:text-primary cursor-pointer" title={item.name}>
                {item.name}
              </h3>
            </Link>
            <p className="text-xs text-muted-foreground truncate" title={item.ipBlock}>
              {item.ipBlock} • {item.location}
            </p>
          </div>
          <Badge className={`shrink-0 ${statusInfo.className}`}>
            {statusInfo.label}
          </Badge>
        </div>

        {/* Métricas de Tráfego */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="flex items-center gap-1">
            <Download className="w-3 h-3 text-blue-500" />
            <span className="text-muted-foreground">DL:</span>
            <span className="font-mono font-medium">{formatBandwidth(item.currentDownload)}</span>
          </div>
          <div className="flex items-center gap-1">
            <Upload className="w-3 h-3 text-green-500" />
            <span className="text-muted-foreground">UL:</span>
            <span className="font-mono font-medium">{formatBandwidth(item.currentUpload)}</span>
          </div>
        </div>

        {/* Latência e Perda */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            <span className="text-muted-foreground">Lat:</span>
            <span className={`font-mono font-medium ${getLatencyColor(item.latency)}`}>
              {item.latency.toFixed(1)}ms
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Activity className="w-3 h-3" />
            <span className="text-muted-foreground">Perda:</span>
            <span className={`font-mono font-medium ${getLossColor(item.packetLoss)}`}>
              {item.packetLoss.toFixed(1)}%
            </span>
          </div>
        </div>

        {/* Uptime/SLA */}
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-1">
            <Gauge className="w-3 h-3" />
            <span className="text-muted-foreground">SLA:</span>
            <span className={`font-mono font-medium ${item.uptime >= 99 ? 'text-green-600 dark:text-green-400' : item.uptime >= 95 ? 'text-yellow-600 dark:text-yellow-400' : 'text-red-600 dark:text-red-400'}`}>
              {item.uptime.toFixed(2)}%
            </span>
          </div>
          <span className="text-muted-foreground">
            {item.bandwidth} Mbps
          </span>
        </div>

        {/* Motivo da Falha e Tickets */}
        {(item.activeEvent || item.openIncident) && (
          <div className="pt-2 border-t border-border space-y-1.5">
            {item.activeEvent && (
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-3.5 h-3.5 text-destructive shrink-0 mt-0.5" />
                <span className="text-xs text-destructive font-medium" title={item.activeEvent.description}>
                  {getFailureReason()}
                </span>
              </div>
            )}
            {item.openIncident && (
              <div className="flex items-center gap-2">
                <Ticket className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="text-xs text-muted-foreground">
                  {item.openIncident.voalleProtocolId ? `Ticket #${item.openIncident.voalleProtocolId}` : 'Incidente Aberto'}
                </span>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Dashboard completo de links para Super Admin
function SuperAdminLinkDashboard({ 
  clients, 
  setSelectedClient 
}: { 
  clients: Client[];
  setSelectedClient: (id: number, name: string) => void;
}) {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [clientFilter, setClientFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 50;

  // Debounce search with useEffect
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Build query URL with filters
  const queryUrl = useMemo(() => {
    const params = new URLSearchParams();
    params.set("page", page.toString());
    params.set("pageSize", pageSize.toString());
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (clientFilter !== "all") params.set("clientId", clientFilter);
    if (debouncedSearch) params.set("search", debouncedSearch);
    return `/api/super-admin/link-dashboard?${params.toString()}`;
  }, [page, statusFilter, clientFilter, debouncedSearch]);

  const { data, isLoading, isFetching, isError, refetch } = useQuery<LinkDashboardResponse>({
    queryKey: [queryUrl],
    refetchInterval: 10000,
    staleTime: 5000,
    retry: 3,
  });

  const handleStatusChange = (value: string) => {
    setStatusFilter(value);
    setPage(1);
  };

  const handleClientChange = (value: string) => {
    setClientFilter(value);
    setPage(1);
  };

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por link, cliente, IP..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            data-testid="input-search-links"
          />
        </div>

        <Tabs value={statusFilter} onValueChange={handleStatusChange}>
          <TabsList>
            <TabsTrigger value="all" data-testid="tab-status-all">
              Todos
              {data?.summary && (
                <span className="ml-1 text-xs opacity-70">({data.summary.totalLinks})</span>
              )}
            </TabsTrigger>
            <TabsTrigger value="operational" data-testid="tab-status-online">
              <Wifi className="w-3 h-3 mr-1" />
              Online
              {data?.summary && (
                <span className="ml-1 text-xs opacity-70">({data.summary.onlineLinks})</span>
              )}
            </TabsTrigger>
            <TabsTrigger value="degraded" data-testid="tab-status-degraded">
              <AlertTriangle className="w-3 h-3 mr-1" />
              Degradado
              {data?.summary && (
                <span className="ml-1 text-xs opacity-70">({data.summary.degradedLinks})</span>
              )}
            </TabsTrigger>
            <TabsTrigger value="offline" data-testid="tab-status-offline">
              <WifiOff className="w-3 h-3 mr-1" />
              Offline
              {data?.summary && (
                <span className="ml-1 text-xs opacity-70">({data.summary.offlineLinks})</span>
              )}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <Select value={clientFilter} onValueChange={handleClientChange}>
          <SelectTrigger className="w-[200px]" data-testid="select-client-filter">
            <SelectValue placeholder="Filtrar por cliente" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os clientes</SelectItem>
            {clients.map((client) => (
              <SelectItem key={client.id} value={client.id.toString()}>
                {client.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {isFetching && !isLoading && (
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <RefreshCw className="w-3 h-3 animate-spin" />
            Atualizando...
          </div>
        )}
      </div>

      {/* Contadores Resumidos */}
      {data?.summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <Card className="p-3">
            <div className="text-2xl font-bold">{data.summary.totalLinks}</div>
            <div className="text-xs text-muted-foreground">Total de Links</div>
          </Card>
          <Card className="p-3 border-l-4 border-l-green-500">
            <div className="text-2xl font-bold text-green-600">{data.summary.onlineLinks}</div>
            <div className="text-xs text-muted-foreground">Online</div>
          </Card>
          <Card className="p-3 border-l-4 border-l-yellow-500">
            <div className="text-2xl font-bold text-yellow-600">{data.summary.degradedLinks}</div>
            <div className="text-xs text-muted-foreground">Degradados</div>
          </Card>
          <Card className="p-3 border-l-4 border-l-red-500">
            <div className="text-2xl font-bold text-red-600">{data.summary.offlineLinks}</div>
            <div className="text-xs text-muted-foreground">Offline</div>
          </Card>
          <Card className="p-3">
            <div className="text-2xl font-bold text-orange-600">{data.summary.activeAlerts}</div>
            <div className="text-xs text-muted-foreground">Alertas Ativos</div>
          </Card>
          <Card className="p-3">
            <div className="text-2xl font-bold text-purple-600">{data.summary.openIncidents}</div>
            <div className="text-xs text-muted-foreground">Incidentes Abertos</div>
          </Card>
        </div>
      )}

      {/* Grid de Cards */}
      {isError ? (
        <Card>
          <CardContent className="py-12 text-center">
            <AlertTriangle className="w-12 h-12 mx-auto mb-4 text-destructive" />
            <div className="text-lg font-medium mb-2">Erro ao carregar dados</div>
            <div className="text-sm text-muted-foreground mb-4">
              Não foi possível carregar os links. Verifique sua conexão e tente novamente.
            </div>
            <Button onClick={() => refetch()} data-testid="button-retry-load">
              <RefreshCw className="w-4 h-4 mr-2" />
              Tentar novamente
            </Button>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <Skeleton key={i} className="h-48 w-full" />
          ))}
        </div>
      ) : data?.items && data.items.length > 0 ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {data.items.map((item) => (
              <SuperAdminLinkCard 
                key={item.id} 
                item={item} 
                onViewClient={setSelectedClient}
              />
            ))}
          </div>

          {/* Paginação */}
          {data.totalPages > 1 && (
            <div className="flex items-center justify-between pt-4">
              <div className="text-sm text-muted-foreground">
                Mostrando {((page - 1) * pageSize) + 1}-{Math.min(page * pageSize, data.totalItems)} de {data.totalItems} links
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  data-testid="button-prev-page"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Anterior
                </Button>
                <span className="text-sm">
                  Página {page} de {data.totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => Math.min(data.totalPages, p + 1))}
                  disabled={page === data.totalPages}
                  data-testid="button-next-page"
                >
                  Próxima
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      ) : (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            {debouncedSearch || statusFilter !== "all" || clientFilter !== "all" 
              ? "Nenhum link encontrado com os filtros aplicados."
              : "Nenhum link cadastrado."}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

type ViewMode = "cards" | "compact" | "table";

// Card compacto para visualização resumida com métricas em tempo real
function CompactLinkCardWithMetrics({ link }: { link: LinkType }) {
  const { data: metrics } = useQuery<Metric[]>({
    queryKey: [`/api/links/${link.id}/metrics`],
    refetchInterval: 5000,
    staleTime: 0,
  });

  const metricsHistory = metrics ? [...metrics]
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    .map((m) => ({
      timestamp: typeof m.timestamp === 'string' ? m.timestamp : new Date(m.timestamp).toISOString(),
      download: m.download,
      upload: m.upload,
      status: m.status,
    })) : [];

  return <CompactLinkCard link={link} metricsHistory={metricsHistory} />;
}

function CompactLinkCard({ link, metricsHistory = [] }: { 
  link: LinkType; 
  metricsHistory?: Array<{ timestamp: string; download: number; upload: number; status?: string }>;
}) {
  const statusColors: Record<string, string> = {
    operational: "border-l-green-500",
    degraded: "border-l-yellow-500",
    offline: "border-l-red-500",
    down: "border-l-red-500",
  };

  const statusInfo = link.status === "operational" 
    ? { label: "Online", className: "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20" }
    : link.status === "degraded"
    ? { label: "Degradado", className: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20" }
    : { label: "Offline", className: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20" };

  const borderColor = statusColors[link.status] || "border-l-gray-400";

  const getLatencyColor = (lat: number) => {
    if (lat <= 50) return "text-green-600 dark:text-green-400";
    if (lat <= 80) return "text-yellow-600 dark:text-yellow-400";
    return "text-red-600 dark:text-red-400";
  };

  const getLossColor = (loss: number) => {
    if (loss <= 1) return "text-green-600 dark:text-green-400";
    if (loss <= 2) return "text-yellow-600 dark:text-yellow-400";
    return "text-red-600 dark:text-red-400";
  };

  // Inversão de banda (padrão para concentradores)
  const rawDownload = link.currentDownload ?? 0;
  const rawUpload = link.currentUpload ?? 0;
  const keepOriginal = (link as any)?.invertBandwidth ?? false;
  const currentDownload = keepOriginal ? rawDownload : rawUpload;
  const currentUpload = keepOriginal ? rawUpload : rawDownload;
  const latency = link.latency ?? 0;
  const packetLoss = link.packetLoss ?? 0;
  const uptime = link.uptime ?? 0;

  const formatBw = (mbps: number): string => {
    if (mbps >= 1000) return `${(mbps / 1000).toFixed(1)} Gbps`;
    return `${mbps.toFixed(0)} Mbps`;
  };

  return (
    <Link href={`/link/${link.id}`}>
      <Card 
        className={`border-l-4 ${borderColor} hover-elevate cursor-pointer transition-all h-full`}
        data-testid={`card-compact-link-${link.id}`}
      >
        <CardContent className="p-3 space-y-2">
          {/* Header: Nome e Status */}
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                {link.status === "operational" ? (
                  <Wifi className="h-3.5 w-3.5 text-green-500 shrink-0" />
                ) : link.status === "degraded" ? (
                  <Wifi className="h-3.5 w-3.5 text-yellow-500 shrink-0" />
                ) : (
                  <WifiOff className="h-3.5 w-3.5 text-red-500 shrink-0" />
                )}
                <span className="font-medium text-sm truncate" title={link.name}>
                  {link.name}
                </span>
              </div>
              <p className="text-xs text-muted-foreground truncate mt-0.5" title={link.location || ""}>
                {link.location || "Sem localização"}
              </p>
            </div>
            <Badge variant="outline" className={`text-[10px] shrink-0 ${statusInfo.className}`}>
              {statusInfo.label}
            </Badge>
          </div>

          {/* Mini Gráfico de Banda */}
          {metricsHistory.length > 0 && (
            <div className="h-12 -mx-1">
              <BandwidthChart data={metricsHistory} height={48} invertBandwidth={(link as any).invertBandwidth} />
            </div>
          )}
          
          {/* Banda Atual */}
          <div className="grid grid-cols-2 gap-2">
            <div className="flex items-center gap-1.5 bg-blue-500/5 rounded px-2 py-1">
              <Download className="h-3 w-3 text-blue-500" />
              <div className="min-w-0">
                <p className="text-[10px] text-muted-foreground">Download</p>
                <p className="text-xs font-mono font-medium truncate">{formatBw(currentDownload)}</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 bg-green-500/5 rounded px-2 py-1">
              <Upload className="h-3 w-3 text-green-500" />
              <div className="min-w-0">
                <p className="text-[10px] text-muted-foreground">Upload</p>
                <p className="text-xs font-mono font-medium truncate">{formatBw(currentUpload)}</p>
              </div>
            </div>
          </div>

          {/* Métricas: Latência, Perda, Uptime */}
          <div className="grid grid-cols-3 gap-1 text-center pt-1 border-t">
            <div>
              <p className="text-[10px] text-muted-foreground">Latência</p>
              <p className={`text-xs font-mono font-medium ${getLatencyColor(latency)}`}>
                {latency.toFixed(0)}ms
              </p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground">Perda</p>
              <p className={`text-xs font-mono font-medium ${getLossColor(packetLoss)}`}>
                {packetLoss.toFixed(2)}%
              </p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground">Uptime</p>
              <p className="text-xs font-mono font-medium">{uptime.toFixed(2)}%</p>
            </div>
          </div>

          {/* Footer: IP */}
          <div className="flex items-center justify-between pt-1 border-t text-[10px] text-muted-foreground">
            <span className="font-medium">IP:</span>
            <span className="font-mono truncate ml-1" title={link.ipBlock || ""}>
              {link.ipBlock || "N/A"}
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function DashboardContent() {
  const { isSuperAdmin } = useAuth();
  const { selectedClientId, selectedClientName, setSelectedClient, isViewingAsClient } = useClientContext();
  
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = sessionStorage.getItem("link_monitor_view_mode");
    return (saved === "table" || saved === "cards" || saved === "compact") ? saved : "cards";
  });

  const handleViewModeChange = (mode: ViewMode) => {
    setViewMode(mode);
    sessionStorage.setItem("link_monitor_view_mode", mode);
  };

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

  const ddosUrl = selectedClientId ? `/api/security/ddos?clientId=${selectedClientId}` : "/api/security/ddos";
  const { data: ddosEvents } = useQuery<{ id: number; attackType: string; startTime: string; mitigationStatus: string; peakBandwidth: number | null; targetIp: string | null }[]>({
    queryKey: [ddosUrl],
    refetchInterval: 10000,
    enabled: showDdosCard,
  });

  const activeDdosAttacks = useMemo(() => 
    ddosEvents?.filter(e => e.mitigationStatus !== "resolved") || [], 
    [ddosEvents]
  );
  
  const recentDdosEvents = useMemo(() => {
    if (!ddosEvents) return [];
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    return ddosEvents.filter(e => new Date(e.startTime) >= last24h);
  }, [ddosEvents]);

  const { data: links, isLoading: linksLoading } = useQuery<LinkType[]>({
    queryKey: [linksUrl],
    refetchInterval: 5000,
  });
  
  const linksArray = useMemo(() => Array.isArray(links) ? links : [], [links]);
  const linkCount = linksArray.length;

  const metricsQueries = useQueries({
    queries: linksArray.map((link) => ({
      queryKey: [`/api/links/${link.id}/metrics`],
      refetchInterval: viewMode === "table" ? 10000 : 5000,
      staleTime: 5000,
      enabled: viewMode === "table" && linksArray.length > 0,
    })),
  });

  const metricsMap = useMemo(() => {
    const map: Record<number, Metric[]> = {};
    linksArray.forEach((link, index) => {
      const queryResult = metricsQueries[index];
      if (queryResult?.data && Array.isArray(queryResult.data)) {
        map[link.id] = queryResult.data;
      }
    });
    return map;
  }, [linksArray, metricsQueries]);

  const { data: eventsData, isLoading: eventsLoading } = useQuery<{ events: Event[]; total: number }>({
    queryKey: [eventsUrl],
    refetchInterval: 10000,
  });
  const events = eventsData?.events || [];

  const slaUrl = selectedClientId ? `/api/sla?clientId=${selectedClientId}&type=accumulated` : "/api/sla?type=accumulated";
  const { data: slaIndicators, isLoading: slaLoading } = useQuery<SLAIndicator[]>({
    queryKey: [slaUrl],
    refetchInterval: 30000,
  });

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

  const linkGroupsUrl = selectedClientId 
    ? `/api/link-groups?clientId=${selectedClientId}` 
    : "/api/link-groups";
  const { data: linkGroups, isLoading: linkGroupsLoading } = useQuery<LinkGroup[]>({
    queryKey: [linkGroupsUrl],
    refetchInterval: 10000,
  });

  const linkGroupsArray = useMemo(() => 
    Array.isArray(linkGroups) ? linkGroups : [], 
    [linkGroups]
  );

  // Helper to get SLA indicator by id
  const getSLAIndicator = (id: string) => slaIndicators?.find(i => i.id === id);
  const availability = getSLAIndicator("sla-de"); // Disponibilidade do Enlace
  const latency = getSLAIndicator("sla-lat"); // Latência
  const packetLoss = getSLAIndicator("sla-dp"); // Descarte de Pacotes

  // Loading state for client dashboard - show skeleton while data loads
  const isLoading = statsLoading || linksLoading;

  if (isSuperAdmin && !isViewingAsClient) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold">Painel Marvitel</h1>
            <p className="text-muted-foreground">
              Monitoramento em tempo real de todos os links - Clique em um cliente para ver detalhes
            </p>
          </div>
        </div>

        {clientsLoading ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                <Skeleton key={i} className="h-48 w-full" />
              ))}
            </div>
          </div>
        ) : clients && clients.length > 0 ? (
          <SuperAdminLinkDashboard 
            clients={clients} 
            setSelectedClient={setSelectedClient} 
          />
        ) : (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              Nenhum cliente cadastrado. Acesse Administração para adicionar clientes.
            </CardContent>
          </Card>
        )}
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
              value={`${stats?.operationalLinks ?? 0}/${stats?.totalLinks ?? 0}`}
              icon={Activity}
              trend={{
                value: (stats?.totalLinks ?? 0) > 0 ? Math.round(((stats?.operationalLinks ?? 0) / (stats?.totalLinks ?? 1)) * 100) : 0,
                direction: (stats?.operationalLinks ?? 0) === (stats?.totalLinks ?? 0) ? "up" : (stats?.operationalLinks ?? 0) === 0 ? "down" : "neutral",
                isGood: (stats?.operationalLinks ?? 0) === (stats?.totalLinks ?? 0),
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

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-4">
          <div>
            <CardTitle className="text-lg">Links Monitorados</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              {linkCount} {linkCount === 1 ? "link" : "links"} cadastrado{linkCount === 1 ? "" : "s"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center border rounded-md">
              <Button
                variant={viewMode === "cards" ? "default" : "ghost"}
                size="sm"
                className="rounded-r-none"
                onClick={() => handleViewModeChange("cards")}
                title="Gráficos"
                data-testid="button-view-cards"
              >
                <LayoutGrid className="h-4 w-4" />
              </Button>
              <Button
                variant={viewMode === "compact" ? "default" : "ghost"}
                size="sm"
                className="rounded-none border-x"
                onClick={() => handleViewModeChange("compact")}
                title="Cards Compactos"
                data-testid="button-view-compact"
              >
                <SquareStack className="h-4 w-4" />
              </Button>
              <Button
                variant={viewMode === "table" ? "default" : "ghost"}
                size="sm"
                className="rounded-l-none"
                onClick={() => handleViewModeChange("table")}
                title="Lista"
                data-testid="button-view-table"
              >
                <List className="h-4 w-4" />
              </Button>
            </div>
            <Link href="/links">
              <Button variant="ghost" size="sm" data-testid="button-view-all-links">
                Ver todos
                <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {linksLoading ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
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
            </div>
          ) : linksArray.length > 0 ? (
            viewMode === "table" ? (
              <LinksTable links={linksArray} metricsMap={metricsMap} pageSize={10} />
            ) : viewMode === "compact" ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {linksArray.map((link) => (
                  <CompactLinkCardWithMetrics key={link.id} link={link} />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {linksArray.map((link) => (
                  <LinkCardWithMetrics key={link.id} link={link} />
                ))}
              </div>
            )
          ) : (
            <div className="py-8 text-center text-muted-foreground">
              Nenhum link cadastrado. Acesse a administração para adicionar links.
            </div>
          )}
        </CardContent>
      </Card>

      {linkGroupsArray.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-4">
            <div>
              <CardTitle className="text-lg">Grupos de Links</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                {linkGroupsArray.length} grupo{linkGroupsArray.length === 1 ? "" : "s"} configurado{linkGroupsArray.length === 1 ? "" : "s"}
              </p>
            </div>
            <Link href="/admin?tab=link-groups">
              <Button variant="ghost" size="sm" data-testid="button-view-all-groups">
                Ver todos
                <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {linkGroupsLoading ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {[1, 2].map((i) => (
                  <Card key={i}>
                    <CardHeader>
                      <Skeleton className="h-6 w-48" />
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <Skeleton className="h-24 w-full" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {linkGroupsArray.slice(0, 4).map((group) => (
                  <LinkGroupCard key={group.id} group={group} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

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
              <EventsTable events={events.slice(0, 5)} compact />
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
        <Card className={activeDdosAttacks.length > 0 ? "border-red-500/50" : ""}>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
            <div className="flex items-center gap-2">
              {activeDdosAttacks.length > 0 ? (
                <ShieldAlert className="w-5 h-5 text-red-500" />
              ) : (
                <Shield className="w-5 h-5 text-green-500" />
              )}
              <CardTitle className="text-lg">Proteção Anti-DDoS</CardTitle>
              {activeDdosAttacks.length > 0 && (
                <Badge variant="destructive" className="ml-2">
                  {activeDdosAttacks.length} ativo{activeDdosAttacks.length > 1 ? "s" : ""}
                </Badge>
              )}
            </div>
            <Link href="/security">
              <Button variant="outline" size="sm" data-testid="button-view-security">
                Ver detalhes
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {activeDdosAttacks.length > 0 ? (
              <div className="space-y-3">
                {activeDdosAttacks.slice(0, 3).map((attack) => (
                  <div key={attack.id} className="flex items-center justify-between p-3 rounded-md bg-red-500/10 border border-red-500/20">
                    <div className="flex items-center gap-3">
                      <ShieldAlert className="w-5 h-5 text-red-500" />
                      <div>
                        <p className="font-medium text-red-600 dark:text-red-400">{attack.attackType}</p>
                        <p className="text-xs text-muted-foreground">
                          {attack.targetIp || "IP não identificado"} - Pico: {attack.peakBandwidth?.toFixed(1) || 0} Gbps
                        </p>
                      </div>
                    </div>
                    <Badge variant="outline" className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20">
                      {attack.mitigationStatus === "mitigating" ? "Mitigando" : "Detectado"}
                    </Badge>
                  </div>
                ))}
                {activeDdosAttacks.length > 3 && (
                  <p className="text-sm text-muted-foreground text-center">
                    + {activeDdosAttacks.length - 3} ataque(s) adicional(is)
                  </p>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center">
                  <Shield className="w-6 h-6 text-green-500" />
                </div>
                <div>
                  <p className="font-medium">Sistema operando normalmente</p>
                  <p className="text-sm text-muted-foreground">
                    Monitoramento 24x7 ativo - {recentDdosEvents.length > 0 
                      ? `${recentDdosEvents.length} ataque(s) nas últimas 24h (resolvidos)`
                      : "Nenhum ataque detectado nas últimas 24h"}
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function Dashboard() {
  return (
    <ErrorBoundary>
      <DashboardContent />
    </ErrorBoundary>
  );
}

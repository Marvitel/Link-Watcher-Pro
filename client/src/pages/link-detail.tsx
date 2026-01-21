import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { getAuthToken, useAuth } from "@/lib/auth";
import { useRoute } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/status-badge";
import { MetricCard } from "@/components/metric-card";
import { BandwidthChart, LatencyChart, PacketLossChart, UnifiedMetricsChart, ChartSeriesVisibility } from "@/components/bandwidth-chart";
import { EventsTable } from "@/components/events-table";
import { SLAIndicators } from "@/components/sla-indicators";
import { OpticalSignalSection } from "@/components/optical-signal-section";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  Activity,
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  CalendarIcon,
  CheckCircle,
  Clock,
  Cpu,
  ExternalLink,
  FileWarning,
  Gauge,
  Globe,
  HardDrive,
  Layers,
  LayoutList,
  Loader2,
  MapPin,
  Network,
  Percent,
  Play,
  Radio,
  RefreshCw,
  Route,
  Search,
  Server,
  Shield,
  Terminal,
  Ticket,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import type { Link, Metric, Event, SLAIndicator, LinkStatusDetail, Incident, BlacklistCheck } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { DateRange } from "react-day-picker";
import { formatBandwidth } from "@/lib/export-utils";

// Tipo para solicitações do Voalle
interface VoalleSolicitation {
  id: number;
  protocol: string;
  subject: string;
  description?: string;
  status: string;
  createdAt: string;
  closedAt?: string;
  team?: string;
  sectorArea?: string;
}

interface VoalleSolicitationsResponse {
  solicitations: VoalleSolicitation[];
  clientName?: string;
  voalleCustomerId?: number;
  message?: string;
  error?: string;
}

// Opções de período para os gráficos
const PERIOD_OPTIONS = [
  { value: "1", label: "1h", hours: 1 },
  { value: "6", label: "6h", hours: 6 },
  { value: "24", label: "24h", hours: 24 },
  { value: "168", label: "7d", hours: 168 },
  { value: "720", label: "30d", hours: 720 },
] as const;

function getFailureIcon(reason: string | null) {
  switch (reason) {
    case "falha_eletrica": return Zap;
    case "rompimento_fibra": return Network;
    case "falha_equipamento": return Server;
    default: return AlertTriangle;
  }
}

function getStatusColor(status: string) {
  switch (status) {
    case "aberto": return "destructive";
    case "em_andamento": return "default";
    case "aguardando_peca": return "secondary";
    case "resolvido": return "outline";
    case "cancelado": return "secondary";
    default: return "default";
  }
}

function getStatusLabel(status: string) {
  switch (status) {
    case "aberto": return "Aberto";
    case "em_andamento": return "Em Andamento";
    case "aguardando_peca": return "Aguardando Peça";
    case "resolvido": return "Resolvido";
    case "cancelado": return "Cancelado";
    default: return status;
  }
}

export default function LinkDetail() {
  const { isSuperAdmin } = useAuth();
  const [, params] = useRoute("/link/:id");
  const linkId = params?.id ? parseInt(params.id, 10) : 1;
  const [selectedPeriod, setSelectedPeriod] = useState("24"); // Padrão: 24h
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [isCustomRange, setIsCustomRange] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [chartMode, setChartMode] = useState<"unified" | "separate">("unified"); // Modo de gráfico
  const [visibleSeries, setVisibleSeries] = useState<ChartSeriesVisibility>({
    download: true,
    upload: true,
    latency: true,
    packetLoss: true,
  });
  
  const toggleSeries = (series: keyof ChartSeriesVisibility) => {
    setVisibleSeries(prev => ({ ...prev, [series]: !prev[series] }));
  };
  const [oltDiagnosisResult, setOltDiagnosisResult] = useState<{ alarmType: string | null; diagnosis: string; description: string } | null>(null);
  const queryClient = useQueryClient();

  const oltDiagnosisMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/links/${linkId}/olt-diagnosis`);
      return res.json();
    },
    onSuccess: (data) => {
      setOltDiagnosisResult(data);
      queryClient.invalidateQueries({ queryKey: ["/api/links", linkId] });
      queryClient.invalidateQueries({ queryKey: ["/api/links", linkId, "status-detail"] });
    },
  });

  const { data: link, isLoading: linkLoading } = useQuery<Link>({
    queryKey: ["/api/links", linkId],
    enabled: !isNaN(linkId),
    refetchInterval: 5000,
  });

  const { data: statusDetail } = useQuery<LinkStatusDetail>({
    queryKey: ["/api/links", linkId, "status-detail"],
    enabled: !isNaN(linkId),
    refetchInterval: 5000,
  });

  // Construir URL com base no modo (período pré-definido ou intervalo personalizado)
  const buildMetricsUrl = () => {
    const base = `/api/links/${linkId}/metrics`;
    if (isCustomRange && dateRange?.from && dateRange?.to) {
      return `${base}?from=${dateRange.from.toISOString()}&to=${dateRange.to.toISOString()}`;
    }
    return `${base}?hours=${selectedPeriod}`;
  };

  const { data: metrics } = useQuery<Metric[]>({
    queryKey: ["/api/links", linkId, "metrics", { hours: selectedPeriod, dateRange, isCustomRange }],
    queryFn: async () => {
      const token = getAuthToken();
      const headers: Record<string, string> = {};
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      const res = await fetch(buildMetricsUrl(), {
        credentials: "include",
        headers,
      });
      if (!res.ok) throw new Error("Failed to fetch metrics");
      return res.json();
    },
    enabled: !isNaN(linkId),
    refetchInterval: isCustomRange ? false : 5000, // Não atualizar automaticamente em modo personalizado
  });

  const { data: events } = useQuery<Event[]>({
    queryKey: ["/api/links", linkId, "events"],
    enabled: !isNaN(linkId),
    refetchInterval: 10000,
  });

  const { data: slaIndicators } = useQuery<SLAIndicator[]>({
    queryKey: [`/api/sla?linkId=${linkId}&type=accumulated`],
    enabled: !isNaN(linkId),
    refetchInterval: 30000,
  });

  const { data: incidents } = useQuery<Incident[]>({
    queryKey: ["/api/links", linkId, "incidents"],
    enabled: !isNaN(linkId),
    refetchInterval: 10000,
  });

  // Buscar solicitações em aberto do Voalle
  const { data: voalleSolicitations, isLoading: voalleLoading, refetch: refetchVoalle } = useQuery<VoalleSolicitationsResponse>({
    queryKey: ["/api/links", linkId, "voalle", "solicitations"],
    enabled: !isNaN(linkId),
    refetchInterval: false, // Não atualizar automaticamente (consulta sob demanda)
    staleTime: 60000, // Cache por 1 minuto
  });

  // Buscar status de blacklist do link (endpoint específico por linkId para melhor performance)
  const { data: blacklistChecks, isLoading: blacklistLoading, refetch: refetchBlacklist } = useQuery<BlacklistCheck[]>({
    queryKey: ["/api/blacklist/cached", linkId],
    queryFn: async (): Promise<BlacklistCheck[]> => {
      const token = getAuthToken();
      const headers: Record<string, string> = {};
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      const res = await fetch(`/api/blacklist/cached/${linkId}`, {
        credentials: "include",
        headers,
      });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : (data ? [data] : []);
    },
    enabled: !isNaN(linkId),
    refetchInterval: 60000,
  });

  const { toast } = useToast();

  // Mutation para verificar blacklist manualmente
  const checkBlacklistMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("GET", `/api/blacklist/link/${linkId}`);
      return res.json();
    },
    onSuccess: (data) => {
      refetchBlacklist();
      if (data.listed > 0) {
        toast({ 
          title: "IPs encontrados em blacklist", 
          description: `${data.listed} de ${data.totalIps} IP(s) em blacklist`,
          variant: "destructive" 
        });
      } else {
        toast({ title: "Todos IPs limpos", description: `${data.totalIps} IP(s) verificado(s)` });
      }
    },
    onError: () => {
      toast({ title: "Erro ao verificar blacklist", variant: "destructive" });
    },
  });

  // Inverter a ordem para timeline da esquerda (mais antigo) para direita (mais recente)
  const sortedMetrics = metrics ? [...metrics].reverse() : [];

  const bandwidthData = sortedMetrics.map((m) => ({
    timestamp: typeof m.timestamp === 'string' ? m.timestamp : new Date(m.timestamp).toISOString(),
    download: m.download,
    upload: m.upload,
    status: m.status,
  }));

  const latencyData = sortedMetrics.map((m) => ({
    timestamp: typeof m.timestamp === 'string' ? m.timestamp : new Date(m.timestamp).toISOString(),
    latency: m.latency,
    status: m.status,
  }));

  const packetLossData = sortedMetrics.map((m) => ({
    timestamp: typeof m.timestamp === 'string' ? m.timestamp : new Date(m.timestamp).toISOString(),
    packetLoss: m.packetLoss != null ? m.packetLoss : null,
    status: m.status,
  }));

  // Dados unificados para o gráfico completo
  const unifiedData = sortedMetrics.map((m) => ({
    timestamp: typeof m.timestamp === 'string' ? m.timestamp : new Date(m.timestamp).toISOString(),
    download: m.download,
    upload: m.upload,
    latency: m.latency ?? 0,
    packetLoss: m.packetLoss ?? 0,
    status: m.status,
  }));

  if (linkLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
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
        </div>
      </div>
    );
  }

  if (!link) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <Network className="w-12 h-12 text-muted-foreground mb-4" />
        <h2 className="text-xl font-semibold">Link não encontrado</h2>
        <p className="text-muted-foreground">O link solicitado não existe.</p>
      </div>
    );
  }

  // Usar valores do SLA calculado quando disponíveis (mais precisos)
  const slaDE = slaIndicators?.find(i => i.id === "sla-de");
  const slaLAT = slaIndicators?.find(i => i.id === "sla-lat");
  const slaDP = slaIndicators?.find(i => i.id === "sla-dp");
  
  // Proteção contra valores nulos/undefined - priorizar SLA calculado
  const safeUptime = slaDE?.current ?? link.uptime ?? 0;
  const safeLatency = slaLAT?.current ?? link.latency ?? 0;
  const safePacketLoss = slaDP?.current ?? link.packetLoss ?? 0;
  // Inversão é o padrão (concentradores). invertBandwidth=true = manter original
  const rawDownload = link.currentDownload ?? 0;
  const rawUpload = link.currentUpload ?? 0;
  const keepOriginal = (link as any)?.invertBandwidth ?? false;
  const safeCurrentDownload = keepOriginal ? rawDownload : rawUpload;
  const safeCurrentUpload = keepOriginal ? rawUpload : rawDownload;
  const safeBandwidth = link.bandwidth ?? 1;

  const failureInfo = statusDetail?.failureInfo || null;
  const lastFailureInfo = statusDetail?.lastFailureInfo || null;
  const activeIncident = statusDetail?.activeIncident || null;
  const hasFailure = failureInfo?.reason && failureInfo.reason !== null;
  const FailureIcon = hasFailure ? getFailureIcon(failureInfo.reason) : null;
  const hasLastFailure = !hasFailure && lastFailureInfo?.reason;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-semibold">{link.name}</h1>
            <StatusBadge status={link.status} reason={link.failureReason} />
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <MapPin className="w-4 h-4" />
            <p>{link.address}</p>
          </div>
        </div>
        <Button variant="outline" size="sm" data-testid="button-refresh">
          <RefreshCw className="w-4 h-4 mr-2" />
          Atualizar
        </Button>
      </div>

      {hasFailure && failureInfo && (
        <Card className="border-destructive bg-destructive/5">
          <CardContent className="flex items-center gap-4 py-4">
            {FailureIcon && (
              <div className="flex-shrink-0 w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
                <FailureIcon className="w-6 h-6 text-destructive" />
              </div>
            )}
            <div className="flex-1">
              <h3 className="font-semibold text-destructive" data-testid="text-failure-reason">
                {failureInfo.reasonLabel}
              </h3>
              <p className="text-sm text-muted-foreground">
                Fonte: {failureInfo.source === "olt" ? "Monitoramento OLT" : "Registro Manual"} 
                {failureInfo.lastFailureAt && ` - ${formatDistanceToNow(new Date(failureInfo.lastFailureAt), { addSuffix: true, locale: ptBR })}`}
              </p>
              {oltDiagnosisResult && (
                <p className="text-xs mt-1 text-muted-foreground">
                  Último diagnóstico: {oltDiagnosisResult.diagnosis}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {link.oltId && link.onuId && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => oltDiagnosisMutation.mutate()}
                  disabled={oltDiagnosisMutation.isPending}
                  data-testid="button-olt-diagnosis"
                >
                  {oltDiagnosisMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Server className="w-4 h-4 mr-2" />
                  )}
                  Consultar OLT
                </Button>
              )}
              {activeIncident && (
                <div className="text-right">
                  <Badge variant={getStatusColor(activeIncident.status) as "destructive" | "default" | "secondary" | "outline"}>
                    {getStatusLabel(activeIncident.status)}
                  </Badge>
                  {activeIncident.erpTicketId && (
                    <p className="text-xs text-muted-foreground mt-1" data-testid="text-erp-ticket">
                      Ticket ERP: {activeIncident.erpTicketId}
                    </p>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {hasLastFailure && lastFailureInfo && (
        <Card className="border-muted">
          <CardContent className="flex items-center gap-4 py-3">
            <div className="flex-shrink-0 w-10 h-10 rounded-full bg-muted flex items-center justify-center">
              <Clock className="w-5 h-5 text-muted-foreground" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-muted-foreground">Última falha registrada</p>
              <p className="text-sm" data-testid="text-last-failure-reason">
                {lastFailureInfo.reasonLabel}
                {lastFailureInfo.lastFailureAt && (
                  <span className="text-muted-foreground">
                    {" "}({formatDistanceToNow(new Date(lastFailureInfo.lastFailureAt), { addSuffix: true, locale: ptBR })})
                  </span>
                )}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Uptime"
          value={safeUptime.toFixed(2)}
          unit="%"
          icon={Activity}
          trend={{ value: 0.1, direction: "up", isGood: true }}
          subtitle="últimos 30 dias"
          testId="metric-uptime"
        />
        <MetricCard
          title="Latência"
          value={safeLatency.toFixed(0)}
          unit="ms"
          icon={Clock}
          trend={{ value: 1.5, direction: "down", isGood: true }}
          subtitle="média atual"
          testId="metric-latency"
        />
        <MetricCard
          title="Perda de Pacotes"
          value={safePacketLoss.toFixed(2)}
          unit="%"
          icon={Percent}
          trend={{ value: 0.1, direction: "down", isGood: true }}
          subtitle="limite: 2%"
          testId="metric-packet-loss"
        />
        <MetricCard
          title="Banda Total"
          value={formatBandwidth(link.bandwidth)}
          icon={Gauge}
          subtitle="simétrico garantido"
          testId="metric-bandwidth"
        />
      </div>

      <Tabs defaultValue="bandwidth" className="space-y-4">
        <TabsList className="flex-wrap">
          <TabsTrigger value="bandwidth" data-testid="tab-bandwidth">
            Consumo de Banda
          </TabsTrigger>
          <TabsTrigger value="equipment" data-testid="tab-equipment">
            Equipamento
          </TabsTrigger>
          <TabsTrigger value="events" data-testid="tab-events">
            Eventos
          </TabsTrigger>
          <TabsTrigger value="incidents" data-testid="tab-incidents">
            Incidentes
          </TabsTrigger>
          <TabsTrigger value="sla" data-testid="tab-sla">
            SLA
          </TabsTrigger>
          <TabsTrigger value="optical" data-testid="tab-optical">
            <Radio className="w-4 h-4 mr-1" />
            Sinal Óptico
          </TabsTrigger>
          <TabsTrigger value="blacklist" data-testid="tab-blacklist" className="gap-1">
            <Shield className="w-4 h-4" />
            Blacklist
            {blacklistChecks && blacklistChecks.some(c => c.isListed) && (
              <Badge variant="destructive" className="ml-1 h-5 px-1.5 text-xs">
                {blacklistChecks.filter(c => c.isListed).length}
              </Badge>
            )}
          </TabsTrigger>
          {isSuperAdmin && (
            <TabsTrigger value="tools" data-testid="tab-tools" className="gap-1">
              <Wrench className="w-4 h-4" />
              Ferramentas
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="bandwidth" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 flex-wrap">
              <div className="flex items-center gap-3">
                <CardTitle className="text-lg">Consumo de Banda</CardTitle>
                <ToggleGroup 
                  type="single" 
                  value={chartMode} 
                  onValueChange={(value) => {
                    if (value === "unified" || value === "separate") {
                      setChartMode(value);
                    }
                  }}
                  className="border rounded-md"
                  data-testid="toggle-chart-mode"
                >
                  <ToggleGroupItem 
                    value="unified"
                    size="sm"
                    className="px-2 text-xs gap-1"
                    data-testid="toggle-chart-unified"
                    title="Gráfico Unificado"
                  >
                    <Layers className="w-3.5 h-3.5" />
                    Unificado
                  </ToggleGroupItem>
                  <ToggleGroupItem 
                    value="separate"
                    size="sm"
                    className="px-2 text-xs gap-1"
                    data-testid="toggle-chart-separate"
                    title="Gráficos Separados"
                  >
                    <LayoutList className="w-3.5 h-3.5" />
                    Separado
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <ToggleGroup 
                  type="single" 
                  value={isCustomRange ? "" : selectedPeriod} 
                  onValueChange={(value) => {
                    if (value) {
                      setSelectedPeriod(value);
                      setIsCustomRange(false);
                      setDateRange(undefined);
                    }
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
                <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
                  <PopoverTrigger asChild>
                    <Button 
                      variant={isCustomRange ? "default" : "outline"} 
                      size="sm"
                      className="text-xs gap-1"
                      data-testid="button-custom-range"
                    >
                      <CalendarIcon className="w-3 h-3" />
                      {isCustomRange && dateRange?.from && dateRange?.to ? (
                        <span>
                          {format(dateRange.from, "dd/MM", { locale: ptBR })} - {format(dateRange.to, "dd/MM", { locale: ptBR })}
                        </span>
                      ) : (
                        "Personalizado"
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="end">
                    <Calendar
                      mode="range"
                      selected={dateRange}
                      onSelect={(range) => {
                        setDateRange(range);
                      }}
                      numberOfMonths={2}
                      locale={ptBR}
                      disabled={(date) => date > new Date()}
                      data-testid="calendar-custom-range"
                    />
                    {dateRange?.from && dateRange?.to && (
                      <div className="p-3 border-t flex justify-end">
                        <Button 
                          size="sm" 
                          onClick={() => {
                            setIsCustomRange(true);
                            setCalendarOpen(false);
                          }}
                          data-testid="button-apply-range"
                        >
                          Aplicar
                        </Button>
                      </div>
                    )}
                  </PopoverContent>
                </Popover>
              </div>
            </CardHeader>
            <CardContent>
              {chartMode === "unified" ? (
                <>
                  <UnifiedMetricsChart 
                    data={unifiedData} 
                    height={320} 
                    invertBandwidth={(link as any)?.invertBandwidth}
                    latencyThreshold={80}
                    packetLossThreshold={2}
                    visibleSeries={visibleSeries}
                  />
                  <div className="inline-flex flex-wrap items-center gap-3 mt-3 px-3 py-2 text-xs bg-card border rounded-md">
                    <button
                      onClick={() => toggleSeries("download")}
                      className={`flex items-center gap-1.5 px-2 py-1 rounded hover-elevate transition-opacity ${!visibleSeries.download ? "opacity-40" : ""}`}
                      data-testid="legend-download"
                    >
                      <span className="w-3 h-0.5 bg-[hsl(210,85%,55%)]" />
                      <span>Download</span>
                    </button>
                    <button
                      onClick={() => toggleSeries("upload")}
                      className={`flex items-center gap-1.5 px-2 py-1 rounded hover-elevate transition-opacity ${!visibleSeries.upload ? "opacity-40" : ""}`}
                      data-testid="legend-upload"
                    >
                      <span className="w-3 h-0.5 bg-[hsl(280,70%,60%)]" />
                      <span>Upload</span>
                    </button>
                    <button
                      onClick={() => toggleSeries("latency")}
                      className={`flex items-center gap-1.5 px-2 py-1 rounded hover-elevate transition-opacity ${!visibleSeries.latency ? "opacity-40" : ""}`}
                      data-testid="legend-latency"
                    >
                      <span className="w-4 border-t-2 border-dashed border-amber-500" />
                      <span>Latência</span>
                    </button>
                    <button
                      onClick={() => toggleSeries("packetLoss")}
                      className={`flex items-center gap-1.5 px-2 py-1 rounded hover-elevate transition-opacity ${!visibleSeries.packetLoss ? "opacity-40" : ""}`}
                      data-testid="legend-packet-loss"
                    >
                      <span className="w-3 h-0.5 bg-red-500" />
                      <span>Perda de Pacotes</span>
                    </button>
                    <span className="border-l pl-3 flex items-center gap-1.5">
                      <span className="w-3 h-2 rounded-sm bg-green-500" />
                      <span>Online</span>
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-3 h-2 rounded-sm bg-yellow-500" />
                      <span>Degradado</span>
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-3 h-2 rounded-sm bg-red-500" />
                      <span>Offline</span>
                    </span>
                  </div>
                </>
              ) : (
                <BandwidthChart data={bandwidthData} height={300} showAxes invertBandwidth={(link as any)?.invertBandwidth} />
              )}
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center gap-2 space-y-0 pb-2">
                <ArrowDownToLine className="w-5 h-5 text-blue-500" />
                <CardTitle className="text-base">Download</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-semibold font-mono" data-testid="text-current-download">
                    {safeCurrentDownload.toFixed(1)}
                  </span>
                  <span className="text-muted-foreground">Mbps</span>
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  {((safeCurrentDownload / safeBandwidth) * 100).toFixed(1)}% da capacidade
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center gap-2 space-y-0 pb-2">
                <ArrowUpFromLine className="w-5 h-5 text-green-500" />
                <CardTitle className="text-base">Upload</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-semibold font-mono" data-testid="text-current-upload">
                    {safeCurrentUpload.toFixed(1)}
                  </span>
                  <span className="text-muted-foreground">Mbps</span>
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  {((safeCurrentUpload / safeBandwidth) * 100).toFixed(1)}% da capacidade
                </p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>


        <TabsContent value="equipment" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center gap-2 space-y-0">
                <Server className="w-5 h-5" />
                <CardTitle className="text-base">Informações do Equipamento</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Modelo</span>
                  <span className="font-medium">{link.equipmentModel || "Não informado"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Bloco IP</span>
                  <span className="font-mono">{link.ipBlock}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total de IPs</span>
                  <span className="font-mono">{link.totalIps}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">IPs Utilizáveis</span>
                  <span className="font-mono">{link.usableIps}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Interface WAN</span>
                  <span className="font-mono">{link.snmpInterfaceName || link.snmpInterfaceDescr || "Não configurada"}</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center gap-2 space-y-0">
                <Gauge className="w-5 h-5" />
                <CardTitle className="text-base">Recursos do Sistema</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="flex items-center gap-2 text-muted-foreground">
                      <Cpu className="w-4 h-4" />
                      CPU
                    </span>
                    <span className="font-mono">{link.cpuUsage}%</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary transition-all"
                      style={{ width: `${link.cpuUsage}%` }}
                    />
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="flex items-center gap-2 text-muted-foreground">
                      <HardDrive className="w-4 h-4" />
                      Memória
                    </span>
                    <span className="font-mono">{link.memoryUsage}%</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary transition-all"
                      style={{ width: `${link.memoryUsage}%` }}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="events">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Eventos do Link</CardTitle>
            </CardHeader>
            <CardContent>
              <EventsTable events={events || []} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="incidents" className="space-y-4">
          {/* Solicitações em Aberto no Voalle */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
              <CardTitle className="text-lg flex items-center gap-2">
                <Ticket className="w-5 h-5" />
                Solicitações no ERP
              </CardTitle>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refetchVoalle()}
                  disabled={voalleLoading}
                  data-testid="button-refresh-voalle"
                >
                  {voalleLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <RefreshCw className="w-4 h-4" />
                  )}
                  <span className="ml-1">Atualizar</span>
                </Button>
                {voalleSolicitations?.solicitations && (
                  <Badge variant="outline" data-testid="badge-solicitations-count">
                    {voalleSolicitations.solicitations.length} solicitações
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {voalleLoading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  <span className="ml-2 text-muted-foreground">Consultando Voalle...</span>
                </div>
              ) : voalleSolicitations?.error ? (
                <div className="flex flex-col items-center justify-center py-6 text-muted-foreground">
                  <AlertTriangle className="w-8 h-8 mb-2 opacity-50" />
                  <p>{voalleSolicitations.error}</p>
                </div>
              ) : voalleSolicitations?.message ? (
                <div className="flex flex-col items-center justify-center py-6 text-muted-foreground">
                  <Ticket className="w-8 h-8 mb-2 opacity-50" />
                  <p>{voalleSolicitations.message}</p>
                </div>
              ) : !voalleSolicitations?.solicitations || voalleSolicitations.solicitations.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-6 text-muted-foreground">
                  <Ticket className="w-8 h-8 mb-2 opacity-50" />
                  <p>Nenhuma solicitação em aberto no ERP.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {voalleSolicitations.solicitations.map((sol) => (
                    <div 
                      key={sol.id} 
                      className="flex items-start gap-3 p-3 rounded-md border bg-card"
                      data-testid={`solicitation-card-${sol.id}`}
                    >
                      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                        <ExternalLink className="w-4 h-4 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="font-mono text-sm font-medium">#{sol.protocol}</span>
                          <Badge variant="secondary" className="text-xs">
                            {sol.status}
                          </Badge>
                          {sol.team && (
                            <Badge variant="outline" className="text-xs">
                              {sol.team}
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground line-clamp-2">
                          {sol.subject || sol.description || "Sem descrição"}
                        </p>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                          <span>
                            Aberto: {formatDistanceToNow(new Date(sol.createdAt), { addSuffix: true, locale: ptBR })}
                          </span>
                          {sol.sectorArea && (
                            <span className="text-muted-foreground/70">
                              {sol.sectorArea}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Histórico de Incidentes */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
              <CardTitle className="text-lg">Histórico de Incidentes</CardTitle>
              <Badge variant="outline" data-testid="badge-incidents-count">
                {incidents?.length || 0} incidentes
              </Badge>
            </CardHeader>
            <CardContent>
              {(!incidents || incidents.length === 0) ? (
                <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                  <FileWarning className="w-10 h-10 mb-2 opacity-50" />
                  <p>Nenhum incidente registrado para este link.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {incidents.map((incident) => {
                    const IncidentIcon = getFailureIcon(incident.failureReason);
                    return (
                      <div 
                        key={incident.id} 
                        className="flex items-start gap-4 p-4 rounded-md border bg-card"
                        data-testid={`incident-card-${incident.id}`}
                      >
                        <div className="flex-shrink-0 w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                          <IncidentIcon className="w-5 h-5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <h4 className="font-medium">{incident.description || "Incidente sem descrição"}</h4>
                            <Badge variant={getStatusColor(incident.status) as "destructive" | "default" | "secondary" | "outline"}>
                              {getStatusLabel(incident.status)}
                            </Badge>
                          </div>
                          <div className="text-sm text-muted-foreground space-y-1">
                            <p>
                              Aberto: {formatDistanceToNow(new Date(incident.openedAt), { addSuffix: true, locale: ptBR })}
                            </p>
                            {incident.slaDeadline && (
                              <p>
                                Prazo SLA: {new Date(incident.slaDeadline).toLocaleString("pt-BR")}
                              </p>
                            )}
                            {incident.erpTicketId && (
                              <p className="flex items-center gap-1">
                                Ticket ERP: <span className="font-mono">{incident.erpTicketId}</span>
                                {incident.erpTicketStatus && (
                                  <Badge variant="outline" className="ml-1 text-xs">
                                    {incident.erpTicketStatus}
                                  </Badge>
                                )}
                              </p>
                            )}
                            {incident.closedAt && (
                              <p>
                                Resolvido: {formatDistanceToNow(new Date(incident.closedAt), { addSuffix: true, locale: ptBR })}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sla">
          <SLAIndicators indicators={slaIndicators || []} />
        </TabsContent>

        <TabsContent value="optical" className="space-y-4">
          <OpticalSignalSection link={link} metrics={metrics || []} />
        </TabsContent>

        <TabsContent value="blacklist" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 flex-wrap">
              <div>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Shield className="w-5 h-5" />
                  Verificação de Blacklist
                </CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  Verifica se os IPs do bloco estão listados em blacklists de spam/RBL
                </p>
              </div>
              <Button 
                onClick={() => checkBlacklistMutation.mutate()} 
                disabled={checkBlacklistMutation.isPending}
                data-testid="button-check-blacklist"
              >
                {checkBlacklistMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Verificando...
                  </>
                ) : (
                  <>
                    <Search className="w-4 h-4 mr-2" />
                    Verificar Agora
                  </>
                )}
              </Button>
            </CardHeader>
            <CardContent>
              {blacklistLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-16 w-full" />
                </div>
              ) : blacklistChecks && blacklistChecks.length > 0 ? (
                <div className="space-y-4">
                  {(() => {
                    const listedChecks = blacklistChecks.filter(c => c.isListed);
                    const hasAnyListed = listedChecks.length > 0;
                    const totalRbls = listedChecks.reduce((acc, c) => 
                      acc + (Array.isArray(c.listedOn) ? c.listedOn.length : 0), 0
                    );
                    const lastCheck = blacklistChecks.reduce((latest, c) => {
                      const cDate = c.lastCheckedAt ? new Date(c.lastCheckedAt) : null;
                      return cDate && (!latest || cDate > latest) ? cDate : latest;
                    }, null as Date | null);
                    
                    return (
                      <>
                        <div className="flex items-center gap-4 p-4 rounded-lg border">
                          {hasAnyListed ? (
                            <>
                              <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
                                <AlertTriangle className="w-6 h-6 text-destructive" />
                              </div>
                              <div>
                                <p className="font-medium text-destructive">IPs em Blacklist</p>
                                <p className="text-sm text-muted-foreground">
                                  {listedChecks.length} de {blacklistChecks.length} IP(s) encontrado(s) em {totalRbls} lista(s)
                                </p>
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center">
                                <CheckCircle className="w-6 h-6 text-green-500" />
                              </div>
                              <div>
                                <p className="font-medium text-green-600">Todos os IPs Limpos</p>
                                <p className="text-sm text-muted-foreground">
                                  {blacklistChecks.length} IP(s) verificado(s), nenhum em blacklist
                                </p>
                              </div>
                            </>
                          )}
                        </div>

                        <div className="grid grid-cols-2 gap-4 text-sm">
                          <div>
                            <p className="text-muted-foreground">Bloco de IPs</p>
                            <p className="font-mono font-medium">{link?.ipBlock || blacklistChecks[0]?.ip}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Última Verificação</p>
                            <p className="font-medium">
                              {lastCheck
                                ? format(lastCheck, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })
                                : "Nunca verificado"
                              }
                            </p>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <p className="text-sm font-medium">IPs do Bloco ({blacklistChecks.length}):</p>
                          <div className="grid gap-2">
                            {blacklistChecks.map((check) => (
                              <div 
                                key={check.ip} 
                                className={`flex items-center justify-between p-3 rounded border ${
                                  check.isListed ? 'bg-destructive/5 border-destructive/30' : 'bg-green-500/5 border-green-500/30'
                                }`}
                              >
                                <div className="flex items-center gap-3">
                                  {check.isListed ? (
                                    <AlertTriangle className="w-4 h-4 text-destructive" />
                                  ) : (
                                    <CheckCircle className="w-4 h-4 text-green-500" />
                                  )}
                                  <span className="font-mono text-sm">{check.ip}</span>
                                  {check.isListed && Array.isArray(check.listedOn) && (
                                    <Badge variant="destructive" className="text-xs">
                                      {check.listedOn.length} lista(s)
                                    </Badge>
                                  )}
                                  {!check.reportId && (
                                    <Badge variant="secondary" className="text-xs">
                                      Sem monitor
                                    </Badge>
                                  )}
                                </div>
                                {check.reportUrl && (
                                  <a 
                                    href={check.reportUrl} 
                                    target="_blank" 
                                    rel="noopener noreferrer"
                                    className="text-xs text-primary hover:underline flex items-center gap-1"
                                  >
                                    Relatório
                                    <ExternalLink className="w-3 h-3" />
                                  </a>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>

                        {hasAnyListed && (
                          <div className="space-y-2">
                            <p className="text-sm font-medium">Listas onde IPs foram encontrados:</p>
                            <div className="space-y-2">
                              {listedChecks.flatMap((check) => 
                                (check.listedOn as Array<{ rbl: string; delist?: string }> || []).map((item, idx) => (
                                  <div key={`${check.ip}-${idx}`} className="flex items-center justify-between p-2 rounded border bg-destructive/5">
                                    <div className="flex items-center gap-2">
                                      <span className="font-mono text-xs text-muted-foreground">{check.ip}</span>
                                      <span className="font-mono text-sm">{item.rbl}</span>
                                    </div>
                                    {item.delist && (
                                      <a 
                                        href={item.delist} 
                                        target="_blank" 
                                        rel="noopener noreferrer"
                                        className="text-xs text-primary hover:underline flex items-center gap-1"
                                      >
                                        Solicitar remoção
                                        <ExternalLink className="w-3 h-3" />
                                      </a>
                                    )}
                                  </div>
                                ))
                              )}
                            </div>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Shield className="w-12 h-12 mx-auto mb-3 opacity-20" />
                  <p>Nenhuma verificação realizada ainda</p>
                  <p className="text-sm">Clique em "Verificar Agora" para consultar</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Aba de Ferramentas - Apenas Super Admin */}
        {isSuperAdmin && (
          <TabsContent value="tools" className="space-y-4">
            <ToolsSection linkId={linkId} link={link} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

// Componente de Ferramentas de Diagnóstico
interface ToolsSectionProps {
  linkId: number;
  link: Link | null | undefined;
}

interface DeviceInfo {
  name: string;
  ip: string;
  available: boolean;
  sshUser?: string;
  sshPort?: number;
  webPort?: number;
  webProtocol?: string;
  winboxPort?: number;
  vendor?: string;
}

interface DevicesInfo {
  olt: DeviceInfo | null;
  concentrator: DeviceInfo;
  cpe: DeviceInfo;
}

interface PingResult {
  success: boolean;
  target: string;
  deviceName: string;
  ipAddress: string;
  latency: string;
  packetLoss: string;
  reachable: boolean;
  error?: string;
}

interface TracerouteResult {
  success: boolean;
  target: string;
  deviceName: string;
  ipAddress: string;
  hops?: { hop: number; data: string }[];
  raw?: string;
  error?: string;
}

function ToolsSection({ linkId, link }: ToolsSectionProps) {
  const [pingResult, setPingResult] = useState<PingResult | null>(null);
  const [tracerouteResult, setTracerouteResult] = useState<TracerouteResult | null>(null);
  const [terminalOutput, setTerminalOutput] = useState<string[]>([]);
  const [terminalCommand, setTerminalCommand] = useState("");
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const terminalRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const { data: devices, isLoading: devicesLoading } = useQuery<DevicesInfo>({
    queryKey: ["/api/links", linkId, "tools", "devices"],
  });

  const pingMutation = useMutation({
    mutationFn: async (target: string) => {
      const res = await apiRequest("POST", `/api/links/${linkId}/tools/ping`, { target });
      return res.json();
    },
    onSuccess: (data: PingResult) => {
      setPingResult(data);
      if (data.success) {
        toast({
          title: data.reachable ? "Dispositivo alcançável" : "Dispositivo inacessível",
          description: data.reachable 
            ? `${data.deviceName} (${data.ipAddress}): ${data.latency}ms, ${data.packetLoss}% perda`
            : `${data.deviceName} não respondeu ao ping`,
          variant: data.reachable ? "default" : "destructive",
        });
      }
    },
    onError: () => {
      toast({ title: "Erro ao executar ping", variant: "destructive" });
    },
  });

  const tracerouteMutation = useMutation({
    mutationFn: async (target: string) => {
      const res = await apiRequest("POST", `/api/links/${linkId}/tools/traceroute`, { target });
      return res.json();
    },
    onSuccess: (data: TracerouteResult) => {
      setTracerouteResult(data);
    },
    onError: () => {
      toast({ title: "Erro ao executar traceroute", variant: "destructive" });
    },
  });

  // Formata IP para URL (adiciona colchetes se for IPv6)
  const formatIpForUrl = (ip: string): string => {
    const isIPv6 = ip.includes(':') && !ip.match(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d+$/);
    return isIPv6 ? `[${ip.replace(/^\[|\]$/g, '')}]` : ip;
  };

  const openWeb = (ip: string, port: number = 80, protocol: string = "http") => {
    const formattedIp = formatIpForUrl(ip);
    const portSuffix = (protocol === "http" && port !== 80) || (protocol === "https" && port !== 443) ? `:${port}` : "";
    window.open(`${protocol}://${formattedIp}${portSuffix}`, "_blank");
  };

  const openSsh = (ip: string, user: string = "admin", port: number = 22) => {
    const formattedIp = formatIpForUrl(ip);
    window.open(`ssh://${user}@${formattedIp}:${port}`, "_blank");
  };

  const openWinbox = (ip: string, port: number = 8291) => {
    // Winbox não precisa de colchetes para IPv6
    window.open(`winbox://${ip}:${port}`, "_blank");
  };

  // Terminal mutation
  const terminalMutation = useMutation({
    mutationFn: async (command: string) => {
      const res = await apiRequest("POST", `/api/links/${linkId}/tools/terminal`, { command });
      return res.json();
    },
    onSuccess: (data) => {
      setTerminalOutput(prev => [...prev, `$ ${data.command}`, data.output]);
      setTimeout(() => {
        if (terminalRef.current) {
          terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
        }
      }, 50);
    },
    onError: (error) => {
      setTerminalOutput(prev => [...prev, `Erro: ${error.message}`]);
    },
  });

  const executeCommand = (cmd: string) => {
    if (!cmd.trim()) return;
    setTerminalCommand("");
    setCommandHistory(prev => [...prev, cmd]);
    setHistoryIndex(-1);
    terminalMutation.mutate(cmd);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      executeCommand(terminalCommand);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (commandHistory.length > 0) {
        const newIndex = historyIndex < commandHistory.length - 1 ? historyIndex + 1 : historyIndex;
        setHistoryIndex(newIndex);
        setTerminalCommand(commandHistory[commandHistory.length - 1 - newIndex] || "");
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setTerminalCommand(commandHistory[commandHistory.length - 1 - newIndex] || "");
      } else if (historyIndex === 0) {
        setHistoryIndex(-1);
        setTerminalCommand("");
      }
    }
  };

  // Quick commands based on device IPs
  const quickCommands = [
    { label: "Ping CPE", cmd: `ping -c 4 ${devices?.cpe?.ip || ""}`, disabled: !devices?.cpe?.ip },
    { label: "Ping Concentrador", cmd: `ping -c 4 ${devices?.concentrator?.ip || ""}`, disabled: !devices?.concentrator?.ip },
    { label: "Ping OLT", cmd: `ping -c 4 ${devices?.olt?.ip || ""}`, disabled: !devices?.olt?.ip },
    { label: "Traceroute CPE", cmd: `traceroute -n ${devices?.cpe?.ip || ""}`, disabled: !devices?.cpe?.ip },
  ];

  const DeviceCard = ({ 
    title, 
    icon: Icon, 
    target, 
    ip, 
    available,
    showWinbox = false,
    sshUser = "admin",
    sshPort = 22,
    webPort = 80,
    webProtocol = "http",
    winboxPort = 8291,
  }: { 
    title: string; 
    icon: any; 
    target: string; 
    ip: string | null; 
    available: boolean;
    showWinbox?: boolean;
    sshUser?: string;
    sshPort?: number;
    webPort?: number;
    webProtocol?: string;
    winboxPort?: number;
  }) => (
    <Card className={!available ? "opacity-50" : ""}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Icon className="w-5 h-5" />
          {title}
        </CardTitle>
        <p className="text-sm font-mono text-muted-foreground">
          {ip || "Não configurado"}
        </p>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!available || pingMutation.isPending}
            onClick={() => pingMutation.mutate(target)}
            data-testid={`button-ping-${target}`}
          >
            {pingMutation.isPending && pingMutation.variables === target ? (
              <Loader2 className="w-4 h-4 mr-1 animate-spin" />
            ) : (
              <Activity className="w-4 h-4 mr-1" />
            )}
            Ping
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!available || tracerouteMutation.isPending}
            onClick={() => tracerouteMutation.mutate(target)}
            data-testid={`button-traceroute-${target}`}
          >
            {tracerouteMutation.isPending && tracerouteMutation.variables === target ? (
              <Loader2 className="w-4 h-4 mr-1 animate-spin" />
            ) : (
              <Route className="w-4 h-4 mr-1" />
            )}
            Traceroute
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!available}
            onClick={() => ip && openWeb(ip, webPort, webProtocol)}
            data-testid={`button-web-${target}`}
          >
            <Globe className="w-4 h-4 mr-1" />
            Web
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!available}
            onClick={() => ip && openSsh(ip, sshUser, sshPort)}
            data-testid={`button-ssh-${target}`}
          >
            <Terminal className="w-4 h-4 mr-1" />
            SSH
          </Button>
          {showWinbox && (
            <Button
              size="sm"
              variant="outline"
              disabled={!available}
              onClick={() => ip && openWinbox(ip, winboxPort)}
              data-testid={`button-winbox-${target}`}
            >
              <Network className="w-4 h-4 mr-1" />
              Winbox
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );

  if (devicesLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  const cpeVendor = (link as any)?.cpeVendor || "";
  const showWinbox = cpeVendor.toLowerCase() === "mikrotik";

  return (
    <div className="space-y-4">
      {/* Terminal Integrado - Primeiro item */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Terminal className="w-5 h-5" />
            Terminal
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Shell local (usuário não-root) - use qualquer comando de diagnóstico
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Atalhos Rápidos */}
          <div className="flex items-center gap-2 flex-wrap">
            {quickCommands.filter(qc => !qc.disabled).map((qc, idx) => (
              <Button
                key={idx}
                size="sm"
                variant="outline"
                onClick={() => executeCommand(qc.cmd)}
                data-testid={`button-quick-${qc.label.toLowerCase().replace(/\s+/g, '-')}`}
              >
                {qc.label}
              </Button>
            ))}
            {terminalOutput.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setTerminalOutput([])}
                data-testid="button-clear-terminal"
              >
                <X className="w-4 h-4 mr-1" />
                Limpar
              </Button>
            )}
          </div>
          
          {/* Área do Terminal */}
          <div 
            ref={terminalRef}
            className="bg-zinc-950 text-green-400 font-mono text-sm p-3 rounded-md h-48 overflow-auto border border-zinc-800"
            data-testid="terminal-output"
          >
            {terminalOutput.length === 0 ? (
              <span className="text-zinc-500">Clique em um atalho acima ou digite um comando abaixo.</span>
            ) : (
              terminalOutput.map((line, idx) => (
                <div key={idx} className="whitespace-pre-wrap">
                  {line}
                </div>
              ))
            )}
            {terminalMutation.isPending && (
              <div className="text-yellow-400 animate-pulse">Executando...</div>
            )}
          </div>
          
          {/* Input do Terminal */}
          <div className="flex gap-2">
            <span className="text-green-500 font-mono flex items-center text-sm">$</span>
            <input
              type="text"
              value={terminalCommand}
              onChange={(e) => setTerminalCommand(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="ping 8.8.8.8"
              disabled={terminalMutation.isPending}
              className="flex-1 bg-zinc-950 text-green-400 font-mono text-sm border border-zinc-700 rounded px-2 py-1.5 focus:outline-none focus:border-green-500"
              data-testid="input-terminal-command"
            />
            <Button
              size="sm"
              onClick={() => executeCommand(terminalCommand)}
              disabled={terminalMutation.isPending || !terminalCommand.trim()}
              data-testid="button-execute-command"
            >
              <Play className="w-4 h-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Dispositivos */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <DeviceCard
          title="Ponto de Acesso (OLT)"
          icon={Radio}
          target="olt"
          ip={devices?.olt?.ip || null}
          available={devices?.olt?.available || false}
          showWinbox={devices?.olt?.vendor?.toLowerCase() === "mikrotik"}
          sshUser={devices?.olt?.sshUser || "admin"}
          sshPort={devices?.olt?.sshPort || 22}
          webPort={devices?.olt?.webPort || 80}
          webProtocol={devices?.olt?.webProtocol || "http"}
          winboxPort={devices?.olt?.winboxPort || 8291}
        />
        <DeviceCard
          title="Concentrador"
          icon={Server}
          target="concentrator"
          ip={devices?.concentrator?.ip || null}
          available={devices?.concentrator?.available || false}
          showWinbox={devices?.concentrator?.vendor?.toLowerCase() === "mikrotik"}
          sshUser={devices?.concentrator?.sshUser || "admin"}
          sshPort={devices?.concentrator?.sshPort || 22}
          webPort={devices?.concentrator?.webPort || 80}
          webProtocol={devices?.concentrator?.webProtocol || "http"}
          winboxPort={devices?.concentrator?.winboxPort || 8291}
        />
        <DeviceCard
          title="CPE Cliente"
          icon={HardDrive}
          target="cpe"
          ip={devices?.cpe?.ip || null}
          available={devices?.cpe?.available || false}
          showWinbox={devices?.cpe?.vendor?.toLowerCase() === "mikrotik"}
          sshUser={devices?.cpe?.sshUser || "admin"}
          sshPort={devices?.cpe?.sshPort || 22}
          webPort={devices?.cpe?.webPort || 80}
          webProtocol={devices?.cpe?.webProtocol || "http"}
          winboxPort={devices?.cpe?.winboxPort || 8291}
        />
      </div>

      {/* Resultado do Ping */}
      {pingResult && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="w-4 h-4" />
              Resultado do Ping - {pingResult.deviceName}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {pingResult.success ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">IP</p>
                  <p className="font-mono">{pingResult.ipAddress}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Status</p>
                  <Badge variant={pingResult.reachable ? "default" : "destructive"}>
                    {pingResult.reachable ? "Alcançável" : "Inacessível"}
                  </Badge>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Latência</p>
                  <p className="font-medium">{pingResult.latency} ms</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Perda de Pacotes</p>
                  <p className="font-medium">{pingResult.packetLoss}%</p>
                </div>
              </div>
            ) : (
              <p className="text-destructive">{pingResult.error}</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Resultado do Traceroute */}
      {tracerouteResult && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Route className="w-4 h-4" />
              Traceroute - {tracerouteResult.deviceName} ({tracerouteResult.ipAddress})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {tracerouteResult.success && tracerouteResult.hops ? (
              <div className="font-mono text-sm space-y-1 bg-muted p-3 rounded max-h-64 overflow-auto">
                {tracerouteResult.hops.map((hop, idx) => (
                  <div key={idx} className="flex gap-3">
                    <span className="text-muted-foreground w-6 text-right">{hop.hop}</span>
                    <span>{hop.data}</span>
                  </div>
                ))}
              </div>
            ) : (
              <pre className="font-mono text-sm bg-muted p-3 rounded max-h-64 overflow-auto whitespace-pre-wrap">
                {tracerouteResult.raw || tracerouteResult.error || "Sem resultado"}
              </pre>
            )}
          </CardContent>
        </Card>
      )}

    </div>
  );
}

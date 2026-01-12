import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useRoute } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/status-badge";
import { MetricCard } from "@/components/metric-card";
import { BandwidthChart, LatencyChart, PacketLossChart } from "@/components/bandwidth-chart";
import { EventsTable } from "@/components/events-table";
import { SLAIndicators } from "@/components/sla-indicators";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  Activity,
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  CalendarIcon,
  Clock,
  Cpu,
  ExternalLink,
  FileWarning,
  Gauge,
  HardDrive,
  Loader2,
  MapPin,
  Network,
  Percent,
  RefreshCw,
  Server,
  Ticket,
  Zap,
} from "lucide-react";
import type { Link, Metric, Event, SLAIndicator, LinkStatusDetail, Incident } from "@shared/schema";
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
  const [, params] = useRoute("/link/:id");
  const linkId = params?.id ? parseInt(params.id, 10) : 1;
  const [selectedPeriod, setSelectedPeriod] = useState("24"); // Padrão: 24h
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [isCustomRange, setIsCustomRange] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
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
      const res = await fetch(buildMetricsUrl(), {
        credentials: "include",
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
  const safeCurrentDownload = link.currentDownload ?? 0;
  const safeCurrentUpload = link.currentUpload ?? 0;
  const safeBandwidth = link.bandwidth ?? 1;

  const failureInfo = statusDetail?.failureInfo || null;
  const activeIncident = statusDetail?.activeIncident || null;
  const hasFailure = failureInfo?.reason && failureInfo.reason !== null;
  const FailureIcon = hasFailure ? getFailureIcon(failureInfo.reason) : null;

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
          <TabsTrigger value="latency" data-testid="tab-latency">
            Latência
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
        </TabsList>

        <TabsContent value="bandwidth" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 flex-wrap">
              <CardTitle className="text-lg">Consumo de Banda</CardTitle>
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
                <div className="flex items-center gap-4 text-sm">
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-3 rounded-full bg-blue-500" />
                    Download
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-3 rounded-full bg-green-500" />
                    Upload
                  </span>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <BandwidthChart data={bandwidthData} height={300} showAxes />
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

        <TabsContent value="latency" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
              <CardTitle className="text-lg">Histórico de Latência</CardTitle>
              <div className="flex items-center gap-4 text-sm">
                <span className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded-full bg-amber-500" />
                  Latência
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-8 border-t-2 border-dashed border-red-500" />
                  Limite SLA (80ms)
                </span>
              </div>
            </CardHeader>
            <CardContent>
              <LatencyChart data={latencyData} height={250} threshold={80} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
              <CardTitle className="text-lg">Histórico de Perda de Pacotes</CardTitle>
              <div className="flex items-center gap-4 text-sm">
                <span className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded-full" style={{ backgroundColor: "hsl(280, 70%, 50%)" }} />
                  Perda
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-8 border-t-2 border-dashed border-red-500" />
                  Limite SLA (2%)
                </span>
              </div>
            </CardHeader>
            <CardContent>
              <PacketLossChart data={packetLossData} height={250} threshold={2} />
            </CardContent>
          </Card>
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
      </Tabs>
    </div>
  );
}

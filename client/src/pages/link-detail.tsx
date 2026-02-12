import { useState, useRef, useEffect, lazy, Suspense } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { getAuthToken, useAuth } from "@/lib/auth";
import { useRoute, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/status-badge";
import { MetricCard } from "@/components/metric-card";
import { BandwidthChart, LatencyChart, PacketLossChart, UnifiedMetricsChart, ChartSeriesVisibility } from "@/components/bandwidth-chart";
import { MultiTrafficChart } from "@/components/multi-traffic-chart";
import { EventsTable } from "@/components/events-table";
import { SLAIndicators } from "@/components/sla-indicators";
import { OpticalSignalSection } from "@/components/optical-signal-section";
import { OzmapRouteSection } from "@/components/ozmap-route-section";
import { XtermTerminal, XtermTerminalRef } from "@/components/xterm-terminal";
import { CpePortStatusDisplay } from "@/components/cpe-port-status";
import { CpeCommandLibrary } from "@/components/cpe-command-library";
import { FlashmanPanel } from "@/components/flashman-panel";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Activity,
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  CalendarIcon,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Clock,
  Cpu,
  ExternalLink,
  FileWarning,
  Filter,
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
  Pencil,
  Wifi,
  Signal,
  RotateCcw,
  MonitorSmartphone,
  Wrench,
  X,
  Zap,
  GitCompare,
  ArrowRight,
  Check,
} from "lucide-react";
import type { Link, Metric, Event, SLAIndicator, LinkStatusDetail, Incident, BlacklistCheck, Client } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { DateRange } from "react-day-picker";
import { formatBandwidth } from "@/lib/export-utils";
import { LinkForm } from "@/pages/admin";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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
  const [, navigate] = useLocation();
  const [, params] = useRoute("/link/:id");
  const linkId = params?.id ? parseInt(params.id, 10) : 1;
  const [selectedPeriod, setSelectedPeriod] = useState("24"); // Padrão: 24h
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [activeTab, setActiveTab] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("tab") || "bandwidth";
  });
  const [isCustomRange, setIsCustomRange] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [chartMode, setChartMode] = useState<"unified" | "separate">("unified"); // Modo de gráfico
  const [visibleSeries, setVisibleSeries] = useState<ChartSeriesVisibility>({
    download: true,
    upload: true,
    latency: true,
    packetLoss: true,
  });
  
  // Estados para aba de eventos - busca e paginação
  const [eventSearch, setEventSearch] = useState("");
  const [eventTypeFilter, setEventTypeFilter] = useState<string>("all");
  const [eventStatusFilter, setEventStatusFilter] = useState<string>("all");
  const [eventPage, setEventPage] = useState(1);
  const [eventPageSize, setEventPageSize] = useState(50);
  
  const toggleSeries = (series: keyof ChartSeriesVisibility) => {
    setVisibleSeries(prev => ({ ...prev, [series]: !prev[series] }));
  };
  const [oltDiagnosisResult, setOltDiagnosisResult] = useState<{ alarmType: string | null; diagnosis: string; description: string } | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
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

  interface MitigationStatus {
    isMitigated: boolean;
    mitigationInfo: {
      prefix: string;
      connector: string;
      announcedAt: string;
      expiresAt: string | null;
    } | null;
    linkIp: string;
  }

  const { data: mitigationStatus } = useQuery<MitigationStatus>({
    queryKey: ["/api/links", linkId, "mitigation-status"],
    enabled: !isNaN(linkId),
    refetchInterval: 30000,
  });

  const { data: snmpProfiles } = useQuery<Array<{ id: number; name: string; clientId: number | null }>>({
    queryKey: ["/api/snmp-profiles"],
    enabled: editDialogOpen,
  });

  const { data: clients } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
    enabled: editDialogOpen,
  });

  interface VoalleCompareResult {
    available: boolean;
    message?: string;
    voalleConnectionId?: number;
    voalleActive?: boolean;
    divergences?: Array<{ field: string; label: string; local: any; voalle: any }>;
    allFields?: Array<{ field: string; label: string; local: any; voalle: any; match: boolean }>;
    ozmapDivergences?: Array<{ field: string; label: string; local: any; ozmap: any }>;
    voalleData?: any;
  }

  const { data: voalleCompare, isLoading: voalleCompareLoading, isError: voalleCompareError, refetch: refetchVoalleCompare } = useQuery<VoalleCompareResult>({
    queryKey: ["/api/links", linkId, "voalle-compare"],
    enabled: editDialogOpen && !!(link?.voalleConnectionId || link?.voalleContractTagServiceTag),
    staleTime: 0,
    retry: 1,
  });

  const { toast } = useToast();

  const updateLinkMutation = useMutation({
    mutationFn: async (data: Partial<Link> & { _selectedCpes?: Array<{ cpeId: number; role: string; ipOverride?: string; showInEquipmentTab?: boolean }> }) => {
      const { _selectedCpes, ...linkData } = data;
      const res = await apiRequest("PATCH", `/api/links/${linkId}`, linkData);
      if (_selectedCpes !== undefined) {
        const existingRes = await apiRequest("GET", `/api/links/${linkId}/cpes`);
        const existing: Array<{ cpeId: number; role: string | null; ipOverride?: string | null; showInEquipmentTab?: boolean }> = await existingRes.json();
        const selectedIds = _selectedCpes.map(s => s.cpeId);
        for (const e of existing) {
          if (!selectedIds.includes(e.cpeId)) {
            await apiRequest("DELETE", `/api/links/${linkId}/cpes/${e.cpeId}`);
          }
        }
        for (const s of _selectedCpes) {
          const existingAssoc = existing.find(e => e.cpeId === s.cpeId);
          if (!existingAssoc) {
            await apiRequest("POST", `/api/links/${linkId}/cpes`, {
              cpeId: s.cpeId,
              role: s.role,
              ipOverride: s.ipOverride || null,
              showInEquipmentTab: s.showInEquipmentTab || false
            });
          } else if (
            existingAssoc.role !== s.role ||
            existingAssoc.ipOverride !== (s.ipOverride || null) ||
            existingAssoc.showInEquipmentTab !== (s.showInEquipmentTab || false)
          ) {
            await apiRequest("DELETE", `/api/links/${linkId}/cpes/${s.cpeId}`);
            await apiRequest("POST", `/api/links/${linkId}/cpes`, {
              cpeId: s.cpeId,
              role: s.role,
              ipOverride: s.ipOverride || null,
              showInEquipmentTab: s.showInEquipmentTab || false
            });
          }
        }
      }
      return res.json();
    },
    onSuccess: async () => {
      toast({ title: "Link atualizado com sucesso" });
      setEditDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ["/api/links", linkId] });
      queryClient.invalidateQueries({ queryKey: ["/api/links", linkId, "status-detail"] });
      queryClient.invalidateQueries({ queryKey: [`/api/links/${linkId}/cpes`] });

      try {
        const syncRes = await apiRequest("POST", `/api/links/${linkId}/voalle-sync`);
        const syncData = await syncRes.json();
        if (syncData.success && syncData.synced > 0) {
          toast({ title: `Sincronizado com Voalle: ${syncData.synced} campo(s)` });
          queryClient.invalidateQueries({ queryKey: ["/api/links", linkId, "voalle-compare"] });
        } else if (!syncData.success) {
          toast({ 
            title: "Erro ao sincronizar com Voalle", 
            description: syncData.message || "Falha na sincronização",
            variant: "destructive",
          });
        }
      } catch (syncError: any) {
        console.error("[Voalle Sync] Falha na sincronização:", syncError);
        toast({ 
          title: "Erro ao sincronizar com Voalle", 
          description: syncError?.message || "Erro de comunicação",
          variant: "destructive",
        });
      }
    },
    onError: () => {
      toast({ title: "Erro ao atualizar link", variant: "destructive" });
    },
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

  // Query para interfaces de tráfego adicionais
  interface TrafficInterfaceApiResponse {
    interface: {
      id: number;
      label: string;
      color: string;
      displayOrder: number;
      invertBandwidth: boolean;
    };
    metrics: Array<{
      timestamp: string;
      download: number;
      upload: number;
    }>;
  }

  interface TrafficInterfaceWithMetrics {
    id: number;
    label: string;
    color: string;
    invertBandwidth: boolean;
    metrics: Array<{
      timestamp: string;
      download: number;
      upload: number;
    }>;
  }

  const { data: trafficInterfacesData } = useQuery<TrafficInterfaceWithMetrics[]>({
    queryKey: ["/api/links", linkId, "traffic-interface-metrics", { hours: selectedPeriod, dateRange, isCustomRange }],
    queryFn: async () => {
      const token = getAuthToken();
      const headers: Record<string, string> = {};
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      let url = `/api/links/${linkId}/traffic-interface-metrics`;
      if (isCustomRange && dateRange?.from && dateRange?.to) {
        url += `?from=${dateRange.from.toISOString()}&to=${dateRange.to.toISOString()}`;
      } else {
        url += `?hours=${selectedPeriod}`;
      }
      const res = await fetch(url, {
        credentials: "include",
        headers,
      });
      if (!res.ok) throw new Error("Failed to fetch traffic interface metrics");
      const rawData: TrafficInterfaceApiResponse[] = await res.json();
      // Transform API response to expected format
      return rawData.map(item => ({
        id: item.interface.id,
        label: item.interface.label,
        color: item.interface.color,
        invertBandwidth: item.interface.invertBandwidth,
        metrics: item.metrics,
      }));
    },
    enabled: !isNaN(linkId),
    refetchInterval: isCustomRange ? false : 5000,
  });

  const additionalInterfaces = trafficInterfacesData || [];
  const hasAdditionalInterfaces = additionalInterfaces.length > 0;

  // Query de eventos com paginação
  interface LinkEventsResponse {
    events: (Event & { linkName?: string | null })[];
    total: number;
    page: number;
    pageSize: number;
  }
  
  const { data: eventsData, isLoading: eventsLoading, refetch: refetchEvents } = useQuery<LinkEventsResponse>({
    queryKey: ["/api/links", linkId, "events", eventPage, eventPageSize],
    queryFn: async () => {
      const res = await fetch(`/api/links/${linkId}/events?page=${eventPage}&pageSize=${eventPageSize}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch events");
      return res.json();
    },
    enabled: !isNaN(linkId),
    refetchInterval: 30000,
  });
  
  const events = eventsData?.events || [];
  const eventsTotal = eventsData?.total || 0;
  const eventsTotalPages = Math.ceil(eventsTotal / eventPageSize);
  
  // Filtrar eventos localmente (busca e filtros)
  const filteredEvents = events.filter((event) => {
    const title = event.title || "";
    const description = event.description || "";
    const matchesSearch =
      title.toLowerCase().includes(eventSearch.toLowerCase()) ||
      description.toLowerCase().includes(eventSearch.toLowerCase());
    const matchesType = eventTypeFilter === "all" || event.type === eventTypeFilter;
    const matchesStatus =
      eventStatusFilter === "all" ||
      (eventStatusFilter === "resolved" && event.resolved) ||
      (eventStatusFilter === "active" && !event.resolved);
    return matchesSearch && matchesType && matchesStatus;
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

  // Buscar dispositivos do link (CPEs, OLT, Concentrador) para exibição na aba Equipamento
  const { data: devicesInfo } = useQuery<DevicesInfo>({
    queryKey: ["/api/links", linkId, "tools", "devices"],
    enabled: !isNaN(linkId),
    refetchInterval: 30000,
  });

  // Buscar lista de switches para exibição quando link PTP
  const { data: switches } = useQuery<Array<{ id: number; name: string; ipAddress: string; vendor: string | null; model: string | null }>>({
    queryKey: ["/api/switches"],
    enabled: (link as any)?.linkType === "ptp" && !!(link as any)?.switchId,
  });

  // Dados do switch vinculado ao link PTP
  const linkedSwitch = switches?.find((s) => s.id === (link as any)?.switchId);
  
  // CPE principal para exibição na aba Equipamento (prioridade: showInEquipmentTab > primary > primeiro)
  const equipmentCpe = devicesInfo?.cpes?.find((c: CpeDeviceInfo) => (c as any).showInEquipmentTab) 
    || devicesInfo?.cpes?.find((c: CpeDeviceInfo) => c.role === "primary") 
    || devicesInfo?.cpes?.[0] 
    || null;

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
        <div className="flex items-center gap-2">
          {isSuperAdmin && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditDialogOpen(true)}
              data-testid="button-edit-link"
            >
              <Pencil className="w-4 h-4 mr-2" />
              Editar Link
            </Button>
          )}
          <Button variant="outline" size="sm" data-testid="button-refresh">
            <RefreshCw className="w-4 h-4 mr-2" />
            Atualizar
          </Button>
        </div>
      </div>

      {mitigationStatus?.isMitigated && mitigationStatus.mitigationInfo && (
        <Card className="border-amber-500/50 bg-amber-500/5">
          <CardContent className="flex items-center gap-4 py-4">
            <div className="flex-shrink-0 w-12 h-12 rounded-full bg-amber-500/10 flex items-center justify-center">
              <Shield className="w-6 h-6 text-amber-500" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-amber-600 dark:text-amber-400" data-testid="text-mitigation-active">
                Link em Mitigação DDoS
              </h3>
              <p className="text-sm text-muted-foreground">
                Prefixo: <span className="font-mono">{mitigationStatus.mitigationInfo.prefix}</span> via {mitigationStatus.mitigationInfo.connector}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Mitigação ativa desde {format(new Date(mitigationStatus.mitigationInfo.announcedAt), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                {mitigationStatus.mitigationInfo.expiresAt && (
                  <> - Expira em {format(new Date(mitigationStatus.mitigationInfo.expiresAt), "dd/MM/yyyy HH:mm", { locale: ptBR })}</>
                )}
              </p>
            </div>
            <Badge variant="outline" className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20">
              BGP Ativo
            </Badge>
          </CardContent>
        </Card>
      )}

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
              {(link as any).linkType !== "ptp" && link.oltId && link.onuId && (
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
              {(link as any).linkType === "ptp" && linkedSwitch && (
                <Badge variant="outline" className="gap-1">
                  <Network className="w-3 h-3" />
                  {linkedSwitch.name} - Porta {(link as any).switchPort || "N/A"}
                </Badge>
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

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
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
              ) : hasAdditionalInterfaces ? (
                <MultiTrafficChart
                  mainData={bandwidthData}
                  mainLabel="Principal"
                  mainColor="#3b82f6"
                  invertMainBandwidth={(link as any)?.invertBandwidth}
                  additionalInterfaces={additionalInterfaces.map(iface => ({
                    id: iface.id,
                    label: iface.label,
                    color: iface.color,
                    invertBandwidth: iface.invertBandwidth,
                  }))}
                  additionalMetrics={additionalInterfaces.flatMap(iface => 
                    (iface.metrics || []).map(m => ({
                      trafficInterfaceId: iface.id,
                      timestamp: m.timestamp,
                      download: m.download,
                      upload: m.upload,
                    }))
                  )}
                  height={300}
                  showLegend={true}
                />
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
                  <span className="font-medium">
                    {equipmentCpe?.model || link.equipmentModel || equipmentCpe?.manufacturer || "Não informado"}
                  </span>
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
                <CardTitle className="text-base">
                  Recursos do Sistema
                  {equipmentCpe && (
                    <span className="text-xs text-muted-foreground ml-2 font-normal">
                      ({equipmentCpe.name})
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {equipmentCpe ? (
                  equipmentCpe.lastMonitoredAt && equipmentCpe.cpuUsage !== null && equipmentCpe.cpuUsage !== undefined ? (
                    <>
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="flex items-center gap-2 text-muted-foreground">
                            <Cpu className="w-4 h-4" />
                            CPU
                          </span>
                          <span className="font-mono">{(equipmentCpe.cpuUsage ?? 0).toFixed(1)}%</span>
                        </div>
                        <div className="h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary transition-all"
                            style={{ width: `${equipmentCpe.cpuUsage ?? 0}%` }}
                          />
                        </div>
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="flex items-center gap-2 text-muted-foreground">
                            <HardDrive className="w-4 h-4" />
                            Memória
                          </span>
                          <span className="font-mono">{(equipmentCpe.memoryUsage ?? 0).toFixed(1)}%</span>
                        </div>
                        <div className="h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary transition-all"
                            style={{ width: `${equipmentCpe.memoryUsage ?? 0}%` }}
                          />
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground text-right">
                        Última coleta: {new Date(equipmentCpe.lastMonitoredAt).toLocaleString('pt-BR')}
                      </div>
                    </>
                  ) : (
                    <div className="text-center py-4">
                      <p className="text-muted-foreground text-sm">Aguardando coleta de métricas do CPE</p>
                      <p className="text-xs text-muted-foreground mt-1">Verifique se o perfil SNMP e fabricante estão configurados corretamente</p>
                    </div>
                  )
                ) : (
                  <>
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
                    <div className="text-xs text-muted-foreground">
                      Nenhum CPE cadastrado. Dados exibidos são do monitoramento da interface.
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
          
          {equipmentCpe && equipmentCpe.cpeId && (
            <Card>
              <CardHeader className="flex flex-row items-center gap-2 space-y-0">
                <Network className="w-5 h-5" />
                <CardTitle className="text-base">Status das Portas</CardTitle>
              </CardHeader>
              <CardContent>
                <CpePortStatusDisplay 
                  cpeId={equipmentCpe.cpeId} 
                  linkCpeId={equipmentCpe.linkCpeId}
                  cpeName={equipmentCpe.name}
                />
              </CardContent>
            </Card>
          )}
          <FlashmanPanel linkId={linkId} />
        </TabsContent>

        <TabsContent value="events">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-4">
              <CardTitle className="text-lg">Eventos do Link</CardTitle>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Filter className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground" data-testid="text-events-count">
                    {eventsTotal > 0 ? `${((eventPage - 1) * eventPageSize + 1).toLocaleString("pt-BR")}-${Math.min(eventPage * eventPageSize, eventsTotal).toLocaleString("pt-BR")} de ${eventsTotal.toLocaleString("pt-BR")}` : "0 eventos"}
                  </span>
                </div>
                <Button variant="outline" size="sm" onClick={() => refetchEvents()} data-testid="button-refresh-events">
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Atualizar
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col md:flex-row gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Buscar eventos..."
                    value={eventSearch}
                    onChange={(e) => setEventSearch(e.target.value)}
                    className="pl-9"
                    data-testid="input-search-link-events"
                  />
                </div>
                <Select value={eventTypeFilter} onValueChange={setEventTypeFilter}>
                  <SelectTrigger className="w-full md:w-40" data-testid="select-event-type-filter">
                    <SelectValue placeholder="Tipo" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos os tipos</SelectItem>
                    <SelectItem value="info">Informação</SelectItem>
                    <SelectItem value="warning">Aviso</SelectItem>
                    <SelectItem value="critical">Crítico</SelectItem>
                    <SelectItem value="maintenance">Manutenção</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={eventStatusFilter} onValueChange={setEventStatusFilter}>
                  <SelectTrigger className="w-full md:w-40" data-testid="select-event-status-filter">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="active">Ativos</SelectItem>
                    <SelectItem value="resolved">Resolvidos</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {eventsLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : (
                <EventsTable events={filteredEvents} />
              )}

              <div className="flex items-center justify-between pt-4 border-t">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Itens por página:</span>
                  <Select value={eventPageSize.toString()} onValueChange={(v) => { setEventPageSize(parseInt(v, 10)); setEventPage(1); }}>
                    <SelectTrigger className="w-20" data-testid="select-events-page-size">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="50">50</SelectItem>
                      <SelectItem value="100">100</SelectItem>
                      <SelectItem value="200">200</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground" data-testid="text-events-page-info">
                    Página {eventPage} de {eventsTotalPages || 1}
                  </span>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setEventPage(p => Math.max(1, p - 1))}
                    disabled={eventPage <= 1}
                    data-testid="button-events-prev-page"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setEventPage(p => Math.min(eventsTotalPages, p + 1))}
                    disabled={eventPage >= eventsTotalPages}
                    data-testid="button-events-next-page"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
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
          <OzmapRouteSection link={link} />
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

        {/* Aba de Ferramentas - Apenas Super Admin - forceMount mantém sessões ativas */}
        {isSuperAdmin && (
          <TabsContent 
            value="tools" 
            className={`space-y-4 ${activeTab !== "tools" ? "hidden" : ""}`}
            forceMount
          >
            <ToolsSection linkId={linkId} link={link} />
          </TabsContent>
        )}
      </Tabs>

      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editar Link</DialogTitle>
          </DialogHeader>

          {(link?.voalleConnectionId || link?.voalleContractTagServiceTag) && (
            <div data-testid="voalle-compare-panel">
              {voalleCompareLoading ? (
                <div className="flex items-center gap-2 p-3 rounded-md bg-muted/50 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Comparando com Voalle...
                </div>
              ) : voalleCompare?.available && voalleCompare.allFields ? (
                <div className={`rounded-md border p-3 space-y-2 ${
                  voalleCompare.divergences && voalleCompare.divergences.length > 0
                    ? 'border-yellow-500/30 bg-yellow-500/5'
                    : 'border-green-500/20 bg-green-500/5'
                }`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className={`flex items-center gap-2 text-sm font-medium ${
                      voalleCompare.divergences && voalleCompare.divergences.length > 0
                        ? 'text-yellow-600 dark:text-yellow-400'
                        : 'text-green-600 dark:text-green-400'
                    }`}>
                      {voalleCompare.divergences && voalleCompare.divergences.length > 0 ? (
                        <GitCompare className="h-4 w-4" />
                      ) : (
                        <Check className="h-4 w-4" />
                      )}
                      {voalleCompare.divergences && voalleCompare.divergences.length > 0
                        ? `${voalleCompare.divergences.length} divergência${voalleCompare.divergences.length > 1 ? 's' : ''} com Voalle`
                        : 'Dados sincronizados com Voalle'}
                      {voalleCompare.voalleConnectionId && (
                        <span className="text-xs font-normal text-muted-foreground">(Conexão #{voalleCompare.voalleConnectionId})</span>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => refetchVoalleCompare()}
                      data-testid="button-refresh-voalle-compare"
                    >
                      <RefreshCw className="h-3 w-3" />
                    </Button>
                  </div>
                  <div className="space-y-0.5">
                    {voalleCompare.allFields.map((f, i) => (
                      <div key={i} className={`flex items-center gap-2 text-xs rounded px-2 py-1 ${!f.match ? 'bg-background/50' : ''}`} data-testid={`voalle-field-${i}`}>
                        <span className="font-medium min-w-[140px] text-muted-foreground">{f.label}</span>
                        {f.match ? (
                          <>
                            <Check className="h-3 w-3 shrink-0 text-green-500" />
                            <span className="text-muted-foreground truncate max-w-[300px]" title={String(f.local ?? f.voalle ?? '(vazio)')}>
                              {f.local ?? f.voalle ?? <span className="italic">(vazio)</span>}
                            </span>
                          </>
                        ) : (
                          <>
                            <span className="text-red-500 dark:text-red-400 truncate max-w-[180px]" title={String(f.local ?? '(vazio)')}>
                              {f.local ?? <span className="italic text-muted-foreground">(vazio)</span>}
                            </span>
                            <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                            <span className="text-green-600 dark:text-green-400 truncate max-w-[180px]" title={String(f.voalle ?? '(vazio)')}>
                              {f.voalle ?? <span className="italic text-muted-foreground">(vazio)</span>}
                            </span>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ) : voalleCompareError ? (
                <div className="flex items-center gap-2 p-3 rounded-md bg-red-500/5 border border-red-500/20 text-sm text-muted-foreground">
                  <AlertTriangle className="h-4 w-4 text-red-500" />
                  Erro ao comparar com Voalle
                  <Button variant="ghost" size="sm" onClick={() => refetchVoalleCompare()} className="ml-auto">
                    <RefreshCw className="h-3 w-3" />
                  </Button>
                </div>
              ) : voalleCompare && !voalleCompare.available ? (
                <div className="flex items-center gap-2 p-3 rounded-md bg-muted/50 text-sm text-muted-foreground">
                  <GitCompare className="h-4 w-4" />
                  {voalleCompare.message}
                </div>
              ) : null}

              {voalleCompare?.available && voalleCompare.ozmapDivergences && voalleCompare.ozmapDivergences.length > 0 && (
                <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-3 space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium text-blue-600 dark:text-blue-400">
                    <MapPin className="h-4 w-4" />
                    {voalleCompare.ozmapDivergences.length} divergência{voalleCompare.ozmapDivergences.length > 1 ? 's' : ''} com OZmap
                    <span className="text-xs font-normal text-muted-foreground">(dados de splitter/OLT)</span>
                  </div>
                  <div className="space-y-1">
                    {voalleCompare.ozmapDivergences.map((d, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs rounded px-2 py-1 bg-background/50" data-testid={`ozmap-divergence-${i}`}>
                        <span className="font-medium min-w-[140px] text-muted-foreground">{d.label}</span>
                        <span className="text-red-500 dark:text-red-400 truncate max-w-[200px]" title={d.local ?? '(vazio)'}>
                          {d.local ?? <span className="italic text-muted-foreground">(vazio)</span>}
                        </span>
                        <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                        <span className="text-blue-600 dark:text-blue-400 truncate max-w-[200px]" title={d.ozmap ?? '(vazio)'}>
                          {d.ozmap ?? <span className="italic text-muted-foreground">(vazio)</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <LinkForm
            link={link || undefined}
            onSave={(data) => updateLinkMutation.mutate(data)}
            onClose={() => setEditDialogOpen(false)}
            snmpProfiles={snmpProfiles}
            clients={clients}
            onProfileCreated={() => queryClient.invalidateQueries({ queryKey: ["/api/snmp-profiles"] })}
          />
        </DialogContent>
      </Dialog>
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
  sshPassword?: string;
  sshPort?: number;
  webPort?: number;
  webProtocol?: string;
  winboxPort?: number;
  vendor?: string;
}

interface CpeDeviceInfo extends DeviceInfo {
  id?: number;
  cpeId?: number;
  linkCpeId?: number;
  type?: string;
  role?: string;
  manufacturer?: string | null;
  model?: string | null;
  macAddress?: string | null;
  hasAccess?: boolean;
  cpuUsage?: number | null;
  memoryUsage?: number | null;
  lastMonitoredAt?: string | null;
}

interface RadiusAuthInfo {
  enabled: boolean;
  hasCredentials: boolean;
  username: string | null;
  password: string | null;
}

interface DevicesInfo {
  olt: DeviceInfo | null;
  switch: DeviceInfo | null;
  concentrator: DeviceInfo;
  cpe: DeviceInfo;
  cpes?: CpeDeviceInfo[];
  radiusAuth?: RadiusAuthInfo;
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

type TerminalType = "shell" | "ssh-olt" | "ssh-access-point" | "ssh-concentrator" | "ssh-cpe";

interface OpenTerminals {
  shell: boolean;
  "ssh-olt": boolean;
  "ssh-access-point": boolean;
  "ssh-concentrator": boolean;
  "ssh-cpe": boolean;
}

function ToolsSection({ linkId, link }: ToolsSectionProps) {
  const [pingResult, setPingResult] = useState<PingResult | null>(null);
  const [tracerouteResult, setTracerouteResult] = useState<TracerouteResult | null>(null);
  const [openTerminals, setOpenTerminals] = useState<OpenTerminals>({
    shell: false,
    "ssh-olt": false,
    "ssh-access-point": false,
    "ssh-concentrator": false,
    "ssh-cpe": false,
  });
  const [terminalKeys, setTerminalKeys] = useState<Record<TerminalType, number>>({
    shell: 0,
    "ssh-olt": 0,
    "ssh-access-point": 0,
    "ssh-concentrator": 0,
    "ssh-cpe": 0,
  });
  // Estado para terminais de CPEs individuais (quando há múltiplos)
  const [openCpeTerminals, setOpenCpeTerminals] = useState<Record<number, boolean>>({});
  const [cpeTerminalKeys, setCpeTerminalKeys] = useState<Record<number, number>>({});
  // Ref para o terminal CPE (usado pela biblioteca de comandos)
  const cpeTerminalRef = useRef<XtermTerminalRef>(null);
  const cpeTerminalRefs = useRef<Record<number, XtermTerminalRef | null>>({});
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

  const getSshConfig = (type: TerminalType): { command?: string; password?: string; fallbackPassword?: string; fallbackUser?: string } => {
    if (type === "shell") return {};
    
    // Determina o dispositivo de ponto de acesso (OLT para GPON, Switch para PTP)
    const isPtpLink = link?.linkType === "ptp";
    const accessPointDev = isPtpLink ? devices?.switch : devices?.olt;
    
    // O backend já retorna as credenciais corretas (RADIUS ou locais) em sshUser/sshPassword
    // e as credenciais de fallback (locais) em fallbackSshUser/fallbackSshPassword quando usando RADIUS
    interface DeviceInfo {
      ip?: string;
      sshUser?: string;
      sshPassword?: string;
      sshPort?: number;
      fallbackSshUser?: string;
      fallbackSshPassword?: string;
    }
    
    const deviceMap: Record<string, DeviceInfo> = {
      "ssh-olt": { 
        ip: devices?.olt?.ip, 
        sshUser: devices?.olt?.sshUser, 
        sshPassword: devices?.olt?.sshPassword, 
        sshPort: devices?.olt?.sshPort,
        fallbackSshUser: (devices?.olt as any)?.fallbackSshUser,
        fallbackSshPassword: (devices?.olt as any)?.fallbackSshPassword,
      },
      "ssh-access-point": { 
        ip: accessPointDev?.ip, 
        sshUser: accessPointDev?.sshUser, 
        sshPassword: accessPointDev?.sshPassword, 
        sshPort: accessPointDev?.sshPort,
        fallbackSshUser: (accessPointDev as any)?.fallbackSshUser,
        fallbackSshPassword: (accessPointDev as any)?.fallbackSshPassword,
      },
      "ssh-concentrator": { 
        ip: devices?.concentrator?.ip, 
        sshUser: devices?.concentrator?.sshUser, 
        sshPassword: devices?.concentrator?.sshPassword, 
        sshPort: devices?.concentrator?.sshPort,
        fallbackSshUser: (devices?.concentrator as any)?.fallbackSshUser,
        fallbackSshPassword: (devices?.concentrator as any)?.fallbackSshPassword,
      },
      "ssh-cpe": { 
        ip: devices?.cpe?.ip, 
        sshUser: devices?.cpe?.sshUser, 
        sshPassword: devices?.cpe?.sshPassword, 
        sshPort: devices?.cpe?.sshPort,
        fallbackSshUser: (devices?.cpe as any)?.fallbackSshUser,
        fallbackSshPassword: (devices?.cpe as any)?.fallbackSshPassword,
      },
    };
    
    const device = deviceMap[type];
    if (!device?.ip) return {};
    
    // Credenciais primárias (já resolvidas pelo backend - RADIUS ou locais)
    const user = device.sshUser || "admin";
    const password = device.sshPassword;
    
    // Credenciais de fallback (locais do dispositivo, usadas quando RADIUS falha)
    const fallbackUser = device.fallbackSshUser;
    const fallbackPassword = device.fallbackSshPassword;
    
    const port = device.sshPort || 22;
    const portArg = port !== 22 ? `-p ${port} ` : "";
    // Opções SSH inline para compatibilidade com equipamentos legados (sem arquivo externo)
    const legacyOpts = "-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o KexAlgorithms=diffie-hellman-group14-sha1,diffie-hellman-group1-sha1,diffie-hellman-group-exchange-sha256,diffie-hellman-group-exchange-sha1,curve25519-sha256 -o HostKeyAlgorithms=rsa-sha2-256,rsa-sha2-512,ssh-rsa,ssh-ed25519,ecdsa-sha2-nistp256,ssh-dss -o Ciphers=aes128-ctr,aes256-ctr,aes128-cbc,aes256-cbc,3des-cbc,chacha20-poly1305@openssh.com -o PubkeyAcceptedAlgorithms=rsa-sha2-256,ssh-rsa,ssh-ed25519,ssh-dss -o MACs=hmac-sha1,hmac-md5,hmac-sha2-256,hmac-sha2-512";
    if (password) {
      return {
        command: `sshpass -e ssh ${legacyOpts} ${portArg}${user}@${device.ip}`,
        password: password,
        fallbackPassword: fallbackPassword || undefined,
        fallbackUser: fallbackUser || undefined,
      };
    }
    return { command: `ssh ${legacyOpts} ${portArg}${user}@${device.ip}` };
  };

  const toggleTerminal = (type: TerminalType) => {
    setOpenTerminals(prev => ({ ...prev, [type]: !prev[type] }));
    if (!openTerminals[type]) {
      setTerminalKeys(prev => ({ ...prev, [type]: prev[type] + 1 }));
    }
  };

  const closeTerminal = (type: TerminalType) => {
    setOpenTerminals(prev => ({ ...prev, [type]: false }));
  };

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

  const oltAvailable = !!devices?.olt?.ip;
  const switchAvailable = !!devices?.switch?.ip;
  const concentratorAvailable = !!devices?.concentrator?.ip;
  const cpeAvailable = !!devices?.cpe?.ip;
  
  // Para links PTP, usar switch como ponto de acesso ao invés de OLT
  const isPtp = link?.linkType === "ptp";
  const accessPointAvailable = isPtp ? switchAvailable : oltAvailable;
  const accessPointDevice = isPtp ? devices?.switch : devices?.olt;
  const accessPointName = accessPointDevice?.name || (isPtp ? "Switch" : "Ponto de Acesso");

  return (
    <div className="space-y-4">
      {/* Terminais - Grid 2x2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Terminal Shell */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Terminal className="w-4 h-4" />
                Terminal
              </CardTitle>
              <Button
                size="sm"
                variant={openTerminals.shell ? "destructive" : "default"}
                onClick={() => toggleTerminal("shell")}
                data-testid="button-terminal-shell"
              >
                {openTerminals.shell ? <X className="w-4 h-4" /> : "Abrir"}
              </Button>
            </div>
          </CardHeader>
          {openTerminals.shell && (
            <CardContent className="pt-0">
              <div className="border rounded-md overflow-hidden">
                <XtermTerminal key={terminalKeys.shell} />
              </div>
            </CardContent>
          )}
        </Card>

        {/* SSH Ponto de Acesso (OLT ou Switch para PTP) */}
        <Card className={!accessPointAvailable ? "opacity-50" : ""}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Radio className="w-4 h-4" />
                {accessPointName}
                {isPtp && <Badge variant="secondary" className="text-xs">switch</Badge>}
              </CardTitle>
              <Button
                size="sm"
                variant={openTerminals["ssh-access-point"] ? "destructive" : "default"}
                onClick={() => toggleTerminal("ssh-access-point")}
                disabled={!accessPointAvailable}
                data-testid="button-terminal-ssh-access-point"
              >
                {openTerminals["ssh-access-point"] ? <X className="w-4 h-4" /> : "SSH"}
              </Button>
            </div>
            {accessPointAvailable && (
              <p className="text-xs text-muted-foreground">{accessPointDevice?.ip}</p>
            )}
          </CardHeader>
          {openTerminals["ssh-access-point"] && (
            <CardContent className="pt-0">
              <div className="border rounded-md overflow-hidden">
                <XtermTerminal 
                  key={terminalKeys["ssh-access-point"]} 
                  initialCommand={getSshConfig("ssh-access-point").command} 
                  sshPassword={getSshConfig("ssh-access-point").password}
                  fallbackPassword={getSshConfig("ssh-access-point").fallbackPassword}
                  fallbackUser={getSshConfig("ssh-access-point").fallbackUser}
                />
              </div>
            </CardContent>
          )}
        </Card>

        {/* SSH Concentrador */}
        <Card className={!concentratorAvailable ? "opacity-50" : ""}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Server className="w-4 h-4" />
                {devices?.concentrator?.name || "Concentrador"}
              </CardTitle>
              <Button
                size="sm"
                variant={openTerminals["ssh-concentrator"] ? "destructive" : "default"}
                onClick={() => toggleTerminal("ssh-concentrator")}
                disabled={!concentratorAvailable}
                data-testid="button-terminal-ssh-concentrator"
              >
                {openTerminals["ssh-concentrator"] ? <X className="w-4 h-4" /> : "SSH"}
              </Button>
            </div>
            {concentratorAvailable && (
              <p className="text-xs text-muted-foreground">{devices?.concentrator?.ip}</p>
            )}
          </CardHeader>
          {openTerminals["ssh-concentrator"] && (
            <CardContent className="pt-0">
              <div className="border rounded-md overflow-hidden">
                <XtermTerminal 
                  key={terminalKeys["ssh-concentrator"]} 
                  initialCommand={getSshConfig("ssh-concentrator").command} 
                  sshPassword={getSshConfig("ssh-concentrator").password}
                  fallbackPassword={getSshConfig("ssh-concentrator").fallbackPassword}
                  fallbackUser={getSshConfig("ssh-concentrator").fallbackUser}
                />
              </div>
            </CardContent>
          )}
        </Card>

        {/* CPEs do Link */}
        {devices?.cpes && devices.cpes.length > 0 ? (
          devices.cpes.map((cpe) => {
            const isOpen = openCpeTerminals[cpe.id || 0] || false;
            const cpeKey = cpeTerminalKeys[cpe.id || 0] || 0;
            // Opções SSH inline para compatibilidade com equipamentos legados (sem arquivo externo)
            const legacyOpts = "-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o KexAlgorithms=diffie-hellman-group14-sha1,diffie-hellman-group1-sha1,diffie-hellman-group-exchange-sha256,diffie-hellman-group-exchange-sha1,curve25519-sha256 -o HostKeyAlgorithms=rsa-sha2-256,rsa-sha2-512,ssh-rsa,ssh-ed25519,ecdsa-sha2-nistp256,ssh-dss -o Ciphers=aes128-ctr,aes256-ctr,aes128-cbc,aes256-cbc,3des-cbc,chacha20-poly1305@openssh.com -o PubkeyAcceptedAlgorithms=rsa-sha2-256,ssh-rsa,ssh-ed25519,ssh-dss -o MACs=hmac-sha1,hmac-md5,hmac-sha2-256,hmac-sha2-512";
            // O backend já retorna as credenciais corretas (RADIUS ou locais) em sshUser/sshPassword
            // e as credenciais de fallback em fallbackSshUser/fallbackSshPassword
            const sshUser = cpe.sshUser || "admin";
            const sshPassword = cpe.sshPassword;
            const cpeFallbackUser = (cpe as any).fallbackSshUser;
            const cpeFallbackPassword = (cpe as any).fallbackSshPassword;
            const sshCommand = cpe.ip 
              ? (sshPassword 
                  ? `sshpass -e ssh ${legacyOpts} -p ${cpe.sshPort || 22} ${sshUser}@${cpe.ip}`
                  : `ssh ${legacyOpts} -p ${cpe.sshPort || 22} ${sshUser}@${cpe.ip}`)
              : undefined;
            const roleLabel = cpe.role === "primary" ? "Principal" : cpe.role === "backup" ? "Backup" : cpe.role === "firewall" ? "Firewall" : cpe.role || "";
            return (
              <Card key={cpe.id} className={!cpe.available ? "opacity-50" : ""}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <HardDrive className="w-4 h-4" />
                      <span className="truncate">{cpe.name}</span>
                      <Badge variant="outline" className="text-xs">{cpe.type || "CPE"}</Badge>
                      {roleLabel && <Badge variant="secondary" className="text-xs">{roleLabel}</Badge>}
                    </CardTitle>
                    <Button
                      size="sm"
                      variant={isOpen ? "destructive" : "default"}
                      onClick={() => {
                        setOpenCpeTerminals(prev => ({ ...prev, [cpe.id || 0]: !prev[cpe.id || 0] }));
                        if (!isOpen) {
                          setCpeTerminalKeys(prev => ({ ...prev, [cpe.id || 0]: (prev[cpe.id || 0] || 0) + 1 }));
                        }
                      }}
                      disabled={!cpe.available}
                      data-testid={`button-terminal-ssh-cpe-${cpe.id}`}
                    >
                      {isOpen ? <X className="w-4 h-4" /> : "SSH"}
                    </Button>
                  </div>
                  {cpe.available && (
                    <p className="text-xs text-muted-foreground">
                      {cpe.ip} {cpe.macAddress && `(${cpe.macAddress})`} {cpe.manufacturer && `- ${cpe.manufacturer}`} {cpe.model && cpe.model}
                    </p>
                  )}
                  {!cpe.hasAccess && (
                    <p className="text-xs text-yellow-600">Sem acesso configurado</p>
                  )}
                </CardHeader>
                {isOpen && (
                  <CardContent className="pt-0">
                    <div className="border rounded-md overflow-hidden">
                      <XtermTerminal 
                        ref={(el) => { if (cpe.id !== undefined) cpeTerminalRefs.current[cpe.id] = el; }}
                        key={cpeKey} 
                        initialCommand={sshCommand} 
                        sshPassword={sshPassword || undefined}
                        fallbackPassword={cpeFallbackPassword || undefined}
                        fallbackUser={cpeFallbackUser || undefined}
                      />
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })
        ) : (
          <Card className={!cpeAvailable ? "opacity-50" : ""}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <HardDrive className="w-4 h-4" />
                  {devices?.cpe?.name || "CPE"}
                </CardTitle>
                <Button
                  size="sm"
                  variant={openTerminals["ssh-cpe"] ? "destructive" : "default"}
                  onClick={() => toggleTerminal("ssh-cpe")}
                  disabled={!cpeAvailable}
                  data-testid="button-terminal-ssh-cpe"
                >
                  {openTerminals["ssh-cpe"] ? <X className="w-4 h-4" /> : "SSH"}
                </Button>
              </div>
              {cpeAvailable && (
                <p className="text-xs text-muted-foreground">{devices?.cpe?.ip}</p>
              )}
            </CardHeader>
            <CardContent className="pt-0 pb-3">
              {devices?.cpe && (devices.cpe as CpeDeviceInfo).cpeId && (
                <CpePortStatusDisplay 
                  cpeId={(devices.cpe as CpeDeviceInfo).cpeId!}
                  linkCpeId={(devices.cpe as CpeDeviceInfo).linkCpeId}
                  compact
                />
              )}
            </CardContent>
            {openTerminals["ssh-cpe"] && (
              <CardContent className="pt-0">
                <div className="border rounded-md overflow-hidden">
                  <XtermTerminal 
                    ref={cpeTerminalRef}
                    key={terminalKeys["ssh-cpe"]} 
                    initialCommand={getSshConfig("ssh-cpe").command} 
                    sshPassword={getSshConfig("ssh-cpe").password}
                    fallbackPassword={getSshConfig("ssh-cpe").fallbackPassword}
                    fallbackUser={getSshConfig("ssh-cpe").fallbackUser}
                  />
                </div>
              </CardContent>
            )}
          </Card>
        )}
      </div>

      {/* Biblioteca de Comandos SSH */}
      {(devices?.cpe || (devices?.cpes && devices.cpes.length > 0)) && (
        <CpeCommandLibrary
          linkId={linkId}
          cpe={devices?.cpes?.[0] ? {
            id: devices.cpes[0].id || 0,
            cpeId: devices.cpes[0].cpeId || 0,
            linkCpeId: devices.cpes[0].linkCpeId,
            vendorId: (devices.cpes[0] as any).vendorId,
            model: devices.cpes[0].model,
            name: devices.cpes[0].name,
          } : devices?.cpe ? {
            id: 0,
            cpeId: (devices.cpe as CpeDeviceInfo).cpeId || 0,
            linkCpeId: (devices.cpe as CpeDeviceInfo).linkCpeId,
            vendorId: (devices.cpe as any).vendorId,
            model: (devices.cpe as CpeDeviceInfo).model,
            name: devices.cpe.name,
          } : null}
          onExecuteCommand={(command) => {
            // Tenta enviar para o terminal CPE principal
            if (openTerminals["ssh-cpe"] && cpeTerminalRef.current) {
              cpeTerminalRef.current.sendCommand(command);
              return;
            }
            // Tenta enviar para algum terminal de CPE individual aberto
            const openCpeId = Object.entries(openCpeTerminals).find(([, isOpen]) => isOpen)?.[0];
            if (openCpeId && cpeTerminalRefs.current[Number(openCpeId)]) {
              cpeTerminalRefs.current[Number(openCpeId)]?.sendCommand(command);
              return;
            }
            // Se nenhum terminal está aberto, mostra mensagem
            toast({
              title: "Nenhum terminal SSH aberto",
              description: "Abra um terminal SSH de CPE para executar comandos diretamente",
              variant: "destructive"
            });
          }}
        />
      )}

      {/* Dispositivos */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <DeviceCard
          title={isPtp ? `Ponto de Acesso (${accessPointDevice?.name || "Switch"})` : "Ponto de Acesso (OLT)"}
          icon={Radio}
          target={isPtp ? "switch" : "olt"}
          ip={accessPointDevice?.ip || null}
          available={accessPointDevice?.available || false}
          showWinbox={accessPointDevice?.vendor?.toLowerCase() === "mikrotik"}
          sshUser={accessPointDevice?.sshUser || "admin"}
          sshPort={accessPointDevice?.sshPort || 22}
          webPort={accessPointDevice?.webPort || 80}
          webProtocol={accessPointDevice?.webProtocol || "http"}
          winboxPort={accessPointDevice?.winboxPort || 8291}
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

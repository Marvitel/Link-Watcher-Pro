import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useState, useRef, useEffect, useCallback } from "react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Activity,
  ChevronDown,
  ChevronRight,
  Cpu,
  Cable,
  Eye,
  EyeOff,
  FileUp,
  Gauge,
  Globe,
  HardDrive,
  Info,
  Loader2,
  MessageSquare,
  MonitorSmartphone,
  Network,
  Pencil,
  Phone,
  Radio,
  RefreshCw,
  RotateCcw,
  Route,
  Save,
  Settings,
  Signal,
  Terminal,
  Wifi,
  Wrench,
  Zap,
} from "lucide-react";

const safeText = (val: any, fallback = "N/A"): string => {
  if (val === null || val === undefined) return fallback;
  if (typeof val === "string") return val || fallback;
  if (typeof val === "number") return String(val);
  if (typeof val === "boolean") return val ? "Sim" : "Não";
  if (typeof val === "object") return fallback;
  return String(val) || fallback;
};

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground text-sm">{label}</span>
      <span className={`text-sm ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}

function ThresholdBadge({ value, threshold, unit }: { value: number | null; threshold?: number | null; unit?: string }) {
  if (value === null || value === undefined) return <span className="text-muted-foreground text-sm">N/A</span>;
  const exceeded = threshold != null && value > threshold;
  return (
    <span className={`text-sm font-mono ${exceeded ? "text-red-500" : ""}`}>
      {value}{unit || ""}
    </span>
  );
}

export function FlashmanPanel({ linkId }: { linkId: number }) {
  const { toast } = useToast();
  const { isSuperAdmin } = useAuth();
  const queryClient = useQueryClient();
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [activeCommand, setActiveCommand] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const [showWifiEditDialog, setShowWifiEditDialog] = useState(false);
  const [editingWifiBand, setEditingWifiBand] = useState<"2g" | "5g">("2g");
  const [wifiEditForm, setWifiEditForm] = useState({ ssid: "", password: "", channel: "" });
  const [showCredentialsDialog, setShowCredentialsDialog] = useState(false);
  const [credentialsForm, setCredentialsForm] = useState({ username: "", password: "" });
  const [showDnsDialog, setShowDnsDialog] = useState(false);
  const [dnsForm, setDnsForm] = useState("");
  const [commentsText, setCommentsText] = useState("");
  const [commentsLoaded, setCommentsLoaded] = useState(false);
  const [showPassword2g, setShowPassword2g] = useState(false);
  const [showPassword5g, setShowPassword5g] = useState(false);
  const [showCredPassword, setShowCredPassword] = useState(false);

  const [showWanEditDialog, setShowWanEditDialog] = useState(false);
  const [editingWanId, setEditingWanId] = useState<string>("");
  const [wanEditForm, setWanEditForm] = useState({ mtu: "", vlanId: "", enable: true });
  const [expandedWans, setExpandedWans] = useState<Set<number>>(new Set());

  const [showVoipEditDialog, setShowVoipEditDialog] = useState(false);
  const [voipEditForm, setVoipEditForm] = useState<{
    sipServer: string;
    regulatoryDomain: string;
    wanSignal: string;
    enabled: boolean;
    lines: Array<{ phoneNumber: string; sipUser: string; connectionUser: string; password: string }>;
  }>({
    sipServer: "",
    regulatoryDomain: "",
    wanSignal: "",
    enabled: true,
    lines: [],
  });

  const [showLanEditDialog, setShowLanEditDialog] = useState(false);
  const [lanEditForm, setLanEditForm] = useState({ subnet: "", netmask: "" });

  const { data: flashmanData, isLoading: flashmanLoading, refetch: refetchFlashman } = useQuery<any>({
    queryKey: ["/api/links", linkId, "flashman", "info"],
    queryFn: async () => {
      const res = await fetch(`/api/links/${linkId}/flashman/info`, { credentials: "include" });
      return res.json();
    },
    staleTime: 30000,
    refetchInterval: 60000,
  });

  const { data: flashboardData } = useQuery<any>({
    queryKey: ["/api/links", linkId, "flashman", "flashboard"],
    queryFn: async () => {
      const res = await fetch(`/api/links/${linkId}/flashman/flashboard`, { credentials: "include" });
      return res.json();
    },
    enabled: !!flashmanData?.found,
    staleTime: 60000,
  });

  const { data: commentsData } = useQuery<any>({
    queryKey: ["/api/links", linkId, "flashman", "comments"],
    queryFn: async () => {
      const res = await fetch(`/api/links/${linkId}/flashman/comments`, { credentials: "include" });
      return res.json();
    },
    enabled: !!flashmanData?.found,
    staleTime: 60000,
  });

  const { data: dnsData } = useQuery<any>({
    queryKey: ["/api/links", linkId, "flashman", "dns"],
    queryFn: async () => {
      const res = await fetch(`/api/links/${linkId}/flashman/dns`, { credentials: "include" });
      return res.json();
    },
    enabled: !!flashmanData?.found,
    staleTime: 60000,
  });

  const { data: voipData, refetch: refetchVoip } = useQuery<any>({
    queryKey: ["/api/links", linkId, "flashman", "voip"],
    queryFn: async () => {
      const res = await fetch(`/api/links/${linkId}/flashman/voip`, { credentials: "include" });
      return res.json();
    },
    enabled: !!flashmanData?.found,
    staleTime: 60000,
  });

  const { data: webCredData, refetch: refetchCreds } = useQuery<any>({
    queryKey: ["/api/links", linkId, "flashman", "web-credentials"],
    queryFn: async () => {
      const res = await fetch(`/api/links/${linkId}/flashman/web-credentials`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!flashmanData?.found && !!isSuperAdmin,
    staleTime: 60000,
  });

  useEffect(() => {
    if (commentsData?.data && !commentsLoaded) {
      const c = commentsData.data;
      if (typeof c === "string") setCommentsText(c);
      else if (c?.comments) setCommentsText(c.comments);
      else if (c?.device?.comments) setCommentsText(c.device.comments);
      setCommentsLoaded(true);
    }
  }, [commentsData, commentsLoaded]);

  const [lastCommandNoResults, setLastCommandNoResults] = useState<string | null>(null);
  const prevResultsCountRef = useRef<number>(0);

  const stopPolling = useCallback(() => {
    if (pollingIntervalRef.current) { clearInterval(pollingIntervalRef.current); pollingIntervalRef.current = null; }
    if (pollingTimeoutRef.current) { clearTimeout(pollingTimeoutRef.current); pollingTimeoutRef.current = null; }
    setPolling(false);
    setActiveCommand(null);
  }, []);

  useEffect(() => {
    return () => { stopPolling(); };
  }, [stopPolling]);

  const commandMutation = useMutation({
    mutationFn: async (command: string) => {
      setActiveCommand(command);
      const payload: any = { command };
      if (command === "ping") {
        payload.hosts = ["8.8.8.8", "1.1.1.1"];
      } else if (command === "traceroute") {
        payload.host = "8.8.8.8";
      }
      const res = await apiRequest("POST", `/api/links/${linkId}/flashman/command`, payload);
      return res.json();
    },
    onSuccess: (_data, command) => {
      toast({ title: `Comando "${command}" enviado com sucesso` });
      stopPolling();
      setPolling(true);
      setActiveCommand(command);
      setLastCommandNoResults(null);
      const currentDevice = flashmanData?.device;
      const getResultsCount = (d: any, cmd: string) => {
        if (!d) return 0;
        if (cmd === "ping") return d.pingResults?.length || 0;
        if (cmd === "traceroute") return d.tracerouteResults?.length || 0;
        if (cmd === "speedtest") return d.speedtestResults?.length || 0;
        if (cmd === "onlinedevs") return d.connectedDevices?.length || 0;
        if (cmd === "sitesurvey") return d.siteSurveyResult?.length || 0;
        return 0;
      };
      prevResultsCountRef.current = getResultsCount(currentDevice, command);
      const pollInterval = command === "traceroute" ? 10000 : command === "speedtest" ? 10000 : 5000;
      const pollTimeout = command === "traceroute" ? 360000 : 120000;
      pollingIntervalRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/links/${linkId}/flashman/poll`, { credentials: "include" });
          if (!res.ok) return;
          const pollData = await res.json();
          if (pollData.device) {
            queryClient.setQueryData(["/api/links", linkId, "flashman", "info"], {
              enabled: true,
              found: true,
              device: pollData.device,
            });
            const newCount = getResultsCount(pollData.device, command);
            const hasNewResults = newCount > prevResultsCountRef.current;
            const diagDone = pollData.device.currentDiagnostic && !pollData.device.currentDiagnostic.inProgress;
            if (hasNewResults || diagDone) {
              stopPolling();
              toast({ title: "Diagnóstico concluído" });
            }
          }
        } catch {}
      }, pollInterval);
      pollingTimeoutRef.current = setTimeout(() => {
        setLastCommandNoResults(command);
        stopPolling();
        refetchFlashman();
        toast({ title: `Tempo esgotado aguardando resultado de ${command}`, variant: "destructive" });
      }, pollTimeout);
    },
    onError: async (error: any) => {
      let msg = "Erro ao enviar comando";
      try {
        const errText = error?.message || "";
        const jsonMatch = errText.match(/\d+:\s*([\s\S]*)/);
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[1]);
            msg = parsed.error || parsed.message || msg;
          } catch {
            msg = jsonMatch[1] || msg;
          }
        } else if (errText) {
          msg = errText;
        }
      } catch {}
      toast({ title: msg, variant: "destructive" });
      stopPolling();
    },
  });

  const configFileMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/links/${linkId}/flashman/config-file`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Arquivo de configuração enviado" });
    },
    onError: () => {
      toast({ title: "Erro ao enviar arquivo de configuração", variant: "destructive" });
    },
  });

  const wifiMutation = useMutation({
    mutationFn: async ({ wifiId, data }: { wifiId: string; data: any }) => {
      const res = await apiRequest("PUT", `/api/links/${linkId}/flashman/wifi/interface/${wifiId}`, data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Wi-Fi atualizado com sucesso" });
      setShowWifiEditDialog(false);
      refetchFlashman();
    },
    onError: () => {
      toast({ title: "Erro ao atualizar Wi-Fi", variant: "destructive" });
    },
  });

  const credentialsMutation = useMutation({
    mutationFn: async (data: { username?: string; password?: string }) => {
      const res = await apiRequest("PUT", `/api/links/${linkId}/flashman/web-credentials`, data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Credenciais atualizadas" });
      setShowCredentialsDialog(false);
      refetchCreds();
    },
    onError: () => {
      toast({ title: "Erro ao atualizar credenciais", variant: "destructive" });
    },
  });

  const dnsMutation = useMutation({
    mutationFn: async (dnsServers: string[]) => {
      const res = await apiRequest("PUT", `/api/links/${linkId}/flashman/dns`, { dnsServers });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "DNS atualizado" });
      setShowDnsDialog(false);
      queryClient.invalidateQueries({ queryKey: ["/api/links", linkId, "flashman", "dns"] });
    },
    onError: () => {
      toast({ title: "Erro ao atualizar DNS", variant: "destructive" });
    },
  });

  const commentsMutation = useMutation({
    mutationFn: async (comments: string) => {
      const res = await apiRequest("PUT", `/api/links/${linkId}/flashman/comments`, { comments });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Observações salvas" });
      queryClient.invalidateQueries({ queryKey: ["/api/links", linkId, "flashman", "comments"] });
    },
    onError: () => {
      toast({ title: "Erro ao salvar observações", variant: "destructive" });
    },
  });

  const wanMutation = useMutation({
    mutationFn: async ({ wanId, data }: { wanId: string; data: any }) => {
      const res = await apiRequest("PUT", `/api/links/${linkId}/flashman/wan/${wanId}`, data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "WAN atualizada com sucesso" });
      setShowWanEditDialog(false);
      refetchFlashman();
    },
    onError: () => {
      toast({ title: "Erro ao atualizar WAN", variant: "destructive" });
    },
  });

  const voipMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("PUT", `/api/links/${linkId}/flashman/voip`, data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "VoIP atualizado com sucesso" });
      setShowVoipEditDialog(false);
      refetchVoip();
    },
    onError: () => {
      toast({ title: "Erro ao atualizar VoIP", variant: "destructive" });
    },
  });

  const lanMutation = useMutation({
    mutationFn: async (data: { lan_subnet?: string; lan_netmask?: string }) => {
      const res = await apiRequest("PUT", `/api/links/${linkId}/flashman/lan`, data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "LAN atualizada com sucesso" });
      setShowLanEditDialog(false);
      refetchFlashman();
    },
    onError: () => {
      toast({ title: "Erro ao atualizar LAN", variant: "destructive" });
    },
  });

  if (flashmanLoading) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center gap-2 space-y-0">
          <Radio className="w-5 h-5" />
          <CardTitle className="text-base">Flashman ACS</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-4 w-40" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!flashmanData?.enabled) return null;

  if (!flashmanData?.found) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center gap-2 space-y-0">
          <Radio className="w-5 h-5" />
          <CardTitle className="text-base">Flashman ACS</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{safeText(flashmanData?.message, "Dispositivo não encontrado no Flashman")}</p>
        </CardContent>
      </Card>
    );
  }

  const device = flashmanData.device;
  const lastContactDate = device.lastContact && typeof device.lastContact === "string" ? new Date(device.lastContact) : null;
  const isOnline = lastContactDate && !isNaN(lastContactDate.getTime()) && (Date.now() - lastContactDate.getTime()) < 5 * 60 * 1000;

  const commandButtons = [
    { cmd: "sync", label: "Sync TR-069", icon: RefreshCw },
    { cmd: "boot", label: "Reiniciar", icon: RotateCcw },
    { cmd: "bestchannel", label: "Melhor Canal", icon: Wifi },
    { cmd: "speedtest", label: "Speed Test", icon: Gauge },
    { cmd: "ping", label: "Ping", icon: Activity },
    { cmd: "traceroute", label: "Traceroute", icon: Route },
    { cmd: "onlinedevs", label: "Dispositivos", icon: MonitorSmartphone },
    { cmd: "sitesurvey", label: "Site Survey", icon: Signal },
    { cmd: "pondata", label: "Sinal PON", icon: Zap },
  ];

  const report = flashboardData?.report;

  const toggleWanExpanded = (index: number) => {
    setExpandedWans((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <div className="flex items-center gap-2">
          <Radio className="w-5 h-5" />
          <CardTitle className="text-base">Flashman ACS - TR-069</CardTitle>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={isOnline ? "default" : "secondary"} className={isOnline ? "bg-green-600" : ""}>
            {isOnline ? "Online" : "Offline"}
          </Badge>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => refetchFlashman()}
            data-testid="button-refresh-flashman"
          >
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="sobre" className="w-full">
          <TabsList className="w-full flex-wrap h-auto gap-1" data-testid="tabs-flashman">
            <TabsTrigger value="sobre" data-testid="tab-sobre">Sobre</TabsTrigger>
            <TabsTrigger value="wan" data-testid="tab-wan">WAN</TabsTrigger>
            <TabsTrigger value="voip" data-testid="tab-voip">VoIP</TabsTrigger>
            <TabsTrigger value="lan" data-testid="tab-lan">LAN</TabsTrigger>
            <TabsTrigger value="wifi" data-testid="tab-wifi">Wi-Fi</TabsTrigger>
            <TabsTrigger value="qualidade" data-testid="tab-qualidade">Qualidade</TabsTrigger>
            <TabsTrigger value="comandos" data-testid="tab-comandos">Comandos</TabsTrigger>
          </TabsList>

          {/* ========== SOBRE TAB ========== */}
          <TabsContent value="sobre" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2 text-sm mt-2">
              <InfoRow label="MAC" value={safeText(device.mac)} mono />
              <InfoRow label="Modelo" value={safeText(device.model)} />
              <InfoRow label="Fabricante" value={safeText(device.vendor)} />
              <InfoRow label="Firmware" value={safeText(device.firmwareVersion)} mono />
              <InfoRow label="Hardware" value={safeText(device.hardwareVersion)} />
              <InfoRow label="Serial" value={safeText(device.serialNumber)} mono />
              <InfoRow label="Tipo Conexão" value={safeText(device.connectionType)} />
              <InfoRow label="PPPoE" value={safeText(device.pppoeUser)} mono />
              <InfoRow label="IP WAN" value={safeText(device.wanIp)} mono />
              {device.wanSpeed && <InfoRow label="Velocidade WAN" value={`${safeText(device.wanSpeed)} ${device.wanDuplex ? `(${safeText(device.wanDuplex)})` : ""}`} />}
              <InfoRow label="Uptime" value={safeText(device.uptime)} />
              <InfoRow label="Último Contato" value={lastContactDate ? formatDistanceToNow(lastContactDate, { addSuffix: true, locale: ptBR }) : "N/A"} />
              {device.resourcesUsage && (
                <>
                  <InfoRow label="CPU" value={device.resourcesUsage.cpuUsage != null ? `${device.resourcesUsage.cpuUsage}%` : "N/A"} />
                  <InfoRow label="Memória" value={device.resourcesUsage.memoryUsage != null ? `${device.resourcesUsage.memoryUsage}%` : "N/A"} />
                </>
              )}
              {device.isLicenseActive != null && (
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground text-sm">Licença</span>
                  <Badge variant={device.isLicenseActive ? "default" : "secondary"} className={device.isLicenseActive ? "bg-green-600" : ""}>
                    {device.isLicenseActive ? "Ativa" : "Inativa"}
                  </Badge>
                </div>
              )}
              {device.ntpStatus && <InfoRow label="NTP" value={safeText(device.ntpStatus)} />}
              {device.externalReference?.data && <InfoRow label="Ref. Externa" value={`${safeText(device.externalReference.data)} (${safeText(device.externalReference.kind)})`} />}
            </div>

            {(device.pon?.rxPower || device.pon?.txPower) && (
              <div className="mt-4">
                <div className="text-sm font-medium mb-2 flex items-center gap-1"><Signal className="w-4 h-4" /> Sinal PON</div>
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div className="text-center p-3 rounded-md bg-muted">
                    <div className="text-muted-foreground text-xs mb-1">RX Power</div>
                    <div className="font-mono font-medium">{safeText(device.pon.rxPower)}</div>
                  </div>
                  <div className="text-center p-3 rounded-md bg-muted">
                    <div className="text-muted-foreground text-xs mb-1">TX Power</div>
                    <div className="font-mono font-medium">{safeText(device.pon.txPower)}</div>
                  </div>
                  <div className="text-center p-3 rounded-md bg-muted">
                    <div className="text-muted-foreground text-xs mb-1">Medição</div>
                    <div className="font-mono font-medium">{safeText(device.pon.signalMeasure)}</div>
                  </div>
                </div>
              </div>
            )}
          </TabsContent>

          {/* ========== WAN TAB ========== */}
          <TabsContent value="wan" className="space-y-4">
            {device.wans?.length > 0 ? (
              <div className="mt-2 space-y-3">
                {device.wans.map((wan: any, i: number) => {
                  const isExpanded = expandedWans.has(i);
                  return (
                    <div key={wan.id || i} className="rounded-md bg-muted text-sm" data-testid={`wan-${i}`}>
                      <button
                        type="button"
                        className="w-full flex items-center justify-between p-3 text-left"
                        onClick={() => toggleWanExpanded(i)}
                        data-testid={`wan-toggle-${i}`}
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                          <span className="font-medium">{safeText(wan.alias, `WAN ${i + 1}`)}</span>
                          <Badge variant={wan.enable ? "default" : "secondary"} className={wan.enable ? "bg-green-600" : ""}>
                            {wan.enable ? "Ativo" : "Inativo"}
                          </Badge>
                          {wan.status && (
                            <Badge variant="outline">{safeText(wan.status)}</Badge>
                          )}
                          {wan.serviceTypes && Array.isArray(wan.serviceTypes) && wan.serviceTypes.map((st: string, si: number) => (
                            <Badge key={si} variant="outline">{safeText(st)}</Badge>
                          ))}
                        </div>
                        <div className="flex items-center gap-2">
                          {wan.connectionType && <span className="text-xs text-muted-foreground">{safeText(wan.connectionType)}</span>}
                          {isSuperAdmin && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingWanId(wan.id || String(i));
                                setWanEditForm({
                                  mtu: wan.mtu != null ? String(wan.mtu) : "",
                                  vlanId: wan.vlanId != null ? String(wan.vlanId) : "",
                                  enable: wan.enable !== false,
                                });
                                setShowWanEditDialog(true);
                              }}
                              data-testid={`button-edit-wan-${i}`}
                            >
                              <Pencil className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      </button>
                      {isExpanded && (
                        <div className="px-3 pb-3 space-y-2">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1">
                            <InfoRow label="Tipo Conexão" value={safeText(wan.connectionType)} />
                            <InfoRow label="Tipo Interface" value={safeText(wan.interfaceType)} />
                            {wan.mac && <InfoRow label="MAC" value={safeText(wan.mac)} mono />}
                            {wan.vlanId != null && <InfoRow label="VLAN ID" value={safeText(wan.vlanId)} />}
                            {wan.mtu != null && <InfoRow label="MTU" value={safeText(wan.mtu)} />}
                            {wan.uptime != null && <InfoRow label="Uptime" value={`${wan.uptime}s`} />}
                          </div>
                          {wan.ipv4 && (
                            <div className="pt-2 border-t border-border/50">
                              <span className="text-xs text-muted-foreground font-medium">IPv4</span>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 mt-1">
                                <InfoRow label="IP" value={safeText(wan.ipv4.ip)} mono />
                                {wan.ipv4.natIp && <InfoRow label="NAT IP" value={safeText(wan.ipv4.natIp)} mono />}
                                <InfoRow label="Gateway" value={safeText(wan.ipv4.gateway)} mono />
                                {wan.ipv4.mask != null && <InfoRow label="Máscara" value={safeText(wan.ipv4.mask)} />}
                                {wan.ipv4.dns?.length > 0 && <InfoRow label="DNS" value={wan.ipv4.dns.join(", ")} mono />}
                              </div>
                            </div>
                          )}
                          {wan.ipv6 && (
                            <div className="pt-2 border-t border-border/50">
                              <span className="text-xs text-muted-foreground font-medium">IPv6</span>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 mt-1">
                                <InfoRow label="Habilitado" value={wan.ipv6.enabled ? "Sim" : "Não"} />
                                {wan.ipv6.dns?.length > 0 && <InfoRow label="DNS" value={wan.ipv6.dns.join(", ")} mono />}
                              </div>
                            </div>
                          )}
                          {wan.pppoe && (
                            <div className="pt-2 border-t border-border/50">
                              <span className="text-xs text-muted-foreground font-medium">PPPoE</span>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 mt-1">
                                <InfoRow label="Usuário" value={safeText(wan.pppoe.username)} mono />
                                {wan.pppoe.serverMac && <InfoRow label="MAC Servidor" value={safeText(wan.pppoe.serverMac)} mono />}
                                {wan.pppoe.serverIp && <InfoRow label="IP Servidor" value={safeText(wan.pppoe.serverIp)} mono />}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground mt-2">Nenhuma interface WAN disponível.</p>
            )}
          </TabsContent>

          {/* ========== VoIP TAB ========== */}
          <TabsContent value="voip" className="space-y-4">
            {voipData?.data ? (
              <div className="mt-2 space-y-3">
                {(() => {
                  const vd = voipData.data;
                  if (vd?.profiles && Array.isArray(vd.profiles)) {
                    return (
                      <>
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="text-sm font-medium flex items-center gap-1"><Phone className="w-4 h-4" /> Perfis VoIP</div>
                          {isSuperAdmin && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                const firstProfile = vd.profiles[0] || {};
                                setVoipEditForm({
                                  sipServer: firstProfile.proxy_address || firstProfile.registrar_address || "",
                                  regulatoryDomain: firstProfile.regulatory_domain || "",
                                  wanSignal: firstProfile.wan_signal || "",
                                  enabled: firstProfile.enabled !== false,
                                  lines: vd.profiles.map((p: any) => ({
                                    phoneNumber: p.phone_number || p.sip_uri || "",
                                    sipUser: p.sip_user || "",
                                    connectionUser: p.connection_user || p.auth_user || "",
                                    password: p.password || p.auth_password || "",
                                  })),
                                });
                                setShowVoipEditDialog(true);
                              }}
                              data-testid="button-edit-voip"
                            >
                              <Pencil className="w-4 h-4 mr-1" /> Editar
                            </Button>
                          )}
                        </div>
                        {vd.profiles.map((profile: any, i: number) => (
                          <div key={i} className="p-3 rounded-md bg-muted text-sm space-y-1" data-testid={`voip-profile-${i}`}>
                            <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
                              <span className="font-medium">Linha {i + 1}</span>
                              <Badge variant={profile.status === "Up" || profile.enabled ? "default" : "secondary"} className={profile.status === "Up" || profile.enabled ? "bg-green-600" : ""}>
                                {profile.status || (profile.enabled ? "Up" : "Down")}
                              </Badge>
                            </div>
                            {profile.phone_number && <InfoRow label="Número" value={safeText(profile.phone_number)} />}
                            {profile.sip_user && <InfoRow label="SIP User" value={safeText(profile.sip_user)} mono />}
                            {profile.sip_uri && <InfoRow label="SIP URI" value={safeText(profile.sip_uri)} mono />}
                            {(profile.connection_user || profile.auth_user) && <InfoRow label="Usuário Conexão" value={safeText(profile.connection_user || profile.auth_user)} mono />}
                            {profile.proxy_address && <InfoRow label="SIP Server" value={safeText(profile.proxy_address)} mono />}
                            {profile.registrar_address && <InfoRow label="Registrar" value={safeText(profile.registrar_address)} mono />}
                            {profile.regulatory_domain && <InfoRow label="Domínio Regulatório" value={safeText(profile.regulatory_domain)} />}
                          </div>
                        ))}
                      </>
                    );
                  }
                  if (vd?.device) {
                    const d = vd.device;
                    return (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="text-sm font-medium flex items-center gap-1"><Phone className="w-4 h-4" /> VoIP</div>
                          {isSuperAdmin && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setVoipEditForm({
                                  sipServer: "",
                                  regulatoryDomain: "",
                                  wanSignal: "",
                                  enabled: true,
                                  lines: [
                                    {
                                      phoneNumber: d.voip_line1_sip_uri || "",
                                      sipUser: d.voip_line1_sip_user || "",
                                      connectionUser: d.voip_line1_auth_user || "",
                                      password: d.voip_line1_auth_password || "",
                                    },
                                    {
                                      phoneNumber: d.voip_line2_sip_uri || "",
                                      sipUser: d.voip_line2_sip_user || "",
                                      connectionUser: d.voip_line2_auth_user || "",
                                      password: d.voip_line2_auth_password || "",
                                    },
                                  ].filter(l => l.phoneNumber || l.sipUser),
                                });
                                setShowVoipEditDialog(true);
                              }}
                              data-testid="button-edit-voip"
                            >
                              <Pencil className="w-4 h-4 mr-1" /> Editar
                            </Button>
                          )}
                        </div>
                        <div className="p-3 rounded-md bg-muted text-sm space-y-1">
                          {d.voip_line1_sip_uri && <InfoRow label="Linha 1 SIP URI" value={safeText(d.voip_line1_sip_uri)} mono />}
                          {d.voip_line2_sip_uri && <InfoRow label="Linha 2 SIP URI" value={safeText(d.voip_line2_sip_uri)} mono />}
                        </div>
                      </div>
                    );
                  }
                  return <p className="text-sm text-muted-foreground mt-2">Nenhuma configuração VoIP disponível.</p>;
                })()}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground mt-2">Carregando VoIP...</p>
            )}
          </TabsContent>

          {/* ========== LAN TAB ========== */}
          <TabsContent value="lan" className="space-y-4">
            <div className="mt-2 space-y-4">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="text-sm font-medium flex items-center gap-1"><HardDrive className="w-4 h-4" /> Rede LAN</div>
                {isSuperAdmin && device.lan?.subnet && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setLanEditForm({
                        subnet: device.lan?.subnet || "",
                        netmask: device.lan?.netmask || "",
                      });
                      setShowLanEditDialog(true);
                    }}
                    data-testid="button-edit-lan"
                  >
                    <Pencil className="w-4 h-4 mr-1" /> Editar
                  </Button>
                )}
              </div>

              {device.lan?.subnet ? (
                <div className="p-3 rounded-md bg-muted text-sm space-y-1">
                  <InfoRow label="IP do CPE" value={safeText(device.lan.subnet)} mono />
                  <InfoRow label="MAC LAN" value={safeText(device.mac)} mono />
                  <InfoRow label="Máscara" value={`/${safeText(device.lan.netmask)}`} mono />
                  {device.lan.dns && <InfoRow label="DNS" value={safeText(device.lan.dns)} mono />}
                  <InfoRow label="Bridge" value={device.bridge?.enabled ? "Habilitado" : "Desabilitado"} />
                  {device.dmz != null && <InfoRow label="DMZ" value={device.dmz?.enabled ? "Habilitado" : "Desabilitado"} />}
                  <InfoRow label="IPv6" value={device.ipv6Enabled ? "Habilitado" : "Desabilitado"} />
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Nenhuma informação LAN disponível.</p>
              )}

              {device.portStatus && Array.isArray(device.portStatus) && device.portStatus.length > 0 && (
                <div>
                  <div className="text-sm font-medium mb-2 flex items-center gap-1"><Cable className="w-4 h-4" /> Portas LAN</div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {device.portStatus.map((port: any, i: number) => (
                      <div key={i} className="p-3 rounded-md bg-muted text-center text-sm" data-testid={`port-status-${i}`}>
                        <div className="text-xs text-muted-foreground mb-1">Porta {i + 1}</div>
                        <Badge variant={port.status === "NoLink" || !port.status ? "secondary" : "default"} className={port.status && port.status !== "NoLink" ? "bg-green-600" : ""}>
                          {safeText(port.status, "NoLink")}
                        </Badge>
                        {port.speed && <div className="text-xs mt-1 font-mono">{safeText(port.speed)}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!device.portStatus && (
                <div>
                  <div className="text-sm font-medium mb-2 flex items-center gap-1"><Cable className="w-4 h-4" /> Portas LAN</div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {[1, 2, 3, 4].map((portNum) => (
                      <div key={portNum} className="p-3 rounded-md bg-muted text-center text-sm" data-testid={`port-status-${portNum - 1}`}>
                        <div className="text-xs text-muted-foreground mb-1">Porta {portNum}</div>
                        <Badge variant="secondary">NoLink</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                  <div className="text-sm font-medium flex items-center gap-1"><Globe className="w-4 h-4" /> DNS LAN</div>
                  {isSuperAdmin && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const current = dnsData?.data;
                        let servers = "";
                        if (current?.dns_servers && Array.isArray(current.dns_servers)) {
                          servers = current.dns_servers.join("\n");
                        } else if (current?.device?.lan_dns_servers) {
                          servers = current.device.lan_dns_servers;
                        }
                        setDnsForm(servers);
                        setShowDnsDialog(true);
                      }}
                      data-testid="button-edit-dns"
                    >
                      <Pencil className="w-4 h-4 mr-1" /> Editar DNS
                    </Button>
                  )}
                </div>
                {dnsData?.data ? (
                  <div className="p-3 rounded-md bg-muted text-sm">
                    {(() => {
                      const d = dnsData.data;
                      if (d?.dns_servers && Array.isArray(d.dns_servers)) {
                        return d.dns_servers.map((s: string, i: number) => (
                          <div key={i} className="font-mono">{safeText(s)}</div>
                        ));
                      }
                      if (d?.device?.lan_dns_servers) {
                        return <div className="font-mono">{safeText(d.device.lan_dns_servers)}</div>;
                      }
                      return <span className="text-muted-foreground">Nenhum DNS configurado</span>;
                    })()}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Carregando...</p>
                )}
              </div>

              {device.vlans?.length > 0 && (
                <div>
                  <div className="text-sm font-medium mb-2 flex items-center gap-1"><Network className="w-4 h-4" /> VLANs</div>
                  <div className="space-y-1">
                    {device.vlans.map((vlan: any, i: number) => (
                      <div key={vlan.id || i} className="flex items-center justify-between p-2 rounded-md bg-muted text-sm">
                        <span className="text-muted-foreground">Porta {safeText(vlan.port)}</span>
                        <span className="font-mono">VLAN {safeText(vlan.vlanId)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </TabsContent>

          {/* ========== WI-FI TAB ========== */}
          <TabsContent value="wifi" className="space-y-4">
            {(device.wifi?.ssid_2g || device.wifi?.ssid_5g) ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
                {device.wifi.ssid_2g && (
                  <div className="space-y-2 p-3 rounded-md bg-muted">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">2.4 GHz</Badge>
                        <Badge variant={device.wifi.state_2g === 1 ? "default" : "secondary"} className={device.wifi.state_2g === 1 ? "bg-green-600" : ""}>
                          {device.wifi.state_2g === 1 ? "Ativo" : "Inativo"}
                        </Badge>
                      </div>
                      {isSuperAdmin && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            setEditingWifiBand("2g");
                            setWifiEditForm({
                              ssid: device.wifi.ssid_2g || "",
                              password: device.wifi.password_2g || "",
                              channel: device.wifi.channel_2g || "auto",
                            });
                            setShowWifiEditDialog(true);
                          }}
                          data-testid="button-edit-wifi-2g"
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                    <div className="text-sm space-y-1">
                      <InfoRow label="SSID" value={safeText(device.wifi.ssid_2g)} />
                      <div className="flex justify-between gap-2">
                        <span className="text-muted-foreground text-sm">Senha</span>
                        <div className="flex items-center gap-1">
                          <span className="text-sm font-mono">{showPassword2g ? safeText(device.wifi.password_2g) : "********"}</span>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setShowPassword2g(!showPassword2g)} data-testid="toggle-password-2g">
                            {showPassword2g ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                          </Button>
                        </div>
                      </div>
                      <InfoRow label="Canal" value={safeText(device.wifi.channel_2g)} />
                      <InfoRow label="Largura" value={safeText(device.wifi.band_2g)} />
                      <InfoRow label="Modo" value={safeText(device.wifi.mode_2g)} />
                      <InfoRow label="Potência" value={device.wifi.power_2g != null ? `${device.wifi.power_2g}%` : "N/A"} />
                      {device.wifi.bssid_2g && <InfoRow label="BSSID" value={safeText(device.wifi.bssid_2g)} mono />}
                      {device.wifi.supportedBandwidths_2g && (
                        <div className="flex justify-between gap-2">
                          <span className="text-muted-foreground text-sm">Larguras suportadas</span>
                          <span className="text-sm">{Array.isArray(device.wifi.supportedBandwidths_2g) ? device.wifi.supportedBandwidths_2g.join(", ") : safeText(device.wifi.supportedBandwidths_2g)}</span>
                        </div>
                      )}
                      {device.wifi.supportedModes_2g && (
                        <div className="flex justify-between gap-2">
                          <span className="text-muted-foreground text-sm">Modos suportados</span>
                          <span className="text-sm">{Array.isArray(device.wifi.supportedModes_2g) ? device.wifi.supportedModes_2g.join(", ") : safeText(device.wifi.supportedModes_2g)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {device.wifi.ssid_5g && (
                  <div className="space-y-2 p-3 rounded-md bg-muted">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">5 GHz</Badge>
                        <Badge variant={device.wifi.state_5g === 1 ? "default" : "secondary"} className={device.wifi.state_5g === 1 ? "bg-green-600" : ""}>
                          {device.wifi.state_5g === 1 ? "Ativo" : "Inativo"}
                        </Badge>
                      </div>
                      {isSuperAdmin && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            setEditingWifiBand("5g");
                            setWifiEditForm({
                              ssid: device.wifi.ssid_5g || "",
                              password: device.wifi.password_5g || "",
                              channel: device.wifi.channel_5g || "auto",
                            });
                            setShowWifiEditDialog(true);
                          }}
                          data-testid="button-edit-wifi-5g"
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                    <div className="text-sm space-y-1">
                      <InfoRow label="SSID" value={safeText(device.wifi.ssid_5g)} />
                      <div className="flex justify-between gap-2">
                        <span className="text-muted-foreground text-sm">Senha</span>
                        <div className="flex items-center gap-1">
                          <span className="text-sm font-mono">{showPassword5g ? safeText(device.wifi.password_5g) : "********"}</span>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setShowPassword5g(!showPassword5g)} data-testid="toggle-password-5g">
                            {showPassword5g ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                          </Button>
                        </div>
                      </div>
                      <InfoRow label="Canal" value={safeText(device.wifi.channel_5g)} />
                      <InfoRow label="Largura" value={safeText(device.wifi.band_5g)} />
                      <InfoRow label="Modo" value={safeText(device.wifi.mode_5g)} />
                      <InfoRow label="Potência" value={device.wifi.power_5g != null ? `${device.wifi.power_5g}%` : "N/A"} />
                      {device.wifi.bssid_5g && <InfoRow label="BSSID" value={safeText(device.wifi.bssid_5g)} mono />}
                      {device.wifi.supportedBandwidths_5g && (
                        <div className="flex justify-between gap-2">
                          <span className="text-muted-foreground text-sm">Larguras suportadas</span>
                          <span className="text-sm">{Array.isArray(device.wifi.supportedBandwidths_5g) ? device.wifi.supportedBandwidths_5g.join(", ") : safeText(device.wifi.supportedBandwidths_5g)}</span>
                        </div>
                      )}
                      {device.wifi.supportedModes_5g && (
                        <div className="flex justify-between gap-2">
                          <span className="text-muted-foreground text-sm">Modos suportados</span>
                          <span className="text-sm">{Array.isArray(device.wifi.supportedModes_5g) ? device.wifi.supportedModes_5g.join(", ") : safeText(device.wifi.supportedModes_5g)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground mt-2">Nenhuma informação de Wi-Fi disponível.</p>
            )}
          </TabsContent>

          {/* ========== QUALIDADE TAB ========== */}
          <TabsContent value="qualidade" className="space-y-4">
            {report ? (
              <div className="space-y-4 mt-2">
                {report.wifi && (
                  <div className="p-3 rounded-md bg-muted text-sm space-y-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="font-medium flex items-center gap-1"><Wifi className="w-4 h-4" /> Wi-Fi</span>
                      {report.wifi.period && (
                        <span className="text-xs text-muted-foreground">
                          {report.wifi.period.start && new Date(report.wifi.period.start).toLocaleDateString("pt-BR")} - {report.wifi.period.end && new Date(report.wifi.period.end).toLocaleDateString("pt-BR")}
                        </span>
                      )}
                    </div>
                    {report.wifi.connectedDevices != null && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Dispositivos conectados (avg)</span>
                        <ThresholdBadge value={report.wifi.connectedDevices.mean} threshold={report.wifi.connectedDevices.threshold} />
                      </div>
                    )}
                  </div>
                )}

                {report.latency && (
                  <div className="p-3 rounded-md bg-muted text-sm space-y-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="font-medium flex items-center gap-1"><Activity className="w-4 h-4" /> Latência</span>
                      {report.latency.period && (
                        <span className="text-xs text-muted-foreground">
                          {report.latency.period.start && new Date(report.latency.period.start).toLocaleDateString("pt-BR")} - {report.latency.period.end && new Date(report.latency.period.end).toLocaleDateString("pt-BR")}
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="text-center">
                        <div className="text-xs text-muted-foreground">Min</div>
                        <ThresholdBadge value={report.latency.min} threshold={report.latency.threshold} unit="ms" />
                      </div>
                      <div className="text-center">
                        <div className="text-xs text-muted-foreground">Média</div>
                        <ThresholdBadge value={report.latency.mean} threshold={report.latency.threshold} unit="ms" />
                      </div>
                      <div className="text-center">
                        <div className="text-xs text-muted-foreground">Max</div>
                        <ThresholdBadge value={report.latency.max} threshold={report.latency.threshold} unit="ms" />
                      </div>
                    </div>
                  </div>
                )}

                {report.packetLoss && (
                  <div className="p-3 rounded-md bg-muted text-sm space-y-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="font-medium">Perda de Pacotes</span>
                      {report.packetLoss.period && (
                        <span className="text-xs text-muted-foreground">
                          {report.packetLoss.period.start && new Date(report.packetLoss.period.start).toLocaleDateString("pt-BR")} - {report.packetLoss.period.end && new Date(report.packetLoss.period.end).toLocaleDateString("pt-BR")}
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="text-center">
                        <div className="text-xs text-muted-foreground">Min</div>
                        <ThresholdBadge value={report.packetLoss.min} threshold={report.packetLoss.threshold} unit="%" />
                      </div>
                      <div className="text-center">
                        <div className="text-xs text-muted-foreground">Média</div>
                        <ThresholdBadge value={report.packetLoss.mean} threshold={report.packetLoss.threshold} unit="%" />
                      </div>
                      <div className="text-center">
                        <div className="text-xs text-muted-foreground">Max</div>
                        <ThresholdBadge value={report.packetLoss.max} threshold={report.packetLoss.threshold} unit="%" />
                      </div>
                    </div>
                  </div>
                )}

                {report.pon && (
                  <div className="p-3 rounded-md bg-muted text-sm space-y-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="font-medium flex items-center gap-1"><Signal className="w-4 h-4" /> Sinal PON</span>
                      {report.pon.period && (
                        <span className="text-xs text-muted-foreground">
                          {report.pon.period.start && new Date(report.pon.period.start).toLocaleDateString("pt-BR")} - {report.pon.period.end && new Date(report.pon.period.end).toLocaleDateString("pt-BR")}
                        </span>
                      )}
                    </div>
                    {report.pon.rx && (
                      <div>
                        <div className="text-xs text-muted-foreground mb-1">RX</div>
                        <div className="grid grid-cols-3 gap-2">
                          <div className="text-center"><div className="text-xs text-muted-foreground">Min</div><ThresholdBadge value={report.pon.rx.min} threshold={report.pon.rx.threshold} unit=" dBm" /></div>
                          <div className="text-center"><div className="text-xs text-muted-foreground">Média</div><ThresholdBadge value={report.pon.rx.mean} threshold={report.pon.rx.threshold} unit=" dBm" /></div>
                          <div className="text-center"><div className="text-xs text-muted-foreground">Max</div><ThresholdBadge value={report.pon.rx.max} threshold={report.pon.rx.threshold} unit=" dBm" /></div>
                        </div>
                      </div>
                    )}
                    {report.pon.tx && (
                      <div>
                        <div className="text-xs text-muted-foreground mb-1">TX</div>
                        <div className="grid grid-cols-3 gap-2">
                          <div className="text-center"><div className="text-xs text-muted-foreground">Min</div><ThresholdBadge value={report.pon.tx.min} threshold={report.pon.tx.threshold} unit=" dBm" /></div>
                          <div className="text-center"><div className="text-xs text-muted-foreground">Média</div><ThresholdBadge value={report.pon.tx.mean} threshold={report.pon.tx.threshold} unit=" dBm" /></div>
                          <div className="text-center"><div className="text-xs text-muted-foreground">Max</div><ThresholdBadge value={report.pon.tx.max} threshold={report.pon.tx.threshold} unit=" dBm" /></div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {report.uptime && (
                  <div className="p-3 rounded-md bg-muted text-sm space-y-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="font-medium">Estabilidade (Uptime)</span>
                      {report.uptime.period && (
                        <span className="text-xs text-muted-foreground">
                          {report.uptime.period.start && new Date(report.uptime.period.start).toLocaleDateString("pt-BR")} - {report.uptime.period.end && new Date(report.uptime.period.end).toLocaleDateString("pt-BR")}
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      {report.uptime.rebootCount != null && (
                        <div className="text-center">
                          <div className="text-xs text-muted-foreground">Reboots</div>
                          <ThresholdBadge value={report.uptime.rebootCount} threshold={report.uptime.rebootThreshold} />
                        </div>
                      )}
                      {report.uptime.wanRebootCount != null && (
                        <div className="text-center">
                          <div className="text-xs text-muted-foreground">WAN Reboots</div>
                          <ThresholdBadge value={report.uptime.wanRebootCount} threshold={report.uptime.wanRebootThreshold} />
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {!report.wifi && !report.latency && !report.packetLoss && !report.pon && !report.uptime && (
                  <p className="text-sm text-muted-foreground">Nenhum dado de qualidade disponível no relatório.</p>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground mt-2">Carregando relatório de qualidade...</p>
            )}
          </TabsContent>

          {/* ========== COMANDOS TAB ========== */}
          <TabsContent value="comandos" className="space-y-4">
            {isSuperAdmin && (
              <div className="mt-2">
                <div className="text-sm font-medium mb-2 flex items-center gap-1"><Wrench className="w-4 h-4" /> Ações / Diagnósticos</div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
                  {commandButtons.map((btn) => {
                    const Icon = btn.icon;
                    return (
                      <Button
                        key={btn.cmd}
                        variant="outline"
                        size="sm"
                        disabled={!!activeCommand}
                        onClick={() => commandMutation.mutate(btn.cmd)}
                        data-testid={`button-flashman-${btn.cmd}`}
                      >
                        {activeCommand === btn.cmd ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Icon className="w-4 h-4 mr-1" />}
                        {btn.label}
                      </Button>
                    );
                  })}
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={configFileMutation.isPending}
                    onClick={() => configFileMutation.mutate()}
                    data-testid="button-flashman-config-file"
                  >
                    {configFileMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <FileUp className="w-4 h-4 mr-1" />}
                    Config File
                  </Button>
                </div>
                {polling && (
                  <div className="flex items-center gap-2 mt-3 text-sm text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {device.currentDiagnostic?.inProgress
                      ? `${device.currentDiagnostic.type === "speedtest" ? "Speed Test" : device.currentDiagnostic.type === "ping" ? "Ping" : device.currentDiagnostic.type === "traceroute" ? "Traceroute" : device.currentDiagnostic.type === "sitesurvey" ? "Site Survey" : safeText(device.currentDiagnostic.type)} em andamento${device.currentDiagnostic.stage ? ` (${safeText(device.currentDiagnostic.stage)})` : ""}...`
                      : `Aguardando resultado de ${activeCommand || "comando"}...`}
                  </div>
                )}
              </div>
            )}

            {lastCommandNoResults && (
              <div className="mt-4 p-3 rounded-md bg-destructive/10 text-sm" data-testid="text-no-results">
                <div className="font-medium text-destructive">
                  {lastCommandNoResults === "ping" ? "Nenhum resultado de Ping recebido"
                    : lastCommandNoResults === "traceroute" ? "Nenhum resultado de Traceroute recebido"
                    : lastCommandNoResults === "speedtest" ? "Nenhum resultado de Speed Test recebido"
                    : `Nenhum resultado recebido para "${lastCommandNoResults}"`}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {"O tempo de espera esgotou. O CPE pode estar offline ou o comando pode não ser suportado por este modelo."}
                </div>
              </div>
            )}

            {device.speedtestResults?.length > 0 && (
              <div className="mt-4">
                <div className="text-sm font-medium mb-2 flex items-center gap-1"><Gauge className="w-4 h-4" /> Speed Test</div>
                <div className="space-y-2">
                  {device.speedtestResults.slice(0, 3).map((result: any, i: number) => (
                    <div key={i} className="p-2 rounded-md bg-muted text-sm">
                      <div className="flex justify-between flex-wrap gap-1">
                        <span>Download: <span className="font-mono font-medium">{safeText(result.down_speed, "N/A")} Mbps</span></span>
                        <span>Upload: <span className="font-mono font-medium">{safeText(result.up_speed, "N/A")} Mbps</span></span>
                      </div>
                      {result.timestamp && <div className="text-xs text-muted-foreground mt-1">{safeText(result.timestamp)}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {device.pingResults?.length > 0 && (
              <div className="mt-4">
                <div className="text-sm font-medium mb-2 flex items-center gap-1"><Activity className="w-4 h-4" /> Resultados de Ping</div>
                <div className="space-y-2">
                  {device.pingResults.map((result: any, i: number) => (
                    <div key={i} className="p-2 rounded-md bg-muted text-sm">
                      <div className="flex justify-between flex-wrap gap-1">
                        <span>Host: <span className="font-mono font-medium">{safeText(result.host)}</span></span>
                        <span>Latência: <span className="font-mono font-medium">{safeText(result.lat)} ms</span></span>
                        <span>Perda: <span className="font-mono font-medium">{result.loss != null ? `${(parseFloat(String(result.loss)) * 100).toFixed(1)}%` : "N/A"}</span></span>
                      </div>
                      <div className="flex justify-between flex-wrap gap-1 text-xs text-muted-foreground mt-1">
                        <span>Tentativas: {safeText(result.count)}</span>
                        <span>{result.completed ? "Concluído" : "Em andamento..."}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {device.tracerouteResults?.length > 0 && (
              <div className="mt-4">
                <div className="text-sm font-medium mb-2 flex items-center gap-1"><Route className="w-4 h-4" /> Resultados de Traceroute</div>
                <div className="space-y-2">
                  {device.tracerouteResults.map((result: any, i: number) => (
                    <div key={i} className="p-2 rounded-md bg-muted text-sm">
                      <div className="flex justify-between flex-wrap gap-1 mb-2">
                        <span>Destino: <span className="font-mono font-medium">{safeText(result.address)}</span></span>
                        <span>{result.completed ? (result.reached_destination ? "Destino alcançado" : "Destino não alcançado") : "Em andamento..."}</span>
                      </div>
                      {result.hops && Array.isArray(result.hops) && result.hops.length > 0 && (
                        <div className="max-h-48 overflow-auto space-y-1">
                          {result.hops.map((hop: any, j: number) => (
                            <div key={j} className="flex items-center gap-2 text-xs">
                              <span className="text-muted-foreground w-6 text-right">{hop.hop_index || j + 1}</span>
                              <span className="font-mono flex-1">{safeText(hop.ip, "*")}</span>
                              <span className="font-mono text-muted-foreground">
                                {Array.isArray(hop.ms_values) ? hop.ms_values.map((ms: any) => ms != null ? `${ms}ms` : "*").join(" / ") : ""}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {device.connectedDevices?.length > 0 && !(polling && (activeCommand === "ping" || activeCommand === "traceroute" || activeCommand === "speedtest")) && (
              <div className="mt-4">
                <div className="text-sm font-medium mb-2 flex items-center gap-1">
                  <MonitorSmartphone className="w-4 h-4" /> Dispositivos Conectados
                  <Badge variant="outline" className="ml-1">{device.connectedDevices.length}</Badge>
                </div>
                <div className="max-h-64 overflow-auto space-y-2">
                  {device.connectedDevices.map((dev: any, i: number) => {
                    const devName = safeText(dev.dhcp_name || dev.hostname, "") || safeText(dev.mac, "") || `Dispositivo ${i + 1}`;
                    const connType = dev.conn_type === 0 ? "Cabo" : dev.conn_type === 1 ? "Wi-Fi" : (typeof dev.conn_type === "string" ? dev.conn_type : "");
                    const signalVal = dev.wifi_signal ?? dev.signal;
                    return (
                      <div key={i} className="flex items-center justify-between p-2 rounded-md bg-muted text-sm" data-testid={`connected-device-${i}`}>
                        <div>
                          <div className="font-medium">{devName}</div>
                          <div className="text-xs text-muted-foreground">{safeText(dev.ip, "")} - {safeText(dev.mac, "")}</div>
                        </div>
                        <div className="text-right text-xs text-muted-foreground">
                          {connType && <div>{connType}{dev.wifi_freq ? ` (${dev.wifi_freq}GHz)` : ""}</div>}
                          {signalVal != null && typeof signalVal !== "object" && <div>Sinal: {signalVal} dBm</div>}
                          {dev.conn_speed != null && typeof dev.conn_speed !== "object" && <div>{dev.conn_speed} Mbps</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {device.siteSurveyResult && Array.isArray(device.siteSurveyResult) && device.siteSurveyResult.length > 0 && (
              <div className="mt-4">
                <div className="text-sm font-medium mb-2 flex items-center gap-1"><Wifi className="w-4 h-4" /> Redes Vizinhas (Site Survey)</div>
                <div className="max-h-48 overflow-auto space-y-1">
                  {device.siteSurveyResult.map((net: any, i: number) => (
                    <div key={i} className="flex items-center justify-between p-2 rounded-md bg-muted text-sm">
                      <div>
                        <span className="font-medium">{safeText(net.ssid, "Hidden")}</span>
                        <span className="text-xs text-muted-foreground ml-2">CH {safeText(net.channel)}</span>
                      </div>
                      <span className="font-mono text-xs">{safeText(net.signal || net.rssi)} dBm</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-4">
              <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                <div className="text-sm font-medium flex items-center gap-1"><MessageSquare className="w-4 h-4" /> Observações</div>
                {isSuperAdmin && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={commentsMutation.isPending}
                    onClick={() => commentsMutation.mutate(commentsText)}
                    data-testid="button-save-comments"
                  >
                    {commentsMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
                    Salvar
                  </Button>
                )}
              </div>
              <Textarea
                value={commentsText}
                onChange={(e) => setCommentsText(e.target.value)}
                placeholder="Observações sobre o dispositivo..."
                className="min-h-[100px] text-sm"
                disabled={!isSuperAdmin}
                data-testid="textarea-comments"
              />
            </div>

            {isSuperAdmin && (
              <div className="mt-4">
                <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                  <div className="text-sm font-medium flex items-center gap-1"><Cpu className="w-4 h-4" /> Credenciais Web</div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const cred = webCredData?.data;
                      setCredentialsForm({
                        username: cred?.username || cred?.device?.web_admin_username || "",
                        password: cred?.password || cred?.device?.web_admin_password || "",
                      });
                      setShowCredentialsDialog(true);
                    }}
                    data-testid="button-edit-web-credentials"
                  >
                    <Pencil className="w-4 h-4 mr-1" /> Editar
                  </Button>
                </div>
                {webCredData?.data ? (
                  <div className="p-3 rounded-md bg-muted text-sm space-y-1">
                    <InfoRow label="Usuário" value={safeText(webCredData.data.username || webCredData.data.device?.web_admin_username)} mono />
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground text-sm">Senha</span>
                      <div className="flex items-center gap-1">
                        <span className="text-sm font-mono">{showCredPassword ? safeText(webCredData.data.password || webCredData.data.device?.web_admin_password) : "********"}</span>
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setShowCredPassword(!showCredPassword)} data-testid="toggle-cred-password">
                          {showCredPassword ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Carregando...</p>
                )}
              </div>
            )}

            {device.mesh?.mode > 0 && (
              <div className="mt-4">
                <div className="text-sm font-medium mb-2 flex items-center gap-1"><Network className="w-4 h-4" /> Rede Mesh</div>
                <div className="text-sm space-y-2">
                  <InfoRow label="Modo" value={["Desativado", "Cabo", "Cabo + 2.4GHz", "Cabo + 5GHz", "Cabo + Ambos Wi-Fi"][device.mesh.mode] || "Desconhecido"} />
                  {device.mesh.master && <InfoRow label="Master" value={safeText(device.mesh.master)} mono />}
                  {device.mesh.slaves?.length > 0 && (
                    <div>
                      <span className="text-muted-foreground text-sm">Repetidores ({device.mesh.slaves.length})</span>
                      <div className="mt-1 space-y-1">
                        {device.mesh.slaves.map((slave: string, i: number) => (
                          <div key={i} className="font-mono text-xs bg-muted px-2 py-1 rounded">{slave}</div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>

      {/* ========== WAN EDIT DIALOG ========== */}
      <Dialog open={showWanEditDialog} onOpenChange={setShowWanEditDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar WAN</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm text-muted-foreground">MTU</label>
              <Input
                type="number"
                value={wanEditForm.mtu}
                onChange={(e) => setWanEditForm({ ...wanEditForm, mtu: e.target.value })}
                placeholder="1500"
                data-testid="input-wan-mtu"
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">VLAN ID</label>
              <Input
                type="number"
                value={wanEditForm.vlanId}
                onChange={(e) => setWanEditForm({ ...wanEditForm, vlanId: e.target.value })}
                placeholder="0"
                data-testid="input-wan-vlanid"
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <label className="text-sm text-muted-foreground">Habilitado</label>
              <Switch
                checked={wanEditForm.enable}
                onCheckedChange={(checked) => setWanEditForm({ ...wanEditForm, enable: checked })}
                data-testid="switch-wan-enable"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowWanEditDialog(false)} data-testid="button-cancel-wan">
              Cancelar
            </Button>
            <Button
              disabled={wanMutation.isPending}
              onClick={() => {
                wanMutation.mutate({
                  wanId: editingWanId,
                  data: {
                    mtu: wanEditForm.mtu ? parseInt(wanEditForm.mtu) : undefined,
                    vlanId: wanEditForm.vlanId ? parseInt(wanEditForm.vlanId) : undefined,
                    enable: wanEditForm.enable,
                  },
                });
              }}
              data-testid="button-save-wan"
            >
              {wanMutation.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ========== VoIP EDIT DIALOG ========== */}
      <Dialog open={showVoipEditDialog} onOpenChange={setShowVoipEditDialog}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editar VoIP</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <label className="text-sm text-muted-foreground">Habilitado</label>
              <Switch
                checked={voipEditForm.enabled}
                onCheckedChange={(checked) => setVoipEditForm({ ...voipEditForm, enabled: checked })}
                data-testid="switch-voip-enable"
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">SIP Server</label>
              <Input
                value={voipEditForm.sipServer}
                onChange={(e) => setVoipEditForm({ ...voipEditForm, sipServer: e.target.value })}
                placeholder="sip.example.com"
                data-testid="input-voip-sip-server"
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Domínio Regulatório</label>
              <Input
                value={voipEditForm.regulatoryDomain}
                onChange={(e) => setVoipEditForm({ ...voipEditForm, regulatoryDomain: e.target.value })}
                placeholder="BR"
                data-testid="input-voip-regulatory-domain"
              />
            </div>
            {voipEditForm.lines.map((line, i) => (
              <div key={i} className="p-3 rounded-md bg-muted space-y-3">
                <div className="text-sm font-medium">Linha {i + 1}</div>
                <div>
                  <label className="text-xs text-muted-foreground">Número</label>
                  <Input
                    value={line.phoneNumber}
                    onChange={(e) => {
                      const newLines = [...voipEditForm.lines];
                      newLines[i] = { ...newLines[i], phoneNumber: e.target.value };
                      setVoipEditForm({ ...voipEditForm, lines: newLines });
                    }}
                    data-testid={`input-voip-phone-${i}`}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">SIP User</label>
                  <Input
                    value={line.sipUser}
                    onChange={(e) => {
                      const newLines = [...voipEditForm.lines];
                      newLines[i] = { ...newLines[i], sipUser: e.target.value };
                      setVoipEditForm({ ...voipEditForm, lines: newLines });
                    }}
                    data-testid={`input-voip-sip-user-${i}`}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Usuário Conexão</label>
                  <Input
                    value={line.connectionUser}
                    onChange={(e) => {
                      const newLines = [...voipEditForm.lines];
                      newLines[i] = { ...newLines[i], connectionUser: e.target.value };
                      setVoipEditForm({ ...voipEditForm, lines: newLines });
                    }}
                    data-testid={`input-voip-conn-user-${i}`}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Senha</label>
                  <Input
                    type="password"
                    value={line.password}
                    onChange={(e) => {
                      const newLines = [...voipEditForm.lines];
                      newLines[i] = { ...newLines[i], password: e.target.value };
                      setVoipEditForm({ ...voipEditForm, lines: newLines });
                    }}
                    data-testid={`input-voip-password-${i}`}
                  />
                </div>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowVoipEditDialog(false)} data-testid="button-cancel-voip">
              Cancelar
            </Button>
            <Button
              disabled={voipMutation.isPending}
              onClick={() => {
                voipMutation.mutate({
                  enabled: voipEditForm.enabled,
                  sipServer: voipEditForm.sipServer,
                  regulatoryDomain: voipEditForm.regulatoryDomain,
                  lines: voipEditForm.lines,
                });
              }}
              data-testid="button-save-voip"
            >
              {voipMutation.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ========== LAN EDIT DIALOG ========== */}
      <Dialog open={showLanEditDialog} onOpenChange={setShowLanEditDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar LAN</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm text-muted-foreground">IP do CPE (Subnet)</label>
              <Input
                value={lanEditForm.subnet}
                onChange={(e) => setLanEditForm({ ...lanEditForm, subnet: e.target.value })}
                placeholder="192.168.1.1"
                data-testid="input-lan-subnet"
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Máscara de Sub-rede</label>
              <Input
                value={lanEditForm.netmask}
                onChange={(e) => setLanEditForm({ ...lanEditForm, netmask: e.target.value })}
                placeholder="24"
                data-testid="input-lan-netmask"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowLanEditDialog(false)} data-testid="button-cancel-lan">
              Cancelar
            </Button>
            <Button
              disabled={lanMutation.isPending}
              onClick={() => {
                lanMutation.mutate({
                  lan_subnet: lanEditForm.subnet,
                  lan_netmask: lanEditForm.netmask,
                });
              }}
              data-testid="button-save-lan"
            >
              {lanMutation.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ========== WI-FI EDIT DIALOG ========== */}
      <Dialog open={showWifiEditDialog} onOpenChange={setShowWifiEditDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Wi-Fi {editingWifiBand === "2g" ? "2.4 GHz" : "5 GHz"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm text-muted-foreground">SSID</label>
              <Input
                value={wifiEditForm.ssid}
                onChange={(e) => setWifiEditForm({ ...wifiEditForm, ssid: e.target.value })}
                data-testid="input-wifi-ssid"
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Senha</label>
              <Input
                value={wifiEditForm.password}
                onChange={(e) => setWifiEditForm({ ...wifiEditForm, password: e.target.value })}
                type="password"
                data-testid="input-wifi-password"
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Canal</label>
              <Input
                value={wifiEditForm.channel}
                onChange={(e) => setWifiEditForm({ ...wifiEditForm, channel: e.target.value })}
                placeholder="auto"
                data-testid="input-wifi-channel"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowWifiEditDialog(false)}
              data-testid="button-cancel-wifi"
            >
              Cancelar
            </Button>
            <Button
              disabled={wifiMutation.isPending}
              onClick={() => {
                const wifiId = editingWifiBand === "2g" ? "1" : "2";
                wifiMutation.mutate({
                  wifiId,
                  data: {
                    ssid: wifiEditForm.ssid,
                    password: wifiEditForm.password,
                    channel: wifiEditForm.channel || "auto",
                  },
                });
              }}
              data-testid="button-save-wifi"
            >
              {wifiMutation.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ========== CREDENTIALS DIALOG ========== */}
      <Dialog open={showCredentialsDialog} onOpenChange={setShowCredentialsDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Credenciais Web</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm text-muted-foreground">Usuário</label>
              <Input
                value={credentialsForm.username}
                onChange={(e) => setCredentialsForm({ ...credentialsForm, username: e.target.value })}
                data-testid="input-cred-username"
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Senha</label>
              <Input
                value={credentialsForm.password}
                onChange={(e) => setCredentialsForm({ ...credentialsForm, password: e.target.value })}
                type="password"
                data-testid="input-cred-password"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCredentialsDialog(false)} data-testid="button-cancel-credentials">
              Cancelar
            </Button>
            <Button
              disabled={credentialsMutation.isPending}
              onClick={() => credentialsMutation.mutate(credentialsForm)}
              data-testid="button-save-credentials"
            >
              {credentialsMutation.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ========== DNS DIALOG ========== */}
      <Dialog open={showDnsDialog} onOpenChange={setShowDnsDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar DNS LAN</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm text-muted-foreground">Servidores DNS (um por linha)</label>
              <Textarea
                value={dnsForm}
                onChange={(e) => setDnsForm(e.target.value)}
                placeholder="8.8.8.8&#10;8.8.4.4"
                className="min-h-[80px]"
                data-testid="textarea-dns"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDnsDialog(false)} data-testid="button-cancel-dns">
              Cancelar
            </Button>
            <Button
              disabled={dnsMutation.isPending}
              onClick={() => {
                const servers = dnsForm.split("\n").map(s => s.trim()).filter(s => s);
                dnsMutation.mutate(servers);
              }}
              data-testid="button-save-dns"
            >
              {dnsMutation.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

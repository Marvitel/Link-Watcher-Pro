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
  Signal,
  Thermometer,
  Timer,
  Wifi,
  Wrench,
  Zap,
  ArrowDown,
  ArrowUp,
  Users,
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
    <div className="flex justify-between gap-2 py-1.5 border-b border-border/30 last:border-b-0">
      <span className="text-muted-foreground text-sm">{label}</span>
      <span className={`text-sm text-right ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}

function formatUptime(val: any): string {
  if (!val && val !== 0) return "N/A";
  if (typeof val === "string") return val;
  if (typeof val === "number") {
    const days = Math.floor(val / 86400);
    const hours = Math.floor((val % 86400) / 3600);
    const mins = Math.floor((val % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h ${mins}m`;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  }
  return String(val);
}

function formatSignalValue(val: any): string {
  if (val === null || val === undefined) return "N/A";
  const num = typeof val === "string" ? parseFloat(val) : val;
  if (isNaN(num)) return String(val);
  return `${num.toFixed(2)} dBm`;
}

function getSignalColor(val: any): string {
  if (val === null || val === undefined) return "text-muted-foreground";
  const num = typeof val === "string" ? parseFloat(val) : val;
  if (isNaN(num)) return "text-muted-foreground";
  if (num >= -15) return "text-green-500";
  if (num >= -20) return "text-green-400";
  if (num >= -25) return "text-yellow-500";
  if (num >= -28) return "text-orange-500";
  return "text-red-500";
}

function HeroCard({ icon: Icon, label, value, valueClass, subLabel }: {
  icon: any; label: string; value: string; valueClass?: string; subLabel?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center p-4 rounded-lg bg-muted/50 border border-border/50 min-h-[100px]">
      <Icon className="w-5 h-5 text-muted-foreground mb-2" />
      <div className={`text-xl font-bold font-mono ${valueClass || ""}`}>{value}</div>
      <div className="text-xs text-muted-foreground mt-1">{label}</div>
      {subLabel && <div className="text-xs text-muted-foreground/70 mt-0.5">{subLabel}</div>}
    </div>
  );
}

interface NormalizedDevice {
  source: "full" | "legacy";
  id: string;
  status: string;
  manufacturer: string;
  model: string;
  serial: string;
  macAddress: string;
  firmware: string;
  hardware: string;
  uptime: any;
  lastInform: string | null;
  lastBoot: string | null;
  productClass: string;
  pppoeUser: string;
  wanIp: string;
  connectionType: string;
  signal: { rxPower: number | null; txPower: number | null; temperature: number | null; voltage: number | null };
  wan: { connections: any[]; pppoeUser: string; wanIp: string; connectionType: string };
  lan: { ip: string; subnet: string; dhcpEnabled: boolean; dhcpStart: string; dhcpEnd: string; ethernetPorts: any[] };
  wifi: { enabled2g: boolean; ssid2g: string; password2g: string; channel2g: string; enabled5g: boolean; ssid5g: string; password5g: string; channel5g: string };
  hosts: { connected: any[]; count: number };
  voip: { lines: any[] };
  resources: { memoryFree: number | null; cpuUsage: number | null };
  backup: { hasBackup: boolean; lastBackup: string | null };
  rawLegacy?: any;
}

function normalizeDevice(data: any, source: "full" | "legacy"): NormalizedDevice {
  if (source === "full") {
    const d = data;
    return {
      source: "full",
      id: d._id || "",
      status: d.status || "unknown",
      manufacturer: d.info?.manufacturer || "N/A",
      model: d.info?.model || "N/A",
      serial: d.serial_tr069 || d.info?.serial || "",
      macAddress: d.info?.mac_address || "",
      firmware: d.info?.firmware || "N/A",
      hardware: d.info?.hardware || "N/A",
      uptime: d.info?.uptime,
      lastInform: d.info?.last_inform || null,
      lastBoot: d.info?.last_boot || null,
      productClass: d.info?.product_class || "",
      pppoeUser: d.wan?.pppoe_user || d.wan?.connections?.[0]?.username || "",
      wanIp: d.wan?.wan_ip || "",
      connectionType: d.wan?.connection_type || "",
      signal: {
        rxPower: d.signal?.rx_power ?? null,
        txPower: d.signal?.tx_power ?? null,
        temperature: d.signal?.temperature ?? null,
        voltage: d.signal?.voltage ?? null,
      },
      wan: {
        connections: d.wan?.connections || [],
        pppoeUser: d.wan?.pppoe_user || "",
        wanIp: d.wan?.wan_ip || "",
        connectionType: d.wan?.connection_type || "",
      },
      lan: {
        ip: d.lan?.ip || "",
        subnet: d.lan?.subnet || "",
        dhcpEnabled: d.lan?.dhcp_enabled || false,
        dhcpStart: d.lan?.dhcp_start || "",
        dhcpEnd: d.lan?.dhcp_end || "",
        ethernetPorts: d.lan?.ethernet_ports || [],
      },
      wifi: {
        enabled2g: d.wifi?.enabled_2g || false,
        ssid2g: d.wifi?.ssid_2g || "",
        password2g: d.wifi?.password_2g || "",
        channel2g: d.wifi?.channel_2g || "",
        enabled5g: d.wifi?.enabled_5g || false,
        ssid5g: d.wifi?.ssid_5g || "",
        password5g: d.wifi?.password_5g || "",
        channel5g: d.wifi?.channel_5g || "",
      },
      hosts: {
        connected: d.hosts?.connected || [],
        count: d.hosts?.count ?? d.hosts?.connected?.length ?? 0,
      },
      voip: { lines: d.voip?.lines || [] },
      resources: {
        memoryFree: d.resources?.memory_free ?? null,
        cpuUsage: d.resources?.cpu_usage ?? null,
      },
      backup: {
        hasBackup: d.backup?.has_backup || false,
        lastBackup: d.backup?.last_backup || null,
      },
    };
  }

  const d = data;
  const lastContactDate = d.lastContact && typeof d.lastContact === "string" ? new Date(d.lastContact) : null;
  const isOnline = lastContactDate && !isNaN(lastContactDate.getTime()) && (Date.now() - lastContactDate.getTime()) < 5 * 60 * 1000;
  return {
    source: "legacy",
    id: d.mac || d.serialNumber || "",
    status: isOnline ? "online" : "offline",
    manufacturer: d.vendor || "N/A",
    model: d.model || "N/A",
    serial: d.serialNumber || "",
    macAddress: d.mac || "",
    firmware: d.firmwareVersion || "N/A",
    hardware: d.hardwareVersion || "N/A",
    uptime: d.uptime,
    lastInform: d.lastContact || null,
    lastBoot: null,
    productClass: "",
    pppoeUser: d.pppoeUser || "",
    wanIp: d.wanIp || "",
    connectionType: d.connectionType || "",
    signal: {
      rxPower: d.pon?.rxPower ? parseFloat(d.pon.rxPower) : null,
      txPower: d.pon?.txPower ? parseFloat(d.pon.txPower) : null,
      temperature: null,
      voltage: null,
    },
    wan: {
      connections: (d.wans || []).map((w: any) => ({
        name: w.alias || "WAN",
        type: w.connectionType || "",
        ipAddress: w.ipv4?.ip || "",
        status: w.status || "",
        username: w.pppoe?.username || "",
        vlanId: w.vlanId || "",
        macAddress: w.mac || "",
        enabled: w.enable !== false,
        subnetMask: "",
        defaultGateway: w.ipv4?.gateway || "",
        dnsServers: (w.ipv4?.dns || []).join(","),
        serviceList: (w.serviceTypes || []).join(","),
        uptime: w.uptime,
      })),
      pppoeUser: d.pppoeUser || "",
      wanIp: d.wanIp || "",
      connectionType: d.connectionType || "",
    },
    lan: {
      ip: d.lan?.subnet || "",
      subnet: d.lan?.netmask || "",
      dhcpEnabled: false,
      dhcpStart: "",
      dhcpEnd: "",
      ethernetPorts: (d.portStatus || []).map((p: any, i: number) => ({
        index: i + 1,
        status: p.status || "NoLink",
        speed: p.speed || "",
      })),
    },
    wifi: {
      enabled2g: d.wifi?.state_2g === 1,
      ssid2g: d.wifi?.ssid_2g || "",
      password2g: d.wifi?.password_2g || "",
      channel2g: d.wifi?.channel_2g || "",
      enabled5g: d.wifi?.state_5g === 1,
      ssid5g: d.wifi?.ssid_5g || "",
      password5g: d.wifi?.password_5g || "",
      channel5g: d.wifi?.channel_5g || "",
    },
    hosts: {
      connected: (d.connectedDevices || []).map((cd: any) => ({
        hostName: cd.dhcp_name || cd.hostname || "*",
        ipAddress: cd.ip || "",
        macAddress: cd.mac || "",
        interfaceType: cd.conn_type === 0 ? "Ethernet" : cd.conn_type === 1 ? "802.11" : (cd.conn_type || ""),
        active: true,
      })),
      count: d.connectedDevices?.length || 0,
    },
    voip: { lines: [] },
    resources: {
      memoryFree: null,
      cpuUsage: d.resourcesUsage?.cpuUsage ?? null,
    },
    backup: { hasBackup: false, lastBackup: null },
    rawLegacy: d,
  };
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
    sipServer: string; regulatoryDomain: string; wanSignal: string; enabled: boolean;
    lines: Array<{ phoneNumber: string; sipUser: string; connectionUser: string; password: string }>;
  }>({ sipServer: "", regulatoryDomain: "", wanSignal: "", enabled: true, lines: [] });
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

  const source = flashmanData?.source || "legacy";
  const rawDevice = flashmanData?.device;

  const { data: flashboardData } = useQuery<any>({
    queryKey: ["/api/links", linkId, "flashman", "flashboard"],
    queryFn: async () => {
      const res = await fetch(`/api/links/${linkId}/flashman/flashboard`, { credentials: "include" });
      return res.json();
    },
    enabled: !!flashmanData?.found && source === "legacy",
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

  useEffect(() => { return () => { stopPolling(); }; }, [stopPolling]);

  const commandMutation = useMutation({
    mutationFn: async (command: string) => {
      setActiveCommand(command);
      const payload: any = { command };
      if (command === "ping") payload.hosts = ["8.8.8.8", "1.1.1.1"];
      else if (command === "traceroute") payload.host = "8.8.8.8";
      const res = await apiRequest("POST", `/api/links/${linkId}/flashman/command`, payload);
      return res.json();
    },
    onSuccess: (_data, command) => {
      toast({ title: `Comando "${command}" enviado com sucesso` });
      stopPolling();
      setPolling(true);
      setActiveCommand(command);
      setLastCommandNoResults(null);
      const getResultsCount = (d: any, cmd: string) => {
        if (!d) return 0;
        if (cmd === "ping") return d.pingResults?.length || 0;
        if (cmd === "traceroute") return d.tracerouteResults?.length || 0;
        if (cmd === "speedtest") return d.speedtestResults?.length || 0;
        if (cmd === "onlinedevs") return d.connectedDevices?.length || 0;
        if (cmd === "sitesurvey") return d.siteSurveyResult?.length || 0;
        return 0;
      };
      prevResultsCountRef.current = getResultsCount(rawDevice, command);
      const pollInterval = command === "traceroute" ? 10000 : command === "speedtest" ? 10000 : 5000;
      const pollTimeout = command === "traceroute" ? 360000 : 120000;
      pollingIntervalRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/links/${linkId}/flashman/poll`, { credentials: "include" });
          if (!res.ok) return;
          const pollData = await res.json();
          if (pollData.device) {
            queryClient.setQueryData(["/api/links", linkId, "flashman", "info"], {
              enabled: true, found: true, device: pollData.device, source: "legacy",
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
          try { const parsed = JSON.parse(jsonMatch[1]); msg = parsed.error || parsed.message || msg; }
          catch { msg = jsonMatch[1] || msg; }
        } else if (errText) msg = errText;
      } catch {}
      toast({ title: msg, variant: "destructive" });
      stopPolling();
    },
  });

  const configFileMutation = useMutation({
    mutationFn: async () => { const res = await apiRequest("POST", `/api/links/${linkId}/flashman/config-file`); return res.json(); },
    onSuccess: () => { toast({ title: "Arquivo de configuração enviado" }); },
    onError: () => { toast({ title: "Erro ao enviar arquivo de configuração", variant: "destructive" }); },
  });

  const wifiMutation = useMutation({
    mutationFn: async ({ wifiId, data }: { wifiId: string; data: any }) => {
      const res = await apiRequest("PUT", `/api/links/${linkId}/flashman/wifi/interface/${wifiId}`, data);
      return res.json();
    },
    onSuccess: () => { toast({ title: "Wi-Fi atualizado com sucesso" }); setShowWifiEditDialog(false); refetchFlashman(); },
    onError: () => { toast({ title: "Erro ao atualizar Wi-Fi", variant: "destructive" }); },
  });

  const credentialsMutation = useMutation({
    mutationFn: async (data: { username?: string; password?: string }) => {
      const res = await apiRequest("PUT", `/api/links/${linkId}/flashman/web-credentials`, data); return res.json();
    },
    onSuccess: () => { toast({ title: "Credenciais atualizadas" }); setShowCredentialsDialog(false); refetchCreds(); },
    onError: () => { toast({ title: "Erro ao atualizar credenciais", variant: "destructive" }); },
  });

  const dnsMutation = useMutation({
    mutationFn: async (dnsServers: string[]) => {
      const res = await apiRequest("PUT", `/api/links/${linkId}/flashman/dns`, { dnsServers }); return res.json();
    },
    onSuccess: () => { toast({ title: "DNS atualizado" }); setShowDnsDialog(false); queryClient.invalidateQueries({ queryKey: ["/api/links", linkId, "flashman", "dns"] }); },
    onError: () => { toast({ title: "Erro ao atualizar DNS", variant: "destructive" }); },
  });

  const commentsMutation = useMutation({
    mutationFn: async (comments: string) => {
      const res = await apiRequest("PUT", `/api/links/${linkId}/flashman/comments`, { comments }); return res.json();
    },
    onSuccess: () => { toast({ title: "Observações salvas" }); queryClient.invalidateQueries({ queryKey: ["/api/links", linkId, "flashman", "comments"] }); },
    onError: () => { toast({ title: "Erro ao salvar observações", variant: "destructive" }); },
  });

  const wanMutation = useMutation({
    mutationFn: async ({ wanId, data }: { wanId: string; data: any }) => {
      const res = await apiRequest("PUT", `/api/links/${linkId}/flashman/wan/${wanId}`, data); return res.json();
    },
    onSuccess: () => { toast({ title: "WAN atualizada com sucesso" }); setShowWanEditDialog(false); refetchFlashman(); },
    onError: () => { toast({ title: "Erro ao atualizar WAN", variant: "destructive" }); },
  });

  const voipMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("PUT", `/api/links/${linkId}/flashman/voip`, data); return res.json();
    },
    onSuccess: () => { toast({ title: "VoIP atualizado com sucesso" }); setShowVoipEditDialog(false); refetchVoip(); },
    onError: () => { toast({ title: "Erro ao atualizar VoIP", variant: "destructive" }); },
  });

  const lanMutation = useMutation({
    mutationFn: async (data: { lan_subnet?: string; lan_netmask?: string }) => {
      const res = await apiRequest("PUT", `/api/links/${linkId}/flashman/lan`, data); return res.json();
    },
    onSuccess: () => { toast({ title: "LAN atualizada com sucesso" }); setShowLanEditDialog(false); refetchFlashman(); },
    onError: () => { toast({ title: "Erro ao atualizar LAN", variant: "destructive" }); },
  });

  if (flashmanLoading) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center gap-2 space-y-0">
          <Radio className="w-5 h-5" />
          <CardTitle className="text-base">ACS / TR-069</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-4 w-36" />
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
          <CardTitle className="text-base">ACS / TR-069</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{safeText(flashmanData?.message, "Dispositivo não encontrado no ACS")}</p>
        </CardContent>
      </Card>
    );
  }

  const device = normalizeDevice(rawDevice, source);
  const isOnline = device.status === "online";
  const legacyDevice = source === "legacy" ? rawDevice : null;

  const commandButtons = [
    { cmd: "sync", label: "Sync TR-069", icon: RefreshCw },
    { cmd: "boot", label: "Reiniciar", icon: RotateCcw },
    { cmd: "speedtest", label: "Speed Test", icon: Gauge },
    { cmd: "ping", label: "Ping", icon: Activity },
    { cmd: "traceroute", label: "Traceroute", icon: Route },
    { cmd: "onlinedevs", label: "Dispositivos", icon: MonitorSmartphone },
    { cmd: "sitesurvey", label: "Site Survey", icon: Signal },
    { cmd: "pondata", label: "Sinal PON", icon: Zap },
    { cmd: "bestchannel", label: "Melhor Canal", icon: Wifi },
  ];

  const report = flashboardData?.report;
  const toggleWanExpanded = (index: number) => {
    setExpandedWans((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index); else next.add(index);
      return next;
    });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-3">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <CardTitle className="text-lg font-bold" data-testid="text-device-model">
                  {device.manufacturer !== "N/A" ? `${device.manufacturer} ` : ""}{device.model}
                </CardTitle>
                <Badge
                  variant={isOnline ? "default" : "secondary"}
                  className={isOnline ? "bg-green-600 hover:bg-green-700" : ""}
                  data-testid="badge-device-status"
                >
                  {isOnline ? "Online" : "Offline"}
                </Badge>
                <Badge variant="outline" data-testid="badge-device-type">ONT/ONU</Badge>
              </div>
              <div className="text-xs text-muted-foreground mt-1 font-mono" data-testid="text-device-serial">
                SN: {device.serial || device.id}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            <Button variant="outline" size="sm" onClick={() => refetchFlashman()} data-testid="button-refresh-flashman">
              <RefreshCw className="w-4 h-4 mr-1" /> Atualizar
            </Button>
            {isSuperAdmin && (
              <>
                <Button variant="outline" size="sm" onClick={() => commandMutation.mutate("boot")} disabled={!!activeCommand} data-testid="button-reboot">
                  <RotateCcw className="w-4 h-4 mr-1" /> Reboot
                </Button>
                <Button variant="outline" size="sm" onClick={() => commandMutation.mutate("sync")} disabled={!!activeCommand} data-testid="button-sync">
                  <RefreshCw className="w-4 h-4 mr-1" /> Sync
                </Button>
              </>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="hero-cards">
          <HeroCard
            icon={ArrowDown}
            label="RX Power"
            value={formatSignalValue(device.signal.rxPower)}
            valueClass={getSignalColor(device.signal.rxPower)}
            subLabel={device.signal.rxPower != null && device.signal.rxPower < -25 ? "Sinal baixo" : undefined}
          />
          <HeroCard
            icon={ArrowUp}
            label="TX Power"
            value={formatSignalValue(device.signal.txPower)}
            valueClass="text-foreground"
          />
          <HeroCard
            icon={Thermometer}
            label="Temperatura"
            value={device.signal.temperature != null ? `${device.signal.temperature}°C` : "N/A"}
            valueClass={device.signal.temperature != null && device.signal.temperature > 70 ? "text-red-500" : "text-foreground"}
          />
          <HeroCard
            icon={Timer}
            label="Uptime"
            value={formatUptime(device.uptime)}
            valueClass="text-foreground"
          />
        </div>

        <Tabs defaultValue="info" className="w-full">
          <TabsList className="w-full flex-wrap h-auto gap-1" data-testid="tabs-flashman">
            <TabsTrigger value="info" data-testid="tab-info">Info</TabsTrigger>
            <TabsTrigger value="sinal" data-testid="tab-sinal">Sinal</TabsTrigger>
            <TabsTrigger value="wan" data-testid="tab-wan">WAN</TabsTrigger>
            <TabsTrigger value="lan" data-testid="tab-lan">LAN</TabsTrigger>
            <TabsTrigger value="wifi" data-testid="tab-wifi">WiFi</TabsTrigger>
            <TabsTrigger value="hosts" data-testid="tab-hosts">Hosts</TabsTrigger>
            <TabsTrigger value="voip" data-testid="tab-voip">VoIP</TabsTrigger>
            <TabsTrigger value="diag" data-testid="tab-diag">Diag</TabsTrigger>
          </TabsList>

          <TabsContent value="info" className="mt-4">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-2 space-y-4">
                <div>
                  <div className="text-sm font-medium mb-2 flex items-center gap-1.5">
                    <Cpu className="w-4 h-4" /> Dados do Dispositivo
                  </div>
                  <div className="rounded-lg border border-border/50 p-4 space-y-0">
                    <InfoRow label="Fabricante" value={device.manufacturer} />
                    <InfoRow label="Modelo" value={device.model} />
                    <InfoRow label="Serial" value={device.serial || "N/A"} mono />
                    <InfoRow label="MAC Address" value={device.macAddress || "N/A"} mono />
                    <InfoRow label="Firmware" value={device.firmware} mono />
                    <InfoRow label="Hardware" value={device.hardware} />
                    <InfoRow label="Uptime" value={formatUptime(device.uptime)} />
                    {device.lastInform && (
                      <InfoRow
                        label="Último Inform"
                        value={(() => {
                          try {
                            const d = new Date(device.lastInform);
                            return `${d.toLocaleDateString("pt-BR")}, ${d.toLocaleTimeString("pt-BR")}`;
                          } catch { return device.lastInform; }
                        })()}
                      />
                    )}
                    {device.lastBoot && (
                      <InfoRow
                        label="Último Boot"
                        value={(() => {
                          try {
                            const d = new Date(device.lastBoot);
                            return `${d.toLocaleDateString("pt-BR")}, ${d.toLocaleTimeString("pt-BR")}`;
                          } catch { return device.lastBoot; }
                        })()}
                      />
                    )}
                  </div>
                </div>

                {device.backup.hasBackup && (
                  <div>
                    <div className="text-sm font-medium mb-2 flex items-center gap-1.5">
                      <HardDrive className="w-4 h-4" /> Backup de Configuração
                    </div>
                    <div className="rounded-lg border border-border/50 p-4">
                      <InfoRow
                        label="Último backup"
                        value={device.backup.lastBackup ? (() => {
                          try { const d = new Date(device.backup.lastBackup!); return `${d.toLocaleDateString("pt-BR")}, ${d.toLocaleTimeString("pt-BR")}`; }
                          catch { return device.backup.lastBackup!; }
                        })() : "N/A"}
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-4">
                <div className="rounded-lg border border-border/50 p-4">
                  <div className="text-sm font-medium mb-3">Status Rápido</div>
                  <div className="space-y-0">
                    <InfoRow label="Status" value={isOnline ? "Online" : "Offline"} />
                    <InfoRow label="RX" value={formatSignalValue(device.signal.rxPower)} mono />
                    <InfoRow label="TX" value={formatSignalValue(device.signal.txPower)} mono />
                    {device.signal.temperature != null && (
                      <InfoRow label="Temp" value={`${device.signal.temperature}°C`} />
                    )}
                    <InfoRow label="Uptime" value={formatUptime(device.uptime)} />
                    <InfoRow label="Hosts" value={String(device.hosts.count)} />
                    <InfoRow label="WAN" value={device.wan.connections.map((c: any) =>
                      `${c.type || "N/A"}/${c.status || "N/A"}`
                    ).join(", ") || "N/A"} />
                    {device.resources.cpuUsage != null && (
                      <InfoRow label="CPU" value={`${device.resources.cpuUsage}%`} />
                    )}
                  </div>
                </div>

                {(device.wifi.ssid2g || device.wifi.ssid5g) && (
                  <div className="rounded-lg border border-border/50 p-4">
                    <div className="text-sm font-medium mb-3 flex items-center gap-1.5">
                      <Wifi className="w-4 h-4" /> Wi-Fi
                    </div>
                    <div className="space-y-0">
                      {device.wifi.ssid2g && (
                        <>
                          <InfoRow label="2.4G" value={device.wifi.ssid2g} />
                          {device.wifi.channel2g && <InfoRow label="Canal" value={device.wifi.channel2g} />}
                        </>
                      )}
                      {device.wifi.ssid5g && (
                        <>
                          <InfoRow label="5G" value={device.wifi.ssid5g} />
                          {device.wifi.channel5g && <InfoRow label="Canal" value={device.wifi.channel5g} />}
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="sinal" className="mt-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="rounded-lg border border-border/50 p-6 text-center">
                <ArrowDown className="w-6 h-6 mx-auto text-muted-foreground mb-2" />
                <div className={`text-2xl font-bold font-mono ${getSignalColor(device.signal.rxPower)}`}>
                  {formatSignalValue(device.signal.rxPower)}
                </div>
                <div className="text-sm text-muted-foreground mt-1">RX Power</div>
                {device.signal.rxPower != null && (
                  <Badge
                    variant="outline"
                    className={`mt-2 ${device.signal.rxPower >= -25 ? "border-green-500 text-green-500" : device.signal.rxPower >= -28 ? "border-yellow-500 text-yellow-500" : "border-red-500 text-red-500"}`}
                  >
                    {device.signal.rxPower >= -25 ? "Bom" : device.signal.rxPower >= -28 ? "Regular" : "Crítico"}
                  </Badge>
                )}
              </div>
              <div className="rounded-lg border border-border/50 p-6 text-center">
                <ArrowUp className="w-6 h-6 mx-auto text-muted-foreground mb-2" />
                <div className="text-2xl font-bold font-mono">
                  {formatSignalValue(device.signal.txPower)}
                </div>
                <div className="text-sm text-muted-foreground mt-1">TX Power</div>
              </div>
              <div className="rounded-lg border border-border/50 p-6 text-center">
                <Users className="w-6 h-6 mx-auto text-muted-foreground mb-2" />
                <div className="text-2xl font-bold font-mono">{device.hosts.count}</div>
                <div className="text-sm text-muted-foreground mt-1">Hosts Conectados</div>
              </div>
            </div>

            {device.signal.temperature != null && (
              <div className="rounded-lg border border-border/50 p-4">
                <div className="text-sm font-medium mb-2">Sensores</div>
                <div className="grid grid-cols-2 gap-4">
                  <InfoRow label="Temperatura" value={`${device.signal.temperature}°C`} />
                  {device.signal.voltage != null && (
                    <InfoRow label="Voltagem" value={`${(device.signal.voltage / 1000).toFixed(2)}V`} />
                  )}
                </div>
              </div>
            )}

            {report?.pon && (
              <div className="rounded-lg border border-border/50 p-4">
                <div className="text-sm font-medium mb-2">Histórico PON (Flashboard)</div>
                <div className="grid grid-cols-2 gap-4">
                  {report.pon.rx && (
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">RX (min/avg/max)</div>
                      <div className="font-mono text-sm">
                        {report.pon.rx.min} / {report.pon.rx.mean} / {report.pon.rx.max} dBm
                      </div>
                    </div>
                  )}
                  {report.pon.tx && (
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">TX (min/avg/max)</div>
                      <div className="font-mono text-sm">
                        {report.pon.tx.min} / {report.pon.tx.mean} / {report.pon.tx.max} dBm
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="wan" className="mt-4 space-y-3">
            {device.wan.connections.length > 0 ? (
              device.wan.connections.map((conn: any, i: number) => {
                const isExpanded = expandedWans.has(i);
                return (
                  <div key={conn.name || i} className="rounded-lg border border-border/50" data-testid={`wan-${i}`}>
                    <button
                      type="button"
                      className="w-full flex items-center justify-between p-3 text-left"
                      onClick={() => toggleWanExpanded(i)}
                      data-testid={`wan-toggle-${i}`}
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        <span className="font-medium text-sm">{conn.name || `WAN ${i + 1}`}</span>
                        <Badge variant="outline">{conn.type || "N/A"}</Badge>
                        <Badge
                          variant={conn.status === "Connected" ? "default" : "secondary"}
                          className={conn.status === "Connected" ? "bg-green-600" : ""}
                        >
                          {conn.status || "N/A"}
                        </Badge>
                        {conn.serviceList && (
                          <span className="text-xs text-muted-foreground">{conn.serviceList}</span>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground font-mono">{conn.ipAddress || ""}</span>
                    </button>
                    {isExpanded && (
                      <div className="px-4 pb-3 space-y-0 border-t border-border/30">
                        <InfoRow label="IP" value={conn.ipAddress || "N/A"} mono />
                        {conn.macAddress && <InfoRow label="MAC" value={conn.macAddress} mono />}
                        {conn.subnetMask && <InfoRow label="Máscara" value={conn.subnetMask} mono />}
                        {conn.defaultGateway && <InfoRow label="Gateway" value={conn.defaultGateway} mono />}
                        {conn.dnsServers && <InfoRow label="DNS" value={conn.dnsServers} mono />}
                        {conn.username && <InfoRow label="PPPoE User" value={conn.username} mono />}
                        {conn.vlanId && <InfoRow label="VLAN" value={String(conn.vlanId)} />}
                        {conn.uptime != null && <InfoRow label="Uptime" value={formatUptime(conn.uptime)} />}
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              <p className="text-sm text-muted-foreground">Nenhuma interface WAN disponível.</p>
            )}
          </TabsContent>

          <TabsContent value="lan" className="mt-4 space-y-4">
            <div className="rounded-lg border border-border/50 p-4">
              <div className="text-sm font-medium mb-2 flex items-center gap-1.5">
                <HardDrive className="w-4 h-4" /> Rede LAN
              </div>
              <div className="space-y-0">
                {device.lan.ip && <InfoRow label="IP" value={device.lan.ip} mono />}
                {device.lan.subnet && <InfoRow label="Máscara" value={device.lan.subnet} mono />}
                <InfoRow label="DHCP" value={device.lan.dhcpEnabled ? "Habilitado" : "Desabilitado"} />
                {device.lan.dhcpStart && <InfoRow label="DHCP Início" value={device.lan.dhcpStart} mono />}
                {device.lan.dhcpEnd && <InfoRow label="DHCP Fim" value={device.lan.dhcpEnd} mono />}
              </div>
            </div>

            {device.lan.ethernetPorts.length > 0 && (
              <div>
                <div className="text-sm font-medium mb-2 flex items-center gap-1.5">
                  <Cable className="w-4 h-4" /> Portas Ethernet
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {device.lan.ethernetPorts.map((port: any) => (
                    <div key={port.index} className="rounded-lg border border-border/50 p-3 text-center" data-testid={`port-status-${port.index}`}>
                      <div className="text-xs text-muted-foreground mb-1">Porta {port.index}</div>
                      <Badge
                        variant={port.status === "NoLink" || !port.status ? "secondary" : "default"}
                        className={port.status && port.status !== "NoLink" ? "bg-green-600" : ""}
                      >
                        {port.status || "NoLink"}
                      </Badge>
                      {port.speed && <div className="text-xs mt-1 font-mono">{port.speed} Mbps</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                <div className="text-sm font-medium flex items-center gap-1.5"><Globe className="w-4 h-4" /> DNS LAN</div>
                {isSuperAdmin && (
                  <Button variant="outline" size="sm" onClick={() => {
                    const current = dnsData?.data;
                    let servers = "";
                    if (current?.dns_servers && Array.isArray(current.dns_servers)) servers = current.dns_servers.join("\n");
                    else if (current?.device?.lan_dns_servers) servers = current.device.lan_dns_servers;
                    setDnsForm(servers);
                    setShowDnsDialog(true);
                  }} data-testid="button-edit-dns">
                    <Pencil className="w-4 h-4 mr-1" /> Editar DNS
                  </Button>
                )}
              </div>
              {dnsData?.data ? (
                <div className="rounded-lg border border-border/50 p-3 text-sm">
                  {(() => {
                    const d = dnsData.data;
                    if (d?.dns_servers && Array.isArray(d.dns_servers)) return d.dns_servers.map((s: string, i: number) => <div key={i} className="font-mono">{s}</div>);
                    if (d?.device?.lan_dns_servers) return <div className="font-mono">{d.device.lan_dns_servers}</div>;
                    return <span className="text-muted-foreground">Nenhum DNS configurado</span>;
                  })()}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Carregando...</p>
              )}
            </div>
          </TabsContent>

          <TabsContent value="wifi" className="mt-4 space-y-4">
            {(device.wifi.ssid2g || device.wifi.ssid5g) ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {device.wifi.ssid2g && (
                  <div className="rounded-lg border border-border/50 p-4 space-y-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">2.4 GHz</Badge>
                        <Badge variant={device.wifi.enabled2g ? "default" : "secondary"} className={device.wifi.enabled2g ? "bg-green-600" : ""}>
                          {device.wifi.enabled2g ? "Ativo" : "Inativo"}
                        </Badge>
                      </div>
                      {isSuperAdmin && (
                        <Button variant="ghost" size="icon" onClick={() => {
                          setEditingWifiBand("2g");
                          setWifiEditForm({ ssid: device.wifi.ssid2g, password: device.wifi.password2g, channel: device.wifi.channel2g || "auto" });
                          setShowWifiEditDialog(true);
                        }} data-testid="button-edit-wifi-2g"><Pencil className="w-4 h-4" /></Button>
                      )}
                    </div>
                    <div className="space-y-0 text-sm">
                      <InfoRow label="SSID" value={device.wifi.ssid2g} />
                      <div className="flex justify-between gap-2 py-1.5 border-b border-border/30">
                        <span className="text-muted-foreground text-sm">Senha</span>
                        <div className="flex items-center gap-1">
                          <span className="text-sm font-mono">{showPassword2g ? device.wifi.password2g || "N/A" : "••••••••"}</span>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setShowPassword2g(!showPassword2g)} data-testid="toggle-password-2g">
                            {showPassword2g ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                          </Button>
                        </div>
                      </div>
                      <InfoRow label="Canal" value={device.wifi.channel2g || "auto"} />
                    </div>
                  </div>
                )}
                {device.wifi.ssid5g && (
                  <div className="rounded-lg border border-border/50 p-4 space-y-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">5 GHz</Badge>
                        <Badge variant={device.wifi.enabled5g ? "default" : "secondary"} className={device.wifi.enabled5g ? "bg-green-600" : ""}>
                          {device.wifi.enabled5g ? "Ativo" : "Inativo"}
                        </Badge>
                      </div>
                      {isSuperAdmin && (
                        <Button variant="ghost" size="icon" onClick={() => {
                          setEditingWifiBand("5g");
                          setWifiEditForm({ ssid: device.wifi.ssid5g, password: device.wifi.password5g, channel: device.wifi.channel5g || "auto" });
                          setShowWifiEditDialog(true);
                        }} data-testid="button-edit-wifi-5g"><Pencil className="w-4 h-4" /></Button>
                      )}
                    </div>
                    <div className="space-y-0 text-sm">
                      <InfoRow label="SSID" value={device.wifi.ssid5g} />
                      <div className="flex justify-between gap-2 py-1.5 border-b border-border/30">
                        <span className="text-muted-foreground text-sm">Senha</span>
                        <div className="flex items-center gap-1">
                          <span className="text-sm font-mono">{showPassword5g ? device.wifi.password5g || "N/A" : "••••••••"}</span>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setShowPassword5g(!showPassword5g)} data-testid="toggle-password-5g">
                            {showPassword5g ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                          </Button>
                        </div>
                      </div>
                      <InfoRow label="Canal" value={device.wifi.channel5g || "auto"} />
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Nenhuma informação de Wi-Fi disponível.</p>
            )}
          </TabsContent>

          <TabsContent value="hosts" className="mt-4 space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="text-sm font-medium flex items-center gap-1.5">
                <MonitorSmartphone className="w-4 h-4" /> Dispositivos Conectados
              </div>
              <Badge variant="outline">{device.hosts.count}</Badge>
            </div>
            {device.hosts.connected.length > 0 ? (
              <div className="space-y-2 max-h-96 overflow-auto">
                {device.hosts.connected.map((host: any, i: number) => (
                  <div key={i} className="flex items-center justify-between p-3 rounded-lg border border-border/50 text-sm" data-testid={`host-${i}`}>
                    <div>
                      <div className="font-medium">{host.hostName && host.hostName !== "*" ? host.hostName : `Dispositivo ${i + 1}`}</div>
                      <div className="text-xs text-muted-foreground font-mono">{host.ipAddress} — {host.macAddress}</div>
                    </div>
                    <div className="text-right text-xs">
                      <Badge variant={host.active !== false ? "default" : "secondary"} className={`text-xs ${host.active !== false ? "bg-green-600" : ""}`}>
                        {host.active !== false ? "Ativo" : "Inativo"}
                      </Badge>
                      {host.interfaceType && (
                        <div className="text-muted-foreground mt-1">{host.interfaceType === "802.11" ? "Wi-Fi" : host.interfaceType}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Nenhum dispositivo conectado.</p>
            )}
          </TabsContent>

          <TabsContent value="voip" className="mt-4 space-y-4">
            {device.voip.lines.length > 0 ? (
              <div className="space-y-3">
                {device.voip.lines.map((line: any, i: number) => (
                  <div key={i} className="rounded-lg border border-border/50 p-4 text-sm" data-testid={`voip-line-${i}`}>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="font-medium">Linha {line.index || i + 1}</span>
                      <Badge variant={line.status === "Up" || line.enabled ? "default" : "secondary"} className={line.status === "Up" || line.enabled ? "bg-green-600" : ""}>
                        {line.status || (line.enabled ? "Up" : "Down")}
                      </Badge>
                    </div>
                    {line.directoryNumber && <InfoRow label="Número" value={line.directoryNumber} />}
                  </div>
                ))}
              </div>
            ) : voipData?.data ? (
              (() => {
                const vd = voipData.data;
                if (vd?.profiles && Array.isArray(vd.profiles)) {
                  return (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="text-sm font-medium flex items-center gap-1"><Phone className="w-4 h-4" /> Perfis VoIP</div>
                        {isSuperAdmin && (
                          <Button variant="outline" size="sm" onClick={() => {
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
                          }} data-testid="button-edit-voip">
                            <Pencil className="w-4 h-4 mr-1" /> Editar
                          </Button>
                        )}
                      </div>
                      {vd.profiles.map((profile: any, i: number) => (
                        <div key={i} className="rounded-lg border border-border/50 p-4 text-sm" data-testid={`voip-profile-${i}`}>
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <span className="font-medium">Linha {i + 1}</span>
                            <Badge variant={profile.status === "Up" || profile.enabled ? "default" : "secondary"} className={profile.status === "Up" || profile.enabled ? "bg-green-600" : ""}>
                              {profile.status || (profile.enabled ? "Up" : "Down")}
                            </Badge>
                          </div>
                          {profile.phone_number && <InfoRow label="Número" value={profile.phone_number} />}
                          {profile.sip_user && <InfoRow label="SIP User" value={profile.sip_user} mono />}
                          {profile.proxy_address && <InfoRow label="SIP Server" value={profile.proxy_address} mono />}
                        </div>
                      ))}
                    </div>
                  );
                }
                return <p className="text-sm text-muted-foreground">Nenhuma configuração VoIP disponível.</p>;
              })()
            ) : (
              <p className="text-sm text-muted-foreground">Carregando VoIP...</p>
            )}
          </TabsContent>

          <TabsContent value="diag" className="mt-4 space-y-4">
            {isSuperAdmin && (
              <div>
                <div className="text-sm font-medium mb-2 flex items-center gap-1.5"><Wrench className="w-4 h-4" /> Ações / Diagnósticos</div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
                  {commandButtons.map((btn) => {
                    const Icon = btn.icon;
                    return (
                      <Button key={btn.cmd} variant="outline" size="sm" disabled={!!activeCommand}
                        onClick={() => commandMutation.mutate(btn.cmd)} data-testid={`button-flashman-${btn.cmd}`}>
                        {activeCommand === btn.cmd ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Icon className="w-4 h-4 mr-1" />}
                        {btn.label}
                      </Button>
                    );
                  })}
                  <Button variant="outline" size="sm" disabled={configFileMutation.isPending}
                    onClick={() => configFileMutation.mutate()} data-testid="button-flashman-config-file">
                    {configFileMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <FileUp className="w-4 h-4 mr-1" />}
                    Config File
                  </Button>
                </div>
                {polling && (
                  <div className="flex items-center gap-2 mt-3 text-sm text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Aguardando resultado de {activeCommand || "comando"}...
                  </div>
                )}
              </div>
            )}

            {lastCommandNoResults && (
              <div className="p-3 rounded-lg bg-destructive/10 text-sm" data-testid="text-no-results">
                <div className="font-medium text-destructive">
                  Nenhum resultado recebido para "{lastCommandNoResults}"
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  O tempo de espera esgotou. O CPE pode estar offline ou o comando pode não ser suportado.
                </div>
              </div>
            )}

            {legacyDevice?.speedtestResults?.length > 0 && (
              <div>
                <div className="text-sm font-medium mb-2 flex items-center gap-1.5"><Gauge className="w-4 h-4" /> Speed Test</div>
                <div className="space-y-2">
                  {legacyDevice.speedtestResults.slice(0, 3).map((result: any, i: number) => (
                    <div key={i} className="p-3 rounded-lg border border-border/50 text-sm">
                      <div className="flex justify-between flex-wrap gap-1">
                        <span>Download: <span className="font-mono font-medium">{safeText(result.down_speed, "N/A")} Mbps</span></span>
                        <span>Upload: <span className="font-mono font-medium">{safeText(result.up_speed, "N/A")} Mbps</span></span>
                      </div>
                      {result.timestamp && <div className="text-xs text-muted-foreground mt-1">{result.timestamp}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {legacyDevice?.pingResults?.length > 0 && (
              <div>
                <div className="text-sm font-medium mb-2 flex items-center gap-1.5"><Activity className="w-4 h-4" /> Ping</div>
                <div className="space-y-2">
                  {legacyDevice.pingResults.map((result: any, i: number) => (
                    <div key={i} className="p-3 rounded-lg border border-border/50 text-sm">
                      <div className="flex justify-between flex-wrap gap-1">
                        <span>Host: <span className="font-mono">{safeText(result.host)}</span></span>
                        <span>Latência: <span className="font-mono">{safeText(result.lat)} ms</span></span>
                        <span>Perda: <span className="font-mono">{result.loss != null ? `${(parseFloat(String(result.loss)) * 100).toFixed(1)}%` : "N/A"}</span></span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {legacyDevice?.tracerouteResults?.length > 0 && (
              <div>
                <div className="text-sm font-medium mb-2 flex items-center gap-1.5"><Route className="w-4 h-4" /> Traceroute</div>
                <div className="space-y-2">
                  {legacyDevice.tracerouteResults.map((result: any, i: number) => (
                    <div key={i} className="p-3 rounded-lg border border-border/50 text-sm">
                      <div className="flex justify-between flex-wrap gap-1 mb-2">
                        <span>Destino: <span className="font-mono">{safeText(result.address)}</span></span>
                        <span>{result.completed ? (result.reached_destination ? "Alcançado" : "Não alcançado") : "Em andamento..."}</span>
                      </div>
                      {result.hops?.length > 0 && (
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

            {legacyDevice?.siteSurveyResult?.length > 0 && (
              <div>
                <div className="text-sm font-medium mb-2 flex items-center gap-1.5"><Wifi className="w-4 h-4" /> Site Survey</div>
                <div className="max-h-48 overflow-auto space-y-1">
                  {legacyDevice.siteSurveyResult.map((net: any, i: number) => (
                    <div key={i} className="flex items-center justify-between p-2 rounded-lg border border-border/50 text-sm">
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

            <div>
              <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                <div className="text-sm font-medium flex items-center gap-1.5"><MessageSquare className="w-4 h-4" /> Observações</div>
                {isSuperAdmin && (
                  <Button variant="outline" size="sm" disabled={commentsMutation.isPending}
                    onClick={() => commentsMutation.mutate(commentsText)} data-testid="button-save-comments">
                    {commentsMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
                    Salvar
                  </Button>
                )}
              </div>
              <Textarea value={commentsText} onChange={(e) => setCommentsText(e.target.value)}
                placeholder="Observações sobre o dispositivo..." className="min-h-[100px] text-sm"
                disabled={!isSuperAdmin} data-testid="textarea-comments" />
            </div>

            {isSuperAdmin && (
              <div>
                <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                  <div className="text-sm font-medium flex items-center gap-1.5"><Cpu className="w-4 h-4" /> Credenciais Web</div>
                  <Button variant="outline" size="sm" onClick={() => {
                    const cred = webCredData?.data;
                    setCredentialsForm({
                      username: cred?.username || cred?.device?.web_admin_username || "",
                      password: cred?.password || cred?.device?.web_admin_password || "",
                    });
                    setShowCredentialsDialog(true);
                  }} data-testid="button-edit-web-credentials">
                    <Pencil className="w-4 h-4 mr-1" /> Editar
                  </Button>
                </div>
                {webCredData?.data ? (
                  <div className="rounded-lg border border-border/50 p-3 text-sm space-y-0">
                    <InfoRow label="Usuário" value={safeText(webCredData.data.username || webCredData.data.device?.web_admin_username)} mono />
                    <div className="flex justify-between gap-2 py-1.5">
                      <span className="text-muted-foreground text-sm">Senha</span>
                      <div className="flex items-center gap-1">
                        <span className="text-sm font-mono">{showCredPassword ? safeText(webCredData.data.password || webCredData.data.device?.web_admin_password) : "••••••••"}</span>
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
          </TabsContent>
        </Tabs>
      </CardContent>

      <Dialog open={showWanEditDialog} onOpenChange={setShowWanEditDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Editar WAN</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm text-muted-foreground">MTU</label>
              <Input type="number" value={wanEditForm.mtu} onChange={(e) => setWanEditForm({ ...wanEditForm, mtu: e.target.value })} placeholder="1500" data-testid="input-wan-mtu" />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">VLAN ID</label>
              <Input type="number" value={wanEditForm.vlanId} onChange={(e) => setWanEditForm({ ...wanEditForm, vlanId: e.target.value })} placeholder="0" data-testid="input-wan-vlanid" />
            </div>
            <div className="flex items-center justify-between gap-2">
              <label className="text-sm text-muted-foreground">Habilitado</label>
              <Switch checked={wanEditForm.enable} onCheckedChange={(checked) => setWanEditForm({ ...wanEditForm, enable: checked })} data-testid="switch-wan-enable" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowWanEditDialog(false)} data-testid="button-cancel-wan">Cancelar</Button>
            <Button disabled={wanMutation.isPending} onClick={() => {
              wanMutation.mutate({ wanId: editingWanId, data: { mtu: wanEditForm.mtu ? parseInt(wanEditForm.mtu) : undefined, vlanId: wanEditForm.vlanId ? parseInt(wanEditForm.vlanId) : undefined, enable: wanEditForm.enable } });
            }} data-testid="button-save-wan">
              {wanMutation.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />} Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showVoipEditDialog} onOpenChange={setShowVoipEditDialog}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Editar VoIP</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <label className="text-sm text-muted-foreground">Habilitado</label>
              <Switch checked={voipEditForm.enabled} onCheckedChange={(checked) => setVoipEditForm({ ...voipEditForm, enabled: checked })} data-testid="switch-voip-enable" />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">SIP Server</label>
              <Input value={voipEditForm.sipServer} onChange={(e) => setVoipEditForm({ ...voipEditForm, sipServer: e.target.value })} placeholder="sip.example.com" data-testid="input-voip-sip-server" />
            </div>
            {voipEditForm.lines.map((line, i) => (
              <div key={i} className="p-3 rounded-md bg-muted space-y-3">
                <div className="text-sm font-medium">Linha {i + 1}</div>
                <div>
                  <label className="text-xs text-muted-foreground">Número</label>
                  <Input value={line.phoneNumber} onChange={(e) => { const nl = [...voipEditForm.lines]; nl[i] = { ...nl[i], phoneNumber: e.target.value }; setVoipEditForm({ ...voipEditForm, lines: nl }); }} data-testid={`input-voip-phone-${i}`} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">SIP User</label>
                  <Input value={line.sipUser} onChange={(e) => { const nl = [...voipEditForm.lines]; nl[i] = { ...nl[i], sipUser: e.target.value }; setVoipEditForm({ ...voipEditForm, lines: nl }); }} data-testid={`input-voip-sip-user-${i}`} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Senha</label>
                  <Input type="password" value={line.password} onChange={(e) => { const nl = [...voipEditForm.lines]; nl[i] = { ...nl[i], password: e.target.value }; setVoipEditForm({ ...voipEditForm, lines: nl }); }} data-testid={`input-voip-password-${i}`} />
                </div>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowVoipEditDialog(false)} data-testid="button-cancel-voip">Cancelar</Button>
            <Button disabled={voipMutation.isPending} onClick={() => {
              voipMutation.mutate({ enabled: voipEditForm.enabled, sipServer: voipEditForm.sipServer, regulatoryDomain: voipEditForm.regulatoryDomain, lines: voipEditForm.lines });
            }} data-testid="button-save-voip">
              {voipMutation.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />} Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showLanEditDialog} onOpenChange={setShowLanEditDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Editar LAN</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm text-muted-foreground">IP do CPE (Subnet)</label>
              <Input value={lanEditForm.subnet} onChange={(e) => setLanEditForm({ ...lanEditForm, subnet: e.target.value })} placeholder="192.168.1.1" data-testid="input-lan-subnet" />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Máscara de Sub-rede</label>
              <Input value={lanEditForm.netmask} onChange={(e) => setLanEditForm({ ...lanEditForm, netmask: e.target.value })} placeholder="24" data-testid="input-lan-netmask" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowLanEditDialog(false)} data-testid="button-cancel-lan">Cancelar</Button>
            <Button disabled={lanMutation.isPending} onClick={() => { lanMutation.mutate({ lan_subnet: lanEditForm.subnet, lan_netmask: lanEditForm.netmask }); }} data-testid="button-save-lan">
              {lanMutation.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />} Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showWifiEditDialog} onOpenChange={setShowWifiEditDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Editar Wi-Fi {editingWifiBand === "2g" ? "2.4 GHz" : "5 GHz"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm text-muted-foreground">SSID</label>
              <Input value={wifiEditForm.ssid} onChange={(e) => setWifiEditForm({ ...wifiEditForm, ssid: e.target.value })} data-testid="input-wifi-ssid" />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Senha</label>
              <Input value={wifiEditForm.password} onChange={(e) => setWifiEditForm({ ...wifiEditForm, password: e.target.value })} type="password" data-testid="input-wifi-password" />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Canal</label>
              <Input value={wifiEditForm.channel} onChange={(e) => setWifiEditForm({ ...wifiEditForm, channel: e.target.value })} placeholder="auto" data-testid="input-wifi-channel" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowWifiEditDialog(false)} data-testid="button-cancel-wifi">Cancelar</Button>
            <Button disabled={wifiMutation.isPending} onClick={() => {
              const wifiId = editingWifiBand === "2g" ? "1" : "2";
              wifiMutation.mutate({ wifiId, data: { ssid: wifiEditForm.ssid, password: wifiEditForm.password, channel: wifiEditForm.channel || "auto" } });
            }} data-testid="button-save-wifi">
              {wifiMutation.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />} Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showCredentialsDialog} onOpenChange={setShowCredentialsDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Editar Credenciais Web</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm text-muted-foreground">Usuário</label>
              <Input value={credentialsForm.username} onChange={(e) => setCredentialsForm({ ...credentialsForm, username: e.target.value })} data-testid="input-cred-username" />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Senha</label>
              <Input value={credentialsForm.password} onChange={(e) => setCredentialsForm({ ...credentialsForm, password: e.target.value })} type="password" data-testid="input-cred-password" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCredentialsDialog(false)} data-testid="button-cancel-credentials">Cancelar</Button>
            <Button disabled={credentialsMutation.isPending} onClick={() => credentialsMutation.mutate(credentialsForm)} data-testid="button-save-credentials">
              {credentialsMutation.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />} Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showDnsDialog} onOpenChange={setShowDnsDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Editar DNS LAN</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm text-muted-foreground">Servidores DNS (um por linha)</label>
              <Textarea value={dnsForm} onChange={(e) => setDnsForm(e.target.value)} placeholder={"8.8.8.8\n8.8.4.4"} className="min-h-[80px]" data-testid="textarea-dns" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDnsDialog(false)} data-testid="button-cancel-dns">Cancelar</Button>
            <Button disabled={dnsMutation.isPending} onClick={() => {
              const servers = dnsForm.split("\n").map(s => s.trim()).filter(s => s);
              dnsMutation.mutate(servers);
            }} data-testid="button-save-dns">
              {dnsMutation.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />} Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
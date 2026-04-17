import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import {
  WifiOff,
  Network,
  Router,
  User,
  Shield,
  MapPin,
  Zap,
  Tag,
  RefreshCw,
  Play,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  Activity,
  KeyRound,
  MonitorSmartphone,
  Map,
  Radio,
  Ban,
  Trash2,
  FileDown,
  Link2,
  UploadCloud,
  Database,
  Bot,
} from "lucide-react";

interface DiagnosticCategory {
  count: number;
  ids: number[];
  label: string;
  enrichAction?: string;
  enrichable?: number;
  clientCount?: number;
  withTag?: number;
  withoutTag?: number;
  withData?: number;
  noRoute?: number;
  notFound?: number;
}

interface ContractStatusSummary {
  active: number;
  blocked: number;
  cancelled: number;
  unknown: number;
  deleted: number;
}

interface DiagnosticsData {
  totalLinks: number;
  healthyLinks: number;
  categories: Record<string, DiagnosticCategory>;
  contractStatusSummary?: ContractStatusSummary;
}

interface EnrichStatus {
  running: boolean;
  action: string;
  total: number;
  processed: number;
  success: number;
  failed: number;
  skipped: number;
  errors: string[];
  startedAt: number;
}

type IconComponent = typeof WifiOff;

const categoryConfig: Record<string, { icon: IconComponent; color: string; enrichLabel?: string; priority: number }> = {
  missingVoalleLogin: { icon: KeyRound, color: "text-violet-500", enrichLabel: "Validar login CPF/CNPJ", priority: 1 },
  missingIp: { icon: WifiOff, color: "text-red-500", enrichLabel: "Buscar IPs via RADIUS", priority: 2 },
  missingConcentrator: { icon: Router, color: "text-amber-500", enrichLabel: "Atribuir concentradores", priority: 3 },
  missingInterface: { icon: Network, color: "text-orange-500", enrichLabel: "Descobrir interfaces SNMP", priority: 4 },
  missingOptical: { icon: Zap, color: "text-teal-500", enrichLabel: "Atribuir OLTs", priority: 5 },
  missingOnuId: { icon: Activity, color: "text-pink-500", enrichLabel: "Descobrir ID da ONU", priority: 6 },
  missingOltAssignment: { icon: Radio, color: "text-cyan-500", priority: 7 },
  missingCpe: { icon: MonitorSmartphone, color: "text-indigo-500", enrichLabel: "Criar CPEs", priority: 8 },
  missingOzmapData: { icon: Map, color: "text-emerald-500", enrichLabel: "Sincronizar OZmap", priority: 9 },
  missingPppoeUser: { icon: User, color: "text-yellow-500", priority: 10 },
  missingSnmpProfile: { icon: Shield, color: "text-blue-500", priority: 11 },
  missingVoalleTag: { icon: Tag, color: "text-purple-500", enrichLabel: "Buscar dados Voalle", priority: 12 },
  missingCoordinates: { icon: MapPin, color: "text-gray-500", priority: 13 },
};

const actionLabels: Record<string, string> = {
  discover_ips: "Buscando IPs via RADIUS",
  discover_mac: "Buscando MACs via RADIUS",
  discover_voalle: "Buscando dados no Voalle",
  discover_voalle_login: "Validando login Portal Voalle (CPF/CNPJ)",
  assign_concentrators: "Atribuindo concentradores",
  assign_olts: "Atribuindo OLTs/Switches",
  discover_interfaces: "Descobrindo interfaces SNMP",
  sync_ozmap: "Sincronizando dados OZmap",
  create_cpes: "Criando CPEs automaticamente",
  discover_onu_ids: "Descobrindo ID da ONU via OLT",
  discover_all: "Enriquecimento completo",
};

interface ReconcileProgress {
  running: boolean;
  dryRun: boolean;
  phase: string; // "fetching_voalle" | "fetching_ozmap" | "processing" | "done" | "error"
  total: number;
  processed: number;
  success: number;
  already_linked: number;
  ozmap_not_found: number;
  skip: number;
  vinculate_failed: number;
  dry_run: number;
  error: number;
  results: Array<{ linkId: number; linkName: string; status: string; detail: string; voalleConnectionId?: number; linkTag?: string; oldTag?: string; ozmapFoundCode?: string; ozmapClientId?: string }>;
  errorMessage: string;
  startedAt: number;
  finishedAt: number;
}

export function LinkDiagnosticsTab() {
  const { toast } = useToast();
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [downloadingCsv, setDownloadingCsv] = useState(false);
  const [downloadingMissing, setDownloadingMissing] = useState(false);
  const [downloadingNoTag, setDownloadingNoTag] = useState(false);
  const [downloadingNoRoute, setDownloadingNoRoute] = useState(false);
  const [downloadingNotFound, setDownloadingNotFound] = useState(false);

  async function downloadOzmapDivergences() {
    setDownloadingCsv(true);
    try {
      const res = await fetch("/api/admin/ozmap-tag-divergences.csv", { credentials: "include" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Erro desconhecido" }));
        alert(err.error || "Erro ao gerar relatório");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const now = new Date().toISOString().slice(0, 10);
      a.download = `divergencias-ozmap-${now}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloadingCsv(false);
    }
  }

  async function downloadCsv(endpoint: string, filename: string, setLoading: (v: boolean) => void) {
    setLoading(true);
    try {
      const res = await fetch(endpoint, { credentials: "include" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Erro desconhecido" }));
        alert(err.error || "Erro ao gerar relatório");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setLoading(false);
    }
  }

  async function downloadOzmapMissing() {
    const now = new Date().toISOString().slice(0, 10);
    await downloadCsv("/api/admin/ozmap-missing.csv", `etiquetas-sem-ozmap-${now}.csv`, setDownloadingMissing);
  }

  async function downloadOzmapNoTag() {
    const now = new Date().toISOString().slice(0, 10);
    await downloadCsv("/api/admin/ozmap-no-tag.csv", `links-sem-etiqueta-${now}.csv`, setDownloadingNoTag);
  }

  async function downloadOzmapNoRoute() {
    const now = new Date().toISOString().slice(0, 10);
    await downloadCsv("/api/admin/ozmap-no-route.csv", `links-sem-rota-fibra-${now}.csv`, setDownloadingNoRoute);
  }

  async function downloadOzmapNotFound() {
    const now = new Date().toISOString().slice(0, 10);
    await downloadCsv("/api/admin/ozmap-not-found.csv", `links-etiqueta-nao-encontrada-${now}.csv`, setDownloadingNotFound);
  }

  const { data: diagnostics, isLoading, refetch } = useQuery<DiagnosticsData>({
    queryKey: ["/api/admin/links/diagnostics"],
    refetchInterval: 30000,
  });

  const { data: enrichStatus } = useQuery<EnrichStatus>({
    queryKey: ["/api/admin/links/enrich/status"],
    refetchInterval: (query) => {
      const data = query.state.data as EnrichStatus | undefined;
      return data?.running ? 2000 : 10000;
    },
  });

  const { data: reconcileStatus } = useQuery<ReconcileProgress>({
    queryKey: ["/api/admin/voalle-ozmap-reconcile/status"],
    refetchInterval: (query) => {
      const data = query.state.data as ReconcileProgress | undefined;
      return data?.running ? 2000 : 15000;
    },
  });

  const enrichMutation = useMutation({
    mutationFn: async (action: string) => {
      const res = await apiRequest("POST", "/api/admin/links/enrich", { action });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/links/enrich/status"] });
    },
  });

  const aiTriageMutation = useMutation({
    mutationFn: async (autoSelect: "offline" | "degraded") => {
      const res = await apiRequest("POST", "/api/admin/ai-analyst/enqueue", { autoSelect });
      return res.json() as Promise<{ enqueued: number; skipped: number }>;
    },
    onSuccess: (data, autoSelect) => {
      const tipo = autoSelect === "offline" ? "offline" : "degradados";
      toast({
        title: `Triagem IA enfileirada (${tipo})`,
        description: `${data.enqueued} novos · ${data.skipped} já estavam na fila. Vá em Admin → Analista IA para revisar.`,
      });
    },
    onError: (e: any) => toast({ title: "Erro ao enfileirar", description: e.message, variant: "destructive" }),
  });

  const reconcileMutation = useMutation({
    mutationFn: async ({ dryRun, linkIds }: { dryRun: boolean; linkIds?: number[] }) => {
      const res = await apiRequest("POST", "/api/admin/voalle-ozmap-reconcile", { dryRun, linkIds });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/voalle-ozmap-reconcile/status"] });
    },
  });

  // Estatísticas do mapeamento de etiquetas importado
  const { data: tagStats, refetch: refetchTagStats } = useQuery<{ count: number; lastImportedAt: string | null }>({
    queryKey: ["/api/admin/voalle-service-tags/stats"],
    refetchInterval: false,
  });

  // Importação CSV de etiquetas Voalle (parse no browser, envio em lotes de 500)
  const tagFileRef = useRef<HTMLInputElement>(null);
  const [tagImportResult, setTagImportResult] = useState<{ imported: number; skipped: number; total: number } | null>(null);
  const [tagImportProgress, setTagImportProgress] = useState<{ chunk: number; total: number } | null>(null);

  type TagRow = { id: number; serviceTag: string; title?: string | null; clientId?: number | null; contractId?: number | null; status?: number | null };

  const parseCsvTags = (text: string): { rows: TagRow[]; skipped: number } => {
    const parseRow = (line: string): string[] => {
      const cols: string[] = [];
      let cur = "";
      let inQuote = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"' && !inQuote) { inQuote = true; continue; }
        if (ch === '"' && inQuote) { inQuote = false; continue; }
        if (ch === "," && !inQuote) { cols.push(cur); cur = ""; continue; }
        cur += ch;
      }
      cols.push(cur);
      return cols;
    };
    const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) return { rows: [], skipped: 0 };
    const header = parseRow(lines[0]).map(h => h.toLowerCase().trim());
    const idx = {
      id:         header.indexOf("id"),
      serviceTag: header.indexOf("service_tag"),
      title:      header.indexOf("title"),
      clientId:   header.indexOf("client_id"),
      contractId: header.indexOf("contract_id"),
      status:     header.indexOf("status"),
    };
    if (idx.id < 0 || idx.serviceTag < 0) throw new Error(`Colunas 'id' e 'service_tag' não encontradas. Cabeçalho: ${header.slice(0, 10).join(", ")}`);
    const rows: TagRow[] = [];
    let skipped = 0;
    for (let i = 1; i < lines.length; i++) {
      const c = parseRow(lines[i]);
      const id = parseInt(c[idx.id] ?? "", 10);
      const serviceTag = (c[idx.serviceTag] ?? "").trim();
      if (!id || !serviceTag || serviceTag === "NULL") { skipped++; continue; }
      rows.push({
        id,
        serviceTag,
        title:      (idx.title >= 0 && c[idx.title] && c[idx.title] !== "NULL") ? c[idx.title] : null,
        clientId:   idx.clientId >= 0 ? (parseInt(c[idx.clientId] ?? "", 10) || null) : null,
        contractId: idx.contractId >= 0 ? (parseInt(c[idx.contractId] ?? "", 10) || null) : null,
        status:     idx.status >= 0 ? (parseInt(c[idx.status] ?? "", 10) || null) : null,
      });
    }
    return { rows, skipped };
  };

  const importTagsMutation = useMutation({
    mutationFn: async (csvText: string) => {
      const { rows, skipped } = parseCsvTags(csvText);
      if (rows.length === 0) throw new Error("Nenhuma linha válida encontrada no CSV");

      const CHUNK = 500;
      const totalChunks = Math.ceil(rows.length / CHUNK);
      let totalImported = 0;
      let totalSkipped = skipped;

      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = i / CHUNK + 1;
        setTagImportProgress({ chunk, total: totalChunks });
        const res = await apiRequest("POST", "/api/admin/voalle-service-tags/import", {
          rows: rows.slice(i, i + CHUNK),
          skippedInChunk: i === 0 ? skipped : 0,
        });
        const data = await res.json() as { imported: number; skipped: number };
        totalImported += data.imported;
        if (i === 0) totalSkipped = data.skipped;
      }
      setTagImportProgress(null);
      return { imported: totalImported, skipped: totalSkipped, total: rows.length + skipped };
    },
    onSuccess: (data) => {
      setTagImportResult(data);
      refetchTagStats();
    },
    onError: () => {
      setTagImportProgress(null);
    },
  });

  const handleTagFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setTagImportResult(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      e.target.value = "";
      importTagsMutation.mutate(ev.target?.result as string);
    };
    reader.onerror = () => {
      e.target.value = "";
      importTagsMutation.reset();
    };
    reader.readAsText(file, "utf-8");
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8" data-testid="diagnostics-loading">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">Analisando links...</span>
      </div>
    );
  }

  if (!diagnostics) return null;

  const healthPercent = diagnostics.totalLinks > 0
    ? Math.round((diagnostics.healthyLinks / diagnostics.totalLinks) * 100)
    : 0;

  const enrichProgress = enrichStatus?.running && enrichStatus.total > 0
    ? Math.round((enrichStatus.processed / enrichStatus.total) * 100)
    : 0;

  const sortedCategories = Object.entries(diagnostics.categories).sort(([a], [b]) => {
    const pa = categoryConfig[a]?.priority ?? 99;
    const pb = categoryConfig[b]?.priority ?? 99;
    return pa - pb;
  });

  return (
    <div className="space-y-6" data-testid="link-diagnostics-tab">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold" data-testid="diagnostics-title">Diagnóstico de Links</h2>
          <p className="text-sm text-muted-foreground">
            Análise de {diagnostics.totalLinks} links cadastrados
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="btn-refresh-diagnostics">
            <RefreshCw className="h-4 w-4 mr-1" /> Atualizar
          </Button>
          <Button
            size="sm"
            onClick={() => enrichMutation.mutate("discover_all")}
            disabled={enrichStatus?.running || enrichMutation.isPending}
            data-testid="btn-enrich-all"
          >
            {enrichStatus?.running ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Play className="h-4 w-4 mr-1" />
            )}
            Enriquecer Tudo
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => aiTriageMutation.mutate("offline")}
            disabled={aiTriageMutation.isPending}
            data-testid="btn-ai-triage-offline"
            title="Envia todos os links offline para a fila do Analista IA"
          >
            <Bot className="h-4 w-4 mr-1" />
            Triagem IA (offline)
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => aiTriageMutation.mutate("degraded")}
            disabled={aiTriageMutation.isPending}
            data-testid="btn-ai-triage-degraded"
            title="Envia links degradados para a fila do Analista IA"
          >
            <Bot className="h-4 w-4 mr-1" />
            Triagem IA (degradados)
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card data-testid="card-total-links">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Activity className="h-8 w-8 text-blue-500" />
              <div>
                <p className="text-2xl font-bold">{diagnostics.totalLinks}</p>
                <p className="text-sm text-muted-foreground">Links cadastrados</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="card-healthy-links">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-8 w-8 text-green-500" />
              <div>
                <p className="text-2xl font-bold">{diagnostics.healthyLinks}</p>
                <p className="text-sm text-muted-foreground">Links operacionais ({healthPercent}%)</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="card-issues">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-8 w-8 text-amber-500" />
              <div>
                <p className="text-2xl font-bold">{diagnostics.totalLinks - diagnostics.healthyLinks}</p>
                <p className="text-sm text-muted-foreground">Links incompletos</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {diagnostics.contractStatusSummary && (diagnostics.contractStatusSummary.blocked > 0 || diagnostics.contractStatusSummary.cancelled > 0 || diagnostics.contractStatusSummary.deleted > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card data-testid="card-contract-active">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-500" />
                <div>
                  <p className="text-lg font-bold">{diagnostics.contractStatusSummary.active}</p>
                  <p className="text-xs text-muted-foreground">Contratos Ativos</p>
                </div>
              </div>
            </CardContent>
          </Card>
          {diagnostics.contractStatusSummary.blocked > 0 && (
            <Card className="border-orange-500/30" data-testid="card-contract-blocked">
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center gap-2">
                  <Ban className="h-5 w-5 text-orange-500" />
                  <div>
                    <p className="text-lg font-bold text-orange-600 dark:text-orange-400">{diagnostics.contractStatusSummary.blocked}</p>
                    <p className="text-xs text-muted-foreground">Contratos Bloqueados</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
          {diagnostics.contractStatusSummary.cancelled > 0 && (
            <Card className="border-gray-500/30" data-testid="card-contract-cancelled">
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center gap-2">
                  <XCircle className="h-5 w-5 text-gray-500" />
                  <div>
                    <p className="text-lg font-bold text-gray-600 dark:text-gray-400">{diagnostics.contractStatusSummary.cancelled}</p>
                    <p className="text-xs text-muted-foreground">Contratos Cancelados</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
          {diagnostics.contractStatusSummary.deleted > 0 && (
            <Card className="border-red-500/30" data-testid="card-contract-deleted">
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center gap-2">
                  <Trash2 className="h-5 w-5 text-red-500" />
                  <div>
                    <p className="text-lg font-bold text-red-600 dark:text-red-400">{diagnostics.contractStatusSummary.deleted}</p>
                    <p className="text-xs text-muted-foreground">Links Excluídos</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {enrichStatus?.running && (
        <Card className="border-blue-200 dark:border-blue-800" data-testid="card-enrich-progress">
          <CardContent className="pt-6">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                  <span className="font-medium">
                    {actionLabels[enrichStatus.action] || enrichStatus.action}
                  </span>
                </div>
                <span className="text-sm text-muted-foreground">
                  {enrichStatus.processed}/{enrichStatus.total} ({enrichProgress}%)
                </span>
              </div>
              <Progress value={enrichProgress} className="h-2" />
              <div className="flex gap-4 text-sm">
                <span className="text-green-600">
                  <CheckCircle2 className="h-3 w-3 inline mr-1" />
                  {enrichStatus.success} atualizados
                </span>
                <span className="text-muted-foreground">
                  {enrichStatus.skipped} sem dados
                </span>
                {enrichStatus.failed > 0 && (
                  <span className="text-red-600">
                    <XCircle className="h-3 w-3 inline mr-1" />
                    {enrichStatus.failed} erros
                  </span>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {!enrichStatus?.running && enrichStatus && enrichStatus.total > 0 && enrichStatus.startedAt > 0 && (
        <Alert data-testid="alert-enrich-complete">
          <CheckCircle2 className="h-4 w-4" />
          <AlertDescription>
            Último enriquecimento: {enrichStatus.success} atualizados, {enrichStatus.skipped} sem dados disponíveis.
            {enrichStatus.failed > 0 && (
              <span className="text-red-500 ml-1">{enrichStatus.failed} erros.</span>
            )}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {sortedCategories.map(([key, cat]) => {
          const config = categoryConfig[key];
          if (!config) return null;
          const Icon = config.icon;
          const isSelected = selectedCategory === key;
          const enrichAction = cat.enrichAction;

          return (
            <Card
              key={key}
              className={`cursor-pointer transition-all hover:shadow-md ${
                isSelected ? "ring-2 ring-primary" : ""
              } ${cat.count === 0 ? "opacity-60" : ""}`}
              onClick={() => setSelectedCategory(isSelected ? null : key)}
              data-testid={`card-category-${key}`}
            >
              <CardContent className="pt-4 pb-3">
                <div className="flex items-start justify-between mb-2">
                  <Icon className={`h-5 w-5 ${config.color}`} />
                  <Badge variant={cat.count === 0 ? "secondary" : "destructive"} className="text-xs">
                    {cat.count}
                  </Badge>
                </div>
                <p className="text-sm font-medium leading-tight">{cat.label}</p>
                {cat.clientCount !== undefined && cat.clientCount > 0 && (
                  <p className="text-xs text-muted-foreground mt-1">{cat.clientCount} clientes</p>
                )}
                {key === 'missingOzmapData' && cat.withTag !== undefined && (
                  <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
                    <p className="text-green-600 dark:text-green-400">✓ {cat.withData ?? 0} com dados sincronizados</p>
                    {(cat.noRoute ?? 0) > 0 && (
                      <p className="text-yellow-600 dark:text-yellow-400">⚠ {cat.noRoute} sem rota de fibra</p>
                    )}
                    {(cat.notFound ?? 0) > 0 && (
                      <p className="text-red-600 dark:text-red-400">✗ {cat.notFound} etiqueta não encontrada</p>
                    )}
                    {cat.withoutTag! > 0 && (
                      <p className="text-orange-600 dark:text-orange-400">○ {cat.withoutTag} sem etiqueta</p>
                    )}
                    <p>{cat.count} sem dados OZmap (de {cat.withTag} com etiqueta)</p>
                  </div>
                )}
                {enrichAction && cat.count > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2 w-full text-xs h-7"
                    disabled={enrichStatus?.running}
                    onClick={(e) => {
                      e.stopPropagation();
                      enrichMutation.mutate(enrichAction);
                    }}
                    data-testid={`btn-enrich-${key}`}
                  >
                    {config.enrichLabel || "Enriquecer"}
                  </Button>
                )}
                {key === "missingOzmapData" && (
                  <div className="mt-1 flex flex-col gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full text-xs h-7 text-muted-foreground hover:text-foreground"
                      disabled={downloadingMissing}
                      onClick={(e) => {
                        e.stopPropagation();
                        downloadOzmapMissing();
                      }}
                      data-testid="btn-ozmap-missing-csv"
                    >
                      {downloadingMissing ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <FileDown className="h-3 w-3 mr-1" />}
                      {downloadingMissing ? "Gerando..." : "Sem dados OZmap (.csv)"}
                    </Button>
                    {(cat.noRoute ?? 0) > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full text-xs h-7 text-yellow-600 dark:text-yellow-400 hover:text-yellow-700"
                        disabled={downloadingNoRoute}
                        onClick={(e) => {
                          e.stopPropagation();
                          downloadOzmapNoRoute();
                        }}
                        data-testid="btn-ozmap-no-route-csv"
                      >
                        {downloadingNoRoute ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <FileDown className="h-3 w-3 mr-1" />}
                        {downloadingNoRoute ? "Gerando..." : "Sem rota de fibra (.csv)"}
                      </Button>
                    )}
                    {(cat.notFound ?? 0) > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full text-xs h-7 text-red-600 dark:text-red-400 hover:text-red-700"
                        disabled={downloadingNotFound}
                        onClick={(e) => {
                          e.stopPropagation();
                          downloadOzmapNotFound();
                        }}
                        data-testid="btn-ozmap-not-found-csv"
                      >
                        {downloadingNotFound ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <FileDown className="h-3 w-3 mr-1" />}
                        {downloadingNotFound ? "Gerando..." : "Etiqueta não encontrada (.csv)"}
                      </Button>
                    )}
                    {(cat.withoutTag ?? 0) > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full text-xs h-7 text-orange-600 dark:text-orange-400 hover:text-orange-700"
                        disabled={downloadingNoTag}
                        onClick={(e) => {
                          e.stopPropagation();
                          downloadOzmapNoTag();
                        }}
                        data-testid="btn-ozmap-no-tag-csv"
                      >
                        {downloadingNoTag ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <FileDown className="h-3 w-3 mr-1" />}
                        {downloadingNoTag ? "Gerando..." : "Sem etiqueta (.csv)"}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full text-xs h-7 text-muted-foreground hover:text-foreground"
                      disabled={downloadingCsv}
                      onClick={(e) => {
                        e.stopPropagation();
                        downloadOzmapDivergences();
                      }}
                      data-testid="btn-ozmap-divergences-csv"
                    >
                      {downloadingCsv ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <FileDown className="h-3 w-3 mr-1" />}
                      {downloadingCsv ? "Verificando..." : "Divergências (.csv)"}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Mapeamento de Etiquetas Voalle — Importação CSV */}
      <Card data-testid="card-voalle-service-tags">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Database className="h-4 w-4 text-blue-500" />
            Mapeamento de Etiquetas Voalle
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Importa o CSV exportado do banco Voalle (<code>contract_service_tags</code>) com o mapeamento
            de IDs numéricos para códigos OZmap reais. Usado pela reconciliação para resolver conexões excluídas.
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3 mb-3">
            <div className="flex-1 text-xs text-muted-foreground">
              {tagStats ? (
                <>
                  <span className="font-medium text-foreground">{tagStats.count.toLocaleString("pt-BR")}</span> etiquetas importadas
                  {tagStats.lastImportedAt && (
                    <span className="ml-2 text-muted-foreground/70">
                      — última importação {new Date(tagStats.lastImportedAt).toLocaleDateString("pt-BR")}
                    </span>
                  )}
                </>
              ) : (
                <span>Nenhuma etiqueta importada</span>
              )}
            </div>
            <input
              ref={tagFileRef}
              type="file"
              accept=".csv,text/csv,text/plain"
              className="hidden"
              onChange={handleTagFileSelect}
              data-testid="input-service-tags-csv"
            />
            <Button
              size="sm"
              variant="outline"
              disabled={importTagsMutation.isPending}
              onClick={() => { setTagImportResult(null); tagFileRef.current?.click(); }}
              data-testid="btn-import-service-tags"
            >
              {importTagsMutation.isPending
                ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    {tagImportProgress ? `Lote ${tagImportProgress.chunk}/${tagImportProgress.total}...` : "Processando..."}
                  </>
                : <><UploadCloud className="h-3 w-3 mr-1" />Importar CSV</>
              }
            </Button>
          </div>

          {importTagsMutation.isError && (
            <Alert variant="destructive" className="mb-2">
              <AlertDescription className="text-xs">
                {importTagsMutation.error instanceof Error ? importTagsMutation.error.message : "Erro desconhecido"}
              </AlertDescription>
            </Alert>
          )}

          {tagImportResult && (
            <Alert className="border-green-500 bg-green-50 dark:bg-green-950/20 mb-2">
              <AlertDescription className="text-xs text-green-700 dark:text-green-300">
                <CheckCircle2 className="h-3 w-3 inline mr-1" />
                Importação concluída: <strong>{tagImportResult.imported.toLocaleString("pt-BR")}</strong> etiquetas gravadas
                {tagImportResult.skipped > 0 && `, ${tagImportResult.skipped} ignoradas`}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Reconciliação Voalle ↔ OZmap */}
      <Card data-testid="card-voalle-ozmap-reconcile">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Link2 className="h-4 w-4 text-emerald-500" />
            Reconciliação Voalle ↔ OZmap
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Reconecta links cuja conexão foi deletada e recriada no Voalle sem código de integração OZmap.
            Busca pelo PPPoE/serial, localiza o cliente no OZmap e vincula automaticamente.
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2 mb-3">
            <Button
              size="sm"
              variant="outline"
              disabled={reconcileMutation.isPending || reconcileStatus?.running}
              onClick={() => reconcileMutation.mutate({ dryRun: true })}
              data-testid="btn-reconcile-dry-run"
            >
              {(reconcileMutation.isPending || reconcileStatus?.running) ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1" />}
              Simular (dry run)
            </Button>
            <Button
              size="sm"
              disabled={reconcileMutation.isPending || reconcileStatus?.running}
              onClick={() => {
                if (confirm("Isso vai vincular conexões Voalle → OZmap para todos os links afetados. Continuar?")) {
                  reconcileMutation.mutate({ dryRun: false });
                }
              }}
              data-testid="btn-reconcile-execute"
            >
              {(reconcileMutation.isPending || reconcileStatus?.running) ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Link2 className="h-3 w-3 mr-1" />}
              Executar reconciliação
            </Button>
          </div>

          {reconcileMutation.isError && (
            <Alert variant="destructive" className="mb-2">
              <AlertDescription className="text-xs">
                {reconcileMutation.error instanceof Error ? reconcileMutation.error.message : "Erro desconhecido"}
              </AlertDescription>
            </Alert>
          )}

          {/* Progresso em tempo real */}
          {reconcileStatus?.running && (
            <div className="space-y-2 mb-2" data-testid="reconcile-progress">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>
                  {reconcileStatus.phase === "preflight_ozmap" && "Verificando conectividade OZmap..."}
                  {reconcileStatus.phase === "fetching_voalle" && "Buscando conexões Voalle (ativas + excluídas)..."}
                  {reconcileStatus.phase === "fetching_ozmap" && "Baixando clientes OZmap em massa..."}
                  {reconcileStatus.phase === "processing" && `Processando ${reconcileStatus.processed}/${reconcileStatus.total} links...`}
                </span>
              </div>
              {reconcileStatus.total > 0 && (
                <Progress value={Math.round((reconcileStatus.processed / reconcileStatus.total) * 100)} className="h-1.5" />
              )}
            </div>
          )}

          {/* Erro no background */}
          {reconcileStatus?.phase === "error" && reconcileStatus.errorMessage && (
            <Alert variant="destructive" className="mb-2">
              <AlertDescription className="text-xs">{reconcileStatus.errorMessage}</AlertDescription>
            </Alert>
          )}

          {/* Resultado quando concluído */}
          {reconcileStatus && reconcileStatus.phase === "done" && reconcileStatus.finishedAt > 0 && (
            <div className="space-y-2">
              {reconcileStatus.dryRun && (
                <Alert className="border-yellow-500 bg-yellow-50 dark:bg-yellow-950/20">
                  <AlertDescription className="text-xs text-yellow-700 dark:text-yellow-300">
                    Simulação — nenhuma alteração foi feita
                  </AlertDescription>
                </Alert>
              )}
              <div className="flex gap-3 flex-wrap text-xs">
                {reconcileStatus.success > 0 && <span className="text-green-600 dark:text-green-400">✓ {reconcileStatus.success} vinculados</span>}
                {reconcileStatus.already_linked > 0 && <span className="text-blue-600 dark:text-blue-400">◉ {reconcileStatus.already_linked} já vinculados</span>}
                {reconcileStatus.ozmap_not_found > 0 && <span className="text-orange-600 dark:text-orange-400">⚠ {reconcileStatus.ozmap_not_found} sem cliente OZmap</span>}
                {reconcileStatus.skip > 0 && <span className="text-muted-foreground">○ {reconcileStatus.skip} ignorados</span>}
                {reconcileStatus.vinculate_failed > 0 && <span className="text-red-500">✗ {reconcileStatus.vinculate_failed} falhas</span>}
                {reconcileStatus.error > 0 && <span className="text-red-600 dark:text-red-400">✗ {reconcileStatus.error} erros</span>}
              </div>
              {reconcileStatus.results.length > 0 && (
                <div className="max-h-64 overflow-y-auto border rounded">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm">
                      <tr>
                        <th className="text-left px-2 py-1 font-medium text-muted-foreground w-4"></th>
                        <th className="text-left px-2 py-1 font-medium text-muted-foreground">Link</th>
                        <th className="text-left px-2 py-1 font-medium text-muted-foreground">Etiqueta link</th>
                        <th className="text-left px-2 py-1 font-medium text-muted-foreground">Etiqueta antiga</th>
                        <th className="text-left px-2 py-1 font-medium text-muted-foreground">Etiqueta OZmap</th>
                        <th className="text-left px-2 py-1 font-medium text-muted-foreground">Detalhe</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reconcileStatus.results.filter(r => r.status !== "skip").map((r, i) => (
                        <tr key={i} className="border-t border-border/40 hover:bg-muted/30" data-testid={`reconcile-result-${r.linkId}`}>
                          <td className="px-2 py-1">
                            <span className={
                              r.status === "success" ? "text-green-600 dark:text-green-400" :
                              r.status === "already_linked" ? "text-blue-600 dark:text-blue-400" :
                              r.status === "dry_run" ? "text-yellow-600 dark:text-yellow-400" :
                              r.status === "ozmap_not_found" ? "text-orange-500" :
                              "text-red-500"
                            }>
                              {r.status === "success" ? "✓" : r.status === "already_linked" ? "◉" : r.status === "dry_run" ? "~" : r.status === "ozmap_not_found" ? "⚠" : "✗"}
                            </span>
                          </td>
                          <td className="px-2 py-1 font-semibold text-foreground max-w-[140px] truncate" title={r.linkName}>{r.linkName}</td>
                          <td className="px-2 py-1 font-mono text-blue-600 dark:text-blue-400">{r.linkTag || <span className="text-muted-foreground">—</span>}</td>
                          <td className="px-2 py-1 font-mono text-purple-600 dark:text-purple-400">{r.oldTag || <span className="text-muted-foreground">—</span>}</td>
                          <td className="px-2 py-1 font-mono text-green-600 dark:text-green-400">{r.ozmapFoundCode || <span className="text-muted-foreground">—</span>}</td>
                          <td className="px-2 py-1 text-muted-foreground max-w-[240px] truncate" title={r.detail}>{r.detail}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {enrichStatus && enrichStatus.errors.length > 0 && !enrichStatus.running && (
        <Card data-testid="card-errors">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <XCircle className="h-4 w-4 text-red-500" />
              Erros encontrados ({enrichStatus.errors.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-48 overflow-y-auto space-y-1">
              {enrichStatus.errors.slice(0, 30).map((err, i) => (
                <p key={i} className="text-xs text-muted-foreground font-mono" data-testid={`error-item-${i}`}>
                  {err}
                </p>
              ))}
              {enrichStatus.errors.length > 30 && (
                <p className="text-xs text-muted-foreground">
                  ... e mais {enrichStatus.errors.length - 30} erros
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

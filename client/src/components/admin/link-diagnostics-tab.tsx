import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Wifi,
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
} from "lucide-react";

interface DiagnosticCategory {
  count: number;
  ids: number[];
  label: string;
  enrichable?: number;
}

interface DiagnosticsData {
  totalLinks: number;
  healthyLinks: number;
  categories: {
    missingIp: DiagnosticCategory;
    missingInterface: DiagnosticCategory;
    missingConcentrator: DiagnosticCategory;
    missingPppoeUser: DiagnosticCategory;
    missingSnmpProfile: DiagnosticCategory;
    missingVoalleTag: DiagnosticCategory;
    missingOptical: DiagnosticCategory;
    missingCoordinates: DiagnosticCategory;
  };
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

const categoryConfig: Record<string, { icon: typeof Wifi; color: string; enrichAction?: string; enrichLabel?: string }> = {
  missingIp: { icon: WifiOff, color: "text-red-500", enrichAction: "discover_ips", enrichLabel: "Buscar IPs via RADIUS" },
  missingInterface: { icon: Network, color: "text-orange-500" },
  missingConcentrator: { icon: Router, color: "text-amber-500" },
  missingPppoeUser: { icon: User, color: "text-yellow-500" },
  missingSnmpProfile: { icon: Shield, color: "text-blue-500" },
  missingVoalleTag: { icon: Tag, color: "text-purple-500" },
  missingOptical: { icon: Zap, color: "text-teal-500" },
  missingCoordinates: { icon: MapPin, color: "text-gray-500" },
};

const actionLabels: Record<string, string> = {
  discover_ips: "Buscando IPs via RADIUS",
  discover_mac: "Buscando MACs via RADIUS",
  discover_voalle: "Buscando dados no Voalle",
  discover_all: "Enriquecimento completo",
};

export function LinkDiagnosticsTab() {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

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

  const enrichMutation = useMutation({
    mutationFn: async (action: string) => {
      const res = await apiRequest("POST", "/api/admin/links/enrich", { action });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/links/enrich/status"] });
    },
  });

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
                <p className="text-sm text-muted-foreground">Links completos ({healthPercent}%)</p>
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
                <p className="text-sm text-muted-foreground">Links com problemas</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

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

      {!enrichStatus?.running && enrichStatus?.total > 0 && enrichStatus.startedAt > 0 && (
        <Alert data-testid="alert-enrich-complete">
          <CheckCircle2 className="h-4 w-4" />
          <AlertDescription>
            Último enriquecimento concluído: {enrichStatus.success} atualizados, {enrichStatus.skipped} sem dados no RADIUS/Voalle.
            {enrichStatus.failed > 0 && (
              <span className="text-red-500 ml-1">
                {enrichStatus.failed} erros
              </span>
            )}
            {enrichStatus.errors.length > 0 && (
              <span className="text-red-500 ml-1">
                ({enrichStatus.errors.length} detalhes)
              </span>
            )}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {Object.entries(diagnostics.categories).map(([key, cat]) => {
          const config = categoryConfig[key];
          if (!config) return null;
          const Icon = config.icon;
          const isSelected = selectedCategory === key;

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
                {config.enrichAction && cat.count > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2 w-full text-xs h-7"
                    disabled={enrichStatus?.running}
                    onClick={(e) => {
                      e.stopPropagation();
                      enrichMutation.mutate(config.enrichAction!);
                    }}
                    data-testid={`btn-enrich-${key}`}
                  >
                    {config.enrichLabel || "Enriquecer"}
                  </Button>
                )}
                {key === "missingVoalleTag" && cat.count > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2 w-full text-xs h-7"
                    disabled={enrichStatus?.running}
                    onClick={(e) => {
                      e.stopPropagation();
                      enrichMutation.mutate("discover_voalle");
                    }}
                    data-testid="btn-enrich-voalle"
                  >
                    Buscar dados Voalle
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

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
              {enrichStatus.errors.slice(0, 20).map((err, i) => (
                <p key={i} className="text-xs text-muted-foreground font-mono" data-testid={`error-item-${i}`}>
                  {err}
                </p>
              ))}
              {enrichStatus.errors.length > 20 && (
                <p className="text-xs text-muted-foreground">
                  ... e mais {enrichStatus.errors.length - 20} erros
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

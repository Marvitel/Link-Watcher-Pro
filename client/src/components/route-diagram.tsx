import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  Radio,
  Layers,
  Cable,
  Box,
  Split,
  HelpCircle,
  AlertTriangle,
  Info,
  RefreshCw,
} from "lucide-react";

interface RouteNode {
  kind: string;
  name: string;
  parentName?: string | null;
  distanceM?: number | null;
  segmentM?: number | null;
  attenuationDb?: number | null;
  lat?: number | null;
  lng?: number | null;
  slot?: number | null;
  port?: number | null;
  bandeja?: string | null;
  fiberLabel?: string | null;
  affectedAtThisPoint: number;
  divergesAfterCount: number;
  isConvergencePoint: boolean;
}

interface DiagramResponse {
  outageId: number;
  totalAffected: number;
  withRoute: number;
  withoutRoute: number;
  commonPath: RouteNode[];
  convergenceNode: RouteNode | null;
  inferredFromPeers: boolean;
  peersUsed: number;
  routeReachesOlt: boolean;
  convergenceIndex: number | null;
  probablePath?: Array<{
    kind: string;
    name: string;
    count: number;
    totalConsidered: number;
    percentage: number;
    onlinePassThrough: number;
    onlineConsidered: number;
    verdict: "downstream_cut" | "likely_cut" | "upstream_or_here" | "unknown";
  }>;
}

interface Props {
  outageId: number | null;
  open: boolean;
  scope?: string;
}

const KIND_META: Record<string, { label: string; Icon: typeof Radio; dotClass: string; iconClass: string }> = {
  olt:      { label: "OLT",      Icon: Radio,      dotClass: "bg-rose-500 border-rose-600",     iconClass: "text-white" },
  dio:      { label: "DIO",      Icon: Layers,     dotClass: "bg-sky-500 border-sky-600",       iconClass: "text-white" },
  cable:    { label: "Cabo",     Icon: Cable,      dotClass: "bg-amber-500 border-amber-600",   iconClass: "text-white" },
  box:      { label: "Caixa",    Icon: Box,        dotClass: "bg-emerald-500 border-emerald-600", iconClass: "text-white" },
  ceo:      { label: "CEO",      Icon: Box,        dotClass: "bg-emerald-500 border-emerald-600", iconClass: "text-white" },
  cto:      { label: "CTO",      Icon: Box,        dotClass: "bg-violet-500 border-violet-600", iconClass: "text-white" },
  splitter: { label: "Splitter", Icon: Split,      dotClass: "bg-violet-500 border-violet-600", iconClass: "text-white" },
  unknown:  { label: "—",        Icon: HelpCircle, dotClass: "bg-muted border-border",          iconClass: "text-muted-foreground" },
};

function meta(kind: string) {
  return KIND_META[kind] || KIND_META.unknown;
}

function fmtDistance(m: number | null | undefined): string {
  if (m == null) return "—";
  if (m >= 1000) return `${(m / 1000).toFixed(2)} km`;
  return `${Math.round(m)} m`;
}

function nodeSubtitle(node: RouteNode): string {
  const m = meta(node.kind);
  if (node.kind === "olt" && (node.slot != null || node.port != null)) {
    return `OLT · Slot ${node.slot ?? "?"} / Porta ${node.port ?? "?"}`;
  }
  if (node.kind === "dio" && node.bandeja) {
    return `DIO · ${node.bandeja}`;
  }
  if (node.kind === "cable") {
    const segs: string[] = [];
    if (node.segmentM != null) segs.push(`${Math.round(node.segmentM)} m`);
    if (node.attenuationDb != null) segs.push(`${node.attenuationDb.toFixed(2)} dB`);
    return segs.length > 0 ? `Cabo · ${segs.join(" · ")}` : "Cabo";
  }
  return m.label;
}

export function RouteDiagram({ outageId, open, scope }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [syncing, setSyncing] = useState(false);

  const { data, isLoading } = useQuery<DiagramResponse>({
    queryKey: ["/api/massive-outages", outageId, "route-diagram"],
    enabled: open && outageId !== null,
    refetchInterval: 60_000,
  });

  async function handleSync() {
    if (outageId == null) return;
    setSyncing(true);
    try {
      const res = await apiRequest("POST", `/api/massive-outages/${outageId}/sync-routes`);
      const json = await res.json();
      const okCount = (json.affectedSynced || 0) + (json.peersSynced || 0);
      if (okCount === 0 && json.failed > 0) {
        const reasons = json.failureReasons || {};
        const reasonList = Object.entries(reasons)
          .map(([r, n]) => `${r} (${n})`)
          .join(", ");
        toast({
          title: "Nada sincronizado",
          description: `${json.failed} link(s) falharam. Motivos: ${reasonList || "desconhecido"}`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Sincronização concluída",
          description: `${json.affectedSynced} afetado(s) + ${json.peersSynced} vizinho(s) sincronizados${
            json.failed > 0 ? ` · ${json.failed} falha(s)` : ""
          }`,
        });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/massive-outages", outageId, "route-diagram"] });
    } catch (err: any) {
      toast({
        title: "Falha na sincronização",
        description: err?.message || "Erro desconhecido",
        variant: "destructive",
      });
    } finally {
      setSyncing(false);
    }
  }

  if (isLoading || !data) {
    return (
      <div className="space-y-2" data-testid="route-diagram-loading">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (data.commonPath.length === 0) {
    // Caminho provável por frequência: mesmo sem prefixo estrito, dá pra
    // ranquear quais CEOs/CTOs aparecem na rota da maioria dos afetados.
    const ranked = data.probablePath ?? [];
    if (ranked.length > 0) {
      return (
        <div className="rounded-md border p-4 text-sm space-y-3" data-testid="route-diagram-probable">
          <div className="space-y-1">
            <p className="font-medium">
              Pontos prováveis ranqueados por frequência
            </p>
            <p className="text-xs text-muted-foreground">
              {ranked[0].totalConsidered} rota(s) OZmap analisada(s). Cada item mostra
              em que % das rotas aquele elemento aparece — o topo é o suspeito mais
              forte.
            </p>
          </div>
          {ranked[0].onlineConsidered > 0 && (
            <div className="rounded-md border border-emerald-300 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-950/20 p-2 text-xs">
              Validação cruzada: {ranked[0].onlineConsidered} cliente(s) ONLINE da
              mesma OLT consultados. Quando algum online passa por um ponto, o
              rompimento é <strong>a jusante</strong> dele.
            </div>
          )}
          <ul className="space-y-1.5" data-testid="probable-path-list">
            {ranked.map((p, idx) => {
              const pct = Math.round(p.percentage * 100);
              const verdictStyles =
                p.verdict === "likely_cut"
                  ? {
                      box: "border-destructive bg-destructive/5",
                      barClass: "h-full bg-destructive",
                      label: "🎯 PROVÁVEL PONTO DE CORTE",
                      labelClass: "text-destructive font-bold",
                    }
                  : p.verdict === "downstream_cut"
                  ? {
                      box: "border-emerald-300 dark:border-emerald-800 bg-emerald-50/40 dark:bg-emerald-950/20 opacity-80",
                      barClass: "h-full bg-emerald-500",
                      label: `✅ ${p.onlinePassThrough} online passa — corte é a jusante`,
                      labelClass: "text-emerald-700 dark:text-emerald-400",
                    }
                  : p.verdict === "upstream_or_here"
                  ? {
                      box: "border-amber-300 dark:border-amber-800 bg-amber-50/40 dark:bg-amber-950/20",
                      barClass: "h-full bg-amber-500",
                      label: "⚠️ sem online passando — pode estar aqui ou a montante",
                      labelClass: "text-amber-700 dark:text-amber-400",
                    }
                  : {
                      box: "border",
                      barClass: pct >= 80 ? "h-full bg-destructive" : "h-full bg-amber-500",
                      label: null,
                      labelClass: "",
                    };
              return (
                <li
                  key={`${p.kind}|${p.name}`}
                  className={`rounded-md border p-2 ${verdictStyles.box}`}
                  data-testid={`probable-path-item-${idx}`}
                >
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs text-muted-foreground tabular-nums w-6 text-right">
                        {idx + 1}.
                      </span>
                      <Badge variant="outline" className="text-[10px] uppercase shrink-0">
                        {p.kind}
                      </Badge>
                      <span className="truncate font-medium">{p.name}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="h-1.5 w-24 rounded-full bg-muted overflow-hidden">
                        <div className={verdictStyles.barClass} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs tabular-nums w-16 text-right text-muted-foreground">
                        {pct}% ({p.count}/{p.totalConsidered})
                      </span>
                    </div>
                  </div>
                  {verdictStyles.label && (
                    <div
                      className={`mt-1 ml-9 text-[11px] ${verdictStyles.labelClass}`}
                      data-testid={`probable-path-verdict-${idx}`}
                    >
                      {verdictStyles.label}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {ranked[0].onlineConsidered === 0 && (
            <p className="text-[11px] text-muted-foreground">
              Sem clientes online da mesma OLT com rota OZmap pra validar — sincronize as
              rotas pra liberar a validação cruzada e identificar o ponto exato.
            </p>
          )}
        </div>
      );
    }
    // Fallback final: nem prefixo nem ranking → mensagens originais
    if (scope === "olt") {
      return (
        <div
          className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50/40 dark:bg-amber-950/20 p-4 text-sm space-y-2"
          data-testid="route-diagram-olt"
        >
          <p className="font-medium text-amber-900 dark:text-amber-200">
            Queda no nível da OLT — sem rotas OZmap suficientes para ranquear pontos.
          </p>
          <p className="text-muted-foreground text-xs">
            Sincronize as rotas dos afetados pra liberar a análise por frequência. A
            causa provável está na própria OLT (energia, placa, uplink) ou no backbone
            até ela.
          </p>
        </div>
      );
    }
    return (
      <div
        className="rounded-md border border-dashed p-4 text-sm text-muted-foreground space-y-3"
        data-testid="route-diagram-empty"
      >
        <p>
          {data.withRoute === 0 ? (
            <>
              Nenhum dos {data.totalAffected} link(s) afetado(s) tem rota OZmap sincronizada
              — e não foi possível inferir a partir dos vizinhos da PON/OLT.
            </>
          ) : data.withRoute === 1 ? (
            <>
              Apenas 1 link tem rota OZmap sincronizada — preciso de pelo menos 2 rotas
              para identificar onde os caminhos convergem. Sincronize mais links abaixo.
            </>
          ) : (
            <>
              As rotas dos links afetados não compartilham um trecho comum identificável.
              ({data.withRoute}/{data.totalAffected} com rota OZmap)
            </>
          )}
        </p>
        <Button
          size="sm"
          variant="default"
          onClick={handleSync}
          disabled={syncing}
          data-testid="button-sync-routes-now"
        >
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${syncing ? "animate-spin" : ""}`} />
          {syncing ? "Sincronizando..." : "Sincronizar rotas agora"}
        </Button>
        <p className="text-xs">
          Vai puxar a rota OZmap dos links afetados + até 30 vizinhos da mesma PON/OLT
          (pode levar alguns segundos).
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="route-diagram">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-sm font-semibold">Caminho da fibra até o ponto provável</h3>
        <span className="text-xs text-muted-foreground" data-testid="text-route-coverage">
          {data.inferredFromPeers
            ? `Inferido a partir de ${data.peersUsed} vizinho(s) na mesma PON/OLT`
            : `${data.withRoute}/${data.totalAffected} links com rota`}
        </span>
      </div>

      {data.inferredFromPeers && (
        <div className="flex items-start gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            Os links afetados ainda não têm rota OZmap sincronizada. Este caminho foi
            reconstruído a partir das rotas de outros clientes ativos na mesma PON/OLT —
            todos compartilham a infra até a última caixa comum.
          </span>
        </div>
      )}

      {!data.routeReachesOlt && (
        <div
          className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 px-3 py-2 text-xs"
          data-testid="banner-route-incomplete"
        >
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <span className="text-amber-900 dark:text-amber-200">
            <strong>Rota OZmap incompleta</strong> — não inclui o trecho até a OLT/switch.
            O ponto provável marcado abaixo é o último elemento comum CONHECIDO; o rompimento
            real pode estar antes, no backbone não mapeado.
          </span>
        </div>
      )}

      {/* Timeline vertical */}
      <ol className="relative" data-testid="route-timeline">
        {data.commonPath.map((node, idx) => {
          const m = meta(node.kind);
          const Icon = m.Icon;
          const isLast = idx === data.commonPath.length - 1;
          const isConvergence = node.isConvergencePoint;

          return (
            <li
              key={`${node.kind}-${node.name}-${idx}`}
              className="relative pl-12 pb-5 last:pb-0"
              data-testid={`timeline-node-${idx}`}
            >
              {/* Linha vertical conectando os dots */}
              {!isLast && (
                <span
                  className="absolute left-[18px] top-9 bottom-0 w-0.5 bg-border"
                  aria-hidden="true"
                />
              )}
              {/* Dot */}
              <span
                className={`absolute left-0 top-0 flex h-9 w-9 items-center justify-center rounded-full border-2 ${m.dotClass} ${
                  isConvergence ? "ring-4 ring-destructive/30" : ""
                }`}
                aria-hidden="true"
              >
                <Icon className={`h-4 w-4 ${m.iconClass}`} />
              </span>

              {/* Conteúdo */}
              <div
                className={`rounded-md border px-3 py-2 ${
                  isConvergence ? "bg-destructive/10 border-destructive/30" : "bg-card"
                }`}
              >
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className="font-medium text-sm break-words"
                        data-testid={`text-node-name-${idx}`}
                      >
                        {node.name || "—"}
                      </span>
                      {node.fiberLabel && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          {node.fiberLabel}
                        </Badge>
                      )}
                      {isConvergence && (
                        <Badge
                          variant="destructive"
                          className="text-[10px] px-1.5 py-0 flex items-center gap-1"
                          data-testid={`badge-convergence-${idx}`}
                        >
                          <AlertTriangle className="h-3 w-3" />
                          Ponto provável de rompimento
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {nodeSubtitle(node)}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Distância
                    </div>
                    <div
                      className="text-sm font-mono font-medium"
                      data-testid={`text-node-distance-${idx}`}
                    >
                      {fmtDistance(node.distanceM)}
                    </div>
                  </div>
                </div>
                {node.divergesAfterCount > 0 && !isConvergence && (
                  <div className="mt-1.5 text-[11px] text-muted-foreground">
                    ↳ {node.divergesAfterCount} ramificação(ões) saem do caminho comum aqui
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      <p className="text-xs text-muted-foreground">
        {data.routeReachesOlt
          ? "O caminho comum vai da OLT até o último elemento compartilhado. Após esse ponto, as rotas se ramificam para cada cliente."
          : "O caminho mostrado representa a parte CONHECIDA da rota (OZmap não tem o trecho até a OLT). O ponto provável é a última caixa/splitter compartilhado antes da ramificação."}
      </p>
    </div>
  );
}

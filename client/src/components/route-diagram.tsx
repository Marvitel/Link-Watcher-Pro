import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Radio,
  Layers,
  Cable,
  Box,
  Split,
  HelpCircle,
  AlertTriangle,
  Info,
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
}

interface Props {
  outageId: number | null;
  open: boolean;
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

export function RouteDiagram({ outageId, open }: Props) {
  const { data, isLoading } = useQuery<DiagramResponse>({
    queryKey: ["/api/massive-outages", outageId, "route-diagram"],
    enabled: open && outageId !== null,
    refetchInterval: 60_000,
  });

  if (isLoading || !data) {
    return (
      <div className="space-y-2" data-testid="route-diagram-loading">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (data.commonPath.length === 0) {
    return (
      <div
        className="rounded-md border border-dashed p-4 text-sm text-muted-foreground"
        data-testid="route-diagram-empty"
      >
        {data.withRoute === 0 ? (
          <>
            Nenhum dos {data.totalAffected} link(s) afetado(s) tem rota OZmap sincronizada ainda
            — e não foi possível inferir a partir dos vizinhos da PON/OLT.
            Aguarde a sincronização diária (04:00) ou dispare manualmente no painel admin.
          </>
        ) : (
          <>
            As rotas dos links afetados não compartilham um trecho comum identificável.
            ({data.withRoute}/{data.totalAffected} com rota OZmap)
          </>
        )}
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
        O caminho comum vai da OLT até o último elemento compartilhado. Após esse ponto,
        as rotas se ramificam para cada cliente.
      </p>
    </div>
  );
}

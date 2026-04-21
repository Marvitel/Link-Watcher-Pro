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
  ArrowDown,
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
}

interface Props {
  outageId: number | null;
  open: boolean;
}

const KIND_META: Record<string, { label: string; Icon: typeof Radio; color: string }> = {
  olt:      { label: "OLT",      Icon: Radio,       color: "text-rose-600 dark:text-rose-400" },
  dio:      { label: "DIO",      Icon: Layers,      color: "text-sky-600 dark:text-sky-400" },
  cable:    { label: "Cabo",     Icon: Cable,       color: "text-amber-600 dark:text-amber-500" },
  box:      { label: "Caixa",    Icon: Box,         color: "text-emerald-600 dark:text-emerald-400" },
  ceo:      { label: "CEO",      Icon: Box,         color: "text-emerald-600 dark:text-emerald-400" },
  cto:      { label: "CTO",      Icon: Box,         color: "text-violet-600 dark:text-violet-400" },
  splitter: { label: "Splitter", Icon: Split,       color: "text-violet-600 dark:text-violet-400" },
  unknown:  { label: "—",        Icon: HelpCircle,  color: "text-muted-foreground" },
};

function meta(kind: string) {
  return KIND_META[kind] || KIND_META.unknown;
}

function fmtDistance(m: number | null | undefined): string {
  if (m == null) return "—";
  if (m >= 1000) return `${(m / 1000).toFixed(2)} km`;
  return `${Math.round(m)} m`;
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
            Nenhum dos {data.totalAffected} link(s) afetado(s) tem rota OZmap sincronizada ainda.
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
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Diagrama da rota até o ponto provável</h3>
        <span className="text-xs text-muted-foreground" data-testid="text-route-coverage">
          {data.withRoute}/{data.totalAffected} links com rota
        </span>
      </div>

      <div className="rounded-md border bg-card overflow-hidden">
        {data.commonPath.map((node, idx) => {
          const m = meta(node.kind);
          const Icon = m.Icon;
          const isConvergence = node.isConvergencePoint;
          const isOlt = node.kind === "olt";
          const isCable = node.kind === "cable";

          // Subtítulo específico por tipo
          let subtitle = m.label;
          if (isOlt && (node.slot != null || node.port != null)) {
            subtitle = `OLT · Slot ${node.slot ?? "?"} / Porta ${node.port ?? "?"}`;
          } else if (node.kind === "dio" && node.bandeja) {
            subtitle = `DIO · ${node.bandeja}`;
          } else if (isCable) {
            const segs: string[] = [];
            if (node.segmentM != null) segs.push(`${Math.round(node.segmentM)} m`);
            if (node.attenuationDb != null) segs.push(`${node.attenuationDb.toFixed(2)} dB`);
            subtitle = segs.length > 0 ? `Cabo · ${segs.join(" · ")}` : "Cabo";
          }

          return (
            <div
              key={`${node.kind}-${node.name}-${idx}`}
              className={`flex items-center gap-3 px-3 py-2.5 border-b last:border-b-0 ${
                isConvergence ? "bg-destructive/10 border-destructive/30" : ""
              }`}
              data-testid={`route-node-${idx}`}
            >
              <div className={`flex h-8 w-8 items-center justify-center rounded-md bg-muted ${m.color} shrink-0`}>
                <Icon className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm truncate" data-testid={`text-node-name-${idx}`}>
                    {node.name || "—"}
                  </span>
                  {node.fiberLabel && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                      {node.fiberLabel}
                    </Badge>
                  )}
                  {isConvergence && (
                    <Badge variant="destructive" className="text-[10px] px-1.5 py-0 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      Ponto provável de rompimento
                    </Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">{subtitle}</div>
                {node.divergesAfterCount > 0 && !isConvergence && (
                  <div className="flex items-center gap-1 text-[11px] text-muted-foreground mt-0.5">
                    <ArrowDown className="h-3 w-3" />
                    {node.divergesAfterCount} link(s) deixam o caminho comum aqui
                  </div>
                )}
              </div>
              <div className="text-right shrink-0">
                <div className="text-xs text-muted-foreground">Distância</div>
                <div className="text-sm font-mono font-medium" data-testid={`text-node-distance-${idx}`}>
                  {fmtDistance(node.distanceM)}
                </div>
              </div>
              <div className="text-right shrink-0 min-w-[3.5rem]">
                <div className="text-xs text-muted-foreground">Afetados</div>
                <div
                  className={`text-sm font-mono font-medium ${
                    isConvergence ? "text-destructive" : ""
                  }`}
                  data-testid={`text-node-affected-${idx}`}
                >
                  {node.affectedAtThisPoint}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        O caminho comum vai da OLT até o último elemento compartilhado por todos os links afetados.
        Após esse ponto, as rotas se ramificam para cada cliente.
      </p>
    </div>
  );
}

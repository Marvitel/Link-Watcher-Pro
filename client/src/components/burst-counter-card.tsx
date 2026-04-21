import { useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, Zap } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

type BurstState = "normal" | "warning" | "burst" | "catastrophic";

interface BurstSnapshot {
  state: BurstState;
  newOfflineCount: number;
  windowMinutes: number;
  thresholds: { warn: number; burst: number; catastrophic: number };
  lastTriggeredAt: string | null;
  lastInvestigationAt: string | null;
  sparkline: { minute: string; count: number }[];
  lastInvestigation: {
    triggeredAt: string;
    newOfflineInWindow: number;
    topOlts: { olt: string; count: number }[];
    topPons: { pon: string; count: number }[];
    topCeos: { ceo: string; count: number }[];
    topSplitters: { splitter: string; count: number }[];
    withoutOzmapTopology: number;
    totalAffectedSampled: number;
  } | null;
}

const STATE_STYLES: Record<BurstState, { label: string; classes: string; icon: typeof Activity }> = {
  normal: {
    label: "Normal",
    classes: "border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30",
    icon: Activity,
  },
  warning: {
    label: "Atenção",
    classes: "border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30",
    icon: AlertTriangle,
  },
  burst: {
    label: "Surto de quedas",
    classes: "border-red-400 dark:border-red-700 bg-red-50 dark:bg-red-950/30",
    icon: Zap,
  },
  catastrophic: {
    label: "Catastrófico",
    classes: "border-red-600 dark:border-red-500 bg-red-100 dark:bg-red-950/50 ring-2 ring-red-500",
    icon: Zap,
  },
};

function Sparkline({ data, max }: { data: { minute: string; count: number }[]; max: number }) {
  if (data.length === 0) return null;
  const peak = Math.max(max, ...data.map((d) => d.count), 1);
  const w = 240;
  const h = 36;
  const step = w / Math.max(1, data.length - 1);
  const points = data
    .map((d, i) => {
      const x = i * step;
      const y = h - (d.count / peak) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={w} height={h} className="overflow-visible" data-testid="burst-sparkline">
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        points={points}
      />
      {data.map((d, i) => {
        if (d.count === 0) return null;
        const x = i * step;
        const y = h - (d.count / peak) * h;
        return <circle key={i} cx={x} cy={y} r={1.5} fill="currentColor" />;
      })}
    </svg>
  );
}

export function BurstCounterCard() {
  const { data, isLoading } = useQuery<BurstSnapshot>({
    queryKey: ["/api/admin/burst-counter"],
    refetchInterval: 30_000,
  });

  if (isLoading || !data) {
    return (
      <Card data-testid="card-burst-loading">
        <CardContent className="py-6 text-sm text-muted-foreground">Carregando contador de quedas…</CardContent>
      </Card>
    );
  }

  const style = STATE_STYLES[data.state];
  const Icon = style.icon;
  const isAlert = data.state === "burst" || data.state === "catastrophic";
  const inv = data.lastInvestigation;

  return (
    <Card className={`border-2 ${style.classes}`} data-testid={`card-burst-${data.state}`}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4" />
            <span>Contador de quedas</span>
            <Badge variant={isAlert ? "destructive" : "outline"} data-testid="badge-burst-state">
              {style.label}
            </Badge>
          </div>
          <span className="text-xs font-normal text-muted-foreground">
            janela de {data.windowMinutes} min
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="text-3xl font-bold tabular-nums" data-testid="text-burst-count">
              {data.newOfflineCount}
            </div>
            <div className="text-xs text-muted-foreground">
              novos links offline · gatilho em {data.thresholds.burst} · catastrófico em {data.thresholds.catastrophic}
            </div>
          </div>
          <div className="text-muted-foreground">
            <Sparkline data={data.sparkline} max={data.thresholds.burst} />
            <div className="text-[10px] text-right text-muted-foreground mt-1">últimos 60 min</div>
          </div>
        </div>

        {isAlert && inv && (
          <div className="rounded-md border bg-background/60 p-3 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold">Diagnóstico automático</span>
              <span className="text-muted-foreground">
                {format(new Date(inv.triggeredAt), "HH:mm", { locale: ptBR })}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {inv.topOlts.length > 0 && (
                <div data-testid="burst-top-olt">
                  <div className="text-muted-foreground">OLT mais afetada</div>
                  <div className="font-medium truncate">
                    {inv.topOlts[0].olt}{" "}
                    <span className="text-muted-foreground">({inv.topOlts[0].count})</span>
                  </div>
                </div>
              )}
              {inv.topPons.length > 0 && (
                <div data-testid="burst-top-pon">
                  <div className="text-muted-foreground">PON mais afetada</div>
                  <div className="font-medium truncate">
                    {inv.topPons[0].pon}{" "}
                    <span className="text-muted-foreground">({inv.topPons[0].count})</span>
                  </div>
                </div>
              )}
              {inv.topCeos.length > 0 && (
                <div data-testid="burst-top-ceo">
                  <div className="text-muted-foreground">CEO mais afetada</div>
                  <div className="font-medium truncate">
                    {inv.topCeos[0].ceo}{" "}
                    <span className="text-muted-foreground">({inv.topCeos[0].count})</span>
                  </div>
                </div>
              )}
              {inv.topSplitters.length > 0 && (
                <div data-testid="burst-top-splitter">
                  <div className="text-muted-foreground">CTO/Splitter mais afetada</div>
                  <div className="font-medium truncate">
                    {inv.topSplitters[0].splitter}{" "}
                    <span className="text-muted-foreground">({inv.topSplitters[0].count})</span>
                  </div>
                </div>
              )}
            </div>
            {inv.withoutOzmapTopology > 0 && (
              <div className="text-[11px] text-amber-700 dark:text-amber-400">
                {inv.withoutOzmapTopology} de {inv.totalAffectedSampled} afetados sem topologia OZmap sincronizada —
                rode a sincronização pra melhorar a precisão.
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

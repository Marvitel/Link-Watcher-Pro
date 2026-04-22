import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Activity, AlertTriangle, Zap, ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { BurstCounterCard } from "@/components/burst-counter-card";
import { MassiveOutageCard } from "@/components/massive-outage-card";
import type { MassiveOutage } from "@shared/schema";

type BurstState = "normal" | "warning" | "burst" | "catastrophic";

interface BurstSnapshot {
  state: BurstState;
  newOfflineCount: number;
  windowMinutes: number;
}

const BURST_TRIGGER_STYLE: Record<BurstState, string> = {
  normal: "border-emerald-300 bg-emerald-50 text-emerald-900 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-800",
  warning: "border-amber-400 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-700",
  burst: "border-red-400 bg-red-50 text-red-900 hover:bg-red-100 dark:bg-red-950/40 dark:text-red-200 dark:border-red-700",
  catastrophic: "border-red-600 bg-red-100 text-red-900 hover:bg-red-200 dark:bg-red-950/60 dark:text-red-100 dark:border-red-500 ring-1 ring-red-500",
};

const BURST_LABEL: Record<BurstState, string> = {
  normal: "Normal",
  warning: "Atenção",
  burst: "Surto",
  catastrophic: "Catastrófico",
};

const BURST_ICON: Record<BurstState, typeof Activity> = {
  normal: Activity,
  warning: AlertTriangle,
  burst: Zap,
  catastrophic: Zap,
};

export function DashboardAlerts() {
  const [burstOpen, setBurstOpen] = useState(false);
  const [outagesOpen, setOutagesOpen] = useState(false);

  const { data: burst } = useQuery<BurstSnapshot>({
    queryKey: ["/api/admin/burst-counter"],
    refetchInterval: 30_000,
  });

  const { data: outages = [] } = useQuery<MassiveOutage[]>({
    queryKey: ["/api/massive-outages", { status: "active" }],
    queryFn: async () => {
      const r = await fetch("/api/massive-outages?status=active", { credentials: "include" });
      if (!r.ok) throw new Error("Falha ao carregar rompimentos");
      return r.json();
    },
    refetchInterval: 60_000,
  });

  const burstState: BurstState = burst?.state ?? "normal";
  const BurstIcon = BURST_ICON[burstState];
  const burstAlert = burstState === "burst" || burstState === "catastrophic";

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Popover open={burstOpen} onOpenChange={setBurstOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={`h-8 gap-1.5 px-2.5 ${BURST_TRIGGER_STYLE[burstState]}`}
            data-testid="trigger-burst-counter"
          >
            <BurstIcon className="h-3.5 w-3.5" />
            <span className="text-xs font-medium">Quedas</span>
            <Badge
              variant={burstAlert ? "destructive" : "outline"}
              className="text-[10px] px-1.5 py-0 h-4 tabular-nums"
            >
              {burst?.newOfflineCount ?? 0}
            </Badge>
            <span className="text-[10px] text-muted-foreground hidden sm:inline">
              {BURST_LABEL[burstState]}
            </span>
            <ChevronDown className="h-3 w-3 opacity-60" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[420px] p-0 border-0 bg-transparent shadow-xl">
          <BurstCounterCard />
        </PopoverContent>
      </Popover>

      <Popover open={outagesOpen} onOpenChange={setOutagesOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={
              outages.length > 0
                ? "h-8 gap-1.5 px-2.5 border-red-400 bg-red-50 text-red-900 hover:bg-red-100 dark:bg-red-950/40 dark:text-red-200 dark:border-red-700"
                : "h-8 gap-1.5 px-2.5 border-emerald-300 bg-emerald-50 text-emerald-900 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-800"
            }
            data-testid="trigger-massive-outages"
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            <span className="text-xs font-medium">Rompimentos</span>
            <Badge
              variant={outages.length > 0 ? "destructive" : "outline"}
              className="text-[10px] px-1.5 py-0 h-4 tabular-nums"
            >
              {outages.length}
            </Badge>
            <ChevronDown className="h-3 w-3 opacity-60" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[480px] p-0 border-0 bg-transparent shadow-xl">
          {outages.length > 0 ? (
            <MassiveOutageCard />
          ) : (
            <div className="rounded-md border bg-background p-4 text-sm text-muted-foreground" data-testid="text-no-outages">
              Nenhum rompimento massivo ativo no momento.
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

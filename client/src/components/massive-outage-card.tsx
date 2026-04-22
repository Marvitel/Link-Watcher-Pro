import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import { MassiveOutageDetailDialog } from "@/components/massive-outage-detail-dialog";
import type { MassiveOutage } from "@shared/schema";

function formatElapsed(startISO: string | Date): string {
  const ms = Date.now() - new Date(startISO).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h < 24) return `${h}h ${m}min`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

const COLLAPSED_LIMIT = 3;

export function MassiveOutageCard() {
  const [openId, setOpenId] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);

  const { data: outages = [] } = useQuery<MassiveOutage[]>({
    queryKey: ["/api/massive-outages", { status: "active" }],
    queryFn: async () => {
      const r = await fetch("/api/massive-outages?status=active", { credentials: "include" });
      if (!r.ok) throw new Error("Falha ao carregar rompimentos");
      return r.json();
    },
    refetchInterval: 60000,
  });

  if (outages.length === 0) return null;

  const visible = expanded ? outages : outages.slice(0, COLLAPSED_LIMIT);
  const hidden = outages.length - visible.length;

  return (
    <>
      <Card className="border-destructive/50 bg-destructive/5" data-testid="card-massive-outages">
        <CardHeader className="py-2 px-3">
          <CardTitle className="flex items-center gap-2 text-destructive text-sm">
            <AlertTriangle className="h-4 w-4" />
            Rompimentos massivos ativos
            <Badge variant="destructive" className="text-[10px] px-1.5 py-0" data-testid="badge-outage-count">
              {outages.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-2 pt-0 space-y-1">
          {visible.map((o) => (
            <button
              key={o.id}
              onClick={() => setOpenId(o.id)}
              className="w-full flex items-center gap-2 px-2 py-1 rounded border bg-background hover:bg-accent text-left transition-colors text-xs"
              data-testid={`button-outage-${o.id}`}
            >
              <span className="font-semibold truncate flex-1 min-w-0" data-testid={`text-outage-label-${o.id}`}>
                {o.scopeLabel}
              </span>
              <span className="tabular-nums whitespace-nowrap font-medium text-destructive">
                {o.affectedCount}
                {o.totalLinksInScope > 0 && <span className="text-muted-foreground">/{o.totalLinksInScope}</span>}
              </span>
              <span className="tabular-nums whitespace-nowrap text-muted-foreground">
                {Math.round((o.confidence || 0) * 100)}%
              </span>
              <span className="tabular-nums whitespace-nowrap text-muted-foreground">
                há {formatElapsed(o.startedAt)}
              </span>
            </button>
          ))}
          {outages.length > COLLAPSED_LIMIT && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full h-6 text-xs"
              onClick={() => setExpanded((v) => !v)}
              data-testid="button-toggle-outages"
            >
              {expanded ? (
                <><ChevronUp className="h-3 w-3 mr-1" /> recolher</>
              ) : (
                <><ChevronDown className="h-3 w-3 mr-1" /> mostrar mais {hidden}</>
              )}
            </Button>
          )}
        </CardContent>
      </Card>

      <MassiveOutageDetailDialog
        outageId={openId}
        open={openId !== null}
        onOpenChange={(open) => !open && setOpenId(null)}
      />
    </>
  );
}

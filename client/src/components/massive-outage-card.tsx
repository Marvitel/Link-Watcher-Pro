import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, MapPin, ChevronRight } from "lucide-react";
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

export function MassiveOutageCard() {
  const [openId, setOpenId] = useState<number | null>(null);

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

  return (
    <>
      <Card className="border-destructive/50 bg-destructive/5" data-testid="card-massive-outages">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            Rompimentos massivos ativos
            <Badge variant="destructive" data-testid="badge-outage-count">{outages.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {outages.map((o) => (
            <button
              key={o.id}
              onClick={() => setOpenId(o.id)}
              className="w-full flex items-center justify-between gap-3 p-3 rounded-md border bg-background hover:bg-accent text-left transition-colors"
              data-testid={`button-outage-${o.id}`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold truncate" data-testid={`text-outage-label-${o.id}`}>
                    {o.scopeLabel}
                  </span>
                  <Badge variant="outline" className="text-xs">
                    {Math.round((o.confidence || 0) * 100)}% confiança
                  </Badge>
                </div>
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3.5 w-3.5" />
                    {o.mostLikelyLocation || "—"}
                  </span>
                  <span>·</span>
                  <span>
                    <strong className="text-foreground">{o.affectedCount}</strong>
                    {o.totalLinksInScope > 0 && <span>/{o.totalLinksInScope}</span>} links offline
                  </span>
                  <span>·</span>
                  <span>há {formatElapsed(o.startedAt)}</span>
                </div>
              </div>
              <ChevronRight className="h-5 w-5 text-muted-foreground flex-shrink-0" />
            </button>
          ))}
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

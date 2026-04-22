import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PopoverClose } from "@/components/ui/popover";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
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

function formatDuration(startISO: string | Date, endISO: string | Date): string {
  const ms = new Date(endISO).getTime() - new Date(startISO).getTime();
  const min = Math.max(0, Math.floor(ms / 60000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h < 24) return `${h}h ${m}min`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

function formatResolvedAt(iso: string | Date): string {
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, "0");
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mo} ${hh}:${mm}`;
}

interface Props {
  status?: "active" | "resolved";
  /** Esconde o wrapper Card (usado quando exibido dentro de popover já com chrome). */
  bare?: boolean;
  /** Se passado, substitui o controle interno do dialog — útil pra fechar popover externo antes de abrir. */
  onSelect?: (outageId: number) => void;
}

export function MassiveOutageCard({ status = "active", bare = false, onSelect }: Props) {
  const [openId, setOpenId] = useState<number | null>(null);
  const handleClick = (id: number) => {
    if (onSelect) onSelect(id);
    else setOpenId(id);
  };

  const { data: outages = [], isLoading } = useQuery<MassiveOutage[]>({
    queryKey: ["/api/massive-outages", { status }],
    queryFn: async () => {
      const r = await fetch(`/api/massive-outages?status=${status}`, { credentials: "include" });
      if (!r.ok) throw new Error("Falha ao carregar rompimentos");
      return r.json();
    },
    refetchInterval: status === "active" ? 60_000 : false,
  });

  const isResolved = status === "resolved";

  if (!isLoading && outages.length === 0) {
    if (bare) {
      return (
        <div className="p-4 text-sm text-muted-foreground" data-testid={`text-no-outages-${status}`}>
          {isResolved
            ? "Nenhuma massiva encerrada nos registros."
            : "Nenhuma massiva ativa no momento."}
        </div>
      );
    }
    return null;
  }

  const list = (
    <div className="space-y-1">
      {isLoading && (
        <div className="px-2 py-3 text-xs text-muted-foreground">Carregando…</div>
      )}
      {outages.map((o) => {
        const buttonInner = (
          <button
            key={o.id}
            onClick={() => handleClick(o.id)}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded border bg-background hover:bg-accent text-left transition-colors text-xs"
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
            <span
              className="tabular-nums whitespace-nowrap text-muted-foreground"
              title={
                isResolved && o.resolvedAt
                  ? `Encerrada em ${new Date(o.resolvedAt).toLocaleString("pt-BR")} · duração ${formatDuration(o.startedAt, o.resolvedAt)}`
                  : `Iniciada em ${new Date(o.startedAt).toLocaleString("pt-BR")}`
              }
            >
              {isResolved && o.resolvedAt
                ? formatResolvedAt(o.resolvedAt)
                : `há ${formatElapsed(o.startedAt)}`}
            </span>
          </button>
        );
        return onSelect ? (
          <PopoverClose key={o.id} asChild>
            {buttonInner}
          </PopoverClose>
        ) : (
          buttonInner
        );
      })}
    </div>
  );

  const dialog = onSelect ? null : (
    <MassiveOutageDetailDialog
      outageId={openId}
      open={openId !== null}
      onOpenChange={(open) => !open && setOpenId(null)}
    />
  );

  if (bare) {
    return (
      <>
        <div className="p-2">{list}</div>
        {dialog}
      </>
    );
  }

  return (
    <>
      <Card
        className={isResolved ? "border-muted-foreground/30" : "border-destructive/50 bg-destructive/5"}
        data-testid={`card-outages-${status}`}
      >
        <CardHeader className="py-2 px-3">
          <CardTitle className={`flex items-center gap-2 text-sm ${isResolved ? "" : "text-destructive"}`}>
            {isResolved ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
            {isResolved ? "Massivas encerradas" : "Massivas ativas"}
            <Badge
              variant={isResolved ? "outline" : "destructive"}
              className="text-[10px] px-1.5 py-0"
              data-testid="badge-outage-count"
            >
              {outages.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-2 pt-0">{list}</CardContent>
      </Card>
      {dialog}
    </>
  );
}

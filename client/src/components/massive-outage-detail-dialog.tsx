import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MapPin, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { Link } from "wouter";
import type { MassiveOutage } from "@shared/schema";
import { RouteDiagram } from "@/components/route-diagram";

interface AffectedLink {
  linkId: number;
  name: string;
  clientId: number;
  status: string;
  opticalRxBefore: number | null;
  opticalTxBefore: number | null;
  opticalRxNow: number | null;
  opticalTxNow: number | null;
  deltaRx: number | null;
  joinedAt: string;
  leftAt: string | null;
}

interface OutageDetailResponse {
  outage: MassiveOutage;
  affectedLinks: AffectedLink[];
}

interface Props {
  outageId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function fmt(n: number | null | undefined, suffix = ""): string {
  if (n === null || n === undefined) return "—";
  return `${n.toFixed(2)}${suffix}`;
}

function formatDurationMs(ms: number): string {
  if (ms < 0) ms = 0;
  const min = Math.floor(ms / 60000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h < 24) return `${h}h ${m}min`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

function formatElapsed(startISO: string): string {
  return formatDurationMs(Date.now() - new Date(startISO).getTime());
}

function formatDowntime(joinedAt: string, leftAt: string | null): string {
  const start = new Date(joinedAt).getTime();
  const end = leftAt ? new Date(leftAt).getTime() : Date.now();
  return formatDurationMs(end - start);
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

// Status que significam "link voltou / está alcançável" — o BD usa 'operational'/'degraded',
// não 'online'. Usar a comparação errada quebra o contador "já voltou" e a coluna de delta.
function isLinkBack(status: string): boolean {
  return status === "operational" || status === "degraded";
}

export function MassiveOutageDetailDialog({ outageId, open, onOpenChange }: Props) {
  const { data, isLoading } = useQuery<OutageDetailResponse>({
    queryKey: ["/api/massive-outages", outageId],
    enabled: open && outageId !== null,
    refetchInterval: 30000,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] sm:max-w-[90vw] lg:max-w-6xl xl:max-w-7xl max-h-[92vh] overflow-y-auto" data-testid="dialog-massive-outage-detail">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            {data?.outage.scopeLabel || "Carregando..."}
          </DialogTitle>
          <DialogDescription>
            {data?.outage && (
              <>
                <span className="flex items-center gap-1.5 mt-1">
                  <MapPin className="h-4 w-4" />
                  Local provável: <strong data-testid="text-most-likely-location">{data.outage.mostLikelyLocation || "—"}</strong>
                </span>
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {isLoading || !data ? (
          <div className="space-y-3">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <div className="p-3 rounded-md border bg-card">
                <div className="text-xs text-muted-foreground">Afetados</div>
                <div className="text-2xl font-semibold" data-testid="text-affected-count">
                  {data.outage.affectedCount}/{data.outage.totalLinksInScope}
                </div>
              </div>
              <div className="p-3 rounded-md border bg-card">
                <div className="text-xs text-muted-foreground">Confiança</div>
                <div className="text-2xl font-semibold" data-testid="text-confidence">
                  {Math.round((data.outage.confidence || 0) * 100)}%
                </div>
              </div>
              <div className="p-3 rounded-md border bg-card">
                <div className="text-xs text-muted-foreground">Início</div>
                <div className="text-sm font-medium" data-testid="text-elapsed">
                  há {formatElapsed(String(data.outage.startedAt))}
                </div>
              </div>
              <div className="p-3 rounded-md border bg-card">
                <div className="text-xs text-muted-foreground">Status</div>
                <Badge variant={data.outage.status === "active" ? "destructive" : "secondary"}>
                  {data.outage.status === "active" ? "Ativo" : "Resolvido"}
                </Badge>
              </div>
            </div>

            <div className="mb-4">
              <RouteDiagram
                outageId={outageId}
                open={open}
                scope={data.outage.scope}
                scopeKey={data.outage.scopeKey}
              />
            </div>

            {(() => {
              // Ordena: ainda offline primeiro (mais críticos), depois online (já voltaram).
              // Dentro de cada grupo, ordena por nome.
              const sorted = [...data.affectedLinks].sort((a, b) => {
                const aOffline = !isLinkBack(a.status);
                const bOffline = !isLinkBack(b.status);
                if (aOffline !== bOffline) return aOffline ? -1 : 1;
                return a.name.localeCompare(b.name);
              });
              const stillOffline = sorted.filter((l) => !isLinkBack(l.status)).length;
              const recovered = sorted.length - stillOffline;
              return (
                <>
                  <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
                    <h3 className="text-sm font-semibold">Links afetados ({sorted.length})</h3>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="flex items-center gap-1.5" data-testid="text-still-offline">
                        <XCircle className="h-3.5 w-3.5 text-destructive" />
                        <span className="font-medium text-destructive">{stillOffline}</span>
                        <span className="text-muted-foreground">ainda offline</span>
                      </span>
                      <span className="flex items-center gap-1.5" data-testid="text-recovered">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                        <span className="font-medium text-emerald-600">{recovered}</span>
                        <span className="text-muted-foreground">já voltou</span>
                      </span>
                    </div>
                  </div>
                  <Table data-testid="table-affected-links">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Link</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Caiu</TableHead>
                        <TableHead>Voltou</TableHead>
                        <TableHead>Downtime</TableHead>
                        <TableHead className="text-right">Sinal antes (Rx)</TableHead>
                        <TableHead className="text-right">Sinal agora (Rx)</TableHead>
                        <TableHead className="text-right">Δ Rx</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sorted.map((al) => {
                        const back = isLinkBack(al.status);
                        return (
                          <TableRow
                            key={al.linkId}
                            className={back ? "opacity-70" : ""}
                            data-testid={`row-affected-link-${al.linkId}`}
                          >
                            <TableCell>
                              <Link href={`/link/${al.linkId}`} className="text-primary hover:underline">
                                {al.name}
                              </Link>
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={back ? "default" : "destructive"}
                                className={back ? "bg-emerald-600 hover:bg-emerald-700" : ""}
                              >
                                {al.status}
                              </Badge>
                            </TableCell>
                            <TableCell
                              className="text-xs text-muted-foreground whitespace-nowrap"
                              data-testid={`text-fell-${al.linkId}`}
                              title={formatDateTime(al.joinedAt)}
                            >
                              {formatDateTime(al.joinedAt)}
                            </TableCell>
                            <TableCell
                              className="text-xs text-muted-foreground whitespace-nowrap"
                              data-testid={`text-returned-${al.linkId}`}
                              title={al.leftAt ? formatDateTime(al.leftAt) : "ainda offline"}
                            >
                              {al.leftAt ? formatDateTime(al.leftAt) : "—"}
                            </TableCell>
                            <TableCell
                              className={`text-xs whitespace-nowrap font-medium ${
                                back ? "text-emerald-700" : "text-destructive"
                              }`}
                              data-testid={`text-downtime-${al.linkId}`}
                            >
                              {formatDowntime(al.joinedAt, al.leftAt)}
                            </TableCell>
                            <TableCell className="text-right font-mono">{fmt(al.opticalRxBefore, " dBm")}</TableCell>
                            <TableCell className="text-right font-mono">{fmt(al.opticalRxNow, " dBm")}</TableCell>
                            <TableCell
                              className={`text-right font-mono ${
                                al.deltaRx != null && al.deltaRx < -3 ? "text-destructive font-semibold" : ""
                              }`}
                            >
                              {al.deltaRx != null
                                ? `${al.deltaRx > 0 ? "+" : ""}${al.deltaRx.toFixed(2)} dB`
                                : "—"}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      {sorted.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                            Nenhum link afetado.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </>
              );
            })()}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

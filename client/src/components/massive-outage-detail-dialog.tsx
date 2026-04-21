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

function formatElapsed(startISO: string): string {
  const ms = Date.now() - new Date(startISO).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h < 24) return `${h}h ${m}min`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

export function MassiveOutageDetailDialog({ outageId, open, onOpenChange }: Props) {
  const { data, isLoading } = useQuery<OutageDetailResponse>({
    queryKey: ["/api/massive-outages", outageId],
    enabled: open && outageId !== null,
    refetchInterval: 30000,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" data-testid="dialog-massive-outage-detail">
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
              <RouteDiagram outageId={outageId} open={open} scope={data.outage.scope} />
            </div>

            {(() => {
              // Ordena: ainda offline primeiro (mais críticos), depois online (já voltaram).
              // Dentro de cada grupo, ordena por nome.
              const sorted = [...data.affectedLinks].sort((a, b) => {
                const aOffline = a.status !== "online";
                const bOffline = b.status !== "online";
                if (aOffline !== bOffline) return aOffline ? -1 : 1;
                return a.name.localeCompare(b.name);
              });
              const stillOffline = sorted.filter((l) => l.status !== "online").length;
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
                        <TableHead className="text-right">Sinal antes (Rx)</TableHead>
                        <TableHead className="text-right">Sinal agora (Rx)</TableHead>
                        <TableHead className="text-right">Δ Rx</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sorted.map((al) => {
                        const isOnline = al.status === "online";
                        return (
                          <TableRow
                            key={al.linkId}
                            className={isOnline ? "opacity-70" : ""}
                            data-testid={`row-affected-link-${al.linkId}`}
                          >
                            <TableCell>
                              <Link href={`/link/${al.linkId}`} className="text-primary hover:underline">
                                {al.name}
                              </Link>
                              {isOnline && al.leftAt && (
                                <div className="text-[11px] text-muted-foreground mt-0.5">
                                  voltou há {formatElapsed(String(al.leftAt))}
                                </div>
                              )}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={isOnline ? "default" : "destructive"}
                                className={isOnline ? "bg-emerald-600 hover:bg-emerald-700" : ""}
                              >
                                {al.status}
                              </Badge>
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
                          <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
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

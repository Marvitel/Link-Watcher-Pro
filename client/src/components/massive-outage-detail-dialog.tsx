import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  MapPin, AlertTriangle, CheckCircle2, XCircle, Printer, Clock,
  Power, Cable, HelpCircle, ChevronDown, ChevronRight, RotateCcw, Trash2, Save, X,
} from "lucide-react";
import { Link } from "wouter";
import type { MassiveOutage } from "@shared/schema";
import { RouteDiagram } from "@/components/route-diagram";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

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
  lastFailureAt: string | null;
  excluded: boolean;
  excludedReason: string | null;
  ozmapRoute: any;
}

interface ProbablePathSnapshotEntry {
  kind: string;
  name: string;
  count: number;
  totalConsidered: number;
  percentage: number;
  onlinePassThrough: number;
  onlineConsidered: number;
  verdict: "downstream_cut" | "likely_cut" | "upstream_or_here" | "unknown";
}

interface OutageDetailResponse {
  outage: MassiveOutage;
  affectedLinks: AffectedLink[];
  probablePathSnapshot: ProbablePathSnapshotEntry[] | null;
  probablePathSnapshotAt: string | null;
}

interface Props {
  outageId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const CAUSE_LABEL: Record<string, string> = {
  fiber_cut: "Rompimento de fibra",
  power_outage: "Queda de energia",
  unknown: "Indeterminada",
};
const CAUSE_ICON: Record<string, any> = {
  fiber_cut: Cable,
  power_outage: Power,
  unknown: HelpCircle,
};
const CAUSE_BADGE_CLASS: Record<string, string> = {
  fiber_cut: "bg-orange-100 text-orange-900 border-orange-300 dark:bg-orange-950/40 dark:text-orange-200",
  power_outage: "bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950/40 dark:text-amber-200",
  unknown: "bg-muted text-muted-foreground",
};

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

function formatDowntime(joinedAt: string, leftAt: string | null, effectiveStart?: string | null): string {
  // Usa o MENOR entre joinedAt e effectiveStart (override de início da massiva).
  // Assim, quando o operador ajusta o início da massiva pra um horário anterior,
  // o downtime dos links já existentes recua junto.
  const joined = new Date(joinedAt).getTime();
  const eff = effectiveStart ? new Date(effectiveStart).getTime() : joined;
  const start = Math.min(joined, eff);
  const end = leftAt ? new Date(leftAt).getTime() : Date.now();
  return formatDurationMs(end - start);
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function isLinkBack(status: string): boolean {
  return status === "operational" || status === "degraded";
}

// Converte ISO → "YYYY-MM-DDTHH:mm" no fuso local pra input datetime-local
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function getEffectiveStartedAt(outage: MassiveOutage): string {
  return String((outage.startedAtOverride ?? outage.startedAt) as any);
}

function getEffectiveCause(outage: MassiveOutage): string {
  return (outage.probableCauseOverride || outage.probableCause || "unknown") as string;
}

function CeoRouteDropdown({ route }: { route: any }) {
  const items: any[] = Array.isArray(route?.elements) ? route.elements : Array.isArray(route) ? route : [];
  if (items.length === 0) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" data-testid="button-ceo-route">
          <MapPin className="h-3 w-3" />
          Rota
          <ChevronDown className="h-3 w-3 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[420px] p-0" align="start">
        <div className="p-2 border-b text-xs font-semibold">
          Rota óptica ({items.length} pontos)
        </div>
        <div className="max-h-[300px] overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="h-8 text-xs">Tipo</TableHead>
                <TableHead className="h-8 text-xs">Nome</TableHead>
                <TableHead className="h-8 text-xs text-right">Dist.</TableHead>
                <TableHead className="h-8 text-xs text-right">Aten.</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((el, i) => (
                <TableRow key={i}>
                  <TableCell className="py-1.5 text-xs uppercase font-mono">{el.kind || "—"}</TableCell>
                  <TableCell className="py-1.5 text-xs truncate max-w-[180px]" title={el.name}>{el.name || "—"}</TableCell>
                  <TableCell className="py-1.5 text-xs text-right font-mono tabular-nums">
                    {el.distanceM != null ? `${el.distanceM.toFixed(0)}m` : "—"}
                  </TableCell>
                  <TableCell className="py-1.5 text-xs text-right font-mono tabular-nums">
                    {el.attenuationDb != null ? `${el.attenuationDb.toFixed(1)}dB` : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function StartTimeEditor({ outage, outageId }: { outage: MassiveOutage; outageId: number }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const effective = getEffectiveStartedAt(outage);
  const [value, setValue] = useState(toLocalInput(effective));
  useEffect(() => { setValue(toLocalInput(effective)); }, [effective]);
  const mut = useMutation({
    mutationFn: async (override: string | null) => {
      await apiRequest("PATCH", `/api/massive-outages/${outageId}`, { startedAtOverride: override });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/massive-outages", outageId] });
      queryClient.invalidateQueries({ queryKey: ["/api/massive-outages"] });
      toast({ title: "Horário ajustado" });
      setOpen(false);
    },
    onError: () => toast({ title: "Falhou ao ajustar horário", variant: "destructive" }),
  });
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-6 px-1.5 -ml-1.5 gap-1" data-testid="button-edit-started-at">
          <Clock className="h-3 w-3" />
          <span className="text-xs">Ajustar</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3 space-y-2" align="start">
        <div className="text-xs font-semibold">Ajustar horário de início</div>
        <p className="text-[11px] text-muted-foreground">
          Detector marcou às {formatDateTime(String(outage.startedAt as any))}. Use o ajuste pra refletir o início real observado em campo.
        </p>
        <Input
          type="datetime-local"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="h-8 text-xs"
          data-testid="input-started-at-override"
        />
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            className="h-7 text-xs flex-1"
            onClick={() => mut.mutate(value ? new Date(value).toISOString() : null)}
            disabled={mut.isPending}
            data-testid="button-save-started-at"
          >
            <Save className="h-3 w-3 mr-1" /> Salvar
          </Button>
          {outage.startedAtOverride && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => mut.mutate(null)}
              disabled={mut.isPending}
              data-testid="button-reset-started-at"
            >
              <RotateCcw className="h-3 w-3 mr-1" /> Resetar
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function CauseEditor({ outage, outageId }: { outage: MassiveOutage; outageId: number }) {
  const { toast } = useToast();
  const effective = getEffectiveCause(outage);
  const Icon = CAUSE_ICON[effective] || HelpCircle;
  const mut = useMutation({
    mutationFn: async (cause: string | null) => {
      await apiRequest("PATCH", `/api/massive-outages/${outageId}`, { probableCauseOverride: cause });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/massive-outages", outageId] });
      toast({ title: "Causa ajustada" });
    },
    onError: () => toast({ title: "Falhou", variant: "destructive" }),
  });
  return (
    <div className="flex items-center gap-2">
      <Badge variant="outline" className={`gap-1 ${CAUSE_BADGE_CLASS[effective]}`} data-testid="badge-probable-cause">
        <Icon className="h-3 w-3" />
        {CAUSE_LABEL[effective]}
        {outage.probableCauseOverride && <span className="text-[10px] opacity-70">(manual)</span>}
      </Badge>
      <Select
        value={outage.probableCauseOverride || ""}
        onValueChange={(v) => mut.mutate(v === "__auto__" ? null : v)}
      >
        <SelectTrigger className="h-7 w-[180px] text-xs print:hidden" data-testid="select-cause-override">
          <SelectValue placeholder="Reclassificar..." />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__auto__">Usar automática ({CAUSE_LABEL[outage.probableCause || "unknown"]})</SelectItem>
          <SelectItem value="fiber_cut">Rompimento de fibra</SelectItem>
          <SelectItem value="power_outage">Queda de energia</SelectItem>
          <SelectItem value="unknown">Indeterminada</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

function ResolveManually({ outageId, onClose }: { outageId: number; onClose: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const mut = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/massive-outages/${outageId}/resolve`, { note });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/massive-outages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/massive-outages", outageId] });
      toast({ title: "Massiva encerrada manualmente" });
      setOpen(false);
      onClose();
    },
    onError: () => toast({ title: "Falhou ao encerrar", variant: "destructive" }),
  });
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 print:hidden" data-testid="button-resolve-manually">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Encerrar manualmente
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-3 space-y-2">
        <div className="text-xs font-semibold">Encerrar manualmente</div>
        <p className="text-[11px] text-muted-foreground">
          Use quando o rompimento já foi resolvido em campo mas o detector ainda não percebeu.
        </p>
        <Textarea
          placeholder="Observação (opcional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          className="text-xs"
          data-testid="input-resolution-note"
        />
        <Button
          size="sm"
          className="w-full h-7 text-xs"
          onClick={() => mut.mutate()}
          disabled={mut.isPending}
          data-testid="button-confirm-resolve"
        >
          Confirmar encerramento
        </Button>
      </PopoverContent>
    </Popover>
  );
}

function ExcludeButton({ outageId, link }: { outageId: number; link: AffectedLink }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const mut = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/massive-outages/${outageId}/exclude-link`, { linkId: link.linkId, reason });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/massive-outages", outageId] });
      queryClient.invalidateQueries({ queryKey: ["/api/massive-outages"] });
      toast({ title: "Link excluído da massiva" });
      setOpen(false);
    },
    onError: () => toast({ title: "Falhou", variant: "destructive" }),
  });
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 print:hidden" title="Excluir do cluster" data-testid={`button-exclude-${link.linkId}`}>
          <Trash2 className="h-3.5 w-3.5 text-destructive" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3 space-y-2">
        <div className="text-xs font-semibold">Excluir link da massiva</div>
        <p className="text-[11px] text-muted-foreground">
          Use quando você sabe que esse cliente caiu por motivo isolado e não pertence a esse rompimento.
        </p>
        <Input
          placeholder="Motivo (opcional)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="h-7 text-xs"
        />
        <Button size="sm" variant="destructive" className="w-full h-7 text-xs" onClick={() => mut.mutate()} disabled={mut.isPending}>
          Confirmar exclusão
        </Button>
      </PopoverContent>
    </Popover>
  );
}

function IncludeButton({ outageId, link }: { outageId: number; link: AffectedLink }) {
  const { toast } = useToast();
  const mut = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/massive-outages/${outageId}/include-link`, { linkId: link.linkId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/massive-outages", outageId] });
      queryClient.invalidateQueries({ queryKey: ["/api/massive-outages"] });
      toast({ title: "Link reincluído" });
    },
    onError: () => toast({ title: "Falhou", variant: "destructive" }),
  });
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-6 px-2 text-xs gap-1 print:hidden"
      onClick={() => mut.mutate()}
      disabled={mut.isPending}
      title="Reincluir no cluster"
      data-testid={`button-include-${link.linkId}`}
    >
      <RotateCcw className="h-3 w-3" /> Reincluir
    </Button>
  );
}

export function MassiveOutageDetailDialog({ outageId, open, onOpenChange }: Props) {
  const { data, isLoading } = useQuery<OutageDetailResponse>({
    queryKey: ["/api/massive-outages", outageId],
    enabled: open && outageId !== null,
    refetchInterval: 30000,
  });
  const [showAllProbable, setShowAllProbable] = useState(false);
  const [snapshotOpen, setSnapshotOpen] = useState(false);
  const [liveRankingOpen, setLiveRankingOpen] = useState(false);

  const initialAnalysis = data?.outage.initialAnalysis as any;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[95vw] sm:max-w-[90vw] lg:max-w-6xl xl:max-w-7xl max-h-[92vh] overflow-y-auto print:max-w-full print:max-h-none print:overflow-visible print:shadow-none print:border-0"
        data-testid="dialog-massive-outage-detail"
      >
        <DialogHeader>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex-1 min-w-0">
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-destructive" />
                {data?.outage.scopeLabel || "Carregando..."}
              </DialogTitle>
              <DialogDescription>
                {data?.outage && (() => {
                  const loc = (data.outage.mostLikelyLocation || "").trim();
                  const label = (data.outage.scopeLabel || "").trim();
                  // Esconde se o local provável só repete o que já está no título
                  if (!loc || loc === label) return null;
                  return (
                    <span className="flex items-center gap-1.5 mt-1">
                      <MapPin className="h-4 w-4" />
                      Local provável: <strong data-testid="text-most-likely-location">{loc}</strong>
                    </span>
                  );
                })()}
              </DialogDescription>
            </div>
            {data?.outage && (
              <div className="flex items-center gap-2 print:hidden">
                {data.outage.status === "active" && outageId !== null && (
                  <ResolveManually outageId={outageId} onClose={() => onOpenChange(false)} />
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5"
                  onClick={() => window.print()}
                  data-testid="button-print"
                >
                  <Printer className="h-3.5 w-3.5" />
                  Imprimir
                </Button>
              </div>
            )}
          </div>
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
                <div className="text-xs text-muted-foreground flex items-center justify-between gap-2">
                  <span>Início</span>
                  {outageId !== null && <StartTimeEditor outage={data.outage} outageId={outageId} />}
                </div>
                <div className="text-sm font-medium" data-testid="text-elapsed">
                  {formatDateTime(getEffectiveStartedAt(data.outage))}
                  {data.outage.startedAtOverride && (
                    <span className="ml-1 text-[10px] text-muted-foreground">(ajustado)</span>
                  )}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  há {formatElapsed(getEffectiveStartedAt(data.outage))}
                </div>
              </div>
              <div className="p-3 rounded-md border bg-card">
                <div className="text-xs text-muted-foreground">Status</div>
                <Badge variant={data.outage.status === "active" ? "destructive" : "secondary"}>
                  {data.outage.status === "active" ? "Ativo" : "Resolvido"}
                </Badge>
                {data.outage.resolvedManually && (
                  <div className="text-[10px] text-muted-foreground mt-1">encerrado manualmente</div>
                )}
              </div>
            </div>

            {/* Causa provável — esconde no impresso quando indeterminada (sem informação útil) */}
            {(() => {
              const eff = getEffectiveCause(data.outage);
              const isUnknown = !eff || eff === "unknown";
              return (
                <div
                  className={`mb-4 p-3 rounded-md border bg-card flex items-center gap-3 flex-wrap ${
                    isUnknown ? "print:hidden" : ""
                  }`}
                >
                  <div className="text-xs text-muted-foreground">Causa provável:</div>
                  {outageId !== null && <CauseEditor outage={data.outage} outageId={outageId} />}
                </div>
              );
            })()}

            {/* Análise inicial */}
            {initialAnalysis && (
              <div className="mb-4 p-3 rounded-md border bg-muted/30" data-testid="block-initial-analysis">
                <div className="flex items-center justify-between mb-1">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Análise inicial</div>
                  {initialAnalysis.capturedAt && (
                    <div className="text-[10px] text-muted-foreground">
                      capturada em {formatDateTime(initialAnalysis.capturedAt)}
                    </div>
                  )}
                </div>
                <div className="text-sm">{initialAnalysis.summary}</div>
                {initialAnalysis.mostLikelyLocation && (
                  <div className="text-xs text-muted-foreground mt-1">
                    Local naquele momento: <strong>{initialAnalysis.mostLikelyLocation}</strong>
                  </div>
                )}
              </div>
            )}

            {/* Snapshot do ranking de pontos prováveis (capturado na criação) */}
            {data.probablePathSnapshot && data.probablePathSnapshot.length > 0 && (
              <div className="mb-4 p-3 rounded-md border bg-muted/30 print:bg-transparent" data-testid="block-probable-path-snapshot">
                <button
                  type="button"
                  onClick={() => setSnapshotOpen((v) => !v)}
                  className="w-full flex items-center justify-between gap-2 text-left print:cursor-default"
                  data-testid="button-toggle-snapshot"
                  aria-expanded={snapshotOpen}
                >
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <ChevronRight
                      className={`h-3.5 w-3.5 transition-transform print:hidden ${snapshotOpen ? "rotate-90" : ""}`}
                    />
                    Pontos prováveis de corte (no momento da abertura)
                    <Badge variant="outline" className="text-[10px] font-normal print:hidden">
                      {data.probablePathSnapshot.length}
                    </Badge>
                  </div>
                  {data.probablePathSnapshotAt && (
                    <div className="text-[10px] text-muted-foreground">
                      capturado em {formatDateTime(data.probablePathSnapshotAt)}
                    </div>
                  )}
                </button>
                <div className={`overflow-x-auto mt-2 ${snapshotOpen ? "" : "hidden print:block"}`}>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Ponto</TableHead>
                        <TableHead className="text-xs">Tipo</TableHead>
                        <TableHead className="text-xs text-right">Afetados</TableHead>
                        <TableHead className="text-xs text-right">% do cluster</TableHead>
                        <TableHead className="text-xs text-right">Online cruzando</TableHead>
                        <TableHead className="text-xs">Veredito</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(() => {
                        const verdictLabel: Record<string, string> = {
                          likely_cut: "ponto provável",
                          downstream_cut: "rompimento depois daqui",
                          upstream_or_here: "aqui ou antes",
                          unknown: "sem validação",
                        };
                        const verdictClass: Record<string, string> = {
                          likely_cut: "bg-orange-100 text-orange-900 border-orange-300 dark:bg-orange-950/40 dark:text-orange-200",
                          downstream_cut: "bg-blue-50 text-blue-900 border-blue-200 dark:bg-blue-950/30 dark:text-blue-200",
                          upstream_or_here: "bg-amber-50 text-amber-900 border-amber-200 dark:bg-amber-950/30 dark:text-amber-200",
                          unknown: "bg-muted text-muted-foreground",
                        };
                        // Prioriza vereditos mais informativos e quebra empates por
                        // online cruzando (menor = corte mais próximo daqui)
                        const verdictOrder: Record<string, number> = {
                          likely_cut: 0,
                          upstream_or_here: 1,
                          downstream_cut: 2,
                          unknown: 3,
                        };
                        const ranked = [...data.probablePathSnapshot].sort((a, b) => {
                          const va = verdictOrder[a.verdict] ?? 9;
                          const vb = verdictOrder[b.verdict] ?? 9;
                          if (va !== vb) return va - vb;
                          if (b.percentage !== a.percentage) return b.percentage - a.percentage;
                          return (a.onlinePassThrough ?? 0) - (b.onlinePassThrough ?? 0);
                        });
                        const TOP = 8;
                        const shown = showAllProbable ? ranked : ranked.slice(0, TOP);
                        const rest = ranked.length - shown.length;
                        return (
                          <>
                            {shown.map((p, i) => (
                              <TableRow key={`${p.kind}|${p.name}|${i}`}>
                                <TableCell className="text-xs font-medium">{p.name}</TableCell>
                                <TableCell className="text-xs uppercase text-muted-foreground">{p.kind}</TableCell>
                                <TableCell className="text-xs text-right font-mono">
                                  {p.count}/{p.totalConsidered}
                                </TableCell>
                                <TableCell className="text-xs text-right font-mono">
                                  {(p.percentage * 100).toFixed(0)}%
                                </TableCell>
                                <TableCell className="text-xs text-right font-mono">
                                  {p.onlinePassThrough}/{p.onlineConsidered}
                                </TableCell>
                                <TableCell>
                                  <Badge variant="outline" className={`text-[10px] ${verdictClass[p.verdict] ?? ""}`}>
                                    {verdictLabel[p.verdict] ?? p.verdict}
                                  </Badge>
                                </TableCell>
                              </TableRow>
                            ))}
                            {rest > 0 && (
                              <TableRow className="hover:bg-transparent">
                                <TableCell colSpan={6} className="text-center text-xs">
                                  <button
                                    type="button"
                                    onClick={() => setShowAllProbable(true)}
                                    className="text-primary hover:underline print:hidden"
                                    data-testid="button-show-all-probable"
                                  >
                                    Mostrar +{rest} pontos similares
                                  </button>
                                  <span className="hidden print:inline text-muted-foreground italic">
                                    + {rest} pontos similares com mesmo padrão
                                  </span>
                                </TableCell>
                              </TableRow>
                            )}
                          </>
                        );
                      })()}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            {/* Nota de resolução */}
            {data.outage.resolutionNote && (
              <div className="mb-4 p-3 rounded-md border bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800">
                <div className="text-xs font-semibold text-emerald-900 dark:text-emerald-200 mb-1">Observação de encerramento</div>
                <div className="text-sm">{data.outage.resolutionNote}</div>
              </div>
            )}

            <div className="mb-4 print:hidden">
              <button
                type="button"
                onClick={() => setLiveRankingOpen((v) => !v)}
                className="w-full flex items-center gap-2 text-left p-3 rounded-md border bg-muted/30 hover:bg-muted/50"
                data-testid="button-toggle-live-ranking"
                aria-expanded={liveRankingOpen}
              >
                <ChevronRight
                  className={`h-3.5 w-3.5 transition-transform ${liveRankingOpen ? "rotate-90" : ""}`}
                />
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Pontos prováveis ranqueados por frequência (atualizado agora)
                </span>
              </button>
              {liveRankingOpen && (
                <div className="mt-2">
                  <RouteDiagram
                    outageId={outageId}
                    open={open}
                    scope={data.outage.scope}
                    scopeKey={data.outage.scopeKey}
                  />
                </div>
              )}
            </div>

            {(() => {
              const sorted = [...data.affectedLinks].sort((a, b) => {
                if (a.excluded !== b.excluded) return a.excluded ? 1 : -1;
                const aOffline = !isLinkBack(a.status);
                const bOffline = !isLinkBack(b.status);
                if (aOffline !== bOffline) return aOffline ? -1 : 1;
                return a.name.localeCompare(b.name);
              });
              const active = sorted.filter((l) => !l.excluded);
              const stillOffline = active.filter((l) => !isLinkBack(l.status)).length;
              const recovered = active.length - stillOffline;
              const excludedCount = sorted.length - active.length;
              return (
                <>
                  <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
                    <h3 className="text-sm font-semibold">Links afetados ({active.length})</h3>
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
                      {excludedCount > 0 && (
                        <span className="flex items-center gap-1.5">
                          <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="font-medium text-muted-foreground">{excludedCount}</span>
                          <span className="text-muted-foreground">excluídos</span>
                        </span>
                      )}
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
                        <TableHead className="text-right" title="Perda em dB (positivo = sinal piorou)">Perda Rx</TableHead>
                        <TableHead className="text-center">Rota</TableHead>
                        <TableHead className="text-right print:hidden">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sorted.map((al) => {
                        const back = isLinkBack(al.status);
                        return (
                          <TableRow
                            key={al.linkId}
                            className={al.excluded ? "opacity-40 line-through" : back ? "opacity-70" : ""}
                            data-testid={`row-affected-link-${al.linkId}`}
                          >
                            <TableCell>
                              <Link href={`/link/${al.linkId}`} className="text-primary hover:underline">
                                {al.name}
                              </Link>
                              {al.excluded && al.excludedReason && (
                                <div className="text-[10px] text-muted-foreground italic">
                                  excluído: {al.excludedReason}
                                </div>
                              )}
                            </TableCell>
                            <TableCell>
                              {al.excluded ? (
                                <Badge variant="outline">excluído</Badge>
                              ) : (
                                <Badge
                                  variant={back ? "default" : "destructive"}
                                  className={back ? "bg-emerald-600 hover:bg-emerald-700" : ""}
                                >
                                  {al.status}
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                              {formatDateTime(al.joinedAt)}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                              {al.leftAt ? formatDateTime(al.leftAt) : "—"}
                            </TableCell>
                            <TableCell
                              className={`text-xs whitespace-nowrap font-medium ${
                                back ? "text-emerald-700" : "text-destructive"
                              }`}
                            >
                              {formatDowntime(
                                al.joinedAt,
                                al.leftAt,
                                (data.outage.startedAtOverride ?? data.outage.startedAt) as any,
                              )}
                            </TableCell>
                            <TableCell className="text-right font-mono">{fmt(al.opticalRxBefore, " dBm")}</TableCell>
                            <TableCell className="text-right font-mono">{fmt(al.opticalRxNow, " dBm")}</TableCell>
                            <TableCell
                              className={`text-right font-mono ${
                                al.deltaRx != null && al.deltaRx > 3 ? "text-destructive font-semibold" : ""
                              }`}
                            >
                              {al.deltaRx != null
                                ? `${al.deltaRx > 0 ? "+" : ""}${al.deltaRx.toFixed(2)} dB`
                                : "—"}
                            </TableCell>
                            <TableCell className="text-center">
                              <CeoRouteDropdown route={al.ozmapRoute} />
                            </TableCell>
                            <TableCell className="text-right print:hidden">
                              {outageId !== null && (
                                al.excluded
                                  ? <IncludeButton outageId={outageId} link={al} />
                                  : <ExcludeButton outageId={outageId} link={al} />
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      {sorted.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={10} className="text-center text-muted-foreground py-8">
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

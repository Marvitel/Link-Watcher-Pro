import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { ClipboardList, Play, CheckCircle2, XCircle, Clock, RefreshCw, Settings, Filter, Sparkles, Bot } from "lucide-react";
import { Link as WouterLink } from "wouter";

interface PendingItem {
  id: number;
  linkId: number;
  field: string;
  classification: "missing" | "inconsistent" | "optimization" | "urgent";
  source: string;
  status: string;
  nextStep: "apply_now" | "needs_voalle_change" | "needs_field_visit" | "wait_voalle_sync" | "manual_investigation";
  suggestedAction: string;
  currentValue: string | null;
  suggestedValue: string | null;
  reason: string | null;
  proposalId: number | null;
  resolvedAt: string | null;
  resolvedByUserId: number | null;
  resolutionNote: string | null;
  snoozedUntil: string | null;
  createdAt: string;
  updatedAt: string;
}

interface AuditSummary {
  counts: { pending: number; authorized: number; applied: number; dismissed: number; snoozed: number; resolved: number };
  lastAuditAt: string | null;
  dailyAuditEnabled: boolean;
  dailyAuditHourUtc: number;
  actionPolicy: Record<string, "immediate" | "authorize_only">;
  isRunning: boolean;
}

const APPLIABLE_FIELDS = [
  "monitoredIp",
  "pppoeUser",
  "concentratorId",
  "oltId",
  "slotOlt",
  "portOlt",
  "onuId",
  "equipmentSerialNumber",
  "voalleContractTagId",
  "monitoringEnabled",
];

const CLASSIFICATION_BADGE: Record<string, { label: string; cls: string }> = {
  urgent: { label: "Urgente", cls: "bg-red-600 hover:bg-red-700 text-white" },
  inconsistent: { label: "Inconsistente", cls: "bg-orange-500 hover:bg-orange-600 text-white" },
  missing: { label: "Faltando", cls: "bg-amber-500 hover:bg-amber-600 text-white" },
  optimization: { label: "Otimização", cls: "bg-blue-500 hover:bg-blue-600 text-white" },
};

const ACTION_LABEL: Record<string, string> = {
  apply_now: "Aplicar agora",
  needs_voalle_change: "Mudança no Voalle",
  needs_field_visit: "Visita técnica",
  wait_voalle_sync: "Aguardar sync Voalle",
  manual_investigation: "Investigação manual",
};

export function PendingItemsTab() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>("pending");
  const [classFilter, setClassFilter] = useState<string>("all");
  const [searchLinkId, setSearchLinkId] = useState<string>("");
  const [onlyProblematic, setOnlyProblematic] = useState<boolean>(false);
  const [dismissDialog, setDismissDialog] = useState<{ open: boolean; item: PendingItem | null }>({ open: false, item: null });
  const [dismissReason, setDismissReason] = useState("");
  const [authorizeDialog, setAuthorizeDialog] = useState<{ open: boolean; item: PendingItem | null }>({ open: false, item: null });
  const [overrideValue, setOverrideValue] = useState("");
  const [authNote, setAuthNote] = useState("");
  const [snoozeDialog, setSnoozeDialog] = useState<{ open: boolean; item: PendingItem | null }>({ open: false, item: null });
  const [snoozeHours, setSnoozeHours] = useState("24");

  const summaryQuery = useQuery<AuditSummary>({
    queryKey: ["/api/admin/link-audit/summary"],
    refetchInterval: 15000,
  });

  const itemsQuery = useQuery<PendingItem[]>({
    queryKey: ["/api/admin/link-audit/pending", statusFilter, classFilter, searchLinkId, onlyProblematic],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("status", statusFilter);
      if (classFilter !== "all") params.set("classification", classFilter);
      if (searchLinkId.trim()) params.set("linkId", searchLinkId.trim());
      if (onlyProblematic) params.set("onlyProblematic", "true");
      params.set("limit", "1000");
      const res = await apiRequest("GET", `/api/admin/link-audit/pending?${params.toString()}`);
      return res.json();
    },
  });

  const runAuditMutation = useMutation({
    mutationFn: async (onlyProb: boolean) => {
      const res = await apiRequest("POST", "/api/admin/link-audit/run", { onlyProblematic: onlyProb });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Auditoria iniciada", description: "Rodando em segundo plano. Atualize em alguns segundos." });
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/admin/link-audit/summary"] });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/link-audit/pending"] });
      }, 3000);
    },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const authorizeMutation = useMutation({
    mutationFn: async (vars: { id: number; overrideValue?: string; note?: string }) => {
      const res = await apiRequest("POST", `/api/admin/link-audit/items/${vars.id}/authorize`, {
        overrideValue: vars.overrideValue || undefined,
        note: vars.note || undefined,
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: data.applied ? "Aplicado" : "Autorizado",
        description: data.applied ? "Campo atualizado no link." : "Aguardando aplicação manual.",
      });
      setAuthorizeDialog({ open: false, item: null });
      setOverrideValue("");
      setAuthNote("");
      queryClient.invalidateQueries({ queryKey: ["/api/admin/link-audit/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/link-audit/summary"] });
    },
    onError: (err: any) => toast({ title: "Erro ao autorizar", description: err.message, variant: "destructive" }),
  });

  const dismissMutation = useMutation({
    mutationFn: async (vars: { id: number; reason: string }) => {
      const res = await apiRequest("POST", `/api/admin/link-audit/items/${vars.id}/dismiss`, { reason: vars.reason });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Dispensada", description: "A IA aprenderá com o motivo informado." });
      setDismissDialog({ open: false, item: null });
      setDismissReason("");
      queryClient.invalidateQueries({ queryKey: ["/api/admin/link-audit/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/link-audit/summary"] });
    },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const snoozeMutation = useMutation({
    mutationFn: async (vars: { id: number; hours: number }) => {
      const res = await apiRequest("POST", `/api/admin/link-audit/items/${vars.id}/snooze`, { hours: vars.hours });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Adiada" });
      setSnoozeDialog({ open: false, item: null });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/link-audit/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/link-audit/summary"] });
    },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const investigateMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/admin/link-audit/items/${id}/investigate`, {});
      return res.json();
    },
    onSuccess: (data: any) => {
      const valor = data.suggestedValue ?? "—";
      const conf = data.confidence ?? 0;
      toast({
        title: data.suggestedValue ? "IA encontrou um valor" : "IA não conseguiu determinar",
        description: `Valor: ${valor} (confiança ${conf}%)`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/link-audit/pending"] });
    },
    onError: (err: any) => toast({ title: "Erro na investigação", description: err.message, variant: "destructive" }),
  });

  const investigateBatchMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/link-audit/investigate-batch", { limit: 50 });
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Investigação em lote iniciada",
        description: "A IA está descobrindo os valores. Atualize em alguns segundos.",
      });
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/admin/link-audit/pending"] });
      }, 5000);
    },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const policyMutation = useMutation({
    mutationFn: async (vars: { actionPolicy?: Record<string, string>; dailyAuditEnabled?: boolean; dailyAuditHourUtc?: number }) => {
      const res = await apiRequest("PATCH", "/api/admin/link-audit/policy", vars);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Política atualizada" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/link-audit/summary"] });
    },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const items = itemsQuery.data ?? [];
  const summary = summaryQuery.data;
  const policy = summary?.actionPolicy ?? {};

  const grouped = useMemo(() => {
    const map: Record<string, PendingItem[]> = {};
    for (const it of items) {
      const k = it.classification;
      if (!map[k]) map[k] = [];
      map[k].push(it);
    }
    return map;
  }, [items]);

  function fmtDate(s: string | null) {
    if (!s) return "—";
    return new Date(s).toLocaleString("pt-BR");
  }

  function openAuthorize(item: PendingItem) {
    setOverrideValue(item.suggestedValue || "");
    setAuthNote("");
    setAuthorizeDialog({ open: true, item });
  }

  return (
    <div className="space-y-4">
      {/* Header / resumo */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <CardTitle className="flex items-center gap-2">
                <ClipboardList className="h-5 w-5" />
                Pendências de Cadastro
              </CardTitle>
              <CardDescription>
                Auditoria objetiva dos campos críticos dos links. Última execução: {fmtDate(summary?.lastAuditAt ?? null)}
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => runAuditMutation.mutate(true)}
                disabled={runAuditMutation.isPending || summary?.isRunning}
                data-testid="button-audit-problematic"
              >
                <Play className="h-4 w-4 mr-1" />
                Auditar só problemáticos
              </Button>
              <Button
                size="sm"
                onClick={() => runAuditMutation.mutate(false)}
                disabled={runAuditMutation.isPending || summary?.isRunning}
                data-testid="button-audit-full"
              >
                <Play className="h-4 w-4 mr-1" />
                {summary?.isRunning ? "Rodando…" : "Auditoria completa"}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => investigateBatchMutation.mutate()}
                disabled={investigateBatchMutation.isPending}
                data-testid="button-investigate-batch"
                title="A IA vai buscar os valores faltantes (IPs, PPPoE, OLT etc) usando Voalle, Mikrotik, OZmap e RADIUS"
              >
                <Sparkles className="h-4 w-4 mr-1" />
                IA preencher pendências
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            {(["pending", "authorized", "applied", "dismissed", "snoozed", "resolved"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setStatusFilter(k)}
                className={`text-left rounded-md border p-3 transition ${statusFilter === k ? "border-primary bg-accent" : "hover:bg-muted"}`}
                data-testid={`status-card-${k}`}
              >
                <div className="text-xs text-muted-foreground capitalize">{k}</div>
                <div className="text-2xl font-semibold" data-testid={`status-count-${k}`}>
                  {summary?.counts?.[k] ?? 0}
                </div>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Filtros */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Filter className="h-4 w-4" />
            Filtros
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
            <div>
              <Label>Status</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger data-testid="select-status-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Pendente</SelectItem>
                  <SelectItem value="authorized">Autorizada</SelectItem>
                  <SelectItem value="applied">Aplicada</SelectItem>
                  <SelectItem value="dismissed">Dispensada</SelectItem>
                  <SelectItem value="snoozed">Adiada</SelectItem>
                  <SelectItem value="resolved">Resolvida</SelectItem>
                  <SelectItem value="all">Todas</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Classificação</Label>
              <Select value={classFilter} onValueChange={setClassFilter}>
                <SelectTrigger data-testid="select-class-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  <SelectItem value="urgent">Urgente</SelectItem>
                  <SelectItem value="inconsistent">Inconsistente</SelectItem>
                  <SelectItem value="missing">Faltando</SelectItem>
                  <SelectItem value="optimization">Otimização</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Buscar Link ID</Label>
              <Input
                value={searchLinkId}
                onChange={(e) => setSearchLinkId(e.target.value)}
                placeholder="ex: 1234"
                data-testid="input-link-id"
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={onlyProblematic} onCheckedChange={setOnlyProblematic} id="only-problematic" data-testid="switch-only-problematic" />
              <Label htmlFor="only-problematic">Só links offline/degradados</Label>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabela */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">
              {items.length} {items.length === 1 ? "pendência" : "pendências"}
            </CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => itemsQuery.refetch()}
              data-testid="button-refresh"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {itemsQuery.isLoading ? (
            <div className="text-center py-6 text-muted-foreground">Carregando…</div>
          ) : items.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground" data-testid="empty-state">
              Nenhuma pendência no filtro atual.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Link</TableHead>
                  <TableHead>Campo</TableHead>
                  <TableHead>Classificação</TableHead>
                  <TableHead>Ação Sugerida</TableHead>
                  <TableHead>Atual → Sugerido</TableHead>
                  <TableHead>Detectado</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((it) => {
                  const cls = CLASSIFICATION_BADGE[it.classification] ?? CLASSIFICATION_BADGE.missing;
                  const isApplicable = APPLIABLE_FIELDS.includes(it.field) && it.nextStep === "apply_now";
                  const canInvestigate =
                    !it.field.startsWith("_") && (it.suggestedValue == null || it.suggestedValue === "");
                  return (
                    <TableRow key={it.id} data-testid={`row-pending-${it.id}`}>
                      <TableCell>
                        <WouterLink href={`/links/${it.linkId}`}>
                          <a className="text-primary hover:underline" data-testid={`link-${it.linkId}`}>
                            #{it.linkId}
                          </a>
                        </WouterLink>
                      </TableCell>
                      <TableCell>
                        <code className="text-xs">{it.field}</code>
                        {it.reason && <div className="text-xs text-muted-foreground mt-1">{it.reason}</div>}
                      </TableCell>
                      <TableCell>
                        <Badge className={cls.cls}>{cls.label}</Badge>
                      </TableCell>
                      <TableCell className="text-sm">{ACTION_LABEL[it.suggestedAction] ?? it.suggestedAction}</TableCell>
                      <TableCell className="text-xs">
                        <div className="text-muted-foreground line-through">{it.currentValue ?? "—"}</div>
                        <div className="font-medium">{it.suggestedValue ?? "—"}</div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{fmtDate(it.createdAt)}</TableCell>
                      <TableCell className="text-right">
                        {it.status === "pending" && (
                          <div className="flex gap-1 justify-end">
                            {isApplicable && (
                              <Button
                                size="sm"
                                variant="default"
                                onClick={() => openAuthorize(it)}
                                disabled={authorizeMutation.isPending}
                                data-testid={`button-authorize-${it.id}`}
                              >
                                <CheckCircle2 className="h-3 w-3 mr-1" />
                                Autorizar
                              </Button>
                            )}
                            {canInvestigate && (
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => investigateMutation.mutate(it.id)}
                                disabled={investigateMutation.isPending}
                                data-testid={`button-investigate-${it.id}`}
                                title="IA descobre o valor"
                              >
                                <Sparkles className="h-3 w-3 mr-1" />
                                IA
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setSnoozeHours("24");
                                setSnoozeDialog({ open: true, item: it });
                              }}
                              data-testid={`button-snooze-${it.id}`}
                            >
                              <Clock className="h-3 w-3" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setDismissReason("");
                                setDismissDialog({ open: true, item: it });
                              }}
                              data-testid={`button-dismiss-${it.id}`}
                            >
                              <XCircle className="h-3 w-3" />
                            </Button>
                          </div>
                        )}
                        {it.status !== "pending" && (
                          <span className="text-xs text-muted-foreground capitalize">{it.status}</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Política de ação */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Settings className="h-4 w-4" />
            Política de Aplicação por Campo
          </CardTitle>
          <CardDescription>
            "Imediato" = autorizar aplica direto no link. "Só autorizar" = autorização registra mas não altera (aplicação manual depois).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {APPLIABLE_FIELDS.map((field) => {
              const current = (policy[field] as string) ?? "immediate";
              return (
                <div key={field} className="flex items-center justify-between border rounded-md p-2">
                  <code className="text-xs">{field}</code>
                  <Select
                    value={current}
                    onValueChange={(v) =>
                      policyMutation.mutate({ actionPolicy: { ...policy, [field]: v } })
                    }
                  >
                    <SelectTrigger className="w-44" data-testid={`select-policy-${field}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="immediate">Imediato</SelectItem>
                      <SelectItem value="authorize_only">Só autorizar</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              );
            })}
          </div>
          <div className="mt-4 flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Switch
                checked={summary?.dailyAuditEnabled ?? true}
                onCheckedChange={(v) => policyMutation.mutate({ dailyAuditEnabled: v })}
                id="daily-enabled"
                data-testid="switch-daily-enabled"
              />
              <Label htmlFor="daily-enabled">Auditoria diária automática</Label>
            </div>
            <div className="flex items-center gap-2">
              <Label>Hora UTC:</Label>
              <Input
                type="number"
                min={0}
                max={23}
                value={summary?.dailyAuditHourUtc ?? 6}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (!isNaN(n)) policyMutation.mutate({ dailyAuditHourUtc: n });
                }}
                className="w-20"
                data-testid="input-daily-hour"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Dialog: autorizar */}
      <Dialog open={authorizeDialog.open} onOpenChange={(v) => !v && setAuthorizeDialog({ open: false, item: null })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Autorizar pendência</DialogTitle>
            <DialogDescription>
              Campo <code>{authorizeDialog.item?.field}</code> do link #{authorizeDialog.item?.linkId}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Valor a aplicar (opcional, sobrescreve o sugerido)</Label>
              <Input
                value={overrideValue}
                onChange={(e) => setOverrideValue(e.target.value)}
                placeholder={authorizeDialog.item?.suggestedValue ?? ""}
                data-testid="input-override-value"
              />
            </div>
            <div>
              <Label>Nota (opcional)</Label>
              <Textarea value={authNote} onChange={(e) => setAuthNote(e.target.value)} data-testid="input-auth-note" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAuthorizeDialog({ open: false, item: null })}>
              Cancelar
            </Button>
            <Button
              onClick={() =>
                authorizeDialog.item &&
                authorizeMutation.mutate({
                  id: authorizeDialog.item.id,
                  overrideValue: overrideValue || undefined,
                  note: authNote || undefined,
                })
              }
              disabled={authorizeMutation.isPending}
              data-testid="button-confirm-authorize"
            >
              Autorizar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: dispensar */}
      <Dialog open={dismissDialog.open} onOpenChange={(v) => !v && setDismissDialog({ open: false, item: null })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dispensar pendência</DialogTitle>
            <DialogDescription>
              Por que essa pendência não se aplica? Sua resposta vai alimentar o aprendizado da IA.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={dismissReason}
            onChange={(e) => setDismissReason(e.target.value)}
            placeholder="ex: link sem PPPoE por design (corporativo IPoE)"
            rows={4}
            data-testid="input-dismiss-reason"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDismissDialog({ open: false, item: null })}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => dismissDialog.item && dismissMutation.mutate({ id: dismissDialog.item.id, reason: dismissReason })}
              disabled={dismissMutation.isPending || dismissReason.trim().length < 3}
              data-testid="button-confirm-dismiss"
            >
              Dispensar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: adiar */}
      <Dialog open={snoozeDialog.open} onOpenChange={(v) => !v && setSnoozeDialog({ open: false, item: null })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adiar pendência</DialogTitle>
            <DialogDescription>Por quantas horas adiar?</DialogDescription>
          </DialogHeader>
          <Input
            type="number"
            min={1}
            max={720}
            value={snoozeHours}
            onChange={(e) => setSnoozeHours(e.target.value)}
            data-testid="input-snooze-hours"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setSnoozeDialog({ open: false, item: null })}>
              Cancelar
            </Button>
            <Button
              onClick={() =>
                snoozeDialog.item &&
                snoozeMutation.mutate({ id: snoozeDialog.item.id, hours: Math.max(1, Math.min(720, Number(snoozeHours) || 24)) })
              }
              disabled={snoozeMutation.isPending}
              data-testid="button-confirm-snooze"
            >
              Adiar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

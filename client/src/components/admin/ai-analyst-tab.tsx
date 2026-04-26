import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Bot, Play, CheckCircle2, XCircle, Plus, Trash2, KeyRound, AlertTriangle, RefreshCw, Server, Search } from "lucide-react";

interface AiAnalystSettings {
  id: number;
  provider: string;
  model: string;
  autonomyMode: "suggestion" | "hybrid" | "auto";
  autoApplyConfidenceThreshold: number;
  processingEnabled: boolean;
  maxTasksPerMinute: number;
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  hasApiKey: boolean;
  apiKeySource: "env" | "database" | null;
  updatedAt: string;
}

interface AiAnalystTask {
  id: number;
  linkId: number;
  triggerReason: string;
  status: string;
  priority: number;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

interface AiAnalystProposal {
  id: number;
  taskId: number;
  linkId: number;
  classification: "config_error" | "network_issue" | "inconclusive";
  proposedFields: Record<string, unknown>;
  reasoning: string;
  confidence: number;
  modelUsed: string | null;
  status: string;
  reviewerNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

interface BatchStatus {
  running: boolean;
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  startedAt: string | null;
  finishedAt: string | null;
  stopRequested: boolean;
  lastError: string | null;
  lastProposalId: number | null;
}

interface AiAnalystRule {
  id: number;
  ruleText: string;
  scope: Record<string, unknown> | null;
  priority: number;
  isActive: boolean;
  createdAt: string;
}

const classificationLabel: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  config_error: { label: "Erro de cadastro", variant: "destructive" },
  network_issue: { label: "Problema de rede", variant: "secondary" },
  inconclusive: { label: "Inconclusivo", variant: "outline" },
};

const triggerLabel: Record<string, string> = {
  manual: "Manual",
  offline_link: "Link offline",
  degraded_link: "Link degradado",
  voalle_webhook_new: "Novo (Voalle)",
  batch_diagnostic: "Diagnóstico em lote",
};

export function AiAnalystTab() {
  const { toast } = useToast();
  const [activeSection, setActiveSection] = useState("triagem");

  // ---------- SETTINGS ----------
  const settingsQuery = useQuery<AiAnalystSettings>({
    queryKey: ["/api/admin/ai-analyst/settings"],
  });

  const updateSettings = useMutation({
    mutationFn: async (data: Partial<AiAnalystSettings>) => {
      const res = await apiRequest("PATCH", "/api/admin/ai-analyst/settings", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/ai-analyst/settings"] });
      toast({ title: "Configurações atualizadas" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const [apiKeyInput, setApiKeyInput] = useState("");
  const saveApiKey = useMutation({
    mutationFn: async (apiKey: string) => {
      const res = await apiRequest("POST", "/api/admin/ai-analyst/api-key", { apiKey });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/ai-analyst/settings"] });
      setApiKeyInput("");
      toast({ title: "Chave salva", description: "Chave da Anthropic armazenada com segurança." });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const removeApiKey = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", "/api/admin/ai-analyst/api-key");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/ai-analyst/settings"] });
      toast({ title: "Chave removida" });
    },
  });

  // ---------- PROPOSALS ----------
  const proposalsQuery = useQuery<AiAnalystProposal[]>({
    queryKey: ["/api/admin/ai-analyst/proposals", "pending_review"],
    queryFn: async () => {
      const res = await fetch("/api/admin/ai-analyst/proposals?status=pending_review&limit=200", {
        credentials: "include",
      });
      return res.json();
    },
    refetchInterval: 15000,
  });

  const queueQuery = useQuery<AiAnalystTask[]>({
    queryKey: ["/api/admin/ai-analyst/queue", "pending"],
    queryFn: async () => {
      const res = await fetch("/api/admin/ai-analyst/queue?status=pending&limit=100", { credentials: "include" });
      return res.json();
    },
    refetchInterval: 15000,
  });

  const enqueueOffline = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/ai-analyst/enqueue", { autoSelect: "offline" });
      return res.json();
    },
    onSuccess: (data: { enqueued: number; skipped: number }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/ai-analyst/queue"] });
      toast({
        title: "Links offline enfileirados",
        description: `${data.enqueued} novos / ${data.skipped} já estavam na fila`,
      });
    },
  });

  const enqueueDegraded = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/ai-analyst/enqueue", { autoSelect: "degraded" });
      return res.json();
    },
    onSuccess: (data: { enqueued: number; skipped: number }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/ai-analyst/queue"] });
      toast({
        title: "Links degradados enfileirados",
        description: `${data.enqueued} novos / ${data.skipped} já estavam na fila`,
      });
    },
  });

  const processNext = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/ai-analyst/process-next");
      return res.json();
    },
    onSuccess: (data: { processed: boolean; proposalId?: number; error?: string }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/ai-analyst/queue"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/ai-analyst/proposals"] });
      if (data.error) toast({ title: "Aviso", description: data.error });
      else if (data.processed) toast({ title: "Task processada", description: data.proposalId ? `Proposta #${data.proposalId} criada` : "" });
      else toast({ title: "Nenhuma task pendente" });
    },
  });

  const reclaimStuck = useMutation({
    mutationFn: async (force: boolean) => {
      const res = await apiRequest("POST", "/api/admin/ai-analyst/reclaim-stuck", { force });
      return res.json();
    },
    onSuccess: (data: { requeued: number; failed: number; ids: number[] }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/ai-analyst/queue"] });
      if (data.requeued === 0 && data.failed === 0) {
        toast({ title: "Nenhuma task travada", description: "A fila está saudável." });
      } else {
        toast({
          title: "Recovery executado",
          description: `${data.requeued} reenfileirada(s), ${data.failed} marcada(s) como falha. IDs: ${data.ids.join(", ")}`,
        });
      }
    },
    onError: (err: any) => {
      toast({ title: "Erro no recovery", description: err.message, variant: "destructive" });
    },
  });

  // Status do lote (polling a cada 2s só enquanto está rodando)
  const { data: batchStatus } = useQuery<BatchStatus>({
    queryKey: ["/api/admin/ai-analyst/batch/status"],
    refetchInterval: (q) => ((q.state.data as BatchStatus | undefined)?.running ? 2000 : false),
  });

  const [batchCount, setBatchCount] = useState<number>(10);

  const startBatch = useMutation({
    mutationFn: async (count: number) => {
      const res = await apiRequest("POST", "/api/admin/ai-analyst/batch/start", { count });
      return res.json();
    },
    onSuccess: (data: any) => {
      if (data.started) {
        toast({ title: "Lote iniciado", description: `Processando até ${data.status.total} task(s) em segundo plano…` });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/ai-analyst/batch/status"] });
      } else {
        toast({ title: "Não foi possível iniciar", description: data.reason || "tente novamente", variant: "destructive" });
      }
    },
    onError: (err: any) => toast({ title: "Erro ao iniciar lote", description: err.message, variant: "destructive" }),
  });

  const stopBatch = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/ai-analyst/batch/stop");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Solicitado parar lote", description: "Vai concluir a task atual e parar." });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/ai-analyst/batch/status"] });
    },
  });

  // Quando o lote terminar (running passa de true→false), atualizar listas de propostas e fila
  const lastRunningRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (!batchStatus) return;
    if (lastRunningRef.current === true && batchStatus.running === false) {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/ai-analyst/queue"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/ai-analyst/proposals"] });
      toast({
        title: "Lote concluído",
        description: `${batchStatus.succeeded} ok · ${batchStatus.failed} falhas · ${batchStatus.skipped} puladas`,
      });
    }
    lastRunningRef.current = batchStatus.running;
  }, [batchStatus, toast]);

  const approveProposal = useMutation({
    mutationFn: async ({ id, overrideFields, note }: { id: number; overrideFields?: Record<string, unknown>; note?: string }) => {
      const res = await apiRequest("POST", `/api/admin/ai-analyst/proposals/${id}/approve`, {
        overrideFields,
        reviewerNote: note,
      });
      return res.json();
    },
    onSuccess: (data: { ok: boolean; correctionsLogged: number }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/ai-analyst/proposals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/ai-analyst/queue"] });
      toast({
        title: "Proposta aplicada",
        description: data.correctionsLogged > 0 ? `${data.correctionsLogged} correção(ões) registrada(s) para aprendizado` : "Aplicado sem alterações",
      });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const rejectProposal = useMutation({
    mutationFn: async ({ id, note }: { id: number; note?: string }) => {
      const res = await apiRequest("POST", `/api/admin/ai-analyst/proposals/${id}/reject`, { reviewerNote: note });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/ai-analyst/proposals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/ai-analyst/queue"] });
      toast({ title: "Proposta rejeitada" });
    },
  });

  // ---------- RULES ----------
  const rulesQuery = useQuery<AiAnalystRule[]>({
    queryKey: ["/api/admin/ai-analyst/rules"],
    queryFn: async () => {
      const res = await fetch("/api/admin/ai-analyst/rules?activeOnly=false", { credentials: "include" });
      return res.json();
    },
  });

  const [newRuleText, setNewRuleText] = useState("");
  const createRule = useMutation({
    mutationFn: async (ruleText: string) => {
      const res = await apiRequest("POST", "/api/admin/ai-analyst/rules", { ruleText });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/ai-analyst/rules"] });
      setNewRuleText("");
      toast({ title: "Regra criada" });
    },
  });

  const toggleRule = useMutation({
    mutationFn: async ({ id, isActive }: { id: number; isActive: boolean }) => {
      const res = await apiRequest("PATCH", `/api/admin/ai-analyst/rules/${id}`, { isActive });
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/admin/ai-analyst/rules"] }),
  });

  const deleteRule = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/admin/ai-analyst/rules/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/ai-analyst/rules"] });
      toast({ title: "Regra removida" });
    },
  });

  const settings = settingsQuery.data;
  const proposals = proposalsQuery.data || [];
  const queue = queueQuery.data || [];
  const rules = rulesQuery.data || [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="w-5 h-5" />
            Analista de IA
          </CardTitle>
          <CardDescription>
            Triagem automática de links com problema. A IA investiga, propõe correções e aprende com suas decisões.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!settings?.hasApiKey && (
            <div className="flex items-start gap-3 p-3 rounded-md border border-yellow-500/40 bg-yellow-500/10" data-testid="alert-no-api-key">
              <AlertTriangle className="w-5 h-5 text-yellow-600 mt-0.5 flex-shrink-0" />
              <div className="text-sm">
                <p className="font-medium">Chave da Anthropic não configurada</p>
                <p className="text-muted-foreground">
                  Vá para a aba <strong>Configurações</strong> abaixo e cadastre a chave para ativar o analista. Sem ela, o sistema apenas coleta o contexto e gera propostas vazias (modo simulação).
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Tabs value={activeSection} onValueChange={setActiveSection} className="space-y-4">
        <TabsList>
          <TabsTrigger value="triagem" data-testid="tab-ai-triagem">
            Triagem ({proposals.length})
          </TabsTrigger>
          <TabsTrigger value="fila" data-testid="tab-ai-fila">
            Fila ({queue.length})
          </TabsTrigger>
          <TabsTrigger value="regras" data-testid="tab-ai-regras">
            Regras
          </TabsTrigger>
          <TabsTrigger value="config" data-testid="tab-ai-config">
            Configurações
          </TabsTrigger>
          <TabsTrigger value="monsta" data-testid="tab-ai-monsta">
            Monsta
          </TabsTrigger>
        </TabsList>

        {/* ============ TRIAGEM ============ */}
        <TabsContent value="triagem" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Propostas pendentes de revisão</CardTitle>
              <CardDescription>
                A IA analisou esses links e propôs correções. Revise e aprove (ou rejeite) cada uma.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {proposals.length === 0 ? (
                <p className="text-sm text-muted-foreground" data-testid="text-no-proposals">
                  Nenhuma proposta pendente. Adicione links na fila e processe-os.
                </p>
              ) : (
                <div className="space-y-3">
                  {proposals.map((p) => (
                    <ProposalCard
                      key={p.id}
                      proposal={p}
                      onApprove={(overrideFields, note) => approveProposal.mutate({ id: p.id, overrideFields, note })}
                      onReject={(note) => rejectProposal.mutate({ id: p.id, note })}
                      isApproving={approveProposal.isPending}
                      isRejecting={rejectProposal.isPending}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ============ FILA ============ */}
        <TabsContent value="fila" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Adicionar links à fila</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button
                onClick={() => enqueueOffline.mutate()}
                disabled={enqueueOffline.isPending}
                data-testid="button-enqueue-offline"
              >
                <Plus className="w-4 h-4 mr-1" />
                Enfileirar links offline
              </Button>
              <Button
                variant="secondary"
                onClick={() => enqueueDegraded.mutate()}
                disabled={enqueueDegraded.isPending}
                data-testid="button-enqueue-degraded"
              >
                <Plus className="w-4 h-4 mr-1" />
                Enfileirar links degradados
              </Button>
              <Button
                variant="outline"
                onClick={() => processNext.mutate()}
                disabled={processNext.isPending || batchStatus?.running}
                data-testid="button-process-next"
              >
                <Play className="w-4 h-4 mr-1" />
                Processar próxima task
              </Button>
              <Button
                variant="ghost"
                onClick={() => reclaimStuck.mutate(true)}
                disabled={reclaimStuck.isPending}
                data-testid="button-reclaim-stuck"
                title="Destrava tasks que ficaram presas em 'investigating' (após restart, crash ou loop preso)"
              >
                <RefreshCw className={`w-4 h-4 mr-1 ${reclaimStuck.isPending ? "animate-spin" : ""}`} />
                Destravar tasks presas
              </Button>
            </CardContent>
          </Card>

          {/* Processamento em lote */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Processar em lote</CardTitle>
              <CardDescription>
                Processa N tasks em sequência (uma por vez), em segundo plano. Use isto para conciliar a fila inteira sem clicar task a task.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {batchStatus?.running ? (
                <>
                  <div className="text-sm font-medium">
                    Em andamento: {batchStatus.processed} / {batchStatus.total}
                    {" · "}
                    <span className="text-green-600">{batchStatus.succeeded} ok</span>
                    {batchStatus.failed > 0 && <> · <span className="text-red-600">{batchStatus.failed} falhas</span></>}
                    {batchStatus.skipped > 0 && <> · <span className="text-muted-foreground">{batchStatus.skipped} puladas</span></>}
                  </div>
                  <div className="w-full bg-muted rounded h-2 overflow-hidden">
                    <div
                      className="h-full bg-primary transition-all"
                      style={{ width: `${(batchStatus.processed / Math.max(1, batchStatus.total)) * 100}%` }}
                      data-testid="progress-batch"
                    />
                  </div>
                  {batchStatus.lastError && (
                    <p className="text-xs text-muted-foreground">Último aviso: {batchStatus.lastError}</p>
                  )}
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => stopBatch.mutate()}
                    disabled={stopBatch.isPending || batchStatus.stopRequested}
                    data-testid="button-stop-batch"
                  >
                    <XCircle className="w-4 h-4 mr-1" />
                    {batchStatus.stopRequested ? "Parando…" : "Parar lote"}
                  </Button>
                </>
              ) : (
                <>
                  <div className="flex items-end gap-2 flex-wrap">
                    <div>
                      <Label htmlFor="batch-count" className="text-xs">Quantas tasks</Label>
                      <Input
                        id="batch-count"
                        type="number"
                        min={1}
                        max={500}
                        value={batchCount}
                        onChange={(e) => setBatchCount(Math.max(1, Math.min(500, Number(e.target.value) || 1)))}
                        className="w-28"
                        data-testid="input-batch-count"
                      />
                    </div>
                    <Button
                      onClick={() => startBatch.mutate(batchCount)}
                      disabled={startBatch.isPending || queue.length === 0}
                      data-testid="button-start-batch"
                    >
                      <Play className="w-4 h-4 mr-1" />
                      Processar {Math.min(batchCount, queue.length)} task(s)
                    </Button>
                    {queue.length > 0 && batchCount < queue.length && (
                      <Button
                        variant="outline"
                        onClick={() => { setBatchCount(queue.length); startBatch.mutate(queue.length); }}
                        disabled={startBatch.isPending}
                        data-testid="button-start-batch-all"
                      >
                        Processar fila inteira ({queue.length})
                      </Button>
                    )}
                  </div>
                  {batchStatus && batchStatus.processed > 0 && batchStatus.finishedAt && (
                    <p className="text-xs text-muted-foreground">
                      Último lote: {batchStatus.succeeded} ok · {batchStatus.failed} falhas · {batchStatus.skipped} puladas
                      {batchStatus.lastError ? ` · ${batchStatus.lastError}` : ""}
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Tasks pendentes ({queue.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {queue.length === 0 ? (
                <p className="text-sm text-muted-foreground">Fila vazia.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Link</TableHead>
                      <TableHead>Motivo</TableHead>
                      <TableHead>Prioridade</TableHead>
                      <TableHead>Criada</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {queue.map((t) => (
                      <TableRow key={t.id} data-testid={`row-task-${t.id}`}>
                        <TableCell>#{t.linkId}</TableCell>
                        <TableCell>{triggerLabel[t.triggerReason] || t.triggerReason}</TableCell>
                        <TableCell>{t.priority}</TableCell>
                        <TableCell>{new Date(t.createdAt).toLocaleString("pt-BR")}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ============ REGRAS ============ */}
        <TabsContent value="regras" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Ensinar uma regra ao analista</CardTitle>
              <CardDescription>
                Escreva em português livre. Ex: "Clientes da região Sul sempre vão no concentrador BNG-Sul" ou
                "Se o nome do plano contém 'Dedicado', marcar authType=corporate".
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Textarea
                placeholder="Descreva a regra em português..."
                value={newRuleText}
                onChange={(e) => setNewRuleText(e.target.value)}
                rows={3}
                data-testid="textarea-new-rule"
              />
              <Button
                onClick={() => createRule.mutate(newRuleText)}
                disabled={createRule.isPending || newRuleText.trim().length < 3}
                data-testid="button-create-rule"
              >
                <Plus className="w-4 h-4 mr-1" />
                Adicionar regra
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Regras cadastradas ({rules.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {rules.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma regra cadastrada ainda.</p>
              ) : (
                <div className="space-y-2">
                  {rules.map((r) => (
                    <div
                      key={r.id}
                      className="flex items-start gap-3 p-3 border rounded-md"
                      data-testid={`row-rule-${r.id}`}
                    >
                      <Switch
                        checked={r.isActive}
                        onCheckedChange={(checked) => toggleRule.mutate({ id: r.id, isActive: checked })}
                        data-testid={`switch-rule-${r.id}`}
                      />
                      <div className="flex-1">
                        <p className="text-sm">{r.ruleText}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Prioridade {r.priority} · {r.isActive ? "Ativa" : "Inativa"} · Criada{" "}
                          {new Date(r.createdAt).toLocaleString("pt-BR")}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteRule.mutate(r.id)}
                        data-testid={`button-delete-rule-${r.id}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ============ CONFIG ============ */}
        <TabsContent value="config" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <KeyRound className="w-4 h-4" />
                Chave da Anthropic
              </CardTitle>
              <CardDescription>
                A chave é criptografada antes de ser armazenada. Nunca é exibida em claro.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2 text-sm flex-wrap">
                Status:{" "}
                {settings?.hasApiKey ? (
                  <Badge variant="default">Configurada</Badge>
                ) : (
                  <Badge variant="outline">Não configurada</Badge>
                )}
                {settings?.apiKeySource === "env" && (
                  <Badge variant="secondary" data-testid="badge-key-source-env">
                    via variável de ambiente (ANTHROPIC_API_KEY)
                  </Badge>
                )}
                {settings?.apiKeySource === "database" && (
                  <Badge variant="secondary">via banco (criptografada)</Badge>
                )}
              </div>
              {settings?.apiKeySource === "env" && (
                <p className="text-xs text-muted-foreground">
                  A chave já está configurada como variável de ambiente. Você não precisa cadastrar uma chave abaixo —
                  ela tem prioridade sobre qualquer chave salva no banco.
                </p>
              )}
              <div className="flex gap-2">
                <Input
                  type="password"
                  placeholder="sk-ant-api03-..."
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  data-testid="input-api-key"
                />
                <Button
                  onClick={() => saveApiKey.mutate(apiKeyInput)}
                  disabled={saveApiKey.isPending || apiKeyInput.length < 10}
                  data-testid="button-save-api-key"
                >
                  Salvar
                </Button>
                {settings?.hasApiKey && (
                  <Button
                    variant="destructive"
                    onClick={() => removeApiKey.mutate()}
                    disabled={removeApiKey.isPending}
                    data-testid="button-remove-api-key"
                  >
                    Remover
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Comportamento</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Modelo</Label>
                <Input
                  value={settings?.model || ""}
                  onChange={(e) => settings && updateSettings.mutate({ model: e.target.value })}
                  data-testid="input-model"
                />
              </div>

              <div className="space-y-2">
                <Label>Modo de autonomia</Label>
                <Select
                  value={settings?.autonomyMode}
                  onValueChange={(v) => updateSettings.mutate({ autonomyMode: v as any })}
                >
                  <SelectTrigger data-testid="select-autonomy-mode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="suggestion">Sugestão (você aprova tudo)</SelectItem>
                    <SelectItem value="hybrid">Híbrido (auto-aplica se confiança alta)</SelectItem>
                    <SelectItem value="auto">Automático (aplica tudo)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {settings?.autonomyMode === "hybrid" && (
                <div className="space-y-2">
                  <Label>Limiar de confiança para auto-aplicar (%)</Label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={settings.autoApplyConfidenceThreshold}
                    onChange={(e) =>
                      updateSettings.mutate({ autoApplyConfidenceThreshold: Number(e.target.value) })
                    }
                    data-testid="input-confidence-threshold"
                  />
                </div>
              )}

              <div className="flex items-center justify-between pt-2 border-t">
                <div>
                  <Label>Processamento contínuo em background</Label>
                  <p className="text-xs text-muted-foreground">Processa a fila automaticamente sem precisar clicar.</p>
                </div>
                <Switch
                  checked={settings?.processingEnabled || false}
                  onCheckedChange={(checked) => updateSettings.mutate({ processingEnabled: checked })}
                  data-testid="switch-processing-enabled"
                />
              </div>

              <div className="space-y-2">
                <Label>Limite de tasks por minuto</Label>
                <Input
                  type="number"
                  min={1}
                  max={60}
                  value={settings?.maxTasksPerMinute || 5}
                  onChange={(e) => updateSettings.mutate({ maxTasksPerMinute: Number(e.target.value) })}
                  data-testid="input-rate-limit"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Uso acumulado</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Custo total</p>
                <p className="font-mono font-semibold">US$ {(settings?.totalCostUsd ?? 0).toFixed(4)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Tokens entrada</p>
                <p className="font-mono font-semibold">{(settings?.totalInputTokens ?? 0).toLocaleString("pt-BR")}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Tokens saída</p>
                <p className="font-mono font-semibold">{(settings?.totalOutputTokens ?? 0).toLocaleString("pt-BR")}</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ============ MONSTA (teste de integração) ============ */}
        <TabsContent value="monsta" className="space-y-4">
          <MonstaTestPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// =====================================================================
// Painel de teste da integração Monsta (consulta status/eventos/busca)
// =====================================================================

interface MonstaSettings {
  configured: boolean;
  source: "db" | "env" | null;
  host: string | null;
  port: number | null;
  username: string | null;
  hasKey: boolean;
}

function MonstaTestPanel() {
  const { toast } = useToast();
  const [ip, setIp] = useState("");
  const [searchQ, setSearchQ] = useState("");
  const [hours, setHours] = useState(24);
  const [statusResult, setStatusResult] = useState<any>(null);
  const [eventsResult, setEventsResult] = useState<any>(null);
  const [searchResult, setSearchResult] = useState<any>(null);

  // ----- Configuração -----
  const { data: settings } = useQuery<MonstaSettings>({
    queryKey: ["/api/admin/monsta/settings"],
  });
  const [cfgHost, setCfgHost] = useState("");
  const [cfgPort, setCfgPort] = useState(2266);
  const [cfgUser, setCfgUser] = useState("monstaro");
  const [cfgKey, setCfgKey] = useState("");
  const [cfgActive, setCfgActive] = useState(true);

  // Sincroniza form com dados carregados (1ª vez)
  useEffect(() => {
    if (settings) {
      setCfgHost(settings.host ?? "");
      setCfgPort(settings.port ?? 2266);
      setCfgUser(settings.username ?? "monstaro");
    }
  }, [settings]);

  const saveSettings = useMutation({
    mutationFn: async () => {
      const body: any = { host: cfgHost.trim(), port: cfgPort, username: cfgUser.trim(), isActive: cfgActive };
      if (cfgKey.trim()) body.privateKey = cfgKey.trim();
      const r = await fetch("/api/admin/monsta/settings", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await r.json();
      if (!r.ok) throw new Error(json?.error || "erro");
      return json;
    },
    onSuccess: () => {
      setCfgKey("");
      queryClient.invalidateQueries({ queryKey: ["/api/admin/monsta/settings"] });
      toast({ title: "Configuração salva", description: "Pronto pra testar a conexão." });
    },
    onError: (e: any) => toast({ title: "Erro ao salvar", description: String(e?.message || e), variant: "destructive" }),
  });

  const ping = useMutation({
    mutationFn: () => fetch("/api/admin/monsta/ping", { credentials: "include" }).then((r) => r.json()),
    onSuccess: (data) => {
      if (data?.ok) {
        toast({ title: "Monsta online", description: `${data.deviceCount ?? 0} devices cadastrados` });
      } else {
        toast({ title: "Monsta offline", description: data?.error || "Sem resposta", variant: "destructive" });
      }
    },
    onError: (e: any) => toast({ title: "Erro", description: String(e?.message || e), variant: "destructive" }),
  });

  const queryStatus = useMutation({
    mutationFn: async () => {
      if (!ip.trim()) throw new Error("Informe o IP");
      const r = await fetch(`/api/admin/monsta/device-status?ip=${encodeURIComponent(ip.trim())}`, { credentials: "include" });
      if (!r.ok) throw new Error((await r.json())?.error || "erro");
      return r.json();
    },
    onSuccess: (data) => setStatusResult(data),
    onError: (e: any) => {
      setStatusResult(null);
      toast({ title: "Erro", description: String(e?.message || e), variant: "destructive" });
    },
  });

  const queryEvents = useMutation({
    mutationFn: async () => {
      if (!ip.trim()) throw new Error("Informe o IP");
      const r = await fetch(`/api/admin/monsta/events?ip=${encodeURIComponent(ip.trim())}&hours=${hours}`, { credentials: "include" });
      if (!r.ok) throw new Error((await r.json())?.error || "erro");
      return r.json();
    },
    onSuccess: (data) => setEventsResult(data),
    onError: (e: any) => {
      setEventsResult(null);
      toast({ title: "Erro", description: String(e?.message || e), variant: "destructive" });
    },
  });

  const querySearch = useMutation({
    mutationFn: async () => {
      if (!searchQ.trim()) throw new Error("Informe um padrão de busca");
      const r = await fetch(`/api/admin/monsta/search?q=${encodeURIComponent(searchQ.trim())}&limit=20`, { credentials: "include" });
      if (!r.ok) throw new Error((await r.json())?.error || "erro");
      return r.json();
    },
    onSuccess: (data) => setSearchResult(data),
    onError: (e: any) => {
      setSearchResult(null);
      toast({ title: "Erro", description: String(e?.message || e), variant: "destructive" });
    },
  });

  return (
    <div className="space-y-4">
      {/* ===== Configuração ===== */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <KeyRound className="h-4 w-4" />
            Configuração da conexão SSH
          </CardTitle>
          <CardDescription>
            Credenciais de acesso ao servidor Monsta. A chave é armazenada criptografada no banco. Se já houver `MONSTA_SSH_*` em variáveis de ambiente, elas são usadas como fallback (mas a configuração no banco tem prioridade).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Status:</span>
            {settings?.configured ? (
              <Badge variant="default" data-testid="badge-monsta-config-status">
                Configurado · origem: {settings.source === "db" ? "banco" : "variável de ambiente"}
              </Badge>
            ) : (
              <Badge variant="destructive" data-testid="badge-monsta-config-status">Não configurado</Badge>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <Label htmlFor="cfg-host">Host / IP *</Label>
              <Input
                id="cfg-host"
                placeholder="191.52.248.66"
                value={cfgHost}
                onChange={(e) => setCfgHost(e.target.value)}
                data-testid="input-monsta-cfg-host"
              />
            </div>
            <div>
              <Label htmlFor="cfg-port">Porta SSH</Label>
              <Input
                id="cfg-port"
                type="number"
                min={1}
                max={65535}
                value={cfgPort}
                onChange={(e) => setCfgPort(Math.max(1, Math.min(65535, Number(e.target.value) || 2266)))}
                data-testid="input-monsta-cfg-port"
              />
            </div>
            <div>
              <Label htmlFor="cfg-user">Usuário SSH</Label>
              <Input
                id="cfg-user"
                placeholder="monstaro"
                value={cfgUser}
                onChange={(e) => setCfgUser(e.target.value)}
                data-testid="input-monsta-cfg-user"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="cfg-key">
              Chave privada (OpenSSH)
              {settings?.hasKey && <span className="text-muted-foreground ml-2 text-xs">— deixe em branco para manter a atual</span>}
            </Label>
            <Textarea
              id="cfg-key"
              rows={4}
              placeholder="-----BEGIN OPENSSH PRIVATE KEY-----..."
              value={cfgKey}
              onChange={(e) => setCfgKey(e.target.value)}
              className="font-mono text-xs"
              data-testid="input-monsta-cfg-key"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Pode colar com ou sem quebras de linha — o servidor reconstrói o formato automaticamente.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Switch
              checked={cfgActive}
              onCheckedChange={setCfgActive}
              data-testid="switch-monsta-cfg-active"
            />
            <Label className="text-sm">Integração ativa</Label>
            <div className="flex-1" />
            <Button
              onClick={() => saveSettings.mutate()}
              disabled={saveSettings.isPending || !cfgHost.trim() || (!settings?.hasKey && !cfgKey.trim())}
              data-testid="button-monsta-save-config"
            >
              {saveSettings.isPending ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : null}
              Salvar configuração
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ===== Ping ===== */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Server className="h-4 w-4" />
            Teste de conexão
          </CardTitle>
          <CardDescription>
            Valida o acesso SSH ao servidor Monsta e exercita as 3 ferramentas que o Analista IA usa para enriquecer triagem.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            onClick={() => ping.mutate()}
            disabled={ping.isPending || !settings?.configured}
            variant="outline"
            data-testid="button-monsta-ping"
          >
            {ping.isPending ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Server className="h-4 w-4 mr-2" />}
            Testar conexão (ping)
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Consulta por IP</CardTitle>
          <CardDescription>
            Status atual do device, dados SNMP cadastrados e contagem de eventos abertos. Esta é a fonte mais fiel para validar IP de monitoramento.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[200px]">
              <Label htmlFor="monsta-ip">IP do device</Label>
              <Input
                id="monsta-ip"
                placeholder="ex: 191.52.249.162"
                value={ip}
                onChange={(e) => setIp(e.target.value)}
                data-testid="input-monsta-ip"
              />
            </div>
            <div className="w-28">
              <Label htmlFor="monsta-hours">Janela (h)</Label>
              <Input
                id="monsta-hours"
                type="number"
                min={1}
                max={168}
                value={hours}
                onChange={(e) => setHours(Math.max(1, Math.min(168, Number(e.target.value) || 24)))}
                data-testid="input-monsta-hours"
              />
            </div>
            <Button
              onClick={() => queryStatus.mutate()}
              disabled={queryStatus.isPending || !ip.trim()}
              data-testid="button-monsta-status"
            >
              {queryStatus.isPending ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : null}
              Status
            </Button>
            <Button
              onClick={() => queryEvents.mutate()}
              disabled={queryEvents.isPending || !ip.trim()}
              variant="outline"
              data-testid="button-monsta-events"
            >
              {queryEvents.isPending ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : null}
              Eventos
            </Button>
          </div>

          {statusResult && (
            <div className="rounded border p-3 bg-muted/30" data-testid="result-monsta-status">
              <p className="text-xs text-muted-foreground mb-2">Resultado — status</p>
              {statusResult.found === false ? (
                <p className="text-sm">{statusResult.message}</p>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm">
                  <div><span className="text-muted-foreground">Nome:</span> <span className="font-medium">{statusResult.device?.name}</span></div>
                  <div><span className="text-muted-foreground">Status:</span> <Badge variant={statusResult.device?.status === "DeviceUp" ? "default" : "destructive"}>{statusResult.device?.status}</Badge></div>
                  <div><span className="text-muted-foreground">IP:</span> <span className="font-mono">{statusResult.device?.ip}</span></div>
                  <div><span className="text-muted-foreground">SNMP community:</span> <span className="font-mono">{statusResult.device?.snmpCommunity ?? "—"}</span></div>
                  <div><span className="text-muted-foreground">SNMP v:</span> {statusResult.device?.snmpVersion ?? "—"}</div>
                  <div><span className="text-muted-foreground">SNMP porta:</span> {statusResult.device?.snmpPort ?? "—"}</div>
                  <div><span className="text-muted-foreground">Eventos abertos:</span> {statusResult.openEventsCount}</div>
                  <div><span className="text-muted-foreground">Última mudança:</span> <span className="font-mono text-xs">{statusResult.device?.lastStatusChangeAt ?? "—"}</span></div>
                  <div><span className="text-muted-foreground">Inativo:</span> {statusResult.device?.isInactive ? "sim" : "não"}</div>
                </div>
              )}
            </div>
          )}

          {eventsResult && (
            <div className="rounded border p-3 bg-muted/30" data-testid="result-monsta-events">
              <p className="text-xs text-muted-foreground mb-2">Resultado — eventos ({hours}h)</p>
              {eventsResult.found === false ? (
                <p className="text-sm">{eventsResult.message}</p>
              ) : eventsResult.events?.length === 0 ? (
                <p className="text-sm">Nenhum evento na janela.</p>
              ) : (
                <div className="text-xs font-mono max-h-64 overflow-auto">
                  {eventsResult.events.map((ev: any, i: number) => (
                    <div key={i} className="border-b py-1">
                      <span className="text-muted-foreground">{ev.createdAt}</span> · {ev.severity} · {ev.message}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Buscar device por nome ou IP parcial</CardTitle>
          <CardDescription>
            Útil quando o IP no Link Monitor não é o de monitoramento real. Tente número de contrato, fragmento de nome ou octetos do IP — nomes divergem entre Voalle/Monsta/Zabbix.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[240px]">
              <Label htmlFor="monsta-search">Padrão (LIKE %padrão%)</Label>
              <Input
                id="monsta-search"
                placeholder="ex: 2111, Alpha-Matriz, 249.162"
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                data-testid="input-monsta-search"
              />
            </div>
            <Button
              onClick={() => querySearch.mutate()}
              disabled={querySearch.isPending || !searchQ.trim()}
              data-testid="button-monsta-search"
            >
              {querySearch.isPending ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Search className="h-4 w-4 mr-2" />}
              Buscar
            </Button>
          </div>

          {searchResult?.items && (
            <div className="rounded border" data-testid="result-monsta-search">
              {searchResult.items.length === 0 ? (
                <p className="text-sm p-3">Nenhum device encontrado.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16">ID</TableHead>
                      <TableHead>Nome</TableHead>
                      <TableHead className="w-36">IP</TableHead>
                      <TableHead className="w-28">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {searchResult.items.map((d: any) => (
                      <TableRow key={d.id}>
                        <TableCell className="font-mono text-xs">{d.id}</TableCell>
                        <TableCell>
                          <button
                            className="text-left hover:underline"
                            onClick={() => d.ip && setIp(d.ip)}
                            data-testid={`button-pick-ip-${d.id}`}
                          >
                            {d.name}
                          </button>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{d.ip ?? "—"}</TableCell>
                        <TableCell>
                          <Badge variant={d.status === "DeviceUp" ? "default" : "destructive"}>{d.status}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// =====================================================================
// Card de uma proposta individual (com edição inline antes de aprovar)
// =====================================================================

type FieldKind =
  | "text"
  | "number"
  | "boolean"
  | "select-concentrator"
  | "select-olt"
  | "select-snmp-profile"
  | "select-equipment-vendor"
  | "select-switch"
  | "select-access-point"
  | "select-traffic-source"
  | "select-link-type"
  | "select-auth-type"
  | "object-default-cpe"
  | "object-olt-snmp-enable";

interface FieldMeta {
  kind: FieldKind;
  label?: string;
}

const FIELD_META: Record<string, FieldMeta> = {
  snmpInterfaceAlias: { kind: "text", label: "SNMP Interface Alias" },
  snmpInterfaceIndex: { kind: "number", label: "SNMP Interface Index" },
  snmpInterfaceName: { kind: "text", label: "SNMP Interface Name" },
  snmpInterfaceDescr: { kind: "text", label: "SNMP Interface Descr" },
  snmpRouterIp: { kind: "text", label: "IP do Roteador SNMP" },
  monitoredIp: { kind: "text", label: "IP de Monitoramento" },
  concentratorId: { kind: "select-concentrator", label: "Concentrador" },
  snmpProfileId: { kind: "select-snmp-profile", label: "Perfil SNMP" },
  pppoeUser: { kind: "text", label: "Usuário PPPoE" },
  vlan: { kind: "number", label: "VLAN" },
  vlanInterface: { kind: "text", label: "Interface VLAN" },
  trafficSourceType: { kind: "select-traffic-source", label: "Tipo de Coleta" },
  accessPointId: { kind: "select-access-point", label: "Ponto de Acesso" },
  accessPointInterfaceIndex: { kind: "number", label: "AP Interface Index" },
  accessPointInterfaceName: { kind: "text", label: "AP Interface Name" },
  equipmentVendorId: { kind: "select-equipment-vendor", label: "Fabricante do CPE" },
  equipmentModel: { kind: "text", label: "Modelo do CPE" },
  equipmentSerialNumber: { kind: "text", label: "Serial do CPE" },
  oltId: { kind: "select-olt", label: "OLT" },
  slotOlt: { kind: "number", label: "Slot da OLT" },
  portOlt: { kind: "number", label: "Porta da OLT" },
  onuSearchString: { kind: "text", label: "String de busca da ONU" },
  onuId: { kind: "text", label: "ID da ONU" },
  switchId: { kind: "select-switch", label: "Switch" },
  switchPort: { kind: "text", label: "Porta do Switch" },
  cpeVendor: { kind: "text", label: "Vendor (livre)" },
  ozmapTag: { kind: "text", label: "OZmap Tag" },
  ipBlock: { kind: "text", label: "Bloco IP (CIDR)" },
  invertBandwidth: { kind: "boolean", label: "Inverter Banda" },
  isL2Link: { kind: "boolean", label: "Link L2" },
  icmpBlocked: { kind: "boolean", label: "ICMP Bloqueado" },
  linkType: { kind: "select-link-type", label: "Tipo de Link" },
  authType: { kind: "select-auth-type", label: "Tipo de Autenticação" },
  defaultCpe: { kind: "object-default-cpe", label: "CPE Padrão" },
  oltSnmpEnable: { kind: "object-olt-snmp-enable", label: "Habilitar SNMP All (Datacom)" },
  monitoringEnabled: { kind: "boolean", label: "Monitoramento Ativo" },
};

const ALLOWED_EDIT_FIELDS = Object.keys(FIELD_META).sort();

function defaultValueForField(kind: FieldKind): unknown {
  switch (kind) {
    case "boolean": return false;
    case "object-default-cpe": return { ip: "" };
    case "object-olt-snmp-enable": return { enable: true };
    default: return "";
  }
}

function isEmptyValue(kind: FieldKind, v: unknown): boolean {
  if (v === undefined || v === null || v === "") return true;
  if (kind === "object-default-cpe") {
    const o = v as any;
    return !o || !o.ip || String(o.ip).trim() === "";
  }
  if (kind === "object-olt-snmp-enable") {
    return !v || (v as any).enable !== true;
  }
  return false;
}

interface Lookups {
  concentrators: Array<{ id: number; name: string; isAccessPoint?: boolean }>;
  olts: Array<{ id: number; name: string; vendor?: string }>;
  snmpProfiles: Array<{ id: number; name: string }>;
  equipmentVendors: Array<{ id: number; name: string; slug?: string }>;
  switches: Array<{ id: number; name: string }>;
}

function lookupName<T extends { id: number; name: string }>(arr: T[], id: unknown): string | null {
  if (id == null || id === "") return null;
  const n = Number(id);
  const found = arr.find((x) => x.id === n);
  return found?.name || null;
}

function FieldDisplay({ fieldKey, meta, value, lookups }: {
  fieldKey: string; meta: FieldMeta; value: unknown; lookups: Lookups;
}) {
  if (value == null || value === "") {
    return <span className="text-xs text-muted-foreground italic">(vazio)</span>;
  }
  switch (meta.kind) {
    case "boolean":
      return <Badge variant={value ? "default" : "outline"}>{value ? "Sim" : "Não"}</Badge>;
    case "select-concentrator": {
      const name = lookupName(lookups.concentrators, value);
      return <span className="text-xs">{name || `#${value}`}</span>;
    }
    case "select-olt": {
      const name = lookupName(lookups.olts, value);
      return <span className="text-xs">{name || `#${value}`}</span>;
    }
    case "select-snmp-profile": {
      const name = lookupName(lookups.snmpProfiles, value);
      return <span className="text-xs">{name || `#${value}`}</span>;
    }
    case "select-equipment-vendor": {
      const name = lookupName(lookups.equipmentVendors, value);
      return <span className="text-xs">{name || `#${value}`}</span>;
    }
    case "select-switch": {
      const name = lookupName(lookups.switches, value);
      return <span className="text-xs">{name || `#${value}`}</span>;
    }
    case "select-access-point": {
      const name = lookupName(lookups.switches, value);
      return <span className="text-xs">{name || `#${value}`}</span>;
    }
    case "object-default-cpe": {
      const o = value as any;
      return (
        <span className="text-xs font-mono">
          ip={o?.ip || "?"}{o?.vendor ? `, vendor=${o.vendor}` : ""}{o?.mac ? `, mac=${o.mac}` : ""}
          {o?.replaceExisting ? ", substituir" : ""}
        </span>
      );
    }
    case "object-olt-snmp-enable": {
      const o = value as any;
      return <Badge variant="default">snmp all{o?.chassis ? ` (chassis ${o.chassis})` : ""}</Badge>;
    }
    default:
      return <span className="text-xs font-mono">{String(value)}</span>;
  }
}

function FieldEditor({ fieldKey, meta, value, onChange, lookups, proposalId }: {
  fieldKey: string; meta: FieldMeta; value: unknown;
  onChange: (v: unknown) => void; lookups: Lookups; proposalId: number;
}) {
  const tid = `input-edit-${proposalId}-${fieldKey}`;

  switch (meta.kind) {
    case "boolean":
      return (
        <div className="flex items-center gap-2 h-8">
          <Switch
            checked={value === true}
            onCheckedChange={(c) => onChange(c)}
            data-testid={tid}
          />
          <span className="text-xs text-muted-foreground">{value === true ? "Sim" : "Não"}</span>
        </div>
      );
    case "number":
      return (
        <Input
          type="number"
          className="h-8 text-xs"
          value={value == null || value === "" ? "" : String(value)}
          onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
          data-testid={tid}
        />
      );
    case "select-concentrator":
      return (
        <Select value={value == null ? "" : String(value)} onValueChange={(v) => onChange(v === "" ? "" : Number(v))}>
          <SelectTrigger className="h-8 text-xs" data-testid={tid}><SelectValue placeholder="Selecione..." /></SelectTrigger>
          <SelectContent>
            {lookups.concentrators.map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case "select-olt":
      return (
        <Select value={value == null ? "" : String(value)} onValueChange={(v) => onChange(v === "" ? "" : Number(v))}>
          <SelectTrigger className="h-8 text-xs" data-testid={tid}><SelectValue placeholder="Selecione..." /></SelectTrigger>
          <SelectContent>
            {lookups.olts.map((o) => (
              <SelectItem key={o.id} value={String(o.id)}>{o.name}{o.vendor ? ` (${o.vendor})` : ""}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case "select-snmp-profile":
      return (
        <Select value={value == null ? "" : String(value)} onValueChange={(v) => onChange(v === "" ? "" : Number(v))}>
          <SelectTrigger className="h-8 text-xs" data-testid={tid}><SelectValue placeholder="Selecione..." /></SelectTrigger>
          <SelectContent>
            {lookups.snmpProfiles.map((p) => (
              <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case "select-equipment-vendor":
      return (
        <Select value={value == null ? "" : String(value)} onValueChange={(v) => onChange(v === "" ? "" : Number(v))}>
          <SelectTrigger className="h-8 text-xs" data-testid={tid}><SelectValue placeholder="Selecione..." /></SelectTrigger>
          <SelectContent>
            {lookups.equipmentVendors.map((v) => (
              <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case "select-switch":
      return (
        <Select value={value == null ? "" : String(value)} onValueChange={(v) => onChange(v === "" ? "" : Number(v))}>
          <SelectTrigger className="h-8 text-xs" data-testid={tid}><SelectValue placeholder="Selecione..." /></SelectTrigger>
          <SelectContent>
            {lookups.switches.map((s) => (
              <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case "select-access-point":
      return (
        <Select value={value == null ? "" : String(value)} onValueChange={(v) => onChange(v === "" ? "" : Number(v))}>
          <SelectTrigger className="h-8 text-xs" data-testid={tid}><SelectValue placeholder="Selecione..." /></SelectTrigger>
          <SelectContent>
            {lookups.switches.length === 0 ? (
              <div className="text-xs text-muted-foreground px-2 py-1.5">
                Nenhum switch cadastrado
              </div>
            ) : lookups.switches.map((s) => (
              <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case "select-traffic-source":
      return (
        <Select value={(value as string) || ""} onValueChange={onChange}>
          <SelectTrigger className="h-8 text-xs" data-testid={tid}><SelectValue placeholder="Selecione..." /></SelectTrigger>
          <SelectContent>
            <SelectItem value="manual">Manual (IP)</SelectItem>
            <SelectItem value="concentrator">Concentrador</SelectItem>
            <SelectItem value="accessPoint">Ponto de Acesso</SelectItem>
          </SelectContent>
        </Select>
      );
    case "select-link-type":
      return (
        <Select value={(value as string) || ""} onValueChange={onChange}>
          <SelectTrigger className="h-8 text-xs" data-testid={tid}><SelectValue placeholder="Selecione..." /></SelectTrigger>
          <SelectContent>
            <SelectItem value="gpon">GPON</SelectItem>
            <SelectItem value="ptp">PTP</SelectItem>
          </SelectContent>
        </Select>
      );
    case "select-auth-type":
      return (
        <Select value={(value as string) || ""} onValueChange={onChange}>
          <SelectTrigger className="h-8 text-xs" data-testid={tid}><SelectValue placeholder="Selecione..." /></SelectTrigger>
          <SelectContent>
            <SelectItem value="pppoe">PPPoE</SelectItem>
            <SelectItem value="corporate">Corporate (IP fixo)</SelectItem>
          </SelectContent>
        </Select>
      );
    case "object-default-cpe": {
      const o = (value as any) || {};
      const update = (patch: any) => onChange({ ...o, ...patch });
      return (
        <div className="space-y-1.5 border rounded-md p-2 bg-muted/30">
          <div className="grid grid-cols-2 gap-1.5">
            <div>
              <Label className="text-[10px] text-muted-foreground">IP de monitoramento *</Label>
              <Input className="h-7 text-xs" value={o.ip || ""}
                onChange={(e) => update({ ip: e.target.value })}
                placeholder="192.168.1.1"
                data-testid={`${tid}-ip`} />
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">Fabricante (slug)</Label>
              <Select value={o.vendor || ""} onValueChange={(v) => update({ vendor: v || undefined })}>
                <SelectTrigger className="h-7 text-xs" data-testid={`${tid}-vendor`}>
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  {lookups.equipmentVendors.map((v) => (
                    <SelectItem key={v.id} value={v.slug || v.name.toLowerCase()}>
                      {v.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">MAC (opcional)</Label>
            <Input className="h-7 text-xs font-mono" value={o.mac || ""}
              onChange={(e) => update({ mac: e.target.value })}
              placeholder="AA:BB:CC:11:22:33"
              data-testid={`${tid}-mac`} />
          </div>
          <div className="flex items-center gap-2 pt-1">
            <Switch checked={o.replaceExisting === true}
              onCheckedChange={(c) => update({ replaceExisting: c })}
              data-testid={`${tid}-replace`} />
            <span className="text-[11px] text-muted-foreground">Substituir CPE existente (se houver)</span>
          </div>
        </div>
      );
    }
    case "object-olt-snmp-enable": {
      const o = (value as any) || { enable: false };
      return (
        <div className="space-y-1.5 border rounded-md p-2 bg-muted/30">
          <div className="flex items-center gap-2">
            <Switch checked={o.enable === true}
              onCheckedChange={(c) => onChange({ ...o, enable: c })}
              data-testid={`${tid}-enable`} />
            <span className="text-[11px]">Executar <code>snmp all</code> na ONU (Datacom DmOS)</span>
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">Chassis (default 1)</Label>
            <Input type="number" className="h-7 text-xs w-24"
              value={o.chassis ?? ""}
              placeholder="1"
              onChange={(e) => onChange({ ...o, chassis: e.target.value === "" ? undefined : Number(e.target.value) })}
              data-testid={`${tid}-chassis`} />
          </div>
          <p className="text-[10px] text-muted-foreground">
            Slot, porta e ID da ONU são lidos automaticamente do cadastro do link.
          </p>
        </div>
      );
    }
    default:
      return (
        <Input
          className="h-8 text-xs"
          value={value == null ? "" : String(value)}
          onChange={(e) => onChange(e.target.value)}
          data-testid={tid}
        />
      );
  }
}

function ProposalCard({
  proposal,
  onApprove,
  onReject,
  isApproving,
  isRejecting,
}: {
  proposal: AiAnalystProposal;
  onApprove: (overrideFields?: Record<string, unknown>, note?: string) => void;
  onReject: (note?: string) => void;
  isApproving: boolean;
  isRejecting: boolean;
}) {
  const proposed = (proposal.proposedFields || {}) as Record<string, unknown>;
  const proposedKeys = Object.keys(proposed);

  // edits guarda valores tipados (boolean, number, string, object) na forma final
  const [edits, setEdits] = useState<Record<string, unknown>>(() => ({ ...proposed }));
  const [extraKeys, setExtraKeys] = useState<string[]>([]);
  const [newFieldKey, setNewFieldKey] = useState<string>("");
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState(false);

  // Lookups para selects
  const { data: concentrators = [] } = useQuery<Array<{ id: number; name: string }>>({
    queryKey: ["/api/concentrators"],
  });
  const { data: olts = [] } = useQuery<Array<{ id: number; name: string; vendor?: string }>>({
    queryKey: ["/api/olts"],
  });
  const { data: snmpProfiles = [] } = useQuery<Array<{ id: number; name: string }>>({
    queryKey: ["/api/snmp-profiles"],
  });
  const { data: equipmentVendors = [] } = useQuery<Array<{ id: number; name: string; slug?: string }>>({
    queryKey: ["/api/equipment-vendors"],
  });
  const { data: switches = [] } = useQuery<Array<{ id: number; name: string; isAccessPoint?: boolean }>>({
    queryKey: ["/api/switches"],
  });

  const lookups = { concentrators, olts, snmpProfiles, equipmentVendors, switches };

  const cls = classificationLabel[proposal.classification] || classificationLabel.inconclusive;
  const allKeys = [...proposedKeys, ...extraKeys];
  const availableToAdd = ALLOWED_EDIT_FIELDS.filter((k) => !allKeys.includes(k));

  const addField = () => {
    if (!newFieldKey || allKeys.includes(newFieldKey)) return;
    const meta = FIELD_META[newFieldKey];
    setExtraKeys((prev) => [...prev, newFieldKey]);
    setEdits((prev) => ({ ...prev, [newFieldKey]: defaultValueForField(meta?.kind || "text") }));
    setNewFieldKey("");
  };

  const removeExtraField = (k: string) => {
    setExtraKeys((prev) => prev.filter((x) => x !== k));
    setEdits((prev) => {
      const { [k]: _, ...rest } = prev;
      return rest;
    });
  };

  const handleApprove = () => {
    if (!editing && extraKeys.length === 0) {
      onApprove(undefined, note || undefined);
      return;
    }
    const overrides: Record<string, unknown> = {};
    for (const k of allKeys) {
      const meta = FIELD_META[k];
      const v = edits[k];
      if (isEmptyValue(meta?.kind || "text", v)) continue;
      overrides[k] = v;
    }
    onApprove(Object.keys(overrides).length > 0 ? overrides : undefined, note || undefined);
  };

  return (
    <div className="border rounded-md p-3 space-y-3" data-testid={`card-proposal-${proposal.id}`}>
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={cls.variant}>{cls.label}</Badge>
          <span className="text-sm font-medium">Link #{proposal.linkId}</span>
          <Badge variant="outline" className="font-mono">
            confiança {proposal.confidence}%
          </Badge>
          <span className="text-xs text-muted-foreground">
            {new Date(proposal.createdAt).toLocaleString("pt-BR")}
          </span>
        </div>
      </div>

      <p className="text-sm whitespace-pre-wrap" data-testid={`text-reasoning-${proposal.id}`}>
        {proposal.reasoning}
      </p>

      <div className="border-t pt-2">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-medium text-muted-foreground">
            {proposedKeys.length > 0 ? "Campos a serem alterados:" : "Nenhuma alteração proposta pela IA."}
          </p>
          <Button variant="ghost" size="sm" onClick={() => setEditing(!editing)} data-testid={`button-edit-${proposal.id}`}>
            {editing ? "Cancelar edição" : (proposedKeys.length > 0 ? "Editar antes de aprovar" : "Adicionar correção manual")}
          </Button>
        </div>

        {allKeys.length > 0 && (
          <div className="space-y-2 text-sm">
            {allKeys.map((k) => {
              const isExtra = extraKeys.includes(k);
              const meta = FIELD_META[k] || { kind: "text" as FieldKind };
              const isEditableNow = editing || isExtra;
              return (
                <div key={k} className="flex items-start gap-2">
                  <div className="min-w-[140px] pt-1">
                    <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{meta.label || k}</code>
                  </div>
                  <span className="text-muted-foreground pt-1">→</span>
                  <div className="flex-1">
                    {isEditableNow ? (
                      <FieldEditor
                        fieldKey={k}
                        meta={meta}
                        value={edits[k]}
                        onChange={(v) => setEdits((prev) => ({ ...prev, [k]: v }))}
                        lookups={lookups}
                        proposalId={proposal.id}
                      />
                    ) : (
                      <FieldDisplay
                        fieldKey={k}
                        meta={meta}
                        value={proposed[k]}
                        lookups={lookups}
                      />
                    )}
                  </div>
                  {isExtra && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2"
                      onClick={() => removeExtraField(k)}
                      data-testid={`button-remove-field-${proposal.id}-${k}`}
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {editing && availableToAdd.length > 0 && (
          <div className="flex items-center gap-2 mt-3">
            <Select value={newFieldKey} onValueChange={setNewFieldKey}>
              <SelectTrigger className="h-8 text-xs flex-1" data-testid={`select-add-field-${proposal.id}`}>
                <SelectValue placeholder="Adicionar campo…" />
              </SelectTrigger>
              <SelectContent>
                {availableToAdd.map((k) => {
                  const meta = FIELD_META[k];
                  return (
                    <SelectItem key={k} value={k} className="text-xs">
                      {meta?.label || k} <span className="text-muted-foreground font-mono">({k})</span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" className="h-8" onClick={addField} disabled={!newFieldKey} data-testid={`button-add-field-${proposal.id}`}>
              <Plus className="w-3 h-3 mr-1" /> Adicionar
            </Button>
          </div>
        )}
      </div>

      {(editing || extraKeys.length > 0) && (
        <Textarea
          placeholder="Anotação opcional (vai alimentar o aprendizado)..."
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          data-testid={`textarea-note-${proposal.id}`}
        />
      )}

      <div className="flex gap-2 pt-1">
        <Button
          size="sm"
          onClick={handleApprove}
          disabled={isApproving}
          data-testid={`button-approve-${proposal.id}`}
        >
          <CheckCircle2 className="w-4 h-4 mr-1" />
          Aprovar
        </Button>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => onReject(note || undefined)}
          disabled={isRejecting}
          data-testid={`button-reject-${proposal.id}`}
        >
          <XCircle className="w-4 h-4 mr-1" />
          Rejeitar
        </Button>
      </div>
    </div>
  );
}

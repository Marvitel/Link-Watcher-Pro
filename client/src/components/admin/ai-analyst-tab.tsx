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
import { Bot, Play, CheckCircle2, XCircle, Plus, Trash2, KeyRound, AlertTriangle, RefreshCw } from "lucide-react";

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
      </Tabs>
    </div>
  );
}

// =====================================================================
// Card de uma proposta individual (com edição inline antes de aprovar)
// =====================================================================

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
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState(false);

  const cls = classificationLabel[proposal.classification] || classificationLabel.inconclusive;
  const fields = Object.entries(proposal.proposedFields || {});

  const handleApprove = () => {
    if (Object.keys(edits).length === 0) {
      onApprove(undefined, note || undefined);
    } else {
      const overrides: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(edits)) {
        // Preserva tipo simples: number se parsear, boolean se true/false, senão string
        if (v === "true") overrides[k] = true;
        else if (v === "false") overrides[k] = false;
        else if (v !== "" && !isNaN(Number(v))) overrides[k] = Number(v);
        else overrides[k] = v;
      }
      onApprove(overrides, note || undefined);
    }
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

      {fields.length > 0 ? (
        <div className="border-t pt-2">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-muted-foreground">Campos a serem alterados:</p>
            <Button variant="ghost" size="sm" onClick={() => setEditing(!editing)} data-testid={`button-edit-${proposal.id}`}>
              {editing ? "Cancelar edição" : "Editar antes de aprovar"}
            </Button>
          </div>
          <div className="space-y-1 text-sm">
            {fields.map(([k, v]) => (
              <div key={k} className="flex items-center gap-2">
                <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{k}</code>
                <span className="text-muted-foreground">→</span>
                {editing ? (
                  <Input
                    className="h-7 text-xs flex-1"
                    defaultValue={String(v ?? "")}
                    onChange={(e) => setEdits((prev) => ({ ...prev, [k]: e.target.value }))}
                    data-testid={`input-edit-${proposal.id}-${k}`}
                  />
                ) : (
                  <span className="font-mono text-xs">{JSON.stringify(v)}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground italic">Nenhuma alteração proposta.</p>
      )}

      {editing && (
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

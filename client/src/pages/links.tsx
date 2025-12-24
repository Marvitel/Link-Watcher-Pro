import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { LinkCard } from "@/components/link-card";
import { Network, Plus, Pencil, Trash2, AlertCircle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useClientContext } from "@/lib/client-context";
import { getAuthToken } from "@/lib/auth";
import type { Link as LinkType, Metric } from "@shared/schema";

function LinkCardWithMetrics({ link }: { link: LinkType }) {
  const { data: metrics } = useQuery<Metric[]>({
    queryKey: [`/api/links/${link.id}/metrics`],
    refetchInterval: 5000,
  });

  const metricsHistory = metrics?.map((m) => ({
    timestamp: typeof m.timestamp === 'string' ? m.timestamp : new Date(m.timestamp).toISOString(),
    download: m.download,
    upload: m.upload,
  })) || [];

  return <LinkCard link={link} metricsHistory={metricsHistory} />;
}

export default function Links() {
  const { toast } = useToast();
  const { selectedClientId, selectedClientName, isEditable } = useClientContext();
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [editingLink, setEditingLink] = useState<LinkType | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [linkToDelete, setLinkToDelete] = useState<LinkType | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    location: "",
    address: "",
    bandwidth: 200,
    identifier: "",
    ipBlock: "0.0.0.0/30",
    totalIps: 4,
    usableIps: 2,
  });

  const linksUrl = selectedClientId ? `/api/links?clientId=${selectedClientId}` : "/api/links";
  
  const { data: links, isLoading: linksLoading } = useQuery<LinkType[]>({
    queryKey: [linksUrl],
    refetchInterval: 5000,
  });

  const createLinkMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiRequest("POST", "/api/links", { ...data, clientId: selectedClientId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (query) => 
        typeof query.queryKey[0] === 'string' && query.queryKey[0].startsWith('/api/links') 
      });
      setLinkDialogOpen(false);
      resetForm();
      toast({ title: "Link criado com sucesso" });
    },
    onError: () => {
      toast({ title: "Erro ao criar link", variant: "destructive" });
    },
  });

  const updateLinkMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => {
      return apiRequest("PATCH", `/api/links/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (query) => 
        typeof query.queryKey[0] === 'string' && query.queryKey[0].startsWith('/api/links') 
      });
      setLinkDialogOpen(false);
      setEditingLink(null);
      resetForm();
      toast({ title: "Link atualizado com sucesso" });
    },
    onError: () => {
      toast({ title: "Erro ao atualizar link", variant: "destructive" });
    },
  });

  const deleteLinkMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/links/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (query) => 
        typeof query.queryKey[0] === 'string' && query.queryKey[0].startsWith('/api/links') 
      });
      setDeleteDialogOpen(false);
      setLinkToDelete(null);
      toast({ title: "Link excluido com sucesso" });
    },
    onError: () => {
      toast({ title: "Erro ao excluir link", variant: "destructive" });
    },
  });

  const resetForm = () => {
    setFormData({
      name: "",
      location: "",
      address: "",
      bandwidth: 200,
      identifier: "",
      ipBlock: "0.0.0.0/30",
      totalIps: 4,
      usableIps: 2,
    });
  };

  const openCreateDialog = () => {
    setEditingLink(null);
    resetForm();
    setLinkDialogOpen(true);
  };

  const openEditDialog = (link: LinkType) => {
    setEditingLink(link);
    setFormData({
      name: link.name,
      location: link.location || "",
      address: link.address || "",
      bandwidth: link.bandwidth || 200,
      identifier: link.identifier || "",
      ipBlock: link.ipBlock || "0.0.0.0/30",
      totalIps: link.totalIps || 4,
      usableIps: link.usableIps || 2,
    });
    setLinkDialogOpen(true);
  };

  const handleSubmit = () => {
    if (editingLink) {
      updateLinkMutation.mutate({ id: editingLink.id, data: formData });
    } else {
      createLinkMutation.mutate(formData);
    }
  };

  const handleDelete = (link: LinkType) => {
    setLinkToDelete(link);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = () => {
    if (linkToDelete) {
      deleteLinkMutation.mutate(linkToDelete.id);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Links Dedicados</h1>
          <p className="text-muted-foreground">
            {selectedClientName 
              ? `Links do cliente: ${selectedClientName}`
              : "Visao geral dos links IP dedicados"
            }
          </p>
        </div>
        {isEditable && (
          <Button onClick={openCreateDialog} data-testid="button-add-link">
            <Plus className="w-4 h-4 mr-2" />
            Adicionar Link
          </Button>
        )}
      </div>

      {isEditable && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="py-3">
            <div className="flex items-center gap-2 text-sm">
              <AlertCircle className="w-4 h-4 text-primary" />
              <span>Modo de edicao ativo para <strong>{selectedClientName}</strong></span>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Network className="w-5 h-5" />
            Especificacoes do Servico
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-4 rounded-md bg-muted/50">
              <p className="text-sm text-muted-foreground">Banda Total Contratada</p>
              <p className="text-lg font-semibold font-mono">
                {links ? links.reduce((sum, l) => sum + (l.bandwidth || 0), 0) : 0} Mbps
              </p>
              <p className="text-xs text-muted-foreground">
                {links?.length || 0} link(s) ativo(s)
              </p>
            </div>
            <div className="p-4 rounded-md bg-muted/50">
              <p className="text-sm text-muted-foreground">Uptime Medio</p>
              <p className="text-lg font-semibold font-mono">
                {links && links.length > 0 
                  ? (links.reduce((sum, l) => sum + (l.uptime || 0), 0) / links.length).toFixed(2) 
                  : 0}%
              </p>
              <p className="text-xs text-muted-foreground">Meta SLA maior ou igual 99%</p>
            </div>
            <div className="p-4 rounded-md bg-muted/50">
              <p className="text-sm text-muted-foreground">Latencia Media</p>
              <p className="text-lg font-semibold font-mono">
                {links && links.length > 0 
                  ? (links.reduce((sum, l) => sum + (l.latency || 0), 0) / links.length).toFixed(1) 
                  : 0} ms
              </p>
              <p className="text-xs text-muted-foreground">Meta SLA menor ou igual 80ms</p>
            </div>
            <div className="p-4 rounded-md bg-muted/50">
              <p className="text-sm text-muted-foreground">Tecnologia</p>
              <p className="text-lg font-semibold">Fibra Optica</p>
              <p className="text-xs text-muted-foreground">Dedicado, deterministico</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {linksLoading ? (
          <>
            {[1, 2].map((i) => (
              <Card key={i}>
                <CardHeader>
                  <Skeleton className="h-6 w-48" />
                </CardHeader>
                <CardContent className="space-y-4">
                  <Skeleton className="h-24 w-full" />
                  <div className="grid grid-cols-2 gap-4">
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-16 w-full" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </>
        ) : links && links.length > 0 ? (
          links.map((link) => (
            <div key={link.id} className="relative">
              {isEditable && (
                <div className="absolute top-2 right-2 z-10 flex gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => openEditDialog(link)}
                    data-testid={`button-edit-link-${link.id}`}
                  >
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => handleDelete(link)}
                    data-testid={`button-delete-link-${link.id}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              )}
              <LinkCardWithMetrics link={link} />
            </div>
          ))
        ) : (
          <Card className="col-span-2">
            <CardContent className="py-8 text-center text-muted-foreground">
              {selectedClientId 
                ? "Nenhum link cadastrado para este cliente."
                : "Nenhum link encontrado. Selecione um cliente para visualizar os links."
              }
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingLink ? "Editar Link" : "Adicionar Link"}</DialogTitle>
            <DialogDescription>
              {editingLink ? "Atualize as informacoes do link" : "Preencha os dados do novo link"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Nome</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Ex: Sede Principal"
                  data-testid="input-link-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="identifier">Identificador</Label>
                <Input
                  id="identifier"
                  value={formData.identifier}
                  onChange={(e) => setFormData({ ...formData, identifier: e.target.value })}
                  placeholder="Ex: sede"
                  data-testid="input-link-identifier"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="location">Localizacao</Label>
              <Input
                id="location"
                value={formData.location}
                onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                placeholder="Ex: Aracaju, SE"
                data-testid="input-link-location"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="address">Endereco</Label>
              <Input
                id="address"
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                placeholder="Ex: Rua Principal, 123"
                data-testid="input-link-address"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="ipBlock">Bloco IP</Label>
                <Input
                  id="ipBlock"
                  value={formData.ipBlock}
                  onChange={(e) => setFormData({ ...formData, ipBlock: e.target.value })}
                  placeholder="Ex: 200.100.50.0/30"
                  data-testid="input-link-ipblock"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bandwidth">Banda (Mbps)</Label>
                <Input
                  id="bandwidth"
                  type="number"
                  value={formData.bandwidth}
                  onChange={(e) => setFormData({ ...formData, bandwidth: parseInt(e.target.value) })}
                  data-testid="input-link-bandwidth"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkDialogOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={createLinkMutation.isPending || updateLinkMutation.isPending}
              data-testid="button-save-link"
            >
              {editingLink ? "Salvar" : "Criar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar Exclusao</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja excluir o link "{linkToDelete?.name}"? Esta acao nao pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={deleteLinkMutation.isPending}
              data-testid="button-confirm-delete"
            >
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

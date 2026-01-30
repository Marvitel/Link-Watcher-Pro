import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Plus, Pencil, Trash2, Target, Globe, Search } from "lucide-react";
import type { Client } from "@shared/schema";

interface DiagnosticTarget {
  id: number;
  name: string;
  ip: string;
  description: string | null;
  category: string;
  clientId: number | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

const TARGET_CATEGORIES = [
  { value: "dns", label: "DNS", color: "bg-blue-500" },
  { value: "gateway", label: "Gateway", color: "bg-green-500" },
  { value: "external", label: "Externo", color: "bg-purple-500" },
  { value: "monitoring", label: "Monitoramento", color: "bg-orange-500" },
  { value: "internal", label: "Interno", color: "bg-cyan-500" },
  { value: "other", label: "Outro", color: "bg-gray-500" },
];

export function DiagnosticTargetsTab() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTarget, setEditingTarget] = useState<DiagnosticTarget | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  
  const [formData, setFormData] = useState({
    name: "",
    ip: "",
    description: "",
    category: "external",
    clientId: null as number | null,
    isActive: true,
    sortOrder: 0,
  });

  const { data: targets, isLoading } = useQuery<DiagnosticTarget[]>({
    queryKey: ["/api/admin/diagnostic-targets"],
  });

  const { data: clients } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      return apiRequest("POST", "/api/admin/diagnostic-targets", {
        ...data,
        description: data.description || null,
        clientId: data.clientId || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/diagnostic-targets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/diagnostic-targets"] });
      toast({ title: "IP de diagnóstico criado com sucesso" });
      resetForm();
    },
    onError: () => {
      toast({ title: "Erro ao criar IP de diagnóstico", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: typeof formData }) => {
      return apiRequest("PATCH", `/api/admin/diagnostic-targets/${id}`, {
        ...data,
        description: data.description || null,
        clientId: data.clientId || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/diagnostic-targets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/diagnostic-targets"] });
      toast({ title: "IP de diagnóstico atualizado com sucesso" });
      resetForm();
    },
    onError: () => {
      toast({ title: "Erro ao atualizar IP de diagnóstico", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/admin/diagnostic-targets/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/diagnostic-targets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/diagnostic-targets"] });
      toast({ title: "IP de diagnóstico excluído com sucesso" });
    },
    onError: () => {
      toast({ title: "Erro ao excluir IP de diagnóstico", variant: "destructive" });
    },
  });

  const resetForm = () => {
    setFormData({
      name: "",
      ip: "",
      description: "",
      category: "external",
      clientId: null,
      isActive: true,
      sortOrder: 0,
    });
    setEditingTarget(null);
    setDialogOpen(false);
  };

  const handleEdit = (target: DiagnosticTarget) => {
    setEditingTarget(target);
    setFormData({
      name: target.name,
      ip: target.ip,
      description: target.description || "",
      category: target.category,
      clientId: target.clientId,
      isActive: target.isActive,
      sortOrder: target.sortOrder,
    });
    setDialogOpen(true);
  };

  const handleSubmit = () => {
    if (!formData.name || !formData.ip) {
      toast({ title: "Nome e IP são obrigatórios", variant: "destructive" });
      return;
    }
    
    if (editingTarget) {
      updateMutation.mutate({ id: editingTarget.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const getClientName = (clientId: number | null) => {
    if (!clientId) return "Global";
    const client = clients?.find(c => c.id === clientId);
    return client?.name || "Desconhecido";
  };

  const getCategoryInfo = (category: string) => {
    return TARGET_CATEGORIES.find(c => c.value === category) || TARGET_CATEGORIES[TARGET_CATEGORIES.length - 1];
  };

  const filteredTargets = targets?.filter(t => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return t.name.toLowerCase().includes(term) ||
           t.ip.toLowerCase().includes(term) ||
           (t.description && t.description.toLowerCase().includes(term));
  }) || [];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Target className="h-5 w-5" />
              IPs de Diagnóstico
            </CardTitle>
            <CardDescription>
              IPs configuráveis para uso em comandos de diagnóstico (ping, traceroute, etc.)
            </CardDescription>
          </div>
          <Button onClick={() => setDialogOpen(true)} data-testid="button-add-target">
            <Plus className="h-4 w-4 mr-2" />
            Novo IP
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome ou IP..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
              data-testid="input-search-targets"
            />
          </div>
        </div>

        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">Carregando...</div>
        ) : filteredTargets.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            Nenhum IP de diagnóstico configurado. Clique em "Novo IP" para adicionar.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>IP</TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead>Escopo</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredTargets.sort((a, b) => a.sortOrder - b.sortOrder).map((target) => {
                const catInfo = getCategoryInfo(target.category);
                return (
                  <TableRow key={target.id} data-testid={`row-target-${target.id}`}>
                    <TableCell>
                      <div>
                        <div className="font-medium">{target.name}</div>
                        {target.description && (
                          <div className="text-sm text-muted-foreground">{target.description}</div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <code className="text-sm bg-muted px-2 py-1 rounded">{target.ip}</code>
                    </TableCell>
                    <TableCell>
                      <Badge className={`${catInfo.color} text-white`}>{catInfo.label}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {target.clientId ? (
                          <Badge variant="outline">{getClientName(target.clientId)}</Badge>
                        ) : (
                          <Badge variant="secondary">
                            <Globe className="h-3 w-3 mr-1" />
                            Global
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={target.isActive ? "default" : "secondary"}>
                        {target.isActive ? "Ativo" : "Inativo"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => handleEdit(target)}
                          data-testid={`button-edit-target-${target.id}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => deleteMutation.mutate(target.id)}
                          data-testid={`button-delete-target-${target.id}`}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) resetForm(); else setDialogOpen(true); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingTarget ? "Editar IP de Diagnóstico" : "Novo IP de Diagnóstico"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nome *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Ex: DNS Google, Gateway Principal"
                data-testid="input-target-name"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="ip">Endereço IP *</Label>
              <Input
                id="ip"
                value={formData.ip}
                onChange={(e) => setFormData({ ...formData, ip: e.target.value })}
                placeholder="Ex: 8.8.8.8, 200.160.2.3"
                data-testid="input-target-ip"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="description">Descrição</Label>
              <Input
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Descrição opcional"
                data-testid="input-target-description"
              />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="category">Categoria</Label>
                <Select value={formData.category} onValueChange={(v) => setFormData({ ...formData, category: v })}>
                  <SelectTrigger data-testid="select-target-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TARGET_CATEGORIES.map((cat) => (
                      <SelectItem key={cat.value} value={cat.value}>
                        {cat.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="clientId">Escopo</Label>
                <Select 
                  value={formData.clientId?.toString() || "global"} 
                  onValueChange={(v) => setFormData({ ...formData, clientId: v === "global" ? null : parseInt(v) })}
                >
                  <SelectTrigger data-testid="select-target-client">
                    <SelectValue placeholder="Global" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="global">Global (todos clientes)</SelectItem>
                    {clients?.map((client) => (
                      <SelectItem key={client.id} value={client.id.toString()}>
                        {client.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="sortOrder">Ordem de Exibição</Label>
              <Input
                id="sortOrder"
                type="number"
                value={formData.sortOrder}
                onChange={(e) => setFormData({ ...formData, sortOrder: parseInt(e.target.value) || 0 })}
                data-testid="input-target-sort-order"
              />
            </div>
            
            <div className="flex items-center space-x-2">
              <Switch
                id="isActive"
                checked={formData.isActive}
                onCheckedChange={(checked) => setFormData({ ...formData, isActive: checked })}
                data-testid="switch-target-active"
              />
              <Label htmlFor="isActive">IP ativo</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={resetForm} data-testid="button-cancel-target">
              Cancelar
            </Button>
            <Button 
              onClick={handleSubmit} 
              disabled={createMutation.isPending || updateMutation.isPending}
              data-testid="button-save-target"
            >
              {editingTarget ? "Salvar" : "Criar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

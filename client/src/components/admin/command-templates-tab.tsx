import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Plus, Pencil, Trash2, Terminal, ChevronDown, ChevronRight, Search, Copy } from "lucide-react";
import type { EquipmentVendor } from "@shared/schema";

interface CpeCommandTemplate {
  id: number;
  vendorId: number | null;
  model: string | null;
  name: string;
  command: string;
  description: string | null;
  category: string;
  isActive: boolean;
  parameters: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

const COMMAND_CATEGORIES = [
  { value: "logs", label: "Logs", color: "bg-blue-500" },
  { value: "hardware", label: "Hardware", color: "bg-orange-500" },
  { value: "network", label: "Rede", color: "bg-green-500" },
  { value: "diagnostic", label: "Diagnóstico", color: "bg-purple-500" },
  { value: "backup", label: "Backup", color: "bg-yellow-500" },
  { value: "config", label: "Configuração", color: "bg-red-500" },
  { value: "interface", label: "Interfaces", color: "bg-cyan-500" },
  { value: "routing", label: "Roteamento", color: "bg-pink-500" },
  { value: "other", label: "Outros", color: "bg-gray-500" },
];

export function CommandTemplatesTab() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<CpeCommandTemplate | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(["logs", "diagnostic"]));
  const [searchTerm, setSearchTerm] = useState("");
  const [filterVendorId, setFilterVendorId] = useState<string>("all");
  
  const [formData, setFormData] = useState({
    vendorId: null as number | null,
    model: "",
    name: "",
    command: "",
    description: "",
    category: "diagnostic",
    isActive: true,
    parameters: "",
    sortOrder: 0,
  });

  const { data: templates, isLoading } = useQuery<CpeCommandTemplate[]>({
    queryKey: ["/api/admin/cpe-command-templates"],
  });

  const { data: vendors } = useQuery<EquipmentVendor[]>({
    queryKey: ["/api/equipment-vendors"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const payload = {
        ...data,
        vendorId: data.vendorId || null,
        model: data.model || null,
        description: data.description || null,
        parameters: data.parameters || null,
      };
      return apiRequest("POST", "/api/admin/cpe-command-templates", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/cpe-command-templates"] });
      toast({ title: "Template criado com sucesso" });
      resetForm();
    },
    onError: () => {
      toast({ title: "Erro ao criar template", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: typeof formData }) => {
      const payload = {
        ...data,
        vendorId: data.vendorId || null,
        model: data.model || null,
        description: data.description || null,
        parameters: data.parameters || null,
      };
      return apiRequest("PATCH", `/api/admin/cpe-command-templates/${id}`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/cpe-command-templates"] });
      toast({ title: "Template atualizado com sucesso" });
      resetForm();
    },
    onError: () => {
      toast({ title: "Erro ao atualizar template", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/admin/cpe-command-templates/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/cpe-command-templates"] });
      toast({ title: "Template excluído com sucesso" });
    },
    onError: () => {
      toast({ title: "Erro ao excluir template", variant: "destructive" });
    },
  });

  const resetForm = () => {
    setFormData({
      vendorId: null,
      model: "",
      name: "",
      command: "",
      description: "",
      category: "diagnostic",
      isActive: true,
      parameters: "",
      sortOrder: 0,
    });
    setEditingTemplate(null);
    setDialogOpen(false);
  };

  const handleEdit = (template: CpeCommandTemplate) => {
    setEditingTemplate(template);
    setFormData({
      vendorId: template.vendorId,
      model: template.model || "",
      name: template.name,
      command: template.command,
      description: template.description || "",
      category: template.category,
      isActive: template.isActive,
      parameters: template.parameters || "",
      sortOrder: template.sortOrder,
    });
    setDialogOpen(true);
  };

  const handleSubmit = () => {
    if (!formData.name || !formData.command) {
      toast({ title: "Nome e comando são obrigatórios", variant: "destructive" });
      return;
    }
    
    if (editingTemplate) {
      updateMutation.mutate({ id: editingTemplate.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const toggleCategory = (category: string) => {
    const newExpanded = new Set(expandedCategories);
    if (newExpanded.has(category)) {
      newExpanded.delete(category);
    } else {
      newExpanded.add(category);
    }
    setExpandedCategories(newExpanded);
  };

  const getVendorName = (vendorId: number | null) => {
    if (!vendorId) return "Genérico";
    const vendor = vendors?.find(v => v.id === vendorId);
    return vendor?.name || "Desconhecido";
  };

  const getCategoryInfo = (category: string) => {
    return COMMAND_CATEGORIES.find(c => c.value === category) || COMMAND_CATEGORIES[COMMAND_CATEGORIES.length - 1];
  };

  const filteredTemplates = templates?.filter(t => {
    const matchesSearch = searchTerm === "" || 
      t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.command.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (t.description && t.description.toLowerCase().includes(searchTerm.toLowerCase()));
    
    const matchesVendor = filterVendorId === "all" || 
      (filterVendorId === "generic" && !t.vendorId) ||
      (t.vendorId?.toString() === filterVendorId);
    
    return matchesSearch && matchesVendor;
  }) || [];

  const groupedTemplates = filteredTemplates.reduce((acc, template) => {
    const category = template.category;
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category].push(template);
    return acc;
  }, {} as Record<string, CpeCommandTemplate[]>);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Comando copiado!" });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Terminal className="h-5 w-5" />
              Templates de Comandos SSH
            </CardTitle>
            <CardDescription>
              Biblioteca de comandos pré-configurados para equipamentos CPE
            </CardDescription>
          </div>
          <Button onClick={() => setDialogOpen(true)} data-testid="button-add-template">
            <Plus className="h-4 w-4 mr-2" />
            Novo Template
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex gap-4 mb-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar comandos..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
              data-testid="input-search-templates"
            />
          </div>
          <Select value={filterVendorId} onValueChange={setFilterVendorId}>
            <SelectTrigger className="w-[200px]" data-testid="select-filter-vendor">
              <SelectValue placeholder="Filtrar por fabricante" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="generic">Genérico</SelectItem>
              {vendors?.map((vendor) => (
                <SelectItem key={vendor.id} value={vendor.id.toString()}>
                  {vendor.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">Carregando...</div>
        ) : Object.keys(groupedTemplates).length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            Nenhum template encontrado. Clique em "Novo Template" para criar.
          </div>
        ) : (
          <div className="space-y-2">
            {COMMAND_CATEGORIES.map((category) => {
              const categoryTemplates = groupedTemplates[category.value];
              if (!categoryTemplates || categoryTemplates.length === 0) return null;
              
              const isExpanded = expandedCategories.has(category.value);
              
              return (
                <Collapsible key={category.value} open={isExpanded} onOpenChange={() => toggleCategory(category.value)}>
                  <CollapsibleTrigger asChild>
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50 cursor-pointer hover-elevate" data-testid={`collapsible-${category.value}`}>
                      {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      <Badge className={`${category.color} text-white`}>{category.label}</Badge>
                      <span className="text-sm text-muted-foreground">
                        {categoryTemplates.length} comando(s)
                      </span>
                    </div>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Nome</TableHead>
                          <TableHead>Comando</TableHead>
                          <TableHead>Fabricante</TableHead>
                          <TableHead>Modelo</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Ações</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {categoryTemplates.sort((a, b) => a.sortOrder - b.sortOrder).map((template) => (
                          <TableRow key={template.id} data-testid={`row-template-${template.id}`}>
                            <TableCell>
                              <div>
                                <div className="font-medium">{template.name}</div>
                                {template.description && (
                                  <div className="text-sm text-muted-foreground">{template.description}</div>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <code className="text-xs bg-muted px-2 py-1 rounded font-mono max-w-[300px] truncate">
                                  {template.command}
                                </code>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => copyToClipboard(template.command)}
                                  data-testid={`button-copy-${template.id}`}
                                >
                                  <Copy className="h-3 w-3" />
                                </Button>
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline">{getVendorName(template.vendorId)}</Badge>
                            </TableCell>
                            <TableCell>
                              {template.model || "-"}
                            </TableCell>
                            <TableCell>
                              <Badge variant={template.isActive ? "default" : "secondary"}>
                                {template.isActive ? "Ativo" : "Inativo"}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-1">
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => handleEdit(template)}
                                  data-testid={`button-edit-${template.id}`}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => deleteMutation.mutate(template.id)}
                                  data-testid={`button-delete-${template.id}`}
                                >
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CollapsibleContent>
                </Collapsible>
              );
            })}
          </div>
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) resetForm(); else setDialogOpen(true); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingTemplate ? "Editar Template" : "Novo Template de Comando"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Nome *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Ex: Ver logs do sistema"
                  data-testid="input-template-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="category">Categoria</Label>
                <Select value={formData.category} onValueChange={(v) => setFormData({ ...formData, category: v })}>
                  <SelectTrigger data-testid="select-template-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COMMAND_CATEGORIES.map((cat) => (
                      <SelectItem key={cat.value} value={cat.value}>
                        {cat.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="command">Comando SSH *</Label>
              <Textarea
                id="command"
                value={formData.command}
                onChange={(e) => setFormData({ ...formData, command: e.target.value })}
                placeholder="Ex: show log flash tail 100"
                className="font-mono text-sm"
                rows={3}
                data-testid="input-template-command"
              />
              <p className="text-xs text-muted-foreground">
                Use placeholders para parâmetros: {"{IP}"}, {"{INTERFACE}"}, {"{VLAN}"}
              </p>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="description">Descrição</Label>
              <Input
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Descrição do que o comando faz"
                data-testid="input-template-description"
              />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="vendorId">Fabricante</Label>
                <Select 
                  value={formData.vendorId?.toString() || "generic"} 
                  onValueChange={(v) => setFormData({ ...formData, vendorId: v === "generic" ? null : parseInt(v) })}
                >
                  <SelectTrigger data-testid="select-template-vendor">
                    <SelectValue placeholder="Genérico (todos)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="generic">Genérico (todos)</SelectItem>
                    {vendors?.map((vendor) => (
                      <SelectItem key={vendor.id} value={vendor.id.toString()}>
                        {vendor.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="model">Modelo (opcional)</Label>
                <Input
                  id="model"
                  value={formData.model}
                  onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                  placeholder="Ex: NE8000, Cisco ISR"
                  data-testid="input-template-model"
                />
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="parameters">Parâmetros (JSON)</Label>
                <Textarea
                  id="parameters"
                  value={formData.parameters}
                  onChange={(e) => setFormData({ ...formData, parameters: e.target.value })}
                  placeholder='Ex: [{"name": "IP", "type": "ip", "required": true}]'
                  className="font-mono text-xs"
                  rows={2}
                  data-testid="input-template-parameters"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sortOrder">Ordem de Exibição</Label>
                <Input
                  id="sortOrder"
                  type="number"
                  value={formData.sortOrder}
                  onChange={(e) => setFormData({ ...formData, sortOrder: parseInt(e.target.value) || 0 })}
                  data-testid="input-template-sort-order"
                />
              </div>
            </div>
            
            <div className="flex items-center space-x-2">
              <Switch
                id="isActive"
                checked={formData.isActive}
                onCheckedChange={(checked) => setFormData({ ...formData, isActive: checked })}
                data-testid="switch-template-active"
              />
              <Label htmlFor="isActive">Template ativo</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={resetForm} data-testid="button-cancel">
              Cancelar
            </Button>
            <Button 
              onClick={handleSubmit} 
              disabled={createMutation.isPending || updateMutation.isPending}
              data-testid="button-save-template"
            >
              {editingTemplate ? "Salvar" : "Criar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

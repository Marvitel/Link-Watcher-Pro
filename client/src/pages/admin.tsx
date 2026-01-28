import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth, getAuthToken } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  Plus,
  Pencil,
  Trash2,
  Network,
  Settings,
  Building2,
  Users,
  Shield,
  RefreshCw,
  CheckCircle,
  XCircle,
  FileText,
  Search,
  Loader2,
  X,
  Radio,
  Eye,
  EyeOff,
  Download,
  Cpu,
  AlertTriangle,
  AlertCircle,
  Activity,
  Check,
  ChevronsUpDown,
  Save,
  ClipboardList,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Filter,
  Calendar,
} from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import type { Link, Client, User, Olt, ErpIntegration, ClientErpMapping, ExternalIntegration, BlacklistCheck, Cpe, EquipmentVendor } from "@shared/schema";
import { Database, Globe, Plug, Server, Layers, Router, Monitor, ShieldCheck, BarChart3 } from "lucide-react";
import { formatBandwidth } from "@/lib/export-utils";
import { CpesTab } from "@/components/admin/cpes-tab";
import { FirewallManager } from "@/components/firewall-manager";
import { TrafficInterfacesManager } from "@/components/traffic-interfaces-manager";

interface SnmpInterface {
  ifIndex: number;
  ifName: string;
  ifDescr: string;
  ifAlias: string;
  ifSpeed: number;
  ifOperStatus: string;
  ifAdminStatus: string;
}

// Componente de seção colapsável para organizar formulários
function FormSection({ 
  title, 
  icon: Icon, 
  children, 
  defaultOpen = false,
  badge,
  description
}: { 
  title: string; 
  icon?: React.ComponentType<{ className?: string }>; 
  children: React.ReactNode;
  defaultOpen?: boolean;
  badge?: React.ReactNode;
  description?: string;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  
  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="border rounded-lg">
      <CollapsibleTrigger asChild>
        <button 
          type="button"
          className="flex items-center justify-between w-full p-3 hover-elevate rounded-lg text-left"
          data-testid={`section-${title.toLowerCase().replace(/\s+/g, '-')}`}
        >
          <div className="flex items-center gap-2">
            {Icon && <Icon className="w-4 h-4 text-muted-foreground" />}
            <span className="font-medium text-sm">{title}</span>
            {badge}
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="px-3 pb-3 pt-1 border-t space-y-3">
          {description && (
            <p className="text-xs text-muted-foreground">{description}</p>
          )}
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function formatSpeed(speedBps: number): string {
  if (speedBps >= 1000000000) {
    return `${(speedBps / 1000000000).toFixed(0)} Gbps`;
  } else if (speedBps >= 1000000) {
    return `${(speedBps / 1000000).toFixed(0)} Mbps`;
  } else if (speedBps >= 1000) {
    return `${(speedBps / 1000).toFixed(0)} Kbps`;
  }
  return speedBps > 0 ? `${speedBps} bps` : "";
}

interface LinkGroup {
  id: number;
  clientId: number;
  name: string;
  description: string | null;
  groupType: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  members?: Array<{
    id: number;
    groupId: number;
    linkId: number;
    role: string;
    displayOrder: number;
    link?: Link;
  }>;
}

function LinkGroupsTab({ clients }: { clients: Client[] }) {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<LinkGroup | undefined>();
  const [selectedClientId, setSelectedClientId] = useState<number | undefined>();
  
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    groupType: "redundancy",
    clientId: 0,
    selectedLinks: [] as Array<{ linkId: number; role: string; displayOrder: number }>,
  });

  const { data: linkGroups, isLoading } = useQuery<LinkGroup[]>({
    queryKey: ["/api/link-groups"],
  });

  const { data: allLinks } = useQuery<Link[]>({
    queryKey: ["/api/links"],
  });

  const clientLinks = allLinks?.filter(l => 
    !selectedClientId || l.clientId === selectedClientId
  ) || [];

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const res = await apiRequest("POST", "/api/link-groups", {
        name: data.name,
        description: data.description || null,
        groupType: data.groupType,
        clientId: data.clientId,
        members: data.selectedLinks,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/link-groups"] });
      toast({ title: "Grupo criado com sucesso" });
      setDialogOpen(false);
      resetForm();
    },
    onError: () => {
      toast({ title: "Erro ao criar grupo", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: typeof formData }) => {
      const res = await apiRequest("PATCH", `/api/link-groups/${id}`, {
        name: data.name,
        description: data.description || null,
        groupType: data.groupType,
        members: data.selectedLinks,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/link-groups"] });
      toast({ title: "Grupo atualizado com sucesso" });
      setDialogOpen(false);
      resetForm();
    },
    onError: () => {
      toast({ title: "Erro ao atualizar grupo", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/link-groups/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/link-groups"] });
      toast({ title: "Grupo excluído com sucesso" });
    },
    onError: () => {
      toast({ title: "Erro ao excluir grupo", variant: "destructive" });
    },
  });

  const resetForm = () => {
    setFormData({
      name: "",
      description: "",
      groupType: "redundancy",
      clientId: 0,
      selectedLinks: [],
    });
    setEditingGroup(undefined);
    setSelectedClientId(undefined);
  };

  const handleEdit = (group: LinkGroup) => {
    setEditingGroup(group);
    setSelectedClientId(group.clientId);
    setFormData({
      name: group.name,
      description: group.description || "",
      groupType: group.groupType,
      clientId: group.clientId,
      selectedLinks: group.members?.map(m => ({
        linkId: m.linkId,
        role: m.role,
        displayOrder: m.displayOrder,
      })) || [],
    });
    setDialogOpen(true);
  };

  const handleSave = () => {
    if (!formData.name || !formData.clientId || formData.selectedLinks.length < 2) {
      toast({ 
        title: "Preencha os campos obrigatórios", 
        description: "Nome, cliente e pelo menos 2 links são necessários",
        variant: "destructive" 
      });
      return;
    }
    
    if (editingGroup) {
      updateMutation.mutate({ id: editingGroup.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const toggleLinkSelection = (linkId: number) => {
    const existing = formData.selectedLinks.find(l => l.linkId === linkId);
    if (existing) {
      setFormData({
        ...formData,
        selectedLinks: formData.selectedLinks.filter(l => l.linkId !== linkId),
      });
    } else {
      const role = formData.groupType === "redundancy" 
        ? (formData.selectedLinks.length === 0 ? "primary" : "backup")
        : (formData.groupType === "aggregation" ? "member" : "member");
      setFormData({
        ...formData,
        selectedLinks: [
          ...formData.selectedLinks,
          { linkId, role, displayOrder: formData.selectedLinks.length },
        ],
      });
    }
  };

  const updateLinkRole = (linkId: number, role: string) => {
    setFormData({
      ...formData,
      selectedLinks: formData.selectedLinks.map(l => 
        l.linkId === linkId ? { ...l, role } : l
      ),
    });
  };

  const getClientName = (clientId: number) => {
    return clients.find(c => c.id === clientId)?.name || "Cliente desconhecido";
  };

  const getLinkName = (linkId: number) => {
    return allLinks?.find(l => l.id === linkId)?.name || "Link desconhecido";
  };

  const filteredGroups = selectedClientId 
    ? linkGroups?.filter(g => g.clientId === selectedClientId)
    : linkGroups;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-medium">Grupos de Links</h2>
          <p className="text-sm text-muted-foreground">
            Agrupe links para visualização consolidada (redundância ou agregação de banda)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={selectedClientId?.toString() || "all"}
            onValueChange={(v) => setSelectedClientId(v === "all" ? undefined : parseInt(v))}
          >
            <SelectTrigger className="w-48" data-testid="select-filter-client">
              <SelectValue placeholder="Todos os clientes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os clientes</SelectItem>
              {clients.map((c) => (
                <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Dialog open={dialogOpen} onOpenChange={(open) => {
            setDialogOpen(open);
            if (!open) resetForm();
          }}>
            <DialogTrigger asChild>
              <Button data-testid="button-add-group">
                <Plus className="w-4 h-4 mr-2" />
                Novo Grupo
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{editingGroup ? "Editar Grupo" : "Novo Grupo de Links"}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="group-name">Nome do Grupo *</Label>
                    <Input
                      id="group-name"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="Ex: Sede Principal - Redundância"
                      data-testid="input-group-name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="group-type">Perfil do Grupo *</Label>
                    <Select
                      value={formData.groupType}
                      onValueChange={(v) => setFormData({ ...formData, groupType: v })}
                    >
                      <SelectTrigger data-testid="select-group-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="redundancy">
                          Redundância (Ativo/Passivo)
                        </SelectItem>
                        <SelectItem value="aggregation">
                          Agregação (Dual-Stack/Bonding)
                        </SelectItem>
                        <SelectItem value="shared">
                          Banda Compartilhada (Múltiplas VLANs)
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="group-description">Descrição</Label>
                  <Input
                    id="group-description"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="Descrição opcional do grupo"
                    data-testid="input-group-description"
                  />
                </div>

                {!editingGroup && (
                  <div className="space-y-2">
                    <Label>Cliente *</Label>
                    <Select
                      value={formData.clientId?.toString() || ""}
                      onValueChange={(v) => {
                        const clientId = parseInt(v);
                        setFormData({ ...formData, clientId, selectedLinks: [] });
                      }}
                    >
                      <SelectTrigger data-testid="select-group-client">
                        <SelectValue placeholder="Selecione o cliente" />
                      </SelectTrigger>
                      <SelectContent>
                        {clients.map((c) => (
                          <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="space-y-2">
                  <Label>Links do Grupo * (mínimo 2)</Label>
                  <p className="text-xs text-muted-foreground mb-2">
                    {formData.groupType === "redundancy" 
                      ? "Selecione os links e defina qual é o primário e qual é o backup"
                      : formData.groupType === "shared"
                      ? "Selecione os links que compartilham a mesma banda contratada (VLANs/rotas L2). O link primário define a banda do grupo."
                      : "Selecione os links para agregar a banda (ex: IPv4 + IPv6)"
                    }
                  </p>
                  <div className="border rounded-md p-3 space-y-2 max-h-48 overflow-y-auto">
                    {formData.clientId ? (
                      allLinks?.filter(l => l.clientId === formData.clientId).map((link) => {
                        const selected = formData.selectedLinks.find(s => s.linkId === link.id);
                        return (
                          <div key={link.id} className="flex items-center justify-between gap-2 p-2 rounded hover:bg-muted/50">
                            <div className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={!!selected}
                                onChange={() => toggleLinkSelection(link.id)}
                                className="h-4 w-4"
                                data-testid={`checkbox-link-${link.id}`}
                              />
                              <span className="text-sm">{link.name}</span>
                              <Badge variant="outline" className="text-xs">
                                {formatBandwidth(link.bandwidth)}
                              </Badge>
                            </div>
                            {selected && formData.groupType === "redundancy" && (
                              <Select
                                value={selected.role}
                                onValueChange={(r) => updateLinkRole(link.id, r)}
                              >
                                <SelectTrigger className="w-28 h-7 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="primary">Primário</SelectItem>
                                  <SelectItem value="backup">Backup</SelectItem>
                                </SelectContent>
                              </Select>
                            )}
                            {selected && formData.groupType === "aggregation" && (
                              <Select
                                value={selected.role}
                                onValueChange={(r) => updateLinkRole(link.id, r)}
                              >
                                <SelectTrigger className="w-28 h-7 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="ipv4">IPv4</SelectItem>
                                  <SelectItem value="ipv6">IPv6</SelectItem>
                                  <SelectItem value="member">Membro</SelectItem>
                                </SelectContent>
                              </Select>
                            )}
                          </div>
                        );
                      })
                    ) : (
                      <p className="text-sm text-muted-foreground text-center py-4">
                        Selecione um cliente primeiro
                      </p>
                    )}
                    {formData.clientId && allLinks?.filter(l => l.clientId === formData.clientId).length === 0 && (
                      <p className="text-sm text-muted-foreground text-center py-4">
                        Nenhum link encontrado para este cliente
                      </p>
                    )}
                  </div>
                </div>

                <div className="p-3 bg-muted/50 rounded-md text-sm">
                  {formData.groupType === "redundancy" ? (
                    <div className="space-y-1">
                      <p className="font-medium">Perfil: Redundância (Ativo/Passivo)</p>
                      <p className="text-muted-foreground">
                        O grupo é considerado online se qualquer link estiver ativo. 
                        A banda exibida é do link primário quando ativo.
                      </p>
                    </div>
                  ) : formData.groupType === "shared" ? (
                    <div className="space-y-1">
                      <p className="font-medium">Perfil: Banda Compartilhada (Múltiplas VLANs)</p>
                      <p className="text-muted-foreground">
                        Múltiplos links/VLANs compartilham a mesma banda contratada. 
                        A banda do grupo é definida pelo link primário. 
                        Status degradado se qualquer membro estiver offline.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <p className="font-medium">Perfil: Agregação (Dual-Stack/Bonding)</p>
                      <p className="text-muted-foreground">
                        A banda de todos os links é somada para exibir o tráfego total. 
                        Status degradado se algum membro estiver offline.
                      </p>
                    </div>
                  )}
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancelar
                </Button>
                <Button 
                  onClick={handleSave}
                  disabled={createMutation.isPending || updateMutation.isPending}
                  data-testid="button-save-group"
                >
                  {(createMutation.isPending || updateMutation.isPending) && (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  )}
                  {editingGroup ? "Salvar" : "Criar Grupo"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredGroups?.map((group) => (
            <Card key={group.id} data-testid={`card-group-${group.id}`}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-base">{group.name}</CardTitle>
                    <p className="text-xs text-muted-foreground">{getClientName(group.clientId)}</p>
                  </div>
                  <Badge variant={group.groupType === "redundancy" ? "default" : "secondary"}>
                    {group.groupType === "redundancy" ? "Redundância" : (group.groupType === "shared" ? "Banda Compartilhada" : "Agregação")}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {group.description && (
                  <p className="text-sm text-muted-foreground">{group.description}</p>
                )}
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">Links:</p>
                  {group.members?.map((m) => (
                    <div key={m.id} className="flex items-center justify-between text-sm">
                      <span>{m.link?.name || getLinkName(m.linkId)}</span>
                      <Badge variant="outline" className="text-xs">{m.role}</Badge>
                    </div>
                  ))}
                  {(!group.members || group.members.length === 0) && (
                    <p className="text-sm text-muted-foreground">Nenhum link associado</p>
                  )}
                </div>
                <div className="flex items-center justify-end gap-2 pt-2 border-t">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleEdit(group)}
                    data-testid={`button-edit-group-${group.id}`}
                  >
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (confirm("Tem certeza que deseja excluir este grupo?")) {
                        deleteMutation.mutate(group.id);
                      }
                    }}
                    data-testid={`button-delete-group-${group.id}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
          {(!filteredGroups || filteredGroups.length === 0) && (
            <Card className="col-span-full">
              <CardContent className="py-8 text-center text-muted-foreground">
                <Layers className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>Nenhum grupo de links cadastrado.</p>
                <p className="text-sm">Clique em "Novo Grupo" para criar um grupo de links.</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function LinkForm({ link, onSave, onClose, snmpProfiles, clients, onProfileCreated }: { 
  link?: Link; 
  onSave: (data: Partial<Link>) => void;
  onClose: () => void;
  snmpProfiles?: Array<{ id: number; name: string; clientId: number | null }>;
  clients?: Client[];
  onProfileCreated?: () => void;
}) {
  const { toast } = useToast();
  const [discoveredInterfaces, setDiscoveredInterfaces] = useState<SnmpInterface[]>([]);
  const [interfaceSearchTerm, setInterfaceSearchTerm] = useState("");
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [showNewProfileForm, setShowNewProfileForm] = useState(false);
  const [isCreatingProfile, setIsCreatingProfile] = useState(false);
  const [newProfileData, setNewProfileData] = useState({
    name: "",
    version: "v2c",
    community: "public",
    port: 161,
    timeout: 5000,
    retries: 3,
  });
  
  const [isSearchingOnu, setIsSearchingOnu] = useState(false);
  const [isTestingDiagnosis, setIsTestingDiagnosis] = useState(false);
  const [diagnosisResult, setDiagnosisResult] = useState<{ alarmType: string | null; diagnosis: string; description: string } | null>(null);

  // Estados para busca de clientes e etiquetas
  const [clientSearchOpen, setClientSearchOpen] = useState(false);
  const [clientSearchTerm, setClientSearchTerm] = useState("");
  const [tagSearchOpen, setTagSearchOpen] = useState(false);
  const [tagSearchTerm, setTagSearchTerm] = useState("");

  const { data: olts } = useQuery<Olt[]>({
    queryKey: ["/api/olts"],
  });

  const { data: switches } = useQuery<Array<{ id: number; name: string; ipAddress: string; vendor: string | null; model: string | null; isActive: boolean; voalleId: number | null; snmpProfileId: number | null }>>({
    queryKey: ["/api/switches"],
  });

  const { data: concentrators } = useQuery<Array<{ id: number; name: string; ipAddress: string; voalleId: number | null; snmpProfileId: number | null; isActive: boolean }>>({
    queryKey: ["/api/concentrators"],
  });

  // CPEs disponíveis
  const { data: allCpes } = useQuery<Cpe[]>({
    queryKey: ["/api/cpes"],
  });

  // CPEs associados ao link (se editando)
  const { data: linkCpeAssociations, refetch: refetchLinkCpes } = useQuery<Array<{ id: number; cpeId: number; role: string | null; notes: string | null; cpe?: Cpe }>>({
    queryKey: ["/api/links", link?.id, "cpes"],
    enabled: !!link?.id,
  });

  // Estado para CPEs selecionados
  const [selectedCpes, setSelectedCpes] = useState<Array<{ cpeId: number; role: string; ipOverride?: string; showInEquipmentTab?: boolean }>>([]);

  // Limpar CPEs selecionados quando muda de link (editar outro ou criar novo)
  useEffect(() => {
    if (!link?.id) {
      setSelectedCpes([]);
    }
  }, [link?.id]);

  // Inicializar CPEs selecionados quando carrega associações existentes
  useEffect(() => {
    if (linkCpeAssociations) {
      setSelectedCpes(linkCpeAssociations.map(a => ({
        cpeId: a.cpeId,
        role: a.role || "primary",
        ipOverride: (a as any).ipOverride || "",
        showInEquipmentTab: (a as any).showInEquipmentTab || false
      })));
    }
  }, [linkCpeAssociations]);

  // Concentradores ativos
  const activeConcentrators = concentrators?.filter(c => c.isActive);
  
  // Switches ativos (para ponto de acesso)
  const activeSwitches = switches?.filter((s: any) => s.isActive);
  
  const [formData, setFormData] = useState({
    clientId: link?.clientId || 0,
    identifier: link?.identifier || "",
    name: link?.name || "",
    location: link?.location || "",
    address: link?.address || "",
    ipBlock: link?.ipBlock || "/29",
    totalIps: link?.totalIps || 8,
    usableIps: link?.usableIps || 6,
    bandwidth: link?.bandwidth || 200,
    monitoringEnabled: link?.monitoringEnabled ?? true,
    icmpInterval: link?.icmpInterval || 30,
    snmpProfileId: link?.snmpProfileId || null,
    snmpRouterIp: link?.snmpRouterIp || "",
    linkType: (link as any)?.linkType || "gpon",
    switchId: (link as any)?.switchId || null,
    switchPort: (link as any)?.switchPort || "",
    concentratorId: (link as any)?.concentratorId || null,
    trafficSourceType: (link as any)?.trafficSourceType || "manual",
    accessPointId: (link as any)?.accessPointId || null,
    accessPointInterfaceIndex: (link as any)?.accessPointInterfaceIndex || null,
    accessPointInterfaceName: (link as any)?.accessPointInterfaceName || "",
    snmpInterfaceIndex: link?.snmpInterfaceIndex || null,
    snmpInterfaceName: link?.snmpInterfaceName || "",
    snmpInterfaceDescr: link?.snmpInterfaceDescr || "",
    snmpInterfaceAlias: (link as any)?.snmpInterfaceAlias || "",
    monitoredIp: link?.monitoredIp || "",
    latencyThreshold: link?.latencyThreshold || 80,
    packetLossThreshold: link?.packetLossThreshold || 2,
    equipmentVendorId: (link as any)?.equipmentVendorId || null,
    equipmentModel: (link as any)?.equipmentModel || "",
    customCpuOid: (link as any)?.customCpuOid || "",
    customMemoryOid: (link as any)?.customMemoryOid || "",
    snmpCommunity: "",
    oltId: link?.oltId || null,
    onuId: link?.onuId || "",
    voalleContractTagId: link?.voalleContractTagId || null,
    voalleConnectionId: (link as any)?.voalleConnectionId || null,
    voalleContractNumber: (link as any)?.voalleContractNumber || "",
    slotOlt: (link as any)?.slotOlt || null,
    portOlt: (link as any)?.portOlt || null,
    equipmentSerialNumber: (link as any)?.equipmentSerialNumber || "",
    latitude: (link as any)?.latitude || "",
    longitude: (link as any)?.longitude || "",
    invertBandwidth: (link as any)?.invertBandwidth ?? false,
    isL2Link: (link as any)?.isL2Link ?? false,
    // Campos de monitoramento óptico (OIDs vêm do fabricante)
    opticalMonitoringEnabled: (link as any)?.opticalMonitoringEnabled ?? false,
    opticalRxBaseline: (link as any)?.opticalRxBaseline || "",
    opticalTxBaseline: (link as any)?.opticalTxBaseline || "",
    opticalDeltaThreshold: (link as any)?.opticalDeltaThreshold ?? 3,
    sfpType: (link as any)?.sfpType || "",
    // Configuração do gráfico principal
    mainGraphMode: (link as any)?.mainGraphMode || "primary",
    mainGraphInterfaceIds: (link as any)?.mainGraphInterfaceIds || [],
  });

  // Modo de coleta SNMP: 'ip' para IP manual, 'concentrator' para concentrador, 'accessPoint' para ponto de acesso
  const [snmpCollectionMode, setSnmpCollectionMode] = useState<'ip' | 'concentrator' | 'accessPoint'>(() => {
    const linkData = link as any;
    if (linkData?.trafficSourceType === 'accessPoint' && linkData?.accessPointId) return 'accessPoint';
    if (linkData?.concentratorId) return 'concentrator';
    return 'ip';
  });

  // OLTs são globais, filtrar apenas por isActive
  const filteredOlts = olts?.filter(olt => olt.isActive);

  // Buscar etiquetas de contrato do Voalle para o cliente selecionado
  interface VoalleTag {
    id: number;
    serviceTag?: string;
    description?: string;
    contractNumber?: string;
    ip?: string;
    ipBlock?: string;
    bandwidth?: number;
    address?: string;
    location?: string;
    concentratorId?: number;
    concentratorTitle?: string;
    oltId?: number;
    oltTitle?: string;
    slotOlt?: number;
    portOlt?: number;
    equipmentSerialNumber?: string;
  }
  
  const { data: voalleContractTags, isLoading: isLoadingTags, error: tagsError, refetch: refetchTags } = useQuery<{ tags: VoalleTag[]; cnpj?: string; error?: string }>({
    queryKey: ["/api/clients", formData.clientId, "voalle", "contract-tags"],
    enabled: !!formData.clientId,
    staleTime: 0,
    retry: false,
  });

  // Função para preencher dados quando uma etiqueta for selecionada
  const handleSelectContractTag = (tagId: string) => {
    if (tagId === "none") {
      setFormData(prev => ({ ...prev, voalleContractTagId: null }));
      return;
    }
    
    const tag = voalleContractTags?.tags?.find(t => t.id.toString() === tagId);
    if (!tag) {
      setFormData(prev => ({ ...prev, voalleContractTagId: parseInt(tagId, 10) }));
      return;
    }

    // Tentar match automático de OLT pelo voalleId (authenticationAccessPoint)
    let matchedOltId: number | null = null;
    let matchedSwitchId: number | null = null;
    let matchedLinkType: "gpon" | "ptp" = "gpon";
    
    if (tag.oltId) {
      // Primeiro tentar match com OLT
      if (olts) {
        const matchedOlt = olts.find(olt => (olt as any).voalleId === tag.oltId);
        if (matchedOlt) {
          matchedOltId = matchedOlt.id;
          matchedLinkType = "gpon";
        }
      }
      // Se não encontrou OLT, tentar match com Switch (PTP)
      if (!matchedOltId && switches) {
        const matchedSwitch = switches.find(sw => sw.voalleId === tag.oltId);
        if (matchedSwitch) {
          matchedSwitchId = matchedSwitch.id;
          matchedLinkType = "ptp";
        }
      }
    }

    // Tentar match automático de Concentrador pelo voalleId (authenticationConcentrator)
    let matchedConcentratorId: number | null = null;
    if (tag.concentratorId && concentrators) {
      const matchedConc = concentrators.find(c => c.voalleId === tag.concentratorId);
      if (matchedConc) {
        matchedConcentratorId = matchedConc.id;
      }
    }

    // Preencher automaticamente os campos disponíveis
    setFormData(prev => ({
      ...prev,
      voalleContractTagId: tag.id,
      name: prev.name || tag.description || tag.serviceTag || "",
      identifier: prev.identifier || tag.serviceTag || "",
      monitoredIp: prev.monitoredIp || tag.ip || "",
      ipBlock: tag.ipBlock || prev.ipBlock,
      bandwidth: tag.bandwidth || prev.bandwidth,
      address: prev.address || tag.address || "",
      location: prev.location || tag.location || "",
      linkType: matchedSwitchId ? "ptp" : (matchedOltId ? "gpon" : prev.linkType),
      oltId: matchedOltId || (matchedSwitchId ? null : prev.oltId),
      switchId: matchedSwitchId || prev.switchId,
      concentratorId: matchedConcentratorId || prev.concentratorId,
      slotOlt: tag.slotOlt ?? prev.slotOlt,
      portOlt: tag.portOlt ?? prev.portOlt,
      equipmentSerialNumber: tag.equipmentSerialNumber || prev.equipmentSerialNumber,
    }));

    // Se encontrou concentrador, mudar modo para concentrador
    if (matchedConcentratorId) {
      setSnmpCollectionMode('concentrator');
    }

    // Mensagem de feedback
    const messages: string[] = [];
    if (tag.description || tag.serviceTag) messages.push(`Etiqueta: ${tag.description || tag.serviceTag}`);
    if (tag.ipBlock) messages.push(`Bloco IP: ${tag.ipBlock}`);
    if (matchedOltId) messages.push(`OLT encontrada`);
    if (matchedSwitchId) messages.push(`Switch PTP encontrado`);
    if (matchedConcentratorId) messages.push(`Concentrador encontrado`);
    if (tag.slotOlt && tag.portOlt) messages.push(`Slot/Porta: ${tag.slotOlt}/${tag.portOlt}`);
    if (tag.equipmentSerialNumber) messages.push(`Serial ONU: ${tag.equipmentSerialNumber}`);
    
    toast({
      title: "Dados preenchidos",
      description: messages.join(" | ") || "Dados da etiqueta aplicados",
    });
  };

  // Função para FORÇAR atualização de todos os campos do Voalle (sobrescreve campos existentes)
  const handleForceRefreshFromVoalle = async () => {
    if (!formData.voalleContractTagId) {
      toast({
        title: "Nenhuma etiqueta vinculada",
        description: "Selecione uma etiqueta de contrato primeiro",
        variant: "destructive",
      });
      return;
    }

    try {
      // Buscar dados atualizados das etiquetas do Voalle
      const result = await refetchTags();
      const freshTags = result.data;
      
      if (!freshTags?.tags) {
        toast({
          title: "Erro ao buscar etiquetas",
          description: "Não foi possível obter os dados atualizados do Voalle",
          variant: "destructive",
        });
        return;
      }

      const tag = freshTags.tags.find(t => t.id === formData.voalleContractTagId);
      if (!tag) {
        toast({
          title: "Etiqueta não encontrada",
          description: "A etiqueta vinculada não foi encontrada no Voalle",
          variant: "destructive",
        });
        return;
      }

      // Tentar match automático de OLT ou Switch pelo voalleId (authenticationAccessPoint)
      let matchedOltId: number | null = null;
      let matchedSwitchId: number | null = null;
      
      if (tag.oltId) {
        // Primeiro tentar match com OLT
        if (olts) {
          const matchedOlt = olts.find(olt => (olt as any).voalleId === tag.oltId);
          if (matchedOlt) {
            matchedOltId = matchedOlt.id;
          }
        }
        // Se não encontrou OLT, tentar match com Switch (PTP)
        if (!matchedOltId && switches) {
          const matchedSwitch = switches.find(sw => sw.voalleId === tag.oltId);
          if (matchedSwitch) {
            matchedSwitchId = matchedSwitch.id;
          }
        }
      }

      // Tentar match automático de Concentrador pelo voalleId (authenticationConcentrator)
      let matchedConcentratorId: number | null = null;
      if (tag.concentratorId && concentrators) {
        const matchedConc = concentrators.find(c => c.voalleId === tag.concentratorId);
        if (matchedConc) {
          matchedConcentratorId = matchedConc.id;
        }
      }

      // FORÇAR atualização de TODOS os campos (sobrescrever valores existentes)
      setFormData(prev => ({
        ...prev,
        name: tag.description || tag.serviceTag || prev.name,
        identifier: tag.serviceTag || prev.identifier,
        monitoredIp: tag.ip || prev.monitoredIp,
        ipBlock: tag.ipBlock || prev.ipBlock,
        bandwidth: tag.bandwidth || prev.bandwidth,
        address: tag.address || prev.address,
        location: tag.location || prev.location,
        linkType: matchedSwitchId ? "ptp" : (matchedOltId ? "gpon" : prev.linkType),
        oltId: matchedOltId ?? (matchedSwitchId ? null : prev.oltId),
        switchId: matchedSwitchId ?? prev.switchId,
        concentratorId: matchedConcentratorId ?? prev.concentratorId,
        slotOlt: tag.slotOlt ?? prev.slotOlt,
        portOlt: tag.portOlt ?? prev.portOlt,
        equipmentSerialNumber: tag.equipmentSerialNumber || prev.equipmentSerialNumber,
      }));

      // Se encontrou concentrador, mudar modo para concentrador
      if (matchedConcentratorId) {
        setSnmpCollectionMode('concentrator');
      }

      // Mensagem de feedback detalhada
      const updates: string[] = [];
      if (tag.description || tag.serviceTag) updates.push(`Nome: ${tag.description || tag.serviceTag}`);
      if (tag.ip) updates.push(`IP: ${tag.ip}`);
      if (matchedOltId) updates.push(`OLT: encontrada`);
      else if (matchedSwitchId) updates.push(`Switch PTP: encontrado`);
      else if (tag.oltId) updates.push(`OLT/Switch Voalle #${tag.oltId}: não mapeado`);
      if (matchedConcentratorId) updates.push(`Concentrador: encontrado`);
      else if (tag.concentratorId) updates.push(`Conc. Voalle #${tag.concentratorId}: não mapeado`);
      if (tag.slotOlt !== null && tag.portOlt !== null) updates.push(`Slot/Porta: ${tag.slotOlt}/${tag.portOlt}`);
      if (tag.equipmentSerialNumber) updates.push(`Serial: ${tag.equipmentSerialNumber}`);
      
      toast({
        title: "Dados atualizados do Voalle",
        description: updates.join(" | ") || "Todos os campos foram atualizados",
      });
    } catch (error) {
      toast({
        title: "Erro ao atualizar",
        description: "Falha ao buscar dados do Voalle",
        variant: "destructive",
      });
    }
  };

  const { data: equipmentVendors } = useQuery<Array<{ id: number; name: string; slug: string; cpuOid: string | null; memoryOid: string | null; opticalRxOid: string | null; opticalTxOid: string | null; opticalOltRxOid: string | null }>>({
    queryKey: ["/api/equipment-vendors"],
  });

  // Incluir perfis do cliente E perfis globais (concentradores)
  const filteredSnmpProfiles = snmpProfiles?.filter(p => p.clientId === formData.clientId || p.clientId === null);

  // Estado para lembrar de qual modo a descoberta foi feita (para gravar no campo correto)
  const [discoverMode, setDiscoverMode] = useState<'normal' | 'accessPoint'>('normal');
  
  const handleDiscoverInterfaces = async (overrideIp?: string, overrideProfileId?: number, mode: 'normal' | 'accessPoint' = 'normal') => {
    setDiscoverMode(mode);
    const targetIp = overrideIp || formData.snmpRouterIp;
    const profileId = overrideProfileId || formData.snmpProfileId;
    
    if (!targetIp || !profileId) {
      toast({
        title: "Campos obrigatórios",
        description: "Selecione um perfil SNMP e informe o IP do roteador",
        variant: "destructive",
      });
      return;
    }
    
    setIsDiscovering(true);
    setDiscoveredInterfaces([]);
    
    try {
      const response = await apiRequest("POST", "/api/snmp/discover-interfaces", {
        targetIp: targetIp,
        snmpProfileId: profileId,
      });
      
      const interfaces: SnmpInterface[] = await response.json();
      setDiscoveredInterfaces(interfaces);
      
      if (interfaces.length === 0) {
        toast({
          title: "Nenhuma interface encontrada",
          description: "O dispositivo não retornou interfaces SNMP",
          variant: "default",
        });
      } else {
        toast({
          title: "Interfaces descobertas",
          description: `${interfaces.length} interface(s) encontrada(s)`,
        });
      }
    } catch (error: any) {
      const errorMessage = error.message || "Não foi possível conectar ao dispositivo";
      const cleanMessage = errorMessage.replace(/^\d+:\s*/, "").replace(/^{"error":"(.+)"}$/, "$1");
      toast({
        title: "Erro na descoberta SNMP",
        description: cleanMessage,
        variant: "destructive",
      });
    } finally {
      setIsDiscovering(false);
    }
  };

  const handleSelectInterface = (ifIndex: string) => {
    const iface = discoveredInterfaces.find(i => i.ifIndex.toString() === ifIndex);
    if (iface) {
      // Se a descoberta foi feita para o ponto de acesso, gravar nos campos de accessPoint
      if (discoverMode === 'accessPoint') {
        setFormData({
          ...formData,
          accessPointInterfaceIndex: iface.ifIndex,
          accessPointInterfaceName: iface.ifName || iface.ifDescr || ifIndex,
        });
        toast({
          title: "Interface do Ponto de Acesso selecionada",
          description: `${iface.ifName || iface.ifDescr} (index: ${iface.ifIndex})`,
        });
      } else if (formData.linkType === "ptp") {
        setFormData({
          ...formData,
          switchPort: iface.ifName || iface.ifDescr || ifIndex,
          snmpInterfaceIndex: iface.ifIndex,
        });
        toast({
          title: "Interface selecionada",
          description: `${iface.ifName || iface.ifDescr} (index: ${iface.ifIndex})`,
        });
      } else {
        setFormData({
          ...formData,
          snmpInterfaceIndex: iface.ifIndex,
          snmpInterfaceName: iface.ifName,
          snmpInterfaceDescr: iface.ifDescr,
          snmpInterfaceAlias: iface.ifAlias || "",
        });
      }
    }
  };

  const handleCreateProfile = async () => {
    if (!newProfileData.name.trim()) {
      toast({
        title: "Nome obrigatório",
        description: "Informe um nome para o perfil SNMP",
        variant: "destructive",
      });
      return;
    }
    
    setIsCreatingProfile(true);
    try {
      const response = await apiRequest("POST", `/api/clients/${formData.clientId}/snmp-profiles`, {
        name: newProfileData.name,
        version: newProfileData.version,
        community: newProfileData.community,
        port: newProfileData.port,
        timeout: newProfileData.timeout,
        retries: newProfileData.retries,
      });
      
      const created = await response.json();
      toast({
        title: "Perfil SNMP criado",
        description: `Perfil "${newProfileData.name}" criado com sucesso`,
      });
      
      setFormData({ ...formData, snmpProfileId: created.id });
      setShowNewProfileForm(false);
      setNewProfileData({ name: "", version: "v2c", community: "public", port: 161, timeout: 5000, retries: 3 });
      onProfileCreated?.();
    } catch (error: any) {
      toast({
        title: "Erro ao criar perfil",
        description: error.message || "Não foi possível criar o perfil SNMP",
        variant: "destructive",
      });
    } finally {
      setIsCreatingProfile(false);
    }
  };

  const selectedClientName = clients?.find(c => c.id === formData.clientId)?.name;

  return (
    <div className="space-y-4">
      {clients && clients.length > 0 && (
        <div className="space-y-2">
          <Label htmlFor="clientId">Cliente *</Label>
          {clients.length === 1 ? (
            <div className="flex items-center gap-2 h-9 px-3 rounded-md border bg-muted/50">
              <Building2 className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm">{clients[0].name}</span>
            </div>
          ) : (
            <Popover open={clientSearchOpen} onOpenChange={setClientSearchOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  className="w-full justify-between"
                  data-testid="select-link-client"
                >
                  <span className="truncate">
                    {clients?.find(c => c.id === formData.clientId)?.name || "Selecione um cliente"}
                  </span>
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80 p-0" align="start">
                <div className="p-2 border-b">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Buscar cliente..."
                      value={clientSearchTerm}
                      onChange={(e) => setClientSearchTerm(e.target.value)}
                      className="pl-8 h-9"
                      data-testid="input-search-link-client"
                    />
                  </div>
                </div>
                <ScrollArea className="max-h-60">
                  <div className="p-1">
                    {clients
                      ?.filter(c => !clientSearchTerm.trim() || 
                        c.name?.toLowerCase().includes(clientSearchTerm.toLowerCase()) ||
                        c.cnpj?.toLowerCase().includes(clientSearchTerm.toLowerCase())
                      )
                      .map((client) => (
                        <Button
                          key={client.id}
                          variant="ghost"
                          className={`w-full justify-start text-left h-9 px-2 ${formData.clientId === client.id ? "bg-accent" : ""}`}
                          onClick={() => {
                            setFormData({ ...formData, clientId: client.id, snmpProfileId: null });
                            setClientSearchOpen(false);
                            setClientSearchTerm("");
                          }}
                        >
                          <Check className={`mr-2 h-4 w-4 ${formData.clientId === client.id ? "opacity-100" : "opacity-0"}`} />
                          <span className="truncate">{client.name}</span>
                        </Button>
                      ))}
                    {clients?.filter(c => !clientSearchTerm.trim() || 
                      c.name?.toLowerCase().includes(clientSearchTerm.toLowerCase()) ||
                      c.cnpj?.toLowerCase().includes(clientSearchTerm.toLowerCase())
                    ).length === 0 && (
                      <div className="py-4 text-center text-sm text-muted-foreground">
                        Nenhum cliente encontrado
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </PopoverContent>
            </Popover>
          )}
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Label htmlFor="voalleContractTagId">Etiqueta de Contrato (Voalle)</Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleForceRefreshFromVoalle}
            disabled={isLoadingTags || !formData.voalleContractTagId}
            title={formData.voalleContractTagId ? "Atualizar todos os dados do Voalle" : "Selecione uma etiqueta primeiro"}
            data-testid="button-refresh-tags-top"
          >
            {isLoadingTags ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          </Button>
        </div>
        {tagsError ? (
          <div className="flex items-center gap-2 h-9 px-3 rounded-md border border-destructive bg-destructive/10">
            <span className="text-sm text-destructive">
              Erro ao buscar etiquetas: {(tagsError as any)?.message || "Erro desconhecido"}
            </span>
          </div>
        ) : isLoadingTags ? (
          <div className="flex items-center gap-2 h-9 px-3 rounded-md border bg-muted/50">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm text-muted-foreground">Carregando etiquetas...</span>
          </div>
        ) : voalleContractTags?.error ? (
          <div className="flex items-center gap-2 h-9 px-3 rounded-md border border-destructive bg-destructive/10">
            <span className="text-sm text-destructive">{voalleContractTags.error}</span>
          </div>
        ) : voalleContractTags?.tags && voalleContractTags.tags.length > 0 ? (
          <Popover open={tagSearchOpen} onOpenChange={setTagSearchOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                className="w-full justify-between"
                data-testid="select-voalle-contract-tag-top"
              >
                <span className="truncate">
                  {formData.voalleContractTagId 
                    ? (() => {
                        const tag = voalleContractTags.tags.find(t => t.id === formData.voalleContractTagId);
                        return tag ? `${tag.serviceTag || `#${tag.id}`} - ${tag.description || "Sem descrição"}` : "Selecione uma etiqueta";
                      })()
                    : "Selecione uma etiqueta (opcional)"
                  }
                </span>
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-96 p-0" align="start">
              <div className="p-2 border-b">
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Buscar etiqueta, descrição, contrato..."
                    value={tagSearchTerm}
                    onChange={(e) => setTagSearchTerm(e.target.value)}
                    className="pl-8 h-9"
                    data-testid="input-search-tag"
                  />
                </div>
              </div>
              <ScrollArea className="max-h-64">
                <div className="p-1">
                  <Button
                    variant="ghost"
                    className={`w-full justify-start text-left h-9 px-2 ${!formData.voalleContractTagId ? "bg-accent" : ""}`}
                    onClick={() => {
                      handleSelectContractTag("none");
                      setTagSearchOpen(false);
                      setTagSearchTerm("");
                    }}
                  >
                    <Check className={`mr-2 h-4 w-4 ${!formData.voalleContractTagId ? "opacity-100" : "opacity-0"}`} />
                    Nenhuma etiqueta
                  </Button>
                  {voalleContractTags.tags
                    .filter(tag => !tagSearchTerm.trim() || 
                      tag.serviceTag?.toLowerCase().includes(tagSearchTerm.toLowerCase()) ||
                      tag.description?.toLowerCase().includes(tagSearchTerm.toLowerCase()) ||
                      tag.contractNumber?.toString().includes(tagSearchTerm) ||
                      tag.ip?.includes(tagSearchTerm)
                    )
                    .map((tag) => (
                      <Button
                        key={tag.id}
                        variant="ghost"
                        className={`w-full justify-start text-left h-auto py-2 px-2 ${formData.voalleContractTagId === tag.id ? "bg-accent" : ""}`}
                        onClick={() => {
                          handleSelectContractTag(tag.id.toString());
                          setTagSearchOpen(false);
                          setTagSearchTerm("");
                        }}
                      >
                        <Check className={`mr-2 h-4 w-4 shrink-0 ${formData.voalleContractTagId === tag.id ? "opacity-100" : "opacity-0"}`} />
                        <div className="flex flex-col items-start min-w-0">
                          <span className="font-medium truncate w-full">{tag.serviceTag || `#${tag.id}`}</span>
                          <span className="text-xs text-muted-foreground truncate w-full">
                            {tag.description || "Sem descrição"}{tag.contractNumber ? ` (Contrato ${tag.contractNumber})` : ""}
                          </span>
                          {tag.ip && <span className="text-xs font-mono text-muted-foreground">IP: {tag.ip}</span>}
                        </div>
                      </Button>
                    ))}
                  {voalleContractTags.tags.filter(tag => !tagSearchTerm.trim() || 
                    tag.serviceTag?.toLowerCase().includes(tagSearchTerm.toLowerCase()) ||
                    tag.description?.toLowerCase().includes(tagSearchTerm.toLowerCase()) ||
                    tag.contractNumber?.toString().includes(tagSearchTerm) ||
                    tag.ip?.includes(tagSearchTerm)
                  ).length === 0 && (
                    <div className="py-4 text-center text-sm text-muted-foreground">
                      Nenhuma etiqueta encontrada
                    </div>
                  )}
                </div>
              </ScrollArea>
            </PopoverContent>
          </Popover>
        ) : (
          <div className="flex items-center gap-2 h-9 px-3 rounded-md border bg-muted/50">
            <span className="text-sm text-muted-foreground">
              {voalleContractTags?.cnpj 
                ? "Nenhuma etiqueta encontrada no Voalle" 
                : "Configure o CNPJ do cliente para buscar etiquetas"}
            </span>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Vincule este link a uma etiqueta para filtrar solicitações do Voalle
        </p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="identifier">Identificador</Label>
          <Input
            id="identifier"
            value={formData.identifier}
            onChange={(e) => setFormData({ ...formData, identifier: e.target.value })}
            placeholder="sede, central, etc."
            data-testid="input-link-identifier"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="name">Nome</Label>
          <Input
            id="name"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="Nome do link"
            data-testid="input-link-name"
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="location">Localização</Label>
        <Input
          id="location"
          value={formData.location}
          onChange={(e) => setFormData({ ...formData, location: e.target.value })}
          placeholder="Cidade, Estado"
          data-testid="input-link-location"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="address">Endereço Completo</Label>
        <Input
          id="address"
          value={formData.address}
          onChange={(e) => setFormData({ ...formData, address: e.target.value })}
          placeholder="Endereço completo"
          data-testid="input-link-address"
        />
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label htmlFor="ipBlock">Bloco IP</Label>
          <Input
            id="ipBlock"
            value={formData.ipBlock}
            onChange={(e) => {
              const value = e.target.value;
              const maskMatch = value.match(/\/(\d+)$/);
              const mask = maskMatch ? parseInt(maskMatch[1], 10) : 29;
              const ipInfo: Record<number, { total: number; usable: number }> = {
                32: { total: 1, usable: 1 },
                31: { total: 2, usable: 2 },
                30: { total: 4, usable: 2 },
                29: { total: 8, usable: 6 },
                28: { total: 16, usable: 14 },
                27: { total: 32, usable: 30 },
                26: { total: 64, usable: 62 },
                25: { total: 128, usable: 126 },
                24: { total: 256, usable: 254 },
              };
              const info = ipInfo[mask] || { total: 8, usable: 6 };
              setFormData({ ...formData, ipBlock: value, totalIps: info.total, usableIps: info.usable });
            }}
            placeholder="Ex: 191.52.252.161/32"
            data-testid="input-ip-block"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="bandwidth">Banda (Mbps)</Label>
          <Input
            id="bandwidth"
            type="number"
            value={formData.bandwidth}
            onChange={(e) => setFormData({ ...formData, bandwidth: parseInt(e.target.value, 10) || 200 })}
            data-testid="input-bandwidth"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="icmpInterval">Intervalo ICMP (s)</Label>
          <Input
            id="icmpInterval"
            type="number"
            value={formData.icmpInterval}
            onChange={(e) => setFormData({ ...formData, icmpInterval: parseInt(e.target.value, 10) || 30 })}
            data-testid="input-icmp-interval"
          />
        </div>
      </div>
      
      <div className="border-t pt-4 mt-4">
        <h4 className="font-medium mb-3">Configuração SNMP para Tráfego</h4>
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label htmlFor="snmpProfileId">Perfil SNMP</Label>
            {filteredSnmpProfiles && filteredSnmpProfiles.length > 0 ? (
              <Select
                value={formData.snmpProfileId?.toString() || "none"}
                onValueChange={(value) => setFormData({ ...formData, snmpProfileId: value === "none" ? null : parseInt(value, 10) })}
              >
                <SelectTrigger data-testid="select-snmp-profile">
                  <SelectValue placeholder="Selecione um perfil" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhum</SelectItem>
                  {filteredSnmpProfiles.map((p) => (
                    <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground flex-1">Nenhum perfil SNMP</span>
                <Button 
                  type="button" 
                  variant="outline" 
                  size="sm"
                  onClick={() => setShowNewProfileForm(true)}
                  data-testid="button-create-snmp-profile-inline"
                >
                  <Plus className="w-4 h-4 mr-1" />
                  Criar Perfil
                </Button>
              </div>
            )}
          </div>
          <div className="space-y-2">
            <Label>Origem dos Dados de Tráfego</Label>
            <Select
              value={snmpCollectionMode}
              onValueChange={(v) => {
                const mode = v as 'ip' | 'concentrator' | 'accessPoint';
                setSnmpCollectionMode(mode);
                if (mode === 'ip') {
                  setFormData({ ...formData, concentratorId: null, trafficSourceType: 'manual', accessPointId: null, accessPointInterfaceIndex: null, accessPointInterfaceName: null });
                } else if (mode === 'concentrator') {
                  setFormData({ ...formData, snmpRouterIp: "", trafficSourceType: 'concentrator', accessPointId: null, accessPointInterfaceIndex: null, accessPointInterfaceName: null });
                } else {
                  setFormData({ ...formData, trafficSourceType: 'accessPoint', concentratorId: null });
                }
              }}
            >
              <SelectTrigger data-testid="select-snmp-collection-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ip">IP Manual</SelectItem>
                <SelectItem value="concentrator">Concentrador</SelectItem>
                <SelectItem value="accessPoint">Ponto de Acesso (Switch/PE)</SelectItem>
              </SelectContent>
            </Select>
            {snmpCollectionMode === 'accessPoint' && (
              <p className="text-xs text-muted-foreground">
                Use para links L2 com RSTP onde o concentrador não identifica qual rota está ativa. A coleta será feita pelo switch de acesso/PE.
              </p>
            )}
          </div>
          <div className="space-y-2">
            {snmpCollectionMode === 'ip' && (
              <>
                <Label htmlFor="snmpRouterIp">IP do Roteador/Switch</Label>
                <div className="flex gap-2">
                  <Input
                    id="snmpRouterIp"
                    value={formData.snmpRouterIp}
                    onChange={(e) => setFormData({ ...formData, snmpRouterIp: e.target.value })}
                    placeholder="192.168.1.1"
                    data-testid="input-snmp-router-ip"
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => handleDiscoverInterfaces()}
                    disabled={isDiscovering || !formData.snmpProfileId || !formData.snmpRouterIp}
                    data-testid="button-discover-interfaces"
                  >
                    {isDiscovering ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Search className="w-4 h-4" />
                    )}
                  </Button>
                </div>
              </>
            )}
            {snmpCollectionMode === 'concentrator' && (
              <>
                <Label htmlFor="concentratorId">Concentrador</Label>
                <div className="flex gap-2">
                  <Select
                    value={formData.concentratorId?.toString() || "none"}
                    onValueChange={(v) => {
                      const concId = v === "none" ? null : parseInt(v, 10);
                      const selectedConc = concId ? activeConcentrators?.find(c => c.id === concId) : null;
                      setFormData({ 
                        ...formData, 
                        concentratorId: concId,
                        snmpProfileId: selectedConc?.snmpProfileId || formData.snmpProfileId,
                        snmpRouterIp: selectedConc?.ipAddress || formData.snmpRouterIp
                      });
                    }}
                  >
                    <SelectTrigger data-testid="select-snmp-concentrator" className="flex-1">
                      <SelectValue placeholder="Selecione..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Nenhum</SelectItem>
                      {activeConcentrators?.map((c) => (
                        <SelectItem key={c.id} value={c.id.toString()}>
                          {c.name} ({c.ipAddress})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      const selectedConc = activeConcentrators?.find(c => c.id === formData.concentratorId);
                      if (selectedConc) {
                        const profileId = selectedConc.snmpProfileId || formData.snmpProfileId;
                        if (profileId) {
                          setFormData({ 
                            ...formData, 
                            snmpRouterIp: selectedConc.ipAddress,
                            snmpProfileId: profileId 
                          });
                          // Passa parâmetros diretamente para evitar problemas de estado assíncrono
                          handleDiscoverInterfaces(selectedConc.ipAddress, profileId);
                        } else {
                          toast({
                            title: "Perfil SNMP não configurado",
                            description: "Configure um perfil SNMP para o concentrador",
                            variant: "destructive",
                          });
                        }
                      }
                    }}
                    disabled={isDiscovering || !formData.concentratorId || (!formData.snmpProfileId && !activeConcentrators?.find(c => c.id === formData.concentratorId)?.snmpProfileId)}
                    data-testid="button-discover-interfaces-concentrator"
                  >
                    {isDiscovering ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Search className="w-4 h-4" />
                    )}
                  </Button>
                </div>
              </>
            )}
            {snmpCollectionMode === 'accessPoint' && (
              <>
                <Label htmlFor="accessPointId">Switch de Acesso / PE</Label>
                <div className="flex gap-2">
                  <Select
                    value={formData.accessPointId?.toString() || "none"}
                    onValueChange={(v) => {
                      const swId = v === "none" ? null : parseInt(v, 10);
                      const selectedSwitch = swId ? activeSwitches?.find((s: any) => s.id === swId) : null;
                      setFormData({ 
                        ...formData, 
                        accessPointId: swId,
                        snmpProfileId: selectedSwitch?.snmpProfileId || formData.snmpProfileId
                      });
                    }}
                  >
                    <SelectTrigger data-testid="select-access-point" className="flex-1">
                      <SelectValue placeholder="Selecione o switch..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Nenhum</SelectItem>
                      {activeSwitches?.map((s: any) => (
                        <SelectItem key={s.id} value={s.id.toString()}>
                          {s.name} ({s.ipAddress})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      const selectedSwitch = activeSwitches?.find((s: any) => s.id === formData.accessPointId);
                      if (selectedSwitch) {
                        const profileId = selectedSwitch.snmpProfileId || formData.snmpProfileId;
                        if (profileId) {
                          handleDiscoverInterfaces(selectedSwitch.ipAddress, profileId, 'accessPoint');
                        } else {
                          toast({
                            title: "Perfil SNMP não configurado",
                            description: "Configure um perfil SNMP para o switch",
                            variant: "destructive",
                          });
                        }
                      }
                    }}
                    disabled={isDiscovering || !formData.accessPointId}
                    data-testid="button-discover-interfaces-accesspoint"
                  >
                    {isDiscovering ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Search className="w-4 h-4" />
                    )}
                  </Button>
                </div>
                {formData.accessPointInterfaceName && (
                  <div className="text-sm text-muted-foreground flex items-center gap-2 mt-1">
                    <span>Interface configurada:</span>
                    <Badge variant="secondary">
                      {formData.accessPointInterfaceName} (ifIndex: {formData.accessPointInterfaceIndex})
                    </Badge>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
        
        {discoveredInterfaces.length > 0 && (
          <div className="space-y-2 mt-3">
            <Label>Selecionar Interface Descoberta ({discoveredInterfaces.length} encontradas)</Label>
            <div className="flex gap-2">
              <Input
                placeholder="Buscar por nome, índice, descrição ou alias..."
                value={interfaceSearchTerm}
                onChange={(e) => setInterfaceSearchTerm(e.target.value)}
                className="flex-1"
                data-testid="input-interface-search"
              />
              {interfaceSearchTerm && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setInterfaceSearchTerm("")}
                >
                  <X className="w-4 h-4" />
                </Button>
              )}
            </div>
            <Select
              value={formData.snmpInterfaceIndex?.toString() || ""}
              onValueChange={handleSelectInterface}
            >
              <SelectTrigger data-testid="select-discovered-interface">
                <SelectValue placeholder="Escolha uma interface..." />
              </SelectTrigger>
              <SelectContent className="max-h-[300px]">
                {discoveredInterfaces
                  .filter((iface) => {
                    if (!interfaceSearchTerm) return true;
                    const search = interfaceSearchTerm.toLowerCase();
                    return (
                      iface.ifIndex.toString().includes(search) ||
                      (iface.ifName || "").toLowerCase().includes(search) ||
                      (iface.ifDescr || "").toLowerCase().includes(search) ||
                      (iface.ifAlias || "").toLowerCase().includes(search)
                    );
                  })
                  .map((iface) => (
                  <SelectItem key={iface.ifIndex} value={iface.ifIndex.toString()}>
                    <div className="flex items-center gap-2">
                      <Badge 
                        variant={iface.ifOperStatus === "up" ? "default" : "secondary"}
                        className="text-xs"
                      >
                        {iface.ifOperStatus}
                      </Badge>
                      <span className="font-mono text-sm">{iface.ifIndex}</span>
                      <span>{iface.ifName || iface.ifDescr}</span>
                      {iface.ifAlias && iface.ifAlias !== iface.ifName && (
                        <span className="text-muted-foreground text-xs italic">
                          ({iface.ifAlias})
                        </span>
                      )}
                      {iface.ifSpeed > 0 && (
                        <span className="text-muted-foreground text-xs">
                          [{formatSpeed(iface.ifSpeed)}]
                        </span>
                      )}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        
        <div className="grid grid-cols-3 gap-4 mt-3">
          <div className="space-y-2">
            <Label htmlFor="snmpInterfaceIndex">Índice da Interface (ifIndex)</Label>
            <Input
              id="snmpInterfaceIndex"
              type="number"
              value={formData.snmpInterfaceIndex || ""}
              onChange={(e) => setFormData({ ...formData, snmpInterfaceIndex: e.target.value ? parseInt(e.target.value, 10) : null })}
              placeholder="1, 2, 3..."
              data-testid="input-snmp-interface-index"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="snmpInterfaceName">Nome da Interface</Label>
            <Input
              id="snmpInterfaceName"
              value={formData.snmpInterfaceName}
              onChange={(e) => setFormData({ ...formData, snmpInterfaceName: e.target.value })}
              placeholder="GigabitEthernet0/1"
              data-testid="input-snmp-interface-name"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="snmpInterfaceDescr">Descrição</Label>
            <Input
              id="snmpInterfaceDescr"
              value={formData.snmpInterfaceDescr}
              onChange={(e) => setFormData({ ...formData, snmpInterfaceDescr: e.target.value })}
              placeholder="Uplink para Internet"
              data-testid="input-snmp-interface-descr"
            />
          </div>
        </div>

      </div>

      <div className="border-t pt-4 mt-4">
        <h4 className="font-medium mb-3">Tipo de Conexao</h4>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div className="space-y-2">
            <Label htmlFor="linkType">Tipo de Link</Label>
            <Select
              value={formData.linkType}
              onValueChange={(value) => setFormData({ ...formData, linkType: value, oltId: null, switchId: null })}
            >
              <SelectTrigger data-testid="select-link-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="gpon">GPON (Fibra/OLT)</SelectItem>
                <SelectItem value="ptp">PTP (Ponto-a-Ponto/Switch)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {formData.linkType === "gpon" && (
          <>
            <h4 className="font-medium mb-3">Diagnostico OLT/ONU</h4>
            <p className="text-sm text-muted-foreground mb-3">
              Configure a OLT e ONU para diagnostico automatico de causa raiz em alarmes criticos
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="oltId">OLT</Label>
            <Select
              value={formData.oltId?.toString() || "none"}
              onValueChange={(value) => setFormData({ ...formData, oltId: value === "none" ? null : parseInt(value, 10) })}
            >
              <SelectTrigger data-testid="select-olt">
                <SelectValue placeholder="Selecione a OLT" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Nenhuma OLT</SelectItem>
                {filteredOlts?.map((olt) => (
                  <SelectItem key={olt.id} value={olt.id.toString()}>
                    {olt.name} ({olt.ipAddress})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="onuId">ID da ONU</Label>
            <div className="flex gap-2">
              <Input
                id="onuId"
                value={formData.onuId}
                onChange={(e) => setFormData({ ...formData, onuId: e.target.value })}
                placeholder="Ex: gpon-olt_1/1/3:116"
                data-testid="input-onu-id"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                disabled={!formData.oltId || !formData.equipmentSerialNumber || isSearchingOnu}
                onClick={async () => {
                  if (!formData.oltId || !formData.equipmentSerialNumber) {
                    toast({ title: "Atenção", description: "Informe a OLT e o Serial da ONU para buscar o ID", variant: "destructive" });
                    return;
                  }
                  setIsSearchingOnu(true);
                  try {
                    const response = await apiRequest("POST", `/api/olts/${formData.oltId}/search-onu`, {
                      searchString: formData.equipmentSerialNumber
                    });
                    const result = await response.json();
                    if (result.success && result.onuId) {
                      setFormData({ ...formData, onuId: result.onuId });
                      toast({ title: "ONU encontrada", description: `ID: ${result.onuId}` });
                    } else {
                      toast({ title: "ONU não encontrada", description: result.message, variant: "destructive" });
                    }
                  } catch (error) {
                    toast({ title: "Erro", description: "Falha ao buscar ONU na OLT", variant: "destructive" });
                  } finally {
                    setIsSearchingOnu(false);
                  }
                }}
                title="Buscar ID da ONU usando o Serial"
                data-testid="button-search-onu"
              >
                {isSearchingOnu ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Clique na lupa para buscar o ID usando o Serial da ONU</p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4 mt-4">
          <div className="space-y-2">
            <Label htmlFor="slotOlt">Slot OLT</Label>
            <Input
              id="slotOlt"
              type="number"
              value={formData.slotOlt ?? ""}
              onChange={(e) => setFormData({ ...formData, slotOlt: e.target.value ? parseInt(e.target.value, 10) : null })}
              placeholder="Ex: 1"
              data-testid="input-slot-olt"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="portOlt">Porta OLT</Label>
            <Input
              id="portOlt"
              type="number"
              value={formData.portOlt ?? ""}
              onChange={(e) => setFormData({ ...formData, portOlt: e.target.value ? parseInt(e.target.value, 10) : null })}
              placeholder="Ex: 3"
              data-testid="input-port-olt"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="equipmentSerialNumber">Serial da ONU</Label>
            <Input
              id="equipmentSerialNumber"
              value={formData.equipmentSerialNumber}
              onChange={(e) => setFormData({ ...formData, equipmentSerialNumber: e.target.value })}
              placeholder="Ex: ZTEG12345678"
              data-testid="input-equipment-serial"
            />
          </div>
        </div>
        
        {formData.voalleContractTagId && (
          <div className="mt-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isLoadingTags}
              onClick={async () => {
                await refetchTags();
                const tag = voalleContractTags?.tags?.find(t => t.id === formData.voalleContractTagId);
                if (tag) {
                  setFormData(prev => ({
                    ...prev,
                    slotOlt: tag.slotOlt ?? prev.slotOlt,
                    portOlt: tag.portOlt ?? prev.portOlt,
                    equipmentSerialNumber: tag.equipmentSerialNumber ?? prev.equipmentSerialNumber,
                  }));
                  toast({ title: "Voalle Sincronizado", description: "Dados de Slot, Porta e Serial atualizados" });
                } else {
                  toast({ title: "Etiqueta não encontrada", description: "Selecione uma etiqueta válida", variant: "destructive" });
                }
              }}
              data-testid="button-sync-voalle"
            >
              {isLoadingTags ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Sincronizar do Voalle
            </Button>
            <p className="text-xs text-muted-foreground mt-1">Atualiza Slot, Porta e Serial da etiqueta selecionada</p>
          </div>
        )}
        {!filteredOlts?.length && formData.oltId === null && (
          <p className="text-sm text-muted-foreground mt-2">
            Nenhuma OLT cadastrada para este cliente. Acesse a aba OLTs para cadastrar.
          </p>
        )}
        
        {formData.oltId && formData.onuId && (
          <div className="mt-4 p-3 bg-muted/50 rounded-md">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Testar Diagnóstico</p>
                <p className="text-xs text-muted-foreground">Consulta a OLT para verificar o status da ONU</p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isTestingDiagnosis}
                onClick={async () => {
                  setIsTestingDiagnosis(true);
                  setDiagnosisResult(null);
                  try {
                    const response = await apiRequest("POST", `/api/olts/${formData.oltId}/test-diagnosis`, {
                      onuId: formData.onuId,
                      slotOlt: formData.slotOlt,
                      portOlt: formData.portOlt,
                      equipmentSerialNumber: formData.equipmentSerialNumber,
                    });
                    const result = await response.json();
                    setDiagnosisResult(result);
                    if (result.alarmType) {
                      toast({ title: "Alarme Detectado", description: `${result.diagnosis}: ${result.description}`, variant: "destructive" });
                    } else {
                      toast({ title: "Diagnóstico OK", description: result.diagnosis || "Sem alarmes ativos" });
                    }
                  } catch (error) {
                    toast({ title: "Erro", description: "Falha ao testar diagnóstico na OLT", variant: "destructive" });
                  } finally {
                    setIsTestingDiagnosis(false);
                  }
                }}
                data-testid="button-test-diagnosis"
              >
                {isTestingDiagnosis ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Activity className="h-4 w-4 mr-2" />}
                Testar
              </Button>
            </div>
            {diagnosisResult && (
              <div className={`mt-3 p-2 rounded text-sm ${diagnosisResult.alarmType ? 'bg-destructive/10 text-destructive' : 'bg-green-500/10 text-green-700 dark:text-green-400'}`}>
                <p className="font-medium">{diagnosisResult.diagnosis}</p>
                {diagnosisResult.description && <p className="text-xs mt-1">{diagnosisResult.description}</p>}
              </div>
            )}
          </div>
        )}
          </>
        )}

        {formData.linkType === "ptp" && (
          <>
            <h4 className="font-medium mb-3">Configuracao Switch PTP</h4>
            <p className="text-sm text-muted-foreground mb-3">
              Configure o switch e porta para monitoramento do link ponto-a-ponto
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="switchId">Switch</Label>
                <Select
                  value={formData.switchId?.toString() || "none"}
                  onValueChange={(value) => setFormData({ ...formData, switchId: value === "none" ? null : parseInt(value, 10) })}
                >
                  <SelectTrigger data-testid="select-switch">
                    <SelectValue placeholder="Selecione o Switch" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Nenhum Switch</SelectItem>
                    {switches?.filter(s => s.isActive).map((sw) => (
                      <SelectItem key={sw.id} value={sw.id.toString()}>
                        {sw.name} ({sw.ipAddress})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="switchPort">Porta do Switch</Label>
                <div className="flex gap-2">
                  <Input
                    id="switchPort"
                    value={formData.switchPort}
                    onChange={(e) => setFormData({ ...formData, switchPort: e.target.value })}
                    placeholder="Ex: 1/1/1 ou GigabitEthernet0/1"
                    data-testid="input-switch-port"
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    title="Buscar interfaces do switch via SNMP"
                    onClick={async () => {
                      const selectedSwitch = switches?.find(s => s.id === formData.switchId);
                      if (!selectedSwitch) {
                        toast({
                          title: "Switch nao encontrado",
                          description: "Selecione um switch valido",
                          variant: "destructive",
                        });
                        return;
                      }
                      try {
                        const response = await apiRequest("GET", `/api/switches/${selectedSwitch.id}`);
                        if (!response.ok) {
                          throw new Error("Erro ao buscar dados do switch");
                        }
                        const swData = await response.json();
                        const profileId = swData.snmpProfileId;
                        if (profileId) {
                          handleDiscoverInterfaces(selectedSwitch.ipAddress, profileId);
                        } else {
                          toast({
                            title: "Perfil SNMP nao configurado",
                            description: "Configure um perfil SNMP para o switch antes de buscar interfaces",
                            variant: "destructive",
                          });
                        }
                      } catch (error: any) {
                        toast({
                          title: "Erro ao buscar switch",
                          description: error.message || "Nao foi possivel obter dados do switch",
                          variant: "destructive",
                        });
                      }
                    }}
                    disabled={isDiscovering || !formData.switchId}
                    data-testid="button-discover-interfaces-switch"
                  >
                    {isDiscovering ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Search className="w-4 h-4" />
                    )}
                  </Button>
                </div>
              </div>
            </div>
            
            {!switches?.filter(s => s.isActive).length && (
              <p className="text-sm text-muted-foreground mt-2">
                Nenhum switch cadastrado. Acesse a aba Switches para cadastrar.
              </p>
            )}
          </>
        )}
      </div>

      <div className="border-t pt-4 mt-4">
        <h4 className="font-medium mb-3">Monitoramento de Conectividade</h4>
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label htmlFor="monitoredIp">IP para Monitoramento</Label>
            <div className="flex gap-2">
              <Input
                id="monitoredIp"
                value={formData.monitoredIp}
                onChange={(e) => setFormData({ ...formData, monitoredIp: e.target.value })}
                placeholder="191.52.248.26"
                data-testid="input-monitored-ip"
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                disabled={isLoadingTags || !formData.voalleContractTagId}
                title={formData.voalleContractTagId ? "Atualizar IP da etiqueta vinculada" : "Selecione uma etiqueta primeiro"}
                onClick={() => {
                  if (!formData.voalleContractTagId) {
                    toast({
                      title: "Nenhuma etiqueta vinculada",
                      description: "Selecione uma etiqueta de contrato primeiro",
                      variant: "destructive",
                    });
                    return;
                  }
                  const tag = voalleContractTags?.tags?.find(t => t.id === formData.voalleContractTagId);
                  if (tag?.ip) {
                    setFormData({ ...formData, monitoredIp: tag.ip });
                    toast({
                      title: "IP atualizado",
                      description: `IP ${tag.ip} da etiqueta ${tag.serviceTag || tag.description || `#${tag.id}`}`,
                    });
                  } else {
                    toast({
                      title: "IP não encontrado",
                      description: "A etiqueta vinculada não possui IP cadastrado no Voalle",
                      variant: "destructive",
                    });
                  }
                }}
                data-testid="button-refresh-voalle-ip"
              >
                {isLoadingTags ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="latencyThreshold">Limite Latência (ms)</Label>
            <Input
              id="latencyThreshold"
              type="number"
              value={formData.latencyThreshold}
              onChange={(e) => setFormData({ ...formData, latencyThreshold: parseFloat(e.target.value) || 80 })}
              data-testid="input-latency-threshold"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="packetLossThreshold">Limite Perda Pacotes (%)</Label>
            <Input
              id="packetLossThreshold"
              type="number"
              value={formData.packetLossThreshold}
              onChange={(e) => setFormData({ ...formData, packetLossThreshold: parseFloat(e.target.value) || 2 })}
              data-testid="input-packetloss-threshold"
            />
          </div>
          <div className="col-span-2 flex items-center justify-between p-3 rounded-md bg-muted/50">
            <div>
              <p className="font-medium text-sm">Manter Direção Original</p>
              <p className="text-xs text-muted-foreground">
                Desativa a inversão automática de banda (por padrão, download ↔ upload são invertidos para concentradores)
              </p>
            </div>
            <Switch
              checked={formData.invertBandwidth}
              onCheckedChange={(checked) => setFormData({ ...formData, invertBandwidth: checked })}
              data-testid="switch-invert-bandwidth"
            />
          </div>
        </div>
        
        {/* Link L2 - Sem IP monitorado */}
        <div className="flex items-center justify-between p-3 rounded-md border bg-orange-50 dark:bg-orange-950/30 border-orange-200 dark:border-orange-800">
          <div className="space-y-0.5">
            <p className="font-medium text-sm">Link L2 (Sem IP)</p>
            <p className="text-xs text-muted-foreground">
              Link não possui IP monitorado. Status será determinado pela porta do switch/concentrador.
            </p>
          </div>
          <Switch
            checked={formData.isL2Link}
            onCheckedChange={(checked) => setFormData({ ...formData, isL2Link: checked })}
            data-testid="switch-is-l2-link"
          />
        </div>
      </div>

      <div className="border-t pt-4 mt-4">
        <div className="flex items-center justify-between mb-3">
          <h4 className="font-medium">Monitoramento de Sinal Óptico</h4>
          <Switch
            checked={formData.opticalMonitoringEnabled}
            onCheckedChange={(checked) => setFormData({ ...formData, opticalMonitoringEnabled: checked })}
            data-testid="switch-optical-monitoring"
          />
        </div>
        
        {formData.opticalMonitoringEnabled && (
          <div className="space-y-4">
            <div className="p-3 rounded-md border bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800">
              <p className="text-sm text-blue-700 dark:text-blue-300">
                Os OIDs de sinal óptico são obtidos automaticamente do fabricante da OLT associada ao link.
                Configure slot, porta e ID da ONU, e selecione a OLT na aba "Diagnóstico ONU".
              </p>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="opticalRxBaseline">Baseline RX (dBm)</Label>
                <Input
                  id="opticalRxBaseline"
                  type="number"
                  step="0.01"
                  value={formData.opticalRxBaseline}
                  onChange={(e) => setFormData({ ...formData, opticalRxBaseline: e.target.value })}
                  placeholder="-18.5"
                  data-testid="input-optical-rx-baseline"
                />
                <p className="text-xs text-muted-foreground">Valor de referência para detecção de degradação</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="opticalDeltaThreshold">Delta Máximo (dB)</Label>
                <Input
                  id="opticalDeltaThreshold"
                  type="number"
                  step="0.5"
                  value={formData.opticalDeltaThreshold}
                  onChange={(e) => setFormData({ ...formData, opticalDeltaThreshold: parseFloat(e.target.value) || 3 })}
                  placeholder="3"
                  data-testid="input-optical-delta-threshold"
                />
                <p className="text-xs text-muted-foreground">Variação máxima antes de alertar (padrão: 3dB)</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="sfpType">Tipo de Transceiver/Tecnologia</Label>
                <Select
                  value={formData.sfpType || (formData.linkType === "ptp" ? "sfp_10g_lr" : "gpon_onu")}
                  onValueChange={(value) => setFormData({ ...formData, sfpType: value })}
                >
                  <SelectTrigger data-testid="select-sfp-type">
                    <SelectValue placeholder="Selecione..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sfp_10g_lr">SFP+ 10G LR (10km)</SelectItem>
                    <SelectItem value="sfp_10g_bidi">SFP+ 10G BIDI (20km)</SelectItem>
                    <SelectItem value="qsfp_40g_er4">QSFP+ 40G ER4 (20km)</SelectItem>
                    <SelectItem value="gpon_onu">GPON ONU (Cliente)</SelectItem>
                    <SelectItem value="gpon_olt">GPON OLT (Central)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Define a escala de medição do sinal óptico</p>
              </div>
            </div>
            
            <div className="p-3 bg-muted/50 rounded-md">
              <p className="text-xs text-muted-foreground">
                <strong>Escalas variam por tecnologia:</strong> PTP (SFP+): até -14.4 dBm | GPON ONU: -8 a -25 dBm | GPON OLT: -8 a -28 dBm
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Interfaces de Tráfego Adicionais - só mostra para links existentes */}
      {link?.id && (
        <TrafficInterfacesManager
          linkId={link.id}
          concentrators={activeConcentrators || []}
          switches={activeSwitches || []}
        />
      )}

      {/* Configuração do Gráfico Principal - só mostra para links existentes */}
      {link?.id && (
        <MainGraphConfigSection
          linkId={link.id}
          mainGraphMode={formData.mainGraphMode}
          mainGraphInterfaceIds={formData.mainGraphInterfaceIds}
          onChange={(mode, ids) => setFormData({ ...formData, mainGraphMode: mode, mainGraphInterfaceIds: ids })}
        />
      )}

      {/* Seção de CPEs */}
      <div className="border-t pt-4 mt-4">
        <div className="flex items-center justify-between mb-3">
          <h4 className="font-medium flex items-center gap-2">
            <Router className="w-4 h-4" />
            Equipamentos (CPEs)
          </h4>
          <Badge variant="secondary">{selectedCpes.length} selecionado(s)</Badge>
        </div>
        
        {allCpes && allCpes.length > 0 ? (
          <div className="space-y-3">
            {/* Combobox para adicionar CPE */}
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-start" data-testid="button-add-cpe">
                  <Plus className="w-4 h-4 mr-2" />
                  Adicionar equipamento...
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[400px] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Buscar equipamento..." data-testid="input-search-cpe" />
                  <CommandList>
                    <CommandEmpty>Nenhum equipamento encontrado.</CommandEmpty>
                    <CommandGroup heading="Equipamentos disponíveis">
                      {allCpes
                        .filter((cpe) => cpe.isStandard || !selectedCpes.some((s) => s.cpeId === cpe.id))
                        .map((cpe) => (
                          <CommandItem
                            key={cpe.id}
                            value={`${cpe.name} ${cpe.type} ${cpe.model || ""} ${cpe.ipAddress || ""}`}
                            onSelect={() => {
                              setSelectedCpes([...selectedCpes, { 
                                cpeId: cpe.id, 
                                role: "primary",
                                ipOverride: cpe.isStandard ? "" : (cpe.ipAddress || ""),
                                showInEquipmentTab: selectedCpes.length === 0,
                                instanceId: cpe.isStandard ? `${cpe.id}-${Date.now()}` : undefined
                              }]);
                            }}
                            data-testid={`command-item-cpe-${cpe.id}`}
                          >
                            <div className="flex flex-col">
                              <span className="font-medium">{cpe.name}</span>
                              <span className="text-xs text-muted-foreground">
                                {cpe.type} {cpe.model && `- ${cpe.model}`} {cpe.ipAddress && `(${cpe.ipAddress})`}
                                {cpe.isStandard && " [Padrão]"}
                              </span>
                            </div>
                          </CommandItem>
                        ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>

            {/* Lista de CPEs selecionados */}
            {selectedCpes.length > 0 && (
              <div className="space-y-2 border rounded-md p-2">
                {selectedCpes.map((sel, idx) => {
                  const cpe = allCpes.find((c) => c.id === sel.cpeId);
                  if (!cpe) return null;
                  const isStandard = cpe.isStandard ?? false;
                  const selKey = (sel as any).instanceId || sel.cpeId;
                  return (
                    <div 
                      key={selKey}
                      className="flex items-center justify-between gap-2 p-2 rounded bg-primary/10"
                    >
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <div className="flex flex-col flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium truncate">{cpe.name}</span>
                            {isStandard && <Badge variant="outline" className="text-xs">Padrão</Badge>}
                          </div>
                          <span className="text-xs text-muted-foreground truncate">
                            {cpe.type} {cpe.model && `- ${cpe.model}`}
                          </span>
                        </div>
                      </div>
                      
                      {/* Campo de IP */}
                      <div className="w-32">
                        <Input
                          placeholder={isStandard ? "IP do link" : "IP"}
                          value={(sel as any).ipOverride || ""}
                          onChange={(e) => {
                            setSelectedCpes(selectedCpes.map((s, i) =>
                              i === idx ? { ...s, ipOverride: e.target.value } : s
                            ));
                          }}
                          className="h-7 text-xs"
                          data-testid={`input-cpe-ip-${sel.cpeId}`}
                        />
                      </div>
                      
                      {/* Role selector */}
                      <Select
                        value={sel.role || "primary"}
                        onValueChange={(v) => {
                          setSelectedCpes(selectedCpes.map((s, i) =>
                            i === idx ? { ...s, role: v } : s
                          ));
                        }}
                      >
                        <SelectTrigger className="w-28 h-7 text-xs" data-testid={`select-cpe-role-${selKey}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="primary">Principal</SelectItem>
                          <SelectItem value="backup">Backup</SelectItem>
                          <SelectItem value="firewall">Firewall</SelectItem>
                          <SelectItem value="switch">Switch</SelectItem>
                        </SelectContent>
                      </Select>

                      {/* Checkbox para aba equipamento */}
                      <div className="flex items-center gap-1" title="Exibir na aba Equipamento">
                        <input
                          type="checkbox"
                          checked={(sel as any).showInEquipmentTab || false}
                          onChange={(e) => {
                            setSelectedCpes(selectedCpes.map((s, i) =>
                              i === idx ? { ...s, showInEquipmentTab: e.target.checked } : s
                            ));
                          }}
                          className="w-3 h-3"
                          data-testid={`checkbox-equipment-tab-${selKey}`}
                        />
                        <Monitor className="w-3 h-3 text-muted-foreground" />
                      </div>
                      
                      {/* Botão remover */}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => setSelectedCpes(selectedCpes.filter((_, i) => i !== idx))}
                        data-testid={`button-remove-cpe-${selKey}`}
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="text-center p-4 bg-muted/30 rounded-md text-sm text-muted-foreground">
            <p>Nenhum CPE cadastrado.</p>
            <p className="text-xs mt-1">Cadastre CPEs na aba "CPEs" do painel admin.</p>
          </div>
        )}
      </div>
      
      <DialogFooter>
        <Button variant="outline" onClick={onClose} data-testid="button-cancel">
          Cancelar
        </Button>
        <Button onClick={() => {
          // Converte campos de string para números antes de salvar
          const processedData = {
            ...formData,
            opticalRxBaseline: formData.opticalRxBaseline ? parseFloat(formData.opticalRxBaseline) : null,
            opticalTxBaseline: formData.opticalTxBaseline ? parseFloat(formData.opticalTxBaseline) : null,
            _selectedCpes: selectedCpes, // Passa CPEs selecionados para o handler
          };
          onSave(processedData);
        }} data-testid="button-save-link">
          {link ? "Atualizar" : "Criar"} Link
        </Button>
      </DialogFooter>
      
      {showNewProfileForm && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-background border rounded-lg shadow-lg p-6 w-full max-w-md space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Novo Perfil SNMP</h3>
              <Button 
                size="icon" 
                variant="ghost" 
                onClick={() => setShowNewProfileForm(false)}
                data-testid="button-close-new-profile"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              Criando perfil para: {selectedClientName}
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Nome *</Label>
                <Input
                  value={newProfileData.name}
                  onChange={(e) => setNewProfileData({ ...newProfileData, name: e.target.value })}
                  placeholder="Ex: Mikrotik"
                  data-testid="input-new-profile-name"
                />
              </div>
              <div className="space-y-2">
                <Label>Versão SNMP</Label>
                <Select
                  value={newProfileData.version}
                  onValueChange={(v) => setNewProfileData({ ...newProfileData, version: v })}
                >
                  <SelectTrigger data-testid="select-new-profile-version">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="v1">v1</SelectItem>
                    <SelectItem value="v2c">v2c</SelectItem>
                    <SelectItem value="v3">v3</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Comunidade</Label>
              <Input
                value={newProfileData.community}
                onChange={(e) => setNewProfileData({ ...newProfileData, community: e.target.value })}
                placeholder="public"
                data-testid="input-new-profile-community"
              />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Porta</Label>
                <Input
                  type="number"
                  value={newProfileData.port}
                  onChange={(e) => setNewProfileData({ ...newProfileData, port: parseInt(e.target.value) || 161 })}
                  data-testid="input-new-profile-port"
                />
              </div>
              <div className="space-y-2">
                <Label>Timeout (ms)</Label>
                <Input
                  type="number"
                  value={newProfileData.timeout}
                  onChange={(e) => setNewProfileData({ ...newProfileData, timeout: parseInt(e.target.value) || 5000 })}
                  data-testid="input-new-profile-timeout"
                />
              </div>
              <div className="space-y-2">
                <Label>Retries</Label>
                <Input
                  type="number"
                  value={newProfileData.retries}
                  onChange={(e) => setNewProfileData({ ...newProfileData, retries: parseInt(e.target.value) || 3 })}
                  data-testid="input-new-profile-retries"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button 
                variant="outline" 
                onClick={() => setShowNewProfileForm(false)}
                data-testid="button-cancel-new-profile"
              >
                Cancelar
              </Button>
              <Button 
                onClick={handleCreateProfile}
                disabled={isCreatingProfile || !newProfileData.name.trim()}
                data-testid="button-save-new-profile"
              >
                {isCreatingProfile && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Criar Perfil
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


interface ClientSettings {
  wanguardApiEndpoint?: string | null;
  wanguardApiUser?: string | null;
  wanguardApiPassword?: string | null;
  wanguardEnabled?: boolean;
  wanguardSyncInterval?: number;
  ddosMitigationCapacity?: number;
}

function WanguardIntegration({ clients }: { clients: Client[] }) {
  const { toast } = useToast();
  const [selectedClientId, setSelectedClientId] = useState<number | null>(
    clients[0]?.id || null
  );
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  const { data: settings, isLoading: settingsLoading } = useQuery<ClientSettings>({
    queryKey: ["/api/clients", selectedClientId, "settings"],
    enabled: !!selectedClientId,
  });

  const [formData, setFormData] = useState<ClientSettings>({
    wanguardApiEndpoint: "",
    wanguardApiUser: "",
    wanguardApiPassword: "",
    wanguardEnabled: false,
    wanguardSyncInterval: 60,
    ddosMitigationCapacity: 2,
  });

  useEffect(() => {
    if (settings) {
      setFormData({
        wanguardApiEndpoint: settings.wanguardApiEndpoint || "",
        wanguardApiUser: settings.wanguardApiUser || "",
        wanguardApiPassword: settings.wanguardApiPassword || "",
        wanguardEnabled: settings.wanguardEnabled || false,
        wanguardSyncInterval: settings.wanguardSyncInterval || 60,
        ddosMitigationCapacity: settings.ddosMitigationCapacity ?? 2,
      });
    }
  }, [settings]);

  const updateSettingsMutation = useMutation({
    mutationFn: async (data: Partial<ClientSettings>) => {
      return await apiRequest("PATCH", `/api/clients/${selectedClientId}/settings`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", selectedClientId, "settings"] });
      toast({ title: "Configurações salvas com sucesso" });
    },
    onError: () => {
      toast({ title: "Erro ao salvar configurações", variant: "destructive" });
    },
  });

  const handleTestConnection = async () => {
    if (!selectedClientId) return;
    
    setIsTesting(true);
    setTestResult(null);
    
    try {
      await updateSettingsMutation.mutateAsync(formData);
      
      const response = await apiRequest("POST", `/api/clients/${selectedClientId}/wanguard/test`);
      const result = await response.json();
      setTestResult(result);
      
      if (result.success) {
        toast({ title: "Conexão estabelecida com sucesso" });
      } else {
        toast({ title: result.message, variant: "destructive" });
      }
    } catch {
      setTestResult({ success: false, message: "Erro ao testar conexão" });
      toast({ title: "Erro ao testar conexão", variant: "destructive" });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSync = async (includeHistorical: boolean = false) => {
    if (!selectedClientId) return;
    
    setIsSyncing(true);
    
    try {
      const response = await apiRequest("POST", `/api/clients/${selectedClientId}/wanguard/sync`, {
        includeHistorical,
      });
      const result = await response.json();
      
      toast({ 
        title: result.success ? "Sincronização concluída" : "Erro na sincronização",
        description: result.message,
        variant: result.success ? "default" : "destructive",
      });
    } catch {
      toast({ title: "Erro ao sincronizar", variant: "destructive" });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleSave = () => {
    updateSettingsMutation.mutate(formData);
  };

  if (clients.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Nenhum cliente cadastrado. Cadastre um cliente primeiro.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="w-5 h-5" />
          Wanguard (Andrisoft)
        </CardTitle>
        <CardDescription>
          Configure a integração com o Wanguard para detecção de ataques DDoS
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label>Cliente</Label>
          <Select
            value={selectedClientId?.toString() || ""}
            onValueChange={(value) => {
              setSelectedClientId(parseInt(value, 10));
              setTestResult(null);
            }}
          >
            <SelectTrigger data-testid="select-wanguard-client">
              <SelectValue placeholder="Selecione um cliente" />
            </SelectTrigger>
            <SelectContent>
              {clients.map((client) => (
                <SelectItem key={client.id} value={client.id.toString()}>
                  {client.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {settingsLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <>
            <div className="flex items-center justify-between gap-4 p-4 bg-muted/50 rounded-md">
              <div>
                <p className="font-medium">Habilitar Wanguard</p>
                <p className="text-sm text-muted-foreground">
                  Ative para importar eventos de DDoS automaticamente
                </p>
              </div>
              <Switch
                checked={formData.wanguardEnabled || false}
                onCheckedChange={(checked) => setFormData({ ...formData, wanguardEnabled: checked })}
                data-testid="switch-wanguard-enabled"
              />
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="wanguardEndpoint">URL do Console Wanguard</Label>
                <Input
                  id="wanguardEndpoint"
                  value={formData.wanguardApiEndpoint || ""}
                  onChange={(e) => setFormData({ ...formData, wanguardApiEndpoint: e.target.value })}
                  placeholder="https://wanguard.exemplo.com.br"
                  data-testid="input-wanguard-endpoint"
                />
                <p className="text-xs text-muted-foreground">
                  Endereço do console Wanguard (sem /wanguard-api/v1/)
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="wanguardUser">Usuário API</Label>
                  <Input
                    id="wanguardUser"
                    value={formData.wanguardApiUser || ""}
                    onChange={(e) => setFormData({ ...formData, wanguardApiUser: e.target.value })}
                    placeholder="api_user"
                    data-testid="input-wanguard-user"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="wanguardPassword">Senha API</Label>
                  <Input
                    id="wanguardPassword"
                    type="password"
                    value={formData.wanguardApiPassword || ""}
                    onChange={(e) => setFormData({ ...formData, wanguardApiPassword: e.target.value })}
                    placeholder="••••••••"
                    data-testid="input-wanguard-password"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="syncInterval">Intervalo de Sincronização (segundos)</Label>
                  <Input
                    id="syncInterval"
                    type="number"
                    value={formData.wanguardSyncInterval || 60}
                    onChange={(e) => setFormData({ ...formData, wanguardSyncInterval: parseInt(e.target.value, 10) || 60 })}
                    data-testid="input-wanguard-interval"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="mitigationCapacity">Capacidade de Mitigação (Gbps)</Label>
                  <Input
                    id="mitigationCapacity"
                    type="number"
                    step="0.1"
                    value={formData.ddosMitigationCapacity ?? 2}
                    onChange={(e) => setFormData({ ...formData, ddosMitigationCapacity: parseFloat(e.target.value) || 2 })}
                    data-testid="input-mitigation-capacity"
                  />
                </div>
              </div>
            </div>

            {testResult && (
              <div className={`p-4 rounded-md flex items-center gap-3 ${testResult.success ? "bg-green-500/10 text-green-600 dark:text-green-400" : "bg-red-500/10 text-red-600 dark:text-red-400"}`}>
                {testResult.success ? (
                  <CheckCircle className="w-5 h-5" />
                ) : (
                  <XCircle className="w-5 h-5" />
                )}
                <span>{testResult.message}</span>
              </div>
            )}

            <div className="flex items-center justify-between gap-4 pt-4 border-t">
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={handleTestConnection}
                  disabled={isTesting || !formData.wanguardApiEndpoint}
                  data-testid="button-test-wanguard"
                >
                  {isTesting && <RefreshCw className="w-4 h-4 mr-2 animate-spin" />}
                  Testar Conexão
                </Button>
                <Button
                  variant="outline"
                  onClick={() => handleSync(false)}
                  disabled={isSyncing || !formData.wanguardEnabled}
                  data-testid="button-sync-wanguard"
                >
                  {isSyncing && <RefreshCw className="w-4 h-4 mr-2 animate-spin" />}
                  Sincronizar Agora
                </Button>
                <Button
                  variant="outline"
                  onClick={() => handleSync(true)}
                  disabled={isSyncing || !formData.wanguardEnabled}
                  data-testid="button-sync-wanguard-historical"
                >
                  {isSyncing && <RefreshCw className="w-4 h-4 mr-2 animate-spin" />}
                  Importar Histórico
                </Button>
              </div>
              <Button
                onClick={handleSave}
                disabled={updateSettingsMutation.isPending}
                data-testid="button-save-wanguard"
              >
                Salvar Configurações
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

interface VoalleSettings {
  voalleApiUrl?: string | null;
  voalleClientId?: string | null;
  voalleClientSecret?: string | null;
  voalleSynV1Token?: string | null;
  voalleSolicitationTypeCode?: string | null;
  voalleEnabled?: boolean;
  voalleAutoCreateTicket?: boolean;
}

function VoalleIntegration({ clients }: { clients: Client[] }) {
  const { toast } = useToast();
  const [selectedClientId, setSelectedClientId] = useState<number | null>(
    clients[0]?.id || null
  );

  const { data: settings, isLoading } = useQuery<VoalleSettings>({
    queryKey: ["/api/clients", selectedClientId, "settings"],
    enabled: !!selectedClientId,
  });

  const [formData, setFormData] = useState<VoalleSettings>({
    voalleApiUrl: "",
    voalleClientId: "",
    voalleClientSecret: "",
    voalleSynV1Token: "",
    voalleSolicitationTypeCode: "",
    voalleEnabled: false,
    voalleAutoCreateTicket: false,
  });

  useEffect(() => {
    if (settings) {
      setFormData({
        voalleApiUrl: settings.voalleApiUrl || "",
        voalleClientId: settings.voalleClientId || "",
        voalleClientSecret: settings.voalleClientSecret || "",
        voalleSynV1Token: settings.voalleSynV1Token || "",
        voalleSolicitationTypeCode: settings.voalleSolicitationTypeCode || "",
        voalleEnabled: settings.voalleEnabled || false,
        voalleAutoCreateTicket: settings.voalleAutoCreateTicket || false,
      });
    }
  }, [settings]);

  const updateSettingsMutation = useMutation({
    mutationFn: async (data: Partial<VoalleSettings>) => {
      return await apiRequest("PATCH", `/api/clients/${selectedClientId}/settings`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", selectedClientId, "settings"] });
      toast({ title: "Configurações salvas com sucesso" });
    },
    onError: () => {
      toast({ title: "Erro ao salvar configurações", variant: "destructive" });
    },
  });

  const [isTesting, setIsTesting] = useState(false);

  const handleTestConnection = async () => {
    await updateSettingsMutation.mutateAsync(formData);
    setIsTesting(true);
    try {
      const response = await fetch(`/api/clients/${selectedClientId}/voalle/test`, {
        method: "POST",
      });
      const result = await response.json();
      if (result.success) {
        toast({ title: "Conexão bem-sucedida", description: result.message });
      } else {
        toast({ title: "Falha na conexão", description: result.message, variant: "destructive" });
      }
    } catch {
      toast({ title: "Erro ao testar conexão", variant: "destructive" });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = () => {
    updateSettingsMutation.mutate(formData);
  };

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="w-5 h-5" />
          Voalle ERP
        </CardTitle>
        <CardDescription>
          Configure a integração com o Voalle para abertura automática de chamados
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label>Cliente</Label>
          <Select
            value={selectedClientId?.toString() || ""}
            onValueChange={(value) => setSelectedClientId(parseInt(value, 10))}
          >
            <SelectTrigger data-testid="select-voalle-client">
              <SelectValue placeholder="Selecione um cliente" />
            </SelectTrigger>
            <SelectContent>
              {clients.map((client) => (
                <SelectItem key={client.id} value={client.id.toString()}>
                  {client.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="text-sm text-muted-foreground">Carregando configurações...</div>
        ) : (
          <>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="voalleApiUrl">URL da API Voalle</Label>
                <Input
                  id="voalleApiUrl"
                  value={formData.voalleApiUrl || ""}
                  onChange={(e) => setFormData({ ...formData, voalleApiUrl: e.target.value })}
                  placeholder="https://erp.marvitel.com.br"
                  data-testid="input-voalle-api-url"
                />
                <p className="text-xs text-muted-foreground">
                  URL base do ERP Voalle (sem porta ou caminho)
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="voalleClientId">Client ID</Label>
                  <Input
                    id="voalleClientId"
                    value={formData.voalleClientId || ""}
                    onChange={(e) => setFormData({ ...formData, voalleClientId: e.target.value })}
                    placeholder="ID do cliente integrador"
                    data-testid="input-voalle-client-id"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="voalleClientSecret">Client Secret</Label>
                  <Input
                    id="voalleClientSecret"
                    type="password"
                    value={formData.voalleClientSecret || ""}
                    onChange={(e) => setFormData({ ...formData, voalleClientSecret: e.target.value })}
                    placeholder="Secret do cliente integrador"
                    data-testid="input-voalle-client-secret"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="voalleSynV1Token">Token SynV1 (opcional)</Label>
                <Input
                  id="voalleSynV1Token"
                  type="password"
                  value={formData.voalleSynV1Token || ""}
                  onChange={(e) => setFormData({ ...formData, voalleSynV1Token: e.target.value })}
                  placeholder="Token syn-v1 se necessário"
                  data-testid="input-voalle-syn-token"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="voalleSolicitationTypeCode">Código do Tipo de Solicitação</Label>
                <Input
                  id="voalleSolicitationTypeCode"
                  value={formData.voalleSolicitationTypeCode || ""}
                  onChange={(e) => setFormData({ ...formData, voalleSolicitationTypeCode: e.target.value })}
                  placeholder="Ex: suporte_link"
                  data-testid="input-voalle-solicitation-code"
                />
                <p className="text-xs text-muted-foreground">
                  Código do tipo de solicitação para abertura de chamados no Service Desk
                </p>
              </div>

              <div className="flex items-center justify-between rounded-lg border p-4">
                <div className="space-y-0.5">
                  <Label>Habilitar Integração</Label>
                  <p className="text-xs text-muted-foreground">
                    Ativar integração com Voalle ERP
                  </p>
                </div>
                <Switch
                  checked={formData.voalleEnabled}
                  onCheckedChange={(checked) => setFormData({ ...formData, voalleEnabled: checked })}
                  data-testid="switch-voalle-enabled"
                />
              </div>

              <div className="flex items-center justify-between rounded-lg border p-4">
                <div className="space-y-0.5">
                  <Label>Abertura Automática de Chamados</Label>
                  <p className="text-xs text-muted-foreground">
                    Criar automaticamente chamado no Voalle ao detectar incidente
                  </p>
                </div>
                <Switch
                  checked={formData.voalleAutoCreateTicket}
                  onCheckedChange={(checked) => setFormData({ ...formData, voalleAutoCreateTicket: checked })}
                  data-testid="switch-voalle-auto-ticket"
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-4 pt-4 border-t">
              <Button
                variant="outline"
                onClick={handleTestConnection}
                disabled={isTesting || !formData.voalleApiUrl}
                data-testid="button-test-voalle"
              >
                {isTesting && <RefreshCw className="w-4 h-4 mr-2 animate-spin" />}
                Testar Conexão
              </Button>
              <Button
                onClick={handleSave}
                disabled={updateSettingsMutation.isPending}
                data-testid="button-save-voalle"
              >
                Salvar Configurações
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function HetrixToolsIntegration() {
  const { toast } = useToast();
  const [testing, setTesting] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);

  const { data: integrations, refetch } = useQuery<ExternalIntegration[]>({
    queryKey: ["/api/external-integrations"],
  });

  const hetrixIntegration = integrations?.find(i => i.provider === "hetrixtools");

  const [formData, setFormData] = useState({
    name: "HetrixTools",
    provider: "hetrixtools",
    isActive: true,
    apiKey: "",
    checkIntervalHours: 12,
  });

  useEffect(() => {
    if (hetrixIntegration) {
      setFormData({
        name: hetrixIntegration.name,
        provider: "hetrixtools",
        isActive: hetrixIntegration.isActive,
        apiKey: "",
        checkIntervalHours: hetrixIntegration.checkIntervalHours || 12,
      });
    }
  }, [hetrixIntegration]);

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      return await apiRequest("POST", "/api/external-integrations", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/external-integrations"] });
      toast({ title: "Integração HetrixTools criada com sucesso" });
    },
    onError: () => {
      toast({ title: "Erro ao criar integração", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<typeof formData> }) => {
      return await apiRequest("PATCH", `/api/external-integrations/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/external-integrations"] });
      toast({ title: "Integração HetrixTools atualizada" });
    },
    onError: () => {
      toast({ title: "Erro ao atualizar integração", variant: "destructive" });
    },
  });

  const testConnection = async () => {
    if (!hetrixIntegration) return;
    setTesting(true);
    try {
      const response = await apiRequest("POST", `/api/external-integrations/${hetrixIntegration.id}/test`);
      const result = await response.json() as { success: boolean; error?: string };
      if (result.success) {
        toast({ title: "Conexão com HetrixTools bem-sucedida!" });
      } else {
        toast({ title: "Falha na conexão", description: result.error, variant: "destructive" });
      }
      refetch();
    } catch (error) {
      toast({ title: "Erro ao testar conexão", variant: "destructive" });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = () => {
    if (!formData.name.trim()) {
      toast({ title: "Nome é obrigatório", variant: "destructive" });
      return;
    }
    if (!hetrixIntegration && !formData.apiKey.trim()) {
      toast({ title: "API Key é obrigatória para nova integração", variant: "destructive" });
      return;
    }
    
    if (hetrixIntegration) {
      const updateData: Partial<typeof formData> = {
        name: formData.name,
        isActive: formData.isActive,
        checkIntervalHours: formData.checkIntervalHours,
      };
      if (formData.apiKey) {
        updateData.apiKey = formData.apiKey;
      }
      updateMutation.mutate({ id: hetrixIntegration.id, data: updateData });
    } else {
      createMutation.mutate(formData);
    }
  };
  
  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="w-5 h-5" />
          HetrixTools - Verificação de Blacklist
        </CardTitle>
        <CardDescription>
          Integração com HetrixTools para verificação de IPs em blacklists (RBLs)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="hetrix-name">Nome da Integração</Label>
            <Input
              id="hetrix-name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="HetrixTools"
              data-testid="input-hetrix-name"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="hetrix-apikey">API Key</Label>
            <div className="flex gap-2">
              <Input
                id="hetrix-apikey"
                type={showApiKey ? "text" : "password"}
                value={formData.apiKey}
                onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
                placeholder={(hetrixIntegration as unknown as { hasApiKey?: boolean })?.hasApiKey ? "••••••••••••••••" : "Cole sua API Key aqui"}
                data-testid="input-hetrix-apikey"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setShowApiKey(!showApiKey)}
                data-testid="button-toggle-apikey"
              >
                {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Obtenha sua API Key em: <a href="https://hetrixtools.com/dashboard/account/api/" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">hetrixtools.com/dashboard/account/api</a>
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="hetrix-interval">Intervalo de Verificação Automática</Label>
            <Select
              value={String(formData.checkIntervalHours)}
              onValueChange={(value) => setFormData({ ...formData, checkIntervalHours: parseInt(value) })}
            >
              <SelectTrigger id="hetrix-interval" data-testid="select-hetrix-interval">
                <SelectValue placeholder="Selecione o intervalo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1 hora</SelectItem>
                <SelectItem value="2">2 horas</SelectItem>
                <SelectItem value="4">4 horas</SelectItem>
                <SelectItem value="6">6 horas</SelectItem>
                <SelectItem value="12">12 horas</SelectItem>
                <SelectItem value="24">24 horas</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Frequência da verificação automática de blacklist para todos os links
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <Switch
            id="hetrix-active"
            checked={formData.isActive}
            onCheckedChange={(checked) => setFormData({ ...formData, isActive: checked })}
            data-testid="switch-hetrix-active"
          />
          <Label htmlFor="hetrix-active">Integração Ativa</Label>
        </div>

        {hetrixIntegration && (
          <div className="text-sm text-muted-foreground space-y-1">
            {hetrixIntegration.lastTestedAt && (
              <p>
                Último teste: {new Date(hetrixIntegration.lastTestedAt).toLocaleString("pt-BR")} - 
                <Badge variant={hetrixIntegration.lastTestStatus === "success" ? "default" : "destructive"} className="ml-2">
                  {hetrixIntegration.lastTestStatus === "success" ? "Sucesso" : "Falha"}
                </Badge>
              </p>
            )}
            {hetrixIntegration.lastTestError && (
              <p className="text-destructive">Erro: {hetrixIntegration.lastTestError}</p>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <Button onClick={handleSave} disabled={isSaving} data-testid="button-save-hetrix">
            {isSaving ? "Salvando..." : "Salvar"}
          </Button>
          {hetrixIntegration && (
            <Button variant="outline" onClick={testConnection} disabled={testing} data-testid="button-test-hetrix">
              {testing ? "Testando..." : "Testar Conexão"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

const ERP_PROVIDERS = [
  { value: "voalle", label: "Voalle" },
  { value: "ixc", label: "IXC Soft" },
  { value: "sgp", label: "SGP" },
];

const CONNECTION_TYPES = [
  { value: "api", label: "API REST" },
  { value: "database", label: "Banco de Dados" },
];

const DB_TYPES = [
  { value: "mysql", label: "MySQL" },
  { value: "postgresql", label: "PostgreSQL" },
  { value: "sqlserver", label: "SQL Server" },
];

// Componente para configurar a fonte do gráfico principal
function MainGraphConfigSection({ 
  linkId, 
  mainGraphMode, 
  mainGraphInterfaceIds,
  onChange 
}: { 
  linkId: number; 
  mainGraphMode: string;
  mainGraphInterfaceIds: number[];
  onChange: (mode: string, ids: number[]) => void;
}) {
  // Buscar interfaces de tráfego disponíveis para este link
  const { data: trafficInterfaces } = useQuery<Array<{id: number; label: string; sourceType: string; isEnabled: boolean}>>({
    queryKey: ['/api/link-traffic-interfaces', linkId],
    enabled: !!linkId,
  });

  const enabledInterfaces = trafficInterfaces?.filter(i => i.isEnabled) || [];

  // Se não há interfaces adicionais, não mostra a seção
  if (enabledInterfaces.length === 0) {
    return null;
  }

  const handleModeChange = (mode: string) => {
    if (mode === 'primary') {
      onChange(mode, []);
    } else {
      onChange(mode, mainGraphInterfaceIds);
    }
  };

  const handleInterfaceToggle = (interfaceId: number) => {
    const newIds = mainGraphInterfaceIds.includes(interfaceId)
      ? mainGraphInterfaceIds.filter(id => id !== interfaceId)
      : [...mainGraphInterfaceIds, interfaceId];
    onChange(mainGraphMode, newIds);
  };

  return (
    <div className="border-t pt-4 mt-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-medium flex items-center gap-2">
          <BarChart3 className="w-4 h-4" />
          Gráfico Principal
        </h4>
        <Badge variant="secondary">
          {mainGraphMode === 'primary' ? 'Coleta Padrão' : 
           mainGraphMode === 'single' ? 'Interface Única' : 'Agregação'}
        </Badge>
      </div>

      <div className="space-y-3">
        <div className="text-sm text-muted-foreground mb-2">
          Define a fonte de dados do gráfico principal do link.
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant={mainGraphMode === 'primary' ? 'default' : 'outline'}
            size="sm"
            onClick={() => handleModeChange('primary')}
            data-testid="btn-mode-primary"
          >
            Coleta Padrão
          </Button>
          <Button
            type="button"
            variant={mainGraphMode === 'single' ? 'default' : 'outline'}
            size="sm"
            onClick={() => handleModeChange('single')}
            data-testid="btn-mode-single"
          >
            Interface Única
          </Button>
          <Button
            type="button"
            variant={mainGraphMode === 'aggregate' ? 'default' : 'outline'}
            size="sm"
            onClick={() => handleModeChange('aggregate')}
            data-testid="btn-mode-aggregate"
          >
            Agregação
          </Button>
        </div>

        {/* Seleção de interfaces - só mostra se não for 'primary' */}
        {mainGraphMode !== 'primary' && (
          <div className="mt-3 p-3 bg-muted/50 rounded-md space-y-2">
            <div className="text-sm font-medium mb-2">
              {mainGraphMode === 'single' ? 'Selecione a interface:' : 'Selecione as interfaces para agregar:'}
            </div>
            {enabledInterfaces.map(iface => (
              <div key={iface.id} className="flex items-center justify-between py-1">
                <Label className="cursor-pointer flex-1">
                  {iface.label}
                  <span className="text-xs text-muted-foreground ml-2">
                    ({iface.sourceType === 'manual' ? 'IP Manual' : 
                      iface.sourceType === 'concentrator' ? 'Concentrador' : 'Switch'})
                  </span>
                </Label>
                <Switch
                  checked={mainGraphInterfaceIds.includes(iface.id)}
                  onCheckedChange={() => {
                    if (mainGraphMode === 'single') {
                      onChange(mainGraphMode, mainGraphInterfaceIds.includes(iface.id) ? [] : [iface.id]);
                    } else {
                      handleInterfaceToggle(iface.id);
                    }
                  }}
                  data-testid={`switch-iface-${iface.id}`}
                />
              </div>
            ))}
            
            {mainGraphInterfaceIds.length === 0 && mainGraphMode !== 'primary' && (
              <div className="text-xs text-amber-600 mt-2">
                Selecione pelo menos uma interface.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ErpIntegrationsManager({ clients }: { clients: Client[] }) {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingIntegration, setEditingIntegration] = useState<ErpIntegration | null>(null);
  const [showSecrets, setShowSecrets] = useState(false);
  const [testingId, setTestingId] = useState<number | null>(null);

  const { data: integrations, isLoading, refetch } = useQuery<ErpIntegration[]>({
    queryKey: ["/api/erp-integrations"],
  });

  const [formData, setFormData] = useState({
    name: "",
    provider: "voalle",
    connectionType: "api",
    isActive: true,
    isDefault: false,
    apiUrl: "",
    apiClientId: "",
    apiClientSecret: "",
    apiSynV1Token: "",
    apiUsername: "",
    apiPassword: "",
    apiSynData: "",
    // API Portal fields
    portalApiUrl: "",
    portalVerifyToken: "",
    portalClientId: "",
    portalClientSecret: "",
    // Credenciais administrativas do Portal (para recuperação de senha, etc)
    portalUsername: "",
    portalPassword: "",
    dbHost: "",
    dbPort: 3306,
    dbName: "",
    dbUser: "",
    dbPassword: "",
    dbType: "mysql",
    defaultSolicitationTypeCode: "",
    autoCreateTicket: false,
  });

  const resetForm = () => {
    setFormData({
      name: "",
      provider: "voalle",
      connectionType: "api",
      isActive: true,
      isDefault: false,
      apiUrl: "",
      apiClientId: "",
      apiClientSecret: "",
      apiSynV1Token: "",
      apiUsername: "",
      apiPassword: "",
      apiSynData: "",
      portalApiUrl: "",
      portalVerifyToken: "",
      portalClientId: "",
      portalClientSecret: "",
      portalUsername: "",
      portalPassword: "",
      dbHost: "",
      dbPort: 3306,
      dbName: "",
      dbUser: "",
      dbPassword: "",
      dbType: "mysql",
      defaultSolicitationTypeCode: "",
      autoCreateTicket: false,
    });
    setEditingIntegration(null);
    setShowSecrets(false);
  };

  const openEditDialog = (integration: ErpIntegration) => {
    setEditingIntegration(integration);
    // Parse providerConfig for Voalle-specific fields
    let providerConfigData: { 
      apiUsername?: string; 
      apiSynData?: string;
      portalApiUrl?: string;
      portalVerifyToken?: string;
      portalClientId?: string;
      portalClientSecret?: string;
      portalUsername?: string;
      portalPassword?: string;
    } = {};
    if (integration.providerConfig) {
      try {
        providerConfigData = JSON.parse(integration.providerConfig);
      } catch (e) {
        console.error("Failed to parse providerConfig", e);
      }
    }
    setFormData({
      name: integration.name,
      provider: integration.provider,
      connectionType: integration.connectionType,
      isActive: integration.isActive,
      isDefault: integration.isDefault,
      apiUrl: integration.apiUrl || "",
      apiClientId: integration.apiClientId || "",
      apiClientSecret: "",
      apiSynV1Token: "",
      apiUsername: providerConfigData.apiUsername || "",
      apiPassword: "",
      apiSynData: providerConfigData.apiSynData || "",
      portalApiUrl: providerConfigData.portalApiUrl || "",
      portalVerifyToken: providerConfigData.portalVerifyToken || "",
      portalClientId: providerConfigData.portalClientId || "",
      portalClientSecret: "",
      portalUsername: providerConfigData.portalUsername || "",
      portalPassword: "",
      dbHost: integration.dbHost || "",
      dbPort: integration.dbPort || 3306,
      dbName: integration.dbName || "",
      dbUser: integration.dbUser || "",
      dbPassword: "",
      dbType: integration.dbType || "mysql",
      defaultSolicitationTypeCode: integration.defaultSolicitationTypeCode || "",
      autoCreateTicket: integration.autoCreateTicket,
    });
    setDialogOpen(true);
  };

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      return await apiRequest("POST", "/api/erp-integrations", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/erp-integrations"] });
      setDialogOpen(false);
      resetForm();
      toast({ title: "Integração ERP criada com sucesso" });
    },
    onError: () => {
      toast({ title: "Erro ao criar integração ERP", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: { id: number; data: typeof formData }) => {
      return await apiRequest("PATCH", `/api/erp-integrations/${data.id}`, data.data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/erp-integrations"] });
      setDialogOpen(false);
      resetForm();
      toast({ title: "Integração ERP atualizada com sucesso" });
    },
    onError: () => {
      toast({ title: "Erro ao atualizar integração ERP", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return await apiRequest("DELETE", `/api/erp-integrations/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/erp-integrations"] });
      toast({ title: "Integração ERP removida com sucesso" });
    },
    onError: () => {
      toast({ title: "Erro ao remover integração ERP", variant: "destructive" });
    },
  });

  const handleTestConnection = async (id: number) => {
    setTestingId(id);
    try {
      const response = await apiRequest("POST", `/api/erp-integrations/${id}/test`);
      const result = await response.json();
      if (result.success) {
        toast({ title: "Conexão bem-sucedida", description: result.message });
      } else {
        toast({ title: "Falha na conexão", description: result.message, variant: "destructive" });
      }
      refetch();
    } catch {
      toast({ title: "Erro ao testar conexão", variant: "destructive" });
    } finally {
      setTestingId(null);
    }
  };

  const handleSave = () => {
    // Build providerConfig JSON for Voalle-specific fields
    const providerConfig: Record<string, string> = {};
    if (formData.provider === "voalle" && formData.connectionType === "api") {
      // API Para Terceiros
      if (formData.apiUsername) providerConfig.apiUsername = formData.apiUsername;
      if (formData.apiPassword) providerConfig.apiPassword = formData.apiPassword;
      if (formData.apiSynData) providerConfig.apiSynData = formData.apiSynData;
      // API Portal
      if (formData.portalApiUrl) providerConfig.portalApiUrl = formData.portalApiUrl;
      if (formData.portalVerifyToken) providerConfig.portalVerifyToken = formData.portalVerifyToken;
      if (formData.portalClientId) providerConfig.portalClientId = formData.portalClientId;
      if (formData.portalClientSecret) providerConfig.portalClientSecret = formData.portalClientSecret;
      // Credenciais administrativas do Portal (para recuperação de senha, etc)
      if (formData.portalUsername) providerConfig.portalUsername = formData.portalUsername;
      if (formData.portalPassword) providerConfig.portalPassword = formData.portalPassword;
    }
    
    // Build save data with providerConfig
    const saveData: Record<string, unknown> = {
      ...formData,
      providerConfig: Object.keys(providerConfig).length > 0 ? JSON.stringify(providerConfig) : null,
    };
    
    if (editingIntegration) {
      // Filter out empty secret fields to preserve existing values on backend
      if (!formData.apiClientSecret) delete saveData.apiClientSecret;
      if (!formData.apiSynV1Token) delete saveData.apiSynV1Token;
      if (!formData.dbPassword) delete saveData.dbPassword;
      // Preserve existing providerConfig secrets if new ones not provided
      if (formData.provider === "voalle" && formData.connectionType === "api") {
        let existingConfig: Record<string, string> = {};
        if (editingIntegration.providerConfig) {
          try { existingConfig = JSON.parse(editingIntegration.providerConfig); } catch {}
        }
        const mergedConfig: Record<string, string> = { ...existingConfig };
        // API Para Terceiros
        if (formData.apiUsername) mergedConfig.apiUsername = formData.apiUsername;
        if (formData.apiPassword) mergedConfig.apiPassword = formData.apiPassword;
        else if (existingConfig.apiPassword) mergedConfig.apiPassword = existingConfig.apiPassword;
        if (formData.apiSynData) mergedConfig.apiSynData = formData.apiSynData;
        else if (existingConfig.apiSynData) mergedConfig.apiSynData = existingConfig.apiSynData;
        // API Portal
        if (formData.portalApiUrl) mergedConfig.portalApiUrl = formData.portalApiUrl;
        else if (existingConfig.portalApiUrl) mergedConfig.portalApiUrl = existingConfig.portalApiUrl;
        if (formData.portalVerifyToken) mergedConfig.portalVerifyToken = formData.portalVerifyToken;
        else if (existingConfig.portalVerifyToken) mergedConfig.portalVerifyToken = existingConfig.portalVerifyToken;
        if (formData.portalClientId) mergedConfig.portalClientId = formData.portalClientId;
        else if (existingConfig.portalClientId) mergedConfig.portalClientId = existingConfig.portalClientId;
        if (formData.portalClientSecret) mergedConfig.portalClientSecret = formData.portalClientSecret;
        else if (existingConfig.portalClientSecret) mergedConfig.portalClientSecret = existingConfig.portalClientSecret;
        // Credenciais administrativas do Portal
        if (formData.portalUsername) mergedConfig.portalUsername = formData.portalUsername;
        else if (existingConfig.portalUsername) mergedConfig.portalUsername = existingConfig.portalUsername;
        if (formData.portalPassword) mergedConfig.portalPassword = formData.portalPassword;
        else if (existingConfig.portalPassword) mergedConfig.portalPassword = existingConfig.portalPassword;
        saveData.providerConfig = Object.keys(mergedConfig).length > 0 ? JSON.stringify(mergedConfig) : null;
      }
      updateMutation.mutate({ id: editingIntegration.id, data: saveData as typeof formData });
    } else {
      createMutation.mutate(saveData as typeof formData);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Plug className="w-5 h-5" />
            Integrações ERP Globais
          </div>
          <Button
            size="sm"
            onClick={() => { resetForm(); setDialogOpen(true); }}
            data-testid="button-add-erp-integration"
          >
            <Plus className="w-4 h-4 mr-2" />
            Nova Integração
          </Button>
        </CardTitle>
        <CardDescription>
          Configure integrações globais com sistemas ERP (Voalle, IXC, SGP)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Carregando integrações...</div>
        ) : integrations && integrations.length > 0 ? (
          <div className="space-y-3">
            {integrations.map((integration) => (
              <div
                key={integration.id}
                className="flex items-center justify-between p-4 border rounded-lg"
                data-testid={`erp-integration-${integration.id}`}
              >
                <div className="flex items-center gap-3">
                  {integration.connectionType === "api" ? (
                    <Globe className="w-5 h-5 text-muted-foreground" />
                  ) : (
                    <Database className="w-5 h-5 text-muted-foreground" />
                  )}
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{integration.name}</span>
                      <Badge variant="outline">
                        {ERP_PROVIDERS.find(p => p.value === integration.provider)?.label}
                      </Badge>
                      {integration.isDefault && (
                        <Badge variant="default">Padrão</Badge>
                      )}
                      {!integration.isActive && (
                        <Badge variant="secondary">Inativo</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                      <span>{CONNECTION_TYPES.find(t => t.value === integration.connectionType)?.label}</span>
                      {integration.lastTestedAt && (
                        <>
                          <span>|</span>
                          <span className="flex items-center gap-1">
                            {integration.lastTestStatus === "success" ? (
                              <CheckCircle className="w-3 h-3 text-green-500" />
                            ) : (
                              <XCircle className="w-3 h-3 text-red-500" />
                            )}
                            Último teste: {new Date(integration.lastTestedAt).toLocaleString("pt-BR")}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleTestConnection(integration.id)}
                    disabled={testingId === integration.id}
                    data-testid={`button-test-erp-${integration.id}`}
                  >
                    {testingId === integration.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <RefreshCw className="w-4 h-4" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => openEditDialog(integration)}
                    data-testid={`button-edit-erp-${integration.id}`}
                  >
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => deleteMutation.mutate(integration.id)}
                    data-testid={`button-delete-erp-${integration.id}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <Plug className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>Nenhuma integração ERP configurada.</p>
            <p className="text-sm">Clique em "Nova Integração" para começar.</p>
          </div>
        )}

        <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) resetForm(); setDialogOpen(open); }}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editingIntegration ? "Editar Integração ERP" : "Nova Integração ERP"}
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Nome</Label>
                  <Input
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="Ex: Voalle Produção"
                    data-testid="input-erp-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Sistema ERP</Label>
                  <Select
                    value={formData.provider}
                    onValueChange={(value) => setFormData({ ...formData, provider: value })}
                  >
                    <SelectTrigger data-testid="select-erp-provider">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ERP_PROVIDERS.map((p) => (
                        <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Tipo de Conexão</Label>
                  <Select
                    value={formData.connectionType}
                    onValueChange={(value) => setFormData({ ...formData, connectionType: value })}
                  >
                    <SelectTrigger data-testid="select-erp-connection-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CONNECTION_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-4 pt-6">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={formData.isActive}
                      onCheckedChange={(checked) => setFormData({ ...formData, isActive: checked })}
                      data-testid="switch-erp-active"
                    />
                    <Label>Ativo</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={formData.isDefault}
                      onCheckedChange={(checked) => setFormData({ ...formData, isDefault: checked })}
                      data-testid="switch-erp-default"
                    />
                    <Label>Padrão</Label>
                  </div>
                </div>
              </div>

              {formData.connectionType === "api" && (
                <>
                  <div className="space-y-2">
                    <Label>URL da API</Label>
                    <Input
                      value={formData.apiUrl}
                      onChange={(e) => setFormData({ ...formData, apiUrl: e.target.value })}
                      placeholder="https://erp.empresa.com.br"
                      data-testid="input-erp-api-url"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Client ID</Label>
                      <Input
                        value={formData.apiClientId}
                        onChange={(e) => setFormData({ ...formData, apiClientId: e.target.value })}
                        placeholder="ID do cliente integrador"
                        data-testid="input-erp-client-id"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Client Secret</Label>
                      <div className="flex gap-2">
                        <Input
                          type={showSecrets ? "text" : "password"}
                          value={formData.apiClientSecret}
                          onChange={(e) => setFormData({ ...formData, apiClientSecret: e.target.value })}
                          placeholder={editingIntegration ? "Deixe vazio para manter" : "Secret do cliente"}
                          data-testid="input-erp-client-secret"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={() => setShowSecrets(!showSecrets)}
                        >
                          {showSecrets ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </Button>
                      </div>
                    </div>
                  </div>
                  {formData.provider === "voalle" && (
                    <>
                      <div className="border-t pt-4 mt-2">
                        <h4 className="font-medium mb-3 text-sm text-muted-foreground">API Para Terceiros (autenticação principal)</h4>
                        <div className="space-y-4">
                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <Label>Usuário</Label>
                              <Input
                                value={formData.apiUsername}
                                onChange={(e) => setFormData({ ...formData, apiUsername: e.target.value })}
                                placeholder="CNPJ ou usuário integrador"
                                data-testid="input-erp-username"
                              />
                            </div>
                            <div className="space-y-2">
                              <Label>Senha</Label>
                              <Input
                                type={showSecrets ? "text" : "password"}
                                value={formData.apiPassword}
                                onChange={(e) => setFormData({ ...formData, apiPassword: e.target.value })}
                                placeholder={editingIntegration ? "Deixe vazio para manter" : "Senha do usuário"}
                                data-testid="input-erp-password"
                              />
                            </div>
                          </div>
                          <div className="space-y-2">
                            <Label>SynData</Label>
                            <Input
                              type={showSecrets ? "text" : "password"}
                              value={formData.apiSynData}
                              onChange={(e) => setFormData({ ...formData, apiSynData: e.target.value })}
                              placeholder={editingIntegration ? "Deixe vazio para manter" : "Token SynData para autenticação"}
                              data-testid="input-erp-syndata"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>Token SynV1 (opcional)</Label>
                            <Input
                              type={showSecrets ? "text" : "password"}
                              value={formData.apiSynV1Token}
                              onChange={(e) => setFormData({ ...formData, apiSynV1Token: e.target.value })}
                              placeholder="Token syn-v1 se necessário"
                              data-testid="input-erp-syn-token"
                            />
                          </div>
                        </div>
                      </div>

                      <div className="border-t pt-4 mt-4">
                        <h4 className="font-medium mb-3 text-sm text-muted-foreground">API Portal (opcional - para etiquetas de contrato)</h4>
                        <div className="space-y-4">
                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <Label>URL da API Portal</Label>
                              <Input
                                value={formData.portalApiUrl}
                                onChange={(e) => setFormData({ ...formData, portalApiUrl: e.target.value })}
                                placeholder="http://api.marvitel.com.br/"
                                data-testid="input-erp-portal-url"
                              />
                            </div>
                            <div className="space-y-2">
                              <Label>Verify Token</Label>
                              <Input
                                type={showSecrets ? "text" : "password"}
                                value={formData.portalVerifyToken}
                                onChange={(e) => setFormData({ ...formData, portalVerifyToken: e.target.value })}
                                placeholder={editingIntegration ? "Deixe vazio para manter" : "Token de verificação"}
                                data-testid="input-erp-portal-verify-token"
                              />
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <Label>Client ID</Label>
                              <Input
                                value={formData.portalClientId}
                                onChange={(e) => setFormData({ ...formData, portalClientId: e.target.value })}
                                placeholder="Client ID da API Portal"
                                data-testid="input-erp-portal-client-id"
                              />
                            </div>
                            <div className="space-y-2">
                              <Label>Client Secret</Label>
                              <Input
                                type={showSecrets ? "text" : "password"}
                                value={formData.portalClientSecret}
                                onChange={(e) => setFormData({ ...formData, portalClientSecret: e.target.value })}
                                placeholder={editingIntegration ? "Deixe vazio para manter" : "Client Secret"}
                                data-testid="input-erp-portal-client-secret"
                              />
                            </div>
                          </div>
                          <Separator className="my-4" />
                          <h5 className="text-sm font-medium text-muted-foreground mb-3">Credenciais Administrativas (para recuperação de senha)</h5>
                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <Label>Usuário Admin Portal</Label>
                              <Input
                                value={formData.portalUsername}
                                onChange={(e) => setFormData({ ...formData, portalUsername: e.target.value })}
                                placeholder="CPF/CNPJ do admin"
                                data-testid="input-erp-portal-username"
                              />
                            </div>
                            <div className="space-y-2">
                              <Label>Senha Admin Portal</Label>
                              <Input
                                type={showSecrets ? "text" : "password"}
                                value={formData.portalPassword}
                                onChange={(e) => setFormData({ ...formData, portalPassword: e.target.value })}
                                placeholder={editingIntegration ? "Deixe vazio para manter" : "Senha do admin"}
                                data-testid="input-erp-portal-password"
                              />
                            </div>
                          </div>
                          <div className="p-3 bg-muted/50 rounded-md text-sm text-muted-foreground mt-3">
                            <strong>Importante:</strong> Estas credenciais administrativas são usadas para funcionalidades como 
                            recuperação de senha dos clientes. Devem ser de um usuário admin da Marvitel no Portal.
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </>
              )}

              {formData.connectionType === "database" && (
                <>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label>Tipo de Banco</Label>
                      <Select
                        value={formData.dbType}
                        onValueChange={(value) => setFormData({ ...formData, dbType: value })}
                      >
                        <SelectTrigger data-testid="select-erp-db-type">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {DB_TYPES.map((t) => (
                            <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Host</Label>
                      <Input
                        value={formData.dbHost}
                        onChange={(e) => setFormData({ ...formData, dbHost: e.target.value })}
                        placeholder="192.168.1.100"
                        data-testid="input-erp-db-host"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Porta</Label>
                      <Input
                        type="number"
                        value={formData.dbPort}
                        onChange={(e) => setFormData({ ...formData, dbPort: parseInt(e.target.value) || 3306 })}
                        data-testid="input-erp-db-port"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label>Banco de Dados</Label>
                      <Input
                        value={formData.dbName}
                        onChange={(e) => setFormData({ ...formData, dbName: e.target.value })}
                        placeholder="nome_banco"
                        data-testid="input-erp-db-name"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Usuário</Label>
                      <Input
                        value={formData.dbUser}
                        onChange={(e) => setFormData({ ...formData, dbUser: e.target.value })}
                        placeholder="usuario"
                        data-testid="input-erp-db-user"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Senha</Label>
                      <Input
                        type={showSecrets ? "text" : "password"}
                        value={formData.dbPassword}
                        onChange={(e) => setFormData({ ...formData, dbPassword: e.target.value })}
                        placeholder={editingIntegration ? "Deixe vazio para manter" : "senha"}
                        data-testid="input-erp-db-password"
                      />
                    </div>
                  </div>
                </>
              )}

              <div className="border-t pt-4 space-y-4">
                <h4 className="text-sm font-medium">Configurações de Chamados</h4>
                <div className="space-y-2">
                  <Label>Código do Tipo de Solicitação</Label>
                  <Input
                    value={formData.defaultSolicitationTypeCode}
                    onChange={(e) => setFormData({ ...formData, defaultSolicitationTypeCode: e.target.value })}
                    placeholder="Ex: suporte_link"
                    data-testid="input-erp-solicitation-code"
                  />
                </div>
                <div className="flex items-center justify-between rounded-lg border p-4">
                  <div>
                    <p className="font-medium">Abertura Automática de Chamados</p>
                    <p className="text-xs text-muted-foreground">
                      Criar automaticamente chamado ao detectar incidente
                    </p>
                  </div>
                  <Switch
                    checked={formData.autoCreateTicket}
                    onCheckedChange={(checked) => setFormData({ ...formData, autoCreateTicket: checked })}
                    data-testid="switch-erp-auto-ticket"
                  />
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Cancelar
              </Button>
              <Button
                onClick={handleSave}
                disabled={createMutation.isPending || updateMutation.isPending || !formData.name}
                data-testid="button-save-erp"
              >
                {(createMutation.isPending || updateMutation.isPending) && (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                )}
                Salvar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

export default function Admin() {
  const { toast } = useToast();
  const { isSuperAdmin, isLoading: authLoading } = useAuth();
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [clientDialogOpen, setClientDialogOpen] = useState(false);
  const [editingLink, setEditingLink] = useState<Link | undefined>();
  const [editingClient, setEditingClient] = useState<Client | undefined>();
  const [clientFormData, setClientFormData] = useState({
    name: "",
    slug: "",
    cnpj: "",
    isActive: true,
    voalleCustomerId: "" as string | number,
    voallePortalUsername: "",
    voallePortalPassword: "",
  });

  // Estados de busca para links e clientes
  const [linkSearchTerm, setLinkSearchTerm] = useState("");
  const [clientSearchTerm, setClientSearchTerm] = useState("");

  // Estados para importação de clientes do Voalle
  const [voalleImportDialogOpen, setVoalleImportDialogOpen] = useState(false);
  const [voalleSearchQuery, setVoalleSearchQuery] = useState("");
  const [voalleSearchResults, setVoalleSearchResults] = useState<Array<{
    id: number | string;
    name: string;
    document?: string;
    code?: string;
    email?: string;
    phone?: string;
    city?: string;
    state?: string;
  }>>([]);
  const [voalleSearching, setVoalleSearching] = useState(false);
  const [selectedVoalleCustomer, setSelectedVoalleCustomer] = useState<{
    id: number | string;
    name: string;
    document?: string;
    code?: string;
    email?: string;
    phone?: string;
    city?: string;
    state?: string;
  } | null>(null);

  const { data: clients, isLoading: clientsLoading } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
    enabled: isSuperAdmin,
  });

  const { data: links, isLoading: linksLoading } = useQuery<Link[]>({
    queryKey: ["/api/links"],
    enabled: isSuperAdmin,
  });

  const { data: blacklistChecks } = useQuery<BlacklistCheck[]>({
    queryKey: ["/api/blacklist/cached"],
    enabled: isSuperAdmin,
    refetchInterval: 60000,
  });

  const { data: allSnmpProfiles } = useQuery<Array<{ id: number; name: string; clientId: number }>>({
    queryKey: ["/api/snmp-profiles"],
    enabled: isSuperAdmin,
  });

  // Filtragem de links
  const filteredLinks = links?.filter(link => {
    if (!linkSearchTerm.trim()) return true;
    const search = linkSearchTerm.toLowerCase();
    const clientName = clients?.find(c => c.id === link.clientId)?.name?.toLowerCase() || "";
    return (
      link.name?.toLowerCase().includes(search) ||
      link.identifier?.toLowerCase().includes(search) ||
      link.location?.toLowerCase().includes(search) ||
      link.address?.toLowerCase().includes(search) ||
      link.monitoredIp?.toLowerCase().includes(search) ||
      link.ipBlock?.toLowerCase().includes(search) ||
      clientName.includes(search)
    );
  });

  // Filtragem de clientes
  const filteredClients = clients?.filter(client => {
    if (!clientSearchTerm.trim()) return true;
    const search = clientSearchTerm.toLowerCase();
    return (
      client.name?.toLowerCase().includes(search) ||
      client.slug?.toLowerCase().includes(search) ||
      client.cnpj?.toLowerCase().includes(search)
    );
  });

  const createLinkMutation = useMutation({
    mutationFn: async (data: Partial<Link> & { _selectedCpes?: Array<{ cpeId: number; role: string; ipOverride?: string; showInEquipmentTab?: boolean }> }) => {
      const { _selectedCpes, ...linkData } = data;
      const response = await apiRequest("POST", "/api/links", linkData);
      const newLink = await response.json();
      // Adicionar CPEs ao link recém-criado
      if (_selectedCpes && _selectedCpes.length > 0 && newLink?.id) {
        for (const cpe of _selectedCpes) {
          await apiRequest("POST", `/api/links/${newLink.id}/cpes`, { 
            cpeId: cpe.cpeId, 
            role: cpe.role,
            ipOverride: cpe.ipOverride || null,
            showInEquipmentTab: cpe.showInEquipmentTab || false
          });
        }
      }
      return newLink;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/links"] });
      setLinkDialogOpen(false);
      setEditingLink(undefined);
      toast({ title: "Link criado com sucesso" });
    },
    onError: () => {
      toast({ title: "Erro ao criar link", variant: "destructive" });
    },
  });

  const updateLinkMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<Link> & { _selectedCpes?: Array<{ cpeId: number; role: string; ipOverride?: string; showInEquipmentTab?: boolean }> } }) => {
      const { _selectedCpes, ...linkData } = data;
      const response = await apiRequest("PATCH", `/api/links/${id}`, linkData);
      // Sincronizar CPEs: buscar existentes, remover/adicionar/atualizar conforme necessário
      if (_selectedCpes !== undefined) {
        const existingRes = await apiRequest("GET", `/api/links/${id}/cpes`);
        const existing: Array<{ cpeId: number; role: string | null; ipOverride?: string | null; showInEquipmentTab?: boolean }> = await existingRes.json();
        const existingIds = existing.map(e => e.cpeId);
        const selectedIds = _selectedCpes.map(s => s.cpeId);
        // Remover os que não estão mais selecionados
        for (const e of existing) {
          if (!selectedIds.includes(e.cpeId)) {
            await apiRequest("DELETE", `/api/links/${id}/cpes/${e.cpeId}`);
          }
        }
        // Adicionar novos ou recriar se dados mudaram (delete+add para atualizar)
        for (const s of _selectedCpes) {
          const existingAssoc = existing.find(e => e.cpeId === s.cpeId);
          if (!existingAssoc) {
            // Novo CPE
            await apiRequest("POST", `/api/links/${id}/cpes`, { 
              cpeId: s.cpeId, 
              role: s.role,
              ipOverride: s.ipOverride || null,
              showInEquipmentTab: s.showInEquipmentTab || false
            });
          } else if (
            existingAssoc.role !== s.role || 
            existingAssoc.ipOverride !== (s.ipOverride || null) ||
            existingAssoc.showInEquipmentTab !== (s.showInEquipmentTab || false)
          ) {
            // Dados mudaram - remover e readicionar
            await apiRequest("DELETE", `/api/links/${id}/cpes/${s.cpeId}`);
            await apiRequest("POST", `/api/links/${id}/cpes`, { 
              cpeId: s.cpeId, 
              role: s.role,
              ipOverride: s.ipOverride || null,
              showInEquipmentTab: s.showInEquipmentTab || false
            });
          }
        }
      }
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/links"] });
      setLinkDialogOpen(false);
      setEditingLink(undefined);
      toast({ title: "Link atualizado com sucesso" });
    },
    onError: () => {
      toast({ title: "Erro ao atualizar link", variant: "destructive" });
    },
  });

  const deleteLinkMutation = useMutation({
    mutationFn: async (id: number) => {
      return await apiRequest("DELETE", `/api/links/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/links"] });
      toast({ title: "Link excluído com sucesso" });
    },
    onError: () => {
      toast({ title: "Erro ao excluir link", variant: "destructive" });
    },
  });

  const createClientMutation = useMutation({
    mutationFn: async (data: { name: string; slug: string; cnpj?: string; isActive: boolean }) => {
      return await apiRequest("POST", "/api/clients", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      setClientDialogOpen(false);
      setEditingClient(undefined);
      setClientFormData({ name: "", slug: "", cnpj: "", isActive: true, voalleCustomerId: "", voallePortalUsername: "", voallePortalPassword: "" });
      toast({ title: "Cliente criado com sucesso" });
    },
    onError: () => {
      toast({ title: "Erro ao criar cliente", variant: "destructive" });
    },
  });

  const updateClientMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<Client> }) => {
      return await apiRequest("PATCH", `/api/clients/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      setClientDialogOpen(false);
      setEditingClient(undefined);
      setClientFormData({ name: "", slug: "", cnpj: "", isActive: true, voalleCustomerId: "", voallePortalUsername: "", voallePortalPassword: "" });
      toast({ title: "Cliente atualizado com sucesso" });
    },
    onError: () => {
      toast({ title: "Erro ao atualizar cliente", variant: "destructive" });
    },
  });

  const deleteClientMutation = useMutation({
    mutationFn: async (id: number) => {
      return await apiRequest("DELETE", `/api/clients/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      toast({ title: "Cliente excluído com sucesso" });
    },
    onError: () => {
      toast({ title: "Erro ao excluir cliente", variant: "destructive" });
    },
  });

  const importVoalleCustomerMutation = useMutation({
    mutationFn: async (customer: {
      name: string;
      txId?: string;
      document?: string;
      voalleCustomerId: number;
    }) => {
      const slug = customer.name
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .substring(0, 50);
      
      return await apiRequest("POST", "/api/clients", {
        name: customer.name,
        slug: slug,
        cnpj: customer.txId || customer.document || "",
        voalleCustomerId: customer.voalleCustomerId,
        isActive: true,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      setVoalleImportDialogOpen(false);
      setVoalleSearchQuery("");
      setVoalleSearchResults([]);
      setSelectedVoalleCustomer(null);
      toast({ title: "Cliente importado do Voalle com sucesso" });
    },
    onError: () => {
      toast({ title: "Erro ao importar cliente do Voalle", variant: "destructive" });
    },
  });

  const handleVoalleSearch = async () => {
    if (!voalleSearchQuery.trim()) return;
    if (voalleSearchQuery.trim().length < 2) {
      toast({ 
        title: "Busca muito curta", 
        description: "Digite pelo menos 2 caracteres para buscar",
        variant: "destructive" 
      });
      return;
    }
    
    setVoalleSearching(true);
    try {
      const token = getAuthToken();
      const response = await fetch(`/api/voalle/customers/search?q=${encodeURIComponent(voalleSearchQuery)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || data.error || "Erro ao buscar clientes no Voalle");
      }
      setVoalleSearchResults(data.customers || []);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Erro desconhecido";
      toast({ 
        title: "Erro ao buscar clientes", 
        description: errorMessage,
        variant: "destructive" 
      });
      setVoalleSearchResults([]);
    } finally {
      setVoalleSearching(false);
    }
  };

  const handleImportVoalleCustomer = () => {
    if (!selectedVoalleCustomer) return;
    
    importVoalleCustomerMutation.mutate({
      name: selectedVoalleCustomer.name,
      document: selectedVoalleCustomer.document || selectedVoalleCustomer.code,
      voalleCustomerId: typeof selectedVoalleCustomer.id === 'string' ? parseInt(selectedVoalleCustomer.id) : selectedVoalleCustomer.id,
    });
  };

  const handleSaveClient = () => {
    const dataToSend = {
      ...clientFormData,
      voalleCustomerId: clientFormData.voalleCustomerId ? Number(clientFormData.voalleCustomerId) : null,
    };
    if (editingClient) {
      updateClientMutation.mutate({ id: editingClient.id, data: dataToSend });
    } else {
      createClientMutation.mutate(dataToSend);
    }
  };

  const handleEditClient = (client: Client) => {
    setEditingClient(client);
    setClientFormData({
      name: client.name,
      slug: client.slug,
      cnpj: client.cnpj || "",
      isActive: client.isActive,
      voalleCustomerId: client.voalleCustomerId || "",
      voallePortalUsername: client.voallePortalUsername || "",
      voallePortalPassword: "",
    });
    setClientDialogOpen(true);
  };

  const handleSaveLink = (data: Partial<Link>) => {
    if (editingLink) {
      updateLinkMutation.mutate({ id: editingLink.id, data });
    } else {
      createLinkMutation.mutate(data);
    }
  };

  const handleEditLink = (link: Link) => {
    setEditingLink(link);
    setLinkDialogOpen(true);
  };

  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!isSuperAdmin) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <Shield className="w-16 h-16 text-muted-foreground" />
        <h1 className="text-2xl font-semibold">Acesso Restrito</h1>
        <p className="text-muted-foreground">
          Esta área é exclusiva para administradores da Marvitel.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Painel Marvitel</h1>
        <p className="text-muted-foreground">
          Gerenciamento de clientes, links e hosts monitorados
        </p>
      </div>

      <Tabs defaultValue="links" className="space-y-4">
        <TabsList>
          <TabsTrigger value="links" className="gap-2">
            <Network className="w-4 h-4" />
            Links
          </TabsTrigger>
          <TabsTrigger value="link-groups" className="gap-2">
            <Layers className="w-4 h-4" />
            Grupos
          </TabsTrigger>
          <TabsTrigger value="clients" className="gap-2">
            <Building2 className="w-4 h-4" />
            Clientes
          </TabsTrigger>
          <TabsTrigger value="integrations" className="gap-2">
            <Shield className="w-4 h-4" />
            Integrações
          </TabsTrigger>
          <TabsTrigger value="users-groups" className="gap-2">
            <Users className="w-4 h-4" />
            Usuários e Grupos
          </TabsTrigger>
          <TabsTrigger value="system-settings" className="gap-2">
            <Settings className="w-4 h-4" />
            Sistema
          </TabsTrigger>
          <TabsTrigger value="olts" className="gap-2">
            <Radio className="w-4 h-4" />
            OLTs
          </TabsTrigger>
          <TabsTrigger value="switches" className="gap-2" data-testid="tab-switches">
            <Network className="w-4 h-4" />
            Switches
          </TabsTrigger>
          <TabsTrigger value="concentrators" className="gap-2">
            <Server className="w-4 h-4" />
            Concentradores
          </TabsTrigger>
          <TabsTrigger value="vendors" className="gap-2">
            <Cpu className="w-4 h-4" />
            Fabricantes
          </TabsTrigger>
          <TabsTrigger value="cpes" className="gap-2" data-testid="tab-cpes">
            <Router className="w-4 h-4" />
            CPEs
          </TabsTrigger>
          <TabsTrigger value="database" className="gap-2">
            <Database className="w-4 h-4" />
            Banco de Dados
          </TabsTrigger>
          <TabsTrigger value="audit" className="gap-2" data-testid="tab-audit">
            <ClipboardList className="w-4 h-4" />
            Auditoria
          </TabsTrigger>
          <TabsTrigger value="diagnostics" className="gap-2" data-testid="tab-diagnostics">
            <Activity className="w-4 h-4" />
            Diagnóstico
          </TabsTrigger>
          <TabsTrigger value="firewall" className="gap-2" data-testid="tab-firewall">
            <ShieldCheck className="w-4 h-4" />
            Firewall
          </TabsTrigger>
        </TabsList>

        <TabsContent value="links" className="space-y-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-lg font-medium">Links Monitorados</h2>
              <p className="text-sm text-muted-foreground">
                Gerencie os links de internet dedicados
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar link, cliente, IP..."
                  value={linkSearchTerm}
                  onChange={(e) => setLinkSearchTerm(e.target.value)}
                  className="pl-8 w-64"
                  data-testid="input-search-links"
                />
              </div>
              <Dialog open={linkDialogOpen} onOpenChange={(open) => {
                setLinkDialogOpen(open);
                if (!open) setEditingLink(undefined);
              }}>
                <DialogTrigger asChild>
                  <Button data-testid="button-add-link">
                    <Plus className="w-4 h-4 mr-2" />
                    Adicionar Link
                  </Button>
                </DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>{editingLink ? "Editar Link" : "Novo Link"}</DialogTitle>
                </DialogHeader>
                <LinkForm
                  link={editingLink}
                  onSave={handleSaveLink}
                  onClose={() => {
                    setLinkDialogOpen(false);
                    setEditingLink(undefined);
                  }}
                  snmpProfiles={allSnmpProfiles}
                  clients={clients}
                  onProfileCreated={() => queryClient.invalidateQueries({ queryKey: ["/api/snmp-profiles"] })}
                />
              </DialogContent>
            </Dialog>
            </div>
          </div>

          {linksLoading ? (
            <div className="space-y-3">
              {[1, 2].map((i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              {filteredLinks?.map((link) => {
                const clientName = clients?.find(c => c.id === link.clientId)?.name;
                const blacklistCheck = blacklistChecks?.find(bc => bc.linkId === link.id);
                const isBlacklisted = blacklistCheck?.isListed;
                const listedOnCount = Array.isArray(blacklistCheck?.listedOn) ? (blacklistCheck.listedOn as Array<unknown>).length : 0;
                return (
                  <Card key={link.id} data-testid={`card-admin-link-${link.id}`}>
                    <CardContent className="py-4">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center">
                            <Network className="w-5 h-5 text-primary" />
                          </div>
                          <div>
                            <p className="font-medium">{link.name}</p>
                            <p className="text-sm text-muted-foreground">
                              {clientName && <span className="text-primary">{clientName}</span>}
                              {clientName && " - "}{link.location} - {link.ipBlock} - {formatBandwidth(link.bandwidth)}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {isBlacklisted && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge variant="destructive" className="gap-1" data-testid={`badge-blacklist-${link.id}`}>
                                  <AlertTriangle className="w-3 h-3" />
                                  Blacklist ({listedOnCount})
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>IP listado em {listedOnCount} blacklist(s)</p>
                                {blacklistCheck?.lastCheckedAt && (
                                  <p className="text-xs opacity-70">Verificado em {new Date(blacklistCheck.lastCheckedAt).toLocaleString("pt-BR")}</p>
                                )}
                              </TooltipContent>
                            </Tooltip>
                          )}
                          {blacklistCheck && !isBlacklisted && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge variant="outline" className="gap-1 text-green-600 border-green-600" data-testid={`badge-blacklist-ok-${link.id}`}>
                                  <CheckCircle className="w-3 h-3" />
                                  Limpo
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>IP não está em nenhuma blacklist</p>
                                {blacklistCheck?.lastCheckedAt && (
                                  <p className="text-xs opacity-70">Verificado em {new Date(blacklistCheck.lastCheckedAt).toLocaleString("pt-BR")}</p>
                                )}
                              </TooltipContent>
                            </Tooltip>
                          )}
                          <Badge variant={link.status === "operational" ? "default" : "destructive"}>
                            {link.status === "operational" ? "Operacional" : link.status}
                          </Badge>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleEditLink(link)}
                            data-testid={`button-edit-link-${link.id}`}
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => deleteLinkMutation.mutate(link.id)}
                            data-testid={`button-delete-link-${link.id}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                      {link.monitoredIp && (
                        <div className="mt-3 pt-3 border-t">
                          <p className="text-xs text-muted-foreground">
                            IP Monitorado: <span className="font-mono">{link.monitoredIp}</span>
                          </p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
              {(!filteredLinks || filteredLinks.length === 0) && (
                <Card>
                  <CardContent className="py-8 text-center text-muted-foreground">
                    {linkSearchTerm ? "Nenhum link encontrado para a busca." : "Nenhum link cadastrado. Clique em \"Adicionar Link\" para começar."}
                  </CardContent>
                </Card>
              )}
            </div>
          )}

        </TabsContent>

        <TabsContent value="link-groups" className="space-y-4">
          <LinkGroupsTab clients={clients || []} />
        </TabsContent>

        <TabsContent value="clients" className="space-y-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-lg font-medium">Clientes</h2>
              <p className="text-sm text-muted-foreground">
                Organizações cadastradas no sistema
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar cliente, CNPJ..."
                  value={clientSearchTerm}
                  onChange={(e) => setClientSearchTerm(e.target.value)}
                  className="pl-8 w-56"
                  data-testid="input-search-clients"
                />
              </div>
              <Dialog open={voalleImportDialogOpen} onOpenChange={(open) => {
                setVoalleImportDialogOpen(open);
                if (!open) {
                  setVoalleSearchQuery("");
                  setVoalleSearchResults([]);
                  setSelectedVoalleCustomer(null);
                }
              }}>
                <DialogTrigger asChild>
                  <Button variant="outline" data-testid="button-import-voalle">
                    <Download className="w-4 h-4 mr-2" />
                    Importar do Voalle
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl">
                  <DialogHeader>
                    <DialogTitle>Importar Cliente do Voalle</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="flex gap-2">
                      <Input
                        placeholder="Buscar por nome, CPF ou CNPJ..."
                        value={voalleSearchQuery}
                        onChange={(e) => setVoalleSearchQuery(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleVoalleSearch()}
                        data-testid="input-voalle-search"
                      />
                      <Button 
                        onClick={handleVoalleSearch}
                        disabled={voalleSearching || !voalleSearchQuery.trim()}
                        data-testid="button-voalle-search"
                      >
                        {voalleSearching ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Search className="w-4 h-4" />
                        )}
                      </Button>
                    </div>

                    {voalleSearchResults.length > 0 && (
                      <div className="border rounded-md max-h-64 overflow-y-auto">
                        {voalleSearchResults.map((customer) => (
                          <div
                            key={customer.id}
                            className={`p-3 cursor-pointer border-b last:border-b-0 hover-elevate ${
                              selectedVoalleCustomer?.id === customer.id ? "bg-accent" : ""
                            }`}
                            onClick={() => setSelectedVoalleCustomer(customer)}
                            data-testid={`voalle-customer-${customer.id}`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div>
                                <p className="font-medium">{customer.name}</p>
                                <p className="text-sm text-muted-foreground">
                                  {customer.document && `CPF/CNPJ: ${customer.document}`}
                                  {customer.city && customer.state && ` - ${customer.city}/${customer.state}`}
                                </p>
                              </div>
                              {selectedVoalleCustomer?.id === customer.id && (
                                <CheckCircle className="w-5 h-5 text-primary" />
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {voalleSearchResults.length === 0 && voalleSearchQuery && !voalleSearching && (
                      <p className="text-sm text-muted-foreground text-center py-4">
                        Nenhum cliente encontrado. Tente outra busca.
                      </p>
                    )}

                    {selectedVoalleCustomer && (
                      <Card>
                        <CardContent className="py-4">
                          <h4 className="font-medium mb-2">Cliente selecionado:</h4>
                          <div className="grid grid-cols-2 gap-2 text-sm">
                            <div>
                              <span className="text-muted-foreground">Nome:</span>{" "}
                              {selectedVoalleCustomer.name}
                            </div>
                            <div>
                              <span className="text-muted-foreground">CPF/CNPJ:</span>{" "}
                              {selectedVoalleCustomer.document || "-"}
                            </div>
                            <div>
                              <span className="text-muted-foreground">Cidade:</span>{" "}
                              {selectedVoalleCustomer.city || "-"}
                            </div>
                            <div>
                              <span className="text-muted-foreground">Estado:</span>{" "}
                              {selectedVoalleCustomer.state || "-"}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    )}
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setVoalleImportDialogOpen(false)}>
                      Cancelar
                    </Button>
                    <Button 
                      onClick={handleImportVoalleCustomer}
                      disabled={!selectedVoalleCustomer || importVoalleCustomerMutation.isPending}
                      data-testid="button-import-voalle-confirm"
                    >
                      {importVoalleCustomerMutation.isPending && (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      )}
                      Importar Cliente
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <Dialog open={clientDialogOpen} onOpenChange={(open) => {
                setClientDialogOpen(open);
                if (!open) {
                  setEditingClient(undefined);
                  setClientFormData({ name: "", slug: "", cnpj: "", isActive: true, voalleCustomerId: "", voallePortalUsername: "", voallePortalPassword: "" });
                }
              }}>
                <DialogTrigger asChild>
                  <Button data-testid="button-add-client">
                    <Plus className="w-4 h-4 mr-2" />
                    Adicionar Cliente
                  </Button>
                </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{editingClient ? "Editar Cliente" : "Novo Cliente"}</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="client-name">Nome da Organização</Label>
                    <Input
                      id="client-name"
                      value={clientFormData.name}
                      onChange={(e) => setClientFormData({ ...clientFormData, name: e.target.value })}
                      placeholder="Ex: Defensoria Pública do Estado de Sergipe"
                      data-testid="input-client-name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="client-slug">Identificador (slug)</Label>
                    <Input
                      id="client-slug"
                      value={clientFormData.slug}
                      onChange={(e) => setClientFormData({ ...clientFormData, slug: e.target.value.toLowerCase().replace(/\s+/g, '-') })}
                      placeholder="Ex: dpe-se"
                      data-testid="input-client-slug"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="client-cnpj">CNPJ (opcional)</Label>
                    <Input
                      id="client-cnpj"
                      value={clientFormData.cnpj}
                      onChange={(e) => setClientFormData({ ...clientFormData, cnpj: e.target.value })}
                      placeholder="00.000.000/0001-00"
                      data-testid="input-client-cnpj"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="client-voalle-id">ID do Cliente no Voalle (Opcional)</Label>
                    <Input
                      id="client-voalle-id"
                      type="number"
                      value={clientFormData.voalleCustomerId}
                      onChange={(e) => setClientFormData({ ...clientFormData, voalleCustomerId: e.target.value })}
                      placeholder="Ex: 12345"
                      data-testid="input-client-voalle-id"
                    />
                    <p className="text-xs text-muted-foreground">
                      Vincule este cliente ao cadastro do Voalle para integração automática
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="client-voalle-portal-username">Usuário Portal Voalle (Opcional)</Label>
                    <Input
                      id="client-voalle-portal-username"
                      value={clientFormData.voallePortalUsername}
                      onChange={(e) => setClientFormData({ ...clientFormData, voallePortalUsername: e.target.value })}
                      placeholder="Ex: usuario@empresa.com.br"
                      data-testid="input-client-voalle-portal-username"
                    />
                    <p className="text-xs text-muted-foreground">
                      Credenciais do Portal API para buscar etiquetas de contrato
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="client-voalle-portal-password">Senha Portal Voalle (Opcional)</Label>
                    <Input
                      id="client-voalle-portal-password"
                      type="password"
                      value={clientFormData.voallePortalPassword}
                      onChange={(e) => setClientFormData({ ...clientFormData, voallePortalPassword: e.target.value })}
                      placeholder={editingClient ? "Deixe vazio para manter a senha atual" : "Senha do portal"}
                      data-testid="input-client-voalle-portal-password"
                    />
                    {editingClient && editingClient.portalCredentialsStatus && (
                      <div className={`text-xs p-2 rounded-md mt-2 ${
                        editingClient.portalCredentialsStatus === 'valid' 
                          ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                          : editingClient.portalCredentialsStatus === 'invalid'
                          ? 'bg-red-500/10 text-red-600 dark:text-red-400'
                          : editingClient.portalCredentialsStatus === 'unconfigured'
                          ? 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400'
                          : 'bg-muted text-muted-foreground'
                      }`}>
                        <div className="flex items-center gap-2">
                          {editingClient.portalCredentialsStatus === 'valid' && <CheckCircle className="w-3 h-3" />}
                          {editingClient.portalCredentialsStatus === 'invalid' && <AlertTriangle className="w-3 h-3" />}
                          {editingClient.portalCredentialsStatus === 'unconfigured' && <AlertCircle className="w-3 h-3" />}
                          <span>
                            {editingClient.portalCredentialsStatus === 'valid' && 'Credenciais válidas'}
                            {editingClient.portalCredentialsStatus === 'invalid' && 'Credenciais inválidas - atualize a senha'}
                            {editingClient.portalCredentialsStatus === 'unconfigured' && 'Credenciais não configuradas'}
                            {editingClient.portalCredentialsStatus === 'unchecked' && 'Não verificado'}
                            {editingClient.portalCredentialsStatus === 'error' && 'Erro na verificação'}
                          </span>
                        </div>
                        {editingClient.portalCredentialsLastCheck && (
                          <p className="text-[10px] mt-1 opacity-70">
                            Última verificação: {new Date(editingClient.portalCredentialsLastCheck).toLocaleString('pt-BR')}
                          </p>
                        )}
                        {editingClient.portalCredentialsError && editingClient.portalCredentialsStatus !== 'valid' && (
                          <p className="text-[10px] mt-1 opacity-70">{editingClient.portalCredentialsError}</p>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      id="client-active"
                      checked={clientFormData.isActive}
                      onCheckedChange={(checked) => setClientFormData({ ...clientFormData, isActive: checked })}
                      data-testid="switch-client-active"
                    />
                    <Label htmlFor="client-active">Cliente Ativo</Label>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setClientDialogOpen(false)}>
                    Cancelar
                  </Button>
                  <Button 
                    onClick={handleSaveClient}
                    disabled={!clientFormData.name || !clientFormData.slug || createClientMutation.isPending || updateClientMutation.isPending}
                    data-testid="button-save-client"
                  >
                    Salvar
                  </Button>
                </DialogFooter>
              </DialogContent>
              </Dialog>
            </div>
          </div>

          {clientsLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-24 w-full" />
            </div>
          ) : (
            <div className="space-y-3">
              {filteredClients?.map((client) => (
                <Card key={client.id} data-testid={`card-admin-client-${client.id}`}>
                  <CardContent className="flex items-center justify-between gap-4 py-4">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center">
                        <Building2 className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <p className="font-medium">{client.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {client.slug} {client.cnpj && `- CNPJ: ${client.cnpj}`}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={client.isActive ? "default" : "secondary"}>
                        {client.isActive ? "Ativo" : "Inativo"}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleEditClient(client)}
                        data-testid={`button-edit-client-${client.id}`}
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteClientMutation.mutate(client.id)}
                        data-testid={`button-delete-client-${client.id}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
              {(!clients || clients.length === 0) && (
                <Card>
                  <CardContent className="py-8 text-center text-muted-foreground">
                    Nenhum cliente cadastrado. Clique em "Adicionar Cliente" para começar.
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="integrations" className="space-y-4">
          <div>
            <h2 className="text-lg font-medium">Integrações</h2>
            <p className="text-sm text-muted-foreground">
              Configure integrações com sistemas externos
            </p>
          </div>

          <HetrixToolsIntegration />
          <ErpIntegrationsManager clients={clients || []} />
          <WanguardIntegration clients={clients || []} />
        </TabsContent>

        <TabsContent value="users-groups" className="space-y-4">
          <UsersAndGroupsTab clients={clients || []} />
        </TabsContent>

        <TabsContent value="system-settings" className="space-y-4">
          <SystemSettingsTab />
        </TabsContent>

        <TabsContent value="olts" className="space-y-4">
          <OltsTab clients={clients || []} />
        </TabsContent>

        <TabsContent value="switches" className="space-y-4">
          <SwitchesTab />
        </TabsContent>

        <TabsContent value="concentrators" className="space-y-4">
          <ConcentratorsTab />
        </TabsContent>

        <TabsContent value="vendors" className="space-y-4">
          <EquipmentVendorsTab />
        </TabsContent>

        <TabsContent value="cpes" className="space-y-4">
          <CpesTab />
        </TabsContent>

        <TabsContent value="database" className="space-y-4">
          <DatabaseConfigTab />
        </TabsContent>
        
        <TabsContent value="audit" className="space-y-4">
          <AuditLogsTab />
        </TabsContent>

        <TabsContent value="diagnostics" className="space-y-4">
          <DiagnosticsTab />
        </TabsContent>

        <TabsContent value="firewall" className="space-y-4">
          <FirewallManager />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SnmpConfigTab({ clients }: { clients: Client[] }) {
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const { toast } = useToast();

  const { data: snmpProfiles, isLoading: profilesLoading, refetch: refetchProfiles } = useQuery<any[]>({
    queryKey: ['/api/clients', selectedClient?.id, 'snmp-profiles'],
    enabled: !!selectedClient,
  });

  const [profileDialogOpen, setProfileDialogOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<any>(null);
  const [profileFormData, setProfileFormData] = useState({
    name: "",
    description: "",
    snmpVersion: "v2c",
    community: "public",
    port: 161,
    timeout: 5000,
    retries: 3,
  });

  const [mibDialogOpen, setMibDialogOpen] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState<any>(null);
  const [mibFormData, setMibFormData] = useState({
    name: "",
    oid: "",
    dataType: "integer",
    unit: "",
    pollInterval: 30,
    scaleFactor: 1.0,
  });

  const createProfileMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiRequest("POST", `/api/clients/${selectedClient?.id}/snmp-profiles`, data);
    },
    onSuccess: () => {
      toast({ title: "Perfil SNMP criado com sucesso" });
      refetchProfiles();
      setProfileDialogOpen(false);
      setProfileFormData({ name: "", description: "", snmpVersion: "v2c", community: "public", port: 161, timeout: 5000, retries: 3 });
    },
    onError: () => {
      toast({ title: "Erro ao criar perfil SNMP", variant: "destructive" });
    },
  });

  const deleteProfileMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/clients/${selectedClient?.id}/snmp-profiles/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Perfil SNMP excluído com sucesso" });
      refetchProfiles();
    },
    onError: () => {
      toast({ title: "Erro ao excluir perfil SNMP", variant: "destructive" });
    },
  });

  const createMibConfigMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiRequest("POST", `/api/clients/${selectedClient?.id}/snmp-profiles/${selectedProfile?.id}/mib-configs`, data);
    },
    onSuccess: () => {
      toast({ title: "Configuração MIB criada com sucesso" });
      setMibDialogOpen(false);
      setMibFormData({ name: "", oid: "", dataType: "integer", unit: "", pollInterval: 30, scaleFactor: 1.0 });
    },
    onError: () => {
      toast({ title: "Erro ao criar configuração MIB", variant: "destructive" });
    },
  });

  const handleOpenMibConfig = (profile: any) => {
    setSelectedProfile(profile);
    setMibDialogOpen(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-medium">Configuração SNMP</h2>
          <p className="text-sm text-muted-foreground">
            Gerencie perfis SNMP e configurações MIB por cliente
          </p>
        </div>
        <Select
          value={selectedClient?.id?.toString() || ""}
          onValueChange={(val) => {
            const client = clients.find(c => c.id.toString() === val);
            setSelectedClient(client || null);
          }}
        >
          <SelectTrigger className="w-[280px]" data-testid="select-client-for-snmp">
            <SelectValue placeholder="Selecione um cliente" />
          </SelectTrigger>
          <SelectContent>
            {clients.map((client) => (
              <SelectItem key={client.id} value={client.id.toString()}>
                {client.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!selectedClient ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Selecione um cliente para gerenciar sua configuração SNMP
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">Perfis SNMP</CardTitle>
                <CardDescription>Perfis de configuração SNMP reutilizáveis</CardDescription>
              </div>
              <Dialog open={profileDialogOpen} onOpenChange={(open) => {
                setProfileDialogOpen(open);
                if (!open) {
                  setEditingProfile(null);
                  setProfileFormData({ name: "", description: "", snmpVersion: "v2c", community: "public", port: 161, timeout: 5000, retries: 3 });
                }
              }}>
                <DialogTrigger asChild>
                  <Button size="sm" data-testid="button-add-snmp-profile">
                    <Plus className="w-4 h-4 mr-1" />
                    Novo Perfil
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{editingProfile ? "Editar Perfil SNMP" : "Novo Perfil SNMP"}</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Nome</Label>
                        <Input
                          value={profileFormData.name}
                          onChange={(e) => setProfileFormData({ ...profileFormData, name: e.target.value })}
                          placeholder="Ex: Default v2c"
                          data-testid="input-snmp-profile-name"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Versão SNMP</Label>
                        <Select 
                          value={profileFormData.snmpVersion} 
                          onValueChange={(v) => setProfileFormData({ ...profileFormData, snmpVersion: v })}
                        >
                          <SelectTrigger data-testid="select-snmp-version">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="v1">SNMP v1</SelectItem>
                            <SelectItem value="v2c">SNMP v2c</SelectItem>
                            <SelectItem value="v3">SNMP v3</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Comunidade (v1/v2c)</Label>
                      <Input
                        value={profileFormData.community}
                        onChange={(e) => setProfileFormData({ ...profileFormData, community: e.target.value })}
                        placeholder="public"
                        data-testid="input-snmp-community"
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label>Porta</Label>
                        <Input
                          type="number"
                          value={profileFormData.port}
                          onChange={(e) => setProfileFormData({ ...profileFormData, port: parseInt(e.target.value) || 161 })}
                          data-testid="input-snmp-port"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Timeout (ms)</Label>
                        <Input
                          type="number"
                          value={profileFormData.timeout}
                          onChange={(e) => setProfileFormData({ ...profileFormData, timeout: parseInt(e.target.value) || 5000 })}
                          data-testid="input-snmp-timeout"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Retries</Label>
                        <Input
                          type="number"
                          value={profileFormData.retries}
                          onChange={(e) => setProfileFormData({ ...profileFormData, retries: parseInt(e.target.value) || 3 })}
                          data-testid="input-snmp-retries"
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Descrição</Label>
                      <Input
                        value={profileFormData.description}
                        onChange={(e) => setProfileFormData({ ...profileFormData, description: e.target.value })}
                        placeholder="Descrição do perfil"
                        data-testid="input-snmp-description"
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setProfileDialogOpen(false)}>
                      Cancelar
                    </Button>
                    <Button 
                      onClick={() => createProfileMutation.mutate(profileFormData)}
                      disabled={!profileFormData.name || createProfileMutation.isPending}
                      data-testid="button-save-snmp-profile"
                    >
                      Salvar
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent>
              {profilesLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-16 w-full" />
                </div>
              ) : snmpProfiles && snmpProfiles.length > 0 ? (
                <div className="space-y-2">
                  {snmpProfiles.map((profile) => (
                    <div key={profile.id} className="flex items-center justify-between gap-2 p-3 rounded-md border" data-testid={`row-snmp-profile-${profile.id}`}>
                      <div>
                        <p className="font-medium">{profile.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {profile.snmpVersion} - Comunidade: {profile.community} - Porta: {profile.port}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button size="icon" variant="ghost" onClick={() => handleOpenMibConfig(profile)} data-testid={`button-mib-config-${profile.id}`}>
                          <FileText className="w-4 h-4" />
                        </Button>
                        <Button 
                          size="icon" 
                          variant="ghost" 
                          onClick={() => deleteProfileMutation.mutate(profile.id)}
                          data-testid={`button-delete-snmp-profile-${profile.id}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Nenhum perfil SNMP cadastrado
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <Dialog open={mibDialogOpen} onOpenChange={setMibDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova Configuração MIB - {selectedProfile?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Nome</Label>
                <Input
                  value={mibFormData.name}
                  onChange={(e) => setMibFormData({ ...mibFormData, name: e.target.value })}
                  placeholder="Ex: ifInOctets"
                  data-testid="input-mib-name"
                />
              </div>
              <div className="space-y-2">
                <Label>OID</Label>
                <Input
                  value={mibFormData.oid}
                  onChange={(e) => setMibFormData({ ...mibFormData, oid: e.target.value })}
                  placeholder="1.3.6.1.2.1.2.2.1.10"
                  data-testid="input-mib-oid"
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Tipo de Dados</Label>
                <Select 
                  value={mibFormData.dataType} 
                  onValueChange={(v) => setMibFormData({ ...mibFormData, dataType: v })}
                >
                  <SelectTrigger data-testid="select-mib-datatype">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="integer">Integer</SelectItem>
                    <SelectItem value="counter32">Counter32</SelectItem>
                    <SelectItem value="counter64">Counter64</SelectItem>
                    <SelectItem value="gauge">Gauge</SelectItem>
                    <SelectItem value="string">String</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Unidade</Label>
                <Input
                  value={mibFormData.unit}
                  onChange={(e) => setMibFormData({ ...mibFormData, unit: e.target.value })}
                  placeholder="bps, %, etc."
                  data-testid="input-mib-unit"
                />
              </div>
              <div className="space-y-2">
                <Label>Intervalo (s)</Label>
                <Input
                  type="number"
                  value={mibFormData.pollInterval}
                  onChange={(e) => setMibFormData({ ...mibFormData, pollInterval: parseInt(e.target.value) || 30 })}
                  data-testid="input-mib-interval"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Fator de Escala</Label>
              <Input
                type="number"
                step="0.01"
                value={mibFormData.scaleFactor}
                onChange={(e) => setMibFormData({ ...mibFormData, scaleFactor: parseFloat(e.target.value) || 1.0 })}
                placeholder="1.0"
                data-testid="input-mib-scale"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMibDialogOpen(false)}>
              Cancelar
            </Button>
            <Button 
              onClick={() => createMibConfigMutation.mutate(mibFormData)}
              disabled={!mibFormData.name || !mibFormData.oid || createMibConfigMutation.isPending}
              data-testid="button-save-mib-config"
            >
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function UsersAndGroupsTab({ clients }: { clients: Client[] }) {
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [isSuperAdminMode, setIsSuperAdminMode] = useState(false);
  const { toast } = useToast();

  const { data: groups, isLoading: groupsLoading, refetch: refetchGroups } = useQuery<any[]>({
    queryKey: ['/api/clients', selectedClient?.id, 'groups'],
    enabled: !!selectedClient && !isSuperAdminMode,
  });

  // Query para usuários de clientes
  const { data: clientUsers, isLoading: clientUsersLoading, refetch: refetchClientUsers } = useQuery<User[]>({
    queryKey: ['/api/clients', selectedClient?.id, 'users'],
    enabled: !!selectedClient && !isSuperAdminMode,
  });

  // Query para Super Admins da Marvitel
  const { data: superAdmins, isLoading: superAdminsLoading, refetch: refetchSuperAdmins } = useQuery<User[]>({
    queryKey: ['/api/superadmins'],
    enabled: isSuperAdminMode,
  });

  // Seleciona os usuários corretos baseado no modo
  const users = isSuperAdminMode ? superAdmins : clientUsers;
  const usersLoading = isSuperAdminMode ? superAdminsLoading : clientUsersLoading;
  const refetchUsers = isSuperAdminMode ? refetchSuperAdmins : refetchClientUsers;

  const { data: permissions } = useQuery<any[]>({
    queryKey: ['/api/permissions'],
  });

  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<any>(null);
  const [groupFormData, setGroupFormData] = useState({ name: "", description: "" });
  const [permDialogOpen, setPermDialogOpen] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<any>(null);
  const [selectedPerms, setSelectedPerms] = useState<number[]>([]);
  const [memberDialogOpen, setMemberDialogOpen] = useState(false);

  const [userDialogOpen, setUserDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [userFormData, setUserFormData] = useState({
    name: "",
    email: "",
    password: "",
    role: "operator" as "admin" | "manager" | "operator" | "viewer" | "dashboard",
    isActive: true,
    isSuperAdmin: false,
    sshUser: "",
    sshPassword: "",
  });

  const createGroupMutation = useMutation({
    mutationFn: async (data: { name: string; description: string }) => {
      return apiRequest("POST", `/api/clients/${selectedClient?.id}/groups`, data);
    },
    onSuccess: () => {
      toast({ title: "Grupo criado com sucesso" });
      refetchGroups();
      setGroupDialogOpen(false);
      setGroupFormData({ name: "", description: "" });
    },
    onError: () => {
      toast({ title: "Erro ao criar grupo", variant: "destructive" });
    },
  });

  const updateGroupMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => {
      return apiRequest("PATCH", `/api/clients/${selectedClient?.id}/groups/${id}`, data);
    },
    onSuccess: () => {
      toast({ title: "Grupo atualizado com sucesso" });
      refetchGroups();
      setGroupDialogOpen(false);
      setEditingGroup(null);
    },
    onError: () => {
      toast({ title: "Erro ao atualizar grupo", variant: "destructive" });
    },
  });

  const deleteGroupMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/clients/${selectedClient?.id}/groups/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Grupo excluído com sucesso" });
      refetchGroups();
    },
    onError: () => {
      toast({ title: "Erro ao excluir grupo", variant: "destructive" });
    },
  });

  const setPermissionsMutation = useMutation({
    mutationFn: async ({ groupId, permissionIds }: { groupId: number; permissionIds: number[] }) => {
      return apiRequest("PUT", `/api/clients/${selectedClient?.id}/groups/${groupId}/permissions`, { permissionIds });
    },
    onSuccess: () => {
      toast({ title: "Permissões atualizadas com sucesso" });
      setPermDialogOpen(false);
    },
    onError: () => {
      toast({ title: "Erro ao atualizar permissões", variant: "destructive" });
    },
  });

  const addMemberMutation = useMutation({
    mutationFn: async ({ groupId, userId }: { groupId: number; userId: number }) => {
      return apiRequest("POST", `/api/clients/${selectedClient?.id}/groups/${groupId}/members`, { userId });
    },
    onSuccess: () => {
      toast({ title: "Membro adicionado com sucesso" });
      setMemberDialogOpen(false);
    },
    onError: () => {
      toast({ title: "Erro ao adicionar membro", variant: "destructive" });
    },
  });

  const createUserMutation = useMutation({
    mutationFn: async (data: typeof userFormData & { clientId: number | null }) => {
      return apiRequest("POST", "/api/users", data);
    },
    onSuccess: () => {
      toast({ title: "Usuário criado com sucesso" });
      refetchUsers();
      setUserDialogOpen(false);
      resetUserForm();
    },
    onError: () => {
      toast({ title: "Erro ao criar usuário", variant: "destructive" });
    },
  });

  const updateUserMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<User> }) => {
      return apiRequest("PATCH", `/api/users/${id}`, data);
    },
    onSuccess: () => {
      toast({ title: "Usuário atualizado com sucesso" });
      refetchUsers();
      setUserDialogOpen(false);
      setEditingUser(null);
      resetUserForm();
    },
    onError: () => {
      toast({ title: "Erro ao atualizar usuário", variant: "destructive" });
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/users/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Usuário excluído com sucesso" });
      refetchUsers();
    },
    onError: () => {
      toast({ title: "Erro ao excluir usuário", variant: "destructive" });
    },
  });

  const resetUserForm = () => {
    setUserFormData({
      name: "",
      email: "",
      password: "",
      role: "operator",
      isActive: true,
      isSuperAdmin: false,
      sshUser: "",
      sshPassword: "",
    });
  };

  const handleEditUser = (user: User) => {
    setEditingUser(user);
    setUserFormData({
      name: user.name,
      email: user.email,
      password: "",
      role: user.role as "admin" | "manager" | "operator" | "viewer" | "dashboard",
      isActive: user.isActive,
      isSuperAdmin: user.isSuperAdmin || false,
      sshUser: (user as any).sshUser || "",
      sshPassword: "", // Nunca retorna a senha, só permite sobrescrever
    });
    setUserDialogOpen(true);
  };

  const handleSaveUser = () => {
    if (editingUser) {
      const updateData: Record<string, unknown> = {
        name: userFormData.name,
        email: userFormData.email,
        role: userFormData.role,
        isActive: userFormData.isActive,
        isSuperAdmin: isSuperAdminMode ? true : userFormData.isSuperAdmin,
        sshUser: userFormData.sshUser || null,
      };
      if (userFormData.password) {
        updateData.password = userFormData.password;
      }
      if (userFormData.sshPassword) {
        updateData.sshPassword = userFormData.sshPassword;
      }
      updateUserMutation.mutate({ id: editingUser.id, data: updateData as Partial<User> });
    } else if (isSuperAdminMode) {
      // Criar Super Admin (sem clientId)
      createUserMutation.mutate({
        ...userFormData,
        isSuperAdmin: true,
        clientId: null,
      });
    } else if (selectedClient) {
      createUserMutation.mutate({
        ...userFormData,
        clientId: selectedClient.id,
      });
    }
  };

  const handleEditGroup = (group: any) => {
    setEditingGroup(group);
    setGroupFormData({ name: group.name, description: group.description || "" });
    setGroupDialogOpen(true);
  };

  const handleSaveGroup = () => {
    if (editingGroup) {
      updateGroupMutation.mutate({ id: editingGroup.id, data: groupFormData });
    } else {
      createGroupMutation.mutate(groupFormData);
    }
  };

  const handleOpenPermissions = async (group: any) => {
    setSelectedGroup(group);
    try {
      const response = await fetch(`/api/clients/${selectedClient?.id}/groups/${group.id}/permissions`);
      const perms = await response.json();
      setSelectedPerms(perms.map((p: any) => p.id));
    } catch {
      setSelectedPerms([]);
    }
    setPermDialogOpen(true);
  };

  const handleOpenMembers = (group: any) => {
    setSelectedGroup(group);
    setMemberDialogOpen(true);
  };

  const togglePermission = (permId: number) => {
    setSelectedPerms(prev =>
      prev.includes(permId) ? prev.filter(p => p !== permId) : [...prev, permId]
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-medium">Usuários e Grupos</h2>
          <p className="text-sm text-muted-foreground">
            {isSuperAdminMode 
              ? "Gerencie Super Admins da Marvitel" 
              : "Gerencie usuários e grupos de permissões por cliente"}
          </p>
        </div>
        <Select
          value={isSuperAdminMode ? "superadmins" : (selectedClient?.id?.toString() || "")}
          onValueChange={(val) => {
            if (val === "superadmins") {
              setIsSuperAdminMode(true);
              setSelectedClient(null);
            } else {
              setIsSuperAdminMode(false);
              const client = clients.find(c => c.id.toString() === val);
              setSelectedClient(client || null);
            }
          }}
        >
          <SelectTrigger className="w-[280px]" data-testid="select-client-for-groups">
            <SelectValue placeholder="Selecione um cliente" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="superadmins" className="font-medium text-primary">
              Super Admins Marvitel
            </SelectItem>
            <div className="my-1 border-t" />
            {clients.map((client) => (
              <SelectItem key={client.id} value={client.id.toString()}>
                {client.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!selectedClient && !isSuperAdminMode ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Selecione um cliente ou "Super Admins Marvitel" para gerenciar usuários
          </CardContent>
        </Card>
      ) : isSuperAdminMode ? (
        /* Interface de Super Admins - apenas Card de Usuários */
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base">Super Admins Marvitel</CardTitle>
              <CardDescription>Usuários com acesso total ao painel administrativo</CardDescription>
            </div>
            <Dialog open={userDialogOpen} onOpenChange={(open) => {
              setUserDialogOpen(open);
              if (!open) {
                setEditingUser(null);
                resetUserForm();
              }
            }}>
              <DialogTrigger asChild>
                <Button size="sm" data-testid="button-add-superadmin">
                  <Plus className="w-4 h-4 mr-1" />
                  Novo Super Admin
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{editingUser ? "Editar Super Admin" : "Novo Super Admin"}</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Nome</Label>
                    <Input
                      value={userFormData.name}
                      onChange={(e) => setUserFormData({ ...userFormData, name: e.target.value })}
                      placeholder="Nome completo"
                      data-testid="input-superadmin-name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>E-mail</Label>
                    <Input
                      type="email"
                      value={userFormData.email}
                      onChange={(e) => setUserFormData({ ...userFormData, email: e.target.value })}
                      placeholder="email@marvitel.com.br"
                      data-testid="input-superadmin-email"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{editingUser ? "Nova Senha (deixe vazio para manter)" : "Senha"}</Label>
                    <Input
                      type="password"
                      value={userFormData.password}
                      onChange={(e) => setUserFormData({ ...userFormData, password: e.target.value })}
                      placeholder={editingUser ? "Nova senha (opcional)" : "Senha"}
                      data-testid="input-superadmin-password"
                    />
                  </div>
                  
                  {/* Credenciais SSH do Operador */}
                  <div className="space-y-2 pt-2 border-t">
                    <Label className="text-sm font-medium">Credenciais SSH (para acesso a equipamentos)</Label>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label>Usuario SSH</Label>
                        <Input
                          value={userFormData.sshUser}
                          onChange={(e) => setUserFormData({ ...userFormData, sshUser: e.target.value })}
                          placeholder="usuario"
                          data-testid="input-superadmin-ssh-user"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>{editingUser ? "Senha SSH (vazio mantém)" : "Senha SSH"}</Label>
                        <Input
                          type="password"
                          value={userFormData.sshPassword}
                          onChange={(e) => setUserFormData({ ...userFormData, sshPassword: e.target.value })}
                          placeholder="********"
                          data-testid="input-superadmin-ssh-password"
                        />
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Usado quando o concentrador estiver configurado para "usar credenciais do operador"
                    </p>
                  </div>
                  
                  <div className="space-y-2">
                    <Label>Função</Label>
                    <Select
                      value={userFormData.role}
                      onValueChange={(val) => setUserFormData({ ...userFormData, role: val as "admin" | "manager" | "operator" | "viewer" | "dashboard" })}
                    >
                      <SelectTrigger data-testid="select-superadmin-role">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">Administrador</SelectItem>
                        <SelectItem value="dashboard">Dashboard (Kiosk)</SelectItem>
                        <SelectItem value="viewer">Visualizador</SelectItem>
                      </SelectContent>
                    </Select>
                    {userFormData.role === "dashboard" && (
                      <p className="text-xs text-muted-foreground">
                        Usuário para telas de monitoramento 24/7. Use ?kiosk=true na URL para ativar modo kiosk.
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={userFormData.isActive}
                      onCheckedChange={(checked) => setUserFormData({ ...userFormData, isActive: checked })}
                      data-testid="switch-superadmin-active"
                    />
                    <Label>Ativo</Label>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setUserDialogOpen(false)}>
                    Cancelar
                  </Button>
                  <Button 
                    onClick={handleSaveUser}
                    disabled={!userFormData.name || !userFormData.email || (!editingUser && !userFormData.password) || createUserMutation.isPending || updateUserMutation.isPending}
                    data-testid="button-save-superadmin"
                  >
                    Salvar
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </CardHeader>
          <CardContent>
            {usersLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : users && users.length > 0 ? (
              <div className="space-y-2">
                {users.map((user) => (
                  <div key={user.id} className="flex items-center justify-between gap-2 p-3 rounded-md border" data-testid={`row-superadmin-${user.id}`}>
                    <div className="flex items-center gap-3">
                      <div>
                        <p className="font-medium">{user.name}</p>
                        <p className="text-sm text-muted-foreground">{user.email}</p>
                      </div>
                      <Badge variant={user.isActive ? "default" : "secondary"}>
                        {user.isActive ? "Ativo" : "Inativo"}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="ghost" onClick={() => handleEditUser(user)} data-testid={`button-edit-superadmin-${user.id}`}>
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button 
                        size="icon" 
                        variant="ghost" 
                        onClick={() => deleteUserMutation.mutate(user.id)}
                        data-testid={`button-delete-superadmin-${user.id}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">
                Nenhum Super Admin cadastrado
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">Grupos</CardTitle>
                <CardDescription>Grupos de permissões do cliente</CardDescription>
              </div>
              <Dialog open={groupDialogOpen} onOpenChange={(open) => {
                setGroupDialogOpen(open);
                if (!open) {
                  setEditingGroup(null);
                  setGroupFormData({ name: "", description: "" });
                }
              }}>
                <DialogTrigger asChild>
                  <Button size="sm" data-testid="button-add-group">
                    <Plus className="w-4 h-4 mr-1" />
                    Novo Grupo
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{editingGroup ? "Editar Grupo" : "Novo Grupo"}</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>Nome do Grupo</Label>
                      <Input
                        value={groupFormData.name}
                        onChange={(e) => setGroupFormData({ ...groupFormData, name: e.target.value })}
                        placeholder="Ex: Administradores"
                        data-testid="input-group-name"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Descrição</Label>
                      <Input
                        value={groupFormData.description}
                        onChange={(e) => setGroupFormData({ ...groupFormData, description: e.target.value })}
                        placeholder="Descrição do grupo"
                        data-testid="input-group-description"
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setGroupDialogOpen(false)}>
                      Cancelar
                    </Button>
                    <Button 
                      onClick={handleSaveGroup}
                      disabled={!groupFormData.name || createGroupMutation.isPending || updateGroupMutation.isPending}
                      data-testid="button-save-group"
                    >
                      Salvar
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent>
              {groupsLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : groups && groups.length > 0 ? (
                <div className="space-y-2">
                  {groups.map((group) => (
                    <div key={group.id} className="flex items-center justify-between gap-2 p-3 rounded-md border" data-testid={`row-group-${group.id}`}>
                      <div>
                        <p className="font-medium">{group.name}</p>
                        {group.description && (
                          <p className="text-sm text-muted-foreground">{group.description}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <Button size="icon" variant="ghost" onClick={() => handleOpenMembers(group)} data-testid={`button-group-members-${group.id}`}>
                          <Users className="w-4 h-4" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => handleOpenPermissions(group)} data-testid={`button-group-permissions-${group.id}`}>
                          <Shield className="w-4 h-4" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => handleEditGroup(group)} data-testid={`button-edit-group-${group.id}`}>
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button 
                          size="icon" 
                          variant="ghost" 
                          onClick={() => deleteGroupMutation.mutate(group.id)}
                          data-testid={`button-delete-group-${group.id}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Nenhum grupo cadastrado
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">Usuários</CardTitle>
                <CardDescription>Usuários do cliente selecionado</CardDescription>
              </div>
              <Dialog open={userDialogOpen} onOpenChange={(open) => {
                setUserDialogOpen(open);
                if (!open) {
                  setEditingUser(null);
                  resetUserForm();
                }
              }}>
                <DialogTrigger asChild>
                  <Button size="sm" data-testid="button-add-user">
                    <Plus className="w-4 h-4 mr-1" />
                    Novo Usuário
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{editingUser ? "Editar Usuário" : "Novo Usuário"}</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>Nome</Label>
                      <Input
                        value={userFormData.name}
                        onChange={(e) => setUserFormData({ ...userFormData, name: e.target.value })}
                        placeholder="Nome completo"
                        data-testid="input-user-name"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>E-mail</Label>
                      <Input
                        type="email"
                        value={userFormData.email}
                        onChange={(e) => setUserFormData({ ...userFormData, email: e.target.value })}
                        placeholder="email@exemplo.com"
                        data-testid="input-user-email"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>{editingUser ? "Nova Senha (deixe vazio para manter)" : "Senha"}</Label>
                      <Input
                        type="password"
                        value={userFormData.password}
                        onChange={(e) => setUserFormData({ ...userFormData, password: e.target.value })}
                        placeholder="********"
                        data-testid="input-user-password"
                      />
                    </div>
                    
                    {/* Credenciais SSH do Operador */}
                    <div className="space-y-2 pt-2 border-t">
                      <Label className="text-sm font-medium">Credenciais SSH (para acesso a equipamentos)</Label>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <Label>Usuario SSH</Label>
                          <Input
                            value={userFormData.sshUser}
                            onChange={(e) => setUserFormData({ ...userFormData, sshUser: e.target.value })}
                            placeholder="usuario"
                            data-testid="input-user-ssh-user"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>{editingUser ? "Senha SSH (vazio mantém)" : "Senha SSH"}</Label>
                          <Input
                            type="password"
                            value={userFormData.sshPassword}
                            onChange={(e) => setUserFormData({ ...userFormData, sshPassword: e.target.value })}
                            placeholder="********"
                            data-testid="input-user-ssh-password"
                          />
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Usado quando o concentrador estiver configurado para "usar credenciais do operador"
                      </p>
                    </div>
                    
                    <div className="space-y-2">
                      <Label>Função</Label>
                      <Select
                        value={userFormData.role}
                        onValueChange={(val) => setUserFormData({ ...userFormData, role: val as "admin" | "manager" | "operator" | "viewer" | "dashboard" })}
                      >
                        <SelectTrigger data-testid="select-user-role">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="admin">Administrador</SelectItem>
                          <SelectItem value="manager">Gerente</SelectItem>
                          <SelectItem value="operator">Operador</SelectItem>
                          <SelectItem value="viewer">Visualizador</SelectItem>
                          <SelectItem value="dashboard">Dashboard (Kiosk)</SelectItem>
                        </SelectContent>
                      </Select>
                      {userFormData.role === "dashboard" && (
                        <p className="text-xs text-muted-foreground">
                          Usuário para telas de monitoramento 24/7. Use ?kiosk=true na URL para ativar modo kiosk.
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        <Switch
                          id="user-active"
                          checked={userFormData.isActive}
                          onCheckedChange={(checked) => setUserFormData({ ...userFormData, isActive: checked })}
                          data-testid="switch-user-active"
                        />
                        <Label htmlFor="user-active">Ativo</Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch
                          id="user-super-admin"
                          checked={userFormData.isSuperAdmin}
                          onCheckedChange={(checked) => setUserFormData({ ...userFormData, isSuperAdmin: checked })}
                          data-testid="switch-user-super-admin"
                        />
                        <Label htmlFor="user-super-admin">Super Admin (Marvitel)</Label>
                      </div>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setUserDialogOpen(false)}>
                      Cancelar
                    </Button>
                    <Button 
                      onClick={handleSaveUser}
                      disabled={!userFormData.name || !userFormData.email || (!editingUser && !userFormData.password) || createUserMutation.isPending || updateUserMutation.isPending}
                      data-testid="button-save-user"
                    >
                      Salvar
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent>
              {usersLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : users && users.length > 0 ? (
                <div className="space-y-2">
                  {users.map((user) => (
                    <div key={user.id} className="flex items-center justify-between gap-2 p-3 rounded-md border" data-testid={`row-user-${user.id}`}>
                      <div>
                        <p className="font-medium">
                          {user.name}
                          {user.isSuperAdmin && (
                            <Badge variant="outline" className="ml-2">Super Admin</Badge>
                          )}
                        </p>
                        <p className="text-sm text-muted-foreground">{user.email}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={user.isActive ? "default" : "secondary"}>
                          {user.role === "admin" ? "Admin" : user.role === "manager" ? "Gerente" : user.role === "viewer" ? "Visualizador" : user.role === "dashboard" ? "Dashboard" : "Operador"}
                        </Badge>
                        <Button size="icon" variant="ghost" onClick={() => handleEditUser(user)} data-testid={`button-edit-user-${user.id}`}>
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button 
                          size="icon" 
                          variant="ghost" 
                          onClick={() => deleteUserMutation.mutate(user.id)}
                          data-testid={`button-delete-user-${user.id}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Nenhum usuário cadastrado
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <Dialog open={permDialogOpen} onOpenChange={setPermDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Permissões do Grupo: {selectedGroup?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 max-h-[400px] overflow-auto">
            {permissions?.map((perm) => (
              <div 
                key={perm.id} 
                className="flex items-center gap-3 p-2 rounded-md hover-elevate cursor-pointer"
                onClick={() => togglePermission(perm.id)}
              >
                <div className={`w-4 h-4 rounded border flex items-center justify-center ${selectedPerms.includes(perm.id) ? 'bg-primary border-primary' : 'border-muted-foreground'}`}>
                  {selectedPerms.includes(perm.id) && <CheckCircle className="w-3 h-3 text-primary-foreground" />}
                </div>
                <div>
                  <p className="text-sm font-medium">{perm.name}</p>
                  <p className="text-xs text-muted-foreground">{perm.code}</p>
                </div>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPermDialogOpen(false)}>
              Cancelar
            </Button>
            <Button 
              onClick={() => setPermissionsMutation.mutate({ groupId: selectedGroup?.id, permissionIds: selectedPerms })}
              disabled={setPermissionsMutation.isPending}
              data-testid="button-save-permissions"
            >
              Salvar Permissões
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={memberDialogOpen} onOpenChange={setMemberDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Membros do Grupo: {selectedGroup?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Adicionar Usuário ao Grupo</Label>
              <Select onValueChange={(val) => addMemberMutation.mutate({ groupId: selectedGroup?.id, userId: parseInt(val) })}>
                <SelectTrigger data-testid="select-add-member">
                  <SelectValue placeholder="Selecione um usuário" />
                </SelectTrigger>
                <SelectContent>
                  {users?.map((user) => (
                    <SelectItem key={user.id} value={user.id.toString()}>
                      {user.name} ({user.email})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMemberDialogOpen(false)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SystemSettingsTab() {
  const { toast } = useToast();
  const [settings, setSettings] = useState({
    slaAvailability: 99,
    slaLatency: 80,
    slaPacketLoss: 2,
    slaMaxRepairTime: 6,
    dataRetentionMonths: 6,
    metricsPollingInterval: 5,
    alertsEnabled: true,
    emailNotifications: true,
    slackWebhook: "",
  });

  const handleSave = () => {
    toast({ title: "Configuracoes salvas com sucesso" });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-medium">Configuracoes do Sistema</h2>
        <p className="text-sm text-muted-foreground">
          Parametros globais de SLA, retencao de dados e notificacoes
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Metas de SLA/ANS</CardTitle>
            <CardDescription>
              Defina os niveis de servico acordados com os clientes
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="slaAvailability">Disponibilidade Minima (%)</Label>
                <Input
                  id="slaAvailability"
                  type="number"
                  value={settings.slaAvailability}
                  onChange={(e) => setSettings({ ...settings, slaAvailability: parseFloat(e.target.value) })}
                  data-testid="input-sla-availability"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="slaLatency">Latencia Maxima (ms)</Label>
                <Input
                  id="slaLatency"
                  type="number"
                  value={settings.slaLatency}
                  onChange={(e) => setSettings({ ...settings, slaLatency: parseInt(e.target.value) })}
                  data-testid="input-sla-latency"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="slaPacketLoss">Perda de Pacotes Maxima (%)</Label>
                <Input
                  id="slaPacketLoss"
                  type="number"
                  step="0.1"
                  value={settings.slaPacketLoss}
                  onChange={(e) => setSettings({ ...settings, slaPacketLoss: parseFloat(e.target.value) })}
                  data-testid="input-sla-packet-loss"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="slaMaxRepairTime">Tempo Max Reparo (horas)</Label>
                <Input
                  id="slaMaxRepairTime"
                  type="number"
                  value={settings.slaMaxRepairTime}
                  onChange={(e) => setSettings({ ...settings, slaMaxRepairTime: parseInt(e.target.value) })}
                  data-testid="input-sla-repair-time"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Retencao e Coleta de Dados</CardTitle>
            <CardDescription>
              Configure a retencao de metricas e intervalos de coleta
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="dataRetention">Retencao de Dados (meses)</Label>
                <Input
                  id="dataRetention"
                  type="number"
                  value={settings.dataRetentionMonths}
                  onChange={(e) => setSettings({ ...settings, dataRetentionMonths: parseInt(e.target.value) })}
                  data-testid="input-data-retention"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pollingInterval">Intervalo de Coleta (segundos)</Label>
                <Input
                  id="pollingInterval"
                  type="number"
                  value={settings.metricsPollingInterval}
                  onChange={(e) => setSettings({ ...settings, metricsPollingInterval: parseInt(e.target.value) })}
                  data-testid="input-polling-interval"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Notificacoes</CardTitle>
            <CardDescription>
              Configure alertas e notificacoes do sistema
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Alertas Habilitados</p>
                <p className="text-sm text-muted-foreground">
                  Receba alertas quando limites forem ultrapassados
                </p>
              </div>
              <Switch
                checked={settings.alertsEnabled}
                onCheckedChange={(checked) => setSettings({ ...settings, alertsEnabled: checked })}
                data-testid="switch-alerts-enabled"
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Notificacoes por Email</p>
                <p className="text-sm text-muted-foreground">
                  Envie alertas para email dos responsaveis
                </p>
              </div>
              <Switch
                checked={settings.emailNotifications}
                onCheckedChange={(checked) => setSettings({ ...settings, emailNotifications: checked })}
                data-testid="switch-email-notifications"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="slackWebhook">Webhook Slack (opcional)</Label>
              <Input
                id="slackWebhook"
                value={settings.slackWebhook}
                onChange={(e) => setSettings({ ...settings, slackWebhook: e.target.value })}
                placeholder="https://hooks.slack.com/services/..."
                data-testid="input-slack-webhook"
              />
            </div>
          </CardContent>
        </Card>

        <SystemInfoCard />
      </div>

      <RadiusSettingsCard />
      
      <RadiusGroupMappingsCard />
      
      <MonitoringSettingsCard />
      
      <BackupsCard />

      <div className="flex justify-end">
        <Button onClick={handleSave} data-testid="button-save-system-settings">
          Salvar Configuracoes
        </Button>
      </div>
    </div>
  );
}

interface SystemInfo {
  version: string;
  gitCommit: string;
  gitBranch: string;
  lastUpdate: string;
  githubUrl: string;
  environment: string;
}

function SystemInfoCard() {
  const { toast } = useToast();
  const [githubUrl, setGithubUrl] = useState("");
  const [isUpdating, setIsUpdating] = useState(false);
  const [isSavingUrl, setIsSavingUrl] = useState(false);
  
  const { data: systemInfo, isLoading, refetch } = useQuery<SystemInfo>({
    queryKey: ["/api/system/info"],
  });
  
  useEffect(() => {
    if (systemInfo?.githubUrl) {
      setGithubUrl(systemInfo.githubUrl);
    }
  }, [systemInfo]);
  
  const handleSaveGithubUrl = async () => {
    setIsSavingUrl(true);
    try {
      await apiRequest("POST", "/api/system/github-url", { url: githubUrl });
      toast({ title: "URL do GitHub salva com sucesso" });
      refetch();
    } catch (error: any) {
      toast({ title: "Erro ao salvar URL", description: error.message, variant: "destructive" });
    } finally {
      setIsSavingUrl(false);
    }
  };
  
  const handleUpdate = async () => {
    if (!confirm("Tem certeza que deseja atualizar o sistema? O serviço será reiniciado.")) {
      return;
    }
    
    setIsUpdating(true);
    try {
      const response = await apiRequest("POST", "/api/system/update");
      const data = await response.json();
      toast({ 
        title: "Atualização iniciada", 
        description: data.message || "O sistema será reiniciado em alguns instantes." 
      });
    } catch (error: any) {
      toast({ title: "Erro na atualização", description: error.message, variant: "destructive" });
    } finally {
      setIsUpdating(false);
    }
  };
  
  const formatDate = (dateStr: string) => {
    if (!dateStr) return "N/A";
    try {
      const date = new Date(dateStr);
      return date.toLocaleString("pt-BR");
    } catch {
      return dateStr;
    }
  };
  
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Informações do Sistema</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Informações do Sistema</CardTitle>
        <CardDescription>
          Versão, repositório e atualizações do sistema
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Versão</span>
            <span className="font-mono">{systemInfo?.version || "1.0.0"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Ambiente</span>
            <Badge variant="outline">{systemInfo?.environment || "Produção"}</Badge>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Branch</span>
            <span className="font-mono text-xs">{systemInfo?.gitBranch || "N/A"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Commit</span>
            <span className="font-mono text-xs">{systemInfo?.gitCommit || "N/A"}</span>
          </div>
          <div className="col-span-2 flex justify-between">
            <span className="text-muted-foreground">Última Atualização</span>
            <span className="font-mono text-xs">{formatDate(systemInfo?.lastUpdate || "")}</span>
          </div>
        </div>
        
        <Separator />
        
        <div className="space-y-2">
          <Label>Repositório GitHub</Label>
          <div className="flex gap-2">
            <Input
              placeholder="https://github.com/usuario/repositorio.git"
              value={githubUrl}
              onChange={(e) => setGithubUrl(e.target.value)}
              data-testid="input-github-url"
            />
            <Button 
              variant="outline" 
              size="icon"
              onClick={handleSaveGithubUrl}
              disabled={isSavingUrl}
              data-testid="button-save-github-url"
            >
              {isSavingUrl ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            </Button>
          </div>
        </div>
        
        <div className="flex gap-2 pt-2">
          <Button 
            onClick={handleUpdate} 
            disabled={isUpdating}
            className="flex-1"
            data-testid="button-update-system"
          >
            {isUpdating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Atualizando...
              </>
            ) : (
              <>
                <Download className="mr-2 h-4 w-4" />
                Atualizar Sistema
              </>
            )}
          </Button>
          <Button 
            variant="outline" 
            size="icon"
            onClick={() => refetch()}
            data-testid="button-refresh-system-info"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

interface Backup {
  name: string;
  path: string;
  size: number;
  sizeFormatted: string;
  createdAt: string;
}

function BackupsCard() {
  const { toast } = useToast();
  const [isRestoring, setIsRestoring] = useState<string | null>(null);
  
  const { data: backupsData, isLoading, refetch } = useQuery<{ backups: Backup[]; message?: string }>({
    queryKey: ["/api/system/backups"],
  });
  
  const handleRestore = async (backupName: string) => {
    if (!confirm(`Tem certeza que deseja restaurar o backup "${backupName}"? Isso pode sobrescrever dados atuais.`)) {
      return;
    }
    
    setIsRestoring(backupName);
    try {
      const response = await apiRequest("POST", "/api/system/backups/restore", { backupName });
      const data = await response.json();
      toast({ title: "Backup restaurado", description: data.message });
      refetch();
    } catch (error: any) {
      toast({ title: "Erro ao restaurar", description: error.message, variant: "destructive" });
    } finally {
      setIsRestoring(null);
    }
  };
  
  const formatDate = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      return date.toLocaleString("pt-BR");
    } catch {
      return dateStr;
    }
  };
  
  const backups = Array.isArray(backupsData?.backups) ? backupsData.backups : [];
  
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <div>
          <CardTitle className="text-base">Backups do Sistema</CardTitle>
          <CardDescription>
            Arquivos de backup disponíveis em /opt/link-monitor-backups/
          </CardDescription>
        </div>
        <Button variant="outline" size="icon" onClick={() => refetch()} data-testid="button-refresh-backups">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : backups.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground">
            <Database className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>Nenhum backup encontrado</p>
            <p className="text-xs mt-1">Coloque arquivos .sql, .tar.gz ou .backup no diretório de backups</p>
          </div>
        ) : (
          <div className="space-y-2">
            {backups.map((backup) => (
              <div 
                key={backup.name} 
                className="flex items-center justify-between p-3 rounded-lg border bg-muted/30"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Database className="h-5 w-5 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{backup.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {backup.sizeFormatted} • {formatDate(backup.createdAt)}
                    </p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleRestore(backup.name)}
                  disabled={isRestoring === backup.name}
                  data-testid={`button-restore-${backup.name}`}
                >
                  {isRestoring === backup.name ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <RefreshCw className="h-4 w-4 mr-1" />
                      Restaurar
                    </>
                  )}
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface RadiusSettingsData {
  configured: boolean;
  isEnabled: boolean;
  primaryHost: string;
  primaryPort: number;
  secondaryHost?: string | null;
  secondaryPort?: number | null;
  nasIdentifier?: string | null;
  timeout: number;
  retries: number;
  allowLocalFallback: boolean;
  lastHealthCheck?: string | null;
  lastHealthStatus?: string | null;
}

function RadiusSettingsCard() {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  
  const [formData, setFormData] = useState({
    isEnabled: false,
    primaryHost: "",
    primaryPort: 1812,
    sharedSecret: "",
    secondaryHost: "",
    secondaryPort: 1812,
    secondarySecret: "",
    nasIdentifier: "LinkMonitor",
    timeout: 5000,
    retries: 3,
    allowLocalFallback: true,
  });

  const { data: radiusSettings, isLoading, refetch } = useQuery<RadiusSettingsData>({
    queryKey: ["/api/radius/settings"],
  });

  useEffect(() => {
    if (radiusSettings && radiusSettings.configured) {
      setFormData(prev => ({
        ...prev,
        isEnabled: radiusSettings.isEnabled,
        primaryHost: radiusSettings.primaryHost || "",
        primaryPort: radiusSettings.primaryPort || 1812,
        secondaryHost: radiusSettings.secondaryHost || "",
        secondaryPort: radiusSettings.secondaryPort || 1812,
        nasIdentifier: radiusSettings.nasIdentifier || "LinkMonitor",
        timeout: radiusSettings.timeout || 5000,
        retries: radiusSettings.retries || 3,
        allowLocalFallback: radiusSettings.allowLocalFallback ?? true,
      }));
    }
  }, [radiusSettings]);

  const handleSave = async () => {
    if (!formData.primaryHost) {
      toast({ title: "Host do servidor RADIUS e obrigatorio", variant: "destructive" });
      return;
    }
    if (!formData.sharedSecret && !radiusSettings?.configured) {
      toast({ title: "Shared secret e obrigatorio", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      await apiRequest("POST", "/api/radius/settings", formData);
      toast({ title: "Configuracoes RADIUS salvas com sucesso" });
      refetch();
      setFormData(prev => ({ ...prev, sharedSecret: "", secondarySecret: "" }));
    } catch (error: any) {
      toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!formData.primaryHost) {
      toast({ title: "Preencha o host do servidor RADIUS", variant: "destructive" });
      return;
    }
    
    if (!formData.sharedSecret && !radiusSettings?.configured) {
      toast({ title: "Preencha o shared secret para testar", variant: "destructive" });
      return;
    }

    setTesting(true);
    try {
      const endpoint = formData.sharedSecret 
        ? "/api/radius/test" 
        : "/api/radius/test-saved";
      
      const payload = formData.sharedSecret 
        ? {
            host: formData.primaryHost,
            port: formData.primaryPort,
            sharedSecret: formData.sharedSecret,
            nasIdentifier: formData.nasIdentifier,
          }
        : {};
      
      const response = await apiRequest("POST", endpoint, payload);
      const result = await response.json();
      
      if (result.success) {
        toast({ title: "Conexao RADIUS bem-sucedida", description: result.message });
      } else {
        toast({ title: "Falha na conexao RADIUS", description: result.message, variant: "destructive" });
      }
      refetch();
    } catch (error: any) {
      toast({ title: "Erro ao testar conexao", description: error.message, variant: "destructive" });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Autenticacao RADIUS
            </CardTitle>
            <CardDescription>
              Configure autenticacao RADIUS para usuarios super admin
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {radiusSettings?.lastHealthStatus && (
              <Badge variant={radiusSettings.lastHealthStatus === "online" ? "default" : "destructive"}>
                {radiusSettings.lastHealthStatus === "online" ? "Online" : radiusSettings.lastHealthStatus}
              </Badge>
            )}
            <Switch
              checked={formData.isEnabled}
              onCheckedChange={(checked) => setFormData({ ...formData, isEnabled: checked })}
              data-testid="switch-radius-enabled"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="radiusHost">Servidor RADIUS (IP/Host)</Label>
            <Input
              id="radiusHost"
              value={formData.primaryHost}
              onChange={(e) => setFormData({ ...formData, primaryHost: e.target.value })}
              placeholder="100.66.128.78"
              data-testid="input-radius-host"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="radiusPort">Porta</Label>
            <Input
              id="radiusPort"
              type="number"
              value={formData.primaryPort}
              onChange={(e) => setFormData({ ...formData, primaryPort: parseInt(e.target.value) || 1812 })}
              placeholder="1812"
              data-testid="input-radius-port"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="radiusSecret">Shared Secret</Label>
          <div className="flex gap-2">
            <Input
              id="radiusSecret"
              type={showSecret ? "text" : "password"}
              value={formData.sharedSecret}
              onChange={(e) => setFormData({ ...formData, sharedSecret: e.target.value })}
              placeholder={radiusSettings?.configured ? "••••••••••••" : "Informe o shared secret"}
              data-testid="input-radius-secret"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => setShowSecret(!showSecret)}
            >
              {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
          </div>
          {radiusSettings?.configured && (
            <p className="text-xs text-muted-foreground">
              Deixe em branco para manter o secret atual
            </p>
          )}
        </div>

        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-between p-0 h-auto hover:bg-transparent">
              <span className="text-sm font-medium">Servidor Secundario (opcional)</span>
              <ChevronDown className="h-4 w-4" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="radiusSecondaryHost">Servidor Secundario (IP/Host)</Label>
                <Input
                  id="radiusSecondaryHost"
                  value={formData.secondaryHost}
                  onChange={(e) => setFormData({ ...formData, secondaryHost: e.target.value })}
                  placeholder="Opcional"
                  data-testid="input-radius-secondary-host"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="radiusSecondaryPort">Porta Secundaria</Label>
                <Input
                  id="radiusSecondaryPort"
                  type="number"
                  value={formData.secondaryPort}
                  onChange={(e) => setFormData({ ...formData, secondaryPort: parseInt(e.target.value) || 1812 })}
                  placeholder="1812"
                  data-testid="input-radius-secondary-port"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="radiusSecondarySecret">Shared Secret Secundario</Label>
              <Input
                id="radiusSecondarySecret"
                type="password"
                value={formData.secondarySecret}
                onChange={(e) => setFormData({ ...formData, secondarySecret: e.target.value })}
                placeholder={radiusSettings?.configured && radiusSettings.secondaryHost ? "••••••••••••" : "Opcional"}
                data-testid="input-radius-secondary-secret"
              />
            </div>
          </CollapsibleContent>
        </Collapsible>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label htmlFor="nasIdentifier">NAS Identifier</Label>
            <Input
              id="nasIdentifier"
              value={formData.nasIdentifier}
              onChange={(e) => setFormData({ ...formData, nasIdentifier: e.target.value })}
              placeholder="LinkMonitor"
              data-testid="input-nas-identifier"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="radiusTimeout">Timeout (ms)</Label>
            <Input
              id="radiusTimeout"
              type="number"
              value={formData.timeout}
              onChange={(e) => setFormData({ ...formData, timeout: parseInt(e.target.value) || 5000 })}
              placeholder="5000"
              data-testid="input-radius-timeout"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="radiusRetries">Tentativas</Label>
            <Input
              id="radiusRetries"
              type="number"
              value={formData.retries}
              onChange={(e) => setFormData({ ...formData, retries: parseInt(e.target.value) || 3 })}
              placeholder="3"
              data-testid="input-radius-retries"
            />
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium">Fallback para autenticacao local</p>
            <p className="text-sm text-muted-foreground">
              Permite login com senha local se RADIUS estiver indisponivel
            </p>
          </div>
          <Switch
            checked={formData.allowLocalFallback}
            onCheckedChange={(checked) => setFormData({ ...formData, allowLocalFallback: checked })}
            data-testid="switch-radius-fallback"
          />
        </div>

        {radiusSettings?.lastHealthCheck && (
          <div className="text-xs text-muted-foreground">
            Ultima verificacao: {new Date(radiusSettings.lastHealthCheck).toLocaleString("pt-BR")}
          </div>
        )}
      </CardContent>
      <CardFooter className="flex justify-between gap-2">
        <Button
          variant="outline"
          onClick={handleTest}
          disabled={testing || !formData.primaryHost || (!formData.sharedSecret && !radiusSettings?.configured)}
          data-testid="button-test-radius"
        >
          {testing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          Testar Conexao
        </Button>
        <Button
          onClick={handleSave}
          disabled={saving}
          data-testid="button-save-radius"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
          Salvar Configuracoes
        </Button>
      </CardFooter>
    </Card>
  );
}

interface RadiusGroupMapping {
  id: number;
  radiusGroupName: string;
  isSuperAdmin: boolean;
  canManageSuperAdmins: boolean;
  defaultRole: string;
  description: string | null;
  priority: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

function RadiusGroupMappingsCard() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingMapping, setEditingMapping] = useState<RadiusGroupMapping | null>(null);
  const [formData, setFormData] = useState({
    radiusGroupName: "",
    isSuperAdmin: true,
    canManageSuperAdmins: false,
    defaultRole: "admin",
    description: "",
    priority: 50,
    isActive: true,
  });

  const { data: mappings, isLoading, refetch } = useQuery<RadiusGroupMapping[]>({
    queryKey: ["/api/radius/group-mappings"],
  });

  const resetForm = () => {
    setFormData({
      radiusGroupName: "",
      isSuperAdmin: true,
      canManageSuperAdmins: false,
      defaultRole: "admin",
      description: "",
      priority: 50,
      isActive: true,
    });
    setEditingMapping(null);
  };

  const handleEdit = (mapping: RadiusGroupMapping) => {
    setEditingMapping(mapping);
    setFormData({
      radiusGroupName: mapping.radiusGroupName,
      isSuperAdmin: mapping.isSuperAdmin,
      canManageSuperAdmins: mapping.canManageSuperAdmins,
      defaultRole: mapping.defaultRole,
      description: mapping.description || "",
      priority: mapping.priority,
      isActive: mapping.isActive,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formData.radiusGroupName.trim()) {
      toast({ title: "Nome do grupo e obrigatorio", variant: "destructive" });
      return;
    }

    try {
      if (editingMapping) {
        await apiRequest("PATCH", `/api/radius/group-mappings/${editingMapping.id}`, formData);
        toast({ title: "Mapeamento atualizado com sucesso" });
      } else {
        await apiRequest("POST", "/api/radius/group-mappings", formData);
        toast({ title: "Mapeamento criado com sucesso" });
      }
      setDialogOpen(false);
      resetForm();
      refetch();
    } catch (error: any) {
      toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Tem certeza que deseja excluir este mapeamento?")) return;

    try {
      await apiRequest("DELETE", `/api/radius/group-mappings/${id}`);
      toast({ title: "Mapeamento excluido com sucesso" });
      refetch();
    } catch (error: any) {
      toast({ title: "Erro ao excluir", description: error.message, variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-5 w-5" />
              Mapeamento de Grupos RADIUS/AD
            </CardTitle>
            <CardDescription>
              Configure permissoes baseadas em grupos do Active Directory
            </CardDescription>
          </div>
          <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) resetForm(); }}>
            <DialogTrigger asChild>
              <Button size="sm" data-testid="button-add-radius-mapping">
                <Plus className="h-4 w-4 mr-1" />
                Novo Mapeamento
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editingMapping ? "Editar Mapeamento" : "Novo Mapeamento"}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="radiusGroupName">Nome do Grupo AD/RADIUS</Label>
                  <Input
                    id="radiusGroupName"
                    value={formData.radiusGroupName}
                    onChange={(e) => setFormData({ ...formData, radiusGroupName: e.target.value })}
                    placeholder="Ex: MT-Full-Admin, MT-Write"
                    data-testid="input-radius-group-name"
                  />
                  <p className="text-xs text-muted-foreground">
                    Nome exato do grupo retornado pelo NPS via Filter-Id ou Class attribute
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="priority">Prioridade</Label>
                    <Input
                      id="priority"
                      type="number"
                      value={formData.priority}
                      onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value) || 50 })}
                      placeholder="50"
                      data-testid="input-mapping-priority"
                    />
                    <p className="text-xs text-muted-foreground">
                      Maior prioridade prevalece quando usuario pertence a multiplos grupos
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="defaultRole">Role Padrao</Label>
                    <Select
                      value={formData.defaultRole}
                      onValueChange={(value) => setFormData({ ...formData, defaultRole: value })}
                    >
                      <SelectTrigger data-testid="select-default-role">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">Admin</SelectItem>
                        <SelectItem value="viewer">Viewer</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">Super Admin</p>
                      <p className="text-sm text-muted-foreground">
                        Acesso ao Painel Marvitel
                      </p>
                    </div>
                    <Switch
                      checked={formData.isSuperAdmin}
                      onCheckedChange={(checked) => setFormData({ ...formData, isSuperAdmin: checked })}
                      data-testid="switch-is-super-admin"
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">Pode Gerenciar Super Admins</p>
                      <p className="text-sm text-muted-foreground">
                        Pode alterar permissoes de outros super admins
                      </p>
                    </div>
                    <Switch
                      checked={formData.canManageSuperAdmins}
                      onCheckedChange={(checked) => setFormData({ ...formData, canManageSuperAdmins: checked })}
                      data-testid="switch-can-manage-super-admins"
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">Ativo</p>
                      <p className="text-sm text-muted-foreground">
                        Mapeamento habilitado
                      </p>
                    </div>
                    <Switch
                      checked={formData.isActive}
                      onCheckedChange={(checked) => setFormData({ ...formData, isActive: checked })}
                      data-testid="switch-mapping-active"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description">Descricao (opcional)</Label>
                  <Input
                    id="description"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="Descricao do mapeamento"
                    data-testid="input-mapping-description"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => { setDialogOpen(false); resetForm(); }}>
                  Cancelar
                </Button>
                <Button onClick={handleSave} data-testid="button-save-mapping">
                  {editingMapping ? "Atualizar" : "Criar"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : mappings && mappings.length > 0 ? (
          <div className="space-y-2">
            {mappings.sort((a, b) => b.priority - a.priority).map((mapping) => (
              <div
                key={mapping.id}
                className="flex items-center justify-between p-3 rounded-lg border bg-card"
              >
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${mapping.isActive ? "bg-green-500" : "bg-gray-400"}`} />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{mapping.radiusGroupName}</span>
                      <Badge variant="outline" className="text-xs">
                        Prioridade: {mapping.priority}
                      </Badge>
                      {mapping.isSuperAdmin && (
                        <Badge variant="default" className="text-xs">
                          Super Admin
                        </Badge>
                      )}
                      {mapping.canManageSuperAdmins && (
                        <Badge variant="secondary" className="text-xs">
                          Gerencia Admins
                        </Badge>
                      )}
                    </div>
                    {mapping.description && (
                      <p className="text-sm text-muted-foreground">{mapping.description}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => handleEdit(mapping)}
                    data-testid={`button-edit-mapping-${mapping.id}`}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => handleDelete(mapping.id)}
                    data-testid={`button-delete-mapping-${mapping.id}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-6 text-muted-foreground">
            <Users className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>Nenhum mapeamento configurado</p>
            <p className="text-sm">Crie mapeamentos para autorizar usuarios baseado em grupos AD</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MonitoringSettingsCard() {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  
  const { data: monitoringSettings, isLoading, refetch } = useQuery<Array<{ id: number; key: string; value: string; description: string | null }>>({
    queryKey: ["/api/monitoring-settings"],
  });

  const [localSettings, setLocalSettings] = useState<Record<string, string>>({});

  useEffect(() => {
    if (monitoringSettings) {
      const map: Record<string, string> = {};
      monitoringSettings.forEach(s => { map[s.key] = s.value; });
      setLocalSettings(map);
    }
  }, [monitoringSettings]);

  const handleChange = (key: string, value: string) => {
    setLocalSettings(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      for (const [key, value] of Object.entries(localSettings)) {
        await apiRequest("PUT", `/api/monitoring-settings/${key}`, { value });
      }
      toast({ title: "Configuracoes de monitoramento salvas" });
      refetch();
    } catch (error: any) {
      toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleInitialize = async () => {
    try {
      await apiRequest("POST", "/api/monitoring-settings/initialize", {});
      toast({ title: "Configuracoes inicializadas" });
      refetch();
    } catch (error: any) {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
    }
  };

  if (isLoading) {
    return (
      <Card className="col-span-2">
        <CardContent className="p-6">
          <div className="flex items-center gap-2">
            <RefreshCw className="w-4 h-4 animate-spin" />
            <span>Carregando configuracoes...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  const settingsConfig = [
    { key: "packet_loss_window_cycles", label: "Janela Media Movel (ciclos)", help: "Numero de ciclos para calcular media (ex: 10 = 5 min)" },
    { key: "packet_loss_threshold_pct", label: "Limite Perda de Pacotes (%)", help: "Percentual acima do qual gera alerta" },
    { key: "packet_loss_persistence_cycles", label: "Persistencia (ciclos)", help: "Ciclos consecutivos acima do limite para alertar" },
  ];

  return (
    <Card className="col-span-2">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Activity className="w-4 h-4" />
          Alertas de Media Movel (Perda de Pacotes)
        </CardTitle>
        <CardDescription>
          Configure a media movel e regra de persistencia para evitar alarmes falsos.
          Com 5 pacotes de ping, cada pacote perdido = 20%. A media movel suaviza variacoes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {(!monitoringSettings || monitoringSettings.length === 0) ? (
          <div className="text-center py-4">
            <p className="text-muted-foreground mb-4">Nenhuma configuracao encontrada.</p>
            <Button onClick={handleInitialize} variant="outline" data-testid="button-initialize-monitoring">
              Inicializar Configuracoes Padrao
            </Button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {settingsConfig.map(cfg => (
                <div key={cfg.key} className="space-y-2">
                  <Label htmlFor={cfg.key}>{cfg.label}</Label>
                  <Input
                    id={cfg.key}
                    type="number"
                    value={localSettings[cfg.key] || ""}
                    onChange={(e) => handleChange(cfg.key, e.target.value)}
                    data-testid={`input-${cfg.key}`}
                  />
                  <p className="text-xs text-muted-foreground">{cfg.help}</p>
                </div>
              ))}
            </div>
            <div className="flex justify-end pt-4">
              <Button onClick={handleSave} disabled={saving} data-testid="button-save-monitoring">
                {saving ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : null}
                Salvar Configuracoes de Alerta
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function OltsTab({ clients }: { clients: Client[] }) {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingOlt, setEditingOlt] = useState<Olt | undefined>(undefined);
  const [showPassword, setShowPassword] = useState<Record<number, boolean>>({});
  const [testingConnection, setTestingConnection] = useState<number | null>(null);
  const [testingSnmp, setTestingSnmp] = useState<number | null>(null);

  const { data: oltsList, isLoading } = useQuery<Olt[]>({
    queryKey: ["/api/olts"],
  });

  // Buscar perfis SNMP globais (de todos os clientes) para associar à OLT
  const { data: allSnmpProfiles } = useQuery<Array<{ id: number; name: string; clientId: number }>>({
    queryKey: ["/api/snmp-profiles"],
  });

  const [formData, setFormData] = useState({
    name: "",
    ipAddress: "",
    port: 23,
    username: "",
    password: "",
    connectionType: "telnet",
    vendor: "datacom",
    model: "",
    database: "",
    searchOnuCommand: "",
    diagnosisKeyTemplate: "",
    snmpProfileId: null as number | null,
    isActive: true,
    voalleId: null as number | null,
  });

  const resetForm = () => {
    setFormData({
      name: "",
      ipAddress: "",
      port: 23,
      username: "",
      password: "",
      connectionType: "telnet",
      vendor: "datacom",
      model: "",
      database: "",
      searchOnuCommand: "",
      diagnosisKeyTemplate: "",
      snmpProfileId: null,
      isActive: true,
      voalleId: null,
    });
    setEditingOlt(undefined);
  };

  const handleEdit = (olt: Olt) => {
    setEditingOlt(olt);
    setFormData({
      name: olt.name,
      ipAddress: olt.ipAddress,
      port: olt.port,
      username: olt.username,
      password: olt.password,
      connectionType: olt.connectionType,
      vendor: olt.vendor || "datacom",
      model: olt.model || "",
      database: olt.database || "",
      searchOnuCommand: (olt as any).searchOnuCommand || "",
      diagnosisKeyTemplate: (olt as any).diagnosisKeyTemplate || "",
      snmpProfileId: (olt as any).snmpProfileId || null,
      isActive: olt.isActive,
      voalleId: (olt as any).voalleId || null,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    try {
      if (editingOlt) {
        await apiRequest("PATCH", `/api/olts/${editingOlt.id}`, formData);
        toast({ title: "OLT atualizada com sucesso" });
      } else {
        await apiRequest("POST", "/api/olts", formData);
        toast({ title: "OLT criada com sucesso" });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/olts"] });
      setDialogOpen(false);
      resetForm();
    } catch (error) {
      toast({ title: "Erro ao salvar OLT", variant: "destructive" });
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Tem certeza que deseja excluir esta OLT?")) return;
    try {
      await apiRequest("DELETE", `/api/olts/${id}`);
      toast({ title: "OLT excluida com sucesso" });
      queryClient.invalidateQueries({ queryKey: ["/api/olts"] });
    } catch (error) {
      toast({ title: "Erro ao excluir OLT", variant: "destructive" });
    }
  };

  const handleTestConnection = async (oltId: number) => {
    setTestingConnection(oltId);
    try {
      const response = await apiRequest("POST", `/api/olts/${oltId}/test`);
      const result = await response.json();
      if (result.success) {
        toast({ title: "Conexao bem-sucedida", description: result.message });
      } else {
        toast({ title: "Falha na conexao", description: result.message, variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Erro ao testar conexao", variant: "destructive" });
    } finally {
      setTestingConnection(null);
    }
  };

  const handleTestSnmp = async (oltId: number) => {
    setTestingSnmp(oltId);
    try {
      const response = await apiRequest("POST", `/api/olts/${oltId}/test-snmp`);
      const result = await response.json();
      if (result.success) {
        const desc = result.sysDescr ? result.sysDescr.substring(0, 80) : "";
        toast({ 
          title: "SNMP OK", 
          description: `${result.sysName || "Equipamento"} - ${result.uptime || ""} (${result.responseTime}ms)${desc ? `\n${desc}` : ""}` 
        });
      } else {
        toast({ 
          title: "Falha SNMP", 
          description: result.error || "Sem resposta", 
          variant: "destructive" 
        });
      }
    } catch (error) {
      toast({ title: "Erro ao testar SNMP", variant: "destructive" });
    } finally {
      setTestingSnmp(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-medium">OLTs Cadastradas</h2>
          <p className="text-sm text-muted-foreground">
            Gerencie as OLTs para diagnostico automatico de alarmes
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) resetForm();
        }}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-olt">
              <Plus className="w-4 h-4 mr-2" />
              Adicionar OLT
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{editingOlt ? "Editar OLT" : "Nova OLT"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="olt-name">Nome</Label>
                <Input
                  id="olt-name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Ex: OLT-CENTRO-01"
                  data-testid="input-olt-name"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="olt-ip">Endereco IP</Label>
                  <Input
                    id="olt-ip"
                    value={formData.ipAddress}
                    onChange={(e) => setFormData({ ...formData, ipAddress: e.target.value })}
                    placeholder="192.168.1.1"
                    data-testid="input-olt-ip"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="olt-port">Porta</Label>
                  <Input
                    id="olt-port"
                    type="number"
                    value={formData.port}
                    onChange={(e) => setFormData({ ...formData, port: parseInt(e.target.value, 10) || 23 })}
                    data-testid="input-olt-port"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="olt-connection">Tipo de Conexao</Label>
                <Select
                  value={formData.connectionType}
                  onValueChange={(v) => setFormData({ 
                    ...formData, 
                    connectionType: v, 
                    port: v === "ssh" ? 22 : v === "mysql" ? 3306 : 23,
                    vendor: v === "mysql" ? "zabbix" : formData.vendor
                  })}
                >
                  <SelectTrigger data-testid="select-olt-connection">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="telnet">Telnet</SelectItem>
                    <SelectItem value="ssh">SSH</SelectItem>
                    <SelectItem value="mysql">MySQL (Zabbix)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              {formData.connectionType === "mysql" && (
                <div className="space-y-2">
                  <Label htmlFor="olt-database">Nome do Banco</Label>
                  <Input
                    id="olt-database"
                    value={formData.database}
                    onChange={(e) => setFormData({ ...formData, database: e.target.value })}
                    placeholder="db_django_olts"
                    data-testid="input-olt-database"
                  />
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="olt-username">Usuario</Label>
                  <Input
                    id="olt-username"
                    value={formData.username}
                    onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                    data-testid="input-olt-username"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="olt-password">Senha</Label>
                  <Input
                    id="olt-password"
                    type="password"
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    data-testid="input-olt-password"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="olt-vendor">Fabricante</Label>
                  <Select
                    value={formData.vendor}
                    onValueChange={(v) => setFormData({ ...formData, vendor: v })}
                  >
                    <SelectTrigger data-testid="select-olt-vendor">
                      <SelectValue placeholder="Selecione..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="datacom">Datacom</SelectItem>
                      <SelectItem value="zte">ZTE</SelectItem>
                      <SelectItem value="furukawa">Furukawa</SelectItem>
                      <SelectItem value="intelbras">Intelbras</SelectItem>
                      <SelectItem value="tplink">TP-Link</SelectItem>
                      <SelectItem value="huawei">Huawei</SelectItem>
                      <SelectItem value="nokia">Nokia</SelectItem>
                      <SelectItem value="fiberhome">Fiberhome</SelectItem>
                      <SelectItem value="zabbix">Zabbix (MySQL)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="olt-model">Modelo</Label>
                  <Input
                    id="olt-model"
                    value={formData.model}
                    onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                    placeholder="Ex: DM4610, C650"
                    data-testid="input-olt-model"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="olt-voalle-id">ID Voalle (Access Point)</Label>
                <Input
                  id="olt-voalle-id"
                  type="number"
                  value={formData.voalleId ?? ""}
                  onChange={(e) => setFormData({ ...formData, voalleId: e.target.value ? parseInt(e.target.value, 10) : null })}
                  placeholder="Ex: 123"
                  data-testid="input-olt-voalle-id"
                />
                <p className="text-xs text-muted-foreground">
                  ID do authenticationAccessPoint no Voalle para associacao automatica com etiquetas de contrato
                </p>
              </div>
              
              <div className="border-t pt-4 mt-4">
                <h4 className="font-medium mb-2">Templates de Busca e Diagnostico</h4>
                <p className="text-xs text-muted-foreground mb-3">
                  Variaveis disponiveis: <code className="bg-muted px-1 rounded">{"{serial}"}</code> <code className="bg-muted px-1 rounded">{"{slot}"}</code> <code className="bg-muted px-1 rounded">{"{port}"}</code> <code className="bg-muted px-1 rounded">{"{onuId}"}</code>
                </p>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="olt-search-command">Comando de Busca de ID da ONU</Label>
                    <Input
                      id="olt-search-command"
                      value={formData.searchOnuCommand}
                      onChange={(e) => setFormData({ ...formData, searchOnuCommand: e.target.value })}
                      placeholder="Ex: sh onu serial {serial}"
                      data-testid="input-olt-search-command"
                    />
                    <p className="text-xs text-muted-foreground">
                      Comando SSH/Telnet para buscar o ID da ONU pelo serial
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="olt-diagnosis-template">Template de Chave de Diagnostico</Label>
                    <Input
                      id="olt-diagnosis-template"
                      value={formData.diagnosisKeyTemplate}
                      onChange={(e) => setFormData({ ...formData, diagnosisKeyTemplate: e.target.value })}
                      placeholder="Ex: 1/{slot}/{port}/{onuId} ou {serial}"
                      data-testid="input-olt-diagnosis-template"
                    />
                    <p className="text-xs text-muted-foreground">
                      Formato da chave usada para diagnostico de alarmes
                    </p>
                  </div>
                </div>
              </div>
              
              <div className="border-t pt-4 mt-4">
                <h4 className="font-medium mb-2">Configuracoes SNMP (Sinal Optico)</h4>
                <p className="text-xs text-muted-foreground mb-3">
                  Selecione um perfil SNMP para coleta de sinal optico das ONUs conectadas a esta OLT
                </p>
                <div className="space-y-2">
                  <Label htmlFor="olt-snmp-profile">Perfil SNMP</Label>
                  <Select
                    value={formData.snmpProfileId?.toString() || "none"}
                    onValueChange={(v) => setFormData({ ...formData, snmpProfileId: v && v !== "none" ? parseInt(v, 10) : null })}
                  >
                    <SelectTrigger data-testid="select-olt-snmp-profile">
                      <SelectValue placeholder="Selecione um perfil SNMP..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Nenhum</SelectItem>
                      {allSnmpProfiles?.map((profile) => (
                        <SelectItem key={profile.id} value={profile.id.toString()}>
                          {profile.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Perfis SNMP sao cadastrados por cliente em Admin → Clientes → Perfis SNMP
                  </p>
                </div>
                {!formData.snmpProfileId && (
                  <div className="mt-3 p-3 bg-amber-50 dark:bg-amber-950/30 rounded-md border border-amber-200 dark:border-amber-800">
                    <p className="text-sm text-amber-700 dark:text-amber-300">
                      Sem perfil SNMP configurado, a coleta de sinal optico nao funcionara para links desta OLT.
                    </p>
                  </div>
                )}
              </div>
              
              <div className="flex items-center justify-between">
                <Label htmlFor="olt-active">Ativo</Label>
                <Switch
                  id="olt-active"
                  checked={formData.isActive}
                  onCheckedChange={(checked) => setFormData({ ...formData, isActive: checked })}
                  data-testid="switch-olt-active"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setDialogOpen(false); resetForm(); }}>
                Cancelar
              </Button>
              <Button onClick={handleSave} data-testid="button-save-olt">
                {editingOlt ? "Salvar" : "Criar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {oltsList?.map((olt) => (
            <Card key={olt.id}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="p-2 rounded-md bg-primary/10">
                      <Radio className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{olt.name}</span>
                        <Badge variant={olt.isActive ? "default" : "secondary"}>
                          {olt.isActive ? "Ativo" : "Inativo"}
                        </Badge>
                        <Badge variant="outline">{olt.connectionType.toUpperCase()}</Badge>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {olt.ipAddress}:{olt.port}
                        {olt.vendor && ` - ${olt.vendor.charAt(0).toUpperCase() + olt.vendor.slice(1)}`}
                        {olt.model && ` ${olt.model}`}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowPassword({ ...showPassword, [olt.id]: !showPassword[olt.id] })}
                      data-testid={`button-toggle-password-${olt.id}`}
                    >
                      {showPassword[olt.id] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleTestConnection(olt.id)}
                      disabled={testingConnection === olt.id}
                      title="Testar conexao SSH/Telnet"
                      data-testid={`button-test-olt-${olt.id}`}
                    >
                      {testingConnection === olt.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <RefreshCw className="w-4 h-4" />
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleTestSnmp(olt.id)}
                      disabled={testingSnmp === olt.id || !(olt as any).snmpProfileId}
                      title={(olt as any).snmpProfileId ? "Testar SNMP" : "SNMP nao configurado"}
                      data-testid={`button-test-snmp-${olt.id}`}
                    >
                      {testingSnmp === olt.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Radio className="w-4 h-4" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleEdit(olt)}
                      data-testid={`button-edit-olt-${olt.id}`}
                    >
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDelete(olt.id)}
                      data-testid={`button-delete-olt-${olt.id}`}
                    >
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                </div>
                {showPassword[olt.id] && (
                  <div className="mt-3 p-2 bg-muted rounded-md text-sm font-mono">
                    Usuario: {olt.username} | Senha: {olt.password}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
          {(!oltsList || oltsList.length === 0) && (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                Nenhuma OLT cadastrada. Clique em "Adicionar OLT" para comecar.
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

interface SwitchType {
  id: number;
  voalleId: number | null;
  name: string;
  ipAddress: string;
  vendor: string | null;
  vendorId: number | null;
  model: string | null;
  sshUser: string | null;
  sshPassword: string | null;
  sshPort: number | null;
  webPort: number | null;
  webProtocol: string | null;
  winboxPort: number | null;
  snmpProfileId: number | null;
  opticalRxOidTemplate: string | null;
  opticalTxOidTemplate: string | null;
  portIndexTemplate: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

function SwitchesTab() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingSwitch, setEditingSwitch] = useState<SwitchType | undefined>(undefined);
  const [showPassword, setShowPassword] = useState<Record<number, boolean>>({});
  const [testingSsh, setTestingSsh] = useState<number | null>(null);
  const [testingSnmp, setTestingSnmp] = useState<number | null>(null);

  const { data: switchesList, isLoading } = useQuery<SwitchType[]>({
    queryKey: ["/api/switches"],
  });

  const { data: allSnmpProfiles } = useQuery<Array<{ id: number; name: string; clientId: number }>>({
    queryKey: ["/api/snmp-profiles"],
  });

  const { data: equipmentVendorsList } = useQuery<Array<{ id: number; name: string; slug: string }>>({
    queryKey: ["/api/equipment-vendors"],
  });

  const [formData, setFormData] = useState({
    name: "",
    ipAddress: "",
    vendor: "",
    vendorId: null as number | null,
    model: "",
    sshUser: "admin",
    sshPassword: "",
    sshPort: 22,
    webPort: 80,
    webProtocol: "http",
    winboxPort: 8291,
    snmpProfileId: null as number | null,
    opticalRxOidTemplate: "",
    opticalTxOidTemplate: "",
    portIndexTemplate: "",
    isActive: true,
    voalleId: null as number | null,
  });

  const resetForm = () => {
    setFormData({
      name: "",
      ipAddress: "",
      vendor: "",
      vendorId: null,
      model: "",
      sshUser: "admin",
      sshPassword: "",
      sshPort: 22,
      webPort: 80,
      webProtocol: "http",
      winboxPort: 8291,
      snmpProfileId: null,
      opticalRxOidTemplate: "",
      opticalTxOidTemplate: "",
      portIndexTemplate: "",
      isActive: true,
      voalleId: null,
    });
    setEditingSwitch(undefined);
  };

  const handleEdit = (sw: SwitchType) => {
    setEditingSwitch(sw);
    setFormData({
      name: sw.name,
      ipAddress: sw.ipAddress,
      vendor: sw.vendor || "",
      vendorId: sw.vendorId || null,
      model: sw.model || "",
      sshUser: sw.sshUser || "admin",
      sshPassword: sw.sshPassword || "",
      sshPort: sw.sshPort || 22,
      webPort: sw.webPort || 80,
      webProtocol: sw.webProtocol || "http",
      winboxPort: sw.winboxPort || 8291,
      snmpProfileId: sw.snmpProfileId || null,
      opticalRxOidTemplate: sw.opticalRxOidTemplate || "",
      opticalTxOidTemplate: sw.opticalTxOidTemplate || "",
      portIndexTemplate: sw.portIndexTemplate || "",
      isActive: sw.isActive,
      voalleId: sw.voalleId || null,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    try {
      if (editingSwitch) {
        await apiRequest("PATCH", `/api/switches/${editingSwitch.id}`, formData);
        toast({ title: "Switch atualizado com sucesso" });
      } else {
        await apiRequest("POST", "/api/switches", formData);
        toast({ title: "Switch criado com sucesso" });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/switches"] });
      setDialogOpen(false);
      resetForm();
    } catch (error) {
      toast({ title: "Erro ao salvar switch", variant: "destructive" });
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Tem certeza que deseja excluir este switch?")) return;
    try {
      await apiRequest("DELETE", `/api/switches/${id}`);
      toast({ title: "Switch excluido com sucesso" });
      queryClient.invalidateQueries({ queryKey: ["/api/switches"] });
    } catch (error) {
      toast({ title: "Erro ao excluir switch", variant: "destructive" });
    }
  };

  const handleTestSsh = async (id: number) => {
    setTestingSsh(id);
    try {
      const response = await apiRequest("POST", `/api/switches/${id}/test-ssh`);
      const result = await response.json();
      toast({
        title: result.success ? "SSH OK" : "Falha SSH",
        description: result.message,
        variant: result.success ? "default" : "destructive",
      });
    } catch (error) {
      toast({ title: "Erro ao testar SSH", variant: "destructive" });
    } finally {
      setTestingSsh(null);
    }
  };

  const handleTestSnmp = async (id: number) => {
    setTestingSnmp(id);
    try {
      const response = await apiRequest("POST", `/api/switches/${id}/test-snmp`);
      const result = await response.json();
      toast({
        title: result.success ? "SNMP OK" : "Falha SNMP",
        description: result.sysName ? `sysName: ${result.sysName}` : result.message,
        variant: result.success ? "default" : "destructive",
      });
    } catch (error) {
      toast({ title: "Erro ao testar SNMP", variant: "destructive" });
    } finally {
      setTestingSnmp(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">Switches (PTP)</h2>
        <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) resetForm(); }}>
          <DialogTrigger asChild>
            <Button size="sm" data-testid="button-add-switch">
              <Plus className="w-4 h-4 mr-2" />
              Adicionar Switch
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingSwitch ? "Editar Switch" : "Adicionar Switch"}</DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="switch-name">Nome</Label>
                <Input
                  id="switch-name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Switch Principal"
                  data-testid="input-switch-name"
                />
              </div>
              <div>
                <Label htmlFor="switch-ip">IP</Label>
                <Input
                  id="switch-ip"
                  value={formData.ipAddress}
                  onChange={(e) => setFormData({ ...formData, ipAddress: e.target.value })}
                  placeholder="192.168.1.1"
                  data-testid="input-switch-ip"
                />
              </div>
              <div>
                <Label htmlFor="switch-vendor">Fabricante</Label>
                <Select 
                  value={formData.vendorId?.toString() || "none"} 
                  onValueChange={(v) => {
                    const selectedVendor = equipmentVendorsList?.find(vendor => vendor.id.toString() === v);
                    setFormData({ 
                      ...formData, 
                      vendorId: v === "none" ? null : parseInt(v),
                      vendor: selectedVendor?.slug || ""
                    });
                  }}
                >
                  <SelectTrigger id="switch-vendor" data-testid="select-switch-vendor">
                    <SelectValue placeholder="Selecione o fabricante..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Nenhum</SelectItem>
                    {equipmentVendorsList?.map((vendor) => (
                      <SelectItem key={vendor.id} value={vendor.id.toString()}>
                        {vendor.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  Os OIDs de sinal optico serao herdados do fabricante selecionado
                </p>
              </div>
              <div>
                <Label htmlFor="switch-model">Modelo</Label>
                <Input
                  id="switch-model"
                  value={formData.model}
                  onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                  placeholder="DmSwitch 2104G2"
                  data-testid="input-switch-model"
                />
              </div>
              <div>
                <Label htmlFor="switch-voalle-id">ID Voalle (Access Point)</Label>
                <Input
                  id="switch-voalle-id"
                  type="number"
                  value={formData.voalleId ?? ""}
                  onChange={(e) => setFormData({ ...formData, voalleId: e.target.value ? parseInt(e.target.value, 10) : null })}
                  placeholder="Ex: 70"
                  data-testid="input-switch-voalle-id"
                />
                <p className="text-xs text-muted-foreground">
                  ID do authenticationAccessPoint no Voalle para associacao automatica com etiquetas de contrato
                </p>
              </div>
              <div>
                <Label htmlFor="switch-ssh-user">Usuario SSH</Label>
                <Input
                  id="switch-ssh-user"
                  value={formData.sshUser}
                  onChange={(e) => setFormData({ ...formData, sshUser: e.target.value })}
                  placeholder="admin"
                  data-testid="input-switch-ssh-user"
                />
              </div>
              <div>
                <Label htmlFor="switch-ssh-password">Senha SSH</Label>
                <Input
                  id="switch-ssh-password"
                  type="password"
                  value={formData.sshPassword}
                  onChange={(e) => setFormData({ ...formData, sshPassword: e.target.value })}
                  placeholder="••••••••"
                  data-testid="input-switch-ssh-password"
                />
              </div>
              <div>
                <Label htmlFor="switch-ssh-port">Porta SSH</Label>
                <Input
                  id="switch-ssh-port"
                  type="number"
                  value={formData.sshPort}
                  onChange={(e) => setFormData({ ...formData, sshPort: parseInt(e.target.value) || 22 })}
                  data-testid="input-switch-ssh-port"
                />
              </div>
              <div>
                <Label htmlFor="switch-snmp-profile">Perfil SNMP</Label>
                <Select
                  value={formData.snmpProfileId?.toString() || "none"}
                  onValueChange={(v) => setFormData({ ...formData, snmpProfileId: v === "none" ? null : parseInt(v) })}
                >
                  <SelectTrigger id="switch-snmp-profile" data-testid="select-switch-snmp-profile">
                    <SelectValue placeholder="Selecione..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Nenhum</SelectItem>
                    {allSnmpProfiles?.map((p) => (
                      <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <Label htmlFor="switch-optical-rx-oid">OID RX Optico (template)</Label>
                <Input
                  id="switch-optical-rx-oid"
                  value={formData.opticalRxOidTemplate}
                  onChange={(e) => setFormData({ ...formData, opticalRxOidTemplate: e.target.value })}
                  placeholder="1.3.6.1.4.1.3709.3.5.201.1.4.1.1.7.{portIndex}"
                  data-testid="input-switch-optical-rx-oid"
                />
                <p className="text-xs text-muted-foreground mt-1">Use {"{portIndex}"} para o indice SNMP da porta</p>
              </div>
              <div className="col-span-2">
                <Label htmlFor="switch-optical-tx-oid">OID TX Optico (template)</Label>
                <Input
                  id="switch-optical-tx-oid"
                  value={formData.opticalTxOidTemplate}
                  onChange={(e) => setFormData({ ...formData, opticalTxOidTemplate: e.target.value })}
                  placeholder="1.3.6.1.4.1.3709.3.5.201.1.4.1.1.6.{portIndex}"
                  data-testid="input-switch-optical-tx-oid"
                />
              </div>
              <div className="col-span-2">
                <Label htmlFor="switch-port-index-template">Formula Indice da Porta</Label>
                <Input
                  id="switch-port-index-template"
                  value={formData.portIndexTemplate}
                  onChange={(e) => setFormData({ ...formData, portIndexTemplate: e.target.value })}
                  placeholder="{slot}*8+{port} ou numero direto"
                  data-testid="input-switch-port-index-template"
                />
                <p className="text-xs text-muted-foreground mt-1">Formula para calcular o indice SNMP. Use {"{slot}"} e {"{port}"}</p>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={formData.isActive}
                  onCheckedChange={(v) => setFormData({ ...formData, isActive: v })}
                  data-testid="switch-active-toggle"
                />
                <Label>Ativo</Label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setDialogOpen(false); resetForm(); }}>
                Cancelar
              </Button>
              <Button onClick={handleSave} data-testid="button-save-switch">
                {editingSwitch ? "Salvar" : "Criar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="text-center py-8">Carregando...</div>
      ) : (
        <div className="grid gap-4">
          {switchesList?.map((sw) => (
            <Card key={sw.id}>
              <CardContent className="py-4">
                <div className="flex justify-between items-start">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Network className="w-4 h-4 text-primary" />
                      <span className="font-medium">{sw.name}</span>
                      {!sw.isActive && (
                        <Badge variant="secondary">Inativo</Badge>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      IP: {sw.ipAddress} | {sw.vendor || "N/A"} {sw.model || ""}
                      {sw.voalleId && <span> | Voalle: #{sw.voalleId}</span>}
                    </div>
                    {sw.snmpProfileId && (
                      <div className="text-xs text-muted-foreground">
                        SNMP: Perfil #{sw.snmpProfileId}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleTestSsh(sw.id)}
                      disabled={testingSsh === sw.id}
                      data-testid={`button-test-ssh-${sw.id}`}
                    >
                      {testingSsh === sw.id ? <Loader2 className="w-4 h-4 animate-spin" /> : "SSH"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleTestSnmp(sw.id)}
                      disabled={testingSnmp === sw.id || !sw.snmpProfileId}
                      data-testid={`button-test-snmp-${sw.id}`}
                    >
                      {testingSnmp === sw.id ? <Loader2 className="w-4 h-4 animate-spin" /> : "SNMP"}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => handleEdit(sw)} data-testid={`button-edit-switch-${sw.id}`}>
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => handleDelete(sw.id)} data-testid={`button-delete-switch-${sw.id}`}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          {(!switchesList || switchesList.length === 0) && (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                Nenhum switch cadastrado. Clique em "Adicionar Switch" para comecar.
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

interface SnmpConcentrator {
  id: number;
  voalleId: number | null;
  name: string;
  ipAddress: string;
  snmpProfileId: number | null;
  equipmentVendorId: number | null;
  model: string | null;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

function ConcentratorsTab() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingConcentrator, setEditingConcentrator] = useState<SnmpConcentrator | undefined>(undefined);
  const [isCreatingProfile, setIsCreatingProfile] = useState(false);
  const [newProfileData, setNewProfileData] = useState({
    name: "",
    version: "2c" as "1" | "2c" | "3",
    community: "public",
    port: 161,
    timeout: 5000,
    retries: 3,
  });

  const { data: concentratorsList, isLoading } = useQuery<SnmpConcentrator[]>({
    queryKey: ["/api/concentrators"],
  });

  const { data: snmpProfiles } = useQuery<Array<{ id: number; name: string; clientId: number | null; version: string; community: string; port: number; timeout: number; retries: number }>>({
    queryKey: ["/api/snmp-profiles"],
  });

  const { data: equipmentVendors } = useQuery<Array<{ id: number; name: string }>>({
    queryKey: ["/api/equipment-vendors"],
  });

  const [formData, setFormData] = useState({
    name: "",
    ipAddress: "",
    snmpProfileId: null as number | null,
    equipmentVendorId: null as number | null,
    model: "",
    description: "",
    isActive: true,
    voalleId: null as number | null,
    sshUser: "",
    sshPassword: "",
    sshPort: 22,
    useOperatorCredentials: false,
    webPort: 80,
    webProtocol: "http",
    winboxPort: 8291,
    vendor: "",
  });

  const resetForm = () => {
    setFormData({
      name: "",
      ipAddress: "",
      snmpProfileId: null,
      sshUser: "",
      sshPassword: "",
      sshPort: 22,
      useOperatorCredentials: false,
      webPort: 80,
      webProtocol: "http",
      winboxPort: 8291,
      vendor: "",
      equipmentVendorId: null,
      model: "",
      description: "",
      isActive: true,
      voalleId: null,
    });
    setEditingConcentrator(undefined);
    setIsCreatingProfile(false);
    resetProfileForm();
  };

  const resetProfileForm = () => {
    setNewProfileData({
      name: "",
      version: "2c",
      community: "public",
      port: 161,
      timeout: 5000,
      retries: 3,
    });
  };

  const handleSaveNewProfile = async () => {
    try {
      const response = await apiRequest("POST", "/api/snmp-profiles", {
        ...newProfileData,
        clientId: null,
      });
      const created = await response.json();
      queryClient.invalidateQueries({ queryKey: ["/api/snmp-profiles"] });
      setFormData({ ...formData, snmpProfileId: created.id });
      setIsCreatingProfile(false);
      resetProfileForm();
      toast({ title: "Perfil SNMP criado com sucesso" });
    } catch (error) {
      toast({ title: "Erro ao criar perfil SNMP", variant: "destructive" });
    }
  };

  const handleEdit = (concentrator: SnmpConcentrator) => {
    setEditingConcentrator(concentrator);
    setFormData({
      name: concentrator.name,
      ipAddress: concentrator.ipAddress,
      snmpProfileId: concentrator.snmpProfileId,
      equipmentVendorId: concentrator.equipmentVendorId,
      model: concentrator.model || "",
      description: concentrator.description || "",
      isActive: concentrator.isActive,
      voalleId: concentrator.voalleId,
      sshUser: concentrator.sshUser || "",
      sshPassword: "", // Nunca retorna a senha, só permite sobrescrever
      sshPort: concentrator.sshPort || 22,
      useOperatorCredentials: concentrator.useOperatorCredentials || false,
      webPort: concentrator.webPort || 80,
      webProtocol: concentrator.webProtocol || "http",
      winboxPort: concentrator.winboxPort || 8291,
      vendor: concentrator.vendor || "",
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    try {
      if (editingConcentrator) {
        await apiRequest("PATCH", `/api/concentrators/${editingConcentrator.id}`, formData);
        toast({ title: "Concentrador atualizado com sucesso" });
      } else {
        await apiRequest("POST", "/api/concentrators", formData);
        toast({ title: "Concentrador criado com sucesso" });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/concentrators"] });
      // Invalidar cache de dispositivos de todos os links (dados do concentrador podem ter mudado)
      queryClient.invalidateQueries({ predicate: (query) => {
        const key = query.queryKey;
        return Array.isArray(key) && key[0] === "/api/links" && key[2] === "tools";
      }});
      setDialogOpen(false);
      resetForm();
    } catch (error) {
      toast({ title: "Erro ao salvar concentrador", variant: "destructive" });
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Tem certeza que deseja excluir este concentrador?")) return;
    try {
      await apiRequest("DELETE", `/api/concentrators/${id}`);
      toast({ title: "Concentrador excluido com sucesso" });
      queryClient.invalidateQueries({ queryKey: ["/api/concentrators"] });
      // Invalidar cache de dispositivos de todos os links
      queryClient.invalidateQueries({ predicate: (query) => {
        const key = query.queryKey;
        return Array.isArray(key) && key[0] === "/api/links" && key[2] === "tools";
      }});
    } catch (error) {
      toast({ title: "Erro ao excluir concentrador", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-medium">Concentradores Cadastrados</h2>
          <p className="text-sm text-muted-foreground">
            Gerencie os concentradores/roteadores para coleta SNMP de trafego
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) resetForm();
        }}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-concentrator">
              <Plus className="w-4 h-4 mr-2" />
              Adicionar Concentrador
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{editingConcentrator ? "Editar Concentrador" : "Novo Concentrador"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="concentrator-name">Nome</Label>
                <Input
                  id="concentrator-name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Ex: CE: AJU-MVT-BORDA-HSP"
                  data-testid="input-concentrator-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="concentrator-ip">Endereco IP</Label>
                <Input
                  id="concentrator-ip"
                  value={formData.ipAddress}
                  onChange={(e) => setFormData({ ...formData, ipAddress: e.target.value })}
                  placeholder="192.168.1.1"
                  data-testid="input-concentrator-ip"
                />
              </div>
              <div className="space-y-2">
                <Label>Perfil SNMP</Label>
                {isCreatingProfile ? (
                  <Card className="p-4 space-y-3">
                    <div className="space-y-2">
                      <Label htmlFor="new-profile-name">Nome do Perfil</Label>
                      <Input
                        id="new-profile-name"
                        value={newProfileData.name}
                        onChange={(e) => setNewProfileData({ ...newProfileData, name: e.target.value })}
                        placeholder="Ex: SNMP Concentrador"
                        data-testid="input-new-profile-name"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label htmlFor="new-profile-version">Versao</Label>
                        <Select
                          value={newProfileData.version}
                          onValueChange={(v) => setNewProfileData({ ...newProfileData, version: v as "1" | "2c" | "3" })}
                        >
                          <SelectTrigger data-testid="select-new-profile-version">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="1">v1</SelectItem>
                            <SelectItem value="2c">v2c</SelectItem>
                            <SelectItem value="3">v3</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="new-profile-community">Community</Label>
                        <Input
                          id="new-profile-community"
                          value={newProfileData.community}
                          onChange={(e) => setNewProfileData({ ...newProfileData, community: e.target.value })}
                          placeholder="public"
                          data-testid="input-new-profile-community"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="space-y-2">
                        <Label htmlFor="new-profile-port">Porta</Label>
                        <Input
                          id="new-profile-port"
                          type="number"
                          value={newProfileData.port}
                          onChange={(e) => setNewProfileData({ ...newProfileData, port: parseInt(e.target.value, 10) || 161 })}
                          data-testid="input-new-profile-port"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="new-profile-timeout">Timeout (ms)</Label>
                        <Input
                          id="new-profile-timeout"
                          type="number"
                          value={newProfileData.timeout}
                          onChange={(e) => setNewProfileData({ ...newProfileData, timeout: parseInt(e.target.value, 10) || 5000 })}
                          data-testid="input-new-profile-timeout"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="new-profile-retries">Tentativas</Label>
                        <Input
                          id="new-profile-retries"
                          type="number"
                          value={newProfileData.retries}
                          onChange={(e) => setNewProfileData({ ...newProfileData, retries: parseInt(e.target.value, 10) || 3 })}
                          data-testid="input-new-profile-retries"
                        />
                      </div>
                    </div>
                    <div className="flex gap-2 justify-end">
                      <Button variant="outline" size="sm" onClick={() => { setIsCreatingProfile(false); resetProfileForm(); }}>
                        Cancelar
                      </Button>
                      <Button size="sm" onClick={handleSaveNewProfile} data-testid="button-save-new-profile">
                        Salvar Perfil
                      </Button>
                    </div>
                  </Card>
                ) : (
                  <div className="flex gap-2">
                    <Select
                      value={formData.snmpProfileId?.toString() || "none"}
                      onValueChange={(v) => setFormData({ ...formData, snmpProfileId: v === "none" ? null : parseInt(v, 10) })}
                    >
                      <SelectTrigger className="flex-1" data-testid="select-concentrator-snmp-profile">
                        <SelectValue placeholder="Selecione..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Nenhum</SelectItem>
                        {snmpProfiles?.filter(p => !p.clientId).map((profile) => (
                          <SelectItem key={profile.id} value={profile.id.toString()}>
                            {profile.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button variant="outline" size="icon" onClick={() => setIsCreatingProfile(true)} data-testid="button-create-snmp-profile">
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="concentrator-vendor">Fabricante</Label>
                  <Select
                    value={formData.equipmentVendorId?.toString() || "none"}
                    onValueChange={(v) => setFormData({ ...formData, equipmentVendorId: v === "none" ? null : parseInt(v, 10) })}
                  >
                    <SelectTrigger data-testid="select-concentrator-vendor">
                      <SelectValue placeholder="Selecione..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Nenhum</SelectItem>
                      {equipmentVendors?.map((vendor) => (
                        <SelectItem key={vendor.id} value={vendor.id.toString()}>
                          {vendor.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="concentrator-model">Modelo</Label>
                  <Input
                    id="concentrator-model"
                    value={formData.model}
                    onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                    placeholder="Ex: NE40E, ASR1002"
                    data-testid="input-concentrator-model"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="concentrator-description">Descricao</Label>
                <Input
                  id="concentrator-description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Descricao opcional"
                  data-testid="input-concentrator-description"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="concentrator-voalle-id">ID Voalle (Concentrator)</Label>
                <Input
                  id="concentrator-voalle-id"
                  type="number"
                  value={formData.voalleId ?? ""}
                  onChange={(e) => setFormData({ ...formData, voalleId: e.target.value ? parseInt(e.target.value, 10) : null })}
                  placeholder="Ex: 456"
                  data-testid="input-concentrator-voalle-id"
                />
                <p className="text-xs text-muted-foreground">
                  ID do authenticationConcentrator no Voalle para associacao automatica
                </p>
              </div>
              
              {/* Credenciais SSH */}
              <div className="space-y-2 pt-2 border-t">
                <Label className="text-sm font-medium">Credenciais SSH</Label>
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2 space-y-2">
                    <Label htmlFor="concentrator-ssh-user">Usuario SSH</Label>
                    <Input
                      id="concentrator-ssh-user"
                      value={formData.sshUser}
                      onChange={(e) => setFormData({ ...formData, sshUser: e.target.value })}
                      placeholder="admin"
                      data-testid="input-concentrator-ssh-user"
                      disabled={formData.useOperatorCredentials}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="concentrator-ssh-port">Porta</Label>
                    <Input
                      id="concentrator-ssh-port"
                      type="number"
                      value={formData.sshPort}
                      onChange={(e) => setFormData({ ...formData, sshPort: parseInt(e.target.value, 10) || 22 })}
                      placeholder="22"
                      data-testid="input-concentrator-ssh-port"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="concentrator-ssh-password">Senha SSH</Label>
                  <Input
                    id="concentrator-ssh-password"
                    type="password"
                    value={formData.sshPassword}
                    onChange={(e) => setFormData({ ...formData, sshPassword: e.target.value })}
                    placeholder={editingConcentrator ? "(deixe vazio para manter atual)" : "Senha"}
                    data-testid="input-concentrator-ssh-password"
                    disabled={formData.useOperatorCredentials}
                  />
                </div>
                <div className="flex items-center gap-2 pt-2">
                  <input
                    type="checkbox"
                    id="concentrator-use-operator-credentials"
                    checked={formData.useOperatorCredentials}
                    onChange={(e) => setFormData({ ...formData, useOperatorCredentials: e.target.checked })}
                    className="h-4 w-4 rounded border-gray-300"
                    data-testid="checkbox-use-operator-credentials"
                  />
                  <Label htmlFor="concentrator-use-operator-credentials" className="text-sm font-normal cursor-pointer">
                    Usar credenciais SSH do operador logado
                  </Label>
                </div>
              </div>

              {/* Acesso Web */}
              <div className="space-y-2 pt-2 border-t">
                <Label className="text-sm font-medium">Acesso Web</Label>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="concentrator-web-protocol">Protocolo</Label>
                    <Select
                      value={formData.webProtocol}
                      onValueChange={(v) => setFormData({ ...formData, webProtocol: v })}
                    >
                      <SelectTrigger data-testid="select-concentrator-web-protocol">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="http">HTTP</SelectItem>
                        <SelectItem value="https">HTTPS</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="concentrator-web-port">Porta Web</Label>
                    <Input
                      id="concentrator-web-port"
                      type="number"
                      value={formData.webPort}
                      onChange={(e) => setFormData({ ...formData, webPort: parseInt(e.target.value, 10) || 80 })}
                      data-testid="input-concentrator-web-port"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="concentrator-winbox-port">Porta Winbox</Label>
                    <Input
                      id="concentrator-winbox-port"
                      type="number"
                      value={formData.winboxPort}
                      onChange={(e) => setFormData({ ...formData, winboxPort: parseInt(e.target.value, 10) || 8291 })}
                      data-testid="input-concentrator-winbox-port"
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t">
                <Label htmlFor="concentrator-active">Ativo</Label>
                <Switch
                  id="concentrator-active"
                  checked={formData.isActive}
                  onCheckedChange={(checked) => setFormData({ ...formData, isActive: checked })}
                  data-testid="switch-concentrator-active"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setDialogOpen(false); resetForm(); }}>
                Cancelar
              </Button>
              <Button onClick={handleSave} data-testid="button-save-concentrator">
                {editingConcentrator ? "Salvar" : "Criar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {concentratorsList?.map((concentrator) => (
            <Card key={concentrator.id}>
              <CardContent className="pt-4">
                <div className="flex justify-between items-start">
                  <div className="space-y-1">
                    <div className="font-medium flex items-center gap-2">
                      <Server className="w-4 h-4" />
                      {concentrator.name}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      IP: {concentrator.ipAddress}
                    </div>
                    {concentrator.model && (
                      <div className="text-sm text-muted-foreground">
                        Modelo: {concentrator.model}
                      </div>
                    )}
                    {concentrator.voalleId && (
                      <Badge variant="outline" className="text-xs">
                        Voalle ID: {concentrator.voalleId}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={concentrator.isActive ? "default" : "secondary"}>
                      {concentrator.isActive ? "Ativo" : "Inativo"}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleEdit(concentrator)}
                      data-testid={`button-edit-concentrator-${concentrator.id}`}
                    >
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDelete(concentrator.id)}
                      data-testid={`button-delete-concentrator-${concentrator.id}`}
                    >
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          {(!concentratorsList || concentratorsList.length === 0) && (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                Nenhum concentrador cadastrado. Clique em "Adicionar Concentrador" para comecar.
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

interface EquipmentVendor {
  id: number;
  name: string;
  slug: string;
  cpuOid: string | null;
  cpuDivisor: number;
  memoryOid: string | null;
  memoryTotalOid: string | null;
  memoryUsedOid: string | null;
  memoryIsPercentage: boolean;
  opticalRxOid: string | null;
  opticalTxOid: string | null;
  opticalOltRxOid: string | null;
  switchOpticalRxOid: string | null;
  switchOpticalTxOid: string | null;
  switchPortIndexTemplate: string | null;
  switchOpticalDivisor: number | null;
  description: string | null;
  isBuiltIn: boolean;
  isActive: boolean;
}

function EquipmentVendorsTab() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingVendor, setEditingVendor] = useState<EquipmentVendor | undefined>(undefined);

  const { data: vendors, isLoading, refetch } = useQuery<EquipmentVendor[]>({
    queryKey: ["/api/equipment-vendors", "all"],
    queryFn: async () => {
      const res = await fetch("/api/equipment-vendors?all=true", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const { data: snmpProfilesList } = useQuery<Array<{ id: number; name: string }>>({
    queryKey: ["/api/snmp-profiles", "all"],
    queryFn: async () => {
      const res = await fetch("/api/snmp-profiles?all=true", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch SNMP profiles");
      return res.json();
    },
  });

  const [formData, setFormData] = useState({
    name: "",
    slug: "",
    cpuOid: "",
    cpuDivisor: 1,
    memoryOid: "",
    memoryTotalOid: "",
    memoryUsedOid: "",
    memoryIsPercentage: true,
    opticalRxOid: "",
    opticalTxOid: "",
    opticalOltRxOid: "",
    switchOpticalRxOid: "",
    switchOpticalTxOid: "",
    switchPortIndexTemplate: "",
    switchOpticalDivisor: 1000,
    snmpProfileId: null as number | null,
    description: "",
    isActive: true,
  });

  const resetForm = () => {
    setFormData({
      name: "",
      slug: "",
      cpuOid: "",
      cpuDivisor: 1,
      memoryOid: "",
      memoryTotalOid: "",
      memoryUsedOid: "",
      memoryIsPercentage: true,
      opticalRxOid: "",
      opticalTxOid: "",
      opticalOltRxOid: "",
      switchOpticalRxOid: "",
      switchOpticalTxOid: "",
      switchPortIndexTemplate: "",
      switchOpticalDivisor: 1000,
      snmpProfileId: null,
      description: "",
      isActive: true,
    });
    setEditingVendor(undefined);
  };

  const handleEdit = (vendor: EquipmentVendor) => {
    setEditingVendor(vendor);
    setFormData({
      name: vendor.name,
      slug: vendor.slug,
      cpuOid: vendor.cpuOid || "",
      cpuDivisor: vendor.cpuDivisor ?? 1,
      memoryOid: vendor.memoryOid || "",
      memoryTotalOid: vendor.memoryTotalOid || "",
      memoryUsedOid: vendor.memoryUsedOid || "",
      memoryIsPercentage: vendor.memoryIsPercentage,
      opticalRxOid: vendor.opticalRxOid || "",
      opticalTxOid: vendor.opticalTxOid || "",
      opticalOltRxOid: vendor.opticalOltRxOid || "",
      switchOpticalRxOid: vendor.switchOpticalRxOid || "",
      switchOpticalTxOid: vendor.switchOpticalTxOid || "",
      switchPortIndexTemplate: vendor.switchPortIndexTemplate || "",
      switchOpticalDivisor: vendor.switchOpticalDivisor ?? 1000,
      snmpProfileId: vendor.snmpProfileId ?? null,
      description: vendor.description || "",
      isActive: vendor.isActive,
    });
    setDialogOpen(true);
  };

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      return apiRequest("POST", "/api/equipment-vendors", data);
    },
    onSuccess: () => {
      toast({ title: "Fabricante criado com sucesso" });
      refetch();
      setDialogOpen(false);
      resetForm();
    },
    onError: () => {
      toast({ title: "Erro ao criar fabricante", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: typeof formData }) => {
      return apiRequest("PATCH", `/api/equipment-vendors/${id}`, data);
    },
    onSuccess: () => {
      toast({ title: "Fabricante atualizado com sucesso" });
      refetch();
      setDialogOpen(false);
      resetForm();
    },
    onError: () => {
      toast({ title: "Erro ao atualizar fabricante", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/equipment-vendors/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Fabricante excluido com sucesso" });
      refetch();
    },
    onError: () => {
      toast({ title: "Erro ao excluir fabricante", variant: "destructive" });
    },
  });

  const handleSubmit = () => {
    if (editingVendor) {
      updateMutation.mutate({ id: editingVendor.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleDelete = (id: number) => {
    if (confirm("Tem certeza que deseja excluir este fabricante?")) {
      deleteMutation.mutate(id);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-medium">Fabricantes de Equipamentos</h2>
          <p className="text-sm text-muted-foreground">
            Configure OIDs SNMP para cada fabricante de equipamento
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) resetForm();
        }}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-vendor">
              <Plus className="w-4 h-4 mr-2" />
              Adicionar Fabricante
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle>{editingVendor ? "Editar Fabricante" : "Novo Fabricante"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Nome</Label>
                  <Input
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="Ex: Datacom"
                    data-testid="input-vendor-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Slug (identificador)</Label>
                  <Input
                    value={formData.slug}
                    onChange={(e) => setFormData({ ...formData, slug: e.target.value.toLowerCase().replace(/\s+/g, '-') })}
                    placeholder="Ex: datacom"
                    data-testid="input-vendor-slug"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Descricao</Label>
                <Input
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Descricao do fabricante"
                  data-testid="input-vendor-description"
                />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2 col-span-2">
                  <Label>OID de CPU</Label>
                  <Input
                    value={formData.cpuOid}
                    onChange={(e) => setFormData({ ...formData, cpuOid: e.target.value })}
                    placeholder="Ex: 1.3.6.1.4.1.3709.3.5.201.1.1.11.0"
                    className="font-mono text-sm"
                    data-testid="input-vendor-cpu-oid"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Divisor CPU</Label>
                  <Input
                    type="number"
                    value={formData.cpuDivisor}
                    onChange={(e) => setFormData({ ...formData, cpuDivisor: parseInt(e.target.value) || 1 })}
                    placeholder="1"
                    min={1}
                    className="font-mono text-sm"
                    data-testid="input-vendor-cpu-divisor"
                  />
                  <p className="text-xs text-muted-foreground">Use 100 se valor vier como 3315 = 33.15%</p>
                </div>
              </div>
              <div className="space-y-2">
                <Label>OID de Memoria (% ou usado)</Label>
                <Input
                  value={formData.memoryOid}
                  onChange={(e) => setFormData({ ...formData, memoryOid: e.target.value })}
                  placeholder="Ex: 1.3.6.1.4.1.3709.3.5.201.1.1.1.2.0"
                  className="font-mono text-sm"
                  data-testid="input-vendor-memory-oid"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>OID Memoria Total (opcional)</Label>
                  <Input
                    value={formData.memoryTotalOid}
                    onChange={(e) => setFormData({ ...formData, memoryTotalOid: e.target.value })}
                    placeholder="Apenas se calcular %"
                    className="font-mono text-sm"
                    data-testid="input-vendor-memory-total-oid"
                  />
                </div>
                <div className="space-y-2">
                  <Label>OID Memoria Usada (opcional)</Label>
                  <Input
                    value={formData.memoryUsedOid}
                    onChange={(e) => setFormData({ ...formData, memoryUsedOid: e.target.value })}
                    placeholder="Apenas se calcular %"
                    className="font-mono text-sm"
                    data-testid="input-vendor-memory-used-oid"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={formData.memoryIsPercentage}
                  onCheckedChange={(checked) => setFormData({ ...formData, memoryIsPercentage: checked })}
                  data-testid="switch-memory-is-percentage"
                />
                <Label>Memoria ja retorna percentual</Label>
              </div>

              <div className="border-t pt-4 mt-4">
                <h4 className="font-medium mb-3">OIDs de Sinal Optico (Padrao)</h4>
                <p className="text-sm text-muted-foreground mb-3">
                  Estes OIDs serao usados como padrao para todos os links deste fabricante
                </p>
                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label>OID RX ONU (Downstream)</Label>
                    <Input
                      value={formData.opticalRxOid}
                      onChange={(e) => setFormData({ ...formData, opticalRxOid: e.target.value })}
                      placeholder="Ex: 1.3.6.1.4.1.2011.6.128.1.1.2.51.1.4"
                      className="font-mono text-sm"
                      data-testid="input-vendor-optical-rx-oid"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>OID TX ONU (Upstream)</Label>
                    <Input
                      value={formData.opticalTxOid}
                      onChange={(e) => setFormData({ ...formData, opticalTxOid: e.target.value })}
                      placeholder="Ex: 1.3.6.1.4.1.2011.6.128.1.1.2.51.1.5"
                      className="font-mono text-sm"
                      data-testid="input-vendor-optical-tx-oid"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>OID RX OLT (Upstream do cliente)</Label>
                    <Input
                      value={formData.opticalOltRxOid}
                      onChange={(e) => setFormData({ ...formData, opticalOltRxOid: e.target.value })}
                      placeholder="OID para leitura na OLT (opcional)"
                      className="font-mono text-sm"
                      data-testid="input-vendor-optical-olt-rx-oid"
                    />
                  </div>
                </div>
              </div>

              <div className="border-t pt-4 mt-4">
                <h4 className="font-medium mb-3">OIDs de Sinal Optico - Switch (PTP)</h4>
                <p className="text-sm text-muted-foreground mb-3">
                  OIDs para coleta de sinal optico em portas SFP de switches deste fabricante. Use {"{portIndex}"} como variavel.
                </p>
                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label>OID RX SFP (Recebido)</Label>
                    <Input
                      value={formData.switchOpticalRxOid}
                      onChange={(e) => setFormData({ ...formData, switchOpticalRxOid: e.target.value })}
                      placeholder="Ex: 1.3.6.1.4.1.14988.1.1.19.1.1.4.{portIndex}"
                      className="font-mono text-sm"
                      data-testid="input-vendor-switch-optical-rx-oid"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>OID TX SFP (Transmitido)</Label>
                    <Input
                      value={formData.switchOpticalTxOid}
                      onChange={(e) => setFormData({ ...formData, switchOpticalTxOid: e.target.value })}
                      placeholder="Ex: 1.3.6.1.4.1.14988.1.1.19.1.1.5.{portIndex}"
                      className="font-mono text-sm"
                      data-testid="input-vendor-switch-optical-tx-oid"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Template de Indice da Porta</Label>
                    <Input
                      value={formData.switchPortIndexTemplate}
                      onChange={(e) => setFormData({ ...formData, switchPortIndexTemplate: e.target.value })}
                      placeholder="Ex: {slot}*8+{port} ou numero direto"
                      className="font-mono text-sm"
                      data-testid="input-vendor-switch-port-index-template"
                    />
                    <p className="text-xs text-muted-foreground">
                      Formula para calcular indice SNMP da porta. Variaveis: {"{slot}"}, {"{port}"}. Ex: "1" para porta 1 direta, ou "{"{slot}"}*8+{"{port}"}" para switches modulares.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label>Divisor do Valor SNMP</Label>
                    <Input
                      type="number"
                      value={formData.switchOpticalDivisor}
                      onChange={(e) => setFormData({ ...formData, switchOpticalDivisor: parseInt(e.target.value) || 1000 })}
                      placeholder="1000"
                      className="font-mono text-sm"
                      data-testid="input-vendor-switch-optical-divisor"
                    />
                    <p className="text-xs text-muted-foreground">
                      Divisor para converter valor SNMP para dBm. Ex: 1000 para Mikrotik (-6315 / 1000 = -6.315 dBm), 100 para outros, 1 se ja estiver em dBm.
                    </p>
                  </div>
                </div>
              </div>

              <div className="border-t pt-4 mt-4">
                <h4 className="font-medium mb-3">Perfil SNMP Padrao</h4>
                <div className="space-y-2">
                  <Label>Perfil SNMP</Label>
                  <Select
                    value={formData.snmpProfileId?.toString() || "none"}
                    onValueChange={(value) =>
                      setFormData({ ...formData, snmpProfileId: value === "none" ? null : parseInt(value) })
                    }
                  >
                    <SelectTrigger data-testid="select-vendor-snmp-profile">
                      <SelectValue placeholder="Selecione..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Nenhum</SelectItem>
                      {snmpProfilesList?.map((profile) => (
                        <SelectItem key={profile.id} value={profile.id.toString()}>
                          {profile.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Perfil SNMP padrao para CPEs deste fabricante
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Switch
                  checked={formData.isActive}
                  onCheckedChange={(checked) => setFormData({ ...formData, isActive: checked })}
                  data-testid="switch-vendor-active"
                />
                <Label>Ativo</Label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setDialogOpen(false); resetForm(); }}>
                Cancelar
              </Button>
              <Button 
                onClick={handleSubmit} 
                disabled={createMutation.isPending || updateMutation.isPending}
                data-testid="button-save-vendor"
              >
                {(createMutation.isPending || updateMutation.isPending) && (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                )}
                {editingVendor ? "Salvar" : "Criar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {vendors?.map((vendor) => (
            <Card key={vendor.id}>
              <CardContent className="py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{vendor.name}</span>
                      <Badge variant="outline">{vendor.slug}</Badge>
                      {vendor.isBuiltIn && <Badge variant="secondary">Built-in</Badge>}
                      {!vendor.isActive && <Badge variant="destructive">Inativo</Badge>}
                    </div>
                    {vendor.description && (
                      <p className="text-sm text-muted-foreground mt-1">{vendor.description}</p>
                    )}
                    <div className="text-xs text-muted-foreground mt-2 space-y-1 font-mono">
                      {vendor.cpuOid && <div>CPU: {vendor.cpuOid}</div>}
                      {vendor.memoryOid && <div>Mem: {vendor.memoryOid}</div>}
                      {vendor.opticalRxOid && <div>RX Optico: {vendor.opticalRxOid}</div>}
                      {vendor.opticalTxOid && <div>TX Optico: {vendor.opticalTxOid}</div>}
                      {vendor.opticalOltRxOid && <div>OLT RX: {vendor.opticalOltRxOid}</div>}
                      {!vendor.cpuOid && !vendor.memoryOid && !vendor.opticalRxOid && !vendor.opticalTxOid && (
                        <div className="text-amber-600">Nenhum OID configurado</div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleEdit(vendor)}
                      data-testid={`button-edit-vendor-${vendor.id}`}
                    >
                      <Pencil className="w-4 h-4" />
                    </Button>
                    {!vendor.isBuiltIn && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(vendor.id)}
                        data-testid={`button-delete-vendor-${vendor.id}`}
                      >
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          {(!vendors || vendors.length === 0) && (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                Nenhum fabricante cadastrado. Clique em "Adicionar Fabricante" para comecar.
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

interface AuditLog {
  id: number;
  clientId: number | null;
  actorUserId: number | null;
  actorEmail: string | null;
  actorName: string | null;
  actorRole: string | null;
  action: string;
  entity: string | null;
  entityId: number | null;
  entityName: string | null;
  previousValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  status: string;
  errorMessage: string | null;
  createdAt: string;
}

function AuditLogsTab() {
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({
    action: "",
    entity: "",
    clientId: "",
    startDate: "",
    endDate: "",
  });
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  
  const queryParams = new URLSearchParams();
  queryParams.set("page", page.toString());
  queryParams.set("limit", "25");
  if (filters.action) queryParams.set("action", filters.action);
  if (filters.entity) queryParams.set("entity", filters.entity);
  if (filters.clientId) queryParams.set("clientId", filters.clientId);
  if (filters.startDate) queryParams.set("startDate", filters.startDate);
  if (filters.endDate) queryParams.set("endDate", filters.endDate);
  
  const { data: auditData, isLoading, refetch } = useQuery<{
    logs: AuditLog[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }>({
    queryKey: ["/api/audit", page, filters.action, filters.entity, filters.clientId, filters.startDate, filters.endDate],
    queryFn: async () => {
      const response = await fetch(`/api/audit?${queryParams.toString()}`, {
        headers: { Authorization: `Bearer ${getAuthToken()}` },
      });
      if (!response.ok) throw new Error("Falha ao buscar logs");
      return response.json();
    },
    refetchInterval: 30000,
  });
  
  const { data: clients } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
  });
  
  const getActionLabel = (action: string) => {
    const labels: Record<string, string> = {
      login: "Login",
      login_failed: "Login Falhou",
      logout: "Logout",
      create: "Criação",
      update: "Atualização",
      delete: "Exclusão",
      password_change: "Troca de Senha",
    };
    return labels[action] || action;
  };
  
  const getEntityLabel = (entity: string | null) => {
    if (!entity) return "-";
    const labels: Record<string, string> = {
      user: "Usuário",
      client: "Cliente",
      link: "Link",
      host: "Host",
      incident: "Incidente",
      group: "Grupo",
      snmpProfile: "Perfil SNMP",
      olt: "OLT",
    };
    return labels[entity] || entity;
  };
  
  const getStatusBadge = (status: string) => {
    if (status === "success") {
      return <Badge variant="default" className="bg-green-600">Sucesso</Badge>;
    }
    return <Badge variant="destructive">Falha</Badge>;
  };
  
  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch {
      return dateStr;
    }
  };
  
  const getClientName = (clientId: number | null) => {
    if (!clientId) return "Sistema";
    const client = clients?.find(c => c.id === clientId);
    return client?.name || `Cliente #${clientId}`;
  };
  
  const handleClearFilters = () => {
    setFilters({ action: "", entity: "", clientId: "", startDate: "", endDate: "" });
    setPage(1);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-medium">Logs de Auditoria</h2>
          <p className="text-sm text-muted-foreground">
            Histórico de ações realizadas no sistema
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button 
            variant="outline" 
            onClick={() => setShowFilters(!showFilters)}
            data-testid="button-toggle-filters"
          >
            <Filter className="w-4 h-4 mr-2" />
            Filtros
          </Button>
          <Button 
            variant="outline" 
            onClick={() => refetch()}
            data-testid="button-refresh-audit"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Atualizar
          </Button>
        </div>
      </div>
      
      {showFilters && (
        <Card>
          <CardContent className="pt-4">
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
              <div className="space-y-2">
                <Label>Ação</Label>
                <Select 
                  value={filters.action} 
                  onValueChange={(v) => { setFilters({...filters, action: v}); setPage(1); }}
                >
                  <SelectTrigger data-testid="select-filter-action">
                    <SelectValue placeholder="Todas as ações" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Todas</SelectItem>
                    <SelectItem value="login">Login</SelectItem>
                    <SelectItem value="login_failed">Login Falhou</SelectItem>
                    <SelectItem value="create">Criação</SelectItem>
                    <SelectItem value="update">Atualização</SelectItem>
                    <SelectItem value="delete">Exclusão</SelectItem>
                    <SelectItem value="password_change">Troca de Senha</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-2">
                <Label>Entidade</Label>
                <Select 
                  value={filters.entity} 
                  onValueChange={(v) => { setFilters({...filters, entity: v}); setPage(1); }}
                >
                  <SelectTrigger data-testid="select-filter-entity">
                    <SelectValue placeholder="Todas as entidades" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Todas</SelectItem>
                    <SelectItem value="user">Usuário</SelectItem>
                    <SelectItem value="client">Cliente</SelectItem>
                    <SelectItem value="link">Link</SelectItem>
                    <SelectItem value="host">Host</SelectItem>
                    <SelectItem value="incident">Incidente</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-2">
                <Label>Cliente</Label>
                <Select 
                  value={filters.clientId} 
                  onValueChange={(v) => { setFilters({...filters, clientId: v}); setPage(1); }}
                >
                  <SelectTrigger data-testid="select-filter-client">
                    <SelectValue placeholder="Todos os clientes" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Todos</SelectItem>
                    {clients?.map(client => (
                      <SelectItem key={client.id} value={client.id.toString()}>
                        {client.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-2">
                <Label>Data Inicial</Label>
                <Input
                  type="date"
                  value={filters.startDate}
                  onChange={(e) => { setFilters({...filters, startDate: e.target.value}); setPage(1); }}
                  data-testid="input-filter-start-date"
                />
              </div>
              
              <div className="space-y-2">
                <Label>Data Final</Label>
                <Input
                  type="date"
                  value={filters.endDate}
                  onChange={(e) => { setFilters({...filters, endDate: e.target.value}); setPage(1); }}
                  data-testid="input-filter-end-date"
                />
              </div>
            </div>
            
            <div className="flex justify-end mt-4">
              <Button variant="ghost" onClick={handleClearFilters} data-testid="button-clear-filters">
                <X className="w-4 h-4 mr-2" />
                Limpar Filtros
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      
      {isLoading ? (
        <Card>
          <CardContent className="py-8">
            <div className="flex items-center justify-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>Carregando logs...</span>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left p-3 font-medium">Data/Hora</th>
                      <th className="text-left p-3 font-medium">Usuário</th>
                      <th className="text-left p-3 font-medium">Ação</th>
                      <th className="text-left p-3 font-medium">Entidade</th>
                      <th className="text-left p-3 font-medium">Nome</th>
                      <th className="text-left p-3 font-medium">Cliente</th>
                      <th className="text-left p-3 font-medium">Status</th>
                      <th className="text-left p-3 font-medium">IP</th>
                      <th className="text-center p-3 font-medium">Detalhes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditData?.logs.map((log) => (
                      <tr key={log.id} className="border-t hover-elevate">
                        <td className="p-3 whitespace-nowrap font-mono text-xs">
                          {formatDate(log.createdAt)}
                        </td>
                        <td className="p-3">
                          <div className="flex flex-col">
                            <span className="font-medium">{log.actorName || "-"}</span>
                            <span className="text-xs text-muted-foreground">{log.actorEmail}</span>
                          </div>
                        </td>
                        <td className="p-3">
                          <Badge variant="outline">{getActionLabel(log.action)}</Badge>
                        </td>
                        <td className="p-3">{getEntityLabel(log.entity)}</td>
                        <td className="p-3">{log.entityName || "-"}</td>
                        <td className="p-3">{getClientName(log.clientId)}</td>
                        <td className="p-3">{getStatusBadge(log.status)}</td>
                        <td className="p-3 font-mono text-xs">{log.ipAddress || "-"}</td>
                        <td className="p-3 text-center">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setSelectedLog(log)}
                            data-testid={`button-view-log-${log.id}`}
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                    {(!auditData?.logs || auditData.logs.length === 0) && (
                      <tr>
                        <td colSpan={9} className="p-8 text-center text-muted-foreground">
                          Nenhum log encontrado com os filtros selecionados.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
          
          {auditData?.pagination && auditData.pagination.totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Mostrando {((page - 1) * 25) + 1} a {Math.min(page * 25, auditData.pagination.total)} de {auditData.pagination.total} registros
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  data-testid="button-prev-page"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Anterior
                </Button>
                <span className="text-sm px-2">
                  Página {page} de {auditData.pagination.totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => Math.min(auditData.pagination.totalPages, p + 1))}
                  disabled={page === auditData.pagination.totalPages}
                  data-testid="button-next-page"
                >
                  Próxima
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
      
      <Dialog open={!!selectedLog} onOpenChange={() => setSelectedLog(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Detalhes do Log de Auditoria</DialogTitle>
          </DialogHeader>
          {selectedLog && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground">Data/Hora</Label>
                  <p className="font-mono">{formatDate(selectedLog.createdAt)}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Status</Label>
                  <p>{getStatusBadge(selectedLog.status)}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Usuário</Label>
                  <p>{selectedLog.actorName || "-"}</p>
                  <p className="text-sm text-muted-foreground">{selectedLog.actorEmail}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Função</Label>
                  <p>{selectedLog.actorRole || "-"}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Ação</Label>
                  <p>{getActionLabel(selectedLog.action)}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Entidade</Label>
                  <p>{getEntityLabel(selectedLog.entity)} {selectedLog.entityId && `#${selectedLog.entityId}`}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Nome da Entidade</Label>
                  <p>{selectedLog.entityName || "-"}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Cliente</Label>
                  <p>{getClientName(selectedLog.clientId)}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">IP</Label>
                  <p className="font-mono">{selectedLog.ipAddress || "-"}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">User Agent</Label>
                  <p className="text-xs truncate">{selectedLog.userAgent || "-"}</p>
                </div>
              </div>
              
              {selectedLog.errorMessage && (
                <div>
                  <Label className="text-muted-foreground">Mensagem de Erro</Label>
                  <p className="text-destructive">{selectedLog.errorMessage}</p>
                </div>
              )}
              
              {selectedLog.previousValues && Object.keys(selectedLog.previousValues).length > 0 && (
                <div>
                  <Label className="text-muted-foreground">Valores Anteriores</Label>
                  <pre className="mt-1 p-3 bg-muted rounded-md text-xs overflow-x-auto">
                    {JSON.stringify(selectedLog.previousValues, null, 2)}
                  </pre>
                </div>
              )}
              
              {selectedLog.newValues && Object.keys(selectedLog.newValues).length > 0 && (
                <div>
                  <Label className="text-muted-foreground">Novos Valores</Label>
                  <pre className="mt-1 p-3 bg-muted rounded-md text-xs overflow-x-auto">
                    {JSON.stringify(selectedLog.newValues, null, 2)}
                  </pre>
                </div>
              )}
              
              {selectedLog.metadata && Object.keys(selectedLog.metadata).length > 0 && (
                <div>
                  <Label className="text-muted-foreground">Metadados</Label>
                  <pre className="mt-1 p-3 bg-muted rounded-md text-xs overflow-x-auto">
                    {JSON.stringify(selectedLog.metadata, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DatabaseConfigTab() {
  const { toast } = useToast();
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [formData, setFormData] = useState({
    host: "",
    port: "5432",
    database: "",
    username: "",
    password: "",
    ssl: false,
  });

  const { data: dbStatus, isLoading: statusLoading, refetch: refetchStatus } = useQuery<{
    connected: boolean;
    host: string;
    database: string;
    version: string;
    tableCount: number;
    connectionType: string;
  }>({
    queryKey: ["/api/database/status"],
    refetchInterval: 30000,
  });

  const handleTestConnection = async () => {
    setIsTesting(true);
    try {
      const response = await apiRequest("POST", "/api/database/test", formData);
      const result = await response.json();
      if (result.success) {
        toast({
          title: "Conexao bem-sucedida",
          description: `Conectado ao banco ${formData.database} em ${formData.host}`,
        });
      } else {
        toast({
          title: "Falha na conexao",
          description: result.error || "Nao foi possivel conectar ao banco de dados",
          variant: "destructive",
        });
      }
    } catch (error: any) {
      toast({
        title: "Erro ao testar conexao",
        description: error.message || "Erro desconhecido",
        variant: "destructive",
      });
    } finally {
      setIsTesting(false);
    }
  };

  const [connectionStringResult, setConnectionStringResult] = useState<string | null>(null);
  
  const handleSaveConfig = async () => {
    setIsSaving(true);
    setConnectionStringResult(null);
    try {
      const response = await apiRequest("POST", "/api/database/configure", formData);
      const result = await response.json();
      if (result.success) {
        setConnectionStringResult(result.connectionString);
        toast({
          title: "Conexao validada com sucesso",
          description: "Copie a string de conexao e configure nas variaveis de ambiente.",
        });
      } else {
        toast({
          title: "Erro na validacao",
          description: result.error || "Nao foi possivel validar a conexao",
          variant: "destructive",
        });
      }
    } catch (error: any) {
      toast({
        title: "Erro ao validar configuracao",
        description: error.message || "Erro desconhecido",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-medium">Banco de Dados</h2>
        <p className="text-sm text-muted-foreground">
          Configure a conexao com o banco de dados PostgreSQL
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="w-5 h-5" />
            Status da Conexao Atual
          </CardTitle>
        </CardHeader>
        <CardContent>
          {statusLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : dbStatus?.connected ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-green-500" />
                <span className="font-medium text-green-600">Conectado</span>
                <Badge variant="outline">{dbStatus.connectionType}</Badge>
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Host:</span>
                  <span className="ml-2 font-mono">{dbStatus.host}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Banco:</span>
                  <span className="ml-2 font-mono">{dbStatus.database}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Versao:</span>
                  <span className="ml-2">{dbStatus.version}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Tabelas:</span>
                  <span className="ml-2">{dbStatus.tableCount}</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <XCircle className="w-5 h-5 text-destructive" />
              <span className="text-destructive">Desconectado</span>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="w-5 h-5" />
            Nova Configuracao
          </CardTitle>
          <CardDescription>
            Configure uma nova conexao com banco de dados local ou remoto
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="db-host">Host</Label>
              <Input
                id="db-host"
                placeholder="localhost ou IP remoto"
                value={formData.host}
                onChange={(e) => setFormData({ ...formData, host: e.target.value })}
                data-testid="input-db-host"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="db-port">Porta</Label>
              <Input
                id="db-port"
                placeholder="5432"
                value={formData.port}
                onChange={(e) => setFormData({ ...formData, port: e.target.value })}
                data-testid="input-db-port"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="db-database">Nome do Banco</Label>
            <Input
              id="db-database"
              placeholder="link_monitor"
              value={formData.database}
              onChange={(e) => setFormData({ ...formData, database: e.target.value })}
              data-testid="input-db-database"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="db-username">Usuario</Label>
              <Input
                id="db-username"
                placeholder="postgres"
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                data-testid="input-db-username"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="db-password">Senha</Label>
              <div className="relative">
                <Input
                  id="db-password"
                  type={showPassword ? "text" : "password"}
                  placeholder="********"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  data-testid="input-db-password"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </Button>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Switch
              id="db-ssl"
              checked={formData.ssl}
              onCheckedChange={(checked) => setFormData({ ...formData, ssl: checked })}
            />
            <Label htmlFor="db-ssl">Usar conexao SSL</Label>
          </div>

          <div className="flex gap-2 pt-4">
            <Button
              variant="outline"
              onClick={handleTestConnection}
              disabled={isTesting || !formData.host || !formData.database}
              data-testid="button-test-db-connection"
            >
              {isTesting ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4 mr-2" />
              )}
              Testar Conexao
            </Button>
            <Button
              onClick={handleSaveConfig}
              disabled={isSaving || !formData.host || !formData.database}
              data-testid="button-save-db-config"
            >
              {isSaving ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <CheckCircle className="w-4 h-4 mr-2" />
              )}
              Validar e Gerar String
            </Button>
          </div>
          
          {connectionStringResult && (
            <div className="mt-4 p-4 bg-muted rounded-md">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-sm font-medium">String de Conexao (DATABASE_URL)</Label>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const realString = connectionStringResult.replace("***", formData.password);
                    navigator.clipboard.writeText(realString);
                    toast({
                      title: "Copiado!",
                      description: "String de conexao copiada para a area de transferencia.",
                    });
                  }}
                  data-testid="button-copy-db-string"
                >
                  <Download className="w-3 h-3 mr-1" />
                  Copiar
                </Button>
              </div>
              <div className="mt-2 p-2 bg-background rounded border font-mono text-xs break-all">
                {connectionStringResult}
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Clique em "Copiar" para copiar a string com a senha real. A senha exibida esta mascarada por seguranca.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-amber-600">
            <Shield className="w-5 h-5" />
            Como Configurar
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            <strong>1.</strong> Preencha os dados do novo banco e clique em "Validar e Gerar String"
          </p>
          <p>
            <strong>2.</strong> Copie a string de conexao gerada (DATABASE_URL)
          </p>
          <p>
            <strong>3.</strong> Configure a variavel DATABASE_URL no painel de Secrets do Replit ou nas variaveis de ambiente do servidor
          </p>
          <p>
            <strong>4.</strong> Reinicie a aplicacao para aplicar a nova configuracao
          </p>
          <p className="pt-2 border-t">
            Um banco vazio sera inicializado automaticamente com as tabelas necessarias.
            Para migrar dados, utilize ferramentas de backup/restore do PostgreSQL (pg_dump/pg_restore).
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

interface DiagnosticsData {
  timestamp: string;
  server: {
    uptime: number;
    uptimeFormatted: string;
    memory: {
      total: number;
      used: number;
      free: number;
      usagePercent: number;
      heapUsed: number;
      heapTotal: number;
      rss: number;
    };
    cpu: {
      cores: number;
      model: string;
      loadAvg: number[];
      usagePercent: number;
    };
    process: {
      pid: number;
      nodeVersion: string;
      platform: string;
      arch: string;
    };
  };
  metrics: {
    summary: {
      startTime: string;
      uptimeSeconds: number;
      counters: Record<string, {
        total: number;
        success: number;
        errors: number;
        lastExecutionMs: number;
        avgExecutionMs: number;
      }>;
      currentLoad: {
        activeMonitoringTasks: number;
        pendingDbWrites: number;
        queuedAlerts: number;
      };
      errorCount: number;
      recentErrors: Array<{ timestamp: string; type: string; message: string; count: number }>;
    };
  };
  database: {
    latencyMs: number;
    status: string;
  };
  monitoring: {
    totalLinks: number;
    totalHosts: number;
    totalClients: number;
    linksByStatus: Record<string, number>;
    unresolvedEventsCount: number;
    unresolvedEvents: Array<any>;
    recentMetricsByLink: Array<any>;
    lastCollectionByLink: Array<any>;
  };
  blacklist: {
    totalChecks: number;
    listedCount: number;
    listedIps: Array<{ linkId: number; ip: string; listedOn: any; lastCheckedAt: string }>;
  };
  integrations: {
    hetrixtools: { configured: boolean; enabled: boolean; autoCheckInterval: number };
    all: Array<{ id: number; provider: string; name: string; isActive: boolean; hasApiKey: boolean }>;
  };
  links: Array<{ id: number; name: string; clientId: number; status: string; ipBlock: string; address: string; snmpInterfaceName: string | null }>;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function DiagnosticsTab() {
  const { toast } = useToast();
  const [isResetting, setIsResetting] = useState(false);

  const { data: diagnostics, isLoading, error, refetch } = useQuery<DiagnosticsData>({
    queryKey: ["/api/admin/diagnostics"],
    refetchInterval: 10000,
  });

  const handleResetMetrics = async () => {
    setIsResetting(true);
    try {
      await apiRequest("POST", "/api/admin/diagnostics/reset-metrics");
      toast({ title: "Metricas resetadas com sucesso" });
      refetch();
    } catch (err) {
      toast({ title: "Erro ao resetar metricas", variant: "destructive" });
    } finally {
      setIsResetting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error || !diagnostics) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-destructive">
          <AlertCircle className="w-8 h-8 mx-auto mb-2" />
          <p>Erro ao carregar diagnosticos</p>
          <Button variant="outline" onClick={() => refetch()} className="mt-4">
            <RefreshCw className="w-4 h-4 mr-2" />
            Tentar Novamente
          </Button>
        </CardContent>
      </Card>
    );
  }

  const counters = diagnostics.metrics?.summary?.counters || {};

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-medium">Diagnostico do Sistema</h2>
          <p className="text-sm text-muted-foreground">
            Monitoramento em tempo real do servidor e metricas de execucao
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => refetch()} data-testid="button-refresh-diagnostics">
            <RefreshCw className="w-4 h-4 mr-2" />
            Atualizar
          </Button>
          <Button variant="outline" onClick={handleResetMetrics} disabled={isResetting} data-testid="button-reset-metrics">
            {isResetting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
            Resetar Metricas
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Uptime</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{diagnostics.server?.uptimeFormatted || "N/A"}</p>
            <p className="text-xs text-muted-foreground">PID: {diagnostics.server?.process?.pid}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Memoria</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{diagnostics.server?.memory?.usagePercent || 0}%</p>
            <p className="text-xs text-muted-foreground">
              {formatBytes(diagnostics.server?.memory?.used || 0)} / {formatBytes(diagnostics.server?.memory?.total || 0)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">CPU</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{diagnostics.server?.cpu?.usagePercent || 0}%</p>
            <p className="text-xs text-muted-foreground">{diagnostics.server?.cpu?.cores || 0} cores</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Database</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{diagnostics.database?.latencyMs || 0}ms</p>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <span className={`w-2 h-2 rounded-full ${diagnostics.database?.status === "connected" ? "bg-green-500" : "bg-red-500"}`} />
              {diagnostics.database?.status === "connected" ? "Conectado" : "Desconectado"}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="w-4 h-4" />
              Contadores de Operacoes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {Object.entries(counters).map(([name, counter]) => (
                <div key={name} className="flex items-center justify-between p-2 rounded bg-muted/50">
                  <div>
                    <p className="font-medium text-sm">{name}</p>
                    <p className="text-xs text-muted-foreground">
                      Sucesso: {counter.success} | Erros: {counter.errors}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-sm">{counter.total}</p>
                    <p className="text-xs text-muted-foreground">
                      {counter.avgExecutionMs > 0 ? `~${Math.round(counter.avgExecutionMs)}ms` : "-"}
                    </p>
                  </div>
                </div>
              ))}
              {Object.keys(counters).length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Nenhuma operacao registrada ainda
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Network className="w-4 h-4" />
              Status do Monitoramento
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-2">
                <div className="p-3 rounded bg-muted/50 text-center">
                  <p className="text-2xl font-bold">{diagnostics.monitoring?.totalLinks || 0}</p>
                  <p className="text-xs text-muted-foreground">Links</p>
                </div>
                <div className="p-3 rounded bg-muted/50 text-center">
                  <p className="text-2xl font-bold">{diagnostics.monitoring?.totalHosts || 0}</p>
                  <p className="text-xs text-muted-foreground">Hosts</p>
                </div>
                <div className="p-3 rounded bg-muted/50 text-center">
                  <p className="text-2xl font-bold">{diagnostics.monitoring?.totalClients || 0}</p>
                  <p className="text-xs text-muted-foreground">Clientes</p>
                </div>
              </div>

              <div>
                <p className="text-sm font-medium mb-2">Links por Status</p>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(diagnostics.monitoring?.linksByStatus || {}).map(([status, count]) => (
                    <Badge
                      key={status}
                      variant={status === "online" ? "default" : status === "offline" ? "destructive" : "secondary"}
                    >
                      {status}: {count}
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="pt-2 border-t">
                <div className="flex items-center justify-between">
                  <span className="text-sm">Eventos nao resolvidos</span>
                  <Badge variant={diagnostics.monitoring?.unresolvedEventsCount > 0 ? "destructive" : "secondary"}>
                    {diagnostics.monitoring?.unresolvedEventsCount || 0}
                  </Badge>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Shield className="w-4 h-4" />
              Integracoes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {diagnostics.integrations?.all?.map((integration) => (
                <div key={integration.id} className="flex items-center justify-between p-2 rounded bg-muted/50">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${integration.isActive ? "bg-green-500" : "bg-gray-400"}`} />
                    <span className="font-medium text-sm">{integration.name || integration.provider}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {integration.hasApiKey ? (
                      <Badge variant="outline" className="text-xs">API Key</Badge>
                    ) : (
                      <Badge variant="secondary" className="text-xs">Sem Key</Badge>
                    )}
                  </div>
                </div>
              ))}
              {(!diagnostics.integrations?.all || diagnostics.integrations.all.length === 0) && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Nenhuma integracao configurada
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              Blacklist
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2">
                <div className="p-3 rounded bg-muted/50 text-center">
                  <p className="text-2xl font-bold">{diagnostics.blacklist?.totalChecks || 0}</p>
                  <p className="text-xs text-muted-foreground">Verificacoes</p>
                </div>
                <div className="p-3 rounded bg-muted/50 text-center">
                  <p className={`text-2xl font-bold ${diagnostics.blacklist?.listedCount > 0 ? "text-destructive" : ""}`}>
                    {diagnostics.blacklist?.listedCount || 0}
                  </p>
                  <p className="text-xs text-muted-foreground">IPs Listados</p>
                </div>
              </div>

              {diagnostics.blacklist?.listedIps && diagnostics.blacklist.listedIps.length > 0 && (
                <div className="pt-2 border-t">
                  <p className="text-sm font-medium mb-2 text-destructive">IPs em Blacklist:</p>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {diagnostics.blacklist.listedIps.map((item, idx) => (
                      <div key={idx} className="text-xs font-mono p-1 rounded bg-destructive/10">
                        {item.ip}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Server className="w-4 h-4" />
            Informacoes do Servidor
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Node.js</p>
              <p className="font-mono">{diagnostics.server?.process?.nodeVersion || "N/A"}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Plataforma</p>
              <p className="font-mono">{diagnostics.server?.process?.platform || "N/A"}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Arquitetura</p>
              <p className="font-mono">{diagnostics.server?.process?.arch || "N/A"}</p>
            </div>
            <div>
              <p className="text-muted-foreground">CPU Model</p>
              <p className="font-mono text-xs truncate">{diagnostics.server?.cpu?.model || "N/A"}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Heap Usado</p>
              <p className="font-mono">{formatBytes(diagnostics.server?.memory?.heapUsed || 0)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Heap Total</p>
              <p className="font-mono">{formatBytes(diagnostics.server?.memory?.heapTotal || 0)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">RSS</p>
              <p className="font-mono">{formatBytes(diagnostics.server?.memory?.rss || 0)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Load Average</p>
              <p className="font-mono">{diagnostics.server?.cpu?.loadAvg?.map(l => l.toFixed(2)).join(" / ") || "N/A"}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ultima Atualizacao</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {diagnostics.timestamp ? new Date(diagnostics.timestamp).toLocaleString("pt-BR") : "N/A"}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

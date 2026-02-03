import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Plus, Pencil, Trash2, Search, Eye, EyeOff, Loader2, Router, Shield, ShieldOff } from "lucide-react";
import type { Cpe, EquipmentVendor, SnmpProfile } from "@shared/schema";

const CPE_TYPES = [
  { value: "cpe", label: "CPE" },
  { value: "firewall", label: "Firewall" },
  { value: "switch", label: "Switch" },
  { value: "router", label: "Router" },
  { value: "onu", label: "ONU" },
];

const OWNERSHIP_OPTIONS = [
  { value: "marvitel", label: "Marvitel" },
  { value: "client", label: "Cliente" },
];

interface CpeFormData {
  name: string;
  type: string;
  vendorId: number | null;
  model: string;
  isStandard: boolean;
  ipAddress: string;
  hasAccess: boolean;
  ownership: string;
  webProtocol: string;
  webPort: number;
  webUser: string;
  webPassword: string;
  sshPort: number;
  sshUser: string;
  sshPassword: string;
  winboxPort: number;
  snmpProfileId: number | null;
  serialNumber: string;
  macAddress: string;
  notes: string;
  isActive: boolean;
}

const defaultFormData: CpeFormData = {
  name: "",
  type: "cpe",
  vendorId: null,
  model: "",
  isStandard: false,
  ipAddress: "",
  hasAccess: true,
  ownership: "marvitel",
  webProtocol: "http",
  webPort: 80,
  webUser: "",
  webPassword: "",
  sshPort: 22,
  sshUser: "",
  sshPassword: "",
  winboxPort: 8291,
  snmpProfileId: null,
  serialNumber: "",
  macAddress: "",
  notes: "",
  isActive: true,
};

export function CpesTab() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCpe, setEditingCpe] = useState<Cpe | undefined>(undefined);
  const [searchTerm, setSearchTerm] = useState("");
  const [showWebPassword, setShowWebPassword] = useState(false);
  const [showSshPassword, setShowSshPassword] = useState(false);
  const [formData, setFormData] = useState<CpeFormData>(defaultFormData);

  const { data: cpesList, isLoading, refetch } = useQuery<Cpe[]>({
    queryKey: ["/api/cpes"],
    queryFn: async () => {
      const res = await fetch("/api/cpes", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch CPEs");
      return res.json();
    },
  });

  const { data: vendors } = useQuery<EquipmentVendor[]>({
    queryKey: ["/api/equipment-vendors", "all"],
    queryFn: async () => {
      const res = await fetch("/api/equipment-vendors?all=true", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch vendors");
      return res.json();
    },
  });

  const { data: snmpProfiles } = useQuery<SnmpProfile[]>({
    queryKey: ["/api/snmp-profiles", "all"],
    queryFn: async () => {
      const res = await fetch("/api/snmp-profiles?all=true", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch SNMP profiles");
      return res.json();
    },
  });

  const resetForm = () => {
    setFormData(defaultFormData);
    setEditingCpe(undefined);
    setShowWebPassword(false);
    setShowSshPassword(false);
  };

  const handleEdit = (cpe: Cpe) => {
    setEditingCpe(cpe);
    setFormData({
      name: cpe.name,
      type: cpe.type,
      vendorId: cpe.vendorId,
      model: cpe.model || "",
      isStandard: cpe.isStandard ?? false,
      ipAddress: cpe.ipAddress || "",
      hasAccess: cpe.hasAccess,
      ownership: cpe.ownership,
      webProtocol: cpe.webProtocol || "http",
      webPort: cpe.webPort || 80,
      webUser: cpe.webUser || "",
      webPassword: "",
      sshPort: cpe.sshPort || 22,
      sshUser: cpe.sshUser || "",
      sshPassword: "",
      winboxPort: cpe.winboxPort || 8291,
      snmpProfileId: cpe.snmpProfileId ?? null,
      serialNumber: cpe.serialNumber || "",
      macAddress: cpe.macAddress || "",
      notes: cpe.notes || "",
      isActive: cpe.isActive,
    });
    setDialogOpen(true);
  };

  const createMutation = useMutation({
    mutationFn: async (data: CpeFormData) => {
      return apiRequest("POST", "/api/cpes", data);
    },
    onSuccess: () => {
      toast({ title: "CPE criado com sucesso" });
      refetch();
      setDialogOpen(false);
      resetForm();
    },
    onError: () => {
      toast({ title: "Erro ao criar CPE", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<CpeFormData> }) => {
      return apiRequest("PATCH", `/api/cpes/${id}`, data);
    },
    onSuccess: () => {
      toast({ title: "CPE atualizado com sucesso" });
      refetch();
      setDialogOpen(false);
      resetForm();
    },
    onError: () => {
      toast({ title: "Erro ao atualizar CPE", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/cpes/${id}`);
    },
    onSuccess: () => {
      toast({ title: "CPE excluído com sucesso" });
      refetch();
    },
    onError: () => {
      toast({ title: "Erro ao excluir CPE", variant: "destructive" });
    },
  });

  const handleSubmit = () => {
    if (editingCpe) {
      const updateData: Partial<CpeFormData> = { ...formData };
      if (!updateData.webPassword) delete updateData.webPassword;
      if (!updateData.sshPassword) delete updateData.sshPassword;
      updateMutation.mutate({ id: editingCpe.id, data: updateData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const filteredCpes = cpesList?.filter((cpe) =>
    cpe.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    cpe.ipAddress?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    cpe.model?.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  const getVendorName = (vendorId: number | null) => {
    if (!vendorId) return "-";
    const vendor = vendors?.find((v) => v.id === vendorId);
    return vendor?.name || "-";
  };

  const getTypeLabel = (type: string) => {
    return CPE_TYPES.find((t) => t.value === type)?.label || type;
  };

  const isMikrotik = () => {
    if (!formData.vendorId) return false;
    const vendor = vendors?.find((v) => v.id === formData.vendorId);
    return vendor?.slug === "mikrotik";
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-medium">CPEs - Equipamentos do Cliente</h2>
          <p className="text-sm text-muted-foreground">
            Gerencie os equipamentos nas instalações dos clientes
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar CPE..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-8 w-64"
              data-testid="input-search-cpes"
            />
          </div>
          <Dialog
            open={dialogOpen}
            onOpenChange={(open) => {
              setDialogOpen(open);
              if (!open) resetForm();
            }}
          >
            <DialogTrigger asChild>
              <Button data-testid="button-add-cpe">
                <Plus className="w-4 h-4 mr-2" />
                Adicionar CPE
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{editingCpe ? "Editar CPE" : "Adicionar CPE"}</DialogTitle>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Nome *</Label>
                    <Input
                      id="name"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="Ex: CPE Cliente XYZ"
                      data-testid="input-cpe-name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="type">Tipo</Label>
                    <Select
                      value={formData.type}
                      onValueChange={(value) => setFormData({ ...formData, type: value })}
                    >
                      <SelectTrigger data-testid="select-cpe-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CPE_TYPES.map((type) => (
                          <SelectItem key={type.value} value={type.value}>
                            {type.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="vendorId">Fabricante</Label>
                    <Select
                      value={formData.vendorId?.toString() || "none"}
                      onValueChange={(value) =>
                        setFormData({ ...formData, vendorId: value === "none" ? null : parseInt(value) })
                      }
                    >
                      <SelectTrigger data-testid="select-cpe-vendor">
                        <SelectValue placeholder="Selecione..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Nenhum</SelectItem>
                        {vendors?.map((vendor) => (
                          <SelectItem key={vendor.id} value={vendor.id.toString()}>
                            {vendor.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="model">Modelo</Label>
                    <Input
                      id="model"
                      value={formData.model}
                      onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                      placeholder="Ex: Mikrotik RB750"
                      data-testid="input-cpe-model"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="flex items-center space-x-3 py-2">
                    <Switch
                      id="isStandard"
                      checked={formData.isStandard}
                      onCheckedChange={(checked) => setFormData({ ...formData, isStandard: checked })}
                      data-testid="switch-cpe-standard"
                    />
                    <Label htmlFor="isStandard" className="flex flex-col">
                      <span>Equipamento Padrão</span>
                      <span className="text-xs text-muted-foreground">
                        IP definido no cadastro do link
                      </span>
                    </Label>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ownership">Propriedade</Label>
                    <Select
                      value={formData.ownership}
                      onValueChange={(value) => setFormData({ ...formData, ownership: value })}
                    >
                      <SelectTrigger data-testid="select-cpe-ownership">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {OWNERSHIP_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {!formData.isStandard && (
                  <div className="space-y-2">
                    <Label htmlFor="ipAddress">Endereço IP</Label>
                    <Input
                      id="ipAddress"
                      value={formData.ipAddress}
                      onChange={(e) => setFormData({ ...formData, ipAddress: e.target.value })}
                      placeholder="Ex: 192.168.1.1"
                      data-testid="input-cpe-ip"
                    />
                  </div>
                )}

                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <Switch
                      id="hasAccess"
                      checked={formData.hasAccess}
                      onCheckedChange={(checked) => setFormData({ ...formData, hasAccess: checked })}
                      data-testid="switch-cpe-access"
                    />
                    <Label htmlFor="hasAccess">Temos acesso ao equipamento</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      id="isActive"
                      checked={formData.isActive}
                      onCheckedChange={(checked) => setFormData({ ...formData, isActive: checked })}
                      data-testid="switch-cpe-active"
                    />
                    <Label htmlFor="isActive">Ativo</Label>
                  </div>
                </div>

                {formData.hasAccess && (
                  <>
                    <div className="border-t pt-4">
                      <h4 className="font-medium mb-3">Acesso Web</h4>
                      <div className="grid grid-cols-4 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="webProtocol">Protocolo</Label>
                          <Select
                            value={formData.webProtocol}
                            onValueChange={(value) => setFormData({ ...formData, webProtocol: value })}
                          >
                            <SelectTrigger data-testid="select-web-protocol">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="http">HTTP</SelectItem>
                              <SelectItem value="https">HTTPS</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="webPort">Porta</Label>
                          <Input
                            id="webPort"
                            type="number"
                            value={formData.webPort}
                            onChange={(e) => setFormData({ ...formData, webPort: parseInt(e.target.value) || 80 })}
                            data-testid="input-web-port"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="webUser">Usuário</Label>
                          <Input
                            id="webUser"
                            value={formData.webUser}
                            onChange={(e) => setFormData({ ...formData, webUser: e.target.value })}
                            data-testid="input-web-user"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="webPassword">Senha</Label>
                          <div className="relative">
                            <Input
                              id="webPassword"
                              type={showWebPassword ? "text" : "password"}
                              value={formData.webPassword}
                              onChange={(e) => setFormData({ ...formData, webPassword: e.target.value })}
                              placeholder={editingCpe ? "(manter atual)" : ""}
                              data-testid="input-web-password"
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="absolute right-0 top-0 h-full"
                              onClick={() => setShowWebPassword(!showWebPassword)}
                            >
                              {showWebPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="border-t pt-4">
                      <h4 className="font-medium mb-3">Acesso SSH/CLI</h4>
                      <div className="grid grid-cols-3 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="sshPort">Porta SSH</Label>
                          <Input
                            id="sshPort"
                            type="number"
                            value={formData.sshPort}
                            onChange={(e) => setFormData({ ...formData, sshPort: parseInt(e.target.value) || 22 })}
                            data-testid="input-ssh-port"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="sshUser">Usuário</Label>
                          <Input
                            id="sshUser"
                            value={formData.sshUser}
                            onChange={(e) => setFormData({ ...formData, sshUser: e.target.value })}
                            data-testid="input-ssh-user"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="sshPassword">Senha</Label>
                          <div className="relative">
                            <Input
                              id="sshPassword"
                              type={showSshPassword ? "text" : "password"}
                              value={formData.sshPassword}
                              onChange={(e) => setFormData({ ...formData, sshPassword: e.target.value })}
                              placeholder={editingCpe ? "(manter atual)" : ""}
                              data-testid="input-ssh-password"
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="absolute right-0 top-0 h-full"
                              onClick={() => setShowSshPassword(!showSshPassword)}
                            >
                              {showSshPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </Button>
                          </div>
                        </div>
                      </div>
                      {isMikrotik() && (
                        <div className="mt-3">
                          <div className="space-y-2">
                            <Label htmlFor="winboxPort">Porta Winbox (Mikrotik)</Label>
                            <Input
                              id="winboxPort"
                              type="number"
                              value={formData.winboxPort}
                              onChange={(e) => setFormData({ ...formData, winboxPort: parseInt(e.target.value) || 8291 })}
                              className="w-32"
                              data-testid="input-winbox-port"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                )}

                {/* Perfil SNMP */}
                <div className="border-t pt-4">
                  <h4 className="font-medium mb-3">Configuração SNMP</h4>
                  <div className="space-y-2">
                    <Label htmlFor="snmpProfileId">Perfil SNMP</Label>
                    <Select
                      value={formData.snmpProfileId?.toString() || "vendor"}
                      onValueChange={(value) =>
                        setFormData({ ...formData, snmpProfileId: value === "vendor" ? null : parseInt(value) })
                      }
                    >
                      <SelectTrigger data-testid="select-snmp-profile">
                        <SelectValue placeholder="Selecione..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="vendor">
                          Usar do Fabricante
                          {formData.vendorId && vendors?.find(v => v.id === formData.vendorId)?.snmpProfileId && (
                            ` (${snmpProfiles?.find(p => p.id === vendors?.find(v => v.id === formData.vendorId)?.snmpProfileId)?.name || "configurado"})`
                          )}
                        </SelectItem>
                        {snmpProfiles?.map((profile) => (
                          <SelectItem key={profile.id} value={profile.id.toString()}>
                            {profile.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      {formData.snmpProfileId 
                        ? "Usando perfil personalizado" 
                        : formData.vendorId && vendors?.find(v => v.id === formData.vendorId)?.snmpProfileId
                          ? `Herdando do fabricante: ${snmpProfiles?.find(p => p.id === vendors?.find(v => v.id === formData.vendorId)?.snmpProfileId)?.name || ""}`
                          : "Nenhum perfil SNMP configurado no fabricante"
                      }
                    </p>
                  </div>
                </div>

                {!formData.isStandard && (
                  <div className="border-t pt-4">
                    <h4 className="font-medium mb-3">Informações Adicionais</h4>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="serialNumber">Número de Série</Label>
                        <Input
                          id="serialNumber"
                          value={formData.serialNumber}
                          onChange={(e) => setFormData({ ...formData, serialNumber: e.target.value })}
                          data-testid="input-serial"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="macAddress">Endereço MAC</Label>
                        <Input
                          id="macAddress"
                          value={formData.macAddress}
                          onChange={(e) => setFormData({ ...formData, macAddress: e.target.value })}
                          placeholder="Ex: AA:BB:CC:DD:EE:FF"
                          data-testid="input-mac"
                        />
                      </div>
                    </div>
                    <div className="mt-3 space-y-2">
                      <Label htmlFor="notes">Observações</Label>
                      <Textarea
                        id="notes"
                        value={formData.notes}
                        onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                        rows={3}
                        data-testid="textarea-notes"
                      />
                    </div>
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancelar
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={!formData.name || createMutation.isPending || updateMutation.isPending}
                  data-testid="button-save-cpe"
                >
                  {(createMutation.isPending || updateMutation.isPending) && (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  )}
                  {editingCpe ? "Salvar" : "Criar"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : filteredCpes.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <Router className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>Nenhum CPE cadastrado</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Fabricante</TableHead>
                  <TableHead>IP</TableHead>
                  <TableHead>Proprietário</TableHead>
                  <TableHead>Acesso</TableHead>
                  <TableHead>Padrão</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCpes.map((cpe) => (
                  <TableRow key={cpe.id} data-testid={`row-cpe-${cpe.id}`}>
                    <TableCell className="font-medium">{cpe.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{getTypeLabel(cpe.type)}</Badge>
                    </TableCell>
                    <TableCell>{getVendorName(cpe.vendorId)}</TableCell>
                    <TableCell className="font-mono text-sm">{cpe.ipAddress || "-"}</TableCell>
                    <TableCell>
                      <Badge variant={cpe.ownership === "marvitel" ? "default" : "secondary"}>
                        {cpe.ownership === "marvitel" ? "Marvitel" : "Cliente"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {cpe.hasAccess ? (
                        <Badge variant="default" className="bg-green-600">
                          <Shield className="w-3 h-3 mr-1" />
                          Sim
                        </Badge>
                      ) : (
                        <Badge variant="secondary">
                          <ShieldOff className="w-3 h-3 mr-1" />
                          Não
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {cpe.isStandard ? (
                        <Badge variant="default" className="bg-blue-600">Sim</Badge>
                      ) : (
                        <Badge variant="outline">Não</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={cpe.isActive ? "default" : "secondary"}>
                        {cpe.isActive ? "Ativo" : "Inativo"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleEdit(cpe)}
                          data-testid={`button-edit-cpe-${cpe.id}`}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            if (confirm("Tem certeza que deseja excluir este CPE?")) {
                              deleteMutation.mutate(cpe.id);
                            }
                          }}
                          data-testid={`button-delete-cpe-${cpe.id}`}
                        >
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

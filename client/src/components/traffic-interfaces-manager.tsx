import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Plus, Trash2, Settings2, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import type { LinkTrafficInterface, SnmpConcentrator, Switch as SwitchType } from "@shared/schema";

interface TrafficInterfacesManagerProps {
  linkId: number;
  concentrators: SnmpConcentrator[];
  switches: SwitchType[];
}

interface TrafficInterfaceForm {
  id?: number;
  label: string;
  sourceType: "manual" | "concentrator" | "switch";
  ipAddress: string;
  snmpProfileId: number | null;
  sourceEquipmentId: number | null;
  ifIndex: number;
  ifName: string;
  ifDescr: string;
  color: string;
  displayOrder: number;
  invertBandwidth: boolean;
  isEnabled: boolean;
}

const defaultColors = [
  "#3b82f6", // blue
  "#10b981", // green
  "#f59e0b", // amber
  "#ef4444", // red
  "#8b5cf6", // purple
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#84cc16", // lime
];

export function TrafficInterfacesManager({ linkId, concentrators, switches }: TrafficInterfacesManagerProps) {
  const { toast } = useToast();
  const [isExpanded, setIsExpanded] = useState(false);
  const [editingInterface, setEditingInterface] = useState<TrafficInterfaceForm | null>(null);
  const [isAdding, setIsAdding] = useState(false);

  const { data: interfaces = [], isLoading } = useQuery<LinkTrafficInterface[]>({
    queryKey: ["/api/links", linkId, "traffic-interfaces"],
    queryFn: async () => {
      const res = await fetch(`/api/links/${linkId}/traffic-interfaces`, { credentials: "include" });
      if (!res.ok) throw new Error("Falha ao carregar interfaces");
      return res.json();
    },
    enabled: linkId > 0,
  });

  const createMutation = useMutation({
    mutationFn: async (data: Omit<TrafficInterfaceForm, "id">) => {
      return apiRequest("POST", `/api/links/${linkId}/traffic-interfaces`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/links", linkId, "traffic-interfaces"] });
      setIsAdding(false);
      setEditingInterface(null);
      toast({ title: "Interface adicionada", description: "Interface de tráfego criada com sucesso" });
    },
    onError: () => {
      toast({ title: "Erro", description: "Falha ao criar interface de tráfego", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }: TrafficInterfaceForm) => {
      return apiRequest("PATCH", `/api/links/${linkId}/traffic-interfaces/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/links", linkId, "traffic-interfaces"] });
      setEditingInterface(null);
      toast({ title: "Interface atualizada", description: "Interface de tráfego atualizada com sucesso" });
    },
    onError: () => {
      toast({ title: "Erro", description: "Falha ao atualizar interface de tráfego", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/links/${linkId}/traffic-interfaces/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/links", linkId, "traffic-interfaces"] });
      toast({ title: "Interface removida", description: "Interface de tráfego excluída com sucesso" });
    },
    onError: () => {
      toast({ title: "Erro", description: "Falha ao excluir interface de tráfego", variant: "destructive" });
    },
  });

  const handleStartAdd = () => {
    setIsAdding(true);
    setEditingInterface({
      label: "",
      sourceType: "manual",
      ipAddress: "",
      snmpProfileId: null,
      sourceEquipmentId: null,
      ifIndex: 0,
      ifName: "",
      ifDescr: "",
      color: defaultColors[interfaces.length % defaultColors.length],
      displayOrder: interfaces.length,
      invertBandwidth: false,
      isEnabled: true,
    });
    setIsExpanded(true);
  };

  const handleStartEdit = (iface: LinkTrafficInterface) => {
    setIsAdding(false);
    setEditingInterface({
      id: iface.id,
      label: iface.label,
      sourceType: iface.sourceType as "manual" | "concentrator" | "switch",
      ipAddress: iface.ipAddress || "",
      snmpProfileId: iface.snmpProfileId,
      sourceEquipmentId: iface.sourceEquipmentId,
      ifIndex: iface.ifIndex,
      ifName: iface.ifName || "",
      ifDescr: iface.ifDescr || "",
      color: iface.color,
      displayOrder: iface.displayOrder,
      invertBandwidth: iface.invertBandwidth,
      isEnabled: iface.isEnabled,
    });
  };

  const handleSave = () => {
    if (!editingInterface) return;

    if (!editingInterface.label.trim()) {
      toast({ title: "Erro", description: "A legenda é obrigatória", variant: "destructive" });
      return;
    }

    if (!editingInterface.ifIndex) {
      toast({ title: "Erro", description: "O índice da interface (ifIndex) é obrigatório", variant: "destructive" });
      return;
    }

    if (isAdding) {
      createMutation.mutate(editingInterface);
    } else if (editingInterface.id) {
      updateMutation.mutate(editingInterface as TrafficInterfaceForm);
    }
  };

  const handleCancel = () => {
    setIsAdding(false);
    setEditingInterface(null);
  };

  const handleDelete = (id: number) => {
    if (confirm("Tem certeza que deseja excluir esta interface de tráfego?")) {
      deleteMutation.mutate(id);
    }
  };

  const getSourceLabel = (iface: LinkTrafficInterface) => {
    if (iface.sourceType === "concentrator") {
      const conc = concentrators.find((c) => c.id === iface.sourceEquipmentId);
      return conc ? `Concentrador: ${conc.name}` : "Concentrador";
    } else if (iface.sourceType === "switch") {
      const sw = switches.find((s) => s.id === iface.sourceEquipmentId);
      return sw ? `Switch: ${sw.name}` : "Switch";
    }
    return `IP: ${iface.ipAddress || "N/A"}`;
  };

  if (linkId <= 0) {
    return null;
  }

  return (
    <Card className="mt-4">
      <CardHeader
        className="cursor-pointer py-3"
        onClick={() => setIsExpanded(!isExpanded)}
        data-testid="card-traffic-interfaces-header"
      >
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Settings2 className="w-4 h-4" />
            Interfaces de Tráfego Adicionais
            {interfaces.length > 0 && (
              <Badge variant="secondary" className="ml-2">
                {interfaces.length}
              </Badge>
            )}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                handleStartAdd();
              }}
              data-testid="button-add-traffic-interface"
            >
              <Plus className="w-4 h-4 mr-1" />
              Adicionar
            </Button>
            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Configure múltiplas interfaces para compor o gráfico de tráfego (L2 + L3, VLANs, etc.)
        </p>
      </CardHeader>

      {isExpanded && (
        <CardContent className="pt-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-4 h-4 animate-spin" />
            </div>
          ) : (
            <div className="space-y-3">
              {interfaces.map((iface) => (
                <div
                  key={iface.id}
                  className="flex items-center justify-between p-3 rounded-md border bg-muted/30"
                  data-testid={`traffic-interface-item-${iface.id}`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-4 h-4 rounded-full border"
                      style={{ backgroundColor: iface.color }}
                    />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{iface.label}</span>
                        {!iface.isEnabled && (
                          <Badge variant="secondary" className="text-xs">
                            Desativada
                          </Badge>
                        )}
                        {iface.invertBandwidth && (
                          <Badge variant="outline" className="text-xs">
                            Invertida
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {getSourceLabel(iface)} • ifIndex: {iface.ifIndex}
                        {iface.ifName && ` • ${iface.ifName}`}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleStartEdit(iface)}
                      data-testid={`button-edit-interface-${iface.id}`}
                    >
                      <Settings2 className="w-4 h-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(iface.id)}
                      data-testid={`button-delete-interface-${iface.id}`}
                    >
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}

              {interfaces.length === 0 && !editingInterface && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Nenhuma interface adicional configurada. Clique em "Adicionar" para incluir.
                </p>
              )}

              {editingInterface && (
                <div className="p-4 border rounded-md space-y-4 bg-background">
                  <h4 className="font-medium text-sm">
                    {isAdding ? "Nova Interface de Tráfego" : "Editar Interface de Tráfego"}
                  </h4>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Legenda *</Label>
                      <Input
                        value={editingInterface.label}
                        onChange={(e) =>
                          setEditingInterface({ ...editingInterface, label: e.target.value })
                        }
                        placeholder="Ex: L2 Físico, L3 IPv4, VLAN 100"
                        data-testid="input-interface-label"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Cor no Gráfico</Label>
                      <div className="flex gap-2">
                        <Input
                          type="color"
                          value={editingInterface.color}
                          onChange={(e) =>
                            setEditingInterface({ ...editingInterface, color: e.target.value })
                          }
                          className="w-12 h-9 p-1"
                          data-testid="input-interface-color"
                        />
                        <Input
                          value={editingInterface.color}
                          onChange={(e) =>
                            setEditingInterface({ ...editingInterface, color: e.target.value })
                          }
                          placeholder="#3b82f6"
                          className="flex-1"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Origem dos Dados</Label>
                    <Select
                      value={editingInterface.sourceType}
                      onValueChange={(v) =>
                        setEditingInterface({
                          ...editingInterface,
                          sourceType: v as "manual" | "concentrator" | "switch",
                          sourceEquipmentId: null,
                          ipAddress: "",
                        })
                      }
                    >
                      <SelectTrigger data-testid="select-interface-source-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="manual">Manual (IP direto)</SelectItem>
                        <SelectItem value="concentrator">Via Concentrador</SelectItem>
                        <SelectItem value="switch">Via Switch de Acesso</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {editingInterface.sourceType === "manual" && (
                    <div className="space-y-2">
                      <Label>IP do Equipamento</Label>
                      <Input
                        value={editingInterface.ipAddress}
                        onChange={(e) =>
                          setEditingInterface({ ...editingInterface, ipAddress: e.target.value })
                        }
                        placeholder="192.168.1.1"
                        data-testid="input-interface-ip"
                      />
                    </div>
                  )}

                  {editingInterface.sourceType === "concentrator" && (
                    <div className="space-y-2">
                      <Label>Concentrador</Label>
                      <Select
                        value={editingInterface.sourceEquipmentId?.toString() || ""}
                        onValueChange={(v) =>
                          setEditingInterface({
                            ...editingInterface,
                            sourceEquipmentId: v ? parseInt(v, 10) : null,
                          })
                        }
                      >
                        <SelectTrigger data-testid="select-interface-concentrator">
                          <SelectValue placeholder="Selecione o concentrador..." />
                        </SelectTrigger>
                        <SelectContent>
                          {concentrators.map((c) => (
                            <SelectItem key={c.id} value={c.id.toString()}>
                              {c.name} ({c.ipAddress})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {editingInterface.sourceType === "switch" && (
                    <div className="space-y-2">
                      <Label>Switch de Acesso</Label>
                      <Select
                        value={editingInterface.sourceEquipmentId?.toString() || ""}
                        onValueChange={(v) =>
                          setEditingInterface({
                            ...editingInterface,
                            sourceEquipmentId: v ? parseInt(v, 10) : null,
                          })
                        }
                      >
                        <SelectTrigger data-testid="select-interface-switch">
                          <SelectValue placeholder="Selecione o switch..." />
                        </SelectTrigger>
                        <SelectContent>
                          {switches.map((s) => (
                            <SelectItem key={s.id} value={s.id.toString()}>
                              {s.name} ({s.ipAddress})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label>ifIndex *</Label>
                      <Input
                        type="number"
                        value={editingInterface.ifIndex || ""}
                        onChange={(e) =>
                          setEditingInterface({
                            ...editingInterface,
                            ifIndex: parseInt(e.target.value, 10) || 0,
                          })
                        }
                        placeholder="100"
                        data-testid="input-interface-ifindex"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Nome da Interface</Label>
                      <Input
                        value={editingInterface.ifName}
                        onChange={(e) =>
                          setEditingInterface({ ...editingInterface, ifName: e.target.value })
                        }
                        placeholder="Ethernet1/1"
                        data-testid="input-interface-ifname"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Ordem</Label>
                      <Input
                        type="number"
                        value={editingInterface.displayOrder}
                        onChange={(e) =>
                          setEditingInterface({
                            ...editingInterface,
                            displayOrder: parseInt(e.target.value, 10) || 0,
                          })
                        }
                        placeholder="0"
                        data-testid="input-interface-order"
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-6">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={editingInterface.isEnabled}
                        onCheckedChange={(checked) =>
                          setEditingInterface({ ...editingInterface, isEnabled: checked })
                        }
                        data-testid="switch-interface-enabled"
                      />
                      <Label className="text-sm">Ativa</Label>
                    </div>

                    <div className="flex items-center gap-2">
                      <Switch
                        checked={editingInterface.invertBandwidth}
                        onCheckedChange={(checked) =>
                          setEditingInterface({ ...editingInterface, invertBandwidth: checked })
                        }
                        data-testid="switch-interface-invert"
                      />
                      <Label className="text-sm">Inverter Download/Upload</Label>
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-2 border-t">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleCancel}
                      data-testid="button-cancel-interface"
                    >
                      Cancelar
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleSave}
                      disabled={createMutation.isPending || updateMutation.isPending}
                      data-testid="button-save-interface"
                    >
                      {(createMutation.isPending || updateMutation.isPending) && (
                        <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                      )}
                      Salvar
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

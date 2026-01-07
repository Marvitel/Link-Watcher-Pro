import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth, getAuthToken } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import type { Link, Client, User, Olt, ErpIntegration, ClientErpMapping } from "@shared/schema";
import { Database, Globe, Plug } from "lucide-react";
import { formatBandwidth } from "@/lib/export-utils";

interface SnmpInterface {
  ifIndex: number;
  ifName: string;
  ifDescr: string;
  ifSpeed: number;
  ifOperStatus: string;
  ifAdminStatus: string;
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

function LinkForm({ link, onSave, onClose, snmpProfiles, clients, onProfileCreated }: { 
  link?: Link; 
  onSave: (data: Partial<Link>) => void;
  onClose: () => void;
  snmpProfiles?: Array<{ id: number; name: string; clientId: number }>;
  clients?: Client[];
  onProfileCreated?: () => void;
}) {
  const { toast } = useToast();
  const [discoveredInterfaces, setDiscoveredInterfaces] = useState<SnmpInterface[]>([]);
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

  const { data: olts } = useQuery<Olt[]>({
    queryKey: ["/api/olts"],
  });
  
  const [formData, setFormData] = useState({
    clientId: link?.clientId || (clients && clients.length > 0 ? clients[0].id : 1),
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
    snmpInterfaceIndex: link?.snmpInterfaceIndex || null,
    snmpInterfaceName: link?.snmpInterfaceName || "",
    snmpInterfaceDescr: link?.snmpInterfaceDescr || "",
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
  });

  // OLTs são globais, filtrar apenas por isActive
  const filteredOlts = olts?.filter(olt => olt.isActive);

  // Buscar etiquetas de contrato do Voalle para o cliente selecionado
  const { data: voalleContractTags, isLoading: isLoadingTags, error: tagsError, refetch: refetchTags } = useQuery<{ tags: Array<{ id: number }>; cnpj?: string; error?: string }>({
    queryKey: ["/api/clients", formData.clientId, "voalle", "contract-tags"],
    enabled: !!formData.clientId,
    staleTime: 0,
    retry: false,
  });

  const { data: equipmentVendors } = useQuery<Array<{ id: number; name: string; slug: string; cpuOid: string | null; memoryOid: string | null }>>({
    queryKey: ["/api/equipment-vendors"],
  });

  const filteredSnmpProfiles = snmpProfiles?.filter(p => p.clientId === formData.clientId);

  const handleDiscoverInterfaces = async () => {
    if (!formData.snmpRouterIp || !formData.snmpProfileId) {
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
        targetIp: formData.snmpRouterIp,
        snmpProfileId: formData.snmpProfileId,
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
      setFormData({
        ...formData,
        snmpInterfaceIndex: iface.ifIndex,
        snmpInterfaceName: iface.ifName,
        snmpInterfaceDescr: iface.ifDescr,
      });
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
            <Select
              value={formData.clientId.toString()}
              onValueChange={(value) => setFormData({ ...formData, clientId: parseInt(value, 10), snmpProfileId: null })}
            >
              <SelectTrigger data-testid="select-link-client">
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
          )}
        </div>
      )}
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
          <Select
            value={formData.ipBlock}
            onValueChange={(value) => {
              const ipInfo: Record<string, { total: number; usable: number }> = {
                "/30": { total: 4, usable: 2 },
                "/29": { total: 8, usable: 6 },
                "/28": { total: 16, usable: 14 },
                "/27": { total: 32, usable: 30 },
              };
              const info = ipInfo[value] || { total: 8, usable: 6 };
              setFormData({ ...formData, ipBlock: value, totalIps: info.total, usableIps: info.usable });
            }}
          >
            <SelectTrigger data-testid="select-ip-block">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="/30">/30 (4 IPs)</SelectItem>
              <SelectItem value="/29">/29 (8 IPs)</SelectItem>
              <SelectItem value="/28">/28 (16 IPs)</SelectItem>
              <SelectItem value="/27">/27 (32 IPs)</SelectItem>
            </SelectContent>
          </Select>
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
        <div className="grid grid-cols-2 gap-4">
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
                onClick={handleDiscoverInterfaces}
                disabled={isDiscovering || !formData.snmpProfileId || !formData.snmpRouterIp}
                data-testid="button-discover-interfaces"
              >
                {isDiscovering ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Search className="w-4 h-4" />
                )}
                <span className="ml-1">Descobrir</span>
              </Button>
            </div>
          </div>
        </div>
        
        {discoveredInterfaces.length > 0 && (
          <div className="space-y-2 mt-3">
            <Label>Selecionar Interface Descoberta</Label>
            <Select
              value={formData.snmpInterfaceIndex?.toString() || ""}
              onValueChange={handleSelectInterface}
            >
              <SelectTrigger data-testid="select-discovered-interface">
                <SelectValue placeholder="Escolha uma interface..." />
              </SelectTrigger>
              <SelectContent>
                {discoveredInterfaces.map((iface) => (
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
                      {iface.ifSpeed > 0 && (
                        <span className="text-muted-foreground text-xs">
                          ({formatSpeed(iface.ifSpeed)})
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

        <div className="space-y-2 mt-3">
          <Label htmlFor="snmpCommunity">Community SNMP (sobrescreve o perfil)</Label>
          <Input
            id="snmpCommunity"
            value={formData.snmpCommunity}
            onChange={(e) => setFormData({ ...formData, snmpCommunity: e.target.value })}
            placeholder="Deixe vazio para usar a community do perfil"
            data-testid="input-snmp-community"
          />
          <p className="text-xs text-muted-foreground">Se informado, será usado ao invés da community do perfil SNMP selecionado</p>
        </div>
      </div>

      <div className="border-t pt-4 mt-4">
        <h4 className="font-medium mb-3">Equipamento de Rede</h4>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="equipmentVendorId">Fabricante</Label>
            <Select
              value={formData.equipmentVendorId?.toString() || "none"}
              onValueChange={(value) => setFormData({ ...formData, equipmentVendorId: value === "none" ? null : parseInt(value, 10) })}
            >
              <SelectTrigger data-testid="select-equipment-vendor">
                <SelectValue placeholder="Selecione o fabricante" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Nenhum / Não coletar CPU/Memória</SelectItem>
                {equipmentVendors?.map((vendor) => (
                  <SelectItem key={vendor.id} value={vendor.id.toString()}>
                    {vendor.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="equipmentModel">Modelo do Equipamento</Label>
            <Input
              id="equipmentModel"
              value={formData.equipmentModel}
              onChange={(e) => setFormData({ ...formData, equipmentModel: e.target.value })}
              placeholder="FortiGate 60F, Mikrotik RB3011, etc."
              data-testid="input-equipment-model"
            />
          </div>
        </div>
        
        {formData.equipmentVendorId && equipmentVendors?.find(v => v.id === formData.equipmentVendorId)?.slug === "custom" && (
          <div className="grid grid-cols-2 gap-4 mt-3">
            <div className="space-y-2">
              <Label htmlFor="customCpuOid">OID Customizado CPU</Label>
              <Input
                id="customCpuOid"
                value={formData.customCpuOid}
                onChange={(e) => setFormData({ ...formData, customCpuOid: e.target.value })}
                placeholder="1.3.6.1.4.1...."
                data-testid="input-custom-cpu-oid"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="customMemoryOid">OID Customizado Memória</Label>
              <Input
                id="customMemoryOid"
                value={formData.customMemoryOid}
                onChange={(e) => setFormData({ ...formData, customMemoryOid: e.target.value })}
                placeholder="1.3.6.1.4.1...."
                data-testid="input-custom-memory-oid"
              />
            </div>
          </div>
        )}
      </div>

      <div className="border-t pt-4 mt-4">
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
            <Input
              id="onuId"
              value={formData.onuId}
              onChange={(e) => setFormData({ ...formData, onuId: e.target.value })}
              placeholder="Ex: gpon-olt_1/1/3:116"
              data-testid="input-onu-id"
            />
            <p className="text-xs text-muted-foreground">Formato: gpon-olt_slot/port/pon:onu</p>
          </div>
        </div>
        {!filteredOlts?.length && formData.oltId === null && (
          <p className="text-sm text-muted-foreground mt-2">
            Nenhuma OLT cadastrada para este cliente. Acesse a aba OLTs para cadastrar.
          </p>
        )}
      </div>

      <div className="border-t pt-4 mt-4">
        <h4 className="font-medium mb-3">Integração ERP (Voalle)</h4>
        <p className="text-sm text-muted-foreground mb-3">
          Associe este link a uma etiqueta de contrato no Voalle para filtrar solicitações
        </p>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Label htmlFor="voalleContractTagId">Etiqueta de Contrato</Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => refetchTags()}
              disabled={isLoadingTags}
              data-testid="button-refresh-tags"
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
            <Select
              value={formData.voalleContractTagId?.toString() || "none"}
              onValueChange={(value) => setFormData({ ...formData, voalleContractTagId: value === "none" ? null : parseInt(value, 10) })}
            >
              <SelectTrigger data-testid="select-voalle-contract-tag">
                <SelectValue placeholder="Selecione uma etiqueta" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Nenhuma (buscar todas solicitações)</SelectItem>
                {voalleContractTags.tags.map((tag) => (
                  <SelectItem key={tag.id} value={tag.id.toString()}>
                    Etiqueta #{tag.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
            Etiquetas de contrato permitem filtrar solicitações específicas deste link
          </p>
        </div>
      </div>
      
      <div className="border-t pt-4 mt-4">
        <h4 className="font-medium mb-3">Monitoramento de Conectividade</h4>
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label htmlFor="monitoredIp">IP para Monitoramento</Label>
            <Input
              id="monitoredIp"
              value={formData.monitoredIp}
              onChange={(e) => setFormData({ ...formData, monitoredIp: e.target.value })}
              placeholder="191.52.248.26"
              data-testid="input-monitored-ip"
            />
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
        </div>
      </div>
      
      <DialogFooter>
        <Button variant="outline" onClick={onClose} data-testid="button-cancel">
          Cancelar
        </Button>
        <Button onClick={() => onSave(formData)} data-testid="button-save-link">
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
      const response = await fetch(`/api/erp-integrations/${id}/test`, { method: "POST" });
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
                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <Label>Usuário Portal</Label>
                              <Input
                                value={formData.portalUsername}
                                onChange={(e) => setFormData({ ...formData, portalUsername: e.target.value })}
                                placeholder="Usuário para autenticação"
                                data-testid="input-erp-portal-username"
                              />
                            </div>
                            <div className="space-y-2">
                              <Label>Senha Portal</Label>
                              <Input
                                type={showSecrets ? "text" : "password"}
                                value={formData.portalPassword}
                                onChange={(e) => setFormData({ ...formData, portalPassword: e.target.value })}
                                placeholder={editingIntegration ? "Deixe vazio para manter" : "Senha do usuário"}
                                data-testid="input-erp-portal-password"
                              />
                            </div>
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
  });

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

  const { data: allSnmpProfiles } = useQuery<Array<{ id: number; name: string; clientId: number }>>({
    queryKey: ["/api/snmp-profiles"],
    enabled: isSuperAdmin,
  });

  const createLinkMutation = useMutation({
    mutationFn: async (data: Partial<Link>) => {
      return await apiRequest("POST", "/api/links", data);
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
    mutationFn: async ({ id, data }: { id: number; data: Partial<Link> }) => {
      return await apiRequest("PATCH", `/api/links/${id}`, data);
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
      setClientFormData({ name: "", slug: "", cnpj: "", isActive: true, voalleCustomerId: "" });
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
      setClientFormData({ name: "", slug: "", cnpj: "", isActive: true, voalleCustomerId: "" });
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
          <TabsTrigger value="vendors" className="gap-2">
            <Cpu className="w-4 h-4" />
            Fabricantes
          </TabsTrigger>
          <TabsTrigger value="database" className="gap-2">
            <Database className="w-4 h-4" />
            Banco de Dados
          </TabsTrigger>
        </TabsList>

        <TabsContent value="links" className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-medium">Links Monitorados</h2>
              <p className="text-sm text-muted-foreground">
                Gerencie os links de internet dedicados
              </p>
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

          {linksLoading ? (
            <div className="space-y-3">
              {[1, 2].map((i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              {links?.map((link) => {
                const clientName = clients?.find(c => c.id === link.clientId)?.name;
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
              {(!links || links.length === 0) && (
                <Card>
                  <CardContent className="py-8 text-center text-muted-foreground">
                    Nenhum link cadastrado. Clique em "Adicionar Link" para comecar.
                  </CardContent>
                </Card>
              )}
            </div>
          )}

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
                  setClientFormData({ name: "", slug: "", cnpj: "", isActive: true, voalleCustomerId: "" });
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
              {clients?.map((client) => (
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

        <TabsContent value="vendors" className="space-y-4">
          <EquipmentVendorsTab />
        </TabsContent>

        <TabsContent value="database" className="space-y-4">
          <DatabaseConfigTab />
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
    role: "operator" as "admin" | "manager" | "operator",
    isActive: true,
    isSuperAdmin: false,
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
    });
  };

  const handleEditUser = (user: User) => {
    setEditingUser(user);
    setUserFormData({
      name: user.name,
      email: user.email,
      password: "",
      role: user.role as "admin" | "manager" | "operator",
      isActive: user.isActive,
      isSuperAdmin: user.isSuperAdmin || false,
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
      };
      if (userFormData.password) {
        updateData.password = userFormData.password;
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
                    <div className="space-y-2">
                      <Label>Função</Label>
                      <Select
                        value={userFormData.role}
                        onValueChange={(val) => setUserFormData({ ...userFormData, role: val as "admin" | "manager" | "operator" })}
                      >
                        <SelectTrigger data-testid="select-user-role">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="admin">Administrador</SelectItem>
                          <SelectItem value="manager">Gerente</SelectItem>
                          <SelectItem value="operator">Operador</SelectItem>
                        </SelectContent>
                      </Select>
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
                          {user.role === "admin" ? "Admin" : user.role === "manager" ? "Gerente" : "Operador"}
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

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Informacoes do Sistema</CardTitle>
            <CardDescription>
              Informacoes sobre a versao e estado do sistema
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Versao</span>
              <span className="font-mono">1.0.0</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Ambiente</span>
              <Badge variant="outline">Producao</Badge>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Banco de Dados</span>
              <Badge variant="default">Conectado</Badge>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Ultima Atualizacao</span>
              <span className="font-mono text-xs">23/12/2025</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-end">
        <Button onClick={handleSave} data-testid="button-save-system-settings">
          Salvar Configuracoes
        </Button>
      </div>
    </div>
  );
}

function OltsTab({ clients }: { clients: Client[] }) {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingOlt, setEditingOlt] = useState<Olt | undefined>(undefined);
  const [showPassword, setShowPassword] = useState<Record<number, boolean>>({});
  const [testingConnection, setTestingConnection] = useState<number | null>(null);

  const { data: oltsList, isLoading } = useQuery<Olt[]>({
    queryKey: ["/api/olts"],
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
    isActive: true,
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
      isActive: true,
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
      isActive: olt.isActive,
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
                      data-testid={`button-test-olt-${olt.id}`}
                    >
                      {testingConnection === olt.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <RefreshCw className="w-4 h-4" />
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

interface EquipmentVendor {
  id: number;
  name: string;
  slug: string;
  cpuOid: string | null;
  memoryOid: string | null;
  memoryTotalOid: string | null;
  memoryUsedOid: string | null;
  memoryIsPercentage: boolean;
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

  const [formData, setFormData] = useState({
    name: "",
    slug: "",
    cpuOid: "",
    memoryOid: "",
    memoryTotalOid: "",
    memoryUsedOid: "",
    memoryIsPercentage: true,
    description: "",
    isActive: true,
  });

  const resetForm = () => {
    setFormData({
      name: "",
      slug: "",
      cpuOid: "",
      memoryOid: "",
      memoryTotalOid: "",
      memoryUsedOid: "",
      memoryIsPercentage: true,
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
      memoryOid: vendor.memoryOid || "",
      memoryTotalOid: vendor.memoryTotalOid || "",
      memoryUsedOid: vendor.memoryUsedOid || "",
      memoryIsPercentage: vendor.memoryIsPercentage,
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
              <div className="space-y-2">
                <Label>OID de CPU (%)</Label>
                <Input
                  value={formData.cpuOid}
                  onChange={(e) => setFormData({ ...formData, cpuOid: e.target.value })}
                  placeholder="Ex: 1.3.6.1.4.1.3709.3.5.201.1.1.1.1.0"
                  className="font-mono text-sm"
                  data-testid="input-vendor-cpu-oid"
                />
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
                      {!vendor.cpuOid && !vendor.memoryOid && (
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

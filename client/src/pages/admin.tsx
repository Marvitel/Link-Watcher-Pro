import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
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
  Server,
  Settings,
  Building2,
  Users,
  Shield,
  RefreshCw,
  CheckCircle,
  XCircle,
  FileText,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import type { Link, Host, Client, User } from "@shared/schema";

function LinkForm({ link, onSave, onClose, snmpProfiles, clients }: { 
  link?: Link; 
  onSave: (data: Partial<Link>) => void;
  onClose: () => void;
  snmpProfiles?: Array<{ id: number; name: string; clientId: number }>;
  clients?: Client[];
}) {
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
  });

  const filteredSnmpProfiles = snmpProfiles?.filter(p => p.clientId === formData.clientId);

  return (
    <div className="space-y-4">
      {clients && clients.length > 1 && (
        <div className="space-y-2">
          <Label htmlFor="clientId">Cliente</Label>
          <Select
            value={formData.clientId.toString()}
            onValueChange={(value) => setFormData({ ...formData, clientId: parseInt(value, 10), snmpProfileId: null })}
          >
            <SelectTrigger data-testid="select-link-client">
              <SelectValue />
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
            <Select
              value={formData.snmpProfileId?.toString() || "none"}
              onValueChange={(value) => setFormData({ ...formData, snmpProfileId: value === "none" ? null : parseInt(value, 10) })}
            >
              <SelectTrigger data-testid="select-snmp-profile">
                <SelectValue placeholder="Selecione um perfil" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Nenhum</SelectItem>
                {filteredSnmpProfiles?.map((p) => (
                  <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="snmpRouterIp">IP do Roteador/Switch</Label>
            <Input
              id="snmpRouterIp"
              value={formData.snmpRouterIp}
              onChange={(e) => setFormData({ ...formData, snmpRouterIp: e.target.value })}
              placeholder="192.168.1.1"
              data-testid="input-snmp-router-ip"
            />
          </div>
        </div>
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
      
      <DialogFooter>
        <Button variant="outline" onClick={onClose} data-testid="button-cancel">
          Cancelar
        </Button>
        <Button onClick={() => onSave(formData)} data-testid="button-save-link">
          {link ? "Atualizar" : "Criar"} Link
        </Button>
      </DialogFooter>
    </div>
  );
}

function HostForm({ host, links, onSave, onClose }: { 
  host?: Host;
  links: Link[];
  onSave: (data: Partial<Host>) => void;
  onClose: () => void;
}) {
  const [formData, setFormData] = useState({
    linkId: host?.linkId || links[0]?.id || 0,
    clientId: host?.clientId || links[0]?.clientId || 1,
    name: host?.name || "",
    ipAddress: host?.ipAddress || "",
    hostType: host?.hostType || "server",
    description: host?.description || "",
    isActive: host?.isActive ?? true,
    latencyThreshold: host?.latencyThreshold || 80,
    packetLossThreshold: host?.packetLossThreshold || 2,
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="name">Nome do Host</Label>
          <Input
            id="name"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="Servidor Web, Roteador, etc."
            data-testid="input-host-name"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ipAddress">Endereço IP</Label>
          <Input
            id="ipAddress"
            value={formData.ipAddress}
            onChange={(e) => setFormData({ ...formData, ipAddress: e.target.value })}
            placeholder="192.168.1.1"
            data-testid="input-host-ip"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="linkId">Link Associado</Label>
          <Select
            value={formData.linkId.toString()}
            onValueChange={(value) => {
              const selectedLink = links.find(l => l.id === parseInt(value, 10));
              setFormData({ 
                ...formData, 
                linkId: parseInt(value, 10),
                clientId: selectedLink?.clientId || formData.clientId,
              });
            }}
          >
            <SelectTrigger data-testid="select-link">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {links.map((link) => (
                <SelectItem key={link.id} value={link.id.toString()}>
                  {link.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="hostType">Tipo de Host</Label>
          <Select
            value={formData.hostType}
            onValueChange={(value) => setFormData({ ...formData, hostType: value })}
          >
            <SelectTrigger data-testid="select-host-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="server">Servidor</SelectItem>
              <SelectItem value="router">Roteador</SelectItem>
              <SelectItem value="switch">Switch</SelectItem>
              <SelectItem value="firewall">Firewall</SelectItem>
              <SelectItem value="olt">OLT</SelectItem>
              <SelectItem value="other">Outro</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="description">Descrição</Label>
        <Input
          id="description"
          value={formData.description || ""}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          placeholder="Descrição opcional do host"
          data-testid="input-host-description"
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="latencyThreshold">Limiar Latência (ms)</Label>
          <Input
            id="latencyThreshold"
            type="number"
            value={formData.latencyThreshold}
            onChange={(e) => setFormData({ ...formData, latencyThreshold: parseFloat(e.target.value) || 80 })}
            data-testid="input-latency-threshold"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="packetLossThreshold">Limiar Perda (%)</Label>
          <Input
            id="packetLossThreshold"
            type="number"
            step="0.1"
            value={formData.packetLossThreshold}
            onChange={(e) => setFormData({ ...formData, packetLossThreshold: parseFloat(e.target.value) || 2 })}
            data-testid="input-packet-loss-threshold"
          />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} data-testid="button-cancel-host">
          Cancelar
        </Button>
        <Button onClick={() => onSave(formData)} data-testid="button-save-host">
          {host ? "Atualizar" : "Criar"} Host
        </Button>
      </DialogFooter>
    </div>
  );
}

interface ClientSettings {
  wanguardApiEndpoint?: string | null;
  wanguardApiUser?: string | null;
  wanguardApiPassword?: string | null;
  wanguardEnabled?: boolean;
  wanguardSyncInterval?: number;
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
  });

  useEffect(() => {
    if (settings) {
      setFormData({
        wanguardApiEndpoint: settings.wanguardApiEndpoint || "",
        wanguardApiUser: settings.wanguardApiUser || "",
        wanguardApiPassword: settings.wanguardApiPassword || "",
        wanguardEnabled: settings.wanguardEnabled || false,
        wanguardSyncInterval: settings.wanguardSyncInterval || 60,
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

  const handleSync = async () => {
    if (!selectedClientId) return;
    
    setIsSyncing(true);
    
    try {
      const response = await apiRequest("POST", `/api/clients/${selectedClientId}/wanguard/sync`);
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
                  onClick={handleSync}
                  disabled={isSyncing || !formData.wanguardEnabled}
                  data-testid="button-sync-wanguard"
                >
                  {isSyncing && <RefreshCw className="w-4 h-4 mr-2 animate-spin" />}
                  Sincronizar Agora
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

export default function Admin() {
  const { toast } = useToast();
  const { isSuperAdmin, isLoading: authLoading } = useAuth();
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [hostDialogOpen, setHostDialogOpen] = useState(false);
  const [clientDialogOpen, setClientDialogOpen] = useState(false);
  const [editingLink, setEditingLink] = useState<Link | undefined>();
  const [editingHost, setEditingHost] = useState<Host | undefined>();
  const [editingClient, setEditingClient] = useState<Client | undefined>();
  const [clientFormData, setClientFormData] = useState({
    name: "",
    slug: "",
    cnpj: "",
    isActive: true,
  });

  const { data: clients, isLoading: clientsLoading } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
    enabled: isSuperAdmin,
  });

  const { data: links, isLoading: linksLoading } = useQuery<Link[]>({
    queryKey: ["/api/links"],
    enabled: isSuperAdmin,
  });

  const { data: hosts, isLoading: hostsLoading } = useQuery<Host[]>({
    queryKey: ["/api/hosts"],
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

  const createHostMutation = useMutation({
    mutationFn: async (data: Partial<Host>) => {
      return await apiRequest("POST", "/api/hosts", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hosts"] });
      setHostDialogOpen(false);
      setEditingHost(undefined);
      toast({ title: "Host criado com sucesso" });
    },
    onError: () => {
      toast({ title: "Erro ao criar host", variant: "destructive" });
    },
  });

  const updateHostMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<Host> }) => {
      return await apiRequest("PATCH", `/api/hosts/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hosts"] });
      setHostDialogOpen(false);
      setEditingHost(undefined);
      toast({ title: "Host atualizado com sucesso" });
    },
    onError: () => {
      toast({ title: "Erro ao atualizar host", variant: "destructive" });
    },
  });

  const deleteHostMutation = useMutation({
    mutationFn: async (id: number) => {
      return await apiRequest("DELETE", `/api/hosts/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hosts"] });
      toast({ title: "Host excluído com sucesso" });
    },
    onError: () => {
      toast({ title: "Erro ao excluir host", variant: "destructive" });
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
      setClientFormData({ name: "", slug: "", cnpj: "", isActive: true });
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
      setClientFormData({ name: "", slug: "", cnpj: "", isActive: true });
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

  const handleSaveClient = () => {
    if (editingClient) {
      updateClientMutation.mutate({ id: editingClient.id, data: clientFormData });
    } else {
      createClientMutation.mutate(clientFormData);
    }
  };

  const handleEditClient = (client: Client) => {
    setEditingClient(client);
    setClientFormData({
      name: client.name,
      slug: client.slug,
      cnpj: client.cnpj || "",
      isActive: client.isActive,
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

  const handleSaveHost = (data: Partial<Host>) => {
    if (editingHost) {
      updateHostMutation.mutate({ id: editingHost.id, data });
    } else {
      createHostMutation.mutate(data);
    }
  };

  const handleEditLink = (link: Link) => {
    setEditingLink(link);
    setLinkDialogOpen(true);
  };

  const handleEditHost = (host: Host) => {
    setEditingHost(host);
    setHostDialogOpen(true);
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
          <TabsTrigger value="hosts" className="gap-2">
            <Server className="w-4 h-4" />
            Hosts
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
          <TabsTrigger value="snmp" className="gap-2">
            <Settings className="w-4 h-4" />
            SNMP
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
              <DialogContent className="max-w-lg">
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
            <div className="space-y-3">
              {links?.map((link) => (
                <Card key={link.id} data-testid={`card-admin-link-${link.id}`}>
                  <CardContent className="flex items-center justify-between gap-4 py-4">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center">
                        <Network className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <p className="font-medium">{link.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {link.location} - {link.ipBlock} - {link.bandwidth} Mbps
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
                  </CardContent>
                </Card>
              ))}
              {(!links || links.length === 0) && (
                <Card>
                  <CardContent className="py-8 text-center text-muted-foreground">
                    Nenhum link cadastrado. Clique em "Adicionar Link" para começar.
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="hosts" className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-medium">Hosts Monitorados</h2>
              <p className="text-sm text-muted-foreground">
                Gerencie os hosts e equipamentos de rede
              </p>
            </div>
            <Dialog open={hostDialogOpen} onOpenChange={(open) => {
              setHostDialogOpen(open);
              if (!open) setEditingHost(undefined);
            }}>
              <DialogTrigger asChild>
                <Button data-testid="button-add-host" disabled={!links || links.length === 0}>
                  <Plus className="w-4 h-4 mr-2" />
                  Adicionar Host
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>{editingHost ? "Editar Host" : "Novo Host"}</DialogTitle>
                </DialogHeader>
                {links && links.length > 0 && (
                  <HostForm
                    host={editingHost}
                    links={links}
                    onSave={handleSaveHost}
                    onClose={() => {
                      setHostDialogOpen(false);
                      setEditingHost(undefined);
                    }}
                  />
                )}
              </DialogContent>
            </Dialog>
          </div>

          {hostsLoading ? (
            <div className="space-y-3">
              {[1, 2].map((i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {hosts?.map((host) => {
                const link = links?.find(l => l.id === host.linkId);
                return (
                  <Card key={host.id} data-testid={`card-admin-host-${host.id}`}>
                    <CardContent className="flex items-center justify-between gap-4 py-4">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-md bg-secondary/50 flex items-center justify-center">
                          <Server className="w-5 h-5" />
                        </div>
                        <div>
                          <p className="font-medium">{host.name}</p>
                          <p className="text-sm text-muted-foreground">
                            {host.ipAddress} - {host.hostType} - Link: {link?.name || "N/A"}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={host.isActive ? "default" : "secondary"}>
                          {host.isActive ? "Ativo" : "Inativo"}
                        </Badge>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleEditHost(host)}
                          data-testid={`button-edit-host-${host.id}`}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => deleteHostMutation.mutate(host.id)}
                          data-testid={`button-delete-host-${host.id}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
              {(!hosts || hosts.length === 0) && (
                <Card>
                  <CardContent className="py-8 text-center text-muted-foreground">
                    Nenhum host cadastrado. Clique em "Adicionar Host" para começar.
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="clients" className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-medium">Clientes</h2>
              <p className="text-sm text-muted-foreground">
                Organizações cadastradas no sistema
              </p>
            </div>
            <Dialog open={clientDialogOpen} onOpenChange={(open) => {
              setClientDialogOpen(open);
              if (!open) {
                setEditingClient(undefined);
                setClientFormData({ name: "", slug: "", cnpj: "", isActive: true });
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

          <WanguardIntegration clients={clients || []} />
          <VoalleIntegration clients={clients || []} />
        </TabsContent>

        <TabsContent value="users-groups" className="space-y-4">
          <UsersAndGroupsTab clients={clients || []} />
        </TabsContent>

        <TabsContent value="snmp" className="space-y-4">
          <SnmpConfigTab clients={clients || []} />
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
  const { toast } = useToast();

  const { data: groups, isLoading: groupsLoading, refetch: refetchGroups } = useQuery<any[]>({
    queryKey: ['/api/clients', selectedClient?.id, 'groups'],
    enabled: !!selectedClient,
  });

  const { data: users, isLoading: usersLoading, refetch: refetchUsers } = useQuery<User[]>({
    queryKey: ['/api/clients', selectedClient?.id, 'users'],
    enabled: !!selectedClient,
  });

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
    mutationFn: async (data: typeof userFormData & { clientId: number }) => {
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
        isSuperAdmin: userFormData.isSuperAdmin,
      };
      if (userFormData.password) {
        updateData.password = userFormData.password;
      }
      updateUserMutation.mutate({ id: editingUser.id, data: updateData as Partial<User> });
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
            Gerencie usuários e grupos de permissões por cliente
          </p>
        </div>
        <Select
          value={selectedClient?.id?.toString() || ""}
          onValueChange={(val) => {
            const client = clients.find(c => c.id.toString() === val);
            setSelectedClient(client || null);
          }}
        >
          <SelectTrigger className="w-[280px]" data-testid="select-client-for-groups">
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
            Selecione um cliente para gerenciar seus usuários e grupos
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

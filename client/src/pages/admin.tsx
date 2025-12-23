import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
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
} from "lucide-react";
import type { Link, Host, Client, User } from "@shared/schema";

function LinkForm({ link, onSave, onClose }: { 
  link?: Link; 
  onSave: (data: Partial<Link>) => void;
  onClose: () => void;
}) {
  const [formData, setFormData] = useState({
    clientId: link?.clientId || 1,
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
  });

  return (
    <div className="space-y-4">
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

export default function Admin() {
  const { toast } = useToast();
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [hostDialogOpen, setHostDialogOpen] = useState(false);
  const [editingLink, setEditingLink] = useState<Link | undefined>();
  const [editingHost, setEditingHost] = useState<Host | undefined>();

  const { data: clients, isLoading: clientsLoading } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
  });

  const { data: links, isLoading: linksLoading } = useQuery<Link[]>({
    queryKey: ["/api/links"],
  });

  const { data: hosts, isLoading: hostsLoading } = useQuery<Host[]>({
    queryKey: ["/api/hosts"],
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Administração</h1>
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
                    <Badge variant={client.isActive ? "default" : "secondary"}>
                      {client.isActive ? "Ativo" : "Inativo"}
                    </Badge>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

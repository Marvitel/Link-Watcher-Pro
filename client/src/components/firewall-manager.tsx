import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { 
  Shield, 
  ShieldCheck, 
  ShieldOff, 
  Plus, 
  Trash2, 
  Edit, 
  Network,
  RefreshCw,
  AlertTriangle,
  Info,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { FirewallWhitelist, FirewallSettings } from "@shared/schema";

interface FirewallStatus {
  cacheSize: number;
  lastCacheUpdate: string | null;
  settings: FirewallSettings | null;
}

export function FirewallManager() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<FirewallWhitelist | null>(null);
  const [newEntry, setNewEntry] = useState({
    ipAddress: "",
    description: "",
    allowAdmin: true,
    allowSsh: true,
    allowApi: false,
    isActive: true,
  });

  const { data: status, isLoading: statusLoading } = useQuery<FirewallStatus>({
    queryKey: ["/api/firewall/status"],
    refetchInterval: 30000,
  });

  const { data: settings, isLoading: settingsLoading } = useQuery<FirewallSettings>({
    queryKey: ["/api/firewall/settings"],
  });

  const { data: whitelist, isLoading: whitelistLoading } = useQuery<FirewallWhitelist[]>({
    queryKey: ["/api/firewall/whitelist"],
  });

  const updateSettingsMutation = useMutation({
    mutationFn: async (data: Partial<FirewallSettings>) => {
      return apiRequest("PATCH", "/api/firewall/settings", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/firewall/settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/firewall/status"] });
      toast({ title: "Configurações atualizadas" });
    },
    onError: () => {
      toast({ title: "Erro ao atualizar configurações", variant: "destructive" });
    },
  });

  const addEntryMutation = useMutation({
    mutationFn: async (data: typeof newEntry) => {
      return apiRequest("POST", "/api/firewall/whitelist", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/firewall/whitelist"] });
      queryClient.invalidateQueries({ queryKey: ["/api/firewall/status"] });
      setIsAddDialogOpen(false);
      setNewEntry({ ipAddress: "", description: "", allowAdmin: true, allowSsh: true, allowApi: false, isActive: true });
      toast({ title: "Entrada adicionada com sucesso" });
    },
    onError: (error: any) => {
      const message = error?.message || "Erro desconhecido";
      console.error("[Firewall] Erro ao adicionar entrada:", error);
      toast({ 
        title: "Erro ao adicionar entrada", 
        description: message,
        variant: "destructive" 
      });
    },
  });

  const updateEntryMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<FirewallWhitelist> }) => {
      return apiRequest("PATCH", `/api/firewall/whitelist/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/firewall/whitelist"] });
      queryClient.invalidateQueries({ queryKey: ["/api/firewall/status"] });
      setEditingEntry(null);
      toast({ title: "Entrada atualizada com sucesso" });
    },
    onError: () => {
      toast({ title: "Erro ao atualizar entrada", variant: "destructive" });
    },
  });

  const deleteEntryMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/firewall/whitelist/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/firewall/whitelist"] });
      queryClient.invalidateQueries({ queryKey: ["/api/firewall/status"] });
      toast({ title: "Entrada removida com sucesso" });
    },
    onError: () => {
      toast({ title: "Erro ao remover entrada", variant: "destructive" });
    },
  });

  const handleAddEntry = () => {
    if (!newEntry.ipAddress.trim()) {
      toast({ title: "IP/CIDR é obrigatório", variant: "destructive" });
      return;
    }
    addEntryMutation.mutate(newEntry);
  };

  const handleUpdateEntry = () => {
    if (!editingEntry) return;
    updateEntryMutation.mutate({ 
      id: editingEntry.id, 
      data: {
        ipAddress: editingEntry.ipAddress,
        description: editingEntry.description,
        allowAdmin: editingEntry.allowAdmin,
        allowSsh: editingEntry.allowSsh,
        allowApi: editingEntry.allowApi,
        isActive: editingEntry.isActive,
      },
    });
  };

  if (statusLoading || settingsLoading || whitelistLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const isEnabled = settings?.enabled ?? false;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {isEnabled ? (
                <ShieldCheck className="h-5 w-5 text-green-500" />
              ) : (
                <ShieldOff className="h-5 w-5 text-muted-foreground" />
              )}
              <CardTitle>Firewall de Aplicação</CardTitle>
            </div>
            <Badge variant={isEnabled ? "default" : "secondary"}>
              {isEnabled ? "Ativo" : "Inativo"}
            </Badge>
          </div>
          <CardDescription>
            Controle de acesso por IP para rotas administrativas e SSH
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="space-y-0.5">
              <Label>Ativar Firewall</Label>
              <p className="text-sm text-muted-foreground">
                Quando ativado, apenas IPs na whitelist terão acesso às rotas protegidas
              </p>
            </div>
            <Switch
              checked={isEnabled}
              onCheckedChange={(checked) => updateSettingsMutation.mutate({ enabled: checked })}
              disabled={updateSettingsMutation.isPending}
              data-testid="switch-firewall-enabled"
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div className="space-y-0.5">
                <Label>Bloquear Admin por padrão</Label>
                <p className="text-sm text-muted-foreground">
                  Bloqueia acesso ao painel admin se IP não está na whitelist
                </p>
              </div>
              <Switch
                checked={settings?.defaultDenyAdmin ?? true}
                onCheckedChange={(checked) => updateSettingsMutation.mutate({ defaultDenyAdmin: checked })}
                disabled={updateSettingsMutation.isPending}
                data-testid="switch-deny-admin"
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border p-4">
              <div className="space-y-0.5">
                <Label>Bloquear SSH por padrão</Label>
                <p className="text-sm text-muted-foreground">
                  Bloqueia acesso ao terminal SSH se IP não está na whitelist
                </p>
              </div>
              <Switch
                checked={settings?.defaultDenySsh ?? true}
                onCheckedChange={(checked) => updateSettingsMutation.mutate({ defaultDenySsh: checked })}
                disabled={updateSettingsMutation.isPending}
                data-testid="switch-deny-ssh"
              />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="space-y-0.5">
              <Label>Registrar tentativas bloqueadas</Label>
              <p className="text-sm text-muted-foreground">
                Grava no log do sistema quando um acesso é bloqueado
              </p>
            </div>
            <Switch
              checked={settings?.logBlockedAttempts ?? true}
              onCheckedChange={(checked) => updateSettingsMutation.mutate({ logBlockedAttempts: checked })}
              disabled={updateSettingsMutation.isPending}
              data-testid="switch-log-blocked"
            />
          </div>

          {status && (
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <div className="flex items-center gap-1">
                <Network className="h-4 w-4" />
                <span>{status.cacheSize} entradas em cache</span>
              </div>
              {status.lastCacheUpdate && (
                <div className="flex items-center gap-1">
                  <RefreshCw className="h-4 w-4" />
                  <span>
                    Atualizado em {format(new Date(status.lastCacheUpdate), "HH:mm:ss", { locale: ptBR })}
                  </span>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Whitelist de IPs
              </CardTitle>
              <CardDescription>
                IPs e redes permitidos para acesso às áreas protegidas
              </CardDescription>
            </div>
            <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
              <DialogTrigger asChild>
                <Button data-testid="button-add-whitelist">
                  <Plus className="mr-2 h-4 w-4" />
                  Adicionar
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Adicionar IP à Whitelist</DialogTitle>
                  <DialogDescription>
                    Adicione um IP individual ou uma rede CIDR para permitir acesso
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label>IP ou CIDR</Label>
                    <Input
                      placeholder="192.168.1.1 ou 10.0.0.0/8"
                      value={newEntry.ipAddress}
                      onChange={(e) => setNewEntry({ ...newEntry, ipAddress: e.target.value })}
                      data-testid="input-ip-address"
                    />
                    <p className="text-xs text-muted-foreground">
                      IPv4: 192.168.1.100 ou 192.168.1.0/24 | IPv6: 2001:db8::1 ou 2001:db8::/32
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label>Descrição</Label>
                    <Textarea
                      placeholder="Ex: Escritório central, VPN corporativa..."
                      value={newEntry.description || ""}
                      onChange={(e) => setNewEntry({ ...newEntry, description: e.target.value })}
                      data-testid="input-description"
                    />
                  </div>
                  <div className="flex items-center justify-between rounded-lg border p-3">
                    <Label>Permitir acesso Admin</Label>
                    <Switch
                      checked={newEntry.allowAdmin}
                      onCheckedChange={(checked) => setNewEntry({ ...newEntry, allowAdmin: checked })}
                      data-testid="switch-new-allow-admin"
                    />
                  </div>
                  <div className="flex items-center justify-between rounded-lg border p-3">
                    <Label>Permitir acesso SSH</Label>
                    <Switch
                      checked={newEntry.allowSsh}
                      onCheckedChange={(checked) => setNewEntry({ ...newEntry, allowSsh: checked })}
                      data-testid="switch-new-allow-ssh"
                    />
                  </div>
                  <div className="flex items-center justify-between rounded-lg border p-3">
                    <Label>Ativo</Label>
                    <Switch
                      checked={newEntry.isActive}
                      onCheckedChange={(checked) => setNewEntry({ ...newEntry, isActive: checked })}
                      data-testid="switch-new-active"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                    Cancelar
                  </Button>
                  <Button 
                    onClick={handleAddEntry} 
                    disabled={addEntryMutation.isPending}
                    data-testid="button-confirm-add"
                  >
                    {addEntryMutation.isPending ? "Adicionando..." : "Adicionar"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {!whitelist || whitelist.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Info className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium">Nenhum IP na whitelist</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Adicione IPs ou redes para permitir acesso às áreas protegidas
              </p>
              {isEnabled && (
                <div className="mt-4 flex items-center gap-2 text-amber-500">
                  <AlertTriangle className="h-4 w-4" />
                  <span className="text-sm">Firewall ativo sem whitelist pode bloquear todos os acessos!</span>
                </div>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>IP/CIDR</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead className="text-center">Admin</TableHead>
                  <TableHead className="text-center">SSH</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {whitelist.map((entry) => (
                  <TableRow key={entry.id} data-testid={`row-whitelist-${entry.id}`}>
                    <TableCell className="font-mono">{entry.ipAddress}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {entry.description || "-"}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant={entry.allowAdmin ? "default" : "secondary"}>
                        {entry.allowAdmin ? "Sim" : "Não"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant={entry.allowSsh ? "default" : "secondary"}>
                        {entry.allowSsh ? "Sim" : "Não"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant={entry.isActive ? "default" : "outline"}>
                        {entry.isActive ? "Ativo" : "Inativo"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Dialog open={editingEntry?.id === entry.id} onOpenChange={(open) => !open && setEditingEntry(null)}>
                          <DialogTrigger asChild>
                            <Button 
                              variant="ghost" 
                              size="icon"
                              onClick={() => setEditingEntry(entry)}
                              data-testid={`button-edit-${entry.id}`}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader>
                              <DialogTitle>Editar Entrada</DialogTitle>
                            </DialogHeader>
                            {editingEntry && (
                              <div className="space-y-4 py-4">
                                <div className="space-y-2">
                                  <Label>IP ou CIDR</Label>
                                  <Input
                                    value={editingEntry.ipAddress}
                                    onChange={(e) => setEditingEntry({ ...editingEntry, ipAddress: e.target.value })}
                                    data-testid="input-edit-ip"
                                  />
                                </div>
                                <div className="space-y-2">
                                  <Label>Descrição</Label>
                                  <Textarea
                                    value={editingEntry.description || ""}
                                    onChange={(e) => setEditingEntry({ ...editingEntry, description: e.target.value })}
                                    data-testid="input-edit-description"
                                  />
                                </div>
                                <div className="flex items-center justify-between rounded-lg border p-3">
                                  <Label>Permitir acesso Admin</Label>
                                  <Switch
                                    checked={editingEntry.allowAdmin ?? true}
                                    onCheckedChange={(checked) => setEditingEntry({ ...editingEntry, allowAdmin: checked })}
                                    data-testid="switch-edit-admin"
                                  />
                                </div>
                                <div className="flex items-center justify-between rounded-lg border p-3">
                                  <Label>Permitir acesso SSH</Label>
                                  <Switch
                                    checked={editingEntry.allowSsh ?? true}
                                    onCheckedChange={(checked) => setEditingEntry({ ...editingEntry, allowSsh: checked })}
                                    data-testid="switch-edit-ssh"
                                  />
                                </div>
                                <div className="flex items-center justify-between rounded-lg border p-3">
                                  <Label>Ativo</Label>
                                  <Switch
                                    checked={editingEntry.isActive ?? true}
                                    onCheckedChange={(checked) => setEditingEntry({ ...editingEntry, isActive: checked })}
                                    data-testid="switch-edit-active"
                                  />
                                </div>
                              </div>
                            )}
                            <DialogFooter>
                              <Button variant="outline" onClick={() => setEditingEntry(null)}>
                                Cancelar
                              </Button>
                              <Button 
                                onClick={handleUpdateEntry}
                                disabled={updateEntryMutation.isPending}
                                data-testid="button-confirm-edit"
                              >
                                {updateEntryMutation.isPending ? "Salvando..." : "Salvar"}
                              </Button>
                            </DialogFooter>
                          </DialogContent>
                        </Dialog>

                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button 
                              variant="ghost" 
                              size="icon"
                              data-testid={`button-delete-${entry.id}`}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Remover entrada?</AlertDialogTitle>
                              <AlertDialogDescription>
                                O IP <span className="font-mono font-bold">{entry.ipAddress}</span> será removido da whitelist.
                                {entry.description && (
                                  <span className="block mt-2 text-muted-foreground">
                                    Descrição: {entry.description}
                                  </span>
                                )}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => deleteEntryMutation.mutate(entry.id)}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                data-testid={`button-confirm-delete-${entry.id}`}
                              >
                                Remover
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
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

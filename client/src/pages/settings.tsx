import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Bell,
  Mail,
  Phone,
  Clock,
  Globe,
  Shield,
  Building,
  FileText,
  Save,
  Loader2,
} from "lucide-react";
import { useTheme } from "@/lib/theme";
import { useClientContext } from "@/lib/client-context";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";
import type { ClientSettings, Client } from "@shared/schema";

export default function Settings() {
  const { theme, toggleTheme } = useTheme();
  const { selectedClientId, selectedClientName } = useClientContext();
  const { toast } = useToast();

  const [formData, setFormData] = useState({
    contractDuration: 12,
    contractMonthlyValue: 0,
    contractAnnualValue: 0,
    contractBidNumber: "",
    supportPhone: "",
    supportEmail: "",
    supportPortalUrl: "",
    supportResponseTime: 3,
    supportRepairTime: 6,
    notificationEmail: "",
    notificationSms: "",
    notifyEmailEnabled: true,
    notifySmsEnabled: false,
    notifyDdosEnabled: true,
    autoRefreshInterval: 5,
  });

  const settingsUrl = selectedClientId 
    ? `/api/clients/${selectedClientId}/settings` 
    : null;

  const { data: settings, isLoading: settingsLoading } = useQuery<ClientSettings>({
    queryKey: [settingsUrl],
    enabled: !!selectedClientId,
  });

  const { data: client } = useQuery<Client>({
    queryKey: [`/api/clients/${selectedClientId}`],
    enabled: !!selectedClientId,
  });

  useEffect(() => {
    if (settings) {
      setFormData({
        contractDuration: settings.contractDuration || 12,
        contractMonthlyValue: settings.contractMonthlyValue || 0,
        contractAnnualValue: settings.contractAnnualValue || 0,
        contractBidNumber: settings.contractBidNumber || "",
        supportPhone: settings.supportPhone || "",
        supportEmail: settings.supportEmail || "",
        supportPortalUrl: settings.supportPortalUrl || "",
        supportResponseTime: settings.supportResponseTime || 3,
        supportRepairTime: settings.supportRepairTime || 6,
        notificationEmail: settings.notificationEmail || "",
        notificationSms: settings.notificationSms || "",
        notifyEmailEnabled: settings.notifyEmailEnabled ?? true,
        notifySmsEnabled: settings.notifySmsEnabled ?? false,
        notifyDdosEnabled: settings.notifyDdosEnabled ?? true,
        autoRefreshInterval: settings.autoRefreshInterval || 5,
      });
    }
  }, [settings]);

  const updateSettingsMutation = useMutation({
    mutationFn: async (data: Partial<ClientSettings>) => {
      return apiRequest("PATCH", `/api/clients/${selectedClientId}/settings`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [settingsUrl] });
      toast({
        title: "Configurações salvas",
        description: "As alterações foram aplicadas com sucesso.",
      });
    },
    onError: () => {
      toast({
        title: "Erro ao salvar",
        description: "Não foi possível salvar as configurações.",
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    updateSettingsMutation.mutate(formData);
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(value);
  };

  if (!selectedClientId) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-4">
          <Building className="w-16 h-16 mx-auto text-muted-foreground" />
          <div>
            <h2 className="text-xl font-semibold">Selecione um Cliente</h2>
            <p className="text-muted-foreground">
              Para visualizar as configurações, selecione um cliente no painel de administração.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (settingsLoading) {
    return (
      <div className="space-y-6">
        <div>
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-72 mt-2" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-6 w-40" />
              </CardHeader>
              <CardContent className="space-y-4">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Configurações</h1>
          <p className="text-muted-foreground">
            Configurações do cliente: {selectedClientName || client?.name}
          </p>
        </div>
        <Button onClick={handleSave} disabled={updateSettingsMutation.isPending} data-testid="button-save-settings">
          {updateSettingsMutation.isPending ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Save className="w-4 h-4 mr-2" />
          )}
          Salvar Alterações
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Bell className="w-5 h-5" />
              Notificações
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="notificationEmail">E-mail para Alertas</Label>
              <Input
                id="notificationEmail"
                type="email"
                value={formData.notificationEmail}
                onChange={(e) => setFormData({ ...formData, notificationEmail: e.target.value })}
                placeholder="alertas@empresa.com.br"
                data-testid="input-notification-email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="notificationSms">Telefone para SMS</Label>
              <Input
                id="notificationSms"
                value={formData.notificationSms}
                onChange={(e) => setFormData({ ...formData, notificationSms: e.target.value })}
                placeholder="(79) 99999-9999"
                data-testid="input-notification-sms"
              />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Mail className="w-4 h-4 text-muted-foreground" />
                <div>
                  <p className="font-medium">Alertas por E-mail</p>
                  <p className="text-sm text-muted-foreground">Receber alertas críticos</p>
                </div>
              </div>
              <Switch
                checked={formData.notifyEmailEnabled}
                onCheckedChange={(checked) => setFormData({ ...formData, notifyEmailEnabled: checked })}
                data-testid="switch-email-alerts"
              />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Phone className="w-4 h-4 text-muted-foreground" />
                <div>
                  <p className="font-medium">Alertas por SMS</p>
                  <p className="text-sm text-muted-foreground">Para indisponibilidades</p>
                </div>
              </div>
              <Switch
                checked={formData.notifySmsEnabled}
                onCheckedChange={(checked) => setFormData({ ...formData, notifySmsEnabled: checked })}
                data-testid="switch-sms-alerts"
              />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Shield className="w-4 h-4 text-muted-foreground" />
                <div>
                  <p className="font-medium">Alertas de DDoS</p>
                  <p className="text-sm text-muted-foreground">Notificar ataques detectados</p>
                </div>
              </div>
              <Switch
                checked={formData.notifyDdosEnabled}
                onCheckedChange={(checked) => setFormData({ ...formData, notifyDdosEnabled: checked })}
                data-testid="switch-ddos-alerts"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Globe className="w-5 h-5" />
              Aparência e Sistema
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Modo Escuro</p>
                <p className="text-sm text-muted-foreground">
                  Alternar entre tema claro e escuro
                </p>
              </div>
              <Switch
                checked={theme === "dark"}
                onCheckedChange={toggleTheme}
                data-testid="switch-dark-mode"
              />
            </div>
            <Separator />
            <div className="space-y-2">
              <Label htmlFor="autoRefreshInterval">Intervalo de Atualização (minutos)</Label>
              <Input
                id="autoRefreshInterval"
                type="number"
                min={1}
                max={60}
                value={formData.autoRefreshInterval}
                onChange={(e) => setFormData({ ...formData, autoRefreshInterval: parseInt(e.target.value) || 5 })}
                data-testid="input-refresh-interval"
              />
              <p className="text-xs text-muted-foreground">
                Define o intervalo de atualização automática dos dados
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <FileText className="w-5 h-5" />
              Informações do Contrato
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between flex-wrap gap-2">
              <span className="text-muted-foreground">Contratante</span>
              <span className="font-medium text-right">{selectedClientName || client?.name}</span>
            </div>
            <Separator />
            <div className="space-y-2">
              <Label htmlFor="contractDuration">Vigência (meses)</Label>
              <Input
                id="contractDuration"
                type="number"
                value={formData.contractDuration}
                onChange={(e) => setFormData({ ...formData, contractDuration: parseInt(e.target.value) || 12 })}
                data-testid="input-contract-duration"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contractMonthlyValue">Valor Mensal (R$)</Label>
              <Input
                id="contractMonthlyValue"
                type="number"
                step="0.01"
                value={formData.contractMonthlyValue}
                onChange={(e) => {
                  const monthly = parseFloat(e.target.value) || 0;
                  setFormData({
                    ...formData,
                    contractMonthlyValue: monthly,
                    contractAnnualValue: monthly * (formData.contractDuration || 12),
                  });
                }}
                data-testid="input-contract-monthly"
              />
            </div>
            <div className="flex justify-between flex-wrap gap-2">
              <span className="text-muted-foreground">Valor Anual</span>
              <span className="font-mono">{formatCurrency(formData.contractAnnualValue)}</span>
            </div>
            <Separator />
            <div className="space-y-2">
              <Label htmlFor="contractBidNumber">Pregão/Licitação</Label>
              <Input
                id="contractBidNumber"
                value={formData.contractBidNumber}
                onChange={(e) => setFormData({ ...formData, contractBidNumber: e.target.value })}
                placeholder="007/2025"
                data-testid="input-contract-bid"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Building className="w-5 h-5" />
              Suporte Técnico
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="supportPhone">Telefone de Suporte</Label>
              <Input
                id="supportPhone"
                value={formData.supportPhone}
                onChange={(e) => setFormData({ ...formData, supportPhone: e.target.value })}
                placeholder="0800 XXX XXXX"
                data-testid="input-support-phone"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="supportEmail">E-mail de Suporte</Label>
              <Input
                id="supportEmail"
                type="email"
                value={formData.supportEmail}
                onChange={(e) => setFormData({ ...formData, supportEmail: e.target.value })}
                placeholder="suporte@empresa.com.br"
                data-testid="input-support-email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="supportPortalUrl">Portal de Chamados</Label>
              <Input
                id="supportPortalUrl"
                value={formData.supportPortalUrl}
                onChange={(e) => setFormData({ ...formData, supportPortalUrl: e.target.value })}
                placeholder="https://suporte.empresa.com.br"
                data-testid="input-support-portal"
              />
            </div>
            <Separator />
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="supportResponseTime">Tempo de Resposta (h)</Label>
                <Input
                  id="supportResponseTime"
                  type="number"
                  value={formData.supportResponseTime}
                  onChange={(e) => setFormData({ ...formData, supportResponseTime: parseInt(e.target.value) || 3 })}
                  data-testid="input-response-time"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="supportRepairTime">Tempo de Reparo (h)</Label>
                <Input
                  id="supportRepairTime"
                  type="number"
                  value={formData.supportRepairTime}
                  onChange={(e) => setFormData({ ...formData, supportRepairTime: parseInt(e.target.value) || 6 })}
                  data-testid="input-repair-time"
                />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Clock className="w-5 h-5" />
            Resumo de Atendimento
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            Parâmetros de SLA/ANS configurados para este cliente:
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 rounded-md bg-muted/50">
              <Phone className="w-5 h-5 mb-2 text-primary" />
              <p className="font-medium">Telefone</p>
              <p className="text-sm text-muted-foreground">
                {formData.supportPhone || "Não configurado"}
              </p>
            </div>
            <div className="p-4 rounded-md bg-muted/50">
              <Mail className="w-5 h-5 mb-2 text-primary" />
              <p className="font-medium">E-mail</p>
              <p className="text-sm text-muted-foreground">
                {formData.supportEmail || "Não configurado"}
              </p>
            </div>
            <div className="p-4 rounded-md bg-muted/50">
              <Globe className="w-5 h-5 mb-2 text-primary" />
              <p className="font-medium">Portal Web</p>
              <p className="text-sm text-muted-foreground">
                {formData.supportPortalUrl ? "Configurado" : "Não configurado"}
              </p>
            </div>
          </div>
          <div className="mt-4 p-4 rounded-md border border-amber-500/30 bg-amber-500/5">
            <p className="text-sm">
              <strong>Prazo de Atendimento:</strong> Resolução em até {formData.supportResponseTime} horas. Prazo de reparo
              máximo: {formData.supportRepairTime} horas.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

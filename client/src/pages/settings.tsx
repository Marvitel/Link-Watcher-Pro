import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Bell,
  Mail,
  Phone,
  Clock,
  Globe,
  Shield,
  User,
  Building,
} from "lucide-react";
import { useTheme } from "@/lib/theme";

export default function Settings() {
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Configurações</h1>
        <p className="text-muted-foreground">
          Gerencie as configurações do sistema de monitoramento
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <User className="w-5 h-5" />
              Perfil do Usuário
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nome</Label>
              <Input id="name" defaultValue="Administrador DTI" data-testid="input-name" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input id="email" type="email" defaultValue="dti@defensoria.se.def.br" data-testid="input-email" />
            </div>
            <Button data-testid="button-save-profile">Salvar Alterações</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Bell className="w-5 h-5" />
              Notificações
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Mail className="w-4 h-4 text-muted-foreground" />
                <div>
                  <p className="font-medium">Alertas por E-mail</p>
                  <p className="text-sm text-muted-foreground">Receber alertas críticos</p>
                </div>
              </div>
              <Switch defaultChecked data-testid="switch-email-alerts" />
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
              <Switch data-testid="switch-sms-alerts" />
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
              <Switch defaultChecked data-testid="switch-ddos-alerts" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Globe className="w-5 h-5" />
              Aparência
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
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Clock className="w-4 h-4 text-muted-foreground" />
                <div>
                  <p className="font-medium">Atualização Automática</p>
                  <p className="text-sm text-muted-foreground">Intervalo de 5 minutos</p>
                </div>
              </div>
              <Switch defaultChecked data-testid="switch-auto-refresh" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Building className="w-5 h-5" />
              Informações do Contrato
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Contratante</span>
              <span className="font-medium text-right">Defensoria Pública do Estado de Sergipe</span>
            </div>
            <Separator />
            <div className="flex justify-between">
              <span className="text-muted-foreground">Vigência</span>
              <span className="font-mono">12 meses</span>
            </div>
            <Separator />
            <div className="flex justify-between">
              <span className="text-muted-foreground">Valor Mensal</span>
              <span className="font-mono">R$ 32.946,80</span>
            </div>
            <Separator />
            <div className="flex justify-between">
              <span className="text-muted-foreground">Valor Anual</span>
              <span className="font-mono">R$ 395.361,60</span>
            </div>
            <Separator />
            <div className="flex justify-between">
              <span className="text-muted-foreground">Pregão</span>
              <span className="font-medium">007/2025</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Suporte Técnico</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            Conforme item 6 do Termo de Referência, o suporte técnico é disponibilizado 24x7:
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 rounded-md bg-muted/50">
              <Phone className="w-5 h-5 mb-2 text-primary" />
              <p className="font-medium">Telefone (0800)</p>
              <p className="text-sm text-muted-foreground">Atendimento 24h</p>
            </div>
            <div className="p-4 rounded-md bg-muted/50">
              <Mail className="w-5 h-5 mb-2 text-primary" />
              <p className="font-medium">E-mail</p>
              <p className="text-sm text-muted-foreground">suporte@contratada.com.br</p>
            </div>
            <div className="p-4 rounded-md bg-muted/50">
              <Globe className="w-5 h-5 mb-2 text-primary" />
              <p className="font-medium">Portal Web</p>
              <p className="text-sm text-muted-foreground">Abertura de chamados</p>
            </div>
          </div>
          <div className="mt-4 p-4 rounded-md border border-amber-500/30 bg-amber-500/5">
            <p className="text-sm">
              <strong>Prazo de Atendimento:</strong> Resolução em até 3 horas. Prazo de reparo
              máximo: 6 horas.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

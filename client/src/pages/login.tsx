import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { Network, LogIn, Building2, KeyRound, Mail } from "lucide-react";

export default function Login() {
  const { toast } = useToast();
  const { login, loginVoalle, recoverPasswordVoalle } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [cpfCnpj, setCpfCnpj] = useState("");
  const [voallePassword, setVoallePassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);
  const [recoveryUsername, setRecoveryUsername] = useState("");
  const [isRecovering, setIsRecovering] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      toast({ title: "Preencha todos os campos", variant: "destructive" });
      return;
    }
    
    setIsLoading(true);
    const result = await login(email, password);
    setIsLoading(false);
    
    if (result.success) {
      toast({ title: "Login realizado com sucesso" });
    } else {
      toast({ 
        title: "Erro ao fazer login", 
        description: result.error || "Verifique suas credenciais",
        variant: "destructive" 
      });
    }
  };

  const handleVoalleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cpfCnpj || !voallePassword) {
      toast({ title: "Preencha CPF/CNPJ e senha", variant: "destructive" });
      return;
    }
    
    setIsLoading(true);
    const result = await loginVoalle(cpfCnpj, voallePassword);
    setIsLoading(false);
    
    if (result.success) {
      toast({ title: "Login realizado com sucesso" });
    } else {
      toast({ 
        title: "Erro ao fazer login", 
        description: result.error || "Verifique suas credenciais",
        variant: "destructive" 
      });
      
      if (result.canRecover) {
        setShowRecovery(true);
        setRecoveryUsername(cpfCnpj);
      }
    }
  };

  const handleRecovery = async () => {
    if (!recoveryUsername) {
      toast({ title: "Informe o CPF/CNPJ", variant: "destructive" });
      return;
    }
    
    setIsRecovering(true);
    const result = await recoverPasswordVoalle(recoveryUsername);
    setIsRecovering(false);
    
    if (result.success) {
      toast({ 
        title: "Email enviado", 
        description: result.message || "Verifique sua caixa de entrada"
      });
      setShowRecovery(false);
    } else {
      toast({ 
        title: "Erro ao recuperar senha", 
        description: result.error,
        variant: "destructive" 
      });
    }
  };

  if (showRecovery) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <div className="p-3 rounded-full bg-primary/10">
                <KeyRound className="w-8 h-8 text-primary" />
              </div>
            </div>
            <CardTitle className="text-2xl">Recuperar Senha</CardTitle>
            <CardDescription>
              Informe seu CPF/CNPJ para receber um email com a nova senha
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="recovery-username">CPF/CNPJ</Label>
              <Input
                id="recovery-username"
                type="text"
                placeholder="Seu CPF ou CNPJ"
                value={recoveryUsername}
                onChange={(e) => setRecoveryUsername(e.target.value)}
                data-testid="input-recovery-username"
              />
            </div>
            <Button 
              className="w-full" 
              onClick={handleRecovery}
              disabled={isRecovering}
              data-testid="button-recover"
            >
              {isRecovering ? (
                "Enviando..."
              ) : (
                <>
                  <Mail className="w-4 h-4 mr-2" />
                  Enviar Email de Recuperação
                </>
              )}
            </Button>
            <Button 
              variant="outline" 
              className="w-full" 
              onClick={() => setShowRecovery(false)}
              data-testid="button-back-login"
            >
              Voltar ao Login
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="p-3 rounded-full bg-primary/10">
              <Network className="w-8 h-8 text-primary" />
            </div>
          </div>
          <CardTitle className="text-2xl">Link Monitor</CardTitle>
          <CardDescription>
            Sistema de Monitoramento de Links - Marvitel Telecomunicações
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="cliente" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="cliente" data-testid="tab-cliente">
                <Building2 className="w-4 h-4 mr-2" />
                Cliente
              </TabsTrigger>
              <TabsTrigger value="admin" data-testid="tab-admin">
                <LogIn className="w-4 h-4 mr-2" />
                Administrador
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="cliente" className="space-y-4 mt-4">
              <form onSubmit={handleVoalleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="cpfcnpj">CPF/CNPJ</Label>
                  <Input
                    id="cpfcnpj"
                    type="text"
                    placeholder="Seu CPF ou CNPJ"
                    value={cpfCnpj}
                    onChange={(e) => setCpfCnpj(e.target.value)}
                    data-testid="input-cpfcnpj"
                  />
                  <p className="text-xs text-muted-foreground">
                    Use o CPF/CNPJ cadastrado no seu contrato
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="voalle-password">Senha</Label>
                  <Input
                    id="voalle-password"
                    type="password"
                    placeholder="Sua senha do portal"
                    value={voallePassword}
                    onChange={(e) => setVoallePassword(e.target.value)}
                    data-testid="input-voalle-password"
                  />
                  <p className="text-xs text-muted-foreground">
                    Primeiro acesso? Use seu CPF/CNPJ como senha
                  </p>
                </div>
                <Button 
                  type="submit" 
                  className="w-full" 
                  disabled={isLoading}
                  data-testid="button-login-voalle"
                >
                  {isLoading ? (
                    "Entrando..."
                  ) : (
                    <>
                      <LogIn className="w-4 h-4 mr-2" />
                      Entrar
                    </>
                  )}
                </Button>
                <Button 
                  type="button"
                  variant="ghost" 
                  className="w-full text-muted-foreground" 
                  onClick={() => {
                    setShowRecovery(true);
                    setRecoveryUsername(cpfCnpj);
                  }}
                  data-testid="button-forgot-password"
                >
                  <KeyRound className="w-4 h-4 mr-2" />
                  Esqueci minha senha
                </Button>
              </form>
            </TabsContent>
            
            <TabsContent value="admin" className="space-y-4 mt-4">
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Usuário</Label>
                  <Input
                    id="email"
                    type="text"
                    placeholder="usuario ou email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    data-testid="input-email"
                  />
                  <p className="text-xs text-muted-foreground">
                    Use seu usuário RADIUS ou email cadastrado
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Senha</Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="Sua senha"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    data-testid="input-password"
                  />
                </div>
                <Button 
                  type="submit" 
                  className="w-full" 
                  disabled={isLoading}
                  data-testid="button-login"
                >
                  {isLoading ? (
                    "Entrando..."
                  ) : (
                    <>
                      <LogIn className="w-4 h-4 mr-2" />
                      Entrar
                    </>
                  )}
                </Button>
              </form>
              <div className="mt-4 text-center text-sm text-muted-foreground">
                <p>Super Admin: admin@marvitel.com.br / marvitel123</p>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

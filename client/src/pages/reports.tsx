import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SLAIndicators } from "@/components/sla-indicators";
import { useClientContext } from "@/lib/client-context";
import { exportToPDF, exportToCSV } from "@/lib/export-utils";
import { useToast } from "@/hooks/use-toast";
import {
  FileText,
  Download,
  Calendar,
  TrendingUp,
  BarChart3,
  Loader2,
} from "lucide-react";
import type { SLAIndicator, DashboardStats, Link } from "@shared/schema";
import { useState } from "react";

export default function Reports() {
  const { selectedClientId, selectedClientName } = useClientContext();
  const { toast } = useToast();
  const [exporting, setExporting] = useState<"pdf" | "csv" | null>(null);
  
  const slaUrl = selectedClientId ? `/api/sla?clientId=${selectedClientId}` : "/api/sla";
  const statsUrl = selectedClientId ? `/api/stats?clientId=${selectedClientId}` : "/api/stats";
  const linksUrl = selectedClientId ? `/api/links?clientId=${selectedClientId}` : "/api/links";
  
  const { data: slaIndicators, isLoading: slaLoading } = useQuery<SLAIndicator[]>({
    queryKey: [slaUrl],
    refetchInterval: 30000,
  });

  const { data: stats } = useQuery<DashboardStats>({
    queryKey: [statsUrl],
  });

  const { data: links } = useQuery<Link[]>({
    queryKey: [linksUrl],
  });

  const handleExport = (type: "pdf" | "csv") => {
    if (!slaIndicators || !stats || !links) {
      toast({
        title: "Dados não disponíveis",
        description: "Aguarde o carregamento dos dados antes de exportar.",
        variant: "destructive",
      });
      return;
    }

    setExporting(type);
    
    const reportData = {
      clientName: selectedClientName || "Todos os Clientes",
      slaIndicators,
      stats,
      links,
      generatedAt: new Date(),
    };

    try {
      if (type === "pdf") {
        exportToPDF(reportData);
      } else {
        exportToCSV(reportData);
      }
      toast({
        title: "Relatório exportado",
        description: `O relatório foi baixado em formato ${type.toUpperCase()}.`,
      });
    } catch (error) {
      toast({
        title: "Erro ao exportar",
        description: "Não foi possível gerar o relatório.",
        variant: "destructive",
      });
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Relatórios</h1>
          <p className="text-muted-foreground">
            Relatórios de desempenho e indicadores SLA/ANS
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => handleExport("pdf")}
            disabled={exporting !== null}
            data-testid="button-export-pdf"
          >
            {exporting === "pdf" ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Download className="w-4 h-4 mr-2" />
            )}
            Exportar PDF
          </Button>
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => handleExport("csv")}
            disabled={exporting !== null}
            data-testid="button-export-csv"
          >
            {exporting === "csv" ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Download className="w-4 h-4 mr-2" />
            )}
            Exportar CSV
          </Button>
        </div>
      </div>

      <Tabs defaultValue="sla" className="space-y-4">
        <TabsList>
          <TabsTrigger value="sla" data-testid="tab-sla">
            <TrendingUp className="w-4 h-4 mr-2" />
            Indicadores SLA
          </TabsTrigger>
          <TabsTrigger value="performance" data-testid="tab-performance">
            <BarChart3 className="w-4 h-4 mr-2" />
            Desempenho
          </TabsTrigger>
          <TabsTrigger value="monthly" data-testid="tab-monthly">
            <Calendar className="w-4 h-4 mr-2" />
            Relatório Mensal
          </TabsTrigger>
        </TabsList>

        <TabsContent value="sla" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Acordo de Nível de Serviço (ANS/SLA)</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Conforme especificado no item 5.2 do Termo de Referência, os serviços são
                monitorados pelos seguintes indicadores:
              </p>
              {slaLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Card key={i}>
                      <CardHeader className="pb-2">
                        <Skeleton className="h-4 w-32" />
                      </CardHeader>
                      <CardContent>
                        <Skeleton className="h-8 w-24 mb-2" />
                        <Skeleton className="h-2 w-full" />
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : (
                <SLAIndicators indicators={slaIndicators || []} />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Fórmulas de Cálculo</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="p-4 rounded-md bg-muted/50">
                  <h4 className="font-medium mb-2">Disponibilidade do Enlace (DE)</h4>
                  <p className="font-mono text-sm mb-2">D = [(To - Ti) / To] x 100</p>
                  <p className="text-sm text-muted-foreground">
                    To = Minutos no mês; Ti = Tempo de inoperância em minutos
                  </p>
                </div>
                <div className="p-4 rounded-md bg-muted/50">
                  <h4 className="font-medium mb-2">Taxa de Erro de Bit (TEB)</h4>
                  <p className="font-mono text-sm mb-2">TEB = (NBE / NTB) x 100</p>
                  <p className="text-sm text-muted-foreground">
                    NBE = Bits com erro; NTB = Total de bits
                  </p>
                </div>
                <div className="p-4 rounded-md bg-muted/50">
                  <h4 className="font-medium mb-2">Descarte de Pacotes (DP)</h4>
                  <p className="font-mono text-sm mb-2">PP = [(NPorig - NPdest) / NPdest] x 100</p>
                  <p className="text-sm text-muted-foreground">
                    NPorig = Pacotes origem; NPdest = Pacotes destino
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="performance" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-4">
                <p className="text-sm text-muted-foreground">Disponibilidade Média</p>
                <p className="text-2xl font-semibold font-mono">
                  {(stats?.averageUptime || 99.5).toFixed(2)}%
                </p>
                <p className="text-xs text-green-600 dark:text-green-400">Meta: ≥ 99%</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-sm text-muted-foreground">Latência Média</p>
                <p className="text-2xl font-semibold font-mono">
                  {(stats?.averageLatency || 45).toFixed(1)} ms
                </p>
                <p className="text-xs text-green-600 dark:text-green-400">Meta: ≤ 80ms</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-sm text-muted-foreground">Perda de Pacotes (núcleo)</p>
                <p className="text-2xl font-semibold font-mono">0.3%</p>
                <p className="text-xs text-green-600 dark:text-green-400">Meta: &lt; 1%</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-sm text-muted-foreground">Latência Máxima (núcleo)</p>
                <p className="text-2xl font-semibold font-mono">72 ms</p>
                <p className="text-xs text-green-600 dark:text-green-400">Meta: ≤ 100ms</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Indicadores de Desempenho do Backbone</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Conforme item 5.2.2 do Termo de Referência
              </p>
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 rounded-md bg-muted/50">
                  <span>Perda média de pacotes (núcleo)</span>
                  <span className="font-mono font-medium text-green-600 dark:text-green-400">
                    0.3% (Meta: &lt; 1%)
                  </span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-md bg-muted/50">
                  <span>Latência média mensal (núcleo)</span>
                  <span className="font-mono font-medium text-green-600 dark:text-green-400">
                    45 ms (Meta: ≤ 80ms)
                  </span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-md bg-muted/50">
                  <span>Latência máxima (núcleo)</span>
                  <span className="font-mono font-medium text-green-600 dark:text-green-400">
                    72 ms (Meta: ≤ 100ms)
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="monthly" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
              <CardTitle className="text-lg flex items-center gap-2">
                <FileText className="w-5 h-5" />
                Relatório Gerencial de Serviços
              </CardTitle>
              <Button variant="outline" size="sm">
                <Download className="w-4 h-4 mr-2" />
                Baixar
              </Button>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Conforme item 7.1.1 do Termo de Referência, o relatório gerencial é apresentado
                mensalmente ao Gestor do Contrato até o primeiro dia útil do mês subsequente.
              </p>
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 rounded-md border">
                  <div className="flex items-center gap-3">
                    <FileText className="w-5 h-5 text-muted-foreground" />
                    <div>
                      <p className="font-medium">Relatório Dezembro 2025</p>
                      <p className="text-xs text-muted-foreground">Gerado em 01/01/2026</p>
                    </div>
                  </div>
                  <Button variant="ghost" size="sm">
                    <Download className="w-4 h-4" />
                  </Button>
                </div>
                <div className="flex items-center justify-between p-3 rounded-md border">
                  <div className="flex items-center gap-3">
                    <FileText className="w-5 h-5 text-muted-foreground" />
                    <div>
                      <p className="font-medium">Relatório Novembro 2025</p>
                      <p className="text-xs text-muted-foreground">Gerado em 01/12/2025</p>
                    </div>
                  </div>
                  <Button variant="ghost" size="sm">
                    <Download className="w-4 h-4" />
                  </Button>
                </div>
                <div className="flex items-center justify-between p-3 rounded-md border">
                  <div className="flex items-center gap-3">
                    <FileText className="w-5 h-5 text-muted-foreground" />
                    <div>
                      <p className="font-medium">Relatório Outubro 2025</p>
                      <p className="text-xs text-muted-foreground">Gerado em 01/11/2025</p>
                    </div>
                  </div>
                  <Button variant="ghost" size="sm">
                    <Download className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Armazenamento de Dados</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Conforme item 5.1.9.7.1 do Termo de Referência, os dados de gerenciamento são
                armazenados por, no mínimo, 6 (seis) meses.
              </p>
              <div className="mt-4 p-4 rounded-md bg-muted/50">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm">Período de retenção atual</span>
                  <span className="font-mono font-medium">6 meses</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">Dados disponíveis desde</span>
                  <span className="font-mono font-medium">Julho 2025</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

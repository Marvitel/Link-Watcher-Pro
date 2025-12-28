import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  Network,
} from "lucide-react";
import type { SLAIndicator, DashboardStats, Link } from "@shared/schema";
import { useState } from "react";

const MONTH_NAMES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
];

export default function Reports() {
  const { selectedClientId, selectedClientName } = useClientContext();
  const { toast } = useToast();
  const [exporting, setExporting] = useState<"pdf" | "csv" | null>(null);
  
  const now = new Date();
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1); // 1-indexed for API
  const [selectedLinkId, setSelectedLinkId] = useState<number | null>(null);
  
  // Build URLs with client and link filter
  const clientParam = selectedClientId ? `clientId=${selectedClientId}&` : "";
  const linkParam = selectedLinkId ? `linkId=${selectedLinkId}&` : "";
  
  // SLA Accumulated (default - for tab "Indicadores SLA")
  const slaAccumulatedUrl = `/api/sla?${clientParam}${linkParam}type=accumulated`;
  
  // SLA Monthly (for selected month)
  const slaMonthlyUrl = `/api/sla?${clientParam}${linkParam}type=monthly&year=${selectedYear}&month=${selectedMonth}`;
  
  const statsUrl = selectedClientId ? `/api/stats?clientId=${selectedClientId}` : "/api/stats";
  const linksUrl = selectedClientId ? `/api/links?clientId=${selectedClientId}` : "/api/links";
  
  const { data: slaAccumulated, isLoading: slaAccumulatedLoading } = useQuery<SLAIndicator[]>({
    queryKey: [slaAccumulatedUrl],
    refetchInterval: 30000,
  });
  
  const { data: slaMonthly, isLoading: slaMonthlyLoading } = useQuery<SLAIndicator[]>({
    queryKey: [slaMonthlyUrl],
    refetchInterval: 30000,
  });

  const { data: stats } = useQuery<DashboardStats>({
    queryKey: [statsUrl],
  });

  const { data: links } = useQuery<Link[]>({
    queryKey: [linksUrl],
  });
  
  // Available years (last 2 years)
  const availableYears = [now.getFullYear(), now.getFullYear() - 1];

  const handleExport = (type: "pdf" | "csv") => {
    if (!slaAccumulated || !stats || !links) {
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
      slaIndicators: slaAccumulated,
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

      <Card className="mb-4">
        <CardContent className="pt-4">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <Network className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium">Filtrar por Link:</span>
            </div>
            <Select
              value={selectedLinkId?.toString() || "all"}
              onValueChange={(val) => setSelectedLinkId(val === "all" ? null : parseInt(val, 10))}
            >
              <SelectTrigger className="w-[250px]" data-testid="select-link-filter">
                <SelectValue placeholder="Todos os links" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os links</SelectItem>
                {links?.map((link) => (
                  <SelectItem key={link.id} value={link.id.toString()}>
                    {link.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedLinkId && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedLinkId(null)}
                data-testid="button-clear-link-filter"
              >
                Limpar filtro
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

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
              <CardTitle className="text-lg">
                Acordo de Nível de Serviço (ANS/SLA) - Acumulado
                {selectedLinkId && links?.find(l => l.id === selectedLinkId) && (
                  <span className="text-muted-foreground font-normal text-sm ml-2">
                    ({links.find(l => l.id === selectedLinkId)?.name})
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Indicadores calculados com base no histórico completo de métricas (últimos 6 meses).
                Conforme especificado no item 5.2 do Termo de Referência.
              </p>
              {slaAccumulatedLoading ? (
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
                <SLAIndicators indicators={slaAccumulated || []} />
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
                  {(slaAccumulated?.find(i => i.id === "sla-de")?.current ?? stats?.averageUptime ?? 99.5).toFixed(2)}%
                </p>
                <p className="text-xs text-green-600 dark:text-green-400">Meta: ≥ 99%</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-sm text-muted-foreground">Latência Média</p>
                <p className="text-2xl font-semibold font-mono">
                  {(slaAccumulated?.find(i => i.id === "sla-lat")?.current ?? stats?.averageLatency ?? 45).toFixed(1)} ms
                </p>
                <p className="text-xs text-green-600 dark:text-green-400">Meta: ≤ 80ms</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-sm text-muted-foreground">Perda de Pacotes</p>
                <p className="text-2xl font-semibold font-mono">
                  {(slaAccumulated?.find(i => i.id === "sla-dp")?.current ?? 0.3).toFixed(2)}%
                </p>
                <p className="text-xs text-green-600 dark:text-green-400">Meta: ≤ 2%</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-sm text-muted-foreground">Prazo de Reparo</p>
                <p className="text-2xl font-semibold font-mono">
                  {(slaAccumulated?.find(i => i.id === "sla-repair")?.current ?? 100).toFixed(0)}%
                </p>
                <p className="text-xs text-green-600 dark:text-green-400">Meta: Máximo 6 horas</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Indicadores de Desempenho - Dados Reais</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Calculados a partir do histórico de métricas coletadas
              </p>
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 rounded-md bg-muted/50">
                  <span>Perda média de pacotes</span>
                  <span className={`font-mono font-medium ${(slaAccumulated?.find(i => i.id === "sla-dp")?.current ?? 0) <= 2 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                    {(slaAccumulated?.find(i => i.id === "sla-dp")?.current ?? 0).toFixed(2)}% (Meta: ≤ 2%)
                  </span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-md bg-muted/50">
                  <span>Latência média</span>
                  <span className={`font-mono font-medium ${(slaAccumulated?.find(i => i.id === "sla-lat")?.current ?? 0) <= 80 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                    {(slaAccumulated?.find(i => i.id === "sla-lat")?.current ?? 0).toFixed(1)} ms (Meta: ≤ 80ms)
                  </span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-md bg-muted/50">
                  <span>Disponibilidade do enlace</span>
                  <span className={`font-mono font-medium ${(slaAccumulated?.find(i => i.id === "sla-de")?.current ?? 0) >= 99 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                    {(slaAccumulated?.find(i => i.id === "sla-de")?.current ?? 0).toFixed(2)}% (Meta: ≥ 99%)
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
                <Calendar className="w-5 h-5" />
                Indicadores SLA - Mês Selecionado
              </CardTitle>
              <div className="flex items-center gap-2">
                <Select
                  value={selectedMonth.toString()}
                  onValueChange={(val) => setSelectedMonth(parseInt(val, 10))}
                >
                  <SelectTrigger className="w-[140px]" data-testid="select-month">
                    <SelectValue placeholder="Mês" />
                  </SelectTrigger>
                  <SelectContent>
                    {MONTH_NAMES.map((name, idx) => (
                      <SelectItem key={idx + 1} value={(idx + 1).toString()}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={selectedYear.toString()}
                  onValueChange={(val) => setSelectedYear(parseInt(val, 10))}
                >
                  <SelectTrigger className="w-[100px]" data-testid="select-year">
                    <SelectValue placeholder="Ano" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableYears.map((year) => (
                      <SelectItem key={year} value={year.toString()}>
                        {year}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Indicadores calculados para o período de {MONTH_NAMES[selectedMonth - 1]} de {selectedYear}.
              </p>
              {slaMonthlyLoading ? (
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
                <SLAIndicators indicators={slaMonthly || []} />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <TrendingUp className="w-5 h-5" />
                Indicadores SLA - Acumulado (6 meses)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Indicadores acumulados considerando todo o período de retenção de dados.
              </p>
              {slaAccumulatedLoading ? (
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
                <SLAIndicators indicators={slaAccumulated || []} />
              )}
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
                  <span className="font-mono font-medium">
                    {MONTH_NAMES[new Date(Date.now() - 6 * 30 * 24 * 60 * 60 * 1000).getMonth()]} {new Date(Date.now() - 6 * 30 * 24 * 60 * 60 * 1000).getFullYear()}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

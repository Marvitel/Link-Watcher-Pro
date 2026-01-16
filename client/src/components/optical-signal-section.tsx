import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  ReferenceLine,
  Area,
  ComposedChart,
} from "recharts";
import { Radio, TrendingDown, TrendingUp, AlertTriangle, CheckCircle, Info, Network, MapPin, Ruler, Clock } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { Link, Metric } from "@shared/schema";

interface OpticalSignalSectionProps {
  link: Link;
  metrics: Metric[];
}

const DEFAULT_THRESHOLDS = {
  rxNormalMin: -25,
  rxWarningMin: -28,
  rxCriticalMin: -30,
};

function getOpticalStatus(rxPower: number | null | undefined): {
  status: "normal" | "warning" | "critical" | "unknown";
  label: string;
  color: string;
  bgColor: string;
} {
  if (rxPower === null || rxPower === undefined) {
    return { status: "unknown", label: "Sem Dados", color: "text-muted-foreground", bgColor: "bg-muted" };
  }
  if (rxPower >= DEFAULT_THRESHOLDS.rxNormalMin) {
    return { status: "normal", label: "Normal", color: "text-green-600", bgColor: "bg-green-500/10" };
  }
  if (rxPower >= DEFAULT_THRESHOLDS.rxWarningMin) {
    return { status: "warning", label: "Atenção", color: "text-amber-600", bgColor: "bg-amber-500/10" };
  }
  return { status: "critical", label: "Crítico", color: "text-red-600", bgColor: "bg-red-500/10" };
}

function formatDbm(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${value.toFixed(1)} dBm`;
}

function SignalMeter({ value, min = -35, max = -10, thresholds }: { 
  value: number | null | undefined; 
  min?: number; 
  max?: number;
  thresholds: typeof DEFAULT_THRESHOLDS;
}) {
  if (value === null || value === undefined) {
    return (
      <div className="space-y-2">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{max} dBm</span>
          <span>{min} dBm</span>
        </div>
        <div className="h-4 bg-muted rounded-full overflow-hidden">
          <div className="h-full bg-muted-foreground/20 w-0" />
        </div>
        <p className="text-sm text-muted-foreground text-center">Sem leitura de sinal</p>
      </div>
    );
  }

  const range = max - min;
  const position = Math.max(0, Math.min(100, ((value - min) / range) * 100));
  
  const normalPos = ((thresholds.rxNormalMin - min) / range) * 100;
  const warningPos = ((thresholds.rxWarningMin - min) / range) * 100;

  return (
    <div className="space-y-2">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{max} dBm</span>
        <span>{min} dBm</span>
      </div>
      <div className="relative h-4 rounded-full overflow-hidden">
        <div 
          className="absolute inset-0 flex"
          style={{ direction: "rtl" }}
        >
          <div 
            className="h-full bg-green-500/40" 
            style={{ width: `${100 - normalPos}%` }}
          />
          <div 
            className="h-full bg-amber-500/40" 
            style={{ width: `${normalPos - warningPos}%` }}
          />
          <div 
            className="h-full bg-red-500/40" 
            style={{ width: `${warningPos}%` }}
          />
        </div>
        <div 
          className="absolute top-0 bottom-0 w-1 bg-foreground rounded-full shadow-lg"
          style={{ left: `${100 - position}%`, transform: "translateX(-50%)" }}
        />
      </div>
      <div className="flex justify-between text-xs">
        <span className="text-green-600">Normal</span>
        <span className="text-amber-600">Atenção</span>
        <span className="text-red-600">Crítico</span>
      </div>
    </div>
  );
}

export function OpticalSignalSection({ link, metrics }: OpticalSignalSectionProps) {
  // Métricas são retornadas em ordem descendente (mais recente primeiro)
  // Então a métrica mais recente está em metrics[0]
  const latestMetric = metrics[0];
  const currentRxPower = latestMetric?.opticalRxPower;
  const currentTxPower = latestMetric?.opticalTxPower;
  const currentOltRxPower = latestMetric?.opticalOltRxPower;
  
  const rxStatus = getOpticalStatus(currentRxPower);
  
  const baselineRx = link.opticalRxBaseline;
  const baselineTx = link.opticalTxBaseline;
  
  const deltaRx = currentRxPower !== null && currentRxPower !== undefined && baselineRx !== null && baselineRx !== undefined
    ? currentRxPower - baselineRx
    : null;

  // Métricas vêm em ordem descendente (mais recente primeiro)
  // Para o gráfico, queremos ordem cronológica (mais antigo à esquerda)
  // Então pegamos os 48 mais recentes e invertemos para ordem cronológica
  const opticalData = metrics
    .filter(m => m.opticalRxPower !== null || m.opticalTxPower !== null)
    .slice(0, 48) // Pegar os 48 mais recentes (que estão no início do array)
    .reverse() // Inverter para ordem cronológica (mais antigo primeiro)
    .map(m => ({
      time: format(new Date(m.timestamp), "HH:mm", { locale: ptBR }),
      rx: m.opticalRxPower,
      tx: m.opticalTxPower,
      oltRx: m.opticalOltRxPower,
      baseline: baselineRx,
    }));

  const hasOpticalData = opticalData.length > 0;
  const hasCurrentReading = currentRxPower !== null && currentRxPower !== undefined;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center gap-2 space-y-0 pb-2">
            <Radio className="w-5 h-5 text-blue-500" />
            <CardTitle className="text-base">Potência RX (ONU)</CardTitle>
            <Tooltip>
              <TooltipTrigger>
                <Info className="w-4 h-4 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent>
                <p>Potência de sinal recebida na ONU do cliente (downstream)</p>
              </TooltipContent>
            </Tooltip>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <span className={`text-3xl font-semibold font-mono ${rxStatus.color}`} data-testid="text-optical-rx">
                {formatDbm(currentRxPower)}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <Badge variant={rxStatus.status === "normal" ? "default" : rxStatus.status === "warning" ? "secondary" : "destructive"}>
                {rxStatus.status === "normal" && <CheckCircle className="w-3 h-3 mr-1" />}
                {rxStatus.status === "warning" && <AlertTriangle className="w-3 h-3 mr-1" />}
                {rxStatus.status === "critical" && <AlertTriangle className="w-3 h-3 mr-1" />}
                {rxStatus.label}
              </Badge>
              {deltaRx !== null && Math.abs(deltaRx) >= 0.5 && (
                <span className={`text-xs flex items-center gap-1 ${deltaRx > 0 ? "text-green-600" : "text-red-600"}`}>
                  {deltaRx > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                  {deltaRx > 0 ? "+" : ""}{deltaRx.toFixed(1)} dB
                </span>
              )}
            </div>
            {baselineRx !== null && baselineRx !== undefined && (
              <p className="text-xs text-muted-foreground mt-2">
                Baseline: {formatDbm(baselineRx)}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center gap-2 space-y-0 pb-2">
            <Radio className="w-5 h-5 text-green-500" />
            <CardTitle className="text-base">Potência TX (ONU)</CardTitle>
            <Tooltip>
              <TooltipTrigger>
                <Info className="w-4 h-4 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent>
                <p>Potência de sinal transmitida pela ONU do cliente (upstream)</p>
              </TooltipContent>
            </Tooltip>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-semibold font-mono" data-testid="text-optical-tx">
                {formatDbm(currentTxPower)}
              </span>
            </div>
            {baselineTx !== null && baselineTx !== undefined && (
              <p className="text-xs text-muted-foreground mt-2">
                Baseline: {formatDbm(baselineTx)}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center gap-2 space-y-0 pb-2">
            <Radio className="w-5 h-5 text-purple-500" />
            <CardTitle className="text-base">RX na OLT</CardTitle>
            <Tooltip>
              <TooltipTrigger>
                <Info className="w-4 h-4 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent>
                <p>Potência de sinal do cliente recebida na OLT da Marvitel</p>
              </TooltipContent>
            </Tooltip>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-semibold font-mono" data-testid="text-optical-olt-rx">
                {formatDbm(currentOltRxPower)}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Upstream do cliente na OLT
            </p>
          </CardContent>
        </Card>
      </div>

      {(link.zabbixSplitterName || link.zabbixSplitterPort || link.zabbixOnuDistance) && (
        <Card>
          <CardHeader className="flex flex-row items-center gap-2 space-y-0 pb-2">
            <Network className="w-5 h-5 text-orange-500" />
            <CardTitle className="text-base">Dados do Splitter</CardTitle>
            <Tooltip>
              <TooltipTrigger>
                <Info className="w-4 h-4 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent>
                <p>Informações do splitter obtidas automaticamente do Zabbix</p>
              </TooltipContent>
            </Tooltip>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-muted-foreground" />
                <div>
                  <p className="text-xs text-muted-foreground">Splitter</p>
                  <p className="text-sm font-medium" data-testid="text-splitter-name">
                    {link.zabbixSplitterName || "—"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Network className="w-4 h-4 text-muted-foreground" />
                <div>
                  <p className="text-xs text-muted-foreground">Porta</p>
                  <p className="text-sm font-medium" data-testid="text-splitter-port">
                    {link.zabbixSplitterPort || "—"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Ruler className="w-4 h-4 text-muted-foreground" />
                <div>
                  <p className="text-xs text-muted-foreground">Distância</p>
                  <p className="text-sm font-medium" data-testid="text-onu-distance">
                    {link.zabbixOnuDistance ? `${link.zabbixOnuDistance} m` : "—"}
                  </p>
                </div>
              </div>
            </div>
            {link.zabbixLastSync && (
              <div className="flex items-center gap-1 mt-3 text-xs text-muted-foreground">
                <Clock className="w-3 h-3" />
                <span>
                  Última sincronização: {format(new Date(link.zabbixLastSync), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Medidor de Sinal</CardTitle>
        </CardHeader>
        <CardContent>
          <SignalMeter 
            value={currentRxPower} 
            thresholds={DEFAULT_THRESHOLDS}
          />
        </CardContent>
      </Card>

      {hasOpticalData ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Histórico de Sinal Óptico</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={opticalData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis 
                  dataKey="time" 
                  tick={{ fontSize: 12 }}
                  className="fill-muted-foreground"
                />
                <YAxis 
                  domain={[-35, -10]}
                  tick={{ fontSize: 12 }}
                  tickFormatter={(v) => `${v} dBm`}
                  className="fill-muted-foreground"
                />
                <ReferenceLine 
                  y={DEFAULT_THRESHOLDS.rxNormalMin} 
                  stroke="hsl(var(--chart-2))" 
                  strokeDasharray="5 5"
                  label={{ value: "Normal", position: "right", fontSize: 10 }}
                />
                <ReferenceLine 
                  y={DEFAULT_THRESHOLDS.rxWarningMin} 
                  stroke="hsl(var(--chart-4))" 
                  strokeDasharray="5 5"
                  label={{ value: "Atenção", position: "right", fontSize: 10 }}
                />
                <ReferenceLine 
                  y={DEFAULT_THRESHOLDS.rxCriticalMin} 
                  stroke="hsl(var(--destructive))" 
                  strokeDasharray="5 5"
                  label={{ value: "Crítico", position: "right", fontSize: 10 }}
                />
                {baselineRx !== null && baselineRx !== undefined && (
                  <ReferenceLine 
                    y={baselineRx} 
                    stroke="hsl(var(--primary))" 
                    strokeWidth={2}
                    label={{ value: "Baseline", position: "left", fontSize: 10 }}
                  />
                )}
                <Line 
                  type="monotone" 
                  dataKey="rx" 
                  stroke="hsl(var(--chart-1))" 
                  strokeWidth={2}
                  dot={false}
                  name="RX (ONU)"
                />
                <Line 
                  type="monotone" 
                  dataKey="tx" 
                  stroke="hsl(var(--chart-2))" 
                  strokeWidth={2}
                  dot={false}
                  name="TX (ONU)"
                />
                <Line 
                  type="monotone" 
                  dataKey="oltRx" 
                  stroke="hsl(var(--chart-3))" 
                  strokeWidth={2}
                  dot={false}
                  name="RX (OLT)"
                />
              </ComposedChart>
            </ResponsiveContainer>
            <div className="flex items-center justify-center gap-6 mt-4 text-sm">
              <span className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full" style={{ backgroundColor: "hsl(var(--chart-1))" }} />
                RX (ONU)
              </span>
              <span className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full" style={{ backgroundColor: "hsl(var(--chart-2))" }} />
                TX (ONU)
              </span>
              <span className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full" style={{ backgroundColor: "hsl(var(--chart-3))" }} />
                RX (OLT)
              </span>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-12">
            <div className="text-center text-muted-foreground">
              <Radio className="w-12 h-12 mx-auto mb-4 opacity-30" />
              {link.opticalMonitoringEnabled && link.oltId ? (
                <>
                  <p className="text-lg font-medium">Aguardando Coleta de Sinal Óptico</p>
                  <p className="text-sm mt-2">
                    O monitoramento está configurado. Os dados aparecerão assim que a primeira coleta for realizada.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-lg font-medium">Monitoramento Óptico Não Configurado</p>
                  <p className="text-sm mt-2">
                    Habilite o monitoramento óptico e selecione uma OLT no cadastro do link.
                  </p>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {link.splitterId && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Informações da Infraestrutura Óptica</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Splitter ID</span>
              <span className="font-mono">{link.splitterId}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">OLT</span>
              <span className="font-mono">{link.oltId || "Não configurada"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Porta OLT</span>
              <span className="font-mono">{link.portOlt || "Não configurada"}</span>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

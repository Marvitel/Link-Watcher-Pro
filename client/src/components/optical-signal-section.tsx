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
import { Radio, TrendingDown, TrendingUp, AlertTriangle, CheckCircle, Info, Network, MapPin, Ruler, Clock, Plug, PlugZap } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useQuery } from "@tanstack/react-query";
import type { Link, Metric } from "@shared/schema";

interface PortStatusResponse {
  available: boolean;
  operStatus?: string;
  adminStatus?: string;
  ifIndex?: number;
  sourceName?: string;
  sourceIp?: string;
  portName?: string;
  message?: string;
}

interface OpticalSignalSectionProps {
  link: Link;
  metrics: Metric[];
}

// Escalas de sinal óptico por tecnologia
// PTP: SFP+ 10G LR (10km): TX -6 a -0.5, RX sens: -14.4, sat: 0.5, alerta: -12
// PTP: SFP+ 10G BIDI (20km): TX -6 a -0.5, RX sens: -15.0, sat: 0.5, alerta: -13
// PTP: QSFP+ 40G ER4 (20km): TX -5.5 a +1.5, RX sens: -12.6, sat: -1.0, alerta: -10.5
// GPON ONU: ideal -8 a -25, alerta < -27, dano > -3
// GPON OLT: ideal -8 a -28, alerta < -30, dano > -6

type SfpType = "sfp_10g_lr" | "sfp_10g_bidi" | "qsfp_40g_er4" | "gpon_onu" | "gpon_olt";

interface OpticalThresholds {
  label: string;
  description: string;
  txMin: number;     // Potência TX mínima
  txMax: number;     // Potência TX máxima
  rxIdealMin: number;  // RX ideal mínimo (faixa verde)
  rxIdealMax: number;  // RX ideal máximo (faixa verde/saturação)
  rxWarningMin: number; // Abaixo disso = alerta
  rxSaturation: number; // Acima disso = saturação/dano
  scaleMin: number;  // Escala do medidor (min)
  scaleMax: number;  // Escala do medidor (max)
}

const OPTICAL_THRESHOLDS: Record<SfpType, OpticalThresholds> = {
  sfp_10g_lr: {
    label: "SFP+ 10G LR",
    description: "10km, 1310nm single-mode",
    txMin: -6,
    txMax: -0.5,
    rxIdealMin: -14.4,
    rxIdealMax: 0.5,
    rxWarningMin: -12,
    rxSaturation: 0.5,
    scaleMin: -20,
    scaleMax: 2,
  },
  sfp_10g_bidi: {
    label: "SFP+ 10G BIDI",
    description: "20km, BiDi single-fiber",
    txMin: -6,
    txMax: -0.5,
    rxIdealMin: -15.0,
    rxIdealMax: 0.5,
    rxWarningMin: -13,
    rxSaturation: 0.5,
    scaleMin: -20,
    scaleMax: 2,
  },
  qsfp_40g_er4: {
    label: "QSFP+ 40G ER4",
    description: "20km, 4x10G CWDM",
    txMin: -5.5,
    txMax: 1.5,
    rxIdealMin: -12.6,
    rxIdealMax: -1.0,
    rxWarningMin: -10.5,
    rxSaturation: -1.0,
    scaleMin: -18,
    scaleMax: 3,
  },
  gpon_onu: {
    label: "GPON ONU",
    description: "ONU cliente, 2.5G/1.25G",
    txMin: 0.5,
    txMax: 5,
    rxIdealMin: -25,
    rxIdealMax: -8,
    rxWarningMin: -27,
    rxSaturation: -3,
    scaleMin: -35,
    scaleMax: 0,
  },
  gpon_olt: {
    label: "GPON OLT",
    description: "OLT central",
    txMin: 1.5,
    txMax: 5,
    rxIdealMin: -28,
    rxIdealMax: -8,
    rxWarningMin: -30,
    rxSaturation: -6,
    scaleMin: -35,
    scaleMax: 0,
  },
};

function getThresholdsForLink(link: Link): OpticalThresholds {
  // Se tem sfpType definido, usa ele
  if (link.sfpType && link.sfpType in OPTICAL_THRESHOLDS) {
    return OPTICAL_THRESHOLDS[link.sfpType as SfpType];
  }
  // Fallback baseado no linkType
  if (link.linkType === "ptp") {
    return OPTICAL_THRESHOLDS.sfp_10g_lr; // Default para PTP
  }
  return OPTICAL_THRESHOLDS.gpon_onu; // Default para GPON
}

function getOpticalStatus(rxPower: number | null | undefined, thresholds: OpticalThresholds): {
  status: "normal" | "warning" | "critical" | "saturated" | "unknown";
  label: string;
  color: string;
  bgColor: string;
} {
  if (rxPower === null || rxPower === undefined) {
    return { status: "unknown", label: "Sem Dados", color: "text-muted-foreground", bgColor: "bg-muted" };
  }
  // Saturação (sinal muito forte - pode danificar)
  if (rxPower >= thresholds.rxSaturation) {
    return { status: "saturated", label: "Saturado", color: "text-purple-600", bgColor: "bg-purple-500/10" };
  }
  // Normal (dentro da faixa ideal)
  if (rxPower >= thresholds.rxWarningMin && rxPower < thresholds.rxSaturation) {
    return { status: "normal", label: "Normal", color: "text-green-600", bgColor: "bg-green-500/10" };
  }
  // Alerta (abaixo do ideal mas acima do crítico)
  if (rxPower >= thresholds.rxIdealMin) {
    return { status: "warning", label: "Atenção", color: "text-amber-600", bgColor: "bg-amber-500/10" };
  }
  // Crítico (abaixo da sensibilidade)
  return { status: "critical", label: "Crítico", color: "text-red-600", bgColor: "bg-red-500/10" };
}

function formatDbm(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${value.toFixed(1)} dBm`;
}

function SignalMeter({ value, thresholds }: { 
  value: number | null | undefined; 
  thresholds: OpticalThresholds;
}) {
  const min = thresholds.scaleMin;
  const max = thresholds.scaleMax;
  
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
  
  // Posições das zonas na escala (da direita para esquerda: saturado > normal > alerta > crítico)
  const saturationPos = ((thresholds.rxSaturation - min) / range) * 100;
  const warningPos = ((thresholds.rxWarningMin - min) / range) * 100;
  const idealMinPos = ((thresholds.rxIdealMin - min) / range) * 100;

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
          {/* Saturação (roxo) - muito forte */}
          <div 
            className="h-full bg-purple-500/40" 
            style={{ width: `${100 - saturationPos}%` }}
          />
          {/* Normal (verde) - faixa ideal */}
          <div 
            className="h-full bg-green-500/40" 
            style={{ width: `${saturationPos - warningPos}%` }}
          />
          {/* Alerta (amarelo) - sinal baixo */}
          <div 
            className="h-full bg-amber-500/40" 
            style={{ width: `${warningPos - idealMinPos}%` }}
          />
          {/* Crítico (vermelho) - abaixo da sensibilidade */}
          <div 
            className="h-full bg-red-500/40" 
            style={{ width: `${idealMinPos}%` }}
          />
        </div>
        <div 
          className="absolute top-0 bottom-0 w-1 bg-foreground rounded-full shadow-lg"
          style={{ left: `${100 - position}%`, transform: "translateX(-50%)" }}
        />
      </div>
      <div className="flex justify-between text-xs">
        <span className="text-purple-600">Saturado</span>
        <span className="text-green-600">Normal</span>
        <span className="text-amber-600">Alerta</span>
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
  
  // Verificar se é link PTP (via switch)
  const isPtp = link.linkType === "ptp";
  
  // Buscar status da porta para links PTP/L2
  const { data: portStatus } = useQuery<PortStatusResponse>({
    queryKey: ['/api/links', link.id, 'port-status'],
    refetchInterval: 30000, // Atualizar a cada 30 segundos
    enabled: isPtp || (link as any).isL2Link,
  });
  
  // Obter thresholds baseados no tipo de SFP/tecnologia
  const thresholds = getThresholdsForLink(link);
  
  const rxStatus = getOpticalStatus(currentRxPower, thresholds);
  
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
      {/* Badge de tecnologia */}
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-xs">
          {thresholds.label}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {thresholds.description} | RX: {thresholds.rxIdealMin} a {thresholds.rxSaturation} dBm
        </span>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center gap-2 space-y-0 pb-2">
            <Radio className="w-5 h-5 text-blue-500" />
            <CardTitle className="text-base">{isPtp ? "Potência RX (SFP)" : "Potência RX (ONU)"}</CardTitle>
            <Tooltip>
              <TooltipTrigger>
                <Info className="w-4 h-4 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent>
                <p>{isPtp ? "Potência de sinal recebida no transceiver SFP" : "Potência de sinal recebida na ONU do cliente (downstream)"}</p>
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
            <CardTitle className="text-base">{isPtp ? "Potência TX (SFP)" : "Potência TX (ONU)"}</CardTitle>
            <Tooltip>
              <TooltipTrigger>
                <Info className="w-4 h-4 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent>
                <p>{isPtp ? "Potência de sinal transmitida pelo transceiver SFP" : "Potência de sinal transmitida pela ONU do cliente (upstream)"}</p>
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

        {/* Status da Porta - para links PTP/L2 */}
        {(isPtp || (link as any).isL2Link) && portStatus && (
          <Card>
            <CardHeader className="flex flex-row items-center gap-2 space-y-0 pb-2">
              {portStatus.available && portStatus.operStatus === 'up' ? (
                <PlugZap className="w-5 h-5 text-green-500" />
              ) : (
                <Plug className="w-5 h-5 text-red-500" />
              )}
              <CardTitle className="text-base">Status da Porta</CardTitle>
              <Tooltip>
                <TooltipTrigger>
                  <Info className="w-4 h-4 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent>
                  <p>Status operacional da porta do switch (ifOperStatus via SNMP)</p>
                </TooltipContent>
              </Tooltip>
            </CardHeader>
            <CardContent>
              {portStatus.available ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge 
                      variant={portStatus.operStatus === 'up' ? 'default' : 'destructive'}
                      data-testid="badge-port-oper-status"
                    >
                      {portStatus.operStatus === 'up' && <CheckCircle className="w-3 h-3 mr-1" />}
                      {portStatus.operStatus === 'down' && <AlertTriangle className="w-3 h-3 mr-1" />}
                      Operacional: {portStatus.operStatus?.toUpperCase()}
                    </Badge>
                    <Badge 
                      variant="outline"
                      data-testid="badge-port-admin-status"
                    >
                      Admin: {portStatus.adminStatus?.toUpperCase()}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground space-y-1">
                    <p>Fonte: {portStatus.sourceName}</p>
                    {portStatus.portName && <p>Porta: {portStatus.portName}</p>}
                    <p>Interface Index: {portStatus.ifIndex}</p>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">
                  {portStatus.message || "Status não disponível"}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {!isPtp && (
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
        )}
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
                    {link.zabbixOnuDistance ? `${link.zabbixOnuDistance} km` : "—"}
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
            thresholds={thresholds}
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
                  y={thresholds.rxSaturation} 
                  stroke="hsl(280 100% 50%)" 
                  strokeDasharray="5 5"
                  label={{ value: "Saturação", position: "right", fontSize: 10 }}
                />
                <ReferenceLine 
                  y={thresholds.rxWarningMin} 
                  stroke="hsl(var(--chart-4))" 
                  strokeDasharray="5 5"
                  label={{ value: "Alerta", position: "right", fontSize: 10 }}
                />
                <ReferenceLine 
                  y={thresholds.rxIdealMin} 
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
                  stroke="#3b82f6"
                  strokeWidth={2}
                  dot={false}
                  name={isPtp ? "RX (SFP)" : "RX (ONU)"}
                />
                <Line 
                  type="monotone" 
                  dataKey="tx" 
                  stroke="#10b981"
                  strokeWidth={2}
                  dot={false}
                  name={isPtp ? "TX (SFP)" : "TX (ONU)"}
                />
                {!isPtp && (
                  <Line 
                    type="monotone" 
                    dataKey="oltRx" 
                    stroke="#f97316"
                    strokeWidth={2}
                    dot={false}
                    name="RX (OLT)"
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
            <div className="flex items-center justify-center gap-6 mt-4 text-sm">
              <span className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full" style={{ backgroundColor: "#3b82f6" }} />
                {isPtp ? "RX (SFP)" : "RX (ONU)"}
              </span>
              <span className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full" style={{ backgroundColor: "#10b981" }} />
                {isPtp ? "TX (SFP)" : "TX (ONU)"}
              </span>
              {!isPtp && (
                <span className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full" style={{ backgroundColor: "#f97316" }} />
                  RX (OLT)
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-12">
            <div className="text-center text-muted-foreground">
              <Radio className="w-12 h-12 mx-auto mb-4 opacity-30" />
              {link.linkType === "ptp" ? (
                link.opticalMonitoringEnabled && (link as any).switchId ? (
                  <>
                    <p className="text-lg font-medium">Aguardando Coleta de Sinal Óptico</p>
                    <p className="text-sm mt-2">
                      O monitoramento está configurado. Os dados aparecerão assim que a primeira coleta for realizada.
                    </p>
                    <p className="text-xs mt-1">
                      Verifique se o switch possui OIDs ópticos e porta do link configurados.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-lg font-medium">Monitoramento Óptico PTP</p>
                    <p className="text-sm mt-2">
                      Para habilitar, configure o switch com OIDs ópticos e habilite o monitoramento no cadastro do link.
                    </p>
                  </>
                )
              ) : link.opticalMonitoringEnabled && link.oltId ? (
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

import { useMemo, useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ComposedChart,
  Line,
  Bar,
  Legend,
  ReferenceLine,
} from "recharts";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

// ── Utilitários de suavização e detecção de gaps ──────────────────────────────

/** Retorna a mediana dos gaps entre timestamps consecutivos (em ms). */
function getExpectedGapMs(items: Array<{ timestamp: string }>): number {
  if (items.length < 2) return 60_000;
  const gaps: number[] = [];
  for (let i = 1; i < Math.min(items.length, 40); i++) {
    const g = new Date(items[i].timestamp).getTime() - new Date(items[i - 1].timestamp).getTime();
    if (g > 0) gaps.push(g);
  }
  if (!gaps.length) return 60_000;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}

/** Média móvel simples. Janela ajustada aos extremos para não encurtar o array. */
function smoothValues(values: number[], window: number): number[] {
  const half = Math.floor(window / 2);
  return values.map((_, i) => {
    const start = Math.max(0, i - half);
    const end   = Math.min(values.length, i + half + 1);
    const slice = values.slice(start, end);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
}

// ─────────────────────────────────────────────────────────────────────────────

interface BandwidthChartProps {
  data: Array<{
    timestamp: string;
    download: number;
    upload: number;
    status?: string;
  }>;
  height?: number;
  showAxes?: boolean;
  showLegend?: boolean;
  status?: string;
  invertBandwidth?: boolean;
}

const isDownStatus = (s: string | undefined) => 
  s === "offline" || s === "critical" || s === "down";

export function BandwidthChart({
  data,
  height = 200,
  showAxes = false,
  invertBandwidth = false,
}: BandwidthChartProps) {
  const chartData = useMemo(() => {
    if (!data || !Array.isArray(data)) return [];
    try {
      const filtered = data.filter((item) => item && item.timestamp);
      if (!filtered.length) return [];

      // Gap threshold: 4× mediana dos intervalos ou no mínimo 3 min
      const expectedGapMs = getExpectedGapMs(filtered);
      const gapThreshold = Math.max(expectedGapMs * 4, 3 * 60_000);

      // Pré-calcular DL/UL já invertidos para suavização
      const shouldInvert = !invertBandwidth;
      const rawDls = filtered.map(it => shouldInvert ? (it.upload ?? 0) : (it.download ?? 0));
      const rawUls = filtered.map(it => shouldInvert ? (it.download ?? 0) : (it.upload ?? 0));

      // Média móvel: janela 5 quando há muitos pontos, senão 3
      const win = filtered.length > 200 ? 5 : filtered.length > 60 ? 3 : 1;
      const smoothDls = win > 1 ? smoothValues(rawDls, win) : rawDls;
      const smoothUls = win > 1 ? smoothValues(rawUls, win) : rawUls;

      const result: Array<{
        time: string;
        tsNum: number;
        download: number | null;
        upload: number | null;
        downloadDown: number | null;
        uploadDown: number | null;
        isDown: boolean;
        isDegraded: boolean;
      }> = [];
      
      for (let i = 0; i < filtered.length; i++) {
        const item = filtered[i];
        const prevItem = i > 0 ? filtered[i - 1] : null;
        
        try {
          // Inserir quebra de linha quando há gap de restart/queda
          if (prevItem) {
            const prevTs = new Date(prevItem.timestamp).getTime();
            const currTs = new Date(item.timestamp).getTime();
            if (currTs - prevTs > gapThreshold) {
              const midTs = Math.round((prevTs + currTs) / 2);
              result.push({
                time: format(new Date(midTs), "HH:mm", { locale: ptBR }),
                tsNum: midTs,
                download: null, upload: null,
                downloadDown: null, uploadDown: null,
                isDown: false, isDegraded: false,
              });
            }
          }

          const pointStatus = item.status || "operational";
          const isDown = isDownStatus(pointStatus);
          const isDegraded = pointStatus === "degraded";
          const prevStatus = prevItem?.status || "operational";
          const wasDown = isDownStatus(prevStatus);
          
          const d = new Date(item.timestamp);
          const time = format(d, "HH:mm", { locale: ptBR });
          const tsNum = d.getTime();
          const dl = smoothDls[i];
          const ul = smoothUls[i];
          
          if (prevItem && isDown !== wasDown) {
            result.push({ time, tsNum, download: dl, upload: ul, downloadDown: dl, uploadDown: ul, isDown, isDegraded });
          } else {
            result.push({
              time, tsNum,
              download: isDown ? null : dl,
              upload: isDown ? null : ul,
              downloadDown: isDown ? dl : null,
              uploadDown: isDown ? ul : null,
              isDown,
              isDegraded,
            });
          }
        } catch {
          // skip invalid item
        }
      }
      
      return result;
    } catch {
      return [];
    }
  }, [data, invertBandwidth]);

  if (!data || !Array.isArray(data) || data.length === 0 || chartData.length === 0) {
    return (
      <div 
        className="flex items-center justify-center h-full text-muted-foreground text-sm"
        style={{ height }}
      >
        Carregando dados...
      </div>
    );
  }

  const availBarH = showAxes ? 8 : 0;
  const chartH = height - availBarH - (showAxes ? 4 : 0);
  // Para o modo showAxes, margens coincidem com o YAxis width + chart margin
  // YAxis width=50, chart margin left=10, right=10 → bar: ml-[60px] mr-[10px]
  const yAxisWidth = 60;
  const chartMarginLR = 10;

  const chart = (
    <ResponsiveContainer width="100%" height={showAxes ? chartH : height}>
      <AreaChart data={chartData} margin={{ top: 4, right: chartMarginLR, left: chartMarginLR, bottom: 4 }}>
        <defs>
          <linearGradient id="colorDownload" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="hsl(210, 85%, 50%)" stopOpacity={0.3} />
            <stop offset="95%" stopColor="hsl(210, 85%, 50%)" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="colorUpload" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="hsl(142, 76%, 45%)" stopOpacity={0.3} />
            <stop offset="95%" stopColor="hsl(142, 76%, 45%)" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="colorDownloadRed" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="hsl(0, 84%, 60%)" stopOpacity={0.3} />
            <stop offset="95%" stopColor="hsl(0, 84%, 60%)" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="colorUploadRed" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="hsl(0, 70%, 50%)" stopOpacity={0.3} />
            <stop offset="95%" stopColor="hsl(0, 70%, 50%)" stopOpacity={0} />
          </linearGradient>
        </defs>
        {showAxes && (
          <>
            <XAxis
              dataKey="tsNum"
              type="number"
              scale="time"
              domain={['dataMin', 'dataMax']}
              tickFormatter={(ts: number) => {
                try { return format(new Date(ts), "HH:mm", { locale: ptBR }); } catch { return ""; }
              }}
              tickCount={7}
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
            />
            <YAxis
              width={yAxisWidth}
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              tickFormatter={(value) => `${value} M`}
            />
          </>
        )}
        <Tooltip
          contentStyle={{
            backgroundColor: "hsl(var(--card))",
            border: "1px solid hsl(var(--border))",
            borderRadius: "6px",
            fontSize: "12px",
          }}
          labelStyle={{ color: "hsl(var(--foreground))" }}
          labelFormatter={(ts: number) => {
            try { return format(new Date(ts), "HH:mm", { locale: ptBR }); } catch { return String(ts); }
          }}
          formatter={(value, name: string) => {
            if (value === null || value === undefined) return [null, null];
            const numVal = typeof value === 'number' ? value : 0;
            const label = name.includes("Down") 
              ? (name.includes("download") ? "Download (Offline)" : "Upload (Offline)")
              : (name === "download" ? "Download" : "Upload");
            return [`${numVal.toFixed(1)} Mbps`, label];
          }}
        />
        <Area type="monotone" dataKey="download" stroke="hsl(210, 85%, 50%)" strokeWidth={2} fill="url(#colorDownload)" connectNulls={false} />
        <Area type="monotone" dataKey="upload" stroke="hsl(142, 76%, 45%)" strokeWidth={2} fill="url(#colorUpload)" connectNulls={false} />
        <Area type="monotone" dataKey="downloadDown" stroke="hsl(0, 84%, 60%)" strokeWidth={2} fill="url(#colorDownloadRed)" connectNulls={false} />
        <Area type="monotone" dataKey="uploadDown" stroke="hsl(0, 70%, 50%)" strokeWidth={2} fill="url(#colorUploadRed)" connectNulls={false} />
      </AreaChart>
    </ResponsiveContainer>
  );

  if (!showAxes) return chart;

  // Modo Separado: adiciona barra de disponibilidade proporcional ao tempo
  const firstTs = chartData[0]?.tsNum ?? 0;
  const lastTs = chartData[chartData.length - 1]?.tsNum ?? 0;
  const totalMs = lastTs - firstTs || 1;
  const avgGap = totalMs / Math.max(chartData.length - 1, 1);

  return (
    <div className="w-full flex flex-col">
      <div style={{ height: chartH }}>{chart}</div>
      <div
        className="rounded overflow-hidden flex-shrink-0"
        style={{ height: availBarH, minHeight: availBarH, marginLeft: yAxisWidth + chartMarginLR, marginRight: chartMarginLR }}>
        <div className="flex h-full w-full">
          {chartData.map((point, idx) => {
            const nextTs = idx < chartData.length - 1 ? chartData[idx + 1].tsNum : point.tsNum + avgGap;
            const segMs = Math.max(nextTs - point.tsNum, 0);
            const pct = totalMs > 0 ? (segMs / totalMs * 100) : (100 / chartData.length);
            let bgColor = "bg-green-500";
            if (point.isDown) bgColor = "bg-red-500";
            else if (point.isDegraded) bgColor = "bg-yellow-500";
            return (
              <div key={idx} className={`h-full ${bgColor}`} style={{ width: `${pct}%` }}
                title={`${point.time} - ${point.isDown ? "Offline" : point.isDegraded ? "Degradado" : "Online"}`} />
            );
          })}
        </div>
      </div>
    </div>
  );
}

interface LatencyChartProps {
  data: Array<{
    timestamp: string;
    latency: number;
    packetLoss?: number;
    status?: string;
  }>;
  height?: number;
  threshold?: number;
  packetLossThreshold?: number;
  showPacketLoss?: boolean;
  status?: string;
}

export function LatencyChart({ data, height = 200, threshold = 80 }: LatencyChartProps) {
  const chartData = useMemo(() => {
    if (!data || !Array.isArray(data)) return [];
    try {
      const filtered = data.filter((item) => item && item.timestamp);
      const result: Array<{
        time: string;
        threshold: number;
        latency: number | null;
        latencyDown: number | null;
      }> = [];
      
      for (let i = 0; i < filtered.length; i++) {
        const item = filtered[i];
        const prevItem = i > 0 ? filtered[i - 1] : null;
        
        try {
          const pointStatus = item.status || "operational";
          const isDown = isDownStatus(pointStatus);
          const prevStatus = prevItem?.status || "operational";
          const wasDown = isDownStatus(prevStatus);
          
          const time = format(new Date(item.timestamp), "HH:mm", { locale: ptBR });
          const lat = item.latency ?? 0;
          
          // Se mudou de status, adicionar ponto de transição
          if (prevItem && isDown !== wasDown) {
            result.push({
              time,
              threshold,
              latency: lat,
              latencyDown: lat,
            });
          } else {
            result.push({
              time,
              threshold,
              latency: isDown ? null : lat,
              latencyDown: isDown ? lat : null,
            });
          }
        } catch {
          // skip invalid item
        }
      }
      
      return result;
    } catch {
      return [];
    }
  }, [data, threshold]);

  if (!data || !Array.isArray(data) || data.length === 0 || chartData.length === 0) {
    return (
      <div 
        className="flex items-center justify-center h-full text-muted-foreground text-sm"
        style={{ height }}
      >
        Carregando dados...
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 4, bottom: 4 }}>
        <defs>
          <linearGradient id="colorLatency" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="hsl(38, 92%, 50%)" stopOpacity={0.3} />
            <stop offset="95%" stopColor="hsl(38, 92%, 50%)" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="colorLatencyRed" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="hsl(0, 84%, 60%)" stopOpacity={0.3} />
            <stop offset="95%" stopColor="hsl(0, 84%, 60%)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="time"
          axisLine={false}
          tickLine={false}
          tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
        />
        <YAxis
          axisLine={false}
          tickLine={false}
          tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
          tickFormatter={(value) => `${value}ms`}
          domain={[0, "auto"]}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "hsl(var(--card))",
            border: "1px solid hsl(var(--border))",
            borderRadius: "6px",
            fontSize: "12px",
          }}
          labelStyle={{ color: "hsl(var(--foreground))" }}
          formatter={(value, name: string) => {
            if (value === null || value === undefined) return [null, null];
            const numVal = typeof value === 'number' ? value : 0;
            if (name === "threshold") return [`${numVal} ms`, "Limite SLA"];
            const label = name === "latencyDown" ? "Latência (Down)" : "Latência";
            return [`${numVal.toFixed(1)} ms`, label];
          }}
        />
        <Area
          type="monotone"
          dataKey="threshold"
          stroke="hsl(0, 84%, 60%)"
          strokeWidth={1}
          strokeDasharray="5 5"
          fill="none"
        />
        <Area
          type="monotone"
          dataKey="latency"
          stroke="hsl(38, 92%, 50%)"
          strokeWidth={2}
          fill="url(#colorLatency)"
          connectNulls={false}
        />
        <Area
          type="monotone"
          dataKey="latencyDown"
          stroke="hsl(0, 84%, 60%)"
          strokeWidth={2}
          fill="url(#colorLatencyRed)"
          connectNulls={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

interface PacketLossChartProps {
  data: Array<{
    timestamp: string;
    packetLoss: number | null;
    status?: string;
  }>;
  height?: number;
  threshold?: number;
}

export function PacketLossChart({ data, height = 200, threshold = 2 }: PacketLossChartProps) {
  const chartData = useMemo(() => {
    if (!data || !Array.isArray(data)) return [];
    try {
      const filtered = data.filter((item) => item && item.timestamp);
      const result: Array<{
        time: string;
        threshold: number;
        packetLoss: number | null;
        packetLossDown: number | null;
      }> = [];
      
      for (let i = 0; i < filtered.length; i++) {
        const item = filtered[i];
        const prevItem = i > 0 ? filtered[i - 1] : null;
        
        try {
          const pointStatus = item.status || "operational";
          const isDown = isDownStatus(pointStatus);
          const prevStatus = prevItem?.status || "operational";
          const wasDown = isDownStatus(prevStatus);
          
          const time = format(new Date(item.timestamp), "HH:mm", { locale: ptBR });
          const loss = item.packetLoss;
          
          if (loss === null || loss === undefined) {
            result.push({
              time,
              threshold,
              packetLoss: null,
              packetLossDown: null,
            });
          } else if (prevItem && isDown !== wasDown) {
            result.push({
              time,
              threshold,
              packetLoss: loss,
              packetLossDown: loss,
            });
          } else {
            result.push({
              time,
              threshold,
              packetLoss: isDown ? null : loss,
              packetLossDown: isDown ? loss : null,
            });
          }
        } catch {
          // skip invalid item
        }
      }
      
      return result;
    } catch {
      return [];
    }
  }, [data, threshold]);

  if (!data || !Array.isArray(data) || data.length === 0 || chartData.length === 0) {
    return (
      <div 
        className="flex items-center justify-center h-full text-muted-foreground text-sm"
        style={{ height }}
      >
        Carregando dados...
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 4, bottom: 4 }}>
        <defs>
          <linearGradient id="colorPacketLoss" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="hsl(280, 70%, 50%)" stopOpacity={0.3} />
            <stop offset="95%" stopColor="hsl(280, 70%, 50%)" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="colorPacketLossRed" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="hsl(0, 84%, 60%)" stopOpacity={0.3} />
            <stop offset="95%" stopColor="hsl(0, 84%, 60%)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="time"
          axisLine={false}
          tickLine={false}
          tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
        />
        <YAxis
          axisLine={false}
          tickLine={false}
          tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
          tickFormatter={(value) => `${value}%`}
          domain={[0, "auto"]}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "hsl(var(--card))",
            border: "1px solid hsl(var(--border))",
            borderRadius: "6px",
            fontSize: "12px",
          }}
          labelStyle={{ color: "hsl(var(--foreground))" }}
          formatter={(value, name: string) => {
            if (value === null || value === undefined) return [null, null];
            const numVal = typeof value === 'number' ? value : 0;
            if (name === "threshold") return [`${numVal}%`, "Limite SLA"];
            const label = name === "packetLossDown" ? "Perda (Down)" : "Perda de Pacotes";
            return [`${numVal.toFixed(1)}%`, label];
          }}
        />
        <Area
          type="monotone"
          dataKey="threshold"
          stroke="hsl(0, 84%, 60%)"
          strokeWidth={1}
          strokeDasharray="5 5"
          fill="none"
        />
        <Area
          type="monotone"
          dataKey="packetLoss"
          stroke="hsl(280, 70%, 50%)"
          strokeWidth={2}
          fill="url(#colorPacketLoss)"
          connectNulls={false}
        />
        <Area
          type="monotone"
          dataKey="packetLossDown"
          stroke="hsl(0, 84%, 60%)"
          strokeWidth={2}
          fill="url(#colorPacketLossRed)"
          connectNulls={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// Tipo exportado para controle de visibilidade das séries
export interface ChartSeriesVisibility {
  download: boolean;
  upload: boolean;
  latency: boolean;
  packetLoss: boolean;
}

// Gráfico unificado com banda, latência, perda e barras de disponibilidade
interface UnifiedMetricsChartProps {
  data: Array<{
    timestamp: string;
    download: number;
    upload: number;
    latency?: number;
    packetLoss?: number;
    status?: string;
  }>;
  height?: number;
  invertBandwidth?: boolean;
  latencyThreshold?: number;
  packetLossThreshold?: number;
  visibleSeries?: ChartSeriesVisibility;
}

export function UnifiedMetricsChart({
  data,
  height = 300,
  invertBandwidth = false,
  latencyThreshold = 80,
  packetLossThreshold = 2,
  visibleSeries = { download: true, upload: true, latency: true, packetLoss: true },
}: UnifiedMetricsChartProps) {

  const chartData = useMemo(() => {
    if (!data || !Array.isArray(data)) return [];
    try {
      const filtered = data.filter((item) => item && item.timestamp);
      if (!filtered.length) return [];

      // Gap threshold: 4× mediana dos intervalos ou no mínimo 3 min
      const expectedGapMs = getExpectedGapMs(filtered);
      const gapThreshold = Math.max(expectedGapMs * 4, 3 * 60_000);

      // Pré-calcular séries para suavização
      const shouldInvert = !invertBandwidth;
      const rawDls     = filtered.map(it => shouldInvert ? (it.upload ?? 0)   : (it.download ?? 0));
      const rawUls     = filtered.map(it => shouldInvert ? (it.download ?? 0) : (it.upload ?? 0));
      const rawLats    = filtered.map(it => it.latency ?? 0);

      const win = filtered.length > 200 ? 5 : filtered.length > 60 ? 3 : 1;
      const smoothDls  = win > 1 ? smoothValues(rawDls,  win) : rawDls;
      const smoothUls  = win > 1 ? smoothValues(rawUls,  win) : rawUls;
      const smoothLats = win > 1 ? smoothValues(rawLats, win) : rawLats;

      const result: Array<{
        time: string; tsNum: number; timestamp: string;
        download: number | null; upload: number | null; latency: number | null;
        packetLoss: number | null;
        availabilityOk: number; availabilityDegraded: number; availabilityDown: number;
        status: string;
        isGap?: boolean;
      }> = [];

      for (let i = 0; i < filtered.length; i++) {
        const item = filtered[i];
        const prevItem = i > 0 ? filtered[i - 1] : null;

        // Quebra de linha para restart/gap — null faz o Recharts não conectar os pontos
        if (prevItem) {
          const prevTs = new Date(prevItem.timestamp).getTime();
          const currTs = new Date(item.timestamp).getTime();
          if (currTs - prevTs > gapThreshold) {
            const midTs = Math.round((prevTs + currTs) / 2);
            result.push({
              time: format(new Date(midTs), "HH:mm", { locale: ptBR }),
              tsNum: midTs, timestamp: new Date(midTs).toISOString(),
              download: null, upload: null, latency: null,
              packetLoss: null,
              availabilityOk: 0, availabilityDegraded: 0, availabilityDown: 0,
              status: "gap", isGap: true,
            });
          }
        }

        const pointStatus = item.status || "operational";
        const isDown = isDownStatus(pointStatus);
        const isDegraded = pointStatus === "degraded";
        
        let tsNum = 0;
        let timeLabel = "";
        try {
          const d = new Date(item.timestamp);
          tsNum = d.getTime();
          timeLabel = format(d, "HH:mm", { locale: ptBR });
        } catch {}
        
        result.push({
          time: timeLabel,
          tsNum,
          timestamp: item.timestamp,
          download: smoothDls[i],
          upload:   smoothUls[i],
          latency:  smoothLats[i],
          packetLoss: isDown ? null : (item.packetLoss ?? 0),
          availabilityOk: !isDown && !isDegraded ? 1 : 0,
          availabilityDegraded: isDegraded ? 1 : 0,
          availabilityDown: isDown ? 1 : 0,
          status: pointStatus,
        });
      }

      return result;
    } catch {
      return [];
    }
  }, [data, invertBandwidth]);

  // Calcular máximos para eixos
  const { maxBandwidth, maxLatency } = useMemo(() => {
    let maxBw = 0;
    let maxLat = 0;
    chartData.forEach(d => {
      maxBw = Math.max(maxBw, d.download ?? 0, d.upload ?? 0);
      maxLat = Math.max(maxLat, d.latency ?? 0);
    });
    return { 
      maxBandwidth: Math.ceil(maxBw * 1.1), 
      maxLatency: Math.ceil(Math.max(maxLat * 1.2, latencyThreshold * 1.2))
    };
  }, [chartData, latencyThreshold]);

  if (!data || data.length === 0 || chartData.length === 0) {
    return (
      <div 
        className="flex items-center justify-center h-full text-muted-foreground text-sm"
        style={{ height }}
      >
        Carregando dados...
      </div>
    );
  }

  const formatBandwidth = (value: number) => {
    if (value >= 1000) return `${(value / 1000).toFixed(1)}G`;
    return `${value.toFixed(0)}M`;
  };

  // Altura do gráfico principal (desconta barra de disponibilidade)
  const availabilityBarHeight = 8;
  const mainChartHeight = height - availabilityBarHeight - 4;

  return (
    <div className="w-full flex flex-col">
      {/* Gráfico principal */}
      <div style={{ height: mainChartHeight }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart 
            data={chartData} 
            margin={{ top: 10, right: 50, left: 10, bottom: 5 }}
          >
            <defs>
              <linearGradient id="gradDownload" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(210, 85%, 55%)" stopOpacity={0.4} />
                <stop offset="95%" stopColor="hsl(210, 85%, 55%)" stopOpacity={0.05} />
              </linearGradient>
              <linearGradient id="gradUpload" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(280, 70%, 60%)" stopOpacity={0.4} />
                <stop offset="95%" stopColor="hsl(280, 70%, 60%)" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            
            <XAxis
              dataKey="tsNum"
              type="number"
              scale="time"
              domain={['dataMin', 'dataMax']}
              tickFormatter={(ts: number) => {
                try { return format(new Date(ts), "HH:mm", { locale: ptBR }); } catch { return ""; }
              }}
              tickCount={7}
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
            />
            
            {/* Eixo Y esquerdo: Banda */}
            <YAxis
              yAxisId="bandwidth"
              orientation="left"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              tickFormatter={formatBandwidth}
              domain={[0, maxBandwidth || "auto"]}
              width={45}
            />
            
            {/* Eixo Y direito: Latência */}
            <YAxis
              yAxisId="latency"
              orientation="right"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              tickFormatter={(v) => `${v}ms`}
              domain={[0, maxLatency || "auto"]}
              width={45}
            />
            
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "8px",
                fontSize: "12px",
                padding: "8px 12px",
              }}
              labelStyle={{ color: "hsl(var(--foreground))", fontWeight: 600, marginBottom: 4 }}
              formatter={(value: number, name: string) => {
                if (name === "download") return [`${value.toFixed(1)} Mbps`, "Download"];
                if (name === "upload") return [`${value.toFixed(1)} Mbps`, "Upload"];
                if (name === "latency") return [`${value.toFixed(1)} ms`, "Latência"];
                if (name === "packetLoss") return [`${value.toFixed(2)}%`, "Perda"];
                return [null, null];
              }}
              labelFormatter={(ts: number) => {
                try { return `Horário: ${format(new Date(ts), "HH:mm", { locale: ptBR })}`; } catch { return `Horário: ${ts}`; }
              }}
            />
            
            {/* Linha de referência para latência SLA */}
            {visibleSeries.latency && (
              <ReferenceLine
                yAxisId="latency"
                y={latencyThreshold}
                stroke="hsl(38, 92%, 50%)"
                strokeDasharray="4 4"
                strokeOpacity={0.6}
              />
            )}
            
            {/* Áreas de banda */}
            {visibleSeries.download && (
              <Area
                yAxisId="bandwidth"
                type="monotone"
                dataKey="download"
                stroke="hsl(210, 85%, 55%)"
                strokeWidth={2}
                fill="url(#gradDownload)"
                connectNulls={false}
              />
            )}
            {visibleSeries.upload && (
              <Area
                yAxisId="bandwidth"
                type="monotone"
                dataKey="upload"
                stroke="hsl(280, 70%, 60%)"
                strokeWidth={2}
                fill="url(#gradUpload)"
                connectNulls={false}
              />
            )}
            
            {/* Linha de latência */}
            {visibleSeries.latency && (
              <Line
                yAxisId="latency"
                type="monotone"
                dataKey="latency"
                stroke="hsl(38, 92%, 50%)"
                strokeWidth={1.5}
                dot={false}
                strokeDasharray="3 3"
                connectNulls={false}
              />
            )}
            
            {/* Linha de perda de pacotes */}
            {visibleSeries.packetLoss && (
              <Line
                yAxisId="latency"
                type="monotone"
                dataKey="packetLoss"
                stroke="hsl(0, 84%, 60%)"
                strokeWidth={1}
                dot={false}
                connectNulls={false}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      
      {/* Barra de disponibilidade contínua na base (estilo Unifi) — margem alinhada com a área de dados */}
      <div style={{ height: availabilityBarHeight, minHeight: availabilityBarHeight }} className="ml-[55px] mr-[95px] rounded overflow-hidden flex-shrink-0">
        <div className="flex h-full w-full">
          {(() => {
            const firstTs = chartData[0]?.tsNum ?? 0;
            const lastTs = chartData[chartData.length - 1]?.tsNum ?? 0;
            const totalMs = lastTs - firstTs || 1;
            const avgGap = totalMs / Math.max(chartData.length - 1, 1);
            return chartData.map((point, idx) => {
              const nextTs = idx < chartData.length - 1 ? chartData[idx + 1].tsNum : point.tsNum + avgGap;
              const segMs = Math.max(nextTs - point.tsNum, 0);
              const pct = totalMs > 0 ? (segMs / totalMs * 100) : (100 / chartData.length);
              let bgColor = "bg-green-500";
              if (point.availabilityDown > 0) bgColor = "bg-red-500";
              else if (point.availabilityDegraded > 0) bgColor = "bg-yellow-500";
              return (
                <div
                  key={idx}
                  className={`h-full ${bgColor}`}
                  style={{ width: `${pct}%` }}
                  title={`${point.time} - ${point.availabilityDown > 0 ? "Offline" : point.availabilityDegraded > 0 ? "Degradado" : "Online"}`}
                />
              );
            });
          })()}
        </div>
      </div>
      
    </div>
  );
}

import { useMemo } from "react";
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
      const result: Array<{
        time: string;
        download: number | null;
        upload: number | null;
        downloadDown: number | null;
        uploadDown: number | null;
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
          const rawDl = item.download ?? 0;
          const rawUl = item.upload ?? 0;
          // Inversão é o padrão (concentradores). invertBandwidth=true = manter original
          const shouldInvert = !invertBandwidth;
          const dl = shouldInvert ? rawUl : rawDl;
          const ul = shouldInvert ? rawDl : rawUl;
          
          // Se mudou de status, adicionar ponto de transição
          if (prevItem && isDown !== wasDown) {
            result.push({
              time,
              download: dl,
              upload: ul,
              downloadDown: dl,
              uploadDown: ul,
            });
          } else {
            result.push({
              time,
              download: isDown ? null : dl,
              upload: isDown ? null : ul,
              downloadDown: isDown ? dl : null,
              uploadDown: isDown ? ul : null,
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
  }, [data]);

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
              dataKey="time"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              tickFormatter={(value) => `${value} Mbps`}
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
          formatter={(value, name: string) => {
            if (value === null || value === undefined) return [null, null];
            const numVal = typeof value === 'number' ? value : 0;
            const label = name.includes("Down") 
              ? (name.includes("download") ? "Download (Down)" : "Upload (Down)")
              : (name === "download" ? "Download" : "Upload");
            return [`${numVal.toFixed(1)} Mbps`, label];
          }}
        />
        <Area
          type="monotone"
          dataKey="download"
          stroke="hsl(210, 85%, 50%)"
          strokeWidth={2}
          fill="url(#colorDownload)"
          connectNulls={false}
        />
        <Area
          type="monotone"
          dataKey="upload"
          stroke="hsl(142, 76%, 45%)"
          strokeWidth={2}
          fill="url(#colorUpload)"
          connectNulls={false}
        />
        <Area
          type="monotone"
          dataKey="downloadDown"
          stroke="hsl(0, 84%, 60%)"
          strokeWidth={2}
          fill="url(#colorDownloadRed)"
          connectNulls={false}
        />
        <Area
          type="monotone"
          dataKey="uploadDown"
          stroke="hsl(0, 70%, 50%)"
          strokeWidth={2}
          fill="url(#colorUploadRed)"
          connectNulls={false}
        />
      </AreaChart>
    </ResponsiveContainer>
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
  showLegend?: boolean;
  latencyThreshold?: number;
  packetLossThreshold?: number;
}

export function UnifiedMetricsChart({
  data,
  height = 300,
  invertBandwidth = false,
  showLegend = true,
  latencyThreshold = 80,
  packetLossThreshold = 2,
}: UnifiedMetricsChartProps) {
  const chartData = useMemo(() => {
    if (!data || !Array.isArray(data)) return [];
    try {
      const filtered = data.filter((item) => item && item.timestamp);
      
      return filtered.map((item) => {
        const pointStatus = item.status || "operational";
        const isDown = isDownStatus(pointStatus);
        const isDegraded = pointStatus === "degraded";
        
        let timeLabel: string;
        try {
          timeLabel = format(new Date(item.timestamp), "HH:mm", { locale: ptBR });
        } catch {
          timeLabel = "";
        }
        
        const rawDl = item.download ?? 0;
        const rawUl = item.upload ?? 0;
        const shouldInvert = !invertBandwidth;
        const dl = shouldInvert ? rawUl : rawDl;
        const ul = shouldInvert ? rawDl : rawUl;
        
        return {
          time: timeLabel,
          timestamp: item.timestamp,
          download: dl,
          upload: ul,
          latency: item.latency ?? 0,
          packetLoss: item.packetLoss ?? 0,
          // Status para barras de disponibilidade (valor fixo para consistência)
          availabilityOk: !isDown && !isDegraded ? 1 : 0,
          availabilityDegraded: isDegraded ? 1 : 0,
          availabilityDown: isDown ? 1 : 0,
          status: pointStatus,
        };
      });
    } catch {
      return [];
    }
  }, [data, invertBandwidth]);

  // Calcular máximos para eixos
  const { maxBandwidth, maxLatency } = useMemo(() => {
    let maxBw = 0;
    let maxLat = 0;
    chartData.forEach(d => {
      maxBw = Math.max(maxBw, d.download, d.upload);
      maxLat = Math.max(maxLat, d.latency);
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

  // Altura do gráfico principal e da barra de disponibilidade
  const mainChartHeight = height - 24;
  const availabilityBarHeight = 20;

  return (
    <div className="w-full flex flex-col" style={{ height }}>
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
              dataKey="time"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              interval="preserveStartEnd"
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
              labelFormatter={(label) => `Horário: ${label}`}
            />
            
            {/* Linha de referência para latência SLA */}
            <ReferenceLine
              yAxisId="latency"
              y={latencyThreshold}
              stroke="hsl(38, 92%, 50%)"
              strokeDasharray="4 4"
              strokeOpacity={0.6}
            />
            
            {/* Áreas de banda */}
            <Area
              yAxisId="bandwidth"
              type="monotone"
              dataKey="download"
              stroke="hsl(210, 85%, 55%)"
              strokeWidth={2}
              fill="url(#gradDownload)"
            />
            <Area
              yAxisId="bandwidth"
              type="monotone"
              dataKey="upload"
              stroke="hsl(280, 70%, 60%)"
              strokeWidth={2}
              fill="url(#gradUpload)"
            />
            
            {/* Linha de latência */}
            <Line
              yAxisId="latency"
              type="monotone"
              dataKey="latency"
              stroke="hsl(38, 92%, 50%)"
              strokeWidth={1.5}
              dot={false}
              strokeDasharray="3 3"
            />
            
            {/* Linha de perda de pacotes */}
            <Line
              yAxisId="latency"
              type="monotone"
              dataKey="packetLoss"
              stroke="hsl(0, 84%, 60%)"
              strokeWidth={1}
              dot={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      
      {/* Barra de disponibilidade contínua na base (estilo Unifi) */}
      <div style={{ height: availabilityBarHeight }} className="mx-[55px] rounded overflow-hidden">
        <div className="flex h-full w-full">
          {chartData.map((point, idx) => {
            let bgColor = "bg-green-500";
            if (point.availabilityDown > 0) bgColor = "bg-red-500";
            else if (point.availabilityDegraded > 0) bgColor = "bg-yellow-500";
            
            return (
              <div
                key={idx}
                className={`flex-1 h-full ${bgColor}`}
                title={`${point.time} - ${point.availabilityDown > 0 ? "Offline" : point.availabilityDegraded > 0 ? "Degradado" : "Online"}`}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

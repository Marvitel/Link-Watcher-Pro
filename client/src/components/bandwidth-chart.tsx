import { useMemo } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
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
          const dl = invertBandwidth ? rawUl : rawDl;
          const ul = invertBandwidth ? rawDl : rawUl;
          
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

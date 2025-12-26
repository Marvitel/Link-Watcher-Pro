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
}

const isDownStatus = (s: string | undefined) => 
  s === "offline" || s === "critical" || s === "down";

export function BandwidthChart({
  data,
  height = 200,
  showAxes = false,
  status = "operational",
}: BandwidthChartProps) {
  const chartData = useMemo(() => {
    if (!data || !Array.isArray(data)) return [];
    try {
      return data
        .filter((item) => item && item.timestamp)
        .map((item) => {
          try {
            const pointStatus = item.status || status;
            const isDown = isDownStatus(pointStatus);
            return {
              time: format(new Date(item.timestamp), "HH:mm", { locale: ptBR }),
              download: isDown ? null : (item.download ?? 0),
              upload: isDown ? null : (item.upload ?? 0),
              downloadDown: isDown ? (item.download ?? 0) : null,
              uploadDown: isDown ? (item.upload ?? 0) : null,
            };
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    } catch {
      return [];
    }
  }, [data, status]);

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
          formatter={(value: number | null, name: string) => {
            if (value === null) return [null, null];
            const label = name.includes("Down") 
              ? (name.includes("download") ? "Download (Down)" : "Upload (Down)")
              : (name === "download" ? "Download" : "Upload");
            return [`${(value ?? 0).toFixed(1)} Mbps`, label];
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
    status?: string;
  }>;
  height?: number;
  threshold?: number;
  status?: string;
}

export function LatencyChart({ data, height = 200, threshold = 80, status = "operational" }: LatencyChartProps) {
  const chartData = useMemo(() => {
    if (!data || !Array.isArray(data)) return [];
    try {
      return data
        .filter((item) => item && item.timestamp)
        .map((item) => {
          try {
            const pointStatus = item.status || status;
            const isDown = isDownStatus(pointStatus);
            return {
              time: format(new Date(item.timestamp), "HH:mm", { locale: ptBR }),
              threshold,
              latency: isDown ? null : (item.latency ?? 0),
              latencyDown: isDown ? (item.latency ?? 0) : null,
            };
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    } catch {
      return [];
    }
  }, [data, threshold, status]);

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
          formatter={(value: number | null, name: string) => {
            if (value === null) return [null, null];
            if (name === "threshold") return [`${value} ms`, "Limite SLA"];
            const label = name === "latencyDown" ? "Latência (Down)" : "Latência";
            return [`${(value ?? 0).toFixed(1)} ms`, label];
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

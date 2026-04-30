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
import {
  pickTickFormat,
  pickTooltipFormat,
  getSpanMs,
  generateTimeTicks,
  getExpectedGapMs,
} from "@/lib/chart-time";

// ─────────────────────────────────────────────────────────────────────────────
// Padrão de visualização (MRTG/Cacti/Grafana):
//   - Janelas raw (<7d):  desenha o ponto bruto, sem suavização
//   - Janelas agregadas (>=7d): linha principal = MAX do bucket (pico real)
//                                + banda secundária mais transparente = AVG
// ─────────────────────────────────────────────────────────────────────────────

interface BandwidthChartProps {
  data: Array<{
    timestamp: string;
    download: number;
    upload: number;
    status?: string;
    // Quando o backend retorna dados agregados (>=7d), download/upload já vêm como
    // MAX do bucket (pico real) e estes campos opcionais trazem a média do mesmo bucket
    // para o desenho da banda secundária no padrão MRTG/Cacti.
    downloadAvg?: number;
    uploadAvg?: number;
    isAggregated?: boolean;
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

      // Inversão (sem suavização — sistemas profissionais de monitoramento mostram dado bruto)
      const shouldInvert = !invertBandwidth;
      const dls = filtered.map(it => shouldInvert ? (it.upload ?? 0) : (it.download ?? 0));
      const uls = filtered.map(it => shouldInvert ? (it.download ?? 0) : (it.upload ?? 0));
      const dlsAvg = filtered.map(it => {
        if (it.downloadAvg == null && it.uploadAvg == null) return null;
        return shouldInvert ? (it.uploadAvg ?? null) : (it.downloadAvg ?? null);
      });
      const ulsAvg = filtered.map(it => {
        if (it.downloadAvg == null && it.uploadAvg == null) return null;
        return shouldInvert ? (it.downloadAvg ?? null) : (it.uploadAvg ?? null);
      });

      const result: Array<{
        time: string;
        tsNum: number;
        download: number | null;
        upload: number | null;
        downloadAvg: number | null;
        uploadAvg: number | null;
        downloadDown: number | null;
        uploadDown: number | null;
        isDown: boolean;
        isDegraded: boolean;
        isAggregated: boolean;
      }> = [];

      for (let i = 0; i < filtered.length; i++) {
        const item = filtered[i];
        const prevItem = i > 0 ? filtered[i - 1] : null;

        try {
          // Interpolar ponto médio quando há gap de restart/queda
          if (prevItem) {
            const prevTs = new Date(prevItem.timestamp).getTime();
            const currTs = new Date(item.timestamp).getTime();
            if (currTs - prevTs > gapThreshold) {
              const midTs = Math.round((prevTs + currTs) / 2);
              const midDl = (dls[i - 1] + dls[i]) / 2;
              const midUl = (uls[i - 1] + uls[i]) / 2;
              const pa = dlsAvg[i - 1], pb = dlsAvg[i];
              const ua = ulsAvg[i - 1], ub = ulsAvg[i];
              const midDlAvg = pa != null && pb != null ? (pa + pb) / 2 : null;
              const midUlAvg = ua != null && ub != null ? (ua + ub) / 2 : null;
              const pointStatus = item.status || "operational";
              const isDown = isDownStatus(pointStatus);
              result.push({
                time: format(new Date(midTs), "HH:mm", { locale: ptBR }),
                tsNum: midTs,
                download: isDown ? null : midDl,
                upload: isDown ? null : midUl,
                downloadAvg: isDown ? null : midDlAvg,
                uploadAvg: isDown ? null : midUlAvg,
                downloadDown: isDown ? midDl : null,
                uploadDown: isDown ? midUl : null,
                isDown,
                isDegraded: pointStatus === "degraded",
                isAggregated: !!item.isAggregated,
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
          const dl = dls[i];
          const ul = uls[i];
          const dlAvg = dlsAvg[i];
          const ulAvg = ulsAvg[i];

          if (prevItem && isDown !== wasDown) {
            result.push({
              time, tsNum,
              download: dl, upload: ul,
              downloadAvg: dlAvg, uploadAvg: ulAvg,
              downloadDown: dl, uploadDown: ul,
              isDown, isDegraded,
              isAggregated: !!item.isAggregated,
            });
          } else {
            result.push({
              time, tsNum,
              download: isDown ? null : dl,
              upload: isDown ? null : ul,
              downloadAvg: isDown ? null : dlAvg,
              uploadAvg: isDown ? null : ulAvg,
              downloadDown: isDown ? dl : null,
              uploadDown: isDown ? ul : null,
              isDown,
              isDegraded,
              isAggregated: !!item.isAggregated,
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

  // Detecta se há dados agregados (algum ponto traz AVG separado do MAX)
  const hasAggregates = useMemo(
    () => chartData.some(p => p.isAggregated && (p.downloadAvg != null || p.uploadAvg != null)),
    [chartData]
  );

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

  // Span da janela e formatos derivados
  const spanMs = getSpanMs(chartData);
  const tickFmt = pickTickFormat(spanMs);
  const tooltipFmt = pickTooltipFormat(spanMs);
  const firstTs = chartData[0]?.tsNum ?? 0;
  const lastTs = chartData[chartData.length - 1]?.tsNum ?? 0;
  const totalMs = lastTs - firstTs || 1;
  const avgGap = totalMs / Math.max(chartData.length - 1, 1);
  const xTicks = generateTimeTicks(spanMs, firstTs, lastTs);

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
          {/* Banda secundária = média do bucket (estilo MRTG) */}
          <linearGradient id="colorDownloadAvg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="hsl(210, 85%, 50%)" stopOpacity={0.55} />
            <stop offset="95%" stopColor="hsl(210, 85%, 50%)" stopOpacity={0.15} />
          </linearGradient>
          <linearGradient id="colorUploadAvg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="hsl(142, 76%, 45%)" stopOpacity={0.55} />
            <stop offset="95%" stopColor="hsl(142, 76%, 45%)" stopOpacity={0.15} />
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
                try { return format(new Date(ts), tickFmt, { locale: ptBR }); } catch { return ""; }
              }}
              ticks={xTicks}
              interval={0}
              minTickGap={40}
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
            try { return format(new Date(ts), tooltipFmt, { locale: ptBR }); } catch { return String(ts); }
          }}
          formatter={(value, name: string) => {
            if (value === null || value === undefined) return [null, null];
            const numVal = typeof value === 'number' ? value : 0;
            const isAvg = name === "downloadAvg" || name === "uploadAvg";
            const isDown = name.includes("Down") && !isAvg;
            const baseLabel =
              name === "download" || name === "downloadDown" || name === "downloadAvg"
                ? "Download" : "Upload";
            const suffix = isAvg
              ? (hasAggregates ? " (médio)" : "")
              : (hasAggregates ? " (pico)" : "");
            const offlineSuffix = isDown ? " (Offline)" : "";
            return [`${numVal.toFixed(1)} Mbps`, `${baseLabel}${suffix}${offlineSuffix}`];
          }}
        />
        {/* Banda de MÉDIA (apenas em janelas agregadas) — desenhada por baixo */}
        {hasAggregates && (
          <>
            <Area type="monotone" dataKey="downloadAvg" stroke="hsl(210, 85%, 50%)" strokeOpacity={0.55} strokeWidth={1} fill="url(#colorDownloadAvg)" connectNulls={false} isAnimationActive={false} />
            <Area type="monotone" dataKey="uploadAvg"   stroke="hsl(142, 76%, 45%)" strokeOpacity={0.55} strokeWidth={1} fill="url(#colorUploadAvg)"   connectNulls={false} isAnimationActive={false} />
          </>
        )}
        {/* Linha principal: dado bruto (raw) ou MAX (agregado) */}
        <Area type="monotone" dataKey="download" stroke="hsl(210, 85%, 50%)" strokeWidth={2} fill="url(#colorDownload)" connectNulls={false} isAnimationActive={false} />
        <Area type="monotone" dataKey="upload"   stroke="hsl(142, 76%, 45%)" strokeWidth={2} fill="url(#colorUpload)"   connectNulls={false} isAnimationActive={false} />
        <Area type="monotone" dataKey="downloadDown" stroke="hsl(0, 84%, 60%)" strokeWidth={2} fill="url(#colorDownloadRed)" connectNulls={false} isAnimationActive={false} />
        <Area type="monotone" dataKey="uploadDown"   stroke="hsl(0, 70%, 50%)" strokeWidth={2} fill="url(#colorUploadRed)"   connectNulls={false} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );

  if (!showAxes) return chart;

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
    // Janelas agregadas (>=7d): latency = MAX, latencyAvg = média do bucket
    latencyAvg?: number;
    isAggregated?: boolean;
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
        tsNum: number;
        threshold: number;
        latency: number | null;
        latencyAvg: number | null;
        latencyDown: number | null;
        isAggregated: boolean;
      }> = [];

      for (let i = 0; i < filtered.length; i++) {
        const item = filtered[i];
        const prevItem = i > 0 ? filtered[i - 1] : null;

        try {
          const pointStatus = item.status || "operational";
          const isDown = isDownStatus(pointStatus);
          const prevStatus = prevItem?.status || "operational";
          const wasDown = isDownStatus(prevStatus);

          const d = new Date(item.timestamp);
          const time = format(d, "HH:mm", { locale: ptBR });
          const tsNum = d.getTime();
          const lat = item.latency ?? 0;
          const latAvg = item.latencyAvg ?? null;
          const isAgg = !!item.isAggregated;

          if (prevItem && isDown !== wasDown) {
            result.push({
              time, tsNum, threshold,
              latency: lat,
              latencyAvg: latAvg,
              latencyDown: lat,
              isAggregated: isAgg,
            });
          } else {
            result.push({
              time, tsNum, threshold,
              latency: isDown ? null : lat,
              latencyAvg: isDown ? null : latAvg,
              latencyDown: isDown ? lat : null,
              isAggregated: isAgg,
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

  const latHasAggregates = useMemo(
    () => chartData.some(p => p.isAggregated && p.latencyAvg != null),
    [chartData]
  );

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

  const latSpan = getSpanMs(chartData);
  const latTickFmt = pickTickFormat(latSpan);
  const latTooltipFmt = pickTooltipFormat(latSpan);
  const latFirstTs = chartData[0]?.tsNum ?? 0;
  const latLastTs = chartData[chartData.length - 1]?.tsNum ?? 0;
  const latXTicks = generateTimeTicks(latSpan, latFirstTs, latLastTs);

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
          <linearGradient id="colorLatencyAvg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="hsl(38, 92%, 50%)" stopOpacity={0.55} />
            <stop offset="95%" stopColor="hsl(38, 92%, 50%)" stopOpacity={0.15} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="tsNum"
          type="number"
          scale="time"
          domain={['dataMin', 'dataMax']}
          ticks={latXTicks}
          interval={0}
          minTickGap={40}
          tickFormatter={(ts: number) => {
            try { return format(new Date(ts), latTickFmt, { locale: ptBR }); } catch { return ""; }
          }}
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
          labelFormatter={(ts: number) => {
            try { return format(new Date(ts), latTooltipFmt, { locale: ptBR }); } catch { return String(ts); }
          }}
          formatter={(value, name: string) => {
            if (value === null || value === undefined) return [null, null];
            const numVal = typeof value === 'number' ? value : 0;
            if (name === "threshold") return [`${numVal} ms`, "Limite SLA"];
            if (name === "latencyAvg") return [`${numVal.toFixed(1)} ms`, "Latência (média)"];
            if (name === "latencyDown") return [`${numVal.toFixed(1)} ms`, "Latência (Down)"];
            const label = latHasAggregates ? "Latência (pico)" : "Latência";
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
          isAnimationActive={false}
        />
        {latHasAggregates && (
          <Area
            type="monotone"
            dataKey="latencyAvg"
            stroke="hsl(38, 92%, 50%)"
            strokeOpacity={0.55}
            strokeWidth={1}
            fill="url(#colorLatencyAvg)"
            connectNulls={false}
            isAnimationActive={false}
          />
        )}
        <Area
          type="monotone"
          dataKey="latency"
          stroke="hsl(38, 92%, 50%)"
          strokeWidth={2}
          fill="url(#colorLatency)"
          connectNulls={false}
          isAnimationActive={false}
        />
        <Area
          type="monotone"
          dataKey="latencyDown"
          stroke="hsl(0, 84%, 60%)"
          strokeWidth={2}
          fill="url(#colorLatencyRed)"
          connectNulls={false}
          isAnimationActive={false}
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
    packetLossAvg?: number;
    isAggregated?: boolean;
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
        tsNum: number;
        threshold: number;
        packetLoss: number | null;
        packetLossAvg: number | null;
        packetLossDown: number | null;
        isAggregated: boolean;
      }> = [];

      for (let i = 0; i < filtered.length; i++) {
        const item = filtered[i];
        const prevItem = i > 0 ? filtered[i - 1] : null;

        try {
          const pointStatus = item.status || "operational";
          const isDown = isDownStatus(pointStatus);
          const prevStatus = prevItem?.status || "operational";
          const wasDown = isDownStatus(prevStatus);

          const d = new Date(item.timestamp);
          const time = format(d, "HH:mm", { locale: ptBR });
          const tsNum = d.getTime();
          const loss = item.packetLoss;
          const lossAvg = item.packetLossAvg ?? null;
          const isAgg = !!item.isAggregated;

          if (loss === null || loss === undefined) {
            result.push({
              time, tsNum, threshold,
              packetLoss: null,
              packetLossAvg: lossAvg,
              packetLossDown: null,
              isAggregated: isAgg,
            });
          } else if (prevItem && isDown !== wasDown) {
            result.push({
              time, tsNum, threshold,
              packetLoss: loss,
              packetLossAvg: lossAvg,
              packetLossDown: loss,
              isAggregated: isAgg,
            });
          } else {
            result.push({
              time, tsNum, threshold,
              packetLoss: isDown ? null : loss,
              packetLossAvg: isDown ? null : lossAvg,
              packetLossDown: isDown ? loss : null,
              isAggregated: isAgg,
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

  const lossHasAggregates = useMemo(
    () => chartData.some(p => p.isAggregated && p.packetLossAvg != null),
    [chartData]
  );

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

  const lossSpan = getSpanMs(chartData);
  const lossTickFmt = pickTickFormat(lossSpan);
  const lossTooltipFmt = pickTooltipFormat(lossSpan);
  const lossFirstTs = chartData[0]?.tsNum ?? 0;
  const lossLastTs = chartData[chartData.length - 1]?.tsNum ?? 0;
  const lossXTicks = generateTimeTicks(lossSpan, lossFirstTs, lossLastTs);

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
          <linearGradient id="colorPacketLossAvg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="hsl(280, 70%, 50%)" stopOpacity={0.55} />
            <stop offset="95%" stopColor="hsl(280, 70%, 50%)" stopOpacity={0.15} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="tsNum"
          type="number"
          scale="time"
          domain={['dataMin', 'dataMax']}
          ticks={lossXTicks}
          interval={0}
          minTickGap={40}
          tickFormatter={(ts: number) => {
            try { return format(new Date(ts), lossTickFmt, { locale: ptBR }); } catch { return ""; }
          }}
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
          labelFormatter={(ts: number) => {
            try { return format(new Date(ts), lossTooltipFmt, { locale: ptBR }); } catch { return String(ts); }
          }}
          formatter={(value, name: string) => {
            if (value === null || value === undefined) return [null, null];
            const numVal = typeof value === 'number' ? value : 0;
            if (name === "threshold") return [`${numVal}%`, "Limite SLA"];
            if (name === "packetLossAvg") return [`${numVal.toFixed(1)}%`, "Perda (média)"];
            if (name === "packetLossDown") return [`${numVal.toFixed(1)}%`, "Perda (Down)"];
            const label = lossHasAggregates ? "Perda (pico)" : "Perda de Pacotes";
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
        {lossHasAggregates && (
          <Area
            type="monotone"
            dataKey="packetLossAvg"
            stroke="hsl(280, 70%, 50%)"
            strokeOpacity={0.55}
            strokeWidth={1}
            fill="url(#colorPacketLossAvg)"
            connectNulls={false}
          />
        )}
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
    // Janelas agregadas (>=7d): valores principais já vêm como MAX e os *Avg como média do bucket
    downloadAvg?: number;
    uploadAvg?: number;
    latencyAvg?: number;
    packetLossAvg?: number;
    isAggregated?: boolean;
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

      // Sem suavização — sistemas profissionais (MRTG/Cacti/Grafana) mostram dado bruto.
      // Em janelas agregadas, o backend já entrega MAX como valor principal.
      const shouldInvert = !invertBandwidth;
      const dls   = filtered.map(it => shouldInvert ? (it.upload ?? 0)   : (it.download ?? 0));
      const uls   = filtered.map(it => shouldInvert ? (it.download ?? 0) : (it.upload ?? 0));
      const lats  = filtered.map(it => it.latency ?? 0);
      const dlsAvg = filtered.map(it => {
        if (it.downloadAvg == null && it.uploadAvg == null) return null;
        return shouldInvert ? (it.uploadAvg ?? null) : (it.downloadAvg ?? null);
      });
      const ulsAvg = filtered.map(it => {
        if (it.downloadAvg == null && it.uploadAvg == null) return null;
        return shouldInvert ? (it.downloadAvg ?? null) : (it.uploadAvg ?? null);
      });
      const latsAvg  = filtered.map(it => it.latencyAvg ?? null);
      const lossesAvg = filtered.map(it => it.packetLossAvg ?? null);

      const result: Array<{
        time: string; tsNum: number; timestamp: string;
        download: number | null; upload: number | null; latency: number | null;
        packetLoss: number | null;
        downloadAvg: number | null; uploadAvg: number | null;
        latencyAvg: number | null; packetLossAvg: number | null;
        availabilityOk: number; availabilityDegraded: number; availabilityDown: number;
        status: string;
        isGap?: boolean;
        isAggregated: boolean;
      }> = [];

      for (let i = 0; i < filtered.length; i++) {
        const item = filtered[i];
        const prevItem = i > 0 ? filtered[i - 1] : null;
        const isAgg = !!item.isAggregated;

        // Interpolar ponto médio quando há gap de restart/queda
        if (prevItem) {
          const prevTs = new Date(prevItem.timestamp).getTime();
          const currTs = new Date(item.timestamp).getTime();
          if (currTs - prevTs > gapThreshold) {
            const midTs = Math.round((prevTs + currTs) / 2);
            const midDl  = (dls[i - 1]  + dls[i])  / 2;
            const midUl  = (uls[i - 1]  + uls[i])  / 2;
            const midLat = (lats[i - 1] + lats[i]) / 2;
            const midLoss = ((prevItem.packetLoss ?? 0) + (item.packetLoss ?? 0)) / 2;
            result.push({
              time: format(new Date(midTs), "HH:mm", { locale: ptBR }),
              tsNum: midTs, timestamp: new Date(midTs).toISOString(),
              download: midDl, upload: midUl, latency: midLat,
              packetLoss: midLoss,
              downloadAvg: null, uploadAvg: null, latencyAvg: null, packetLossAvg: null,
              availabilityOk: 0, availabilityDegraded: 0, availabilityDown: 0,
              status: "gap", isGap: true,
              isAggregated: isAgg,
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
          download: dls[i],
          upload:   uls[i],
          latency:  lats[i],
          packetLoss: isDown ? null : (item.packetLoss ?? 0),
          downloadAvg: dlsAvg[i],
          uploadAvg:   ulsAvg[i],
          latencyAvg:  latsAvg[i],
          packetLossAvg: isDown ? null : lossesAvg[i],
          availabilityOk: !isDown && !isDegraded ? 1 : 0,
          availabilityDegraded: isDegraded ? 1 : 0,
          availabilityDown: isDown ? 1 : 0,
          status: pointStatus,
          isAggregated: isAgg,
        });
      }

      return result;
    } catch {
      return [];
    }
  }, [data, invertBandwidth]);

  const uniHasAggregates = useMemo(
    () => chartData.some(p => p.isAggregated && (p.downloadAvg != null || p.uploadAvg != null || p.latencyAvg != null)),
    [chartData]
  );

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

  // Span da janela e formatos derivados
  const spanMs = getSpanMs(chartData);
  const tickFmt = pickTickFormat(spanMs);
  const tooltipFmt = pickTooltipFormat(spanMs);
  const firstTs = chartData[0]?.tsNum ?? 0;
  const lastTs = chartData[chartData.length - 1]?.tsNum ?? 0;
  const xTicks = generateTimeTicks(spanMs, firstTs, lastTs);

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
              <linearGradient id="gradDownloadAvg" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(210, 85%, 55%)" stopOpacity={0.7} />
                <stop offset="95%" stopColor="hsl(210, 85%, 55%)" stopOpacity={0.2} />
              </linearGradient>
              <linearGradient id="gradUploadAvg" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(280, 70%, 60%)" stopOpacity={0.7} />
                <stop offset="95%" stopColor="hsl(280, 70%, 60%)" stopOpacity={0.2} />
              </linearGradient>
            </defs>
            
            <XAxis
              dataKey="tsNum"
              type="number"
              scale="time"
              domain={['dataMin', 'dataMax']}
              tickFormatter={(ts: number) => {
                try { return format(new Date(ts), tickFmt, { locale: ptBR }); } catch { return ""; }
              }}
              ticks={xTicks}
              interval={0}
              minTickGap={40}
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
                if (value == null) return [null, null];
                const peakSuffix = uniHasAggregates ? " (pico)" : "";
                if (name === "download")    return [`${value.toFixed(1)} Mbps`, `Download${peakSuffix}`];
                if (name === "upload")      return [`${value.toFixed(1)} Mbps`, `Upload${peakSuffix}`];
                if (name === "latency")     return [`${value.toFixed(1)} ms`,   `Latência${peakSuffix}`];
                if (name === "packetLoss")  return [`${value.toFixed(2)}%`,     `Perda${peakSuffix}`];
                if (name === "downloadAvg") return [`${value.toFixed(1)} Mbps`, "Download (médio)"];
                if (name === "uploadAvg")   return [`${value.toFixed(1)} Mbps`, "Upload (médio)"];
                if (name === "latencyAvg")  return [`${value.toFixed(1)} ms`,   "Latência (média)"];
                if (name === "packetLossAvg") return [`${value.toFixed(2)}%`,   "Perda (média)"];
                return [null, null];
              }}
              labelFormatter={(ts: number) => {
                try { return `Horário: ${format(new Date(ts), tooltipFmt, { locale: ptBR })}`; } catch { return `Horário: ${ts}`; }
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
            
            {/* Banda secundária = MÉDIA (estilo MRTG) — só em janelas agregadas */}
            {uniHasAggregates && visibleSeries.download && (
              <Area
                yAxisId="bandwidth"
                type="monotone"
                dataKey="downloadAvg"
                stroke="hsl(210, 85%, 55%)"
                strokeOpacity={0.6}
                strokeWidth={1}
                fill="url(#gradDownloadAvg)"
                connectNulls={false}
                isAnimationActive={false}
              />
            )}
            {uniHasAggregates && visibleSeries.upload && (
              <Area
                yAxisId="bandwidth"
                type="monotone"
                dataKey="uploadAvg"
                stroke="hsl(280, 70%, 60%)"
                strokeOpacity={0.6}
                strokeWidth={1}
                fill="url(#gradUploadAvg)"
                connectNulls={false}
                isAnimationActive={false}
              />
            )}

            {/* Áreas principais: dado bruto (raw) ou MAX (agregado) */}
            {visibleSeries.download && (
              <Area
                yAxisId="bandwidth"
                type="monotone"
                dataKey="download"
                stroke="hsl(210, 85%, 55%)"
                strokeWidth={2}
                fill="url(#gradDownload)"
                connectNulls={false}
                isAnimationActive={false}
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
                isAnimationActive={false}
              />
            )}

            {/* Linha de latência média (sombra) */}
            {uniHasAggregates && visibleSeries.latency && (
              <Line
                yAxisId="latency"
                type="monotone"
                dataKey="latencyAvg"
                stroke="hsl(38, 92%, 50%)"
                strokeOpacity={0.45}
                strokeWidth={1}
                dot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
            )}

            {/* Linha de latência (pico em janelas agregadas, dado bruto em raw) */}
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
                isAnimationActive={false}
              />
            )}

            {/* Linha de perda de pacotes média (sombra) */}
            {uniHasAggregates && visibleSeries.packetLoss && (
              <Line
                yAxisId="latency"
                type="monotone"
                dataKey="packetLossAvg"
                stroke="hsl(0, 84%, 60%)"
                strokeOpacity={0.4}
                strokeWidth={1}
                dot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
            )}

            {/* Linha de perda de pacotes (pico em janelas agregadas) */}
            {visibleSeries.packetLoss && (
              <Line
                yAxisId="latency"
                type="monotone"
                dataKey="packetLoss"
                stroke="hsl(0, 84%, 60%)"
                strokeWidth={1}
                dot={false}
                connectNulls={false}
                isAnimationActive={false}
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

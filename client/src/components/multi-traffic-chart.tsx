import { useMemo } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface TrafficInterfaceConfig {
  id: number;
  label: string;
  color: string;
  invertBandwidth: boolean;
}

interface TrafficDataPoint {
  timestamp: string;
  download: number;
  upload: number;
  status?: string;
}

interface AdditionalInterfaceMetric {
  trafficInterfaceId: number;
  timestamp: string;
  download: number;
  upload: number;
}

interface MultiTrafficChartProps {
  mainData: TrafficDataPoint[];
  mainLabel?: string;
  mainColor?: string;
  invertMainBandwidth?: boolean;
  additionalInterfaces: TrafficInterfaceConfig[];
  additionalMetrics: AdditionalInterfaceMetric[];
  height?: number;
  showLegend?: boolean;
}

const isDownStatus = (s: string | undefined) => 
  s === "offline" || s === "critical" || s === "down";

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function MultiTrafficChart({
  mainData,
  mainLabel = "Principal",
  mainColor = "#3b82f6",
  invertMainBandwidth = false,
  additionalInterfaces,
  additionalMetrics,
  height = 250,
  showLegend = true,
}: MultiTrafficChartProps) {
  
  const chartData = useMemo(() => {
    if (!mainData || !Array.isArray(mainData)) return [];
    
    const filtered = mainData.filter((item) => item && item.timestamp);
    
    // DEBUG: Log dados recebidos
    console.log("[MultiTrafficChart] additionalInterfaces:", additionalInterfaces);
    console.log("[MultiTrafficChart] additionalMetrics count:", additionalMetrics.length);
    console.log("[MultiTrafficChart] mainData count:", mainData.length);
    if (additionalMetrics.length > 0) {
      console.log("[MultiTrafficChart] Sample additionalMetric:", additionalMetrics[0]);
    }
    
    // Pré-processar métricas adicionais por interface e indexá-las por timestamp aproximado
    const metricsIndex: Map<number, Map<number, {download: number; upload: number}>> = new Map();
    
    additionalInterfaces.forEach((iface) => {
      const ifaceMetrics = additionalMetrics.filter(m => m.trafficInterfaceId === iface.id);
      console.log(`[MultiTrafficChart] Interface ${iface.id} (${iface.label}): ${ifaceMetrics.length} metrics`);
      const timestampMap = new Map<number, {download: number; upload: number}>();
      ifaceMetrics.forEach(m => {
        // Usar timestamp truncado para minuto para alinhamento aproximado
        const ts = Math.floor(new Date(m.timestamp).getTime() / 60000) * 60000;
        timestampMap.set(ts, { download: m.download, upload: m.upload });
      });
      metricsIndex.set(iface.id, timestampMap);
    });
    
    return filtered.map((item) => {
      const time = format(new Date(item.timestamp), "HH:mm", { locale: ptBR });
      const mainTs = Math.floor(new Date(item.timestamp).getTime() / 60000) * 60000;
      const rawDl = item.download ?? 0;
      const rawUl = item.upload ?? 0;
      const shouldInvert = !invertMainBandwidth;
      const dl = shouldInvert ? rawUl : rawDl;
      const ul = shouldInvert ? rawDl : rawUl;
      
      const point: Record<string, unknown> = {
        time,
        timestamp: item.timestamp,
        main_download: dl,
        main_upload: ul,
        status: item.status,
      };
      
      additionalInterfaces.forEach((iface) => {
        const ifaceMetricsMap = metricsIndex.get(iface.id);
        const matchingMetric = ifaceMetricsMap?.get(mainTs);
        
        if (matchingMetric) {
          const rawDlAdd = (matchingMetric.download ?? 0) / 1000000;
          const rawUlAdd = (matchingMetric.upload ?? 0) / 1000000;
          const dlAdd = iface.invertBandwidth ? rawUlAdd : rawDlAdd;
          const ulAdd = iface.invertBandwidth ? rawDlAdd : rawUlAdd;
          
          point[`iface_${iface.id}_download`] = dlAdd;
          point[`iface_${iface.id}_upload`] = ulAdd;
        } else {
          point[`iface_${iface.id}_download`] = null;
          point[`iface_${iface.id}_upload`] = null;
        }
      });
      
      return point;
    });
  }, [mainData, additionalInterfaces, additionalMetrics, invertMainBandwidth]);

  if (!mainData || mainData.length === 0 || chartData.length === 0) {
    return (
      <div 
        className="flex items-center justify-center h-full text-muted-foreground text-sm"
        style={{ height }}
        data-testid="chart-loading"
      >
        Carregando dados...
      </div>
    );
  }

  const renderAreas = () => {
    const areas: JSX.Element[] = [];
    
    areas.push(
      <Area
        key="main_download"
        type="monotone"
        dataKey="main_download"
        name={`${mainLabel} (Download)`}
        stroke={mainColor}
        strokeWidth={2}
        fill={`url(#gradient_main_download)`}
        connectNulls={false}
      />,
      <Area
        key="main_upload"
        type="monotone"
        dataKey="main_upload"
        name={`${mainLabel} (Upload)`}
        stroke={mainColor}
        strokeWidth={1.5}
        strokeDasharray="4 2"
        fill="none"
        connectNulls={false}
      />
    );
    
    additionalInterfaces.forEach((iface) => {
      areas.push(
        <Area
          key={`iface_${iface.id}_download`}
          type="monotone"
          dataKey={`iface_${iface.id}_download`}
          name={`${iface.label} (Download)`}
          stroke={iface.color}
          strokeWidth={2}
          fill={`url(#gradient_iface_${iface.id})`}
          connectNulls={false}
        />,
        <Area
          key={`iface_${iface.id}_upload`}
          type="monotone"
          dataKey={`iface_${iface.id}_upload`}
          name={`${iface.label} (Upload)`}
          stroke={iface.color}
          strokeWidth={1.5}
          strokeDasharray="4 2"
          fill="none"
          connectNulls={false}
        />
      );
    });
    
    return areas;
  };

  const renderGradients = () => {
    const gradients: JSX.Element[] = [
      <linearGradient key="gradient_main_download" id="gradient_main_download" x1="0" y1="0" x2="0" y2="1">
        <stop offset="5%" stopColor={mainColor} stopOpacity={0.3} />
        <stop offset="95%" stopColor={mainColor} stopOpacity={0} />
      </linearGradient>
    ];
    
    additionalInterfaces.forEach((iface) => {
      gradients.push(
        <linearGradient key={`gradient_iface_${iface.id}`} id={`gradient_iface_${iface.id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="5%" stopColor={iface.color} stopOpacity={0.3} />
          <stop offset="95%" stopColor={iface.color} stopOpacity={0} />
        </linearGradient>
      );
    });
    
    return gradients;
  };

  return (
    <ResponsiveContainer width="100%" height={height} data-testid="multi-traffic-chart">
      <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: showLegend ? 5 : 4 }}>
        <defs>
          {renderGradients()}
        </defs>
        <XAxis
          dataKey="time"
          axisLine={false}
          tickLine={false}
          tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
          interval="preserveStartEnd"
        />
        <YAxis
          axisLine={false}
          tickLine={false}
          tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
          tickFormatter={(value) => {
            if (value >= 1000) return `${(value / 1000).toFixed(1)}G`;
            return `${value.toFixed(0)}M`;
          }}
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
          formatter={(value, name: string) => {
            if (value === null || value === undefined) return [null, null];
            const numVal = typeof value === 'number' ? value : 0;
            const formattedValue = numVal >= 1000 
              ? `${(numVal / 1000).toFixed(2)} Gbps` 
              : `${numVal.toFixed(1)} Mbps`;
            
            const parts = name.split(" (");
            const label = parts[0];
            const type = parts[1]?.replace(")", "") || "";
            
            return [formattedValue, `${label} ${type}`];
          }}
          labelFormatter={(label) => `Horário: ${label}`}
        />
        {showLegend && (
          <Legend 
            verticalAlign="bottom"
            height={36}
            wrapperStyle={{ fontSize: "11px" }}
            formatter={(value) => {
              if (value.includes("Upload")) {
                return <span style={{ color: "hsl(var(--muted-foreground))" }}>{value}</span>;
              }
              return value;
            }}
          />
        )}
        {renderAreas()}
      </AreaChart>
    </ResponsiveContainer>
  );
}

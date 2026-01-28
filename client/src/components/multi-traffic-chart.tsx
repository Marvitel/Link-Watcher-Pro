import { useMemo, useState } from "react";
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
  if (!hex || typeof hex !== 'string' || !hex.startsWith('#') || hex.length < 7) {
    return `rgba(128, 128, 128, ${alpha})`;
  }
  const r = parseInt(hex.slice(1, 3), 16) || 128;
  const g = parseInt(hex.slice(3, 5), 16) || 128;
  const b = parseInt(hex.slice(5, 7), 16) || 128;
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
  
  // Estado para controlar visibilidade das séries
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set());
  
  const toggleSeries = (seriesKey: string) => {
    setHiddenSeries(prev => {
      const next = new Set(prev);
      if (next.has(seriesKey)) {
        next.delete(seriesKey);
      } else {
        next.add(seriesKey);
      }
      return next;
    });
  };
  
  const chartData = useMemo(() => {
    if (!mainData || !Array.isArray(mainData)) return [];
    
    const filtered = mainData.filter((item) => item && item.timestamp);
    
    // Pré-processar métricas adicionais por interface
    // Usar múltiplas janelas de tempo para matching mais tolerante
    const metricsIndex: Map<number, Array<{ts: number; download: number; upload: number}>> = new Map();
    
    additionalInterfaces.forEach((iface) => {
      const ifaceMetrics = additionalMetrics
        .filter(m => m.trafficInterfaceId === iface.id)
        .map(m => ({
          ts: new Date(m.timestamp).getTime(),
          download: m.download,
          upload: m.upload,
        }))
        .sort((a, b) => a.ts - b.ts);
      metricsIndex.set(iface.id, ifaceMetrics);
    });
    
    // Função para encontrar métrica mais próxima dentro de 180 segundos
    const findClosestMetric = (metrics: Array<{ts: number; download: number; upload: number}>, targetTs: number) => {
      if (!metrics || metrics.length === 0) return null;
      const tolerance = 180000; // 180 segundos de tolerância (3 minutos)
      
      let closest = null;
      let minDiff = Infinity;
      
      for (const m of metrics) {
        const diff = Math.abs(m.ts - targetTs);
        if (diff < minDiff && diff <= tolerance) {
          minDiff = diff;
          closest = m;
        }
        // Como está ordenado, se passamos do target por muito, podemos parar
        if (m.ts > targetTs + tolerance) break;
      }
      
      return closest;
    };
    
    return filtered.map((item) => {
      const time = format(new Date(item.timestamp), "HH:mm", { locale: ptBR });
      const mainTs = new Date(item.timestamp).getTime();
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
        const ifaceMetricsArray = metricsIndex.get(iface.id) || [];
        const matchingMetric = findClosestMetric(ifaceMetricsArray, mainTs);
        
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
    
    // Só renderiza se não estiver oculto
    if (!hiddenSeries.has("main_download")) {
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
        />
      );
    }
    if (!hiddenSeries.has("main_upload")) {
      areas.push(
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
    }
    
    additionalInterfaces.forEach((iface) => {
      if (!iface || !iface.id) return;
      const safeColor = ensureValidColor(iface.color);
      const safeLabel = iface.label || `Interface ${iface.id}`;
      
      if (!hiddenSeries.has(`iface_${iface.id}_download`)) {
        areas.push(
          <Area
            key={`iface_${iface.id}_download`}
            type="monotone"
            dataKey={`iface_${iface.id}_download`}
            name={`${safeLabel} (Download)`}
            stroke={safeColor}
            strokeWidth={2}
            fill={`url(#gradient_iface_${iface.id})`}
            connectNulls={true}
          />
        );
      }
      if (!hiddenSeries.has(`iface_${iface.id}_upload`)) {
        areas.push(
          <Area
            key={`iface_${iface.id}_upload`}
            type="monotone"
            dataKey={`iface_${iface.id}_upload`}
            name={`${safeLabel} (Upload)`}
            stroke={safeColor}
            strokeWidth={1.5}
            strokeDasharray="4 2"
            fill="none"
            connectNulls={true}
          />
        );
      }
    });
    
    return areas;
  };

  // Função para garantir cor válida (duplicada para uso em renderGradients antes da declaração)
  const ensureValidColorForGradient = (color: string | undefined | null): string => {
    if (!color || typeof color !== 'string' || !color.startsWith('#') || color.length < 7) {
      return '#808080';
    }
    return color;
  };

  const renderGradients = () => {
    const safeMainColor = ensureValidColorForGradient(mainColor);
    const gradients: JSX.Element[] = [
      <linearGradient key="gradient_main_download" id="gradient_main_download" x1="0" y1="0" x2="0" y2="1">
        <stop offset="5%" stopColor={safeMainColor} stopOpacity={0.3} />
        <stop offset="95%" stopColor={safeMainColor} stopOpacity={0} />
      </linearGradient>
    ];
    
    additionalInterfaces.forEach((iface) => {
      if (!iface || !iface.id) return;
      const safeColor = ensureValidColorForGradient(iface.color);
      gradients.push(
        <linearGradient key={`gradient_iface_${iface.id}`} id={`gradient_iface_${iface.id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="5%" stopColor={safeColor} stopOpacity={0.3} />
          <stop offset="95%" stopColor={safeColor} stopOpacity={0} />
        </linearGradient>
      );
    });
    
    return gradients;
  };

  // Função para garantir cor válida
  const ensureValidColor = (color: string | undefined | null): string => {
    if (!color || typeof color !== 'string' || !color.startsWith('#') || color.length < 7) {
      return '#808080';
    }
    return color;
  };

  // Construir itens da legenda
  const legendItems = useMemo(() => {
    const items: Array<{key: string; label: string; color: string; isDashed: boolean}> = [];
    
    // Principal
    const safeMainColor = ensureValidColor(mainColor);
    items.push({ key: "main_download", label: `${mainLabel || 'Principal'} (Download)`, color: safeMainColor, isDashed: false });
    items.push({ key: "main_upload", label: `${mainLabel || 'Principal'} (Upload)`, color: safeMainColor, isDashed: true });
    
    // Interfaces adicionais
    additionalInterfaces.forEach((iface) => {
      if (!iface || !iface.id) return;
      const safeColor = ensureValidColor(iface.color);
      const safeLabel = iface.label || `Interface ${iface.id}`;
      items.push({ key: `iface_${iface.id}_download`, label: `${safeLabel} (Download)`, color: safeColor, isDashed: false });
      items.push({ key: `iface_${iface.id}_upload`, label: `${safeLabel} (Upload)`, color: safeColor, isDashed: true });
    });
    
    return items;
  }, [mainLabel, mainColor, additionalInterfaces]);

  return (
    <div className="flex flex-col" data-testid="multi-traffic-chart">
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 4 }}>
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
          {renderAreas()}
        </AreaChart>
      </ResponsiveContainer>
      
      {showLegend && (
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 mt-2 px-3 py-2 text-xs">
          {legendItems.map((item) => (
            <button
              key={item.key}
              onClick={() => toggleSeries(item.key)}
              className={`flex items-center gap-1.5 px-2 py-1 rounded hover-elevate transition-opacity cursor-pointer ${
                hiddenSeries.has(item.key) ? "opacity-30" : ""
              }`}
              data-testid={`legend-${item.key}`}
            >
              {item.isDashed ? (
                <span 
                  className="w-4 border-t-2 border-dashed" 
                  style={{ borderColor: item.color }}
                />
              ) : (
                <span 
                  className="w-3 h-1.5 rounded-sm" 
                  style={{ backgroundColor: item.color }}
                />
              )}
              <span className={item.isDashed ? "text-muted-foreground" : ""}>
                {item.label}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

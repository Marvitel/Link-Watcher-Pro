import { useMemo } from "react";

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  showDot?: boolean;
}

export function Sparkline({
  data,
  width = 80,
  height = 24,
  color = "currentColor",
  showDot = true,
}: SparklineProps) {
  const path = useMemo(() => {
    if (!data || data.length < 2) return "";

    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;

    const points = data.map((value, index) => {
      const x = (index / (data.length - 1)) * width;
      const y = height - ((value - min) / range) * (height - 4) - 2;
      return { x, y };
    });

    const pathData = points
      .map((point, index) => {
        if (index === 0) return `M ${point.x} ${point.y}`;
        return `L ${point.x} ${point.y}`;
      })
      .join(" ");

    return pathData;
  }, [data, width, height]);

  const lastPoint = useMemo(() => {
    if (!data || data.length < 2) return null;
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const lastValue = data[data.length - 1];
    return {
      x: width,
      y: height - ((lastValue - min) / range) * (height - 4) - 2,
    };
  }, [data, width, height]);

  if (!data || data.length < 2) {
    return (
      <svg width={width} height={height} className="text-muted-foreground/30">
        <line
          x1="0"
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke="currentColor"
          strokeWidth="1"
          strokeDasharray="4 2"
        />
      </svg>
    );
  }

  return (
    <svg width={width} height={height} className="overflow-visible">
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {showDot && lastPoint && (
        <circle
          cx={lastPoint.x}
          cy={lastPoint.y}
          r="2.5"
          fill={color}
        />
      )}
    </svg>
  );
}

interface MetricSparklineProps {
  data: Array<{ timestamp: string; value: number }>;
  width?: number;
  height?: number;
  type?: "latency" | "packetLoss" | "bandwidth";
}

export function MetricSparkline({
  data,
  width = 80,
  height = 24,
  type = "bandwidth",
}: MetricSparklineProps) {
  const values = useMemo(() => {
    if (!Array.isArray(data)) return [];
    return data.map((d) => d.value);
  }, [data]);

  const colorClass = useMemo(() => {
    switch (type) {
      case "latency":
        return "text-yellow-500";
      case "packetLoss":
        return "text-red-500";
      case "bandwidth":
      default:
        return "text-blue-500";
    }
  }, [type]);

  return (
    <span className={colorClass}>
      <Sparkline data={values} width={width} height={height} color="currentColor" />
    </span>
  );
}

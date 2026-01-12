import { Badge } from "@/components/ui/badge";

interface StatusBadgeProps {
  status: string;
  reason?: string | null;
}

const statusConfig: Record<string, { label: string; className: string }> = {
  operational: {
    label: "Operacional",
    className: "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20",
  },
  degraded: {
    label: "Degradado",
    className: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  },
  down: {
    label: "Inoperante",
    className: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
  },
  offline: {
    label: "Offline",
    className: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
  },
  critical: {
    label: "Crítico",
    className: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
  },
  maintenance: {
    label: "Manutenção",
    className: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
  },
};

const defaultConfig = {
  label: "Desconhecido",
  className: "bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/20",
};

const reasonLabels: Record<string, string> = {
  // OLT diagnosis reasons
  rompimento_fibra: "Rompimento de Fibra",
  queda_energia: "Queda de Energia",
  sinal_degradado: "Sinal Degradado",
  onu_inativa: "ONU Inativa",
  olt_alarm: "Alarme OLT",
  // Network/ping reasons
  timeout: "Timeout",
  host_unreachable: "Host inacessível",
  network_unreachable: "Rede inacessível",
  connection_refused: "Conexão recusada",
  packet_loss: "Perda de pacotes",
  no_response: "Sem resposta",
  dns_failure: "Falha DNS",
  unknown: "Desconhecido",
};

export function StatusBadge({ status, reason }: StatusBadgeProps) {
  const config = statusConfig[status] || defaultConfig;
  const isOffline = status === "offline" || status === "down";
  const reasonLabel = reason ? (reasonLabels[reason] || reason) : null;
  
  return (
    <Badge variant="outline" className={config.className} data-testid={`badge-status-${status}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current mr-1.5" />
      {config.label}
      {isOffline && reasonLabel && (
        <span className="ml-1 opacity-80">({reasonLabel})</span>
      )}
    </Badge>
  );
}

interface StatusDotProps {
  status: string;
  size?: "sm" | "md" | "lg";
}

const sizeClasses = {
  sm: "w-2 h-2",
  md: "w-2.5 h-2.5",
  lg: "w-3 h-3",
};

const dotColors: Record<string, string> = {
  operational: "bg-green-500",
  degraded: "bg-amber-500",
  down: "bg-red-500",
  offline: "bg-red-500",
  critical: "bg-red-500",
  maintenance: "bg-blue-500",
};

const defaultDotColor = "bg-gray-500";

export function StatusDot({ status, size = "md" }: StatusDotProps) {
  const color = dotColors[status] || defaultDotColor;
  return (
    <span
      className={`${sizeClasses[size]} ${color} rounded-full inline-block`}
      data-testid={`dot-status-${status}`}
    />
  );
}

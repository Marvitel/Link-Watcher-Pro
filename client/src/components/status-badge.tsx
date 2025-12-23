import { Badge } from "@/components/ui/badge";
import type { LinkStatus } from "@shared/schema";

interface StatusBadgeProps {
  status: LinkStatus;
}

const statusConfig: Record<LinkStatus, { label: string; className: string }> = {
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
  maintenance: {
    label: "Manutenção",
    className: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
  },
};

export function StatusBadge({ status }: StatusBadgeProps) {
  const config = statusConfig[status];
  
  return (
    <Badge variant="outline" className={config.className} data-testid={`badge-status-${status}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current mr-1.5" />
      {config.label}
    </Badge>
  );
}

interface StatusDotProps {
  status: LinkStatus;
  size?: "sm" | "md" | "lg";
}

const sizeClasses = {
  sm: "w-2 h-2",
  md: "w-2.5 h-2.5",
  lg: "w-3 h-3",
};

const dotColors: Record<LinkStatus, string> = {
  operational: "bg-green-500",
  degraded: "bg-amber-500",
  down: "bg-red-500",
  maintenance: "bg-blue-500",
};

export function StatusDot({ status, size = "md" }: StatusDotProps) {
  return (
    <span
      className={`${sizeClasses[size]} ${dotColors[status]} rounded-full inline-block`}
      data-testid={`dot-status-${status}`}
    />
  );
}

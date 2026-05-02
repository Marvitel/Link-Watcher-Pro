import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { CheckCircle2, AlertTriangle, AlertOctagon, Wrench } from "lucide-react";

export type VoalleConnectionStatus =
  | "normal"
  | "blocked"
  | "block_warning"
  | "maintenance_warning"
  | "unknown";

interface VoalleConnectionStatusBadgeProps {
  status: VoalleConnectionStatus | string | null | undefined;
  /** Quando true, mostra também o status "Normal". Padrão: false (esconde Normal). */
  showWhenNormal?: boolean;
  /** Mostrar apenas o ícone (compacto, ideal para cards). */
  iconOnly?: boolean;
  className?: string;
}

const STATUS_CONFIG: Record<
  VoalleConnectionStatus,
  {
    label: string;
    description: string;
    Icon: typeof CheckCircle2;
    className: string;
  }
> = {
  normal: {
    label: "Normal",
    description: "Conexão operando normalmente no Voalle",
    Icon: CheckCircle2,
    className: "bg-green-500/10 text-green-700 border-green-500/30 dark:text-green-400",
  },
  blocked: {
    label: "Bloqueada",
    description: "Conexão bloqueada no Voalle",
    Icon: AlertOctagon,
    className: "bg-red-500/10 text-red-700 border-red-500/30 dark:text-red-400",
  },
  block_warning: {
    label: "Aviso de Bloqueio",
    description: "Conexão com aviso de bloqueio iminente no Voalle",
    Icon: AlertTriangle,
    className: "bg-amber-500/10 text-amber-700 border-amber-500/40 dark:text-amber-400",
  },
  maintenance_warning: {
    label: "Aviso de Manutenção",
    description: "Conexão com aviso de manutenção no Voalle",
    Icon: Wrench,
    className: "bg-blue-500/10 text-blue-700 border-blue-500/30 dark:text-blue-400",
  },
  unknown: {
    label: "Desconhecido",
    description: "Status ainda não sincronizado com o Voalle",
    Icon: AlertTriangle,
    className: "bg-muted text-muted-foreground border-border",
  },
};

export function VoalleConnectionStatusBadge({
  status,
  showWhenNormal = false,
  iconOnly = false,
  className = "",
}: VoalleConnectionStatusBadgeProps) {
  const normalized = (status ?? "unknown") as VoalleConnectionStatus;
  const config = STATUS_CONFIG[normalized] ?? STATUS_CONFIG.unknown;

  // Esconde quando Normal e não foi pedido explicitamente
  if (normalized === "normal" && !showWhenNormal) return null;
  // Esconde quando desconhecido (sem dado ainda)
  if (normalized === "unknown" && !showWhenNormal) return null;

  const { Icon, label, description, className: cls } = config;

  const badge = (
    <Badge
      variant="outline"
      className={`${cls} ${className} gap-1 font-medium`}
      data-testid={`badge-voalle-status-${normalized}`}
    >
      <Icon className="w-3 h-3" />
      {!iconOnly && <span>{label}</span>}
    </Badge>
  );

  if (iconOnly) {
    return (
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span>{badge}</span>
          </TooltipTrigger>
          <TooltipContent>
            <span className="text-xs">
              <strong>{label}</strong> — {description}
            </span>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return badge;
}

export function getVoalleConnectionStatusLabel(status: string | null | undefined): string {
  const normalized = (status ?? "unknown") as VoalleConnectionStatus;
  return (STATUS_CONFIG[normalized] ?? STATUS_CONFIG.unknown).label;
}

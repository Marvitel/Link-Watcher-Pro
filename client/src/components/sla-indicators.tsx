import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import type { SLAIndicator } from "@shared/schema";

interface SLAIndicatorsProps {
  indicators: SLAIndicator[];
}

const statusConfig = {
  compliant: {
    icon: CheckCircle2,
    className: "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20",
    label: "Conforme",
    progressColor: "bg-green-500",
  },
  warning: {
    icon: AlertTriangle,
    className: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
    label: "Atenção",
    progressColor: "bg-amber-500",
  },
  non_compliant: {
    icon: XCircle,
    className: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
    label: "Não Conforme",
    progressColor: "bg-red-500",
  },
};

export function SLAIndicators({ indicators }: SLAIndicatorsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {indicators.map((indicator) => {
        const config = statusConfig[indicator.status] || statusConfig.warning;
        const Icon = config.icon;
        const safeCurrent = indicator.current ?? 0;
        const progressValue = Math.min(100, Math.max(0, safeCurrent));

        return (
          <Card key={indicator.id} data-testid={`card-sla-${indicator.id}`}>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{indicator.name}</CardTitle>
              <Badge variant="outline" className={config.className}>
                <Icon className="w-3 h-3 mr-1" />
                {config.label}
              </Badge>
            </CardHeader>
            <CardContent>
              <div className="flex items-baseline gap-2 mb-2">
                <span className="text-2xl font-semibold font-mono" data-testid={`text-sla-current-${indicator.id}`}>
                  {safeCurrent.toFixed(2)}%
                </span>
                <span className="text-sm text-muted-foreground">
                  Meta: {indicator.target}
                </span>
              </div>
              <Progress
                value={progressValue}
                className="h-2"
              />
              <p className="text-xs text-muted-foreground mt-2">
                {indicator.description}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Periodicidade: {indicator.periodicity}
              </p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

interface SLACompactCardProps {
  title: string;
  current: number;
  target: string;
  status: "compliant" | "warning" | "non_compliant";
  unit?: string;
}

export function SLACompactCard({ title, current, target, status, unit = "%" }: SLACompactCardProps) {
  const config = statusConfig[status] || statusConfig.warning;
  const Icon = config.icon;
  const safeCurrent = current ?? 0;

  return (
    <div className="flex items-center justify-between p-3 rounded-md bg-muted/50">
      <div className="flex items-center gap-2">
        <Icon className={`w-4 h-4 ${status === "compliant" ? "text-green-500" : status === "warning" ? "text-amber-500" : "text-red-500"}`} />
        <span className="text-sm font-medium">{title}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm font-mono font-medium">
          {safeCurrent.toFixed(2)}{unit}
        </span>
        <span className="text-xs text-muted-foreground">/ {target}</span>
      </div>
    </div>
  );
}

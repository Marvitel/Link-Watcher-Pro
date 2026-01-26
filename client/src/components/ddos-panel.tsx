import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { format, isValid, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";

import { Shield, ShieldAlert, ShieldCheck, ShieldOff, Activity } from "lucide-react";
import type { DDoSEvent } from "@shared/schema";

function safeFormatDate(dateValue: string | Date | null | undefined, formatStr: string = "dd/MM/yyyy HH:mm"): string {
  if (!dateValue) return "-";
  try {
    const date = dateValue instanceof Date ? dateValue : parseISO(dateValue);
    if (!isValid(date)) return "-";
    return format(date, formatStr, { locale: ptBR });
  } catch {
    return "-";
  }
}

interface DDoSPanelProps {
  events: DDoSEvent[];
  compact?: boolean;
}

const statusConfig: Record<string, {
  icon: typeof ShieldAlert;
  className: string;
  label: string;
}> = {
  detected: {
    icon: ShieldAlert,
    className: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
    label: "Detectado",
  },
  mitigating: {
    icon: Shield,
    className: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
    label: "Mitigando",
  },
  mitigated: {
    icon: ShieldCheck,
    className: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
    label: "Mitigado",
  },
  resolved: {
    icon: ShieldCheck,
    className: "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20",
    label: "Resolvido",
  },
};

export function DDoSPanel({ events, compact = false }: DDoSPanelProps) {
  const activeEvents = events.filter((e) => e.mitigationStatus !== "resolved");
  const resolvedEvents = events.filter((e) => e.mitigationStatus === "resolved");

  if (events.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <ShieldCheck className="w-12 h-12 text-green-500 mb-3" />
          <p className="text-lg font-medium">Nenhum ataque detectado</p>
          <p className="text-sm text-muted-foreground">
            O sistema está operando normalmente
          </p>
        </CardContent>
      </Card>
    );
  }

  if (compact) {
    return (
      <div className="space-y-2">
        {events.slice(0, 5).map((event) => {
          const config = statusConfig[event.mitigationStatus];
          const Icon = config.icon;
          return (
            <div
              key={event.id}
              className="flex items-center justify-between p-3 rounded-md bg-muted/50"
              data-testid={`ddos-event-${event.id}`}
            >
              <div className="flex items-center gap-2">
                <Icon className="w-4 h-4" />
                <span className="text-sm font-medium">{event.attackType}</span>
              </div>
              <Badge variant="outline" className={config.className}>
                {config.label}
              </Badge>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {activeEvents.length > 0 && (
        <Card className="border-red-500/30">
          <CardHeader className="flex flex-row items-center gap-2 space-y-0">
            <ShieldAlert className="w-5 h-5 text-red-500" />
            <CardTitle className="text-lg">Ataques Ativos</CardTitle>
            <Badge variant="destructive" className="ml-auto">
              {activeEvents.length} ativo(s)
            </Badge>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Início</TableHead>
                  <TableHead>Pico</TableHead>
                  <TableHead>IPs Origem</TableHead>
                  <TableHead>Pacotes Bloqueados</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeEvents.map((event) => {
                  const config = statusConfig[event.mitigationStatus] || statusConfig.detected;
                  const Icon = config.icon;
                  const safePeakBandwidth = event.peakBandwidth ?? 0;
                  return (
                    <TableRow key={event.id}>
                      <TableCell className="font-medium">{event.attackType}</TableCell>
                      <TableCell className="font-mono text-sm">
                        {safeFormatDate(event.startTime, "dd/MM HH:mm")}
                      </TableCell>
                      <TableCell className="font-mono">
                        {safePeakBandwidth.toFixed(1)} Mbps
                      </TableCell>
                      <TableCell className="font-mono">
                        {event.sourceIps.toLocaleString()}
                      </TableCell>
                      <TableCell className="font-mono">
                        {event.blockedPackets.toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={config.className}>
                          <Icon className="w-3 h-3 mr-1" />
                          {config.label}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center gap-2 space-y-0">
          <Activity className="w-5 h-5 text-muted-foreground" />
          <CardTitle className="text-lg">Histórico de Ataques</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tipo</TableHead>
                <TableHead>Início</TableHead>
                <TableHead>Fim</TableHead>
                <TableHead>Duração</TableHead>
                <TableHead>Pico</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {resolvedEvents.map((event) => {
                const config = statusConfig[event.mitigationStatus] || statusConfig.resolved;
                const Icon = config.icon;
                const start = new Date(event.startTime);
                const end = event.endTime ? new Date(event.endTime) : new Date();
                const durationMs = end.getTime() - start.getTime();
                const durationMin = Math.round(durationMs / 60000);
                const safePeakBandwidth = event.peakBandwidth ?? 0;
                
                return (
                  <TableRow key={event.id}>
                    <TableCell className="font-medium">{event.attackType}</TableCell>
                    <TableCell className="font-mono text-sm">
                      {format(start, "dd/MM HH:mm", { locale: ptBR })}
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {event.endTime ? format(end, "dd/MM HH:mm", { locale: ptBR }) : "-"}
                    </TableCell>
                    <TableCell className="font-mono">
                      {durationMin} min
                    </TableCell>
                    <TableCell className="font-mono">
                      {safePeakBandwidth.toFixed(1)} Mbps
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={config.className}>
                        <Icon className="w-3 h-3 mr-1" />
                        {config.label}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { AlertCircle, AlertTriangle, Info, Wrench, Check, Clock } from "lucide-react";
import type { Event } from "@shared/schema";

interface EventsTableProps {
  events: Event[];
  compact?: boolean;
}

const typeConfig = {
  info: {
    icon: Info,
    className: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
    label: "Info",
  },
  warning: {
    icon: AlertTriangle,
    className: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
    label: "Aviso",
  },
  critical: {
    icon: AlertCircle,
    className: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
    label: "Crítico",
  },
  maintenance: {
    icon: Wrench,
    className: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
    label: "Manutenção",
  },
};

export function EventsTable({ events, compact = false }: EventsTableProps) {
  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <Info className="w-10 h-10 mb-2 opacity-50" />
        <p className="text-sm">Nenhum evento registrado</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[100px]">Tipo</TableHead>
            <TableHead>Evento</TableHead>
            {!compact && <TableHead>Local</TableHead>}
            <TableHead className="w-[150px]">Data/Hora</TableHead>
            <TableHead className="w-[100px]">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {events.map((event) => {
            const config = typeConfig[event.type];
            const Icon = config.icon;
            return (
              <TableRow key={event.id} data-testid={`row-event-${event.id}`}>
                <TableCell>
                  <Badge variant="outline" className={config.className}>
                    <Icon className="w-3 h-3 mr-1" />
                    {config.label}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex flex-col">
                    <span className="font-medium">{event.title}</span>
                    {!compact && (
                      <span className="text-xs text-muted-foreground">{event.description}</span>
                    )}
                  </div>
                </TableCell>
                {!compact && (
                  <TableCell className="text-sm text-muted-foreground">
                    {event.linkId === "sede" ? "Sede Administrativa" : "Central de Atendimento"}
                  </TableCell>
                )}
                <TableCell className="text-sm text-muted-foreground font-mono">
                  {format(new Date(event.timestamp), "dd/MM/yy HH:mm", { locale: ptBR })}
                </TableCell>
                <TableCell>
                  {event.resolved ? (
                    <Badge variant="outline" className="bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20">
                      <Check className="w-3 h-3 mr-1" />
                      Resolvido
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20">
                      <Clock className="w-3 h-3 mr-1" />
                      Ativo
                    </Badge>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

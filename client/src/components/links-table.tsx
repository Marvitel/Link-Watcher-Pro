import { Link as RouterLink } from "wouter";
import { StatusDot } from "./status-badge";
import { Sparkline } from "./sparkline";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Download, ExternalLink, FileSpreadsheet, Copy, ChevronLeft, ChevronRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Link, Metric } from "@shared/schema";
import { formatBandwidth } from "@/lib/export-utils";
import { useMemo, useState } from "react";

interface LinksTableProps {
  links: Link[];
  metricsMap?: Record<number, Metric[]>;
  pageSize?: number;
  showPagination?: boolean;
  onExportCsv?: () => void;
}

export function LinksTable({
  links,
  metricsMap = {},
  pageSize = 10,
  showPagination = true,
  onExportCsv,
}: LinksTableProps) {
  const { toast } = useToast();
  const [currentPage, setCurrentPage] = useState(1);

  const sortedLinks = useMemo(() => {
    if (!Array.isArray(links)) return [];
    return [...links].sort((a, b) => {
      const statusOrder = { down: 0, degraded: 1, operational: 2, unknown: 3 };
      const aOrder = statusOrder[a.status as keyof typeof statusOrder] ?? 3;
      const bOrder = statusOrder[b.status as keyof typeof statusOrder] ?? 3;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.name.localeCompare(b.name);
    });
  }, [links]);

  const totalPages = Math.ceil(sortedLinks.length / pageSize);
  const paginatedLinks = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sortedLinks.slice(start, start + pageSize);
  }, [sortedLinks, currentPage, pageSize]);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "Copiado!",
      description: "IP copiado para a área de transferência.",
    });
  };

  const getSparklineData = (linkId: number) => {
    const metrics = metricsMap[linkId];
    if (!Array.isArray(metrics) || metrics.length < 2) return [];
    return metrics
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      .slice(-12)
      .map((m) => m.packetLoss ?? 0);
  };

  return (
    <div className="space-y-2">
      <ScrollArea className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="w-12">Status</TableHead>
              <TableHead>Dispositivo</TableHead>
              <TableHead className="w-32">IP</TableHead>
              <TableHead className="w-24 text-right">Perda (%)</TableHead>
              <TableHead className="w-24 text-right">Latência</TableHead>
              <TableHead className="w-24 text-center">Tendência</TableHead>
              <TableHead className="w-12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedLinks.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                  Nenhum link encontrado
                </TableCell>
              </TableRow>
            ) : (
              paginatedLinks.map((link) => {
                const sparklineData = getSparklineData(link.id);
                const packetLoss = link.packetLoss ?? 0;
                const latency = link.latency ?? 0;
                const lossColor = packetLoss > 2 ? "text-red-500" : packetLoss > 0.5 ? "text-yellow-500" : "text-green-500";
                const latencyColor = latency > 80 ? "text-red-500" : latency > 50 ? "text-yellow-500" : "text-green-500";

                return (
                  <TableRow key={link.id} className="hover-elevate" data-testid={`row-link-${link.id}`}>
                    <TableCell>
                      <StatusDot status={link.status} size="md" />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium">{link.name}</span>
                        {link.location && (
                          <span className="text-xs text-muted-foreground">{link.location}</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <span className="font-mono text-sm">{link.ipBlock}</span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => copyToClipboard(link.ipBlock)}
                          data-testid={`button-copy-ip-${link.id}`}
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className={`font-mono font-medium ${lossColor}`}>
                        {packetLoss.toFixed(2)}%
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className={`font-mono font-medium ${latencyColor}`}>
                        {latency.toFixed(0)}ms
                      </span>
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex justify-center">
                        <Sparkline
                          data={sparklineData}
                          width={60}
                          height={20}
                          color={packetLoss > 2 ? "#ef4444" : packetLoss > 0.5 ? "#eab308" : "#22c55e"}
                        />
                      </div>
                    </TableCell>
                    <TableCell>
                      <RouterLink href={`/link/${link.id}`}>
                        <Button variant="ghost" size="icon" className="h-8 w-8" data-testid={`button-details-${link.id}`}>
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                      </RouterLink>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </ScrollArea>

      <div className="flex items-center justify-between gap-4 flex-wrap">
        {onExportCsv && (
          <Button variant="outline" size="sm" onClick={onExportCsv} data-testid="button-export-csv">
            <FileSpreadsheet className="h-4 w-4 mr-2" />
            Exportar para Planilha
          </Button>
        )}

        {showPagination && totalPages > 1 && (
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-sm text-muted-foreground">
              Página {currentPage} de {totalPages} ({sortedLinks.length} links)
            </span>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              disabled={currentPage === 1}
              onClick={() => setCurrentPage((p) => p - 1)}
              data-testid="button-prev-page"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage((p) => p + 1)}
              data-testid="button-next-page"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { EventsTable } from "@/components/events-table";
import { useClientContext } from "@/lib/client-context";
import { Activity, Search, Filter, RefreshCw, ChevronLeft, ChevronRight } from "lucide-react";
import type { Event } from "@shared/schema";

interface EventsResponse {
  events: (Event & { linkName?: string | null })[];
  total: number;
  counts: {
    total: number;
    active: number;
    critical: number;
    warning: number;
  };
}

export default function Events() {
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const { selectedClientId } = useClientContext();

  useEffect(() => {
    setPage(1);
  }, [selectedClientId, typeFilter, statusFilter]);

  const eventsUrl = selectedClientId 
    ? `/api/events?clientId=${selectedClientId}&page=${page}&pageSize=${pageSize}` 
    : `/api/events?page=${page}&pageSize=${pageSize}`;
  
  const { data, isLoading, refetch } = useQuery<EventsResponse>({
    queryKey: ["/api/events", selectedClientId, page, pageSize],
    queryFn: async () => {
      const res = await fetch(eventsUrl, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch events");
      return res.json();
    },
    refetchInterval: 30000,
  });

  const events = data?.events || [];
  const total = data?.total || 0;
  const counts = data?.counts || { total: 0, active: 0, critical: 0, warning: 0 };

  const filteredEvents = events.filter((event) => {
    const title = event.title || "";
    const description = event.description || "";
    const matchesSearch =
      title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = typeFilter === "all" || event.type === typeFilter;
    const matchesStatus =
      statusFilter === "all" ||
      (statusFilter === "resolved" && event.resolved) ||
      (statusFilter === "active" && !event.resolved);
    return matchesSearch && matchesType && matchesStatus;
  });

  const totalPages = Math.ceil(total / pageSize);
  const startItem = (page - 1) * pageSize + 1;
  const endItem = Math.min(page * pageSize, total);

  const handlePageSizeChange = (newSize: string) => {
    setPageSize(parseInt(newSize, 10));
    setPage(1);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Eventos</h1>
          <p className="text-muted-foreground">
            Histórico de eventos e alertas do sistema
          </p>
        </div>
        <Button 
          variant="outline" 
          size="sm" 
          data-testid="button-refresh"
          onClick={() => refetch()}
        >
          <RefreshCw className="w-4 h-4 mr-2" />
          Atualizar
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center">
                <Activity className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-semibold font-mono" data-testid="text-total-events">
                  {counts.total.toLocaleString("pt-BR")}
                </p>
                <p className="text-xs text-muted-foreground">Total</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-md bg-amber-500/10 flex items-center justify-center">
                <Activity className="w-4 h-4 text-amber-500" />
              </div>
              <div>
                <p className="text-2xl font-semibold font-mono" data-testid="text-active-events">
                  {counts.active.toLocaleString("pt-BR")}
                </p>
                <p className="text-xs text-muted-foreground">Ativos</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-md bg-red-500/10 flex items-center justify-center">
                <Activity className="w-4 h-4 text-red-500" />
              </div>
              <div>
                <p className="text-2xl font-semibold font-mono" data-testid="text-critical-events">
                  {counts.critical.toLocaleString("pt-BR")}
                </p>
                <p className="text-xs text-muted-foreground">Críticos</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-md bg-amber-500/10 flex items-center justify-center">
                <Activity className="w-4 h-4 text-amber-500" />
              </div>
              <div>
                <p className="text-2xl font-semibold font-mono" data-testid="text-warning-events">
                  {counts.warning.toLocaleString("pt-BR")}
                </p>
                <p className="text-xs text-muted-foreground">Avisos</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-4">
          <CardTitle className="text-lg">Lista de Eventos</CardTitle>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground" data-testid="text-pagination-info">
                {total > 0 ? `${startItem.toLocaleString("pt-BR")}-${endItem.toLocaleString("pt-BR")} de ${total.toLocaleString("pt-BR")}` : "0 eventos"}
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Buscar eventos..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
                data-testid="input-search-events"
              />
            </div>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-full md:w-40" data-testid="select-type-filter">
                <SelectValue placeholder="Tipo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os tipos</SelectItem>
                <SelectItem value="info">Informação</SelectItem>
                <SelectItem value="warning">Aviso</SelectItem>
                <SelectItem value="critical">Crítico</SelectItem>
                <SelectItem value="maintenance">Manutenção</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full md:w-40" data-testid="select-status-filter">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="active">Ativos</SelectItem>
                <SelectItem value="resolved">Resolvidos</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : (
            <EventsTable events={filteredEvents || []} />
          )}

          <div className="flex items-center justify-between pt-4 border-t">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Itens por página:</span>
              <Select value={pageSize.toString()} onValueChange={handlePageSizeChange}>
                <SelectTrigger className="w-20" data-testid="select-page-size">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                  <SelectItem value="200">200</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground" data-testid="text-page-info">
                Página {page} de {totalPages || 1}
              </span>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                data-testid="button-prev-page"
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                data-testid="button-next-page"
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

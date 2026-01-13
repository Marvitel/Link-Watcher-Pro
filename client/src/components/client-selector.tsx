import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { useClientContext } from "@/lib/client-context";
import { Building2, Eye, Search, Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Client } from "@shared/schema";
import { cn } from "@/lib/utils";

export function ClientSelector() {
  const { isSuperAdmin } = useAuth();
  const { selectedClientId, selectedClientName, setSelectedClient, clearSelectedClient, isViewingAsClient } = useClientContext();
  const [open, setOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  const { data: clients, isLoading } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
    enabled: isSuperAdmin,
  });

  if (!isSuperAdmin) return null;

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Building2 className="w-4 h-4" />
        <span>Carregando...</span>
      </div>
    );
  }

  if (isViewingAsClient) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 px-3 py-1.5 bg-primary/10 text-primary rounded-md text-sm">
          <Eye className="w-4 h-4" />
          <span>Visualizando: {selectedClientName}</span>
        </div>
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={clearSelectedClient}
          data-testid="button-clear-client-view"
        >
          Voltar
        </Button>
      </div>
    );
  }

  // Filtrar clientes pela busca
  const filteredClients = clients?.filter(client => {
    if (!searchTerm.trim()) return true;
    const search = searchTerm.toLowerCase();
    return (
      client.name?.toLowerCase().includes(search) ||
      client.slug?.toLowerCase().includes(search) ||
      client.cnpj?.toLowerCase().includes(search)
    );
  });

  return (
    <div className="flex items-center gap-2">
      <Building2 className="w-4 h-4 text-muted-foreground" />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-56 justify-between"
            data-testid="select-client-view"
          >
            <span className="truncate">
              {selectedClientId 
                ? clients?.find(c => c.id === selectedClientId)?.name || "Cliente selecionado"
                : "Todos os clientes"
              }
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-0" align="start">
          <div className="p-2 border-b">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar cliente..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8 h-9"
                data-testid="input-search-client-selector"
              />
            </div>
          </div>
          <ScrollArea className="max-h-64">
            <div className="p-1">
              <Button
                variant="ghost"
                className={cn(
                  "w-full justify-start text-left h-9 px-2",
                  !selectedClientId && "bg-accent"
                )}
                onClick={() => {
                  clearSelectedClient();
                  setOpen(false);
                  setSearchTerm("");
                }}
                data-testid="select-client-all"
              >
                <Check className={cn("mr-2 h-4 w-4", !selectedClientId ? "opacity-100" : "opacity-0")} />
                Todos os clientes
              </Button>
              {filteredClients?.map((client) => (
                <Button
                  key={client.id}
                  variant="ghost"
                  className={cn(
                    "w-full justify-start text-left h-9 px-2",
                    selectedClientId === client.id && "bg-accent"
                  )}
                  onClick={() => {
                    setSelectedClient(client.id, client.name);
                    setOpen(false);
                    setSearchTerm("");
                  }}
                  data-testid={`select-client-${client.id}`}
                >
                  <Check className={cn("mr-2 h-4 w-4", selectedClientId === client.id ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">{client.name}</span>
                </Button>
              ))}
              {filteredClients?.length === 0 && (
                <div className="py-4 text-center text-sm text-muted-foreground">
                  Nenhum cliente encontrado
                </div>
              )}
            </div>
          </ScrollArea>
        </PopoverContent>
      </Popover>
    </div>
  );
}

import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { useClientContext } from "@/lib/client-context";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Building2, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Client } from "@shared/schema";

export function ClientSelector() {
  const { isSuperAdmin } = useAuth();
  const { selectedClientId, selectedClientName, setSelectedClient, clearSelectedClient, isViewingAsClient } = useClientContext();

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

  return (
    <div className="flex items-center gap-2">
      <Building2 className="w-4 h-4 text-muted-foreground" />
      <Select
        value={selectedClientId?.toString() || "all"}
        onValueChange={(value) => {
          if (value === "all") {
            clearSelectedClient();
          } else {
            const client = clients?.find(c => c.id === parseInt(value, 10));
            setSelectedClient(parseInt(value, 10), client?.name || null);
          }
        }}
      >
        <SelectTrigger className="w-48" data-testid="select-client-view">
          <SelectValue placeholder="Todos os clientes" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todos os clientes</SelectItem>
          {clients?.map((client) => (
            <SelectItem key={client.id} value={client.id.toString()}>
              {client.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

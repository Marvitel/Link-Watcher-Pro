import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import type { CpePortStatus as CpePortStatusType } from "@shared/schema";

interface CpePortStatusProps {
  cpeId: number;
  linkCpeId?: number;
  cpeName?: string;
  compact?: boolean;
  linkOffline?: boolean;
}

function formatSpeed(speed: number | null): string {
  if (!speed || speed === 0) return "—";
  if (speed >= 10000000000) return `${(speed / 1000000000).toFixed(0)}G`;
  if (speed >= 1000000000) return `${(speed / 1000000000).toFixed(0)}G`;
  if (speed >= 100000000) return `${(speed / 1000000).toFixed(0)}M`;
  if (speed >= 1000000) return `${(speed / 1000000).toFixed(0)}M`;
  if (speed >= 1000) return `${(speed / 1000).toFixed(0)}K`;
  return `${speed}`;
}

function getPortColor(port: CpePortStatusType): { bg: string; border: string; text: string; label: string } {
  if (port.operStatus !== "up") {
    return { 
      bg: "bg-gray-400 dark:bg-gray-600", 
      border: "border-gray-500 dark:border-gray-500",
      text: "text-gray-600 dark:text-gray-400",
      label: "Offline"
    };
  }
  
  const speed = port.speed || 0;
  
  if (speed >= 10000000000) {
    return { 
      bg: "bg-blue-500 dark:bg-blue-600", 
      border: "border-blue-600 dark:border-blue-500",
      text: "text-blue-600 dark:text-blue-400",
      label: "10G"
    };
  }
  
  if (speed >= 1000000000) {
    return { 
      bg: "bg-green-500 dark:bg-green-600", 
      border: "border-green-600 dark:border-green-500",
      text: "text-green-600 dark:text-green-400",
      label: "1G"
    };
  }
  
  if (speed >= 100000000) {
    return { 
      bg: "bg-orange-500 dark:bg-orange-600", 
      border: "border-orange-600 dark:border-orange-500",
      text: "text-orange-600 dark:text-orange-400",
      label: "100M"
    };
  }
  
  if (speed > 0) {
    return { 
      bg: "bg-yellow-500 dark:bg-yellow-600", 
      border: "border-yellow-600 dark:border-yellow-500",
      text: "text-yellow-600 dark:text-yellow-400",
      label: formatSpeed(speed)
    };
  }
  
  return { 
    bg: "bg-green-500 dark:bg-green-600", 
    border: "border-green-600 dark:border-green-500",
    text: "text-green-600 dark:text-green-400",
    label: "Up"
  };
}

function PortIcon({ port, compact }: { port: CpePortStatusType; compact?: boolean }) {
  const colors = getPortColor(port);
  const isUp = port.operStatus === "up";
  const size = compact ? "w-6 h-6" : "w-8 h-8";
  
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div 
          className={cn(
            "relative flex items-center justify-center rounded-sm border-2 cursor-default transition-all",
            size,
            colors.border,
            isUp ? colors.bg : "bg-gray-200 dark:bg-gray-700"
          )}
          data-testid={`port-status-${port.portIndex}`}
        >
          <div className={cn(
            "absolute inset-1 rounded-sm",
            isUp ? "bg-white/20" : "bg-gray-300 dark:bg-gray-600"
          )}>
            <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1.5 h-2 bg-current opacity-40 rounded-t-sm" />
            <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-0.5 h-1 bg-current opacity-60" />
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        <div className="font-medium">{port.portName}</div>
        <div className="text-muted-foreground">
          Status: <span className={colors.text}>{isUp ? "Online" : "Offline"}</span>
        </div>
        {port.speed && port.speed > 0 && (
          <div className="text-muted-foreground">
            Velocidade: {formatSpeed(port.speed)}
          </div>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

// Exibe nome do CPE + modelo coletado via SNMP (sysDescr truncado)
function CpeNameModel({ cpeName, cpeModel }: { cpeName?: string; cpeModel: string | null }) {
  if (!cpeName && !cpeModel) return null;

  // sysDescr pode ser muito longo: pegar apenas a primeira linha ou até 80 chars
  const shortModel = cpeModel
    ? cpeModel.split(/[\r\n]/)[0].substring(0, 80).trim()
    : null;

  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      {cpeName && (
        <span className="text-sm font-medium text-foreground leading-tight">{cpeName}</span>
      )}
      {shortModel && (
        <span className="text-xs text-muted-foreground leading-tight truncate" title={cpeModel ?? undefined}>
          {shortModel}
        </span>
      )}
    </div>
  );
}

export function CpePortStatusDisplay({ cpeId, linkCpeId, cpeName, compact, linkOffline }: CpePortStatusProps) {
  const queryClient = useQueryClient();
  const [hasAutoRefreshed, setHasAutoRefreshed] = useState(false);
  const queryKey = linkCpeId 
    ? ["/api/cpe", cpeId, "ports", { linkCpeId }]
    : ["/api/cpe", cpeId, "ports"];
  
  // Link offline → apenas carrega dados salvos do banco, sem polling automático
  // (CPE inacessível junto com o link — SNMP causaria timeouts desnecessários)
  const { data: portData, isLoading, isFetched } = useQuery<{ ports: CpePortStatusType[]; model: string | null }>({
    queryKey,
    queryFn: async () => {
      const url = linkCpeId 
        ? `/api/cpe/${cpeId}/ports?linkCpeId=${linkCpeId}`
        : `/api/cpe/${cpeId}/ports`;
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch ports");
      return response.json();
    },
    refetchInterval: linkOffline ? false : 60000,
    staleTime: linkOffline ? Infinity : 0,
  });

  const ports = portData?.ports ?? [];
  const cpeModel = portData?.model || null;
  
  const refreshMutation = useMutation({
    mutationFn: async () => {
      const url = linkCpeId 
        ? `/api/cpe/${cpeId}/ports/refresh?linkCpeId=${linkCpeId}`
        : `/api/cpe/${cpeId}/ports/refresh`;
      return apiRequest("POST", url);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });
  
  // Coleta automática quando não há dados salvos e link está online
  useEffect(() => {
    if (!linkOffline && isFetched && ports.length === 0 && !hasAutoRefreshed && !refreshMutation.isPending) {
      setHasAutoRefreshed(true);
      refreshMutation.mutate();
    }
  }, [isFetched, ports.length, hasAutoRefreshed, refreshMutation, linkOffline]);
  
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-sm">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span>Carregando portas...</span>
      </div>
    );
  }

  // Estado offline: forçar todas as portas como down, sem aviso
  if (linkOffline) {
    const totalPorts = ports.length;
    const portsOffline = ports.map(p => ({ ...p, operStatus: "down" as const }));
    return (
      <div className="space-y-2">
        <CpeNameModel cpeName={cpeName} cpeModel={cpeModel} />
        {totalPorts > 0 ? (
          <>
            <div className="flex flex-wrap gap-1">
              {portsOffline.map((port) => (
                <div key={port.id} className="flex flex-col items-center gap-0.5">
                  <PortIcon port={port} compact={compact} />
                  <span className="text-[10px] text-muted-foreground truncate max-w-8">
                    {port.portName?.replace(/^(Ethernet|GigabitEthernet|eth)/i, "").substring(0, 4) || port.portIndex}
                  </span>
                </div>
              ))}
            </div>
            <div className="text-xs text-muted-foreground">0/{totalPorts} portas ativas</div>
          </>
        ) : (
          <div className="text-sm text-muted-foreground">Nenhuma porta registrada.</div>
        )}
      </div>
    );
  }
  
  const upPorts = ports.filter(p => p.operStatus === "up").length;
  const totalPorts = ports.length;
  
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <CpeNameModel cpeName={cpeName} cpeModel={cpeModel} />
        <Button
          size="sm"
          variant="ghost"
          onClick={() => refreshMutation.mutate()}
          disabled={refreshMutation.isPending}
          data-testid="button-refresh-ports"
        >
          <RefreshCw className={cn("w-3.5 h-3.5", refreshMutation.isPending && "animate-spin")} />
        </Button>
      </div>
      
      {ports.length === 0 ? (
        <div className="text-sm text-muted-foreground">
          Nenhuma porta detectada. Clique em atualizar para coletar via SNMP.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-1">
            {ports.map((port) => (
              <div key={port.id} className="flex flex-col items-center gap-0.5">
                <PortIcon port={port} compact={compact} />
                <span className="text-[10px] text-muted-foreground truncate max-w-8">
                  {port.portName?.replace(/^(Ethernet|GigabitEthernet|eth)/i, "").substring(0, 4) || port.portIndex}
                </span>
              </div>
            ))}
          </div>
          
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span>{upPorts}/{totalPorts} portas ativas</span>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded-sm bg-gray-400" />
                <span>Off</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded-sm bg-orange-500" />
                <span>100M</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded-sm bg-green-500" />
                <span>1G</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded-sm bg-blue-500" />
                <span>10G</span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default CpePortStatusDisplay;

import { useQuery } from "@tanstack/react-query";
import { Wifi, WifiOff, AlertTriangle, RefreshCw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useQueryClient } from "@tanstack/react-query";

export interface PppoeSessionData {
  available: boolean;
  active?: boolean;
  reason?: string;
  message?: string;
  username?: string;
  framedIpAddress?: string | null;
  callingStationId?: string | null;
  nasIpAddress?: string;
  nasPortId?: string | null;
  acctStartTime?: string | null;
  acctUpdateTime?: string | null;
  sessionDurationSec?: number | null;
  lastUpdateAgoSec?: number | null;
  inputOctets?: number | null;
  outputOctets?: number | null;
}

function formatDuration(sec: number | null | undefined): string {
  if (sec == null || sec < 0) return "—";
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${sec}s`;
}

export function usePppoeSession(linkId: number, enabled: boolean = true) {
  return useQuery<PppoeSessionData>({
    queryKey: ["/api/links", linkId, "pppoe-session"],
    enabled: enabled && !isNaN(linkId),
    refetchInterval: 30000,
  });
}

export function PppoeSessionBadge({ session }: { session: PppoeSessionData | undefined }) {
  // Só mostra badge quando há sessão PPPoE ATIVA — evita ruído em links dedicados
  // (sem PPPoE) e o estado "desconectado" já é coberto pelo card de falha vermelho.
  if (!session || !session.available || !session.active) return null;

  return (
    <Badge
      variant="outline"
      className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 gap-1.5"
      data-testid="badge-pppoe-connected"
    >
      <Wifi className="w-3 h-3" />
      PPPoE Conectado
      {session.framedIpAddress && (
        <span className="font-mono text-[10px] opacity-80">· {session.framedIpAddress}</span>
      )}
    </Badge>
  );
}

/**
 * Quando ping falha mas PPPoE está ativo (contradição):
 * mostra UM card compacto que combina o aviso + dados essenciais da sessão inline,
 * substituindo o card verde de sessão E o card vermelho de "Sem Resposta".
 */
export function PppoeSessionContradictionAlert({
  linkId,
  linkStatus,
  monitoredIp,
  session,
}: {
  linkId: number;
  linkStatus: string | undefined;
  monitoredIp: string | null | undefined;
  session: PppoeSessionData | undefined;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  if (!session || !session.active || !session.framedIpAddress) return null;
  if (linkStatus === "operational") return null;

  const isOffline = linkStatus === "down" || linkStatus === "offline" || linkStatus === "degraded";
  if (!isOffline) return null;

  const ipMismatch = monitoredIp && session.framedIpAddress && monitoredIp !== session.framedIpAddress;

  const handleSyncIp = async () => {
    try {
      await apiRequest("PATCH", `/api/links/${linkId}`, {
        monitoredIp: session.framedIpAddress,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/links", linkId] });
      queryClient.invalidateQueries({ queryKey: ["/api/links", linkId, "status-detail"] });
      toast({
        title: "IP atualizado",
        description: `Monitoramento agora aponta para ${session.framedIpAddress}`,
      });
    } catch (err: any) {
      toast({
        title: "Erro ao atualizar IP",
        description: err?.message || "Falha desconhecida",
        variant: "destructive",
      });
    }
  };

  return (
    <Card className="border-amber-500/50 bg-amber-500/5" data-testid="alert-pppoe-contradiction">
      <CardContent className="py-3 px-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h3 className="font-semibold text-amber-600 dark:text-amber-400 text-sm">
                PPPoE ativo, mas ping falhou — fibra intacta
              </h3>
              <span className="text-xs text-muted-foreground">
                <span className="font-mono">{session.username}</span> · online{" "}
                {formatDuration(session.sessionDurationSec)}
              </span>
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs">
              <InlineField label="IP sessão" value={session.framedIpAddress} mono testId="text-pppoe-ip" />
              {monitoredIp && (
                <InlineField
                  label="IP monitorado"
                  value={monitoredIp}
                  mono
                  highlight={!!ipMismatch}
                  testId="text-pppoe-monitored-ip"
                />
              )}
              <InlineField label="MAC" value={session.callingStationId} mono testId="text-pppoe-mac" />
              <InlineField label="Concentrador" value={session.nasIpAddress} mono testId="text-pppoe-nas" />
            </div>

            <p className="text-xs text-muted-foreground mt-2">
              {ipMismatch
                ? "IP de monitoramento diverge do IP atual da sessão. Sincronize abaixo."
                : "Possíveis causas: ICMP bloqueado no CPE, firewall do cliente, ou link com IP dinâmico sem useDynamicIp ativo."}
            </p>
          </div>
          {ipMismatch && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleSyncIp}
              data-testid="button-sync-pppoe-ip"
              className="flex-shrink-0"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Sincronizar IP
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Card compacto da sessão PPPoE — usado quando o link está operacional.
 * Quando há contradição (ping falha + PPPoE ativo), o ContradictionAlert assume.
 */
export function PppoeSessionCard({ session }: { session: PppoeSessionData | undefined }) {
  if (!session || !session.available) return null;

  if (!session.active) {
    return (
      <Card className="border-muted" data-testid="card-pppoe-session-inactive">
        <CardContent className="flex items-center gap-3 py-2.5 px-4">
          <WifiOff className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <span className="text-sm">
            <span className="font-semibold">PPPoE inativo</span>{" "}
            <span className="text-muted-foreground">
              · <span className="font-mono">{session.username}</span> sem sessão no concentrador
            </span>
          </span>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      className="border-emerald-500/40 bg-emerald-500/5"
      data-testid="card-pppoe-session-active"
    >
      <CardContent className="py-2.5 px-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <div className="flex items-center gap-2">
            <Wifi className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
            <span className="font-semibold text-sm text-emerald-700 dark:text-emerald-300">
              PPPoE Ativo
            </span>
            <span className="text-xs text-muted-foreground">
              <span className="font-mono">{session.username}</span> · online{" "}
              {formatDuration(session.sessionDurationSec)}
            </span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs ml-auto">
            <InlineField label="IP" value={session.framedIpAddress} mono testId="text-pppoe-ip" />
            <InlineField label="MAC" value={session.callingStationId} mono testId="text-pppoe-mac" />
            <InlineField label="Concentrador" value={session.nasIpAddress} mono testId="text-pppoe-nas" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function InlineField({
  label,
  value,
  mono,
  highlight,
  testId,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
  highlight?: boolean;
  testId?: string;
}) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="text-muted-foreground">{label}:</span>
      <span
        className={`${mono ? "font-mono" : ""} ${highlight ? "text-amber-600 dark:text-amber-400 font-semibold" : ""}`}
        data-testid={testId}
      >
        {value || "—"}
      </span>
    </span>
  );
}

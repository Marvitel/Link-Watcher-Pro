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

function formatBytes(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 2 : 1)} ${units[i]}`;
}

function formatDuration(sec: number | null | undefined): string {
  if (sec == null || sec < 0) return "—";
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatRelativeAgo(sec: number | null | undefined): string {
  if (sec == null) return "—";
  if (sec < 60) return `há ${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `há ${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `há ${h}h`;
  return `há ${Math.floor(h / 24)}d`;
}

export function usePppoeSession(linkId: number, enabled: boolean = true) {
  return useQuery<PppoeSessionData>({
    queryKey: ["/api/links", linkId, "pppoe-session"],
    enabled: enabled && !isNaN(linkId),
    refetchInterval: 30000,
  });
}

export function PppoeSessionBadge({ session }: { session: PppoeSessionData | undefined }) {
  if (!session || !session.available) return null;

  if (session.active) {
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

  return (
    <Badge
      variant="outline"
      className="bg-muted text-muted-foreground border-muted-foreground/30 gap-1.5"
      data-testid="badge-pppoe-disconnected"
    >
      <WifiOff className="w-3 h-3" />
      PPPoE Desconectado
    </Badge>
  );
}

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

  // Só mostra alerta se ping falha mas PPPoE ativo (contradição real)
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
      <CardContent className="flex items-start gap-4 py-4">
        <div className="flex-shrink-0 w-12 h-12 rounded-full bg-amber-500/10 flex items-center justify-center">
          <AlertTriangle className="w-6 h-6 text-amber-500" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-amber-600 dark:text-amber-400">
            Sessão PPPoE ativa, mas monitoramento por ping falhou
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            A sessão PPPoE de <span className="font-mono">{session.username}</span> está conectada
            no concentrador <span className="font-mono">{session.nasIpAddress}</span> com IP{" "}
            <span className="font-mono">{session.framedIpAddress}</span>. Isso indica que a fibra
            está intacta e o CPE alimentado.
          </p>
          {ipMismatch && (
            <p className="text-sm text-amber-600 dark:text-amber-400 mt-2">
              <strong>Possível causa:</strong> o IP monitorado{" "}
              <span className="font-mono">{monitoredIp}</span> diverge do IP atual da sessão{" "}
              <span className="font-mono">{session.framedIpAddress}</span>. Atualize o IP de
              monitoramento.
            </p>
          )}
          {!ipMismatch && (
            <p className="text-sm text-muted-foreground mt-2">
              Possíveis causas: ICMP bloqueado no CPE, firewall do cliente, ou link com IP dinâmico
              sem <code className="text-xs">useDynamicIp</code> ativo.
            </p>
          )}
        </div>
        {ipMismatch && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleSyncIp}
            data-testid="button-sync-pppoe-ip"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Sincronizar IP
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export function PppoeSessionCard({ session }: { session: PppoeSessionData | undefined }) {
  if (!session || !session.available) return null;

  if (!session.active) {
    return (
      <Card className="border-muted" data-testid="card-pppoe-session-inactive">
        <CardContent className="flex items-center gap-4 py-4">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-muted flex items-center justify-center">
            <WifiOff className="w-5 h-5 text-muted-foreground" />
          </div>
          <div>
            <h3 className="font-semibold text-sm">Sessão PPPoE Inativa</h3>
            <p className="text-xs text-muted-foreground">
              Usuário <span className="font-mono">{session.username}</span> não possui sessão ativa
              no RADIUS.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-emerald-500/40 bg-emerald-500/5" data-testid="card-pppoe-session-active">
      <CardContent className="py-4">
        <div className="flex items-start gap-3 mb-3">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-emerald-500/15 flex items-center justify-center">
            <Wifi className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-emerald-700 dark:text-emerald-300">
              Sessão PPPoE Ativa
            </h3>
            <p className="text-xs text-muted-foreground">
              {session.username} · online {formatDuration(session.sessionDurationSec)}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-2 text-sm">
          <SessionField label="IP atribuído" value={session.framedIpAddress} mono testId="text-pppoe-ip" />
          <SessionField label="MAC do CPE" value={session.callingStationId} mono testId="text-pppoe-mac" />
          <SessionField label="Concentrador" value={session.nasIpAddress} mono testId="text-pppoe-nas" />
          {session.nasPortId && (
            <SessionField label="Porta NAS" value={session.nasPortId} mono testId="text-pppoe-nasport" />
          )}
          <SessionField
            label="Início da sessão"
            value={
              session.acctStartTime
                ? new Date(session.acctStartTime).toLocaleString("pt-BR")
                : null
            }
            testId="text-pppoe-start"
          />
          <SessionField
            label="Última atualização"
            value={formatRelativeAgo(session.lastUpdateAgoSec)}
            testId="text-pppoe-update"
          />
          <SessionField
            label="Tráfego entrada"
            value={formatBytes(session.inputOctets)}
            testId="text-pppoe-input"
          />
          <SessionField
            label="Tráfego saída"
            value={formatBytes(session.outputOctets)}
            testId="text-pppoe-output"
          />
        </div>
      </CardContent>
    </Card>
  );
}

function SessionField({
  label,
  value,
  mono,
  testId,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
  testId?: string;
}) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={`text-sm ${mono ? "font-mono" : ""}`}
        data-testid={testId}
      >
        {value || "—"}
      </div>
    </div>
  );
}

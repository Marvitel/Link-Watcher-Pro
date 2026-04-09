import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Archive,
  Download,
  Loader2,
  RefreshCw,
  RotateCcw,
  Trash2,
  CalendarClock,
  User,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { CpeBackup } from "@shared/schema";

interface CpeBackupDialogProps {
  cpeId: number;
  linkCpeId?: number;
  cpeName: string;
  vendorSlug?: string;
  sshUser?: string;
  sshPassword?: string;
  disabled?: boolean;
}

function isDatacomVendor(vendorSlug?: string): boolean {
  return !!(vendorSlug && vendorSlug.toLowerCase().includes("datacom"));
}

function getFileExtension(backup: CpeBackup, vendorSlug?: string): string {
  const vendor = backup.vendor || vendorSlug || "";
  return vendor.toLowerCase().includes("datacom") ? "cfg" : "rsc";
}

function getFirmwareLabel(backup: CpeBackup, vendorSlug?: string): string | null {
  if (!backup.routerosVersion) return null;
  const vendor = backup.vendor || vendorSlug || "";
  if (vendor.toLowerCase().includes("datacom")) return `FW ${backup.routerosVersion}`;
  return `RouterOS ${backup.routerosVersion}`;
}

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function BackupRow({
  backup,
  vendorSlug,
  sshUser,
  sshPassword,
  onDelete,
  onRestore,
  restoring,
  deleting,
}: {
  backup: CpeBackup;
  vendorSlug?: string;
  sshUser?: string;
  sshPassword?: string;
  onDelete: (id: number) => void;
  onRestore: (id: number) => void;
  restoring: boolean;
  deleting: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const isDatacom = isDatacomVendor(backup.vendor || vendorSlug);
  const firmwareLabel = getFirmwareLabel(backup, vendorSlug);

  return (
    <div className="border rounded-lg p-3 space-y-2 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant={backup.source === "scheduled" ? "secondary" : "outline"} className="text-xs shrink-0">
              {backup.source === "scheduled" ? "Automático" : "Manual"}
            </Badge>
            {backup.vendor && (
              <Badge variant="outline" className="text-xs shrink-0 capitalize">
                {backup.vendor}
              </Badge>
            )}
            {firmwareLabel && (
              <span className="text-xs text-muted-foreground">{firmwareLabel}</span>
            )}
            {backup.deviceName && (
              <span className="text-xs text-muted-foreground font-mono">{backup.deviceName}</span>
            )}
            <span className="text-xs text-muted-foreground">{formatBytes(backup.size)}</span>
          </div>
          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <CalendarClock className="w-3 h-3" />
              {format(new Date(backup.createdAt), "dd/MM/yyyy HH:mm", { locale: ptBR })}
            </span>
            {backup.createdByUsername && (
              <span className="flex items-center gap-1">
                <User className="w-3 h-3" />
                {backup.createdByUsername}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={() => setExpanded(v => !v)}
                data-testid={`button-backup-expand-${backup.id}`}
              >
                {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{expanded ? "Ocultar conteúdo" : "Ver conteúdo"}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={() => {
                  window.open(`/api/cpe/backup/${backup.id}/download`, "_blank");
                }}
                data-testid={`button-backup-download-${backup.id}`}
              >
                <Download className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Baixar .{getFileExtension(backup, vendorSlug)}</TooltipContent>
          </Tooltip>
          {!isDatacom ? (
            <AlertDialog>
              <Tooltip>
                <TooltipTrigger asChild>
                  <AlertDialogTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      disabled={restoring}
                      data-testid={`button-backup-restore-${backup.id}`}
                    >
                      {restoring ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                    </Button>
                  </AlertDialogTrigger>
                </TooltipTrigger>
                <TooltipContent>Restaurar este backup</TooltipContent>
              </Tooltip>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Restaurar backup?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Esta ação vai importar a configuração salva em{" "}
                    <strong>{format(new Date(backup.createdAt), "dd/MM/yyyy HH:mm", { locale: ptBR })}</strong>{" "}
                    no dispositivo via SSH. O processo pode reiniciar serviços.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={() => onRestore(backup.id)}>
                    Confirmar Restauração
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 opacity-30 cursor-not-allowed"
                  disabled
                  data-testid={`button-backup-restore-${backup.id}`}
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Restauração não disponível para Datacom</TooltipContent>
            </Tooltip>
          )}
          <AlertDialog>
            <Tooltip>
              <TooltipTrigger asChild>
                <AlertDialogTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-destructive hover:text-destructive"
                    disabled={deleting}
                    data-testid={`button-backup-delete-${backup.id}`}
                  >
                    {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  </Button>
                </AlertDialogTrigger>
              </TooltipTrigger>
              <TooltipContent>Excluir backup</TooltipContent>
            </Tooltip>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Excluir backup?</AlertDialogTitle>
                <AlertDialogDescription>
                  O backup de {format(new Date(backup.createdAt), "dd/MM/yyyy HH:mm", { locale: ptBR })} será removido permanentemente.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={() => onDelete(backup.id)}
                >
                  Excluir
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
      {expanded && (
        <pre className="bg-muted rounded p-2 text-xs font-mono overflow-x-auto max-h-48 whitespace-pre-wrap break-all">
          {backup.content}
        </pre>
      )}
    </div>
  );
}

export function CpeBackupDialog({
  cpeId,
  linkCpeId,
  cpeName,
  vendorSlug,
  sshUser,
  sshPassword,
  disabled,
}: CpeBackupDialogProps) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [restoringId, setRestoringId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const isDatacom = isDatacomVendor(vendorSlug);

  const backupsQuery = useQuery<CpeBackup[]>({
    queryKey: ["/api/cpe", cpeId, "backups", linkCpeId],
    queryFn: async () => {
      const url = linkCpeId
        ? `/api/cpe/${cpeId}/backups?linkCpeId=${linkCpeId}`
        : `/api/cpe/${cpeId}/backups`;
      const res = await apiRequest("GET", url);
      return res.json();
    },
    enabled: open,
    staleTime: 10000,
  });

  const backupMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/cpe/${cpeId}/backup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ linkCpeId, sshUser, sshPassword, vendorSlug }),
      });

      if (res.status === 504) {
        return { timedOut: true };
      }

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `Erro ${res.status}` }));
        throw new Error(body.error || `Erro ${res.status}`);
      }

      return res.json();
    },
    onSuccess: (data: any) => {
      if (data?.timedOut) {
        toast({
          title: "Verificando backup...",
          description: "O processo demorou mais que o esperado. Atualizando lista para confirmar.",
        });
        setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: ["/api/cpe", cpeId, "backups", linkCpeId] });
        }, 3000);
      } else {
        toast({ title: "Backup realizado", description: `${formatBytes(data.size)} salvos com sucesso.` });
        queryClient.invalidateQueries({ queryKey: ["/api/cpe", cpeId, "backups", linkCpeId] });
      }
    },
    onError: (err: any) => {
      toast({ variant: "destructive", title: "Falha no backup", description: err.message });
    },
  });

  const restoreMutation = useMutation({
    mutationFn: async (backupId: number) => {
      const res = await apiRequest("POST", `/api/cpe/backup/${backupId}/restore`, {
        sshUser,
        sshPassword,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Restauração iniciada", description: "Configuração enviada ao dispositivo com sucesso." });
      setRestoringId(null);
    },
    onError: (err: any) => {
      toast({ variant: "destructive", title: "Falha na restauração", description: err.message });
      setRestoringId(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (backupId: number) => {
      const res = await apiRequest("DELETE", `/api/cpe/backup/${backupId}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cpe", cpeId, "backups", linkCpeId] });
      setDeletingId(null);
    },
    onError: (err: any) => {
      toast({ variant: "destructive", title: "Erro ao excluir", description: err.message });
      setDeletingId(null);
    },
  });

  const handleRestore = (id: number) => {
    setRestoringId(id);
    restoreMutation.mutate(id);
  };

  const handleDelete = (id: number) => {
    setDeletingId(id);
    deleteMutation.mutate(id);
  };

  const backups: CpeBackup[] = backupsQuery.data ?? [];

  const tooltipText = isDatacom
    ? "Backups de configuração Datacom (show running-config)"
    : "Backups de configuração RouterOS";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              disabled={disabled}
              data-testid={`button-backups-cpe-${cpeId}`}
            >
              <Archive className="w-3.5 h-3.5 mr-1" />
              Backups
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent>{tooltipText}</TooltipContent>
      </Tooltip>

      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Archive className="w-4 h-4" />
            Backups — {cpeName}
            {isDatacom && (
              <Badge variant="outline" className="text-xs">Datacom</Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {isDatacom
                ? "Backup via SSH (show running-config) • máx. 2 automáticos"
                : "Backup semanal automático • máximo 2 armazenados"}
            </p>
            <Button
              size="sm"
              onClick={() => backupMutation.mutate()}
              disabled={backupMutation.isPending || disabled}
              data-testid={`button-backup-now-${cpeId}`}
            >
              {backupMutation.isPending
                ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                : <RefreshCw className="w-3.5 h-3.5 mr-1" />}
              Fazer Backup Agora
            </Button>
          </div>

          {backupsQuery.isLoading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              Carregando backups...
            </div>
          ) : backups.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              Nenhum backup encontrado. Clique em "Fazer Backup Agora" para criar o primeiro.
            </div>
          ) : (
            <ScrollArea className="max-h-96">
              <div className="space-y-2 pr-2">
                {backups.map(backup => (
                  <BackupRow
                    key={backup.id}
                    backup={backup}
                    vendorSlug={vendorSlug}
                    sshUser={sshUser}
                    sshPassword={sshPassword}
                    onDelete={handleDelete}
                    onRestore={handleRestore}
                    restoring={restoringId === backup.id && restoreMutation.isPending}
                    deleting={deletingId === backup.id && deleteMutation.isPending}
                  />
                ))}
              </div>
            </ScrollArea>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

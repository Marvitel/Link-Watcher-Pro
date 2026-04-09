import { useEffect, useRef, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";

const VERSION_CHECK_INTERVAL = 60000; // Verificar a cada 1 minuto
const ROUTE_RESTORE_KEY = "link_monitor_restore_route";
const KIOSK_RELOAD_KEY = "link_monitor_kiosk_last_reload";
const KIOSK_RELOAD_INTERVAL = 6 * 60 * 60 * 1000; // 6 horas em ms
const RELOAD_COOLDOWN_KEY = "link_monitor_last_reload_time";
const RELOAD_COOLDOWN_MS = 10000; // Mínimo 10 segundos entre reloads

// Verifica se está em modo kiosk via URL param
export function isKioskMode(): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  return params.get("kiosk") === "true";
}

// Salva a rota atual para restauração após reload
function saveCurrentRoute() {
  const currentPath = window.location.pathname + window.location.search;
  localStorage.setItem(ROUTE_RESTORE_KEY, currentPath);
  console.log(`[Version] Rota salva para restauração: ${currentPath}`);
}

// Restaura a rota salva após reload (usado no App.tsx)
export function getRestoredRoute(): string | null {
  const savedRoute = localStorage.getItem(ROUTE_RESTORE_KEY);
  if (savedRoute) {
    localStorage.removeItem(ROUTE_RESTORE_KEY);
    console.log(`[Version] Restaurando rota: ${savedRoute}`);
  }
  return savedRoute;
}

interface VersionResponse {
  version: string;
  timestamp: number;
  message: string;
}

// Verifica se estamos em período de cooldown para evitar loops de reload
function isInReloadCooldown(): boolean {
  const lastReload = localStorage.getItem(RELOAD_COOLDOWN_KEY);
  if (!lastReload) return false;
  const elapsed = Date.now() - parseInt(lastReload, 10);
  return elapsed < RELOAD_COOLDOWN_MS;
}

// Reload limpo para kiosk
function performCleanReload(newVersion: string) {
  if (isInReloadCooldown()) {
    console.log(`[Version] Reload bloqueado - cooldown ativo`);
    return;
  }
  console.log(`[Version] Recarregando para versão ${newVersion} (kiosk)`);
  saveCurrentRoute();
  queryClient.clear();
  localStorage.setItem(RELOAD_COOLDOWN_KEY, Date.now().toString());
  if (isKioskMode()) {
    localStorage.setItem(KIOSK_RELOAD_KEY, Date.now().toString());
  }
  window.location.reload();
}

// Verifica se é hora de fazer reload periódico em modo kiosk
function shouldKioskReload(): boolean {
  if (!isKioskMode()) return false;
  const lastReload = localStorage.getItem(KIOSK_RELOAD_KEY);
  if (!lastReload) {
    localStorage.setItem(KIOSK_RELOAD_KEY, Date.now().toString());
    return false;
  }
  const elapsed = Date.now() - parseInt(lastReload, 10);
  return elapsed >= KIOSK_RELOAD_INTERVAL;
}

export function useVersionCheck(onNewVersion?: () => Promise<void>) {
  const { toast } = useToast();
  // Versão registrada na primeira verificação bem-sucedida desta sessão
  const initialVersionRef = useRef<string | null>(null);
  const hasActedRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const checkVersion = useCallback(async () => {
    // Em desenvolvimento, desabilitar para evitar loops
    if (import.meta.env.DEV) return;

    try {
      const kioskMode = isKioskMode();

      // Kiosk: verificar reload periódico (6h)
      if (kioskMode && shouldKioskReload()) {
        console.log(`[Kiosk] Reload periódico após ${KIOSK_RELOAD_INTERVAL / 3600000}h`);
        try {
          const r = await fetch("/api/version", { cache: "no-store" });
          const ver = r.ok ? (await r.json() as VersionResponse).version : Date.now().toString(36);
          performCleanReload(ver);
        } catch {
          performCleanReload(Date.now().toString(36));
        }
        return;
      }

      const response = await fetch("/api/version", {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache", "Pragma": "no-cache" },
      });

      if (!response.ok) return;

      const data: VersionResponse = await response.json();
      const serverVersion = data.version;

      console.log(`[Version] Servidor: ${serverVersion} | Inicial: ${initialVersionRef.current ?? "(ainda não registrado)"}`);

      // Primeira verificação desta sessão: apenas registrar a versão atual
      if (!initialVersionRef.current) {
        initialVersionRef.current = serverVersion;
        console.log(`[Version] Versão inicial registrada: ${serverVersion}`);
        return;
      }

      // Versão mudou desde que a sessão começou → novo deploy detectado
      if (serverVersion !== initialVersionRef.current && !hasActedRef.current) {
        hasActedRef.current = true;
        console.log(`[Version] Novo deploy detectado: ${initialVersionRef.current} → ${serverVersion}`);

        // Kiosk: reload silencioso
        if (kioskMode) {
          performCleanReload(serverVersion);
          return;
        }

        // Usuários normais: aviso + logout automático após 5 segundos
        toast({
          title: "Sistema atualizado",
          description: "Uma nova versão foi publicada. Você será desconectado em 5 segundos para garantir o funcionamento correto.",
          duration: 6000,
        });

        setTimeout(async () => {
          if (onNewVersion) {
            await onNewVersion();
          } else {
            // Fallback: reload se não tiver handler de logout
            performCleanReload(serverVersion);
          }
        }, 5000);
      }
    } catch (error) {
      console.debug("[Version] Erro ao verificar versão:", error);
    }
  }, [toast, onNewVersion]);

  useEffect(() => {
    // Verificar imediatamente ao montar
    checkVersion();

    // Verificar periodicamente
    intervalRef.current = setInterval(checkVersion, VERSION_CHECK_INTERVAL);

    // Verificar quando a aba volta ao foco
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        checkVersion();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [checkVersion]);
}

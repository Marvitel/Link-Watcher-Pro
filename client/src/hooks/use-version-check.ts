import { useEffect, useRef, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";

const VERSION_CHECK_INTERVAL = 60000; // Verificar a cada 1 minuto
const VERSION_STORAGE_KEY = "link_monitor_app_version";
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

// Função para limpar todo o cache e forçar reload limpo (somente kiosk)
function performCleanReload(newVersion: string) {
  if (isInReloadCooldown()) {
    console.log(`[Version] Reload bloqueado - cooldown ativo`);
    localStorage.setItem(VERSION_STORAGE_KEY, newVersion);
    return;
  }

  console.log(`[Version] Recarregando para versão ${newVersion} (kiosk)`);

  saveCurrentRoute();
  queryClient.clear();
  localStorage.setItem(VERSION_STORAGE_KEY, newVersion);
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
  const currentVersionRef = useRef<string | null>(null);
  const hasActedRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const checkVersion = useCallback(async () => {
    // Em desenvolvimento, desabilitar verificação de versão para evitar reloads
    if (import.meta.env.DEV) {
      return;
    }

    try {
      const kioskMode = isKioskMode();

      // Em modo kiosk, verificar se é hora do reload periódico (6h)
      if (kioskMode && shouldKioskReload()) {
        console.log(`[Kiosk] Reload periódico após ${KIOSK_RELOAD_INTERVAL / 3600000}h`);
        try {
          const response = await fetch("/api/version", { cache: "no-store" });
          if (response.ok) {
            const data: VersionResponse = await response.json();
            performCleanReload(data.version);
          } else {
            const fallbackVersion = currentVersionRef.current || Date.now().toString(36);
            performCleanReload(fallbackVersion);
          }
        } catch {
          const fallbackVersion = currentVersionRef.current || Date.now().toString(36);
          performCleanReload(fallbackVersion);
        }
        return;
      }

      const response = await fetch("/api/version", {
        cache: "no-store",
        headers: {
          "Cache-Control": "no-cache",
          "Pragma": "no-cache",
        },
      });

      if (!response.ok) return;

      const data: VersionResponse = await response.json();
      const serverVersion = data.version;

      // Primeira execução: salvar a versão atual
      if (!currentVersionRef.current) {
        const storedVersion = localStorage.getItem(VERSION_STORAGE_KEY);
        currentVersionRef.current = storedVersion || serverVersion;
        localStorage.setItem(VERSION_STORAGE_KEY, serverVersion);

        // Se a versão armazenada for diferente da do servidor na inicialização
        if (storedVersion && storedVersion !== serverVersion && !hasActedRef.current) {
          console.log(`[Version] Nova versão na inicialização: ${storedVersion} → ${serverVersion}`);
          hasActedRef.current = true;
          localStorage.setItem(VERSION_STORAGE_KEY, serverVersion);

          if (kioskMode) {
            performCleanReload(serverVersion);
          } else if (onNewVersion) {
            // Logout automático — novo deploy detectado
            await onNewVersion();
          }
        }
        return;
      }

      // Verificar se há nova versão durante uso
      if (serverVersion !== currentVersionRef.current && !hasActedRef.current) {
        console.log(`[Version] Atualização detectada: ${currentVersionRef.current} → ${serverVersion}`);
        hasActedRef.current = true;
        localStorage.setItem(VERSION_STORAGE_KEY, serverVersion);

        // Kiosk: reload silencioso
        if (kioskMode) {
          console.log(`[Kiosk] Reload silencioso para nova versão`);
          performCleanReload(serverVersion);
          return;
        }

        // Usuário normal: avisar e fazer logout após 5 segundos
        toast({
          title: "Sistema atualizado",
          description: "Uma nova versão foi publicada. Você será desconectado em 5 segundos para garantir o funcionamento correto.",
          duration: 5000,
        });

        setTimeout(async () => {
          if (onNewVersion) {
            await onNewVersion();
          } else {
            performCleanReload(serverVersion);
          }
        }, 5000);
      }
    } catch (error) {
      console.debug("[Version] Erro ao verificar versão:", error);
    }
  }, [toast, onNewVersion]);

  useEffect(() => {
    checkVersion();

    intervalRef.current = setInterval(checkVersion, VERSION_CHECK_INTERVAL);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        checkVersion();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [checkVersion]);
}

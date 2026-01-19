import { useEffect, useRef, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";

const VERSION_CHECK_INTERVAL = 60000; // Verificar a cada 1 minuto
const VERSION_STORAGE_KEY = "link_monitor_app_version";
const ROUTE_RESTORE_KEY = "link_monitor_restore_route";
const KIOSK_RELOAD_KEY = "link_monitor_kiosk_last_reload";
const KIOSK_RELOAD_INTERVAL = 6 * 60 * 60 * 1000; // 6 horas em ms

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

// Função para limpar todo o cache e forçar reload limpo
function performCleanReload(newVersion: string) {
  console.log(`[Version] Limpando cache e recarregando para versão ${newVersion}`);
  
  // 1. Salvar rota atual antes do reload (para restauração)
  saveCurrentRoute();
  
  // 2. Limpar cache do React Query
  queryClient.clear();
  
  // 3. Salvar nova versão no localStorage
  localStorage.setItem(VERSION_STORAGE_KEY, newVersion);
  
  // 4. Atualizar timestamp do último reload em modo kiosk
  if (isKioskMode()) {
    localStorage.setItem(KIOSK_RELOAD_KEY, Date.now().toString());
  }
  
  // 5. Forçar reload completo (bypass browser cache)
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

export function useVersionCheck() {
  const { toast } = useToast();
  const currentVersionRef = useRef<string | null>(null);
  const hasShownToastRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const checkVersion = useCallback(async () => {
    try {
      const kioskMode = isKioskMode();
      
      // Em modo kiosk, verificar se é hora do reload periódico (6h)
      if (kioskMode && shouldKioskReload()) {
        console.log(`[Kiosk] Reload periódico após ${KIOSK_RELOAD_INTERVAL / 3600000}h`);
        // Buscar versão atual antes do reload para manter consistência
        try {
          const response = await fetch("/api/version", { cache: "no-store" });
          if (response.ok) {
            const data: VersionResponse = await response.json();
            performCleanReload(data.version);
          } else {
            // Fallback: usar versão atual ou timestamp
            const fallbackVersion = currentVersionRef.current || Date.now().toString(36);
            performCleanReload(fallbackVersion);
          }
        } catch {
          // Em caso de erro de rede, ainda fazer reload com versão de fallback
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
        
        // Salvar versão no localStorage
        localStorage.setItem(VERSION_STORAGE_KEY, serverVersion);
        
        // Se a versão armazenada for diferente da do servidor, atualizar silenciosamente
        if (storedVersion && storedVersion !== serverVersion) {
          console.log(`[Version] Nova versão detectada na inicialização: ${storedVersion} → ${serverVersion}`);
          performCleanReload(serverVersion);
          return;
        }
        return;
      }

      // Verificar se há nova versão
      if (serverVersion !== currentVersionRef.current && !hasShownToastRef.current) {
        console.log(`[Version] Atualização disponível: ${currentVersionRef.current} → ${serverVersion}`);
        hasShownToastRef.current = true;

        // Em modo kiosk, reload silencioso (sem toast)
        if (kioskMode) {
          console.log(`[Kiosk] Reload silencioso para nova versão`);
          performCleanReload(serverVersion);
          return;
        }

        toast({
          title: "Nova versão disponível",
          description: "O sistema foi atualizado. A página será recarregada em 5 segundos.",
          duration: 5000,
        });

        // Auto-reload após 5 segundos
        setTimeout(() => {
          performCleanReload(serverVersion);
        }, 5000);
      }
    } catch (error) {
      // Silenciosamente ignorar erros de rede
      console.debug("[Version] Erro ao verificar versão:", error);
    }
  }, [toast]);

  useEffect(() => {
    // Verificar imediatamente ao montar
    checkVersion();

    // Configurar verificação periódica
    intervalRef.current = setInterval(checkVersion, VERSION_CHECK_INTERVAL);

    // Verificar quando a aba volta ao foco
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

import { useEffect, useRef, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";

const VERSION_CHECK_INTERVAL = 60000; // Verificar a cada 1 minuto
const VERSION_STORAGE_KEY = "link_monitor_app_version";

interface VersionResponse {
  version: string;
  timestamp: number;
  message: string;
}

// Função para limpar todo o cache e forçar reload limpo
function performCleanReload(newVersion: string) {
  console.log(`[Version] Limpando cache e recarregando para versão ${newVersion}`);
  
  // 1. Limpar cache do React Query
  queryClient.clear();
  
  // 2. Salvar nova versão no localStorage
  localStorage.setItem(VERSION_STORAGE_KEY, newVersion);
  
  // 3. Forçar reload completo (bypass browser cache)
  window.location.reload();
}

export function useVersionCheck() {
  const { toast } = useToast();
  const currentVersionRef = useRef<string | null>(null);
  const hasShownToastRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const checkVersion = useCallback(async () => {
    try {
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

        toast({
          title: "Nova versão disponível",
          description: "O sistema foi atualizado. A página será recarregada em 5 segundos.",
          duration: 5000,
        });

        // Auto-reload após 5 segundos (reduzido de 10s)
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

import { useEffect, useRef, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";

const VERSION_CHECK_INTERVAL = 60000; // Verificar a cada 1 minuto
const VERSION_STORAGE_KEY = "link_monitor_app_version";

interface VersionResponse {
  version: string;
  timestamp: number;
  message: string;
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
          console.log(`[Version] Nova versão detectada: ${storedVersion} → ${serverVersion}`);
          localStorage.setItem(VERSION_STORAGE_KEY, serverVersion);
          // Recarregar automaticamente na primeira detecção
          window.location.reload();
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
          description: "O sistema foi atualizado. A página será recarregada em 10 segundos.",
          duration: 10000,
        });

        // Auto-reload após 10 segundos
        setTimeout(() => {
          localStorage.setItem(VERSION_STORAGE_KEY, serverVersion);
          window.location.reload();
        }, 10000);
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

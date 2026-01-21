import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { getAuthToken } from "@/lib/auth";
import "@xterm/xterm/css/xterm.css";

interface XtermTerminalProps {
  initialCommand?: string;
  sshPassword?: string;
  onClose?: () => void;
}

export function XtermTerminal({ initialCommand, sshPassword, onClose }: XtermTerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminalInstance = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const initialCommandSent = useRef(false);

  const connect = useCallback(() => {
    if (!terminalRef.current) return;

    if (terminalInstance.current) {
      terminalInstance.current.dispose();
    }

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 16,
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      theme: {
        background: "#1e1e1e",
        foreground: "#d4d4d4",
        cursor: "#aeafad",
        cursorAccent: "#000000",
        selectionBackground: "#264f78",
        black: "#000000",
        red: "#cd3131",
        green: "#0dbc79",
        yellow: "#e5e510",
        blue: "#2472c8",
        magenta: "#bc3fbc",
        cyan: "#11a8cd",
        white: "#e5e5e5",
        brightBlack: "#666666",
        brightRed: "#f14c4c",
        brightGreen: "#23d18b",
        brightYellow: "#f5f543",
        brightBlue: "#3b8eea",
        brightMagenta: "#d670d6",
        brightCyan: "#29b8db",
        brightWhite: "#e5e5e5",
      },
    });

    const fit = new FitAddon();
    fitAddon.current = fit;
    term.loadAddon(fit);

    term.open(terminalRef.current);
    fit.fit();

    terminalInstance.current = term;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const hostname = window.location.hostname;
    const currentPort = window.location.port;
    const adminPort = "5001";
    
    // URL primária (mesma porta)
    const primaryUrl = `${protocol}//${window.location.host}/ws/terminal`;
    // URL alternativa (porta admin) - para quando o terminal está em porta separada
    const fallbackUrl = `${protocol}//${hostname}:${adminPort}/ws/terminal`;
    
    // Verificar se já estamos na porta admin
    const isAlreadyOnAdminPort = currentPort === adminPort;
    
    term.writeln("\x1b[33mConectando ao terminal...\x1b[0m");

    // Primeiro tenta na porta atual
    let ws = new WebSocket(primaryUrl);
    let usingFallback = false;
    wsRef.current = ws;

    ws.onopen = () => {
      const token = getAuthToken();
      if (!token) {
        term.writeln("\x1b[31mErro: Não autenticado. Faça login novamente.\x1b[0m");
        ws.close();
        return;
      }
      
      term.writeln("\x1b[33mAutenticando...\x1b[0m");
      
      // Enviar configuração inicial com token de autenticação
      ws.send(JSON.stringify({ 
        type: "init",
        token,
        cols: term.cols, 
        rows: term.rows,
        env: sshPassword ? { SSHPASS: sshPassword } : undefined,
      }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "ready") {
          term.writeln("\x1b[32mConectado!\x1b[0m\r\n");
          // Enviar comando inicial após autenticação confirmada
          if (initialCommand && !initialCommandSent.current) {
            initialCommandSent.current = true;
            setTimeout(() => {
              ws.send(JSON.stringify({ type: "input", data: initialCommand + "\n" }));
            }, 300);
          }
        } else if (msg.type === "output") {
          term.write(msg.data);
        } else if (msg.type === "error") {
          term.writeln(`\r\n\x1b[31mErro: ${msg.error}\x1b[0m`);
        } else if (msg.type === "exit") {
          term.writeln(`\r\n\x1b[31mSessão encerrada (código: ${msg.exitCode})\x1b[0m`);
        }
      } catch {
        term.write(event.data);
      }
    };

    ws.onerror = () => {
      // Se falhou na porta atual e não é a porta admin, tentar na porta admin
      if (!usingFallback && !isAlreadyOnAdminPort) {
        term.writeln("\r\n\x1b[33mTentando porta administrativa...\x1b[0m");
        usingFallback = true;
        
        // Criar nova conexão na porta admin
        const fallbackWs = new WebSocket(fallbackUrl);
        wsRef.current = fallbackWs;
        
        fallbackWs.onopen = ws.onopen;
        fallbackWs.onmessage = ws.onmessage;
        fallbackWs.onerror = () => {
          term.writeln("\r\n\x1b[31mErro na conexão WebSocket (porta admin também falhou)\x1b[0m");
        };
        fallbackWs.onclose = () => {
          term.writeln("\r\n\x1b[33mConexão encerrada\x1b[0m");
        };
        
        // Reconectar handlers de input
        term.onData((data) => {
          if (fallbackWs.readyState === WebSocket.OPEN) {
            fallbackWs.send(JSON.stringify({ type: "input", data }));
          }
        });
        term.onResize(({ cols, rows }) => {
          if (fallbackWs.readyState === WebSocket.OPEN) {
            fallbackWs.send(JSON.stringify({ type: "resize", cols, rows }));
          }
        });
      } else {
        term.writeln("\r\n\x1b[31mErro na conexão WebSocket\x1b[0m");
      }
    };

    ws.onclose = () => {
      if (!usingFallback) {
        term.writeln("\r\n\x1b[33mConexão encerrada\x1b[0m");
      }
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "input", data }));
      }
    });

    term.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols, rows }));
      }
    });

    const handleResize = () => {
      if (fitAddon.current) {
        fitAddon.current.fit();
      }
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      ws.close();
      term.dispose();
    };
  }, [initialCommand, sshPassword]);

  useEffect(() => {
    const cleanup = connect();
    return () => {
      if (cleanup) cleanup();
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (terminalInstance.current) {
        terminalInstance.current.dispose();
      }
    };
  }, [connect]);

  return (
    <div className="relative">
      <div 
        ref={terminalRef} 
        className="w-full rounded-md overflow-hidden"
        style={{ height: "400px" }}
        data-testid="xterm-terminal"
      />
    </div>
  );
}

import { useEffect, useRef, useCallback, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { getAuthToken } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Maximize2, Minimize2, X } from "lucide-react";
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
  const [isFullscreen, setIsFullscreen] = useState(false);

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
        foreground: "#5af78e",
        cursor: "#5af78e",
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
        sshPassword: sshPassword || undefined
      }));
    };

    ws.onerror = (error) => {
      // Se falhou na porta principal e não estamos na porta admin, tenta a porta admin
      if (!usingFallback && !isAlreadyOnAdminPort) {
        term.writeln("\x1b[33mTentando conexão alternativa...\x1b[0m");
        usingFallback = true;
        ws = new WebSocket(fallbackUrl);
        wsRef.current = ws;
        
        ws.onopen = () => {
          const token = getAuthToken();
          if (!token) {
            term.writeln("\x1b[31mErro: Não autenticado. Faça login novamente.\x1b[0m");
            ws.close();
            return;
          }
          
          term.writeln("\x1b[33mAutenticando...\x1b[0m");
          ws.send(JSON.stringify({ 
            type: "init",
            token,
            cols: term.cols, 
            rows: term.rows,
            sshPassword: sshPassword || undefined
          }));
        };
        
        ws.onerror = () => {
          term.writeln("\x1b[31mErro: Não foi possível conectar ao terminal.\x1b[0m");
          term.writeln("\x1b[31mVerifique se o servidor está rodando.\x1b[0m");
        };
        
        ws.onmessage = (event) => {
          const data = JSON.parse(event.data);
          if (data.type === "output") {
            term.write(data.data);
          } else if (data.type === "authenticated" || data.type === "ready") {
            term.writeln("\x1b[32mConectado!\x1b[0m");
            term.writeln("");
            
            // Enviar comando inicial se fornecido (somente uma vez)
            console.log("[Terminal/Fallback] authenticated - initialCommand:", initialCommand ? `"${initialCommand.substring(0, 50)}..."` : "undefined");
            console.log("[Terminal/Fallback] initialCommandSent.current:", initialCommandSent.current);
            if (initialCommand && !initialCommandSent.current) {
              initialCommandSent.current = true;
              // Captura o comando em variável local para evitar problemas de closure
              const sshCmd = initialCommand;
              // Configura alias SSH com timeout menor para resposta rápida
              const sshAliasCmd = "alias ssh='ssh -F /opt/link-monitor/ssh_legacy_config'";
              term.writeln("\x1b[90m[DEBUG] Preparando execução automática...\x1b[0m");
              setTimeout(() => {
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({ type: "input", data: sshAliasCmd + "\n" }));
                  // Executa o comando SSH após o alias
                  setTimeout(() => {
                    if (ws.readyState === WebSocket.OPEN) {
                      term.writeln("\x1b[90m[DEBUG] Executando SSH...\x1b[0m");
                      ws.send(JSON.stringify({ type: "input", data: sshCmd + "\n" }));
                    } else {
                      term.writeln("\x1b[31m[ERRO] WebSocket fechou antes de enviar SSH\x1b[0m");
                    }
                  }, 300);
                } else {
                  term.writeln("\x1b[31m[ERRO] WebSocket não está aberto para enviar alias\x1b[0m");
                }
              }, 100);
            } else if (!initialCommand) {
              // Terminal sem comando inicial - modo shell puro
            } else {
              term.writeln("\x1b[33m[AVISO] Comando já foi enviado anteriormente\x1b[0m");
            }
          } else if (data.type === "auth_error") {
            term.writeln(`\x1b[31mErro de autenticação: ${data.message}\x1b[0m`);
            ws.close();
          } else if (data.type === "error") {
            term.writeln(`\x1b[31mErro: ${data.message}\x1b[0m`);
          }
        };
        
        ws.onclose = () => {
          term.writeln("\x1b[33mConexão encerrada.\x1b[0m");
        };
      } else {
        term.writeln("\x1b[31mErro: Não foi possível conectar ao terminal.\x1b[0m");
        term.writeln("\x1b[31mVerifique se o servidor está rodando.\x1b[0m");
      }
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "output") {
        term.write(data.data);
      } else if (data.type === "authenticated" || data.type === "ready") {
        term.writeln("\x1b[32mConectado!\x1b[0m");
        term.writeln("");
        
        // Enviar comando inicial se fornecido (somente uma vez)
        console.log("[Terminal] authenticated - initialCommand:", initialCommand ? `"${initialCommand.substring(0, 50)}..."` : "undefined");
        console.log("[Terminal] initialCommandSent.current:", initialCommandSent.current);
        if (initialCommand && !initialCommandSent.current) {
          initialCommandSent.current = true;
          // Captura o comando em variável local para evitar problemas de closure
          const sshCmd = initialCommand;
          // Configura alias SSH com timeout menor para resposta rápida
          const sshAliasCmd = "alias ssh='ssh -F /opt/link-monitor/ssh_legacy_config'";
          term.writeln("\x1b[90m[DEBUG] Preparando execução automática...\x1b[0m");
          setTimeout(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "input", data: sshAliasCmd + "\n" }));
              // Executa o comando SSH após o alias
              setTimeout(() => {
                if (ws.readyState === WebSocket.OPEN) {
                  term.writeln("\x1b[90m[DEBUG] Executando SSH...\x1b[0m");
                  ws.send(JSON.stringify({ type: "input", data: sshCmd + "\n" }));
                } else {
                  term.writeln("\x1b[31m[ERRO] WebSocket fechou antes de enviar SSH\x1b[0m");
                }
              }, 300);
            } else {
              term.writeln("\x1b[31m[ERRO] WebSocket não está aberto para enviar alias\x1b[0m");
            }
          }, 100);
        } else if (!initialCommand) {
          // Terminal sem comando inicial - modo shell puro
        } else {
          term.writeln("\x1b[33m[AVISO] Comando já foi enviado anteriormente\x1b[0m");
        }
      } else if (data.type === "auth_error") {
        term.writeln(`\x1b[31mErro de autenticação: ${data.message}\x1b[0m`);
        ws.close();
      } else if (data.type === "error") {
        term.writeln(`\x1b[31mErro: ${data.message}\x1b[0m`);
      }
    };

    ws.onclose = () => {
      term.writeln("\x1b[33mConexão encerrada.\x1b[0m");
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "input", data }));
      }
    });

    const handleResize = () => {
      if (fitAddon.current && terminalInstance.current) {
        fitAddon.current.fit();
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ 
            type: "resize", 
            cols: terminalInstance.current.cols, 
            rows: terminalInstance.current.rows 
          }));
        }
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

  // Refit terminal quando mudar fullscreen
  useEffect(() => {
    if (fitAddon.current && terminalInstance.current) {
      // Pequeno delay para garantir que o DOM atualizou
      setTimeout(() => {
        fitAddon.current?.fit();
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ 
            type: "resize", 
            cols: terminalInstance.current?.cols, 
            rows: terminalInstance.current?.rows 
          }));
        }
      }, 50);
    }
  }, [isFullscreen]);

  // Escape para sair do fullscreen
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isFullscreen) {
        setIsFullscreen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isFullscreen]);

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  if (isFullscreen) {
    return (
      <div 
        className="fixed inset-0 z-50 bg-[#1e1e1e] flex flex-col"
        data-testid="terminal-fullscreen"
      >
        <div className="flex items-center justify-between px-4 py-2 bg-[#2d2d2d] border-b border-[#404040]">
          <span className="text-[#5af78e] font-mono text-sm">Terminal SSH</span>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={toggleFullscreen}
              className="text-gray-400 hover:text-white hover:bg-[#404040]"
              data-testid="button-exit-fullscreen"
            >
              <Minimize2 className="w-4 h-4 mr-1" />
              Sair da Tela Cheia
            </Button>
            {onClose && (
              <Button
                size="sm"
                variant="ghost"
                onClick={onClose}
                className="text-gray-400 hover:text-red-400 hover:bg-[#404040]"
                data-testid="button-close-terminal"
              >
                <X className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>
        <div 
          ref={terminalRef} 
          className="flex-1 w-full"
          data-testid="xterm-terminal"
        />
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
        <Button
          size="sm"
          variant="ghost"
          onClick={toggleFullscreen}
          className="h-7 px-2 text-gray-400 hover:text-white bg-[#2d2d2d]/80 hover:bg-[#404040]"
          title="Tela Cheia (ESC para sair)"
          data-testid="button-fullscreen"
        >
          <Maximize2 className="w-4 h-4" />
        </Button>
        {onClose && (
          <Button
            size="sm"
            variant="ghost"
            onClick={onClose}
            className="h-7 px-2 text-gray-400 hover:text-red-400 bg-[#2d2d2d]/80 hover:bg-[#404040]"
            title="Fechar Terminal"
            data-testid="button-close-terminal-inline"
          >
            <X className="w-4 h-4" />
          </Button>
        )}
      </div>
      <div 
        ref={terminalRef} 
        className="w-full rounded-md overflow-hidden"
        style={{ height: "500px" }}
        data-testid="xterm-terminal"
      />
    </div>
  );
}

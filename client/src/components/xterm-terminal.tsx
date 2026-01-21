import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
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
      fontSize: 14,
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
    const wsUrl = `${protocol}//${window.location.host}/ws/terminal`;
    
    term.writeln("\x1b[33mConectando ao terminal...\x1b[0m");

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      term.writeln("\x1b[32mConectado!\x1b[0m\r\n");
      
      // Enviar configuração inicial incluindo variáveis de ambiente para SSH
      ws.send(JSON.stringify({ 
        type: "init",
        cols: term.cols, 
        rows: term.rows,
        env: sshPassword ? { SSHPASS: sshPassword } : undefined,
      }));
      
      if (initialCommand && !initialCommandSent.current) {
        initialCommandSent.current = true;
        setTimeout(() => {
          ws.send(JSON.stringify({ type: "input", data: initialCommand + "\n" }));
        }, 300);
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "output") {
          term.write(msg.data);
        } else if (msg.type === "exit") {
          term.writeln(`\r\n\x1b[31mSessão encerrada (código: ${msg.exitCode})\x1b[0m`);
        }
      } catch {
        term.write(event.data);
      }
    };

    ws.onerror = () => {
      term.writeln("\r\n\x1b[31mErro na conexão WebSocket\x1b[0m");
    };

    ws.onclose = () => {
      term.writeln("\r\n\x1b[33mConexão encerrada\x1b[0m");
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

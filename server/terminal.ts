import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import type { IncomingMessage } from "http";
import * as pty from "node-pty";
import jwt from "jsonwebtoken";
import type { AuthUser } from "@shared/schema";

const JWT_SECRET = process.env.SESSION_SECRET || "link-monitor-secret-key";

const activePtys = new Map<WebSocket, pty.IPty>();

// Verifica se o token é válido e pertence a um Super Admin
function verifyTerminalAccess(token: string): { valid: boolean; user?: AuthUser; error?: string } {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthUser;
    
    if (!decoded.isSuperAdmin) {
      return { valid: false, error: "Acesso restrito a Super Administradores" };
    }
    
    return { valid: true, user: decoded };
  } catch (error) {
    return { valid: false, error: "Token inválido ou expirado" };
  }
}

export function setupTerminalWebSocket(server: Server) {
  const wss = new WebSocketServer({ 
    server,
    path: "/ws/terminal"
  });

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    console.log("[terminal] WebSocket connected - awaiting authentication");
    
    let ptyProcess: pty.IPty | null = null;
    let authenticated = false;
    
    const createPty = (cols: number, rows: number, customEnv?: Record<string, string>) => {
      const terminalUser = process.env.TERMINAL_USER;
      const shell = process.env.SHELL || "/bin/bash";
      
      // Determinar o HOME correto para o usuário do terminal
      const userHome = terminalUser ? `/home/${terminalUser}` : (process.env.HOME || "/home/runner");
      
      // Caminho para configuração SSH com suporte a equipamentos legados
      const sshConfigPath = process.cwd() + "/ssh_legacy_config";
      
      const env: Record<string, string> = {
        ...(process.env as Record<string, string>),
        TERM: "xterm-256color",
        HOME: userHome,
        // Alias para SSH usar configuração com algoritmos legados
        SSH_CONFIG: sshConfigPath,
      };
      
      // Adicionar variáveis de ambiente customizadas (ex: SSHPASS)
      if (customEnv) {
        Object.assign(env, customEnv);
        // Log para debug (mascarando a senha)
        const debugEnv = { ...customEnv };
        if (debugEnv.SSHPASS) {
          debugEnv.SSHPASS = `***${debugEnv.SSHPASS.slice(-4) || '****'}`;
        }
        console.log(`[terminal] Custom env received:`, debugEnv);
      }
      
      // Se TERMINAL_USER estiver definido, usar su para trocar de usuário
      let command: string;
      let args: string[];
      if (terminalUser) {
        command = "su";
        // Usar -m para preservar variáveis de ambiente (incluindo SSHPASS e HOME corrigido)
        args = ["-m", terminalUser, "-c", shell];
      } else {
        command = shell;
        args = [];
      }
      
      ptyProcess = pty.spawn(command, args, {
        name: "xterm-256color",
        cols: cols || 80,
        rows: rows || 24,
        cwd: terminalUser ? `/home/${terminalUser}` : (process.env.HOME || "/home/runner"),
        env,
      });

      activePtys.set(ws, ptyProcess);

      // Configurar alias SSH para equipamentos legados após o shell iniciar
      // Nota: não limpa a tela para que o usuário veja o comando sendo executado
      setTimeout(() => {
        if (ptyProcess) {
          ptyProcess.write(`alias ssh='ssh -F ${sshConfigPath}'\n`);
        }
      }, 300);

      ptyProcess.onData((data: string) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "output", data }));
        }
      });

      ptyProcess.onExit(({ exitCode, signal }) => {
        console.log(`[terminal] PTY exited with code ${exitCode}, signal ${signal}`);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "exit", exitCode, signal }));
          ws.close();
        }
      });
    };

    ws.on("message", (message: Buffer | string) => {
      try {
        const msg = JSON.parse(message.toString());
        
        switch (msg.type) {
          case "init":
            // Verificar autenticação antes de criar o PTY
            if (!msg.token) {
              console.log("[terminal] Init without token - rejecting");
              ws.send(JSON.stringify({ type: "error", error: "Token de autenticação não fornecido" }));
              ws.close(4001, "Authentication required");
              return;
            }
            
            const authResult = verifyTerminalAccess(msg.token);
            if (!authResult.valid) {
              console.log(`[terminal] Auth failed: ${authResult.error}`);
              ws.send(JSON.stringify({ type: "error", error: authResult.error }));
              ws.close(4003, "Access denied");
              return;
            }
            
            authenticated = true;
            console.log(`[terminal] Authenticated: ${authResult.user?.email} (Super Admin)`);
            
            // Criar PTY com configuração inicial
            if (!ptyProcess) {
              createPty(msg.cols, msg.rows, msg.env);
              ws.send(JSON.stringify({ type: "ready" }));
            }
            break;
            
          case "input":
            if (!authenticated) {
              ws.send(JSON.stringify({ type: "error", error: "Não autenticado" }));
              return;
            }
            if (ptyProcess) {
              ptyProcess.write(msg.data);
            }
            break;
            
          case "resize":
            if (!authenticated) return;
            if (ptyProcess && msg.cols && msg.rows) {
              ptyProcess.resize(msg.cols, msg.rows);
            }
            break;
        }
      } catch (err) {
        console.error("[terminal] Error parsing message:", err);
      }
    });

    ws.on("close", () => {
      console.log("[terminal] WebSocket closed");
      const p = activePtys.get(ws);
      if (p) {
        p.kill();
        activePtys.delete(ws);
      }
    });

    ws.on("error", (err) => {
      console.error("[terminal] WebSocket error:", err);
    });
  });

  console.log("[terminal] WebSocket server ready on /ws/terminal");
}

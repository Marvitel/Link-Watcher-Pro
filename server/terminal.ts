import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import type { IncomingMessage } from "http";
import * as pty from "node-pty";

const activePtys = new Map<WebSocket, pty.IPty>();

export function setupTerminalWebSocket(server: Server) {
  const wss = new WebSocketServer({ 
    server,
    path: "/ws/terminal"
  });

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    console.log("[terminal] WebSocket connected");
    
    const shell = process.env.SHELL || "/bin/bash";
    
    const ptyProcess = pty.spawn(shell, [], {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd: process.env.HOME || "/home/runner",
      env: {
        ...process.env,
        TERM: "xterm-256color",
      } as { [key: string]: string },
    });

    activePtys.set(ws, ptyProcess);

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

    ws.on("message", (message: Buffer | string) => {
      try {
        const msg = JSON.parse(message.toString());
        
        switch (msg.type) {
          case "input":
            ptyProcess.write(msg.data);
            break;
          case "resize":
            if (msg.cols && msg.rows) {
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

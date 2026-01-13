// @ts-ignore - radius module lacks type definitions
import radius from "radius";
import dgram from "dgram";
import crypto from "crypto";
import { decrypt } from "./crypto";

export interface RadiusConfig {
  host: string;
  port: number;
  secret: string;
  nasIdentifier?: string;
  timeout?: number;
  retries?: number;
}

export interface RadiusAuthResult {
  success: boolean;
  message: string;
  code?: string;
  attributes?: Record<string, unknown>;
}

export class RadiusAuthService {
  private config: RadiusConfig;

  constructor(config: RadiusConfig) {
    this.config = {
      timeout: 5000,
      retries: 3,
      nasIdentifier: "LinkMonitor",
      ...config,
    };
  }

  async authenticate(username: string, password: string): Promise<RadiusAuthResult> {
    const secret = this.config.secret;
    
    const packet = {
      code: "Access-Request",
      secret: secret,
      identifier: Math.floor(Math.random() * 256),
      attributes: [
        ["User-Name", username],
        ["User-Password", password],
        ["NAS-Identifier", this.config.nasIdentifier || "LinkMonitor"],
        ["NAS-Port-Type", 15], // Async
        ["Service-Type", 2], // Framed
      ],
    };

    return new Promise((resolve) => {
      const client = dgram.createSocket("udp4");
      let attempts = 0;
      let timeoutId: NodeJS.Timeout | null = null;
      let resolved = false;

      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        try {
          client.close();
        } catch (e) {
        }
      };

      const doResolve = (result: RadiusAuthResult) => {
        if (resolved) return;
        resolved = true;
        cleanup();
        resolve(result);
      };

      const sendRequest = () => {
        attempts++;
        
        try {
          const encoded = radius.encode(packet);
          
          client.send(encoded, 0, encoded.length, this.config.port, this.config.host, (err) => {
            if (err) {
              console.error("[RADIUS] Send error:", err.message);
              if (attempts < (this.config.retries || 3)) {
                sendRequest();
              } else {
                doResolve({
                  success: false,
                  message: `Erro de conexão RADIUS: ${err.message}`,
                  code: "CONNECTION_ERROR",
                });
              }
            }
          });

          timeoutId = setTimeout(() => {
            if (attempts < (this.config.retries || 3)) {
              console.log(`[RADIUS] Timeout, tentativa ${attempts + 1}/${this.config.retries || 3}`);
              sendRequest();
            } else {
              doResolve({
                success: false,
                message: "Servidor RADIUS não respondeu (timeout)",
                code: "TIMEOUT",
              });
            }
          }, this.config.timeout || 5000);
          
        } catch (encodeError) {
          console.error("[RADIUS] Encode error:", encodeError);
          doResolve({
            success: false,
            message: `Erro ao codificar pacote RADIUS: ${encodeError instanceof Error ? encodeError.message : String(encodeError)}`,
            code: "ENCODE_ERROR",
          });
        }
      };

      client.on("message", (msg) => {
        try {
          const response = radius.decode({ packet: msg, secret: secret });
          
          if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
          }

          if (response.code === "Access-Accept") {
            console.log(`[RADIUS] Access-Accept para usuário: ${username}`);
            doResolve({
              success: true,
              message: "Autenticação RADIUS bem-sucedida",
              code: "ACCESS_ACCEPT",
              attributes: response.attributes as Record<string, unknown>,
            });
          } else if (response.code === "Access-Reject") {
            console.log(`[RADIUS] Access-Reject para usuário: ${username}`);
            doResolve({
              success: false,
              message: "Credenciais inválidas",
              code: "ACCESS_REJECT",
            });
          } else if (response.code === "Access-Challenge") {
            console.log(`[RADIUS] Access-Challenge para usuário: ${username}`);
            doResolve({
              success: false,
              message: "Autenticação requer desafio adicional (não suportado)",
              code: "ACCESS_CHALLENGE",
            });
          } else {
            doResolve({
              success: false,
              message: `Resposta RADIUS inesperada: ${response.code}`,
              code: response.code,
            });
          }
        } catch (decodeError) {
          console.error("[RADIUS] Decode error:", decodeError);
          doResolve({
            success: false,
            message: `Erro ao decodificar resposta RADIUS: ${decodeError instanceof Error ? decodeError.message : String(decodeError)}`,
            code: "DECODE_ERROR",
          });
        }
      });

      client.on("error", (err) => {
        console.error("[RADIUS] Socket error:", err.message);
        doResolve({
          success: false,
          message: `Erro de socket RADIUS: ${err.message}`,
          code: "SOCKET_ERROR",
        });
      });

      sendRequest();
    });
  }

  async testConnection(): Promise<RadiusAuthResult> {
    const testPacket = {
      code: "Access-Request",
      secret: this.config.secret,
      identifier: Math.floor(Math.random() * 256),
      attributes: [
        ["User-Name", "__radius_health_check__"],
        ["User-Password", "__test__"],
        ["NAS-Identifier", this.config.nasIdentifier || "LinkMonitor"],
      ],
    };

    return new Promise((resolve) => {
      const client = dgram.createSocket("udp4");
      let resolved = false;

      const doResolve = (result: RadiusAuthResult) => {
        if (resolved) return;
        resolved = true;
        try { client.close(); } catch (e) {}
        resolve(result);
      };

      const timeout = setTimeout(() => {
        doResolve({
          success: false,
          message: "Servidor RADIUS não respondeu",
          code: "TIMEOUT",
        });
      }, this.config.timeout || 5000);

      try {
        const encoded = radius.encode(testPacket);
        
        client.send(encoded, 0, encoded.length, this.config.port, this.config.host, (err) => {
          if (err) {
            clearTimeout(timeout);
            doResolve({
              success: false,
              message: `Erro de conexão: ${err.message}`,
              code: "CONNECTION_ERROR",
            });
          }
        });
      } catch (encodeError) {
        clearTimeout(timeout);
        doResolve({
          success: false,
          message: `Erro ao preparar teste: ${encodeError instanceof Error ? encodeError.message : String(encodeError)}`,
          code: "ENCODE_ERROR",
        });
        return;
      }

      client.on("message", (msg) => {
        clearTimeout(timeout);
        try {
          const response = radius.decode({ packet: msg, secret: this.config.secret });
          doResolve({
            success: true,
            message: `Servidor RADIUS respondeu (${response.code})`,
            code: response.code,
          });
        } catch (decodeError) {
          doResolve({
            success: false,
            message: "Servidor respondeu mas falha ao decodificar (verifique shared secret)",
            code: "DECODE_ERROR",
          });
        }
      });

      client.on("error", (err) => {
        clearTimeout(timeout);
        doResolve({
          success: false,
          message: `Erro de socket: ${err.message}`,
          code: "SOCKET_ERROR",
        });
      });
    });
  }
}

export interface RadiusSettingsForService {
  primaryHost: string;
  primaryPort: number;
  sharedSecretEncrypted: string;
  secondaryHost?: string | null;
  secondaryPort?: number | null;
  secondarySecretEncrypted?: string | null;
  nasIdentifier?: string | null;
  timeout?: number;
  retries?: number;
}

export async function createRadiusServiceFromSettings(settings: RadiusSettingsForService): Promise<RadiusAuthService> {
  const decryptedSecret = decrypt(settings.sharedSecretEncrypted);
  
  return new RadiusAuthService({
    host: settings.primaryHost,
    port: settings.primaryPort,
    secret: decryptedSecret,
    nasIdentifier: settings.nasIdentifier || "LinkMonitor",
    timeout: settings.timeout || 5000,
    retries: settings.retries || 3,
  });
}

export async function authenticateWithFailover(
  settings: RadiusSettingsForService,
  username: string,
  password: string
): Promise<RadiusAuthResult & { usedServer: "primary" | "secondary" }> {
  const primaryService = await createRadiusServiceFromSettings(settings);
  
  console.log(`[RADIUS] Tentando autenticação no servidor primário: ${settings.primaryHost}:${settings.primaryPort}`);
  const primaryResult = await primaryService.authenticate(username, password);
  
  if (primaryResult.success || primaryResult.code === "ACCESS_REJECT") {
    return { ...primaryResult, usedServer: "primary" };
  }
  
  if (settings.secondaryHost && settings.secondarySecretEncrypted) {
    console.log(`[RADIUS] Servidor primário falhou (${primaryResult.code}), tentando secundário: ${settings.secondaryHost}:${settings.secondaryPort}`);
    
    const secondarySecret = decrypt(settings.secondarySecretEncrypted);
    const secondaryService = new RadiusAuthService({
      host: settings.secondaryHost,
      port: settings.secondaryPort || 1812,
      secret: secondarySecret,
      nasIdentifier: settings.nasIdentifier || "LinkMonitor",
      timeout: settings.timeout || 5000,
      retries: settings.retries || 3,
    });
    
    const secondaryResult = await secondaryService.authenticate(username, password);
    return { ...secondaryResult, usedServer: "secondary" };
  }
  
  return { ...primaryResult, usedServer: "primary" };
}

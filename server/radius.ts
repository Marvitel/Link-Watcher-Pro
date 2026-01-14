// @ts-ignore - radius module lacks type definitions
import radius from "radius";
import dgram from "dgram";
import crypto from "crypto";
import path from "path";
import CryptoJS from "crypto-js";
// @ts-ignore - js-md4 lacks type definitions
import md4 from "js-md4";
import { decrypt } from "./crypto";

// Load Microsoft vendor-specific dictionary for MS-CHAPv2
// Use process.cwd() for production builds (CJS format)
const dictionaryPath = path.join(process.cwd(), "server", "dictionaries", "dictionary.microsoft");
try {
  radius.add_dictionary(dictionaryPath);
  console.log("[RADIUS] Microsoft dictionary loaded from:", dictionaryPath);
} catch (err) {
  console.warn("[RADIUS] Failed to load Microsoft dictionary:", err);
}

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
  groups?: string[];
}

// MS-CHAPv2 helper functions (RFC 2759)

// Helper functions for CryptoJS WordArray <-> Buffer conversion
function bufferToWordArray(buffer: Buffer): CryptoJS.lib.WordArray {
  const words: number[] = [];
  for (let i = 0; i < buffer.length; i += 4) {
    words.push(
      ((buffer[i] || 0) << 24) |
      ((buffer[i + 1] || 0) << 16) |
      ((buffer[i + 2] || 0) << 8) |
      (buffer[i + 3] || 0)
    );
  }
  return CryptoJS.lib.WordArray.create(words, buffer.length);
}

function wordArrayToBuffer(wordArray: CryptoJS.lib.WordArray): Buffer {
  const words = wordArray.words;
  const sigBytes = wordArray.sigBytes;
  const buffer = Buffer.alloc(sigBytes);
  
  for (let i = 0; i < sigBytes; i++) {
    const wordIndex = Math.floor(i / 4);
    const byteIndex = 3 - (i % 4);
    buffer[i] = (words[wordIndex] >> (byteIndex * 8)) & 0xff;
  }
  
  return buffer;
}

function ntHash(password: string): Buffer {
  const utf16le = Buffer.from(password, "utf16le");
  // Use js-md4 for OpenSSL 3.0+ compatibility (MD4 is legacy)
  const hashArray = md4.array(utf16le);
  return Buffer.from(hashArray);
}

function challengeHash(peerChallenge: Buffer, authChallenge: Buffer, username: string): Buffer {
  const hash = crypto.createHash("sha1");
  hash.update(peerChallenge);
  hash.update(authChallenge);
  hash.update(Buffer.from(username, "utf8"));
  return hash.digest().slice(0, 8);
}

function desEncrypt(key7: Buffer, data: Buffer): Buffer {
  // Expand 7-byte key to 8-byte DES key with parity bits
  const key8 = Buffer.alloc(8);
  key8[0] = key7[0];
  key8[1] = ((key7[0] << 7) | (key7[1] >> 1)) & 0xff;
  key8[2] = ((key7[1] << 6) | (key7[2] >> 2)) & 0xff;
  key8[3] = ((key7[2] << 5) | (key7[3] >> 3)) & 0xff;
  key8[4] = ((key7[3] << 4) | (key7[4] >> 4)) & 0xff;
  key8[5] = ((key7[4] << 3) | (key7[5] >> 5)) & 0xff;
  key8[6] = ((key7[5] << 2) | (key7[6] >> 6)) & 0xff;
  key8[7] = (key7[6] << 1) & 0xff;
  
  // Set parity bits
  for (let i = 0; i < 8; i++) {
    let parity = 0;
    for (let j = 0; j < 8; j++) {
      parity ^= (key8[i] >> j) & 1;
    }
    key8[i] = (key8[i] & 0xfe) | (parity ^ 1);
  }
  
  // Use crypto-js DES for OpenSSL 3.0+ compatibility (DES is legacy)
  const keyWordArray = bufferToWordArray(key8);
  const dataWordArray = bufferToWordArray(data);
  
  const encrypted = CryptoJS.DES.encrypt(dataWordArray, keyWordArray, {
    mode: CryptoJS.mode.ECB,
    padding: CryptoJS.pad.NoPadding,
  });
  
  // Convert CryptoJS result to Buffer
  return wordArrayToBuffer(encrypted.ciphertext);
}

function challengeResponse(challenge: Buffer, passwordHash: Buffer): Buffer {
  // Pad password hash to 21 bytes
  const paddedHash = Buffer.alloc(21);
  passwordHash.copy(paddedHash, 0, 0, 16);
  
  // Split into 3 7-byte keys and encrypt challenge with each
  const response = Buffer.alloc(24);
  desEncrypt(paddedHash.slice(0, 7), challenge).copy(response, 0);
  desEncrypt(paddedHash.slice(7, 14), challenge).copy(response, 8);
  desEncrypt(paddedHash.slice(14, 21), challenge).copy(response, 16);
  
  return response;
}

function generateNTResponse(authChallenge: Buffer, peerChallenge: Buffer, username: string, password: string): Buffer {
  const challenge = challengeHash(peerChallenge, authChallenge, username);
  const passwordHash = ntHash(password);
  return challengeResponse(challenge, passwordHash);
}

function buildMSCHAP2Response(peerChallenge: Buffer, ntResponse: Buffer, flags: number = 0): Buffer {
  // MS-CHAP2-Response structure (50 bytes):
  // Ident (1) + Flags (1) + Peer-Challenge (16) + Reserved (8) + NT-Response (24)
  const response = Buffer.alloc(50);
  response[0] = Math.floor(Math.random() * 256); // Ident
  response[1] = flags;
  peerChallenge.copy(response, 2, 0, 16);
  // Reserved bytes (8) are already zero
  ntResponse.copy(response, 26, 0, 24);
  return response;
}

function extractGroupsFromAttributes(attributes: unknown): string[] {
  const groups: string[] = [];
  
  if (!attributes || typeof attributes !== "object") {
    return groups;
  }
  
  const attrs = attributes as Record<string, unknown>;
  
  // Filter-Id - common way NPS returns group info
  if (attrs["Filter-Id"]) {
    const filterId = attrs["Filter-Id"];
    if (Array.isArray(filterId)) {
      groups.push(...filterId.map(String));
    } else if (typeof filterId === "string") {
      groups.push(filterId);
    }
  }
  
  // Class attribute - another common method
  if (attrs["Class"]) {
    const classAttr = attrs["Class"];
    if (Array.isArray(classAttr)) {
      classAttr.forEach((c) => {
        const str = String(c);
        // Class often contains group names or DN paths
        if (str.includes("CN=")) {
          const match = str.match(/CN=([^,]+)/);
          if (match) groups.push(match[1]);
        } else {
          groups.push(str);
        }
      });
    } else if (typeof classAttr === "string") {
      if (classAttr.includes("CN=")) {
        const match = classAttr.match(/CN=([^,]+)/);
        if (match) groups.push(match[1]);
      } else {
        groups.push(classAttr);
      }
    }
  }
  
  // Vendor-Specific Attributes (VSA) - check for Microsoft attributes
  if (attrs["Vendor-Specific"]) {
    const vsa = attrs["Vendor-Specific"];
    if (Array.isArray(vsa)) {
      vsa.forEach((v) => {
        if (typeof v === "object" && v !== null) {
          const vsaObj = v as Record<string, unknown>;
          // Microsoft NPS may return groups in various VSA formats
          Object.values(vsaObj).forEach((val) => {
            if (typeof val === "string" && val.length > 0) {
              groups.push(val);
            }
          });
        } else if (typeof v === "string") {
          groups.push(v);
        }
      });
    }
  }
  
  // MS-MPPE attributes sometimes contain group info
  if (attrs["MS-MPPE-Encryption-Policy"] || attrs["MS-MPPE-Encryption-Types"]) {
    // These are encryption settings, not groups - skip
  }
  
  // Reply-Message may contain group info in some configurations
  if (attrs["Reply-Message"]) {
    const replyMsg = attrs["Reply-Message"];
    if (typeof replyMsg === "string" && replyMsg.startsWith("Group:")) {
      groups.push(replyMsg.replace("Group:", "").trim());
    }
  }
  
  return Array.from(new Set(groups)); // Remove duplicates
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

  // MS-CHAPv2 authentication (recommended for Windows NPS)
  async authenticateMSCHAPv2(username: string, password: string): Promise<RadiusAuthResult> {
    const secret = this.config.secret;
    
    console.log("[RADIUS/MSCHAP] Starting authentication for:", username);
    console.log("[RADIUS/MSCHAP] Target:", this.config.host + ":" + this.config.port);
    
    // Generate challenges
    const authChallenge = crypto.randomBytes(16);
    const peerChallenge = crypto.randomBytes(16);
    
    console.log("[RADIUS/MSCHAP] AuthChallenge:", authChallenge.toString("hex"));
    console.log("[RADIUS/MSCHAP] PeerChallenge:", peerChallenge.toString("hex"));
    
    // Generate NT Response
    const ntResponse = generateNTResponse(authChallenge, peerChallenge, username, password);
    console.log("[RADIUS/MSCHAP] NT Response:", ntResponse.toString("hex"));
    
    // Build MS-CHAP2-Response (50 bytes)
    const mschapResponse = buildMSCHAP2Response(peerChallenge, ntResponse);
    console.log("[RADIUS/MSCHAP] MS-CHAP2-Response length:", mschapResponse.length, "bytes");
    
    const packet = {
      code: "Access-Request",
      secret: secret,
      identifier: Math.floor(Math.random() * 256),
      attributes: [
        ["User-Name", username],
        ["NAS-Identifier", this.config.nasIdentifier || "LinkMonitor"],
        ["NAS-Port-Type", 15], // Ethernet
        ["Service-Type", 2], // Framed
        ["MS-CHAP-Challenge", authChallenge],
        ["MS-CHAP2-Response", mschapResponse],
      ],
    };
    
    console.log("[RADIUS/MSCHAP] Packet attributes:", packet.attributes.map(a => a[0]));

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
              console.error("[RADIUS/MSCHAP] Send error:", err.message);
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
              console.log(`[RADIUS/MSCHAP] Timeout, tentativa ${attempts + 1}/${this.config.retries || 3}`);
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
          console.error("[RADIUS/MSCHAP] Encode error:", encodeError);
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
            console.log(`[RADIUS/MSCHAP] Access-Accept para usuário: ${username}`);
            const groups = extractGroupsFromAttributes(response.attributes);
            if (groups.length > 0) {
              console.log(`[RADIUS/MSCHAP] Grupos detectados: ${groups.join(", ")}`);
            }
            doResolve({
              success: true,
              message: "Autenticação MS-CHAPv2 bem-sucedida",
              code: "ACCESS_ACCEPT",
              attributes: response.attributes as Record<string, unknown>,
              groups,
            });
          } else if (response.code === "Access-Reject") {
            console.log(`[RADIUS/MSCHAP] Access-Reject para usuário: ${username}`);
            // Check for MS-CHAP-Error
            const attrs = response.attributes as Record<string, unknown>;
            let errorMsg = "Credenciais inválidas";
            if (attrs && attrs["MS-CHAP-Error"]) {
              errorMsg = `MS-CHAP Error: ${attrs["MS-CHAP-Error"]}`;
            }
            doResolve({
              success: false,
              message: errorMsg,
              code: "ACCESS_REJECT",
            });
          } else if (response.code === "Access-Challenge") {
            console.log(`[RADIUS/MSCHAP] Access-Challenge para usuário: ${username}`);
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
          console.error("[RADIUS/MSCHAP] Decode error:", decodeError);
          doResolve({
            success: false,
            message: `Erro ao decodificar resposta RADIUS: ${decodeError instanceof Error ? decodeError.message : String(decodeError)}`,
            code: "DECODE_ERROR",
          });
        }
      });

      client.on("error", (err) => {
        console.error("[RADIUS/MSCHAP] Socket error:", err.message);
        doResolve({
          success: false,
          message: `Erro de socket RADIUS: ${err.message}`,
          code: "SOCKET_ERROR",
        });
      });

      sendRequest();
    });
  }

  // PAP authentication (legacy, simpler but less secure)
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
            const groups = extractGroupsFromAttributes(response.attributes);
            if (groups.length > 0) {
              console.log(`[RADIUS] Grupos detectados: ${groups.join(", ")}`);
            }
            doResolve({
              success: true,
              message: "Autenticação RADIUS bem-sucedida",
              code: "ACCESS_ACCEPT",
              attributes: response.attributes as Record<string, unknown>,
              groups,
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
    // Use MS-CHAPv2 for connection test (required by NPS)
    const testUsername = "__radius_health_check__";
    const testPassword = "__test__";
    const authChallenge = crypto.randomBytes(16);
    const peerChallenge = crypto.randomBytes(16);
    const ntResponse = generateNTResponse(authChallenge, peerChallenge, testUsername, testPassword);
    const mschapResponse = buildMSCHAP2Response(peerChallenge, ntResponse);

    const testPacket = {
      code: "Access-Request",
      secret: this.config.secret,
      identifier: Math.floor(Math.random() * 256),
      attributes: [
        ["User-Name", testUsername],
        ["NAS-Identifier", this.config.nasIdentifier || "LinkMonitor"],
        ["MS-CHAP-Challenge", authChallenge],
        ["MS-CHAP2-Response", mschapResponse],
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
          // Any response (Access-Accept OR Access-Reject) means connection works
          // Access-Reject just means the test user doesn't exist, which is expected
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

// MS-CHAPv2 authentication with failover (recommended for Windows NPS)
export async function authenticateWithFailover(
  settings: RadiusSettingsForService,
  username: string,
  password: string
): Promise<RadiusAuthResult & { usedServer: "primary" | "secondary" }> {
  const primaryService = await createRadiusServiceFromSettings(settings);
  
  // Use MS-CHAPv2 by default (compatible with Windows NPS)
  console.log(`[RADIUS] Tentando autenticação MS-CHAPv2 no servidor primário: ${settings.primaryHost}:${settings.primaryPort}`);
  const primaryResult = await primaryService.authenticateMSCHAPv2(username, password);
  
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
    
    const secondaryResult = await secondaryService.authenticateMSCHAPv2(username, password);
    return { ...secondaryResult, usedServer: "secondary" };
  }
  
  return { ...primaryResult, usedServer: "primary" };
}

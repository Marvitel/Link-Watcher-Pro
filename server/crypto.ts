import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const secret = process.env.SESSION_SECRET || "default-secret-key-for-development";
  return crypto.createHash("sha256").update(secret).digest();
}

export function encrypt(text: string): string {
  if (!text) return "";
  
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  
  const tag = cipher.getAuthTag();
  
  return iv.toString("hex") + ":" + tag.toString("hex") + ":" + encrypted;
}

export function decrypt(encryptedText: string): string {
  if (!encryptedText) return "";
  
  if (!encryptedText.includes(":")) {
    return encryptedText;
  }
  
  try {
    const parts = encryptedText.split(":");
    if (parts.length !== 3) {
      return encryptedText;
    }
    
    const key = getEncryptionKey();
    const iv = Buffer.from(parts[0], "hex");
    const tag = Buffer.from(parts[1], "hex");
    const encrypted = parts[2];
    
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    
    return decrypted;
  } catch (error) {
    console.error("[Crypto] Decryption failed, returning original:", error);
    return encryptedText;
  }
}

export function isEncrypted(text: string): boolean {
  if (!text) return false;
  const parts = text.split(":");
  return parts.length === 3 && parts[0].length === IV_LENGTH * 2;
}

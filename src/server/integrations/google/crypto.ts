import "server-only";
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";

/**
 * AES-256-GCM for stored Google refresh tokens. Format: "v1:<iv>:<ciphertext>:<tag>" (base64url).
 * The user id is bound in as additional authenticated data, so a ciphertext copied to another
 * user's row will not decrypt. Never logs or echoes the plaintext or the key.
 */

const VERSION = "v1";

export class CryptoError extends Error {
  constructor() {
    super("Could not decrypt the stored Google connection.");
    this.name = "CryptoError";
  }
}

export function parseKey(keyB64: string | undefined): Buffer | null {
  if (!keyB64 || !/^[A-Za-z0-9+/]{43}=$/.test(keyB64)) return null;
  const k = Buffer.from(keyB64, "base64");
  return k.length === 32 ? k : null;
}

export function encryptToken(plain: string, keyB64: string, aad: string, iv: Buffer = randomBytes(12)): string {
  const key = parseKey(keyB64);
  if (!key) throw new CryptoError();
  const c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [VERSION, iv.toString("base64url"), ct.toString("base64url"), c.getAuthTag().toString("base64url")].join(":");
}

export function decryptToken(blob: string, keyB64: string, aad: string): string {
  const key = parseKey(keyB64);
  const parts = blob.split(":");
  if (!key || parts.length !== 4 || parts[0] !== VERSION) throw new CryptoError();
  try {
    const iv = Buffer.from(parts[1]!, "base64url");
    const ct = Buffer.from(parts[2]!, "base64url");
    const tag = Buffer.from(parts[3]!, "base64url");
    if (iv.length !== 12 || tag.length !== 16) throw new CryptoError();
    const d = createDecipheriv("aes-256-gcm", key, iv);
    d.setAAD(Buffer.from(aad, "utf8"));
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
  } catch {
    throw new CryptoError();
  }
}

/** Key for hashing Gmail thread ids, derived from the encryption key (HKDF-SHA256, info "gmail-thread"). */
export function deriveThreadKey(keyB64: string): Buffer {
  const key = parseKey(keyB64);
  if (!key) throw new CryptoError();
  return Buffer.from(hkdfSync("sha256", key, Buffer.alloc(0), "gmail-thread", 32));
}

export function threadHash(threadId: string, threadKey: Buffer): string {
  return createHmac("sha256", threadKey).update(threadId, "utf8").digest("hex");
}

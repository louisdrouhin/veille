/**
 * Encryption of the keys set in Paramètres › Intégrations: AES-256-GCM with the master key SECRETS_KEY
 * (32 random bytes in base64, server .env only: `openssl rand -base64 32`). Each value has its own
 * random 12-byte IV, and its name as additional data, so a ciphertext copied onto another name does
 * not decrypt. Stored as `v1.<iv>.<tag>.<ciphertext>` (base64url).
 * No "server-only" import: the worker bundles it too. Nothing here logs or throws a value.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type MasterKey = { ok: true; key: Buffer } | { ok: false; reason: "missing" | "invalid" };

/** SECRETS_KEY: base64 (or base64url) of exactly 32 bytes, or 64 hex characters. */
export function masterKey(env: Partial<Record<string, string | undefined>> = process.env): MasterKey {
  const raw = env.SECRETS_KEY?.trim() ?? "";
  if (!raw) return { ok: false, reason: "missing" };
  let key: Buffer | null = null;
  if (/^[0-9a-f]{64}$/i.test(raw)) key = Buffer.from(raw, "hex");
  else if (/^[A-Za-z0-9+/_-]{43}=?$/.test(raw)) key = Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  return key && key.length === 32 ? { ok: true, key } : { ok: false, reason: "invalid" };
}

const aad = (name: string) => Buffer.from(`folders-setting:${name}`, "utf8");

export function encryptSecret(key: Buffer, name: string, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad(name));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

/** The value, or null when it does not decrypt (other key, other name, altered data). */
export function decryptSecret(key: Buffer, name: string, blob: string): string | null {
  const parts = blob.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  try {
    const iv = Buffer.from(parts[1]!, "base64url");
    const tag = Buffer.from(parts[2]!, "base64url");
    if (iv.length !== 12 || tag.length !== 16) return null;
    const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
    decipher.setAAD(aad(name));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(Buffer.from(parts[3]!, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** « ••••abcd »: what the interface shows of a key (its last 4 characters, nothing for a short one). */
export function hintOf(value: string): string {
  return value.length >= 12 ? value.slice(-4) : "";
}

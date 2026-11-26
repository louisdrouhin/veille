/**
 * VAPID keys, in the server .env only (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY), made once with
 * `node dist/vapid-keys.js`. VAPID_SUBJECT: a mailto: or https: contact for the push services;
 * defaults to BETTER_AUTH_URL when it is https. Null when anything is missing: push is off.
 */
import { createECDH } from "node:crypto";
import { scalar32, type Vapid } from "./webpush";

const KEY = /^[A-Za-z0-9_-]+$/;

/**
 * The private key as stored, padded to 32 bytes (a key made before 3.4 could have 31: its leading 0x00 was dropped),
 * or null when it is not one of ours.
 */
export function normalizePrivateKey(privateKey: string): string | null {
  if (!KEY.test(privateKey)) return null;
  const d = scalar32(Buffer.from(privateKey, "base64url"));
  return d ? d.toString("base64url") : null;
}

/** A P-256 public key (65 bytes) and the private key that goes with it (32 bytes once padded), in base64url. */
export function isVapidPair(publicKey: string, privateKey: string): boolean {
  if (!KEY.test(publicKey)) return false;
  const pub = Buffer.from(publicKey, "base64url");
  const d = normalizePrivateKey(privateKey);
  if (pub.length !== 65 || !d) return false;
  try {
    const ecdh = createECDH("prime256v1");
    ecdh.setPrivateKey(Buffer.from(d, "base64url"));
    return ecdh.getPublicKey().equals(pub);
  } catch {
    return false;
  }
}

export function vapidConfig(env: Partial<Record<string, string | undefined>> = process.env): Vapid | null {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim() ?? "";
  const privateKey = env.VAPID_PRIVATE_KEY?.trim() ?? "";
  if (!isVapidPair(publicKey, privateKey)) return null;
  const explicit = env.VAPID_SUBJECT?.trim();
  const site = env.BETTER_AUTH_URL?.trim();
  const subject = explicit && /^(mailto:\S+@\S+|https:\/\/\S+)$/.test(explicit) ? explicit : site?.startsWith("https://") ? site : null;
  return subject ? { publicKey, privateKey: normalizePrivateKey(privateKey)!, subject } : null;
}

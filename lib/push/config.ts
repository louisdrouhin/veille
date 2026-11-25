/**
 * VAPID keys, in the server .env only (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY), made once with
 * `node dist/vapid-keys.js`. VAPID_SUBJECT: a mailto: or https: contact for the push services;
 * defaults to BETTER_AUTH_URL when it is https. Null when anything is missing: push is off.
 */
import type { Vapid } from "./webpush";

const KEY = /^[A-Za-z0-9_-]+$/;

/** A P-256 public key (65 bytes) and private key (32 bytes), in base64url. */
export function isVapidPair(publicKey: string, privateKey: string): boolean {
  if (!KEY.test(publicKey) || !KEY.test(privateKey)) return false;
  return Buffer.from(publicKey, "base64url").length === 65 && Buffer.from(privateKey, "base64url").length === 32;
}

export function vapidConfig(env: Partial<Record<string, string | undefined>> = process.env): Vapid | null {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim() ?? "";
  const privateKey = env.VAPID_PRIVATE_KEY?.trim() ?? "";
  if (!isVapidPair(publicKey, privateKey)) return null;
  const explicit = env.VAPID_SUBJECT?.trim();
  const site = env.BETTER_AUTH_URL?.trim();
  const subject = explicit && /^(mailto:\S+@\S+|https:\/\/\S+)$/.test(explicit) ? explicit : site?.startsWith("https://") ? site : null;
  return subject ? { publicKey, privateKey, subject } : null;
}

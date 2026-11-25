/**
 * Push subscriptions are only accepted on a known push service, in HTTPS (SSRF: the endpoint comes
 * from the browser, and the server POSTs to it). Sending also goes through safe-fetch, which refuses
 * non-public addresses whatever the DNS says.
 */
const EXACT = new Set(["web.push.apple.com", "fcm.googleapis.com", "updates.push.services.mozilla.com"]);
const SUFFIXES = [".push.apple.com", ".push.services.mozilla.com", ".notify.windows.com"];

export function isAllowedEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== "string" || endpoint.length > 1000) return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) return false;
  const host = url.hostname.toLowerCase();
  if (host.endsWith(".")) return false;
  return EXACT.has(host) || SUFFIXES.some((s) => host.endsWith(s) && host.length > s.length && /^[a-z0-9-]+$/.test(host.slice(0, -s.length).split(".").pop()!));
}

const B64URL = /^[A-Za-z0-9_-]+$/;

/** p256dh: an uncompressed P-256 point (65 bytes, 0x04…); auth: 16 bytes. */
export function areValidKeys(keys: unknown): keys is { p256dh: string; auth: string } {
  if (!keys || typeof keys !== "object") return false;
  const { p256dh, auth } = keys as Record<string, unknown>;
  if (typeof p256dh !== "string" || typeof auth !== "string" || !B64URL.test(p256dh.replace(/=+$/, "")) || !B64URL.test(auth.replace(/=+$/, ""))) return false;
  const p = Buffer.from(p256dh, "base64url");
  return p.length === 65 && p[0] === 4 && Buffer.from(auth, "base64url").length === 16;
}

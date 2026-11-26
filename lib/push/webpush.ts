/**
 * Web Push, written on node:crypto (no dependency):
 * - message encryption « aes128gcm » (RFC 8291 + RFC 8188): ECDH P-256 with the browser's key,
 *   HKDF-SHA-256 with its auth secret, AES-128-GCM, one record;
 * - VAPID (RFC 8292): an ES256 JWT for the push service's origin, signed with our private key.
 * Sent with safe-fetch (POST, never redirected) to an endpoint already checked by ./endpoint.ts.
 */
import { createCipheriv, createECDH, createHmac, createPrivateKey, randomBytes, sign } from "node:crypto";
import { safeFetch, type Resolver } from "@/lib/net/safe-fetch";
import { isAllowedEndpoint } from "./endpoint";

export type PushKeys = { p256dh: string; auth: string };
export type PushSubscriptionData = { endpoint: string; keys: PushKeys };
export type Vapid = { publicKey: string; privateKey: string; subject: string };

export const b64url = (b: Uint8Array) => Buffer.from(b).toString("base64url");
export const fromB64url = (s: string) => Buffer.from(s, "base64url");

function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Buffer {
  const prk = createHmac("sha256", salt).update(ikm).digest();
  return createHmac("sha256", prk).update(info).update(Buffer.from([1])).digest().subarray(0, length);
}

/**
 * The encrypted body: header (salt, record size, our public key) then one AES-128-GCM record.
 * `salt` and `serverKey` are injected by the RFC 8291 test vector only.
 */
export function encryptPayload(
  plaintext: Uint8Array,
  keys: PushKeys,
  opts: { salt?: Uint8Array; serverPrivateKey?: Uint8Array } = {},
): Buffer {
  const uaPublic = fromB64url(keys.p256dh);
  const authSecret = fromB64url(keys.auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error("p256dh invalide");
  if (authSecret.length !== 16) throw new Error("auth invalide");
  const ecdh = createECDH("prime256v1");
  if (opts.serverPrivateKey) ecdh.setPrivateKey(opts.serverPrivateKey);
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  const salt = opts.salt ?? randomBytes(16);

  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]);
  const ikm = hkdf(authSecret, shared, keyInfo, 32);
  const cek = hkdf(salt, ikm, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hkdf(salt, ikm, Buffer.from("Content-Encoding: nonce\0"), 12);

  // One record: the content, then the 0x02 delimiter of the last record (no padding).
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const record = Buffer.concat([cipher.update(Buffer.concat([plaintext, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, record]);
}

/**
 * A P-256 scalar as exactly 32 bytes. ecdh.getPrivateKey() drops leading zero bytes: about one key in 256 came out
 * with 31 bytes, was refused as a VAPID pair, and push stayed off with no explanation. Shorter values are padded on
 * the left (same number); anything longer than 32 bytes is not a P-256 key.
 */
export function scalar32(bytes: Buffer): Buffer | null {
  if (bytes.length > 32 || bytes.length < 16) return null;
  return bytes.length === 32 ? bytes : Buffer.concat([Buffer.alloc(32 - bytes.length), bytes]);
}

/** « vapid t=<jwt>, k=<public key> » for the endpoint's origin, valid 12 h. Signature: r ‖ s, 32 bytes each (P1363). */
export function vapidAuthorization(endpoint: string, vapid: Vapid, now = Date.now()): string {
  const aud = new URL(endpoint).origin;
  const header = b64url(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64url(Buffer.from(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: vapid.subject })));
  const pub = fromB64url(vapid.publicKey);
  const key = createPrivateKey({
    // JWK « d » must be exactly 32 bytes (a key stored before 3.4 may have 31).
    key: { kty: "EC", crv: "P-256", d: b64url(scalar32(fromB64url(vapid.privateKey)) ?? fromB64url(vapid.privateKey)), x: b64url(pub.subarray(1, 33)), y: b64url(pub.subarray(33, 65)) },
    format: "jwk",
  });
  const signature = sign("sha256", Buffer.from(`${header}.${claims}`), { key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${header}.${claims}.${b64url(signature)}, k=${vapid.publicKey}`;
}

/** A new VAPID key pair (scripts/vapid-keys.ts): uncompressed public point and private scalar, base64url. */
export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return vapidKeysFrom(ecdh.getPrivateKey());
}

/** The pair of a private scalar, always 65 + 32 bytes (also for a scalar starting with 0x00). */
export function vapidKeysFrom(privateKey: Buffer): { publicKey: string; privateKey: string } {
  const d = scalar32(privateKey);
  if (!d) throw new Error("not a P-256 private key");
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(d);
  return { publicKey: b64url(ecdh.getPublicKey()), privateKey: b64url(d) };
}

export type PushResult = "ok" | "gone" | "refused" | "failed";

/**
 * Sends one notification. « gone »: the subscription no longer exists (404, 410), to delete.
 * « refused »: the endpoint is not on a known push service (never sent).
 */
export async function sendPush(
  sub: PushSubscriptionData,
  payload: unknown,
  vapid: Vapid,
  opts: { ttl?: number; urgency?: "normal" | "high"; topic?: string; fetchImpl?: typeof fetch; resolve?: Resolver } = {},
): Promise<PushResult> {
  if (!isAllowedEndpoint(sub.endpoint)) return "refused";
  let body: Buffer;
  try {
    body = encryptPayload(Buffer.from(JSON.stringify(payload)), sub.keys);
  } catch {
    return "gone"; // keys unreadable: the subscription is useless
  }
  try {
    const res = await safeFetch(sub.endpoint, {
      method: "POST",
      body,
      headers: {
        Authorization: vapidAuthorization(sub.endpoint, vapid),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: String(opts.ttl ?? 24 * 3600),
        Urgency: opts.urgency ?? "high",
        ...(opts.topic ? { Topic: opts.topic } : {}),
      },
      timeoutMs: 15_000,
      fetchImpl: opts.fetchImpl,
      resolve: opts.resolve,
    });
    await res.body?.cancel().catch(() => {});
    if (res.status === 404 || res.status === 410) return "gone";
    return res.ok ? "ok" : "failed";
  } catch {
    return "failed";
  }
}

/**
 * Web Push (lib/push): encryption checked against the test vector of RFC 8291 (appendix A), VAPID
 * JWT verifiable with our public key, and the SSRF rules on subscription endpoints (known push
 * services only, HTTPS, public addresses).
 */
import { createDecipheriv, createECDH, createHmac, createPublicKey, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { areValidKeys, isAllowedEndpoint } from "@/lib/push/endpoint";
import { isVapidPair, vapidConfig } from "@/lib/push/config";
import { b64url, encryptPayload, fromB64url, generateVapidKeys, sendPush, vapidAuthorization, vapidKeysFrom } from "@/lib/push/webpush";

// RFC 8291, appendix A.
const RFC = {
  plaintext: "When I grow up, I want to be a watermelon",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  message:
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

/** What a browser does with the message: the reverse of encryptPayload. */
function decrypt(message: Buffer, uaPrivate: string, auth: string): string {
  const salt = message.subarray(0, 16);
  const idlen = message[20]!;
  const asPublic = message.subarray(21, 21 + idlen);
  const record = message.subarray(21 + idlen);
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(fromB64url(uaPrivate));
  const hk = (s: Buffer, ikm: Buffer, info: Buffer, n: number) => createHmac("sha256", createHmac("sha256", s).update(ikm).digest()).update(info).update(Buffer.from([1])).digest().subarray(0, n);
  const ikm = hk(fromB64url(auth), ecdh.computeSecret(asPublic), Buffer.concat([Buffer.from("WebPush: info\0"), ecdh.getPublicKey(), asPublic]), 32);
  const d = createDecipheriv("aes-128-gcm", hk(salt, ikm, Buffer.from("Content-Encoding: aes128gcm\0"), 16), hk(salt, ikm, Buffer.from("Content-Encoding: nonce\0"), 12));
  d.setAuthTag(record.subarray(-16));
  const plain = Buffer.concat([d.update(record.subarray(0, -16)), d.final()]);
  return plain.subarray(0, plain.lastIndexOf(2)).toString();
}

describe("aes128gcm encryption (RFC 8291)", () => {
  it("gives exactly the message of the RFC's test vector", () => {
    const out = encryptPayload(Buffer.from(RFC.plaintext), { p256dh: RFC.uaPublic, auth: RFC.auth }, { salt: fromB64url(RFC.salt), serverPrivateKey: fromB64url(RFC.asPrivate) });
    expect(b64url(out)).toBe(RFC.message);
  });

  it("a random salt and key each time, and the browser can read it", () => {
    const keys = { p256dh: RFC.uaPublic, auth: RFC.auth };
    const a = encryptPayload(Buffer.from("{\"title\":\"Critique · Produit 1.0\"}"), keys);
    const b = encryptPayload(Buffer.from("{\"title\":\"Critique · Produit 1.0\"}"), keys);
    expect(b64url(a)).not.toBe(b64url(b));
    expect(decrypt(a, RFC.uaPrivate, RFC.auth)).toBe("{\"title\":\"Critique · Produit 1.0\"}");
  });

  it("refuses keys of the wrong shape", () => {
    expect(() => encryptPayload(Buffer.from("x"), { p256dh: "AAAA", auth: RFC.auth })).toThrow("p256dh");
    expect(() => encryptPayload(Buffer.from("x"), { p256dh: RFC.uaPublic, auth: "AAAA" })).toThrow("auth");
    expect(areValidKeys({ p256dh: RFC.uaPublic, auth: RFC.auth })).toBe(true);
    expect(areValidKeys({ p256dh: RFC.uaPublic.slice(0, 40), auth: RFC.auth })).toBe(false);
    expect(areValidKeys({ p256dh: RFC.uaPublic, auth: "<script>" })).toBe(false);
    expect(areValidKeys(null)).toBe(false);
  });
});

describe("VAPID (RFC 8292)", () => {
  it("an ES256 JWT for the push service's origin, verifiable with our public key, 12 h", () => {
    const keys = generateVapidKeys();
    expect(fromB64url(keys.publicKey)).toHaveLength(65);
    expect(fromB64url(keys.privateKey)).toHaveLength(32);
    const now = Date.UTC(2026, 10, 25, 12);
    const auth = vapidAuthorization("https://web.push.apple.com/QGuQyavXutnMH7Ix", { ...keys, subject: "https://folders.example" }, now);
    const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(auth)!;
    expect(m[4]).toBe(keys.publicKey);
    expect(JSON.parse(fromB64url(m[1]!).toString())).toEqual({ typ: "JWT", alg: "ES256" });
    expect(JSON.parse(fromB64url(m[2]!).toString())).toEqual({ aud: "https://web.push.apple.com", exp: now / 1000 + 43_200, sub: "https://folders.example" });
    const pub = fromB64url(keys.publicKey);
    const key = createPublicKey({ key: { kty: "EC", crv: "P-256", x: b64url(pub.subarray(1, 33)), y: b64url(pub.subarray(33)) }, format: "jwk" });
    expect(verify("sha256", Buffer.from(`${m[1]}.${m[2]}`), { key, dsaEncoding: "ieee-p1363" }, fromB64url(m[3]!))).toBe(true);
  });
});

describe("VAPID keys with a leading zero byte (one key in 256)", () => {
  /** A valid P-256 scalar whose first byte is 0x00: getPrivateKey() returns it with 31 bytes. */
  const ZERO_LED = Buffer.concat([Buffer.from([0x00]), Buffer.alloc(31, 0x5a)]);

  it("Node drops the leading zero (the cause), our pair keeps 32 bytes and is accepted", () => {
    const ecdh = createECDH("prime256v1");
    ecdh.setPrivateKey(ZERO_LED);
    expect(ecdh.getPrivateKey()).toHaveLength(31);
    const keys = vapidKeysFrom(ecdh.getPrivateKey());
    expect(fromB64url(keys.privateKey)).toHaveLength(32);
    expect(fromB64url(keys.privateKey)).toEqual(ZERO_LED);
    expect(isVapidPair(keys.publicKey, keys.privateKey)).toBe(true);
  });

  it("a 31-byte key stored before 3.4 is accepted (padded), signs, and the JWT verifies", () => {
    const keys = vapidKeysFrom(ZERO_LED);
    const legacy = fromB64url(keys.privateKey).subarray(1).toString("base64url");
    expect(fromB64url(legacy)).toHaveLength(31);
    const vapid = vapidConfig({ VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: legacy, VAPID_SUBJECT: "mailto:a@b.example" });
    expect(vapid).toMatchObject({ privateKey: keys.privateKey });
    for (const v of [vapid!, { ...vapid!, privateKey: legacy }]) {
      const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=/.exec(vapidAuthorization("https://web.push.apple.com/x", v))!;
      const pub = fromB64url(keys.publicKey);
      const key = createPublicKey({ key: { kty: "EC", crv: "P-256", x: b64url(pub.subarray(1, 33)), y: b64url(pub.subarray(33)) }, format: "jwk" });
      expect(verify("sha256", Buffer.from(`${m[1]}.${m[2]}`), { key, dsaEncoding: "ieee-p1363" }, fromB64url(m[3]!))).toBe(true);
    }
  });

  it("the signature is always r ‖ s on 64 bytes (r or s starting with 0x00 stays padded)", () => {
    const vapid = { ...vapidKeysFrom(ZERO_LED), subject: "mailto:a@b.example" };
    for (let i = 0; i < 300; i++) {
      const sig = /\.([\w-]+), k=/.exec(vapidAuthorization("https://web.push.apple.com/x", vapid, Date.UTC(2026, 0, 1) + i * 1000))![1]!;
      expect(fromB64url(sig)).toHaveLength(64);
    }
  });

  it("refuses a private key that does not go with the public key, or is not a P-256 scalar", () => {
    const a = vapidKeysFrom(ZERO_LED);
    const b = generateVapidKeys();
    expect(isVapidPair(a.publicKey, b.privateKey)).toBe(false);
    expect(isVapidPair(a.publicKey, Buffer.alloc(33, 1).toString("base64url"))).toBe(false);
    expect(isVapidPair(a.publicKey, "short")).toBe(false);
  });
});

describe("endpoints (SSRF)", () => {
  it("known push services in HTTPS only", () => {
    for (const ok of [
      "https://web.push.apple.com/QGuQyavXutnMH7IxOYOVGiTm",
      "https://fcm.googleapis.com/fcm/send/dpH5lCsTSSM:APA91b",
      "https://updates.push.services.mozilla.com/wpush/v2/gAAAA",
      "https://wns2-par02p.notify.windows.com/w/?token=BQYAAA",
    ]) {
      expect(isAllowedEndpoint(ok), ok).toBe(true);
    }
  });

  it("refuses internal addresses, other domains, look-alikes, http, ports and credentials", () => {
    for (const bad of [
      "https://127.0.0.1/push",
      "https://192.168.1.20:3000/api",
      "https://[::1]/x",
      "https://169.254.169.254/latest/meta-data",
      "https://localhost/x",
      "https://evil.example.com/push",
      "https://web.push.apple.com.evil.example/x",
      "https://fcm.googleapis.com.evil.example/x",
      "https://evilnotify.windows.com/x",
      "https://.notify.windows.com/x",
      "http://web.push.apple.com/x",
      "https://web.push.apple.com:8443/x",
      "https://user:pass@web.push.apple.com/x",
      "https://web.push.apple.com./x",
      "javascript:alert(1)",
      `https://web.push.apple.com/${"a".repeat(1000)}`,
      42,
    ]) {
      expect(isAllowedEndpoint(bad), String(bad).slice(0, 60)).toBe(false);
    }
  });

  it("sendPush: never sends to a refused endpoint; a known host resolving to an internal IP is blocked by safe-fetch", async () => {
    const sent: string[] = [];
    const fetchImpl = (async (u: string | URL) => {
      sent.push(String(u));
      return new Response(null, { status: 201 });
    }) as typeof fetch;
    const vapid = { ...generateVapidKeys(), subject: "https://folders.example" };
    const keys = { p256dh: RFC.uaPublic, auth: RFC.auth };
    expect(await sendPush({ endpoint: "https://127.0.0.1/x", keys }, { t: 1 }, vapid, { fetchImpl })).toBe("refused");
    expect(await sendPush({ endpoint: "https://web.push.apple.com/x", keys }, { t: 1 }, vapid, { fetchImpl, resolve: async () => [{ address: "10.0.0.5", family: 4 }] })).toBe("failed");
    expect(sent).toEqual([]);
    const pub = async () => [{ address: "17.188.1.1", family: 4 }];
    expect(await sendPush({ endpoint: "https://web.push.apple.com/x", keys }, { t: 1 }, vapid, { fetchImpl, resolve: pub })).toBe("ok");
    const gone = (async () => new Response(null, { status: 410 })) as typeof fetch;
    expect(await sendPush({ endpoint: "https://web.push.apple.com/x", keys }, { t: 1 }, vapid, { fetchImpl: gone, resolve: pub })).toBe("gone");
  });
});

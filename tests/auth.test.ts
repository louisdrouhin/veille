/**
 * The real Better Auth configuration (lib/auth.ts createAuth) on PGlite, driven
 * through its HTTP handler: login rate limiting and two-factor authentication.
 */
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { base32 } from "@better-auth/utils/base32";
import { createOTP } from "@better-auth/utils/otp";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { describe, expect, it } from "vitest";
import { createAuth, parseTrustedProxies } from "@/lib/auth";
import type { Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { createUser, resetPassword } from "@/lib/users";

const BASE = "http://localhost:3000";
const EMAIL = "moi@example.com";
const PASSWORD = "un mot de passe long";

let db: Db;
// Better Auth's in-memory rate-limit store is shared by every instance of the
// process: each test uses its own client IPs so that they do not interfere.
let ipSeq = 0;
const nextIp = () => `198.51.100.${++ipSeq}`;

async function setup(trustedProxies?: string) {
  const pg = drizzle(new PGlite(), { schema });
  await migrate(pg, { migrationsFolder: path.join(import.meta.dirname, "..", "drizzle") });
  db = pg as unknown as Db;
  await createUser(db, { email: EMAIL, password: PASSWORD });
  return createAuth(db, { baseURL: BASE, secret: "test-secret-test-secret-test-secret-123", trustedProxies });
}

type Auth = Awaited<ReturnType<typeof setup>>;

/** Minimal browser: keeps cookies between requests. */
function client(auth: Auth, headers: Record<string, string> = {}) {
  const jar = new Map<string, string>();
  return {
    jar,
    async post(p: string, body: unknown, extra: Record<string, string> = {}) {
      const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
      const res = await auth.handler(
        new Request(`${BASE}/api/auth${p}`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: BASE, ...headers, ...extra, ...(cookie ? { cookie } : {}) },
          body: JSON.stringify(body),
        }),
      );
      for (const c of res.headers.getSetCookie()) {
        const [pair] = c.split(";");
        const i = pair!.indexOf("=");
        const name = pair!.slice(0, i);
        const value = pair!.slice(i + 1);
        if (value === "" || /max-age=0/i.test(c)) jar.delete(name);
        else jar.set(name, value);
      }
      return { status: res.status, data: (await res.json().catch(() => null)) as Record<string, unknown> | null };
    },
    hasSession: () => [...jar.keys()].some((k) => k.endsWith("session_token")),
  };
}

const signIn = (c: ReturnType<typeof client>, password = PASSWORD) => c.post("/sign-in/email", { email: EMAIL, password });

async function totpFor(totpURI: string, offsetPeriods = 0) {
  const secret = new TextDecoder().decode(base32.decode(new URL(totpURI).searchParams.get("secret")!));
  // generateTOTP has no clock parameter: shift by computing the HOTP counter ourselves.
  if (offsetPeriods === 0) return createOTP(secret).totp();
  const counter = Math.floor(Date.now() / 30_000) + offsetPeriods;
  return createOTP(secret).hotp(counter);
}

describe("login rate limiting", () => {
  it("blocks the 4th sign-in attempt within 10 s from the same client", async () => {
    const auth = await setup();
    const c = client(auth, { "x-forwarded-for": nextIp() });
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await signIn(c, "mauvais mot de passe")).status);
    expect(statuses).toEqual([401, 401, 401, 429]);
  });

  it("does not trust X-Real-IP: a client cannot get a fresh counter by forging it", async () => {
    const auth = await setup();
    // What a reverse proxy that appends to X-Forwarded-For forwards for a client forging both headers.
    const realIp = nextIp();
    const statuses = [];
    for (let i = 0; i < 4; i++) {
      const c = client(auth, { "x-forwarded-for": `203.0.113.${i}, ${realIp}`, "x-real-ip": `203.0.113.${100 + i}` });
      statuses.push((await signIn(c, "mauvais mot de passe")).status);
    }
    expect(statuses.at(-1)).toBe(429);
  });

  it("with TRUSTED_PROXIES, limits by the client IP appended by the proxy, not by the forged one", async () => {
    const auth = await setup("10.0.0.0/8");
    const realIp = nextIp();
    const statuses = [];
    for (let i = 0; i < 4; i++) {
      const c = client(auth, { "x-forwarded-for": `203.0.113.${i}, ${realIp}` });
      statuses.push((await signIn(c, "mauvais mot de passe")).status);
    }
    expect(statuses).toEqual([401, 401, 401, 429]);
    // Another real client is not affected.
    expect((await signIn(client(auth, { "x-forwarded-for": `203.0.113.1, ${nextIp()}` }))).status).toBe(200);
  });

  it("parses TRUSTED_PROXIES", () => {
    expect(parseTrustedProxies(undefined)).toEqual([]);
    expect(parseTrustedProxies(" 192.168.1.10, 10.0.0.0/8 ,")).toEqual(["192.168.1.10", "10.0.0.0/8"]);
  });
});

describe("two-factor authentication (TOTP)", () => {
  async function enableTwoFactor(auth: Auth) {
    const c = client(auth, { "x-forwarded-for": nextIp() });
    expect((await signIn(c)).status).toBe(200);
    const enabled = await c.post("/two-factor/enable", { password: PASSWORD, issuer: "Folders" });
    expect(enabled.status).toBe(200);
    const totpURI = enabled.data!.totpURI as string;
    const backupCodes = enabled.data!.backupCodes as string[];
    expect(totpURI).toMatch(/^otpauth:\/\/totp\/Folders:/);
    expect(backupCodes.length).toBeGreaterThanOrEqual(10);
    // Not active until a first code is verified.
    let [u] = await db.select().from(schema.user).where(eq(schema.user.email, EMAIL));
    expect(u!.twoFactorEnabled).toBe(false);
    expect((await c.post("/two-factor/verify-totp", { code: await totpFor(totpURI) })).status).toBe(200);
    [u] = await db.select().from(schema.user).where(eq(schema.user.email, EMAIL));
    expect(u!.twoFactorEnabled).toBe(true);
    return { totpURI, backupCodes };
  }

  it("requires the password to enable it", async () => {
    const auth = await setup();
    const c = client(auth, { "x-forwarded-for": nextIp() });
    await signIn(c);
    expect((await c.post("/two-factor/enable", { password: "pas le bon mot de passe" })).status).toBe(400);
  });

  it("after enabling, the password alone opens no session; the TOTP code does", async () => {
    const auth = await setup();
    const { totpURI } = await enableTwoFactor(auth);

    const c = client(auth, { "x-forwarded-for": nextIp() });
    const first = await signIn(c);
    expect(first.status).toBe(200);
    expect(first.data).toMatchObject({ twoFactorRedirect: true });
    expect(c.hasSession()).toBe(false);

    const good = await totpFor(totpURI);
    const wrong = String((Number(good) + 1) % 1_000_000).padStart(6, "0");
    expect((await c.post("/two-factor/verify-totp", { code: wrong })).status).toBe(401);
    expect(c.hasSession()).toBe(false);

    expect((await c.post("/two-factor/verify-totp", { code: await totpFor(totpURI) })).status).toBe(200);
    expect(c.hasSession()).toBe(true);
  });

  it("rejects a code from another time window", async () => {
    const auth = await setup();
    const { totpURI } = await enableTwoFactor(auth);
    const c = client(auth, { "x-forwarded-for": nextIp() });
    await signIn(c);
    expect((await c.post("/two-factor/verify-totp", { code: await totpFor(totpURI, 4) })).status).toBe(401);
  });

  it("the second step cannot be attempted without the password step", async () => {
    const auth = await setup();
    const { totpURI } = await enableTwoFactor(auth);
    const c = client(auth, { "x-forwarded-for": nextIp() });
    const res = await c.post("/two-factor/verify-totp", { code: await totpFor(totpURI) });
    expect(res.status).toBe(401);
    expect(c.hasSession()).toBe(false);
  });

  it("accepts each backup code once", async () => {
    const auth = await setup();
    const { backupCodes } = await enableTwoFactor(auth);
    const c = client(auth, { "x-forwarded-for": nextIp() });
    await signIn(c);
    expect((await c.post("/two-factor/verify-backup-code", { code: backupCodes[0] })).status).toBe(200);
    expect(c.hasSession()).toBe(true);

    const again = client(auth, { "x-forwarded-for": nextIp() });
    await signIn(again);
    expect((await again.post("/two-factor/verify-backup-code", { code: backupCodes[0] })).status).toBe(401);
  });

  it("rate-limits the second step (3 attempts / 10 s)", async () => {
    const auth = await setup();
    await enableTwoFactor(auth);
    const c = client(auth, { "x-forwarded-for": nextIp() });
    await signIn(c);
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await c.post("/two-factor/verify-totp", { code: "123456" })).status);
    expect(statuses.at(-1)).toBe(429);
  });

  it("reset-password --disable-2fa turns it off (authenticator and backup codes lost)", async () => {
    const auth = await setup();
    await enableTwoFactor(auth);
    const res = await resetPassword(db, { email: EMAIL, password: PASSWORD, disableTwoFactor: true });
    expect(res.twoFactorDisabled).toBe(true);
    expect(await db.select().from(schema.twoFactor)).toHaveLength(0);

    const c = client(auth, { "x-forwarded-for": nextIp() });
    const signedIn = await signIn(c);
    expect(signedIn.status).toBe(200);
    expect(signedIn.data).not.toHaveProperty("twoFactorRedirect");
    expect(c.hasSession()).toBe(true);
  });

  it("reset-password without --disable-2fa keeps it", async () => {
    const auth = await setup();
    await enableTwoFactor(auth);
    await resetPassword(db, { email: EMAIL, password: PASSWORD });
    const c = client(auth, { "x-forwarded-for": nextIp() });
    expect((await signIn(c)).data).toMatchObject({ twoFactorRedirect: true });
    expect(c.hasSession()).toBe(false);
  });

  it("the account page flow can disable it with the password", async () => {
    const auth = await setup();
    const { totpURI } = await enableTwoFactor(auth);
    const c = client(auth, { "x-forwarded-for": nextIp() });
    await signIn(c);
    await c.post("/two-factor/verify-totp", { code: await totpFor(totpURI) });
    expect(c.hasSession()).toBe(true);
    expect((await c.post("/two-factor/disable", { password: "pas le bon mot de passe" })).status).toBe(400);
    expect((await c.post("/two-factor/disable", { password: PASSWORD })).status).toBe(200);
    const [u] = await db.select().from(schema.user).where(eq(schema.user.email, EMAIL));
    expect(u!.twoFactorEnabled).toBe(false);
  });

  it("stores the TOTP secret encrypted", async () => {
    const auth = await setup();
    const { totpURI } = await enableTwoFactor(auth);
    const plain = new TextDecoder().decode(base32.decode(new URL(totpURI).searchParams.get("secret")!));
    const [row] = await db.select().from(schema.twoFactor);
    expect(row!.secret).not.toContain(plain);
  });
});

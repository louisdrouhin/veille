import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { twoFactor } from "better-auth/plugins";
import { getDb, schema, type Db } from "@/lib/db";

export type AuthEnv = { baseURL?: string; secret?: string; trustedProxies?: string };

/** Comma-separated CIDRs / IPs of the reverse proxies in front of the app (TRUSTED_PROXIES). */
export function parseTrustedProxies(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Builds the Better Auth instance. Exported for the tests, which run it on
 * PGlite with exactly the production options.
 */
export function createAuth(db: Db, env: AuthEnv) {
  const trustedProxies = parseTrustedProxies(env.trustedProxies);
  return betterAuth({
    appName: "Folders",
    baseURL: env.baseURL,
    secret: env.secret,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
        twoFactor: schema.twoFactor,
      },
    }),
    emailAndPassword: {
      enabled: true,
      // Single-user app: the account is created by /setup or `npm run create-user`.
      disableSignUp: true,
      minPasswordLength: 12,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    // In-memory store (single app instance). On top of this global rule, Better Auth
    // applies 3 requests / 10 s per IP on /sign-in/* and /two-factor/*.
    rateLimit: { enabled: true, window: 60, max: 30 },
    advanced: {
      // Behind a reverse proxy that terminates HTTPS.
      useSecureCookies: env.baseURL?.startsWith("https://") ?? false,
      ipAddress: {
        // Only X-Forwarded-For: X-Real-IP is passed through untouched by proxies that do
        // not set it, so a client could pick a new value per request and dodge the limit.
        ipAddressHeaders: ["x-forwarded-for"],
        // With trusted proxies, the client IP is the rightmost untrusted entry, which the
        // proxy appended itself; without, a multi-entry header falls into one shared bucket.
        ...(trustedProxies.length > 0 ? { trustedProxies } : {}),
      },
    },
    plugins: [
      twoFactor({
        issuer: "Folders",
        // Login with 2FA: the second step must happen within 10 minutes.
        twoFactorCookieMaxAge: 10 * 60,
      }),
      nextCookies(),
    ],
  });
}

type Auth = ReturnType<typeof createAuth>;
let instance: Auth | undefined;

/** Lazily created: the DB connection is only needed at request time, not at build time. */
export function getAuth(): Auth {
  instance ??= createAuth(getDb(), {
    baseURL: process.env.BETTER_AUTH_URL,
    secret: process.env.BETTER_AUTH_SECRET,
    trustedProxies: process.env.TRUSTED_PROXIES,
  });
  return instance;
}

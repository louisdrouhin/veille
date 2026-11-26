/**
 * Paramètres › Intégrations: every change asks again for the password, or the 2FA code when it is on,
 * and is then allowed for 10 minutes in this session only (Sécurité and Intégrations). In memory (single app instance, like the
 * other limits): a restart asks again. Attempts are limited (5 per 10 min) against guessing.
 */
import { symmetricDecrypt, verifyPassword } from "better-auth/crypto";
import { base32 } from "@better-auth/utils/base32";
import { createOTP } from "@better-auth/utils/otp";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { account, twoFactor, user } from "@/lib/db/schema";

export const RECONFIRM_MS = 10 * 60_000;
export const ATTEMPTS = { windowMs: 10 * 60_000, max: 5 } as const;

const grants = new Map<string, number>();
const attempts = new Map<string, number[]>();

/** Until when changes are allowed in this session (null: ask again). */
export function grantUntil(sessionId: string, now = Date.now()): number | null {
  const until = grants.get(sessionId);
  if (until === undefined) return null;
  if (until <= now) {
    grants.delete(sessionId);
    return null;
  }
  return until;
}

export function grant(sessionId: string, now = Date.now()): number {
  const until = now + RECONFIRM_MS;
  grants.set(sessionId, until);
  return until;
}

export function revoke(sessionId: string) {
  grants.delete(sessionId);
}

/** Records an attempt if allowed; otherwise how long to wait (seconds). */
export function takeAttempt(userId: string, now = Date.now()): { ok: true } | { ok: false; retryAfterSec: number } {
  const recent = (attempts.get(userId) ?? []).filter((t) => now - t < ATTEMPTS.windowMs);
  if (recent.length >= ATTEMPTS.max) {
    attempts.set(userId, recent);
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((recent[0]! + ATTEMPTS.windowMs - now) / 1000)) };
  }
  recent.push(now);
  attempts.set(userId, recent);
  return { ok: true };
}

/** A successful confirmation forgets the failed attempts. */
export function clearAttempts(userId: string) {
  attempts.delete(userId);
}

/** Test helper. */
export function resetReconfirm() {
  grants.clear();
  attempts.clear();
}

/** The proof that is asked: the 2FA code when it is on, else the password. */
export async function proofKind(db: Db, userId: string): Promise<"code" | "password"> {
  const [u] = await db.select({ on: user.twoFactorEnabled }).from(user).where(eq(user.id, userId));
  return u?.on ? "code" : "password";
}

export async function checkPassword(db: Db, userId: string, password: string): Promise<boolean> {
  if (!password || password.length > 256) return false;
  const [row] = await db
    .select({ hash: account.password })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, "credential")));
  if (!row?.hash) return false;
  try {
    return await verifyPassword({ hash: row.hash, password });
  } catch {
    return false;
  }
}

/** The TOTP code of the authenticator app (secret encrypted by Better Auth with BETTER_AUTH_SECRET). */
export async function checkTotp(db: Db, userId: string, code: string, authSecret: string | undefined): Promise<boolean> {
  if (!/^\d{6}$/.test(code) || !authSecret) return false;
  const [row] = await db.select({ secret: twoFactor.secret }).from(twoFactor).where(eq(twoFactor.userId, userId));
  if (!row) return false;
  try {
    const stored = await symmetricDecrypt({ key: authSecret, data: row.secret });
    // Same reading as Better Auth (two-factor/totp): « base32:… » for an imported secret.
    const secret = stored.startsWith("base32:") ? base32.decode(stored.slice(7).toUpperCase()) : stored;
    return await createOTP(secret, { period: 30, digits: 6 }).verify(code);
  } catch {
    return false;
  }
}

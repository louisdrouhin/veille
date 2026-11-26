/**
 * Account management outside Better Auth's HTTP API (sign-up stays disabled):
 * first-run setup, `create-user` and `reset-password` scripts.
 * Rows follow Better Auth's schema (user + "credential" account) and the
 * password uses Better Auth's own default hash, so sign-in works unchanged.
 */
import { splitIdentifier } from "@/lib/profile";
import { randomBytes } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { account, session, twoFactor, user } from "@/lib/db/schema";

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;

/** Arbitrary constant key of the advisory lock serializing first-run setups ("veille"). */
const SETUP_LOCK_KEY = 0x7665696c6c65;

export class AlreadySetupError extends Error {
  constructor() {
    super("Un compte existe déjà : l'assistant de premier lancement est désactivé.");
    this.name = "AlreadySetupError";
  }
}
export class UserExistsError extends Error {}
export class UserNotFoundError extends Error {}

const newId = () => randomBytes(24).toString("base64url");

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Returns an error message, or null when the credentials are acceptable. */
export function validateCredentials(email: string, password: string): string | null {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Adresse email invalide.";
  if (password.length < MIN_PASSWORD_LENGTH) return `Le mot de passe doit faire au moins ${MIN_PASSWORD_LENGTH} caractères.`;
  if (password.length > MAX_PASSWORD_LENGTH) return `Le mot de passe doit faire au plus ${MAX_PASSWORD_LENGTH} caractères.`;
  return null;
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

async function insertUser(tx: Tx | Db, email: string, passwordHash: string, name?: string) {
  const id = newId();
  const now = new Date();
  const identifier = name?.trim() || email.split("@")[0] || "Moi";
  await tx.insert(user).values({
    id,
    email,
    name: identifier,
    // Prénom / Nom from the identifier, as migration 0017 did for existing accounts (lib/profile.ts).
    ...splitIdentifier(identifier),
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
  await tx.insert(account).values({
    id: newId(),
    accountId: id,
    providerId: "credential",
    userId: id,
    password: passwordHash,
    createdAt: now,
    updatedAt: now,
  });
  return { id, email };
}

// Once a user exists it can only disappear through manual SQL: cache the positive answer.
let setupDone = false;

/** True as soon as one account exists (then the setup wizard is gone for good). */
export async function hasAnyUser(db: Db): Promise<boolean> {
  if (setupDone) return true;
  const rows = await db.select({ id: user.id }).from(user).limit(1);
  setupDone = rows.length > 0;
  return setupDone;
}

/** Test helper: forget the cached answer. */
export function resetSetupCache() {
  setupDone = false;
}

/**
 * First-run setup: creates the very first account. Runs in a transaction that
 * holds an advisory lock, so concurrent setups are serialized and only one can
 * succeed; the others get AlreadySetupError.
 */
export async function createFirstUser(db: Db, input: { email: string; password: string; name?: string }) {
  const email = normalizeEmail(input.email);
  const invalid = validateCredentials(email, input.password);
  if (invalid) throw new Error(invalid);
  const passwordHash = await hashPassword(input.password); // outside the lock: hashing is slow on purpose

  const created = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${SETUP_LOCK_KEY})`);
    const [existing] = await tx.select({ id: user.id }).from(user).limit(1);
    if (existing) throw new AlreadySetupError();
    return insertUser(tx, email, passwordHash, input.name);
  });
  setupDone = true;
  return created;
}

/** `npm run create-user`: adds an account (fails if the email is taken). */
export async function createUser(db: Db, input: { email: string; password: string; name?: string }) {
  const email = normalizeEmail(input.email);
  const invalid = validateCredentials(email, input.password);
  if (invalid) throw new Error(invalid);
  const passwordHash = await hashPassword(input.password);
  return db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: user.id }).from(user).where(eq(user.email, email));
    if (existing) throw new UserExistsError(`Un compte existe déjà pour ${email}.`);
    return insertUser(tx, email, passwordHash, input.name);
  });
}

/**
 * `npm run reset-password`: sets a new password and revokes every session of the account.
 * With `disableTwoFactor` (authenticator and backup codes lost), also removes the TOTP secret.
 */
export async function resetPassword(db: Db, input: { email: string; password: string; disableTwoFactor?: boolean }) {
  const email = normalizeEmail(input.email);
  const invalid = validateCredentials(email, input.password);
  if (invalid) throw new Error(invalid);
  const passwordHash = await hashPassword(input.password);
  return db.transaction(async (tx) => {
    const [found] = await tx.select({ id: user.id }).from(user).where(eq(user.email, email));
    if (!found) throw new UserNotFoundError(`Aucun compte pour ${email}.`);
    const now = new Date();
    const updated = await tx
      .update(account)
      .set({ password: passwordHash, updatedAt: now })
      .where(and(eq(account.userId, found.id), eq(account.providerId, "credential")))
      .returning({ id: account.id });
    if (updated.length === 0) {
      await tx.insert(account).values({
        id: newId(),
        accountId: found.id,
        providerId: "credential",
        userId: found.id,
        password: passwordHash,
        createdAt: now,
        updatedAt: now,
      });
    }
    if (input.disableTwoFactor) {
      await tx.delete(twoFactor).where(eq(twoFactor.userId, found.id));
      await tx.update(user).set({ twoFactorEnabled: false, updatedAt: now }).where(eq(user.id, found.id));
    }
    const revoked = await tx.delete(session).where(eq(session.userId, found.id)).returning({ id: session.id });
    return { email, revokedSessions: revoked.length, twoFactorDisabled: Boolean(input.disableTwoFactor) };
  });
}

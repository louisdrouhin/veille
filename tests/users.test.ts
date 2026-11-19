import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import {
  AlreadySetupError,
  createFirstUser,
  createUser,
  hasAnyUser,
  resetPassword,
  resetSetupCache,
  UserExistsError,
  UserNotFoundError,
} from "@/lib/users";

let db: Db;
let auth: ReturnType<typeof makeAuth>;

function makeAuth(database: Db) {
  // Same options as lib/auth.ts that matter for credentials.
  return betterAuth({
    baseURL: "http://localhost:3000",
    secret: "test-secret-test-secret-test-secret-123",
    database: drizzleAdapter(database, {
      provider: "pg",
      schema: { user: schema.user, session: schema.session, account: schema.account, verification: schema.verification },
    }),
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 12 },
    rateLimit: { enabled: false },
  });
}

const signIn = (email: string, password: string) =>
  auth.api.signInEmail({ body: { email, password } }).then(
    (r) => ({ ok: true as const, token: r.token }),
    () => ({ ok: false as const }),
  );

beforeEach(async () => {
  const pg = drizzle(new PGlite(), { schema });
  await migrate(pg, { migrationsFolder: path.join(import.meta.dirname, "..", "drizzle") });
  db = pg as unknown as Db;
  auth = makeAuth(db);
  resetSetupCache();
});

describe("first-run setup", () => {
  it("hasAnyUser flips once the first account exists", async () => {
    expect(await hasAnyUser(db)).toBe(false);
    await createFirstUser(db, { email: "Moi@Example.com ", password: "un mot de passe long" });
    expect(await hasAnyUser(db)).toBe(true);
  });

  it("the created account signs in through Better Auth (sign-up stays disabled)", async () => {
    await createFirstUser(db, { email: "moi@example.com", password: "un mot de passe long" });
    expect((await signIn("moi@example.com", "un mot de passe long")).ok).toBe(true);
    expect((await signIn("moi@example.com", "mauvais mot de passe")).ok).toBe(false);
    await expect(
      auth.api.signUpEmail({ body: { email: "intrus@example.com", password: "un mot de passe long", name: "x" } }),
    ).rejects.toThrow();
  });

  it("refuses a second setup", async () => {
    await createFirstUser(db, { email: "moi@example.com", password: "un mot de passe long" });
    resetSetupCache(); // even without the in-memory cache, the database check refuses
    await expect(createFirstUser(db, { email: "autre@example.com", password: "un autre mot de passe" })).rejects.toBeInstanceOf(
      AlreadySetupError,
    );
    expect(await db.select().from(schema.user)).toHaveLength(1);
  });

  it.each([
    ["short password", "moi@example.com", "court"],
    ["invalid email", "pas-un-email", "un mot de passe long"],
    ["too long password", "moi@example.com", "x".repeat(129)],
  ])("rejects %s", async (_label, email, password) => {
    await expect(createFirstUser(db, { email, password })).rejects.toThrow();
    expect(await hasAnyUser(db)).toBe(false);
  });
});

describe("create-user / reset-password", () => {
  it("create-user refuses an existing email", async () => {
    await createUser(db, { email: "moi@example.com", password: "un mot de passe long" });
    await expect(createUser(db, { email: "MOI@example.com", password: "un autre mot de passe" })).rejects.toBeInstanceOf(UserExistsError);
  });

  it("reset-password changes the password and revokes every session", async () => {
    await createFirstUser(db, { email: "moi@example.com", password: "ancien mot de passe" });
    const first = await signIn("moi@example.com", "ancien mot de passe");
    expect(first.ok).toBe(true);
    expect(await db.select().from(schema.session)).toHaveLength(1);

    const res = await resetPassword(db, { email: "moi@example.com", password: "nouveau mot de passe" });
    expect(res.revokedSessions).toBe(1);
    expect(await db.select().from(schema.session)).toHaveLength(0);
    expect((await signIn("moi@example.com", "ancien mot de passe")).ok).toBe(false);
    expect((await signIn("moi@example.com", "nouveau mot de passe")).ok).toBe(true);
  });

  it("reset-password fails for an unknown email and validates the new password", async () => {
    await expect(resetPassword(db, { email: "nobody@example.com", password: "un mot de passe long" })).rejects.toBeInstanceOf(
      UserNotFoundError,
    );
    await createFirstUser(db, { email: "moi@example.com", password: "un mot de passe long" });
    await expect(resetPassword(db, { email: "moi@example.com", password: "court" })).rejects.toThrow(/12 caractères/);
  });
});

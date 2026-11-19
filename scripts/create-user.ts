/**
 * Creates (or resets the password of) the single user account.
 *
 *   npm run create-user -- --email me@example.com --password 'a long password' [--name Moi]
 *
 * Sign-up is disabled in Better Auth, so the account is written through
 * Better Auth's internal adapter (same password hashing as sign-in).
 */
import { parseArgs } from "node:util";
import { getAuth } from "@/lib/auth";
import { closeDb } from "@/lib/db";

async function main() {
  const { values } = parseArgs({
    options: {
      email: { type: "string" },
      password: { type: "string" },
      name: { type: "string" },
    },
  });
  const email = values.email?.trim().toLowerCase();
  const password = values.password;
  if (!email || !password) {
    console.error("Usage: npm run create-user -- --email <email> --password <password> [--name <name>]");
    process.exit(1);
  }
  if (password.length < 12) {
    console.error("Le mot de passe doit faire au moins 12 caractères.");
    process.exit(1);
  }

  const ctx = await getAuth().$context;
  const hash = await ctx.password.hash(password);
  const existing = await ctx.internalAdapter.findUserByEmail(email, { includeAccounts: true });

  if (existing) {
    const credential = existing.accounts.find((a) => a.providerId === "credential");
    if (credential) {
      await ctx.internalAdapter.updatePassword(existing.user.id, hash);
    } else {
      await ctx.internalAdapter.linkAccount({
        userId: existing.user.id,
        providerId: "credential",
        accountId: existing.user.id,
        password: hash,
      });
    }
    console.log(`Mot de passe mis à jour pour ${email}.`);
    return;
  }

  const user = await ctx.internalAdapter.createUser({
    email,
    name: values.name?.trim() || email.split("@")[0] || "Moi",
    emailVerified: true,
  }, { method: "admin" });
  await ctx.internalAdapter.linkAccount({
    userId: user.id,
    providerId: "credential",
    accountId: user.id,
    password: hash,
  });
  console.log(`Compte créé : ${email}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());

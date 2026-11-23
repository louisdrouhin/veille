/**
 * Account recovery: sets a new password and signs out every session of the account.
 * --disable-2fa also turns two-factor authentication off (authenticator and backup codes lost).
 *
 *   npm run reset-password -- --email me@example.com --password 'a new long password' [--disable-2fa]
 *   docker compose exec app node dist/reset-password.js --email … --password … [--disable-2fa]
 */
import { parseArgs } from "node:util";
import { closeDb, getDb } from "@/lib/db";
import { resetPassword, UserNotFoundError } from "@/lib/users";

const { values } = parseArgs({
  options: { email: { type: "string" }, password: { type: "string" }, "disable-2fa": { type: "boolean" } },
});

if (!values.email || !values.password) {
  console.error("Usage : npm run reset-password -- --email <email> --password <nouveau mot de passe> [--disable-2fa]");
  process.exit(1);
}

try {
  const res = await resetPassword(getDb(), {
    email: values.email,
    password: values.password,
    disableTwoFactor: values["disable-2fa"] === true,
  });
  console.log(
    `Mot de passe changé pour ${res.email} (${res.revokedSessions} session(s) fermée(s))` +
      (res.twoFactorDisabled ? ", double authentification désactivée." : "."),
  );
} catch (err) {
  console.error(err instanceof UserNotFoundError || err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await closeDb();
}

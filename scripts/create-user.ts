/**
 * Creates an account (alternative to the /setup wizard, e.g. for scripted installs).
 *
 *   npm run create-user -- --email me@example.com --password 'a long password' [--name Moi]
 *   docker compose exec app node dist/create-user.js --email … --password …
 *
 * Fails if the email already exists: use reset-password to change a password.
 */
import { parseArgs } from "node:util";
import { closeDb, getDb } from "@/lib/db";
import { createUser, UserExistsError } from "@/lib/users";

const { values } = parseArgs({
  options: { email: { type: "string" }, password: { type: "string" }, name: { type: "string" } },
});

if (!values.email || !values.password) {
  console.error("Usage : npm run create-user -- --email <email> --password <mot de passe> [--name <nom>]");
  process.exit(1);
}

try {
  const created = await createUser(getDb(), { email: values.email, password: values.password, name: values.name });
  console.log(`Compte créé : ${created.email}`);
} catch (err) {
  if (err instanceof UserExistsError) console.error(`${err.message} Utilise reset-password pour changer son mot de passe.`);
  else console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await closeDb();
}

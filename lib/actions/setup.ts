"use server";

import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { AlreadySetupError, createFirstUser, hasAnyUser, normalizeEmail, validateCredentials } from "@/lib/users";

export type SetupState = { error?: string; email?: string };

/**
 * First-run setup. Sign-up stays disabled in Better Auth: the account is
 * created server-side (createFirstUser, advisory lock), then signed in.
 */
export async function setupAction(_prev: SetupState, formData: FormData): Promise<SetupState> {
  const db = getDb();
  if (await hasAnyUser(db)) notFound();

  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  const invalid = validateCredentials(email, password);
  if (invalid) return { error: invalid, email };
  if (password !== confirm) return { error: "Les deux mots de passe ne correspondent pas.", email };

  try {
    await createFirstUser(db, { email, password });
  } catch (err) {
    // Another setup won the race: the wizard no longer exists.
    if (err instanceof AlreadySetupError) notFound();
    throw err;
  }

  // Open the session right away (nextCookies() sets the cookie from this action).
  await getAuth().api.signInEmail({ body: { email, password, rememberMe: true }, headers: await headers() });
  redirect("/");
}

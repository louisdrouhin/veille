"use server";

import { and, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { user } from "@/lib/db/schema";
import { cleanName } from "@/lib/profile";
import { grantUntil } from "@/lib/secrets/reconfirm";
import { requireSession } from "@/lib/session";

type Result = { ok: true } | { ok: false; error: string; reconfirm?: true };

/** Prénom or Nom (docs/design/3.5 § 5): required, 50 characters at most. Applied at once (blur or Entrée). */
export async function updateNameAction(field: unknown, value: unknown): Promise<Result> {
  const session = await requireSession();
  if (field !== "firstName" && field !== "lastName") return { ok: false, error: "Champ inconnu." };
  const v = cleanName(value);
  if (!v) return { ok: false, error: `${field === "firstName" ? "Prénom" : "Nom"} obligatoire, 50 caractères au plus.` };
  await getDb()
    .update(user)
    .set({ [field]: v, updatedAt: new Date() })
    .where(eq(user.id, session.user.id));
  // The name is shown in the header and the menus (layout).
  revalidatePath("/", "layout");
  return { ok: true };
}

const EMAIL = /^[^\s@<>()[\]\\,;:"]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

/**
 * The sign-in e-mail. The app sends no e-mail: no verification link; the change is protected by the identity
 * re-confirmation (password or 2FA code, less than 10 minutes ago in this session) — docs/design/3.5, privacy rules.
 */
export async function updateEmailAction(value: unknown): Promise<Result> {
  const session = await requireSession();
  if (!grantUntil(session.session.id)) return { ok: false, error: "Confirme d'abord ton identité.", reconfirm: true };
  if (typeof value !== "string") return { ok: false, error: "Adresse invalide." };
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !EMAIL.test(email)) return { ok: false, error: "Adresse e-mail invalide." };
  const db = getDb();
  const [taken] = await db
    .select({ id: user.id })
    .from(user)
    .where(and(eq(user.email, email), ne(user.id, session.user.id)));
  if (taken) return { ok: false, error: "Cette adresse est déjà utilisée par un autre compte." };
  await db.update(user).set({ email, updatedAt: new Date() }).where(eq(user.id, session.user.id));
  revalidatePath("/", "layout");
  return { ok: true };
}

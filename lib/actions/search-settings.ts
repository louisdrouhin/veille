"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { articleEmbeddings } from "@/lib/db/schema";
import { removeSetting, saveSetting, validateSetting } from "@/lib/secrets/write";
import { requireSession } from "@/lib/session";

type Result = { ok: true } | { ok: false; error: string };

const NAMES = ["merge_threshold", "merge_window_hours", "embed_daily_limit", "ask_daily_limit"] as const;
type Name = (typeof NAMES)[number];

/**
 * Paramètres › Recherche et IA (docs/design/3.5 § 7): fusion threshold and window, daily limits. Not secrets: saved in
 * clear in app_settings, without the identity re-confirmation (it protects Sécurité and Intégrations), and journaled.
 * An empty value goes back to the .env (or the default).
 */
export async function saveSearchSettingAction(name: unknown, value: unknown): Promise<Result> {
  await requireSession();
  if (!(NAMES as readonly unknown[]).includes(name) || typeof value !== "string") return { ok: false, error: "Réglage inconnu." };
  const v = value.trim().replace(",", ".");
  const n = name as Name;
  if (v) {
    const invalid = validateSetting(n, v);
    if (invalid) return { ok: false, error: invalid };
  }
  try {
    // No secret here: the master key is not used (lib/secrets/write.ts encrypts the secrets only).
    if (v) await saveSetting(getDb(), Buffer.alloc(32), n, v);
    else await removeSetting(getDb(), n);
  } catch (err) {
    console.error(`[réglages] ${n} : ${(err as Error)?.name ?? "erreur"}`);
    return { ok: false, error: "Enregistrement impossible, réessaie." };
  }
  revalidatePath("/parametres/recherche-ia");
  return { ok: true };
}

/** « Tout réindexer » (asked for confirmation): the vectors are dropped, the background indexing makes them again. */
export async function reindexAllAction(): Promise<Result & { removed?: number }> {
  await requireSession();
  const rows = await getDb().delete(articleEmbeddings).returning({ id: articleEmbeddings.topicId });
  console.info(`[index] réindexation demandée : ${rows.length} vecteur(s) supprimé(s)`);
  revalidatePath("/parametres/recherche-ia");
  return { ok: true, removed: rows.length };
}

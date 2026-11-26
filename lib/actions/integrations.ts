"use server";

import { revalidatePath } from "next/cache";
import { aiConfig } from "@/lib/ai/config";
import { getDb } from "@/lib/db";
import { masterKey } from "@/lib/secrets/crypto";
import { isSettingName, type SettingName } from "@/lib/secrets/names";
import { checkPassword, checkTotp, clearAttempts, grant, grantUntil, proofKind, takeAttempt } from "@/lib/secrets/reconfirm";
import { resolveSettings } from "@/lib/secrets/store";
import { takeKeyTest, testGeminiKey, testNvdKey } from "@/lib/secrets/test-key";
import { generateVapid, importVapidFromEnv, recordTest, removeSetting, saveSetting, validateSetting } from "@/lib/secrets/write";
import { requireSession } from "@/lib/session";

/*
 * Admin › Intégrations. Every action re-checks the session; every change also needs a confirmation
 * of the password (or the 2FA code) made less than 5 minutes ago in this session, and SECRETS_KEY.
 * Values are never returned, logged, or put in an error message: errors are logged by name only.
 */

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string; reconfirm?: true };

const KEYS = ["gemini_api_key", "nvd_api_key"] as const;
type KeyName = (typeof KEYS)[number];
const isKeyName = (v: unknown): v is KeyName => (KEYS as readonly unknown[]).includes(v);

const READ_ONLY = "SECRETS_KEY manquante ou invalide dans le .env du serveur : la page est en lecture seule.";

/** Session, database, master key, and a fresh confirmation. */
async function forChange(): Promise<{ ok: true; db: ReturnType<typeof getDb>; key: Buffer } | { ok: false; error: string; reconfirm?: true }> {
  const session = await requireSession();
  const master = masterKey();
  if (!master.ok) return { ok: false, error: READ_ONLY };
  if (!grantUntil(session.session.id)) return { ok: false, error: "Confirme d'abord ton identité.", reconfirm: true };
  return { ok: true, db: getDb(), key: master.key };
}

const done = () => {
  revalidatePath("/admin/integrations");
  // Gemini buttons, notifications page: read on the next render.
  revalidatePath("/", "layout");
};

async function guarded<T extends object>(what: string, fn: () => Promise<Result<T>>): Promise<Result<T>> {
  try {
    return await fn();
  } catch (err) {
    // The name of the error only: a database error can carry the query's parameters.
    console.error(`[secrets] ${what} impossible : ${(err as Error)?.name ?? "erreur"}`);
    return { ok: false, error: "Enregistrement impossible : réessaie." };
  }
}

export async function reconfirmAction(input: { password?: unknown; code?: unknown }): Promise<Result<{ until: number }>> {
  const session = await requireSession();
  const db = getDb();
  const userId = session.user.id;
  const limit = takeAttempt(userId);
  if (!limit.ok) return { ok: false, error: `Trop de tentatives : réessaie dans ${Math.ceil(limit.retryAfterSec / 60)} min.` };
  const kind = await proofKind(db, userId);
  const ok =
    kind === "code"
      ? typeof input?.code === "string" && (await checkTotp(db, userId, input.code.replace(/\s/g, ""), process.env.BETTER_AUTH_SECRET))
      : typeof input?.password === "string" && (await checkPassword(db, userId, input.password));
  if (!ok) return { ok: false, error: kind === "code" ? "Code invalide : vérifie l'heure de ton téléphone et réessaie." : "Mot de passe incorrect." };
  clearAttempts(userId);
  return { ok: true, until: grant(session.session.id) };
}

export async function saveKeyAction(name: unknown, value: unknown): Promise<Result> {
  if (!isKeyName(name) || typeof value !== "string") return { ok: false, error: "Valeur inconnue." };
  const c = await forChange();
  if (!c.ok) return c;
  const v = value.trim();
  const invalid = validateSetting(name, v);
  if (invalid) return { ok: false, error: invalid };
  return guarded(`enregistrement de ${name}`, async () => {
    await saveSetting(c.db, c.key, name, v);
    done();
    return { ok: true };
  });
}

/** An empty model goes back to the .env, else to the default. */
export async function saveModelsAction(input: { model?: unknown; translateModel?: unknown }): Promise<Result> {
  const c = await forChange();
  if (!c.ok) return c;
  const pairs: [SettingName, unknown][] = [
    ["gemini_model", input?.model],
    ["gemini_translate_model", input?.translateModel],
  ];
  for (const [name, v] of pairs) {
    if (typeof v !== "string") return { ok: false, error: "Valeur inconnue." };
    const invalid = v.trim() ? validateSetting(name, v.trim()) : null;
    if (invalid) return { ok: false, error: invalid };
  }
  return guarded("enregistrement des modèles", async () => {
    const current = (await resolveSettings(c.db)).settings;
    for (const [name, v] of pairs) {
      const value = (v as string).trim();
      const saved = current[name].row?.value ?? null;
      if (value === (saved ?? "")) continue;
      if (value) await saveSetting(c.db, c.key, name, value);
      else await removeSetting(c.db, name);
    }
    done();
    return { ok: true };
  });
}

/** Fusion of duplicates (docs/design/3.3 § 2): similarity from which a new article joins a topic. Empty: default. */
export async function saveMergeThresholdAction(value: unknown): Promise<Result> {
  if (typeof value !== "string") return { ok: false, error: "Valeur inconnue." };
  const c = await forChange();
  if (!c.ok) return c;
  const v = value.trim().replace(",", ".");
  if (v) {
    const invalid = validateSetting("merge_threshold", v);
    if (invalid) return { ok: false, error: invalid };
  }
  return guarded("enregistrement du seuil de regroupement", async () => {
    if (v) await saveSetting(c.db, c.key, "merge_threshold", v);
    else await removeSetting(c.db, "merge_threshold");
    done();
    return { ok: true };
  });
}

export async function removeSettingAction(name: unknown): Promise<Result> {
  if (!isSettingName(name)) return { ok: false, error: "Valeur inconnue." };
  const c = await forChange();
  if (!c.ok) return c;
  return guarded(`suppression de ${name}`, async () => {
    await removeSetting(c.db, name);
    done();
    return { ok: true };
  });
}

export async function generateVapidAction(): Promise<Result<{ removedDevices: number }>> {
  const c = await forChange();
  if (!c.ok) return c;
  return guarded("génération des clés VAPID", async () => {
    const r = await generateVapid(c.db, c.key);
    done();
    return { ok: true, ...r };
  });
}

export async function importVapidAction(): Promise<Result> {
  const c = await forChange();
  if (!c.ok) return c;
  return guarded("reprise des clés VAPID", async (): Promise<Result> => {
    if (!(await importVapidFromEnv(c.db, c.key, process.env))) return { ok: false, error: "Pas de clés VAPID valides dans le .env." };
    done();
    return { ok: true };
  });
}

/** « Tester la clé » of the key in use (interface or .env). Changes nothing: no confirmation. */
export async function testKeyAction(name: unknown): Promise<Result<{ test: { ok: boolean; message: string; at: string } }>> {
  const session = await requireSession();
  if (!isKeyName(name)) return { ok: false, error: "Valeur inconnue." };
  const limit = takeKeyTest(session.user.id);
  if (!limit.ok) return { ok: false, error: `Trop de tests : réessaie dans ${limit.retryAfterSec} s.` };
  const db = getDb();
  return guarded(`test de ${name}`, async () => {
    const { env } = await resolveSettings(db);
    let result: { ok: boolean; message: string };
    if (name === "gemini_api_key") {
      const config = aiConfig(env);
      result = config ? await testGeminiKey(config.apiKey, [config.model, config.translateModel]) : { ok: false, message: "Aucune clé Gemini configurée." };
    } else {
      const key = env.NVD_API_KEY?.trim();
      result = key ? await testNvdKey(key) : { ok: false, message: "Aucune clé NVD configurée." };
    }
    const at = new Date();
    await recordTest(db, name, result, at);
    revalidatePath("/admin/integrations");
    return { ok: true, test: { ...result, at: at.toISOString() } };
  });
}

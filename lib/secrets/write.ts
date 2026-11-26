/**
 * Admin › Intégrations, write side. Every change goes in the journal (settings_log: which value,
 * what, when — never the value) and drops the cached settings. A new value resets its test result.
 */
import { desc, inArray } from "drizzle-orm";
import { MODEL } from "@/lib/ai/config";
import type { Db } from "@/lib/db";
import { appSettings, pushSubscriptions, settingsLog } from "@/lib/db/schema";
import { isVapidPair } from "@/lib/push/config";
import { generateVapidKeys } from "@/lib/push/webpush";
import { encryptSecret, hintOf } from "./crypto";
import { isSecret, type SecretName, type SettingAction, type SettingName } from "./names";
import { invalidateSettings } from "./store";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** An API key as pasted: printable ASCII without spaces. */
const API_KEY = /^[\x21-\x7e]{16,256}$/;

export function validateSetting(name: SettingName, value: string): string | null {
  if (name === "gemini_model" || name === "gemini_translate_model") return MODEL.test(value) ? null : "Nom de modèle invalide (ex. gemini-3.5-flash-lite).";
  if (name === "merge_threshold") return /^0\.(5\d|[6-8]\d|9[0-9])$/.test(value) ? null : "Seuil entre 0,50 et 0,99 (ex. 0,87).";
  if (name === "gemini_api_key" || name === "nvd_api_key") return API_KEY.test(value) ? null : "Clé invalide : colle-la sans espace ni retour à la ligne.";
  return "Cette valeur ne se modifie pas ici.";
}

const NO_TEST = { testedAt: null, testOk: null, testMessage: null };

async function put(tx: Tx | Db, name: SettingName, set: { value: string | null; encrypted: string | null; hint: string | null }, action: SettingAction) {
  const row = { ...set, ...NO_TEST, updatedAt: new Date() };
  await tx.insert(appSettings).values({ name, ...row }).onConflictDoUpdate({ target: appSettings.name, set: row });
  await tx.insert(settingsLog).values({ name, action });
}

function encrypted(key: Buffer, name: SecretName, value: string) {
  return { value: null, encrypted: encryptSecret(key, name, value), hint: hintOf(value) };
}

/** Saves a key (encrypted) or a model name (in clear). The caller validated it. */
export async function saveSetting(db: Db, key: Buffer, name: SettingName, value: string) {
  await put(db, name, isSecret(name) ? encrypted(key, name, value) : { value, encrypted: null, hint: null }, "set");
  invalidateSettings(db);
}

/** Back to the .env (the row goes; for the VAPID pair, both keys). */
export async function removeSetting(db: Db, name: SettingName) {
  const names: SettingName[] = name.startsWith("vapid_") ? ["vapid_public_key", "vapid_private_key"] : [name];
  await db.transaction(async (tx) => {
    const gone = await tx.delete(appSettings).where(inArray(appSettings.name, names)).returning({ name: appSettings.name, encrypted: appSettings.encrypted, value: appSettings.value });
    const changed = gone.filter((r) => r.encrypted || r.value);
    if (changed.length) await tx.insert(settingsLog).values(changed.map((r) => ({ name: r.name, action: "delete" as const })));
  });
  invalidateSettings(db);
}

/**
 * New VAPID keys, made on the server; the private key is never shown. Every device subscribed with
 * the old public key can no longer receive anything: their subscriptions are deleted.
 */
export async function generateVapid(db: Db, key: Buffer): Promise<{ removedDevices: number }> {
  const pair = generateVapidKeys();
  const removed = await db.transaction(async (tx) => {
    await put(tx, "vapid_public_key", { value: pair.publicKey, encrypted: null, hint: null }, "generate");
    await put(tx, "vapid_private_key", encrypted(key, "vapid_private_key", pair.privateKey), "generate");
    return (await tx.delete(pushSubscriptions).returning({ id: pushSubscriptions.id })).length;
  });
  invalidateSettings(db);
  return { removedDevices: removed };
}

/** The VAPID pair of the .env, copied into the interface: same keys, the subscriptions keep working. */
export async function importVapidFromEnv(db: Db, key: Buffer, env: Partial<Record<string, string | undefined>>): Promise<boolean> {
  const vapid = { publicKey: env.VAPID_PUBLIC_KEY?.trim() ?? "", privateKey: env.VAPID_PRIVATE_KEY?.trim() ?? "" };
  if (!isVapidPair(vapid.publicKey, vapid.privateKey)) return false;
  await db.transaction(async (tx) => {
    await put(tx, "vapid_public_key", { value: vapid.publicKey, encrypted: null, hint: null }, "import");
    await put(tx, "vapid_private_key", encrypted(key, "vapid_private_key", vapid.privateKey), "import");
  });
  invalidateSettings(db);
  return true;
}

/** Result of « Tester la clé », kept on the row (also for a key of the .env: a row without value). */
export async function recordTest(db: Db, name: SettingName, result: { ok: boolean; message: string }, now = new Date()) {
  const set = { testedAt: now, testOk: result.ok, testMessage: result.message.slice(0, 200) };
  await db.insert(appSettings).values({ name, ...set }).onConflictDoUpdate({ target: appSettings.name, set });
  invalidateSettings(db);
}

export async function settingsJournal(db: Db, limit = 20) {
  return db.select().from(settingsLog).orderBy(desc(settingsLog.at), desc(settingsLog.id)).limit(limit);
}

/**
 * Admin › Intégrations, read side: the value of each setting is the one saved in the interface
 * (app_settings, decrypted with SECRETS_KEY) when there is one, else the server .env. The result is
 * an environment (process.env overlaid with the saved values), so aiConfig(), vapidConfig() and the
 * NVD source read it unchanged. The VAPID pair always comes from one place: both keys from the
 * interface, or both from the .env.
 * Without SECRETS_KEY (or with another one), saved secrets cannot be read: the .env is used.
 * No "server-only" import: the worker uses it too. Never logs a value.
 */
import { asc } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { appSettings } from "@/lib/db/schema";
import { decryptSecret, masterKey, type MasterKey } from "./crypto";
import { ENV_OF, isSecret, SETTING_NAMES, type SettingName } from "./names";

type Env = Partial<Record<string, string | undefined>>;
export type SettingRow = typeof appSettings.$inferSelect;
export type Source = "interface" | "env";

export type ResolvedSetting = {
  /** Where the value in use comes from; null: none. */
  source: Source | null;
  /** Saved in the interface but unreadable (SECRETS_KEY missing or changed): the .env is used. */
  unreadable: boolean;
  row: SettingRow | null;
};

export type Resolved = {
  env: Env;
  master: MasterKey;
  settings: Record<SettingName, ResolvedSetting>;
};

const CACHE_MS = 10_000;
// Only the rows are cached: the environment is read again at every call (a variable changed is seen at once).
const cache = new WeakMap<object, { at: number; rows: Promise<SettingRow[]> }>();
const warned = new Set<string>();

/** After a change (same process: the app; the worker re-reads at most every 10 s). */
export function invalidateSettings(db?: Db) {
  if (db) cache.delete(db);
}

export async function resolveSettings(db: Db, env: Env = process.env, now = Date.now()): Promise<Resolved> {
  const hit = cache.get(db);
  let rows = hit && now - hit.at < CACHE_MS ? hit.rows : null;
  if (!rows) {
    // A real promise: a Drizzle query is a thenable that runs again at every await (the cache would be useless).
    rows = Promise.resolve(db.select().from(appSettings).orderBy(asc(appSettings.name)));
    const pending = rows;
    pending.catch(() => {
      if (cache.get(db)?.rows === pending) cache.delete(db);
    });
    cache.set(db, { at: now, rows: pending });
  }
  return load(await rows, env);
}

/** The environment to use: process.env overlaid with the values saved in the interface. */
export async function effectiveEnv(db: Db, env: Env = process.env): Promise<Env> {
  try {
    return (await resolveSettings(db, env)).env;
  } catch {
    // Table missing (migration not applied yet) or database down: the .env alone.
    return env;
  }
}

function load(rows: SettingRow[], env: Env): Resolved {
  const byName = new Map(rows.map((r) => [r.name, r]));
  const master = masterKey(env);
  const saved = new Map<SettingName, string>();
  const failed = new Set<SettingName>();

  for (const name of SETTING_NAMES) {
    const row = byName.get(name);
    if (!row) continue;
    if (isSecret(name)) {
      if (!row.encrypted) continue;
      const plain = master.ok ? decryptSecret(master.key, name, row.encrypted) : null;
      if (plain) saved.set(name, plain);
      else {
        failed.add(name);
        warnOnce(name, master.ok ? "illisible avec cette SECRETS_KEY" : "SECRETS_KEY absente");
      }
    } else if (row.value) saved.set(name, row.value);
  }
  // The VAPID pair: from the interface only when both keys are there.
  if (!(saved.has("vapid_public_key") && saved.has("vapid_private_key"))) {
    saved.delete("vapid_public_key");
    saved.delete("vapid_private_key");
  }

  const out: Env = { ...env };
  const settings = {} as Record<SettingName, ResolvedSetting>;
  for (const name of SETTING_NAMES) {
    const row = byName.get(name) ?? null;
    const fromEnv = !!env[ENV_OF[name]]?.trim();
    if (saved.has(name)) out[ENV_OF[name]] = saved.get(name);
    settings[name] = {
      source: saved.has(name) ? "interface" : fromEnv ? "env" : null,
      unreadable: failed.has(name),
      row,
    };
  }
  return { env: out, master, settings };
}

function warnOnce(name: string, why: string) {
  if (warned.has(name)) return;
  warned.add(name);
  console.warn(`[secrets] ${name} enregistrée dans l'interface mais ${why} : valeur du .env utilisée`);
}

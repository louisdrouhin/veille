/**
 * What Admin › Intégrations sends to the browser: for each key, where it comes from, its last 4
 * characters and its last test — never the value (tests/integrations.test.ts checks the whole
 * object against the plaintext).
 */
import "server-only";
import { count } from "drizzle-orm";
import { DEFAULT_GEMINI_MODEL, DEFAULT_TRANSLATE_MODEL } from "@/lib/ai/config";
import type { Db } from "@/lib/db";
import { pushSubscriptions } from "@/lib/db/schema";
import { isVapidPair } from "@/lib/push/config";
import { indexProgress } from "@/lib/search/indexer";
import { dailyLimit, usedToday } from "@/lib/search/usage";
import { hintOf } from "./crypto";
import { ENV_OF, type SettingAction, type SettingName } from "./names";
import { resolveSettings, type Source } from "./store";
import { settingsJournal } from "./write";

export const LABELS: Record<SettingName, string> = {
  gemini_api_key: "Clé Gemini",
  gemini_model: "Modèle des résumés",
  gemini_translate_model: "Modèle des traductions",
  nvd_api_key: "Clé NVD",
  vapid_public_key: "Clé publique VAPID",
  vapid_private_key: "Clé privée VAPID",
};

export const ACTION_LABELS: Record<SettingAction, string> = {
  set: "enregistrée",
  delete: "supprimée (retour au .env)",
  generate: "générée",
  import: "reprise du .env",
};

export type KeyState = {
  name: SettingName;
  label: string;
  source: Source | null;
  /** Last 4 characters of the key in use (empty for a short key). */
  hint: string | null;
  /** Saved in the interface but unreadable with the current SECRETS_KEY. */
  unreadable: boolean;
  test: { at: string; ok: boolean; message: string } | null;
};

export type ModelState = { name: SettingName; label: string; value: string; source: Source | "default" };

export type IntegrationsView = {
  master: "ok" | "missing" | "invalid";
  gemini: { key: KeyState; models: [ModelState, ModelState]; index: { indexed: number; total: number; model: string; today: number; limit: number } };
  nvd: { key: KeyState };
  vapid: { source: Source | null; hint: string | null; unreadable: boolean; envPair: boolean; devices: number };
  journal: { id: number; label: string; action: string; at: string }[];
};

type Env = Partial<Record<string, string | undefined>>;

export async function integrationsView(db: Db, env: Env = process.env): Promise<IntegrationsView> {
  const r = await resolveSettings(db, env);
  const s = r.settings;

  const key = (name: SettingName): KeyState => {
    const st = s[name];
    const value = r.env[ENV_OF[name]]?.trim() ?? "";
    const row = st.row;
    return {
      name,
      label: LABELS[name],
      source: st.source,
      hint: st.source === "interface" ? (row?.hint ?? "") : st.source === "env" ? hintOf(value) : null,
      unreadable: st.unreadable,
      test: row?.testedAt && row.testOk !== null ? { at: row.testedAt.toISOString(), ok: row.testOk, message: row.testMessage ?? "" } : null,
    };
  };
  const model = (name: "gemini_model" | "gemini_translate_model", fallback: string): ModelState => ({
    name,
    label: LABELS[name],
    value: r.env[ENV_OF[name]]?.trim() || fallback,
    source: s[name].source ?? "default",
  });

  const [devices, journal, progress, today] = await Promise.all([
    db.select({ n: count() }).from(pushSubscriptions),
    settingsJournal(db),
    indexProgress(db, r.env),
    usedToday(db, "embed"),
  ]);
  const vapidSource = s.vapid_private_key.source === "interface" ? "interface" : isVapidPair(env.VAPID_PUBLIC_KEY?.trim() ?? "", env.VAPID_PRIVATE_KEY?.trim() ?? "") ? "env" : null;

  return {
    master: r.master.ok ? "ok" : r.master.reason,
    gemini: {
      key: key("gemini_api_key"),
      models: [model("gemini_model", DEFAULT_GEMINI_MODEL), model("gemini_translate_model", DEFAULT_TRANSLATE_MODEL)],
      index: { ...progress, today, limit: dailyLimit("embed", r.env) },
    },
    nvd: { key: key("nvd_api_key") },
    vapid: {
      source: vapidSource,
      // The public key is not secret; only its end is shown, to tell two pairs apart.
      hint: vapidSource ? (r.env.VAPID_PUBLIC_KEY?.trim().slice(-4) ?? null) : null,
      unreadable: s.vapid_private_key.unreadable,
      envPair: isVapidPair(env.VAPID_PUBLIC_KEY?.trim() ?? "", env.VAPID_PRIVATE_KEY?.trim() ?? ""),
      devices: devices[0]?.n ?? 0,
    },
    journal: journal.map((j) => ({ id: j.id, label: LABELS[j.name], action: ACTION_LABELS[j.action], at: j.at.toISOString() })),
  };
}

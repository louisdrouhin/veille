"use server";

import { inArray, isNull, and, sql, isNotNull } from "drizzle-orm";
import { makeNow, pushBriefing, retrySentences } from "@/lib/briefing/generate";
import { getBriefing, nextLabel } from "@/lib/briefing/queries";
import { localDay } from "@/lib/briefing/schedule";
import { anySection, getBriefingSettings, updateBriefingSettings } from "@/lib/briefing/settings";
import { idList, parseBriefingPatch } from "@/lib/briefing/validate";
import { isBriefingDay, isEmptyBriefing } from "@/lib/briefing/types";
import { getDb } from "@/lib/db";
import { forums, topics } from "@/lib/db/schema";
import { currentAiConfig, currentVapid } from "@/lib/secrets/effective";
import { requireSession } from "@/lib/session";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const ids = idList;

/**
 * « Marquer ces N topics lus » (docs/design/3.4 § 3) and its « Annuler »: returns the topics that actually changed,
 * so that « Annuler » only gives back those. `at`: server time, for the unread counters (components/topic/read-topics).
 */
export async function setTopicsReadAction(topicIds: unknown, read: unknown): Promise<Result<{ changed: number[]; at: number }>> {
  await requireSession();
  const list = ids(topicIds);
  if (!list || typeof read !== "boolean") return { ok: false, error: "Topics inconnus." };
  if (!list.length) return { ok: true, changed: [], at: Date.now() };
  try {
    const rows = await getDb()
      .update(topics)
      .set({ readAt: read ? sql`now()` : null })
      .where(and(inArray(topics.id, list), read ? isNull(topics.readAt) : isNotNull(topics.readAt)))
      .returning({ id: topics.id });
    return { ok: true, changed: rows.map((r) => r.id), at: Date.now() };
  } catch (err) {
    console.error("[briefing] lu en échec :", (err as Error)?.name ?? "erreur");
    return { ok: false, error: "Enregistrement impossible, réessaie." };
  }
}

/** « Générer les résumés » after an AI error (§ 6). */
export async function retrySentencesAction(day: unknown): Promise<Result> {
  await requireSession();
  if (typeof day !== "string" || !isBriefingDay(day)) return { ok: false, error: "Briefing inconnu." };
  const db = getDb();
  const b = await getBriefing(db, day);
  if (!b) return { ok: false, error: "Briefing inconnu." };
  const done = await retrySentences(db, b.id, { ai: await currentAiConfig(db), vapid: null });
  if (!done) return { ok: false, error: "Les résumés sont déjà là." };
  return done.ai === "ok" ? { ok: true } : { ok: false, error: "Le service IA ne répond toujours pas : réessaie plus tard." };
}

/** « Activer : 7:00, du lundi au vendredi » of the first-time card (§ 6). */
export async function enableBriefingAction(): Promise<Result<{ next: string | null }>> {
  await requireSession();
  const db = getDb();
  const s = await updateBriefingSettings(db, { enabled: true, introSeenAt: new Date() });
  return { ok: true, next: nextLabel(s) };
}

/** « Voir un aperçu d'abord » (§ 6): today's briefing, made now from the last day, without notification. */
export async function previewBriefingAction(): Promise<Result<{ day: string }>> {
  await requireSession();
  const db = getDb();
  await updateBriefingSettings(db, { introSeenAt: new Date() });
  try {
    const { briefing } = await makeNow(db, "preview", { ai: await currentAiConfig(db), vapid: null, log: console.info });
    return { ok: true, day: briefing.day };
  } catch (err) {
    console.error("[briefing] aperçu en échec :", (err as Error)?.name ?? "erreur");
    return { ok: false, error: "Aperçu impossible, réessaie." };
  }
}

/**
 * « Recevoir un briefing maintenant (test) » (§ 7): today's briefing (made now if there is none), and its
 * notification sent again (same tag: it replaces the previous one).
 */
export async function testBriefingAction(): Promise<Result<{ day: string; devices: number; empty: boolean }>> {
  await requireSession();
  const db = getDb();
  try {
    const deps = { ai: await currentAiConfig(db), vapid: await currentVapid(db), log: console.info };
    if (!deps.vapid) return { ok: false, error: "Notifications non configurées : génère les clés VAPID dans Administration › Intégrations." };
    const { briefing, created } = await makeNow(db, "test", deps);
    const empty = isEmptyBriefing(briefing.content);
    // A new one was sent when made (unless « Rien de neuf »); an existing one is sent again.
    const sent = created ? { ok: briefing.pushedAt ? 1 : 0 } : await pushBriefing(db, briefing, deps);
    return { ok: true, day: briefing.day, devices: sent.ok, empty };
  } catch (err) {
    console.error("[briefing] test en échec :", (err as Error)?.name ?? "erreur");
    return { ok: false, error: "Envoi impossible, réessaie." };
  }
}

/**
 * Settings of the briefing, saved on change. Unchecking every section turns the briefing off (with a message);
 * turning it on marks the first-time card as answered.
 */
export async function updateBriefingSettingsAction(patch: unknown): Promise<Result<{ enabled: boolean; next: string | null; message?: string }>> {
  await requireSession();
  const db = getDb();
  const all = (await db.select({ id: forums.id }).from(forums)).map((f) => f.id);
  const p = parseBriefingPatch(patch, all);
  if (!p) return { ok: false, error: "Réglage invalide." };
  const before = await getBriefingSettings(db);
  const merged = { ...before, ...p };
  let message: string | undefined;
  if (p.enabled === true && !anySection(merged)) return { ok: false, error: "Coche au moins une section pour recevoir le briefing." };
  if (!anySection(merged) && merged.enabled) {
    p.enabled = false;
    message = "Aucune section cochée : le briefing est coupé.";
  }
  if (p.enabled) p.introSeenAt = before.introSeenAt ?? new Date();
  const s = await updateBriefingSettings(db, p);
  return { ok: true, enabled: s.enabled, next: nextLabel(s), message };
}

/** ✕ of the home block: « Masquer jusqu'à demain » (§ 5). */
export async function hideHomeBriefingAction(): Promise<Result> {
  await requireSession();
  const db = getDb();
  const s = await getBriefingSettings(db);
  await updateBriefingSettings(db, { homeHiddenOn: localDay(new Date(), s.timezone) });
  return { ok: true };
}

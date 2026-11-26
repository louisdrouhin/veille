/**
 * Making a briefing (docs/design/3.4 § 1), by the worker at the chosen time, or on demand (test, aperçu):
 * 1. Ma stack (alerts, no AI) → 2. Mes services → 3. À la une / En bref → saved with the titles only (always
 *    displayable) → 4. the AI sentences (« Détaillé » only) → ready → the notification (built without AI).
 * Once ready, a briefing never changes, except « Générer les résumés » after an AI error.
 * The window starts at the previous briefing's creation (Monday in « lundi au vendredi »: the whole weekend).
 * No "server-only": bundled by the worker.
 */
import { and, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import type { AiConfig } from "@/lib/ai/config";
import type { Db } from "@/lib/db";
import { alerts, briefings } from "@/lib/db/schema";
import { getNotificationSettings, sendToAll } from "@/lib/push/notify";
import type { Vapid } from "@/lib/push/webpush";
import type { Resolver } from "@/lib/net/safe-fetch";
import { briefingPayload } from "./push";
import { dueNow, latestSlot, localDay, nextSlot, previousSlot, type Slot } from "./schedule";
import { countArticles, selectBrief, selectFeatured, selectServices, selectStack, type Window } from "./select";
import { writeSentences } from "./sentences";
import { anySection, getBriefingSettings, scheduleOf, sectionsOf, serviceForums } from "./settings";
import { EMPTY_CONTENT, isEmptyBriefing, topicPoints, type BriefingContent, type BriefingKind } from "./types";

export type Briefing = typeof briefings.$inferSelect;
export const RETENTION_DAYS = 30;
/** A first briefing, or one after a long pause: at most a week back. */
const MAX_WINDOW_MS = 7 * 86_400_000;
/** A preparation longer than this has stopped (worker restarted): see runDueBriefing. */
const STALE_MS = 15 * 60_000;

/** `fetch`: Gemini and the push services (tests); `resolve`: DNS of the push services (lib/net/safe-fetch). */
export type MakeDeps = { ai: AiConfig | null; vapid: Vapid | null; now?: Date; fetch?: typeof fetch; resolve?: Resolver; log?: (...a: unknown[]) => void };

async function lastBriefing(db: Db, before?: string): Promise<Briefing | null> {
  const [row] = await db
    .select()
    .from(briefings)
    .where(before ? lt(briefings.day, before) : undefined)
    .orderBy(desc(briefings.day))
    .limit(1);
  return row ?? null;
}

/** Start of the window of a new briefing of `day`. */
export async function windowStart(db: Db, day: string, fallback: Date, now: Date): Promise<Date> {
  const prev = await lastBriefing(db, day);
  const start = prev?.createdAt ?? fallback;
  return new Date(Math.max(start.getTime(), now.getTime() - MAX_WINDOW_MS));
}

/**
 * Makes the briefing of `day` (nothing if it exists: the existing one is returned). `push`: the notification when
 * ready (never for an aperçu, nor for « Rien de neuf »).
 */
export async function makeBriefing(db: Db, input: { day: string; since: Date; kind: BriefingKind }, deps: MakeDeps): Promise<Briefing> {
  const now = deps.now ?? new Date();
  const settings = await getBriefingSettings(db);
  const sections = sectionsOf(settings);
  const w: Window = { since: input.since, until: now };

  const [row] = await db
    .insert(briefings)
    .values({ day: input.day, kind: input.kind, since: input.since, createdAt: now, length: settings.length, content: EMPTY_CONTENT, step: "stack" })
    .onConflictDoNothing({ target: briefings.day })
    .returning();
  if (!row) return (await db.select().from(briefings).where(eq(briefings.day, input.day)))[0]!;
  const id = row.id;
  const save = (patch: Partial<Briefing>) => db.update(briefings).set(patch).where(eq(briefings.id, id));

  // 1. Ma stack: data of the alerts, no AI.
  const stack = sections.stack ? await selectStack(db, w) : { points: [], open: 0, topicIds: [] };
  let content: BriefingContent = { ...EMPTY_CONTENT, stack: stack.points, stackOpen: stack.open };
  await save({ content, step: "services" });

  // 2. Mes services: the forums chosen in the settings.
  const forumsOfServices = await serviceForums(db, settings);
  const services = sections.services ? await selectServices(db, w, forumsOfServices, stack.topicIds) : [];
  content = { ...content, services };
  await save({ content, step: "select" });

  // 3. À la une, then Le reste en bref: a topic appears once.
  const cited = () => [...stack.topicIds, ...topicPoints(content).map((p) => p.topicId)];
  const featured = sections.featured ? await selectFeatured(db, w, cited()) : [];
  content = { ...content, featured };
  const brief = sections.brief ? await selectBrief(db, w, cited(), forumsOfServices) : [];
  content = { ...content, brief };
  const articleCount = await countArticles(db, w);

  const empty = isEmptyBriefing(content);
  const wantsAi = !empty && settings.length === "detailed" && topicPoints(content).length > 0 && deps.ai !== null;
  await save({ content, articleCount, step: wantsAi ? "ai" : "done", ai: wantsAi ? "pending" : "off", readyAt: wantsAi ? null : now });

  // 4. The sentences (titles and extracts only, never Ma stack nor a note).
  let ai: Briefing["ai"] = wantsAi ? "pending" : "off";
  if (wantsAi) {
    const res = await writeSentences(db, content, { ai: deps.ai!, fetch: deps.fetch });
    if (res.ok) {
      content = res.content;
      ai = "ok";
      if (res.rejected) deps.log?.(`[briefing] ${res.rejected} phrase(s) rejetée(s) (chiffre ou version absent des extraits)`);
    } else {
      ai = "error";
      deps.log?.(`[briefing] résumés indisponibles : ${res.error}`);
    }
    await save({ content, ai, step: "done", readyAt: new Date() });
  }

  const points = content.stack.length + topicPoints(content).length;
  deps.log?.(`[briefing] ${input.day} prêt : ${empty ? "rien de neuf" : `${points} point(s)`}, ${articleCount} article(s)`);
  if (input.kind !== "preview" && !empty) await pushBriefing(db, { id, day: input.day, content }, deps);
  return (await db.select().from(briefings).where(eq(briefings.id, id)))[0]!;
}

/**
 * Sends the notification of a briefing, even during quiet hours (the user chose this time). The alerts it shows
 * are marked as notified: they are not sent again in the grouped message at the end of the quiet hours.
 */
export async function pushBriefing(db: Db, b: { id: number; day: string; content: BriefingContent }, deps: MakeDeps): Promise<{ ok: number; devices: number }> {
  const settings = await getBriefingSettings(db);
  const notif = await getNotificationSettings(db);
  const payload = briefingPayload(b.day, b.content, settings.preview, notif, b.content.stackOpen);
  const sent = await sendToAll(db, payload, { vapid: deps.vapid, now: deps.now, fetchImpl: deps.fetch, resolve: deps.resolve });
  const now = deps.now ?? new Date();
  if (sent.ok > 0) {
    await db.update(briefings).set({ pushedAt: now }).where(eq(briefings.id, b.id));
    const ids = b.content.stack.map((p) => p.alertId);
    if (ids.length) {
      await db
        .update(alerts)
        .set({ notifiedAt: now, notifiedExploited: sql`(select v.exploited from vulnerabilities v where v.id = ${alerts.vulnerabilityId})` })
        .where(and(inArray(alerts.id, ids), isNull(alerts.notifiedAt)));
    }
  }
  deps.log?.(`[briefing] notification ${b.day} : ${sent.ok}/${sent.devices} appareil(s)`);
  return { ok: sent.ok, devices: sent.devices };
}

/** « Générer les résumés » (§ 6): only after an AI error; the rest of the briefing stays as it is. */
export async function retrySentences(db: Db, id: number, deps: MakeDeps): Promise<Briefing | null> {
  const [b] = await db
    .update(briefings)
    .set({ ai: "pending" })
    .where(and(eq(briefings.id, id), eq(briefings.ai, "error")))
    .returning();
  if (!b) return null;
  if (!deps.ai) {
    await db.update(briefings).set({ ai: "error" }).where(eq(briefings.id, id));
    return { ...b, ai: "error" };
  }
  const res = await writeSentences(db, b.content, { ai: deps.ai, fetch: deps.fetch });
  const [done] = await db
    .update(briefings)
    .set(res.ok ? { ai: "ok", content: res.content } : { ai: "error" })
    .where(eq(briefings.id, id))
    .returning();
  return done ?? null;
}

const skipped = new Set<string>();

/** Run by the worker every minute: the due briefing, made once; a slot more than 3 hours late is skipped. */
export async function runDueBriefing(db: Db, deps: MakeDeps): Promise<Briefing | null> {
  const now = deps.now ?? new Date();
  // A briefing left « en préparation » (worker stopped during the AI call): shown without its sentences.
  await db
    .update(briefings)
    .set({ ai: "error", step: "done", readyAt: now })
    .where(and(eq(briefings.step, "ai"), lt(briefings.createdAt, new Date(now.getTime() - STALE_MS))));
  const s = await getBriefingSettings(db);
  if (!s.enabled || !anySection(s)) return null;
  const schedule = scheduleOf(s);
  const slot = latestSlot(now, schedule);
  const made = slot ? (await db.select({ id: briefings.id }).from(briefings).where(eq(briefings.day, slot.day))).length > 0 : false;
  const due = dueNow(now, schedule, () => made);
  if (due.action === "skip") {
    if (!skipped.has(due.slot.day)) {
      skipped.add(due.slot.day);
      deps.log?.(`[briefing] ${due.slot.day} sauté : plus de 3 h de retard`);
    }
    return null;
  }
  if (due.action !== "make") return null;
  const fallback = previousSlot(due.slot, schedule)?.at ?? new Date(due.slot.at.getTime() - 86_400_000);
  const since = await windowStart(db, due.slot.day, fallback, now);
  return makeBriefing(db, { day: due.slot.day, since, kind: "scheduled" }, { ...deps, now });
}

/** Test (« Recevoir un briefing maintenant ») and aperçu: today's briefing, made now if there is none yet. */
export async function makeNow(db: Db, kind: "test" | "preview", deps: MakeDeps): Promise<{ briefing: Briefing; created: boolean }> {
  const now = deps.now ?? new Date();
  const s = await getBriefingSettings(db);
  const day = localDay(now, s.timezone);
  const [existing] = await db.select().from(briefings).where(eq(briefings.day, day));
  if (existing) return { briefing: existing, created: false };
  // « Voir un aperçu d'abord »: a briefing of the last day (§ 6).
  const since = await windowStart(db, day, new Date(now.getTime() - 86_400_000), now);
  return { briefing: await makeBriefing(db, { day, since, kind }, { ...deps, now }), created: true };
}

/**
 * The background indexing waits (docs/design/3.4, quota): while a briefing is being written, and in the 30 minutes
 * before the next one, the Gemini quota is kept for it.
 */
export async function briefingBusy(db: Db, now = new Date()): Promise<boolean> {
  const s = await getBriefingSettings(db);
  if (!s.enabled) return false;
  const [pending] = await db
    .select({ id: briefings.id })
    .from(briefings)
    .where(and(eq(briefings.ai, "pending"), gte(briefings.createdAt, new Date(now.getTime() - STALE_MS))))
    .limit(1);
  if (pending) return true;
  const next: Slot | null = nextSlot(now, scheduleOf(s));
  return next !== null && next.at.getTime() - now.getTime() <= 30 * 60_000;
}

/** Briefings are kept 30 days (§ 1); their topics stay in the forums. */
export async function purgeBriefings(db: Db, now = new Date()): Promise<number> {
  const rows = await db
    .delete(briefings)
    .where(lt(briefings.createdAt, new Date(now.getTime() - RETENTION_DAYS * 86_400_000)))
    .returning({ id: briefings.id });
  return rows.length;
}

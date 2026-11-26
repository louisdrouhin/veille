import "server-only";
import { and, count, desc, eq, gt, gte, inArray, isNull } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { alerts, briefings, stackItems, topics } from "@/lib/db/schema";
import type { Briefing } from "./generate";
import { localDay, localParts, nextSlot, slotLabel } from "./schedule";
import { getBriefingSettings, scheduleOf, type BriefingSettings } from "./settings";
import { isEmptyBriefing, pointCount, readingMinutes, topicPoints } from "./types";

export type { Briefing };

/** Pages of the briefing (docs/design/3.4 § 3–5). */

export async function getBriefing(db: Db, day: string): Promise<Briefing | null> {
  const [row] = await db.select().from(briefings).where(eq(briefings.day, day));
  return row ?? null;
}

export async function getLatestBriefing(db: Db): Promise<Briefing | null> {
  const [row] = await db.select().from(briefings).orderBy(desc(briefings.day)).limit(1);
  return row ?? null;
}

/** The briefing before `day` (« Briefing d'hier »). */
export async function getPreviousDay(db: Db, day: string): Promise<string | null> {
  const rows = await db.select({ day: briefings.day }).from(briefings).orderBy(desc(briefings.day)).limit(40);
  return rows.map((r) => r.day).find((d) => d < day) ?? null;
}

/** Opening the briefing (a visit, or the notification) marks the briefing read; its topics are not. */
export async function markBriefingRead(db: Db, id: number, now = new Date()): Promise<void> {
  await db.update(briefings).set({ readAt: now }).where(and(eq(briefings.id, id), isNull(briefings.readAt)));
}

/** Read state of the briefing's topics now (titles « · lu » once opened). */
export async function readTopicIds(db: Db, b: Briefing): Promise<Set<number>> {
  const ids = topicPoints(b.content).map((p) => p.topicId);
  if (!ids.length) return new Set();
  const rows = await db.select({ id: topics.id, readAt: topics.readAt }).from(topics).where(inArray(topics.id, ids));
  return new Set(rows.filter((r) => r.readAt !== null).map((r) => r.id));
}

/** Topics still existing, with their article URL (row menu: « Ouvrir l'article d'origine »). */
export async function topicUrls(db: Db, b: Briefing): Promise<Map<number, string>> {
  const ids = topicPoints(b.content).map((p) => p.topicId);
  if (!ids.length) return new Map();
  const rows = await db.select({ id: topics.id, url: topics.url }).from(topics).where(inArray(topics.id, ids));
  return new Map(rows.map((r) => [r.id, r.url]));
}

export async function unreadTotal(db: Db): Promise<number> {
  const [row] = await db.select({ n: count() }).from(topics).where(isNull(topics.readAt));
  return row?.n ?? 0;
}

export type HistoryRow = {
  day: string;
  read: boolean;
  empty: boolean;
  points: number;
  flaws: number;
  titles: string[];
  minutes: number;
  preparing: boolean;
};

export const historyRow = (b: Briefing): HistoryRow => ({
  day: b.day,
  read: b.readAt !== null,
  empty: isEmptyBriefing(b.content),
  points: pointCount(b.content),
  flaws: b.content.stack.length,
  titles: [...b.content.stack.map((p) => p.title), ...topicPoints(b.content).map((p) => p.title)].slice(0, 3),
  minutes: readingMinutes(b.content),
  preparing: b.step !== "done",
});

/** Briefings of the last `days` days (newest first). */
export async function recentBriefings(db: Db, days: number, now = new Date()): Promise<HistoryRow[]> {
  const rows = await db
    .select()
    .from(briefings)
    .where(gte(briefings.createdAt, new Date(now.getTime() - (days + 1) * 86_400_000)))
    .orderBy(desc(briefings.day));
  return rows.map(historyRow);
}

export type BriefingNav = { unread: boolean; day: string | null };

/** Header: « Briefing » with its dot while today's briefing is ready and not read. */
export async function briefingNav(db: Db, now = new Date()): Promise<BriefingNav> {
  const s = await getBriefingSettings(db);
  const today = localDay(now, s.timezone);
  const b = await getBriefing(db, today);
  return { day: b?.day ?? null, unread: !!b && b.step === "done" && b.readAt === null && !isEmptyBriefing(b.content) };
}

export type HomeBriefing = {
  day: string;
  at: string;
  points: number;
  minutes: number;
  critical: { count: number; title: string } | null;
  featured: { first: string; more: number } | null;
  services: { first: string; more: number } | null;
  /** On mobile the block replaces the Ma stack banner, unless an alert arrived after the briefing. */
  replacesStack: boolean;
};

/**
 * Home block « Ton briefing de ce matin » (§ 5): today's briefing, ready, not read, before noon (local), not hidden
 * until tomorrow. Null otherwise.
 */
export async function homeBriefing(db: Db, now = new Date()): Promise<HomeBriefing | null> {
  const s: BriefingSettings = await getBriefingSettings(db);
  const today = localDay(now, s.timezone);
  if (s.homeHiddenOn === today || localParts(now, s.timezone).hh >= 12) return null;
  const b = await getBriefing(db, today);
  if (!b || b.step !== "done" || b.readAt !== null || isEmptyBriefing(b.content)) return null;
  const c = b.content;
  const critical = c.stack.filter((p) => p.severity === "critical");
  const [newer] = await db
    .select({ n: count() })
    .from(alerts)
    .innerJoin(stackItems, eq(stackItems.id, alerts.stackItemId))
    .where(and(inArray(alerts.state, ["new", "seen"]), isNull(stackItems.removedAt), gt(alerts.createdAt, b.createdAt)));
  const l = localParts(b.createdAt, s.timezone);
  return {
    day: b.day,
    at: `${l.hh}:${String(l.mm).padStart(2, "0")}`,
    points: pointCount(c),
    minutes: readingMinutes(c),
    critical: critical.length ? { count: critical.length, title: critical[0]!.title } : null,
    featured: c.featured.length ? { first: c.featured[0]!.title, more: c.featured.length - 1 } : null,
    services: c.services.length ? { first: c.services[0]!.title, more: c.services.length - 1 } : null,
    replacesStack: (newer?.n ?? 0) === 0,
  };
}

/** « Prochain briefing vendredi à 7:00 », or null when off. */
export function nextLabel(s: BriefingSettings, now = new Date()): string | null {
  if (!s.enabled) return null;
  const slot = nextSlot(now, scheduleOf(s));
  return slot ? slotLabel(slot, s.timezone) : null;
}

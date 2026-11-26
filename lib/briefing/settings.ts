/**
 * Settings of the briefing (docs/design/3.4 § 7). Read with defaults; the « Mes services » forums are pre-filled
 * once with a forum named « Mes services » when there is one (afterwards: only what the user chose).
 * No "server-only": bundled by the worker.
 */
import { eq, inArray } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { briefingSettings, forums } from "@/lib/db/schema";
import { fold } from "@/lib/search/fold";
import type { Schedule } from "./schedule";
import type { BriefingSection } from "./types";

export type BriefingSettings = typeof briefingSettings.$inferSelect;

export const DEFAULT_BRIEFING: BriefingSettings = {
  id: 1,
  enabled: false,
  sendAt: "07:00:00",
  days: "weekdays",
  timezone: "Europe/Paris",
  sectionStack: true,
  sectionFeatured: true,
  sectionServices: true,
  sectionBrief: true,
  length: "detailed",
  preview: "full",
  servicesForumIds: [],
  servicesPrefilled: false,
  introSeenAt: null,
  homeHiddenOn: null,
  updatedAt: new Date(0),
};

const SERVICES_NAME = "mes services";

export async function getBriefingSettings(db: Db): Promise<BriefingSettings> {
  const [row] = await db.select().from(briefingSettings).where(eq(briefingSettings.id, 1));
  if (row?.servicesPrefilled) return row;
  // First read: « Mes services » pre-filled with a forum of that name, if any (folded: accents and case).
  const all = await db.select({ id: forums.id, name: forums.name }).from(forums);
  const match = all.filter((f) => fold(f.name).trim() === SERVICES_NAME).map((f) => f.id);
  const [saved] = await db
    .insert(briefingSettings)
    .values({ id: 1, servicesForumIds: match, servicesPrefilled: true })
    .onConflictDoUpdate({ target: briefingSettings.id, set: { servicesForumIds: row?.servicesForumIds.length ? row.servicesForumIds : match, servicesPrefilled: true } })
    .returning();
  return saved ?? { ...DEFAULT_BRIEFING, servicesForumIds: match, servicesPrefilled: true };
}

export type BriefingSettingsPatch = Partial<
  Pick<
    BriefingSettings,
    "enabled" | "sendAt" | "days" | "timezone" | "sectionStack" | "sectionFeatured" | "sectionServices" | "sectionBrief" | "length" | "preview" | "servicesForumIds" | "introSeenAt" | "homeHiddenOn"
  >
>;

export async function updateBriefingSettings(db: Db, patch: BriefingSettingsPatch, now = new Date()): Promise<BriefingSettings> {
  await getBriefingSettings(db);
  const [row] = await db
    .update(briefingSettings)
    .set({ ...patch, updatedAt: now })
    .where(eq(briefingSettings.id, 1))
    .returning();
  return row!;
}

export const scheduleOf = (s: Pick<BriefingSettings, "sendAt" | "days" | "timezone">): Schedule => ({ sendAt: s.sendAt.slice(0, 5), days: s.days, timezone: s.timezone });

export const sectionsOf = (s: BriefingSettings): Record<BriefingSection, boolean> => ({
  stack: s.sectionStack,
  featured: s.sectionFeatured,
  services: s.sectionServices,
  brief: s.sectionBrief,
});

export const anySection = (s: BriefingSettings) => s.sectionStack || s.sectionFeatured || s.sectionServices || s.sectionBrief;

/** Forums still existing among those chosen (a deleted forum is dropped silently). */
export async function serviceForums(db: Db, s: BriefingSettings): Promise<number[]> {
  if (!s.servicesForumIds.length) return [];
  const rows = await db.select({ id: forums.id }).from(forums).where(inArray(forums.id, s.servicesForumIds));
  return rows.map((r) => r.id);
}

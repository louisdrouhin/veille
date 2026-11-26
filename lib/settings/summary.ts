import "server-only";
import { and, count, eq, isNull, lte, or, sql } from "drizzle-orm";
import { appInfo } from "@/lib/app-info";
import { getBriefingSettings } from "@/lib/briefing/settings";
import { timeLabel } from "@/lib/briefing/schedule";
import type { Db } from "@/lib/db";
import { appSettings, forums, sources, user, userPhotos } from "@/lib/db/schema";
import { getNotificationSettings } from "@/lib/push/notify";
import { THEME_LABEL } from "@/lib/theme";
import type { SettingsValues } from "./nav";

export type Me = { id: string; name: string; firstName: string; lastName: string; email: string; photo: number | null };

/** The signed-in account as shown in menus and settings; `photo`: version (updatedAt ms) of its picture, if any. */
export async function getMe(db: Db, userId: string): Promise<Me> {
  const [row] = await db
    .select({ id: user.id, name: user.name, firstName: user.firstName, lastName: user.lastName, email: user.email, photoAt: userPhotos.updatedAt })
    .from(user)
    .leftJoin(userPhotos, eq(userPhotos.userId, user.id))
    .where(eq(user.id, userId));
  if (!row) return { id: userId, name: "", firstName: "", lastName: "", email: "", photo: null };
  return { id: row.id, name: row.name, firstName: row.firstName, lastName: row.lastName, email: row.email, photo: row.photoAt?.getTime() ?? null };
}

/** Sources « En erreur » (same rule as the home page): enabled, not paused, with failures. */
export async function sourceErrorCount(db: Db, now = new Date()): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(sources)
    .where(and(eq(sources.enabled, true), sql`${sources.consecutiveFailures} > 0`, or(isNull(sources.pausedUntil), lte(sources.pausedUntil, now))));
  return row?.n ?? 0;
}

/** A key saved in Intégrations whose last test failed (« Clé refusée » until it is fixed or tested again). */
export async function keyRefused(db: Db): Promise<boolean> {
  const rows = await db.select({ ok: appSettings.testOk }).from(appSettings).where(eq(appSettings.testOk, false));
  return rows.length > 0;
}

const THRESHOLD_SHORT = { critical: "Critique", high: "Haute +", medium: "Moyenne +", all: "Toutes" } as const;

/** Current values and badges of the settings menu (§ 3, § 7). */
export async function settingsValues(db: Db, theme: string): Promise<SettingsValues> {
  const [notif, briefing, [f], [s], errors, refused] = await Promise.all([
    getNotificationSettings(db),
    getBriefingSettings(db),
    db.select({ n: count() }).from(forums),
    db.select({ n: count() }).from(sources),
    sourceErrorCount(db),
    keyRefused(db),
  ]);
  return {
    apparence: { value: THEME_LABEL[theme as keyof typeof THEME_LABEL] ?? "Système" },
    notifications: { value: THRESHOLD_SHORT[notif.threshold] },
    briefing: { value: briefing.enabled ? timeLabel(briefing.sendAt) : "Désactivé" },
    forums: { value: String(f?.n ?? 0) },
    sources: errors ? { badge: `${errors} en erreur` } : { value: String(s?.n ?? 0) },
    integrations: refused ? { badge: "Clé refusée" } : {},
    "a-propos": { value: appInfo().version },
  };
}

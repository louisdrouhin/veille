import "server-only";
import type { Db } from "@/lib/db";
import { getPreviousDay, markBriefingRead, nextLabel, readTopicIds, recentBriefings, topicUrls, unreadTotal, type Briefing } from "./queries";
import { timeLabel } from "./schedule";
import type { BriefingSettings } from "./settings";
import type { BriefingPageData } from "@/components/briefing/briefing-view";

export function settingsSummary(s: BriefingSettings): string {
  if (!s.enabled) return "Briefing désactivé.";
  return [
    timeLabel(s.sendAt),
    s.days === "weekdays" ? "du lundi au vendredi" : "tous les jours",
    s.length === "detailed" ? "détaillé" : "court",
    s.preview === "full" ? "aperçu complet" : "notification discrète",
  ].join(" · ");
}

/** Everything the briefing page shows; opening it marks the briefing read (not its topics). */
export async function briefingPageData(db: Db, b: Briefing, s: BriefingSettings, now = new Date()): Promise<BriefingPageData> {
  if (b.step === "done") await markBriefingRead(db, b.id, now);
  const [readIds, urls, unread, previousDay, recent] = await Promise.all([readTopicIds(db, b), topicUrls(db, b), unreadTotal(db), getPreviousDay(db, b.day), recentBriefings(db, 7, now)]);
  return {
    briefing: b,
    readIds,
    urls,
    unread,
    renderedAt: now.getTime(),
    timezone: s.timezone,
    next: nextLabel(s, now),
    previousDay,
    recent: recent.map((r) => (r.day === b.day ? { ...r, read: true } : r)),
    settingsSummary: settingsSummary(s),
  };
}

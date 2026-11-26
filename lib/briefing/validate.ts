/** Validation of the briefing settings sent by the page (docs/design/3.4 § 7). No server import. */
import { isTimeZone } from "./schedule";
import type { BriefingSettingsPatch } from "./settings";
import { BRIEFING_DAYS, BRIEFING_LENGTHS, BRIEFING_PREVIEWS } from "./types";

/** Native time picker, 15-minute steps. */
const TIME = /^([01]\d|2[0-3]):(00|15|30|45)$/;

/** Positive integers, at most 100, without duplicates; null for anything else. */
export const idList = (v: unknown): number[] | null =>
  Array.isArray(v) && v.length <= 100 && v.every((x) => Number.isSafeInteger(x) && (x as number) > 0) ? [...new Set(v as number[])] : null;

const BOOLS = ["enabled", "sectionStack", "sectionFeatured", "sectionServices", "sectionBrief"] as const;

/** A validated patch (unknown keys ignored), or null when one value is invalid. `forumIds`: the existing forums. */
export function parseBriefingPatch(v: unknown, forumIds: number[]): BriefingSettingsPatch | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const out: BriefingSettingsPatch = {};
  for (const k of BOOLS) {
    if (!(k in o)) continue;
    if (typeof o[k] !== "boolean") return null;
    out[k] = o[k];
  }
  if ("sendAt" in o) {
    if (typeof o.sendAt !== "string" || !TIME.test(o.sendAt)) return null;
    out.sendAt = o.sendAt;
  }
  if ("days" in o) {
    if (!BRIEFING_DAYS.includes(o.days as never)) return null;
    out.days = o.days as BriefingSettingsPatch["days"];
  }
  if ("length" in o) {
    if (!BRIEFING_LENGTHS.includes(o.length as never)) return null;
    out.length = o.length as BriefingSettingsPatch["length"];
  }
  if ("preview" in o) {
    if (!BRIEFING_PREVIEWS.includes(o.preview as never)) return null;
    out.preview = o.preview as BriefingSettingsPatch["preview"];
  }
  if ("timezone" in o) {
    if (typeof o.timezone !== "string" || !isTimeZone(o.timezone)) return null;
    out.timezone = o.timezone;
  }
  if ("servicesForumIds" in o) {
    const list = idList(o.servicesForumIds);
    if (!list || list.some((id) => !forumIds.includes(id))) return null;
    out.servicesForumIds = list;
  }
  return out;
}

/**
 * When the morning briefing is due (docs/design/3.4 § 1), in the account's time zone (Europe/Paris by default),
 * daylight saving time included: 07:00 is 06:00 UTC in winter and 05:00 UTC in summer.
 * - A local time that does not exist (spring forward, 02:30) is moved to the first instant after the gap.
 * - A local time that happens twice (fall back, 02:30) is the first one.
 * - Server off at the planned time: the briefing is made at restart if it is less than 3 hours late, else the
 *   day is skipped (the next window then starts at the last briefing made).
 * Pure functions: no database, no clock.
 */
import type { BriefingDays } from "./types";

export const CATCH_UP_MS = 3 * 3_600_000;

export type Schedule = { sendAt: string; days: BriefingDays; timezone: string };
export type Slot = { day: string; at: Date };

type Local = { y: number; m: number; d: number; hh: number; mm: number; weekday: number };

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
    });
    fmtCache.set(tz, f);
  }
  return f;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Wall-clock parts of an instant in a time zone. */
export function localParts(at: Date, tz: string): Local {
  const parts = fmt(tz).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  return { y: Number(get("year")), m: Number(get("month")), d: Number(get("day")), hh: Number(get("hour")), mm: Number(get("minute")), weekday: WEEKDAYS.indexOf(get("weekday")) };
}

/** A valid IANA time zone (the settings refuse anything else). */
export function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return /^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){0,2}$/.test(tz);
  } catch {
    return false;
  }
}

const pad = (n: number) => String(n).padStart(2, "0");
export const dayString = (l: Pick<Local, "y" | "m" | "d">) => `${l.y}-${pad(l.m)}-${pad(l.d)}`;
/** The local day (YYYY-MM-DD) of an instant. */
export const localDay = (at: Date, tz: string) => dayString(localParts(at, tz));

/** Offset (ms) of the zone at an instant: local wall clock minus UTC. */
function offsetAt(at: Date, tz: string): number {
  const l = localParts(at, tz);
  return Date.UTC(l.y, l.m - 1, l.d, l.hh, l.mm) - Math.floor(at.getTime() / 60_000) * 60_000;
}

/** The instant of a local wall-clock time (first occurrence; after the gap when it does not exist). */
export function zonedTime(y: number, m: number, d: number, hh: number, mm: number, tz: string): Date {
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  const offsets = [...new Set([offsetAt(new Date(wall - 86_400_000), tz), offsetAt(new Date(wall), tz), offsetAt(new Date(wall + 86_400_000), tz)])];
  const exact = offsets
    .map((o) => wall - o)
    .filter((t) => {
      const l = localParts(new Date(t), tz);
      return l.y === y && l.m === m && l.d === d && l.hh === hh && l.mm === mm;
    })
    .sort((a, b) => a - b);
  if (exact.length) return new Date(exact[0]!);
  // In the spring-forward gap: the offset before the change gives the same distance after the gap.
  return new Date(wall - Math.min(...offsets));
}

const allowed = (weekday: number, days: BriefingDays) => days === "daily" || (weekday >= 1 && weekday <= 5);

function parseTime(s: string): [number, number] {
  const [h, m] = s.split(":").map(Number);
  return [h ?? 7, m ?? 0];
}

/** The slot of a local day (null on a day without briefing). */
function slotOf(y: number, m: number, d: number, s: Schedule): Slot | null {
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  if (!allowed(weekday, s.days)) return null;
  const [hh, mm] = parseTime(s.sendAt);
  return { day: dayString({ y, m, d }), at: zonedTime(y, m, d, hh, mm, s.timezone) };
}

/** Local day `offset` days from the local day of `now`. */
function shiftDay(now: Date, tz: string, offset: number): { y: number; m: number; d: number } {
  const l = localParts(now, tz);
  const t = new Date(Date.UTC(l.y, l.m - 1, l.d + offset));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

/** The latest planned slot at or before `now` (within 8 days). */
export function latestSlot(now: Date, s: Schedule): Slot | null {
  for (let i = 0; i <= 8; i++) {
    const { y, m, d } = shiftDay(now, s.timezone, -i);
    const slot = slotOf(y, m, d, s);
    if (slot && slot.at.getTime() <= now.getTime()) return slot;
  }
  return null;
}

/** The next planned slot strictly after `now` (« Prochain : vendredi 27 nov. à 7:00 »). */
export function nextSlot(now: Date, s: Schedule): Slot | null {
  for (let i = 0; i <= 8; i++) {
    const { y, m, d } = shiftDay(now, s.timezone, i);
    const slot = slotOf(y, m, d, s);
    if (slot && slot.at.getTime() > now.getTime()) return slot;
  }
  return null;
}

/** The planned slot before `slot` (window of the very first briefing). */
export function previousSlot(slot: Slot, s: Schedule): Slot | null {
  return latestSlot(new Date(slot.at.getTime() - 60_000), s);
}

export type Due = { action: "make"; slot: Slot } | { action: "skip"; slot: Slot } | { action: "none" };

/**
 * What to do now: make the latest slot's briefing (it is not made yet and less than 3 hours late), skip it
 * (too late: the server was off), or nothing.
 */
export function dueNow(now: Date, s: Schedule, made: (day: string) => boolean): Due {
  const slot = latestSlot(now, s);
  if (!slot || made(slot.day)) return { action: "none" };
  return now.getTime() - slot.at.getTime() < CATCH_UP_MS ? { action: "make", slot } : { action: "skip", slot };
}

/** « vendredi 27 nov. à 7:00 » */
export function slotLabel(slot: Slot, tz: string): string {
  const day = new Intl.DateTimeFormat("fr-FR", { timeZone: tz, weekday: "long", day: "numeric", month: "short" }).format(slot.at);
  const l = localParts(slot.at, tz);
  return `${day} à ${l.hh}:${pad(l.mm)}`;
}

/** « 7:00 » of a stored time. */
export const timeLabel = (sendAt: string) => {
  const [h, m] = parseTime(sendAt);
  return `${h}:${pad(m)}`;
};

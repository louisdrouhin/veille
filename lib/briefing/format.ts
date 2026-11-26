/** Dates of the briefing pages (docs/design/3.4 § 3–4). No server import. */
import { localParts } from "./schedule";

const utcOf = (day: string) => {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d, 12));
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** « Jeudi 26 novembre » (title of the page, h1). */
export const dayTitle = (day: string) => cap(new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(utcOf(day)));

/** « Jeudi 26 novembre 2026 » (document title, history). */
export const dayLong = (day: string) =>
  cap(new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(utcOf(day)));

/** « jeu. 26 nov. » */
export const dayShort = (day: string) => new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(utcOf(day));

/** « mer. 7:00 » of an instant in the account's time zone. */
export function sinceLabel(at: Date, tz: string): string {
  const wd = new Intl.DateTimeFormat("fr-FR", { timeZone: tz, weekday: "short" }).format(at);
  const l = localParts(at, tz);
  return `${wd} ${l.hh}:${String(l.mm).padStart(2, "0")}`;
}

/** Monday (YYYY-MM-DD) of the week of a day: groups of the 30-day history. */
export function weekOf(day: string): string {
  const d = utcOf(day);
  const back = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - back * 86_400_000).toISOString().slice(0, 10);
}

/** The local days from `today` back, `n` of them (history, days without briefing included). */
export function daysBack(today: string, n: number): string[] {
  const t = utcOf(today).getTime();
  return Array.from({ length: n }, (_, i) => new Date(t - i * 86_400_000).toISOString().slice(0, 10));
}

export const isWeekend = (day: string) => [0, 6].includes(utcOf(day).getUTCDay());

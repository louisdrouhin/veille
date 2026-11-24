/** Date formatting — always Europe/Paris (DA § 5). */
const TZ = "Europe/Paris";

const ymdFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const timeFmt = new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const dayMonthFmt = new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, day: "numeric", month: "short" });
const dayMonthYearFmt = new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, day: "numeric", month: "short", year: "numeric" });
const numericFmt = new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" });

/** Day index in Paris (days since epoch), to compare calendar days. */
function parisDay(date: Date): { day: number; year: number } {
  const [y, m, d] = ymdFmt.format(date).split("-").map(Number) as [number, number, number];
  return { day: Date.UTC(y, m - 1, d) / 86_400_000, year: y };
}

/** « à l'instant », « il y a 12 min », « il y a 3 h », « hier 18:42 », « 17 nov. », « 17 nov. 2025 » */
export function formatRelative(date: Date, now: Date = new Date()): string {
  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 60_000) return "à l'instant";
  const a = parisDay(date);
  const b = parisDay(now);
  if (diffMs < 3_600_000) return `il y a ${Math.floor(diffMs / 60_000)} min`;
  if (a.day === b.day) return `il y a ${Math.floor(diffMs / 3_600_000)} h`;
  if (a.day === b.day - 1) return `hier ${timeFmt.format(date)}`;
  if (a.year === b.year) return dayMonthFmt.format(date);
  return dayMonthYearFmt.format(date);
}

/** « 19/11/2026 à 09:35 » — tooltip (`title`) of every <time>. */
export function formatTitle(date: Date): string {
  return `${numericFmt.format(date)} à ${timeFmt.format(date)}`;
}

/** « 19 nov. 2026 à 09:35 » — post headers. */
export function formatFull(date: Date): string {
  return `${dayMonthYearFmt.format(date)} à ${timeFmt.format(date)}`;
}

/** « 19 nov. · 09:35 » — post headers on mobile. */
export function formatShort(date: Date): string {
  return `${dayMonthFmt.format(date)} · ${timeFmt.format(date)}`;
}

const partsFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Paris wall-clock time of `date`, read as if it were UTC (ms). Its difference with `date` is the offset. */
function parisWallClock(date: Date): number {
  const p = Object.fromEntries(partsFmt.formatToParts(date).map((x) => [x.type, Number(x.value)]));
  return Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!);
}

/** Start of the current day in Paris (« reçus aujourd'hui »). DST changes happen at night, never at midnight. */
export function startOfParisDay(now: Date = new Date()): Date {
  const wall = new Date(parisWallClock(now));
  const midnightWall = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate());
  const offset = parisWallClock(new Date(midnightWall)) - midnightWall;
  return new Date(midnightWall - offset);
}

export function formatTime(date: Date): string {
  return timeFmt.format(date);
}

export function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${n} ${n > 1 ? pluralForm : singular}`;
}

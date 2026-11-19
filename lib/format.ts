const TZ = "Europe/Paris";

const dateTimeFmt = new Intl.DateTimeFormat("fr-FR", {
  timeZone: TZ,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const dayFmt = new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" });
const timeFmt = new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const relFmt = new Intl.RelativeTimeFormat("fr-FR", { numeric: "auto" });

/** « 19/11/2026 à 09:05 » */
export function formatDateTime(date: Date): string {
  return `${dayFmt.format(date)} à ${timeFmt.format(date)}`;
}

/** Forum style: time only for today, full date otherwise. */
export function formatCompact(date: Date, now = new Date()): string {
  return dayFmt.format(date) === dayFmt.format(now) ? timeFmt.format(date) : dateTimeFmt.format(date).replace(",", "");
}

export function formatTime(date: Date): string {
  return timeFmt.format(date);
}

/** « il y a 5 minutes » */
export function formatRelative(date: Date, now = new Date()): string {
  const seconds = Math.round((date.getTime() - now.getTime()) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 60) return relFmt.format(seconds, "second");
  if (abs < 3600) return relFmt.format(Math.round(seconds / 60), "minute");
  if (abs < 86400) return relFmt.format(Math.round(seconds / 3600), "hour");
  return relFmt.format(Math.round(seconds / 86400), "day");
}

export function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${n} ${n > 1 ? pluralForm : singular}`;
}

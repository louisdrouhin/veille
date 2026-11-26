/**
 * Scope of a question (docs/design/3.3 § 4.1): an explicit period in the question (« ce mois-ci », « cette
 * semaine », « depuis lundi », « aujourd'hui »…) becomes a filter, shown under the question as chips the user can
 * change. A period in the URL wins (the user changed the chip). Days in Europe/Paris. No server import.
 */
import { fold } from "@/lib/search/fold";

export const ASK_PERIODS = [
  { key: "tout", label: "Toute la période" },
  { key: "jour", label: "Aujourd'hui" },
  { key: "24h", label: "Dernières 24 h" },
  { key: "semaine", label: "Cette semaine" },
  { key: "mois", label: "Ce mois-ci" },
  { key: "7j", label: "7 derniers jours" },
  { key: "30j", label: "30 derniers jours" },
  { key: "1an", label: "12 derniers mois" },
] as const;
export type AskPeriod = (typeof ASK_PERIODS)[number]["key"] | `depuis-${number}`;

export type AskScope = { period: AskPeriod; forums: string[] };

const WEEKDAYS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const MONTHS = ["janvier", "fevrier", "mars", "avril", "mai", "juin", "juillet", "aout", "septembre", "octobre", "novembre", "decembre"];

/** The period said in the question, if any. */
export function periodInQuestion(q: string): AskPeriod | null {
  const t = fold(q);
  if (/\b(aujourd'?hui|ce jour)\b/.test(t)) return "jour";
  const since = /\bdepuis (lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b/.exec(t);
  if (since) return `depuis-${WEEKDAYS.indexOf(since[1]!)}` as AskPeriod;
  if (/\b(cette semaine|this week)\b/.test(t)) return "semaine";
  if (/\b(ce mois(-ci)?|this month)\b/.test(t)) return "mois";
  if (/\b(7|sept) derniers jours\b|\bderniere semaine\b|\blast week\b/.test(t)) return "7j";
  if (/\b(30|trente) derniers jours\b|\bdernier mois\b|\blast month\b/.test(t)) return "30j";
  if (/\b(cette annee|12 derniers mois|this year)\b/.test(t)) return "1an";
  return null;
}

type Params = Record<string, string | string[] | undefined>;
const all = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v === undefined ? [] : [v]);
const isPeriod = (v: string | undefined): v is AskPeriod => !!v && (ASK_PERIODS.some((p) => p.key === v) || /^depuis-[0-6]$/.test(v));

/** From the URL (a chip changed) or else from the question. */
export function parseScope(q: string, p: Params): AskScope {
  const fromUrl = all(p.periode)[0];
  return {
    period: isPeriod(fromUrl) ? fromUrl : (periodInQuestion(q) ?? "tout"),
    forums: [...new Set(all(p.forum).filter((s) => /^[a-z0-9][a-z0-9-]{0,63}$/.test(s)))].slice(0, 20),
  };
}

const parisParts = (d: Date) => {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", year: "numeric", month: "numeric", day: "numeric", weekday: "short" })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), wd: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday!) };
};

/** Midnight in Paris of that calendar day (offset taken from the day itself: summer / winter time). */
function parisMidnight(y: number, m: number, d: number): Date {
  const guess = new Date(Date.UTC(y, m - 1, d, 0, 0));
  const offset = new Date(guess.toLocaleString("en-US", { timeZone: "Europe/Paris" })).getTime() - new Date(guess.toLocaleString("en-US", { timeZone: "UTC" })).getTime();
  return new Date(guess.getTime() - offset);
}

/** Start of the scope, or null for all time. */
export function scopeStart(period: AskPeriod, now = new Date()): Date | null {
  const { y, m, d, wd } = parisParts(now);
  const daysAgo = (n: number) => {
    const t = new Date(Date.UTC(y, m - 1, d - n));
    return parisMidnight(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
  };
  if (period === "tout") return null;
  if (period === "jour") return daysAgo(0);
  if (period === "semaine") return daysAgo((wd + 6) % 7); // since Monday
  if (period === "mois") return parisMidnight(y, m, 1);
  if (period === "24h") return new Date(now.getTime() - 86_400_000);
  if (period === "7j") return new Date(now.getTime() - 7 * 86_400_000);
  if (period === "30j") return new Date(now.getTime() - 30 * 86_400_000);
  if (period === "1an") return new Date(now.getTime() - 365 * 86_400_000);
  const day = Number(period.slice(7));
  return daysAgo((wd - day + 7) % 7);
}

/** Label of the period chip: « Novembre 2026 », « Cette semaine », « Depuis lundi »… */
export function periodLabel(period: AskPeriod, now = new Date()): string {
  if (period === "mois") {
    const { y, m } = parisParts(now);
    const name = MONTHS[m - 1]!.replace("fevrier", "février").replace("aout", "août").replace("decembre", "décembre");
    return `${name[0]!.toUpperCase()}${name.slice(1)} ${y}`;
  }
  if (period.startsWith("depuis-")) return `Depuis ${WEEKDAYS[Number(period.slice(7))]}`;
  return ASK_PERIODS.find((p) => p.key === period)?.label ?? "Toute la période";
}

/** The URL of a question with its scope; `go`: write the answer now (an explicit gesture, § 5). */
export function askHref(q: string, scope: AskScope, go = false): string {
  const u = new URLSearchParams({ q });
  // Always explicit: a chip set back to « Toute la période » must win over a period said in the question.
  u.set("periode", scope.period);
  for (const f of scope.forums) u.append("forum", f);
  if (go) u.set("go", "1");
  return `/demander?${u}`;
}

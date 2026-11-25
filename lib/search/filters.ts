/**
 * Filters of the search page (docs/design/3.3 § 3), all in the URL:
 * /recherche?q=…&forum=a&forum=b&periode=30j&source=12&liste=3&notes=0
 * No server import: used by the page and by the client (chips, sheet).
 */
export const PERIODS = [
  { key: "24h", label: "24 h", long: "24 heures", ms: 24 * 3_600_000 },
  { key: "7j", label: "7 j", long: "7 jours", ms: 7 * 86_400_000 },
  { key: "30j", label: "30 j", long: "30 jours", ms: 30 * 86_400_000 },
  { key: "1an", label: "1 an", long: "1 an", ms: 365 * 86_400_000 },
  { key: "tout", label: "Tout", long: "toute la période", ms: null },
] as const;
export type Period = (typeof PERIODS)[number]["key"];

export type SearchFilters = { forums: string[]; period: Period; source: number | null; lists: number[]; notes: boolean };

export const NO_FILTERS: SearchFilters = { forums: [], period: "tout", source: null, lists: [], notes: true };

type Params = Record<string, string | string[] | undefined>;
const all = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v === undefined ? [] : [v]);
const posInt = (v: string) => (/^[1-9][0-9]{0,9}$/.test(v) ? Number(v) : null);
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function parseFilters(p: Params): SearchFilters {
  const period = all(p.periode)[0];
  return {
    forums: [...new Set(all(p.forum).filter((s) => SLUG.test(s)))].slice(0, 20),
    period: PERIODS.some((x) => x.key === period) ? (period as Period) : "tout",
    source: posInt(all(p.source)[0] ?? ""),
    lists: [...new Set(all(p.liste).map(posInt).filter((n): n is number => n !== null))].slice(0, 20),
    notes: all(p.notes)[0] !== "0",
  };
}

export function parseQuery(p: Params): string {
  return (all(p.q)[0] ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
}

/** The URL of a search (or another page: /demander) with these filters. */
export function searchHref(q: string, f: SearchFilters, extra: Record<string, string> = {}, path = "/recherche"): string {
  const u = new URLSearchParams();
  if (q) u.set("q", q);
  for (const s of f.forums) u.append("forum", s);
  if (f.period !== "tout") u.set("periode", f.period);
  if (f.source) u.set("source", String(f.source));
  for (const l of f.lists) u.append("liste", String(l));
  if (!f.notes) u.set("notes", "0");
  for (const [k, v] of Object.entries(extra)) u.set(k, v);
  const s = u.toString();
  return s ? `${path}?${s}` : path;
}

/** Number shown on the « Filtres » chip. */
export function activeFilters(f: SearchFilters): number {
  return (f.forums.length ? 1 : 0) + (f.period !== "tout" ? 1 : 0) + (f.source ? 1 : 0) + (f.lists.length ? 1 : 0) + (f.notes ? 0 : 1);
}

export function periodStart(period: Period, now = new Date()): Date | null {
  const ms = PERIODS.find((p) => p.key === period)?.ms ?? null;
  return ms === null ? null : new Date(now.getTime() - ms);
}

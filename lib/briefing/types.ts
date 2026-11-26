/**
 * Briefing du matin (docs/design/3.4): what a briefing holds, frozen when it is made. No server import: used by
 * the schema, the worker, the pages and the client components.
 */
import type { Severity, StackContext } from "@/lib/db/schema";

export const BRIEFING_SECTIONS = ["stack", "featured", "services", "brief"] as const;
export type BriefingSection = (typeof BRIEFING_SECTIONS)[number];

export const BRIEFING_DAYS = ["weekdays", "daily"] as const;
export type BriefingDays = (typeof BRIEFING_DAYS)[number];
export const BRIEFING_LENGTHS = ["detailed", "short"] as const;
export type BriefingLength = (typeof BRIEFING_LENGTHS)[number];
export const BRIEFING_PREVIEWS = ["full", "discreet"] as const;
export type BriefingPreview = (typeof BRIEFING_PREVIEWS)[number];
/** scheduled: at the chosen time; test: « Recevoir un briefing maintenant »; preview: « Voir un aperçu d'abord » (no push). */
export const BRIEFING_KINDS = ["scheduled", "test", "preview"] as const;
export type BriefingKind = (typeof BRIEFING_KINDS)[number];
/** Steps of « En préparation » (§ 6). */
export const BRIEFING_STEPS = ["stack", "services", "select", "ai", "done"] as const;
export type BriefingStep = (typeof BRIEFING_STEPS)[number];
/** pending: sentences being written; ok; error: the model failed (« Générer les résumés »); off: short, or no key. */
export const BRIEFING_AI = ["pending", "ok", "error", "off"] as const;
export type BriefingAi = (typeof BRIEFING_AI)[number];

/** A new Ma stack alert: its own data, never sent to the model (no AI sentence). */
export type StackPoint = {
  alertId: number;
  severity: Severity;
  title: string;
  ref: string;
  product: string;
  version: string;
  context: StackContext;
  exploited: boolean;
  fix: string | null;
};

/** A topic of À la une, Mes services or Le reste en bref. `sentence`: null until written (or rejected). */
export type TopicPoint = {
  topicId: number;
  title: string;
  sentence: string | null;
  sources: string[];
  forum: { name: string; slug: string };
};

export type BriefingContent = {
  stack: StackPoint[];
  /** Alerts to handle in all (« Voir les N alertes à traiter »). */
  stackOpen: number;
  featured: TopicPoint[];
  services: TopicPoint[];
  brief: TopicPoint[];
};

export const EMPTY_CONTENT: BriefingContent = { stack: [], stackOpen: 0, featured: [], services: [], brief: [] };

/** Topics of a briefing, in reading order (each appears once). */
export const topicPoints = (c: BriefingContent): TopicPoint[] => [...c.featured, ...c.services, ...c.brief];
export const pointCount = (c: BriefingContent) => c.stack.length + topicPoints(c).length;

/** « Rien de neuf » (§ 6): no new flaw, no topic picked up by several sources, no new version. */
export const isEmptyBriefing = (c: BriefingContent) => c.stack.length === 0 && c.featured.length === 0 && c.services.length === 0;

/** The sentence of a Ma stack point, built from its data (« CVE-2099-0001, exploitée. Corrigé en 1.2. »). */
export function stackSentence(p: Pick<StackPoint, "ref" | "exploited" | "fix">): string {
  return [`${p.ref}${p.exploited ? ", exploitée" : ""}.`, p.fix ? `Corrigé en ${p.fix}.` : ""].filter(Boolean).join(" ");
}

/** Reading time (§ 1): words / 200, rounded to the minute, 1 at least. */
export function readingMinutes(c: BriefingContent): number {
  const text = [
    ...c.stack.flatMap((p) => [p.title, stackSentence(p)]),
    ...topicPoints(c).flatMap((p) => [p.title, p.sentence ?? ""]),
  ].join(" ");
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

/** YYYY-MM-DD of a real day (the routes and the service worker accept nothing else). */
export function isBriefingDay(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return y >= 2020 && y <= 2100 && date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

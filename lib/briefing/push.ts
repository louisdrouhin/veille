/**
 * The morning notification (docs/design/3.4 § 2), built WITHOUT AI so that it goes out even when the model is down.
 * - Title: « Briefing · » + the most important point: critical flaws of Ma stack, else the number of flaws, else
 *   the first topic À la une, else « N points ce matin ».
 * - Body (2 lines at most): the Ma stack action, one topic À la une, the versions.
 * - A Ma stack point of the Travail context stays generic (no product, no version) even in « Aperçu complet »,
 *   like the alerts of 3.0; so does Homelab when its discreet notifications are on.
 * - « Discret »: no product name at all. No emoji, severity in words.
 * tag = briefing-AAAA-MM-JJ (a resend replaces it), url = /briefing/AAAA-MM-JJ.
 */
import type { PushPayload } from "@/lib/push/notify";
import { SEVERITY_LABEL } from "@/lib/stack/labels";
import { pointCount, readingMinutes, type BriefingContent, type BriefingPreview, type StackPoint } from "./types";

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;
const cut = (s: string, max = 70) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

export type Discretion = { discreetHomelab: boolean; discreetWork: boolean };

const generic = (p: StackPoint, d: Discretion) => (p.context === "work" ? true : d.discreetHomelab);

/** « Critique · Vaultwarden 1.32 : mettre à jour vers 1.33 », or generic for the Travail context. */
export function stackLine(p: StackPoint, d: Discretion): string {
  const sev = SEVERITY_LABEL[p.severity];
  if (generic(p, d)) return `${sev} · un logiciel ${p.context === "work" ? "du contexte Travail" : "de ta stack"} à mettre à jour.`;
  return p.fix ? `${sev} · ${p.product} ${p.version} : mettre à jour vers ${p.fix}.` : `${sev} · ${p.product} ${p.version} : ${p.ref}${p.exploited ? ", exploitée" : ""}.`;
}

export function briefingPayload(day: string, c: BriefingContent, preview: BriefingPreview, d: Discretion, badge: number): PushPayload {
  const base = { tag: `briefing-${day}`, url: `/briefing/${day}`, badge };
  const minutes = readingMinutes(c);
  if (preview === "discreet") {
    return { ...base, title: "Ton briefing du matin est prêt", body: `${minutes} min de lecture. Touche pour l'ouvrir.` };
  }
  const critical = c.stack.filter((p) => p.severity === "critical").length;
  let title: string;
  let featuredInTitle = false;
  if (critical) title = `Briefing · ${plural(critical, "faille critique", "failles critiques")} sur ta stack`;
  else if (c.stack.length) title = `Briefing · ${plural(c.stack.length, "faille", "failles")} sur ta stack`;
  else if (c.featured.length) {
    title = `Briefing · ${cut(c.featured[0]!.title)}`;
    featuredInTitle = true;
  } else title = `Briefing · ${plural(pointCount(c), "point", "points")} ce matin`;

  const lines: string[] = [];
  if (c.stack.length) lines.push(stackLine(c.stack[0]!, d));
  const topic = featuredInTitle ? c.featured[1] : c.featured[0];
  if (topic) lines.push(`À la une : ${cut(topic.title)}`);
  if (c.services.length) {
    const others = c.services.length - 1;
    lines.push(`${cut(c.services[0]!.title, 50)}${others ? ` et ${plural(others, "autre version", "autres versions")}` : ""}`);
  }
  return { ...base, title, body: lines.slice(0, 2).join("\n") || `${minutes} min de lecture. Touche pour l'ouvrir.` };
}

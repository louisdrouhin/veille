/**
 * The AI sentences of a briefing (docs/design/3.4 § 1): one call for all the points of À la une, Mes services and
 * Le reste en bref. The model receives ONLY the title and the feed excerpts of each topic's articles (the topic's
 * own and its reprises): never Ma stack, never a note. They are untrusted data, inside random markers, with the
 * rules of the summaries (lib/ai/prompts.ts). Each sentence is checked: plain text, short, and every number or
 * version it contains must be in the extracts; otherwise it is dropped and the point shows without sentence.
 * No "server-only": bundled by the worker.
 */
import { and, eq, inArray } from "drizzle-orm";
import type { AiConfig } from "@/lib/ai/config";
import { generateContent, type GeminiError } from "@/lib/ai/gemini";
import { newMarkerId, stripMarkers, untrustedRules } from "@/lib/ai/prompts";
import type { Db } from "@/lib/db";
import { replies, topics } from "@/lib/db/schema";
import type { BriefingContent, TopicPoint } from "./types";

const EXCERPT_CHARS = 600;
const REPRISES = 3;
/** « 2 lignes max » for À la une, « 1 ligne » / « 1 phrase » elsewhere. */
export const MAX_CHARS = { featured: 240, services: 160, brief: 140 } as const;
type Kind = keyof typeof MAX_CHARS;

const SYSTEM = `Tu écris le briefing du matin d'une application personnelle de veille technique.
Entrée : un objet JSON { "identifiant": { "type": "…", "titre": "…", "extraits": "…" } } : des sujets de la veille, avec le titre et les extraits des articles qui en parlent.
Tâche unique : pour chaque identifiant, une phrase en français qui dit l'essentiel du sujet, et répondre par un objet JSON { "identifiant": "phrase" } avec exactement les mêmes identifiants. Aucun texte hors du JSON.
- type « une » : deux phrases courtes au plus (240 caractères maximum).
- type « service » : une phrase sur ce qui change dans cette version, tirée des notes de version (160 caractères maximum).
- type « bref » : une phrase très courte (140 caractères maximum).
Reste strictement factuel et fidèle aux extraits : n'ajoute rien qui n'y est pas, aucun chiffre, aucune version, aucune date ni aucun nom absent des extraits, aucune opinion. Si les extraits ne disent rien d'utile, réponds par une chaîne vide pour cet identifiant.
Chaque phrase est du texte brut : jamais de HTML, de Markdown, de lien ni d'URL.`;

export type Extract = { id: string; kind: Kind; title: string; extracts: string };

/** Title and feed excerpts of each topic (its own, then up to 3 reprises): never a note. */
export async function loadExtracts(db: Db, c: BriefingContent): Promise<Extract[]> {
  const points: [Kind, TopicPoint][] = [...c.featured.map((p) => ["featured", p] as [Kind, TopicPoint]), ...c.services.map((p) => ["services", p] as [Kind, TopicPoint]), ...c.brief.map((p) => ["brief", p] as [Kind, TopicPoint])];
  const ids = points.map(([, p]) => p.topicId);
  if (!ids.length) return [];
  const [own, reps] = await Promise.all([
    db.select({ id: topics.id, excerpt: topics.excerpt }).from(topics).where(inArray(topics.id, ids)),
    // Reprises only (type `source`): a personal note is never read here.
    db
      .select({ topicId: replies.topicId, title: replies.title, content: replies.content })
      .from(replies)
      .where(and(inArray(replies.topicId, ids), eq(replies.type, "source")))
      .orderBy(replies.createdAt, replies.id),
  ]);
  const excerpt = new Map(own.map((r) => [r.id, r.excerpt]));
  return points.map(([kind, p], i) => {
    const mine = reps.filter((r) => r.topicId === p.topicId).slice(0, REPRISES);
    const text = [excerpt.get(p.topicId) ?? "", ...mine.map((r) => [r.title, r.content].filter(Boolean).join(" — "))]
      .filter(Boolean)
      .join("\n")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, EXCERPT_CHARS);
    return { id: `p${i + 1}`, kind, title: p.title, extracts: text };
  });
}

const TYPE: Record<Kind, string> = { featured: "une", services: "service", brief: "bref" };

export function sentencesMessage(list: readonly Extract[], marker: string): string {
  const data = Object.fromEntries(list.map((e) => [e.id, { type: TYPE[e.kind], titre: stripMarkers(e.title), extraits: stripMarkers(e.extracts) }]));
  return `<<<EXTRAITS ${marker}>>>\n${JSON.stringify(data, null, 1)}\n<<<FIN EXTRAITS ${marker}>>>`;
}

export const sentencesSystem = (marker: string) =>
  `${SYSTEM}\n\n${untrustedRules(marker, { what: "des titres et extraits d'articles web", mark: "EXTRAITS", self: "ces extraits" })}`;

const fold = (s: string) => s.toLowerCase().replace(/\s+/g, " ");
/** Numbers and versions (« 1.33 », « 2026 », « 7,5 »): each must be in the source text. */
const NUMBERS = /\d+(?:[.,]\d+)*/g;

/**
 * A sentence as kept, or null: plain text, at most `max` characters, no link nor markup, and no number or version
 * that the title and extracts do not contain.
 */
export function checkSentence(raw: unknown, source: string, max: number): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.replace(/\s+/g, " ").trim();
  if (!s || s.length > max) return null;
  if (/[<>]|https?:|www\.|\]\(|`/i.test(s)) return null;
  const hay = fold(source);
  for (const n of s.match(NUMBERS) ?? []) {
    if (!hay.includes(n.toLowerCase())) return null;
  }
  return s;
}

export type SentencesResult = { ok: true; content: BriefingContent; kept: number; rejected: number } | { ok: false; error: GeminiError | "invalid" };

/** Writes the sentences into a copy of the content (the points without a valid sentence keep `null`). */
export async function writeSentences(db: Db, c: BriefingContent, deps: { ai: AiConfig; fetch?: typeof fetch }): Promise<SentencesResult> {
  const list = await loadExtracts(db, c);
  if (!list.length) return { ok: true, content: c, kept: 0, rejected: 0 };
  const marker = newMarkerId();
  const res = await generateContent({
    apiKey: deps.ai.apiKey,
    model: deps.ai.model,
    system: sentencesSystem(marker),
    user: sentencesMessage(list, marker),
    maxOutputTokens: 2_048,
    temperature: 0.2,
    json: true,
    fetch: deps.fetch,
  });
  if (!res.ok) return { ok: false, error: res.error };
  let parsed: Record<string, unknown>;
  try {
    const v: unknown = JSON.parse(res.text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("not an object");
    parsed = v as Record<string, unknown>;
  } catch {
    return { ok: false, error: "invalid" };
  }
  let kept = 0;
  let rejected = 0;
  const byIndex = list.map((e) => {
    const s = checkSentence(parsed[e.id], `${e.title} ${e.extracts}`, MAX_CHARS[e.kind]);
    if (s) kept++;
    else if (typeof parsed[e.id] === "string" && (parsed[e.id] as string).trim()) rejected++;
    return s;
  });
  let i = 0;
  const fill = (points: TopicPoint[]) => points.map((p) => ({ ...p, sentence: byIndex[i++] ?? null }));
  const featured = fill(c.featured);
  const services = fill(c.services);
  const brief = fill(c.brief);
  return { ok: true, content: { ...c, featured, services, brief }, kept, rejected };
}

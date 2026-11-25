import "server-only";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { aiOutputs, articleContents, topics, type AiKind } from "@/lib/db/schema";
import { sanitizeArticleHtml } from "@/lib/reader/sanitize";
import { aiConfig, type AiConfig } from "./config";
import { GEMINI_ERROR_MESSAGES, generateContent, type GeminiError } from "./gemini";
import { markdownToHtml } from "./markdown";
import { articleMessage, newMarkerId, normalizeSummary, segmentsMessage, systemInstruction } from "./prompts";
import { takeAiCall } from "./rate-limit";
import { batchSegments, SegmentError, segmentArticle, type Segment } from "./segments";
import { articleText, isFrench, truncateForModel } from "./text";

/**
 * Version of what is stored per kind: a cached output of an older format is regenerated.
 * 2: summary with « À retenir », translation rebuilt from segments (images, links, tables kept).
 */
export const AI_FORMAT: Record<AiKind, number> = { summary: 2, translation: 2 };

export const SUMMARY_MAX_OUTPUT_TOKENS = 1024;
/** Characters of text per translation call (a long article is split, never cut). */
export const TRANSLATION_BATCH_CHARS = 8_000;
/** Beyond this, the article is not translated at all (≈ 20 calls) rather than partly. */
export const MAX_TRANSLATION_CHARS = 160_000;
/** Includes the « low » thinking of Flash models. */
const TRANSLATION_MAX_OUTPUT_TOKENS = 32_000;
const TRANSLATION_TIMEOUT_MS = 90_000;
/** Translation calls in parallel for one article. */
const TRANSLATION_CONCURRENCY = 3;

export type AiOutput = { html: string; truncated: boolean; model: string; inputCut: boolean };
export type AiResult = ({ ok: true; cached: boolean } & AiOutput) | { ok: false; error: string };

type Deps = { config?: AiConfig | null; fetch?: typeof fetch; now?: Date };
type Article = { title: string; url: string; html: string };

const inFlight = new Map<string, Promise<AiResult>>();

export const modelFor = (config: AiConfig, kind: AiKind) => (kind === "summary" ? config.model : config.translateModel);

/**
 * Summary or French translation of a topic's article, on demand. Order: cache (same model, same
 * article version, same format) → checks → per-user limit → Gemini (concurrent identical requests
 * share it) → our own HTML, sanitized → cache.
 */
export async function generateAi(db: Db, input: { topicId: number; kind: AiKind; userId: string }, deps: Deps = {}): Promise<AiResult> {
  const config = deps.config === undefined ? aiConfig() : deps.config;
  if (!config) return { ok: false, error: "Résumé et traduction indisponibles : aucune clé Gemini configurée." };
  const model = modelFor(config, input.kind);

  const [row] = await db
    .select({ title: topics.title, url: topics.url, html: articleContents.html, fetchedAt: articleContents.fetchedAt })
    .from(topics)
    .innerJoin(articleContents, eq(articleContents.topicId, topics.id))
    .where(eq(topics.id, input.topicId));
  if (!row?.html) return { ok: false, error: "Article non disponible : rien à traiter." };

  const [cached] = await db
    .select()
    .from(aiOutputs)
    .where(and(eq(aiOutputs.topicId, input.topicId), eq(aiOutputs.kind, input.kind), eq(aiOutputs.model, model)));
  if (cached && cached.format === AI_FORMAT[input.kind] && cached.articleFetchedAt.getTime() === row.fetchedAt.getTime()) {
    return { ok: true, cached: true, html: cached.html, truncated: cached.truncated, model: cached.model, inputCut: false };
  }

  const full = articleText(row.html);
  if (full.length < 40) return { ok: false, error: "Article trop court pour être traité." };
  if (input.kind === "translation") {
    if (isFrench(full)) return { ok: false, error: "L'article est déjà en français." };
    if (full.length > MAX_TRANSLATION_CHARS) return { ok: false, error: "Article trop long pour être traduit." };
  }

  const key = `${input.topicId}:${input.kind}:${model}`;
  const running = inFlight.get(key);
  if (running) return running;

  const limit = takeAiCall(input.userId, deps.now?.getTime());
  if (!limit.ok) return { ok: false, error: `Trop de demandes : réessaie dans ${limit.retryAfterSec} s.` };

  const article: Article = { title: row.title, url: row.url, html: row.html };
  const job = (async (): Promise<AiResult> => {
    const res = input.kind === "summary" ? await summarize(config, article, full, deps) : await translate(config, article, deps);
    if (!res.ok) {
      // Kind, topic and error only: never the key nor the article.
      console.error(`[ai] ${input.kind} topic ${input.topicId}: ${res.error}${res.detail ? ` (${res.detail})` : ""}`);
      return { ok: false, error: GEMINI_ERROR_MESSAGES[res.error] };
    }
    const values = {
      topicId: input.topicId,
      kind: input.kind,
      model,
      html: res.html,
      truncated: res.truncated,
      format: AI_FORMAT[input.kind],
      articleFetchedAt: row.fetchedAt,
    };
    await db
      .insert(aiOutputs)
      .values(values)
      .onConflictDoUpdate({
        target: [aiOutputs.topicId, aiOutputs.kind, aiOutputs.model],
        set: { html: res.html, truncated: res.truncated, format: values.format, articleFetchedAt: row.fetchedAt, createdAt: deps.now ?? new Date() },
      });
    return { ok: true, cached: false, html: res.html, truncated: res.truncated, model, inputCut: res.inputCut };
  })();
  inFlight.set(key, job);
  try {
    return await job;
  } finally {
    inFlight.delete(key);
  }
}

type Produced = { ok: true; html: string; truncated: boolean; inputCut: boolean } | { ok: false; error: GeminiError; detail?: string };

/** One call to the Lite model; Markdown rendered by our closed renderer, then sanitized. */
async function summarize(config: AiConfig, row: Article, full: string, deps: Deps): Promise<Produced> {
  const { text, cut } = truncateForModel(full);
  const id = newMarkerId();
  const res = await generateContent({
    apiKey: config.apiKey,
    model: config.model,
    system: systemInstruction("summary", id),
    user: articleMessage(row.title, text, id),
    maxOutputTokens: SUMMARY_MAX_OUTPUT_TOKENS,
    temperature: 0.2,
    fetch: deps.fetch,
  });
  if (!res.ok) return { ok: false, error: res.error, detail: res.status ? `HTTP ${res.status}` : undefined };
  const html = sanitizeArticleHtml(markdownToHtml(normalizeSummary(res.text)), row.url);
  if (!html.trim()) return { ok: false, error: "empty" };
  return { ok: true, html, truncated: res.truncated, inputCut: cut };
}

/**
 * The article cut into segments (lib/ai/segments.ts), sent in batches; each answer is checked
 * (same ids, plain text, same markers) and a refused batch is asked once more. Every segment must
 * come back, otherwise nothing is stored.
 */
async function translate(config: AiConfig, row: Article, deps: Deps): Promise<Produced> {
  const doc = segmentArticle(row.html);
  if (!doc.segments.length) return { ok: false, error: "empty" };
  const batches = batchSegments(doc.segments, TRANSLATION_BATCH_CHARS);

  async function one(batch: Segment[]): Promise<Produced | null> {
    let lastDetail = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      const id = newMarkerId();
      const res = await generateContent({
        apiKey: config.apiKey,
        model: config.translateModel,
        system: systemInstruction("translation", id),
        user: segmentsMessage(batch, id),
        maxOutputTokens: TRANSLATION_MAX_OUTPUT_TOKENS,
        temperature: 0.1,
        json: true,
        thinkingLevel: "low",
        timeoutMs: TRANSLATION_TIMEOUT_MS,
        fetch: deps.fetch,
      });
      if (!res.ok) return { ok: false, error: res.error, detail: res.status ? `HTTP ${res.status}` : undefined };
      try {
        if (res.truncated) throw new SegmentError("output limit reached");
        doc.accept(batch, JSON.parse(res.text.replace(/^```(?:json)?\s*|\s*```$/g, "")));
        return null;
      } catch (err) {
        lastDetail = err instanceof SegmentError ? err.message : "not JSON";
      }
    }
    return { ok: false, error: "invalid", detail: lastDetail };
  }

  const state: { next: number; failure: Produced | null } = { next: 0, failure: null };
  async function worker() {
    while (!state.failure && state.next < batches.length) {
      const res = await one(batches[state.next++]!);
      if (res) state.failure ??= res;
    }
  }
  await Promise.all(Array.from({ length: Math.min(TRANSLATION_CONCURRENCY, batches.length) }, worker));
  if (state.failure) return state.failure;

  try {
    const html = doc.html();
    if (!html.trim()) return { ok: false, error: "empty" };
    return { ok: true, html, truncated: false, inputCut: false };
  } catch (err) {
    return { ok: false, error: "invalid", detail: err instanceof SegmentError ? err.message : "rebuild" };
  }
}

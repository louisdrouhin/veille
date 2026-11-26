import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { aiOutputs, articleContents, replies, topics, type AiKind } from "@/lib/db/schema";
import { sanitizeArticleHtml } from "@/lib/reader/sanitize";
import { currentAiConfig } from "@/lib/secrets/effective";
import type { AiConfig } from "./config";
import { FALLBACK_ERRORS, GEMINI_ERROR_MESSAGES, generateContent, type GeminiError } from "./gemini";
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
/**
 * Time limits (the user waits on the page): each attempt has its own limit, and the whole request — attempts, retries
 * and the backup model — fits in AI_BUDGET_MS, under the 60 s a reverse proxy usually allows. The main model gets the
 * budget minus FALLBACK_RESERVE_MS when there is a backup model, so that the backup always has time to answer.
 */
export const AI_BUDGET_MS = 50_000;
export const FALLBACK_RESERVE_MS = 20_000;
export const ATTEMPT_MS = 25_000;
/** Translation calls in parallel for one article. */
const TRANSLATION_CONCURRENCY = 3;

/** `fallback`: made by the backup model (config.model) because the main one was overloaded or did not answer in time. */
export type AiOutput = { html: string; truncated: boolean; model: string; inputCut: boolean; fallback?: boolean };
export type AiResult = ({ ok: true; cached: boolean } & AiOutput) | { ok: false; error: string };

type Deps = { config?: AiConfig | null; fetch?: typeof fetch; now?: Date; budgetMs?: number };
type Article = { title: string; url: string; html: string };

const inFlight = new Map<string, Promise<AiResult>>();

export const modelFor = (config: AiConfig, kind: AiKind) => (kind === "summary" ? config.model : config.translateModel);

/**
 * The backup model of a kind: Flash-Lite (config.model) for the translation, when it differs from the main one.
 * Used only after an overload, a server error or a timeout of the main model (FALLBACK_ERRORS, its retries done).
 */
export const fallbackModelFor = (config: AiConfig, kind: AiKind): string | null =>
  kind === "translation" && config.model !== config.translateModel ? config.model : null;

/**
 * Summary or French translation of a topic's article, on demand. Order: cache (same model, same
 * article version, same format) → checks → per-user limit → Gemini (concurrent identical requests
 * share it) → our own HTML, sanitized → cache.
 */
export async function generateAi(
  db: Db,
  input: { topicId: number; kind: AiKind; userId: string; /** « Refaire avec le modèle principal »: no backup, no backup cache. */ primary?: boolean },
  deps: Deps = {},
): Promise<AiResult> {
  const config = deps.config === undefined ? await currentAiConfig(db) : deps.config;
  if (!config) return { ok: false, error: "Résumé et traduction indisponibles : aucune clé Gemini configurée." };
  const model = modelFor(config, input.kind);
  const backup = input.primary ? null : fallbackModelFor(config, input.kind);

  const [row] = await db
    .select({ title: topics.title, url: topics.url, html: articleContents.html, fetchedAt: articleContents.fetchedAt })
    .from(topics)
    .innerJoin(articleContents, eq(articleContents.topicId, topics.id))
    .where(eq(topics.id, input.topicId));
  if (!row?.html) return { ok: false, error: "Article non disponible : rien à traiter." };

  const cachedRows = await db
    .select()
    .from(aiOutputs)
    .where(and(eq(aiOutputs.topicId, input.topicId), eq(aiOutputs.kind, input.kind), inArray(aiOutputs.model, backup ? [model, backup] : [model])));
  const fresh = (r: (typeof cachedRows)[number]) => r.format === AI_FORMAT[input.kind] && r.articleFetchedAt.getTime() === row.fetchedAt.getTime();
  // The main model's result first; else a backup result made when the main one was overloaded.
  const cached =
    cachedRows.find((r) => r.model === model && !r.fallback && fresh(r)) ?? cachedRows.find((r) => r.model === backup && r.fallback && fresh(r));
  if (cached) {
    console.info(`[ai] ${input.kind} topic ${input.topicId}: cache (${cached.model}${cached.fallback ? ", secours" : ""})`);
    return { ok: true, cached: true, html: cached.html, truncated: cached.truncated, model: cached.model, inputCut: false, fallback: cached.fallback };
  }

  const own = articleText(row.html);
  // « Résumer les N sources » (docs/design/3.3 § 0): a merged topic is summarized with its reprises (title and
  // excerpt of each, capped). Same untrusted block as the article; never a personal note.
  const reprises =
    input.kind === "summary"
      ? await db
          .select({ author: replies.author, title: replies.title, content: replies.content })
          .from(replies)
          .where(and(eq(replies.topicId, input.topicId), eq(replies.type, "source")))
          .orderBy(asc(replies.createdAt), asc(replies.id))
      : [];
  const full = reprises.length ? `${own}\n\n${repriseBlock(reprises)}` : own;
  if (full.length < 40) return { ok: false, error: "Article trop court pour être traité." };
  if (input.kind === "translation") {
    if (isFrench(full)) return { ok: false, error: "L'article est déjà en français." };
    if (full.length > MAX_TRANSLATION_CHARS) return { ok: false, error: "Article trop long pour être traduit." };
  }

  const key = `${input.topicId}:${input.kind}:${model}:${backup ?? "-"}`;
  const running = inFlight.get(key);
  if (running) return running;

  const limit = takeAiCall(input.userId, deps.now?.getTime());
  if (!limit.ok) return { ok: false, error: `Trop de demandes : réessaie dans ${limit.retryAfterSec} s.` };

  const article: Article = { title: row.title, url: row.url, html: row.html };
  const job = (async (): Promise<AiResult> => {
    const started = Date.now();
    const deadline = started + (deps.budgetMs ?? AI_BUDGET_MS);
    const log = (line: string) => console.info(`[ai] ${input.kind} topic ${input.topicId}: ${line}`);
    const run = (m: string, until: number) =>
      input.kind === "summary" ? summarize(config, article, full, deps, until, log) : translate(config, m, article, deps, until, log);
    // With a backup model, the main one leaves it FALLBACK_RESERVE_MS.
    let res = await run(model, backup ? deadline - Math.min(FALLBACK_RESERVE_MS, (deps.budgetMs ?? AI_BUDGET_MS) / 2) : deadline);
    let used = model;
    if (!res.ok) {
      // Kind, topic and error only: never the key nor the article.
      console.error(`[ai] ${input.kind} topic ${input.topicId}: ${res.error}${res.detail ? ` (${res.detail})` : ""} après ${Date.now() - started} ms (${model})`);
      if (!backup || !FALLBACK_ERRORS.has(res.error)) return { ok: false, error: GEMINI_ERROR_MESSAGES[res.error] };
      console.info(`[ai] ${input.kind} topic ${input.topicId}: modèle de secours ${backup} (${model} : ${res.error})`);
      used = backup;
      res = await run(backup, deadline);
      if (!res.ok) {
        console.error(`[ai] ${input.kind} topic ${input.topicId}: secours en échec : ${res.error}${res.detail ? ` (${res.detail})` : ""}`);
        return { ok: false, error: GEMINI_ERROR_MESSAGES[res.error] };
      }
    }
    const fallback = used !== model;
    console.info(`[ai] ${input.kind} topic ${input.topicId}: generated (${used}${fallback ? ", secours" : ""}, ${Date.now() - started} ms)`);
    const values = {
      topicId: input.topicId,
      kind: input.kind,
      model: used,
      html: res.html,
      truncated: res.truncated,
      format: AI_FORMAT[input.kind],
      fallback,
      articleFetchedAt: row.fetchedAt,
    };
    await db
      .insert(aiOutputs)
      .values(values)
      .onConflictDoUpdate({
        target: [aiOutputs.topicId, aiOutputs.kind, aiOutputs.model],
        set: { html: res.html, truncated: res.truncated, format: values.format, fallback, articleFetchedAt: row.fetchedAt, createdAt: deps.now ?? new Date() },
      });
    return { ok: true, cached: false, html: res.html, truncated: res.truncated, model: used, inputCut: res.inputCut, fallback };
  })();
  inFlight.set(key, job);
  try {
    return await job;
  } finally {
    inFlight.delete(key);
  }
}

export type StoredAiOutputs = Partial<Record<AiKind, AiOutput>>;

/**
 * The results already stored for this version of the article (current models and format), for
 * the server render of the topic page: shown without any call to Gemini, on every device.
 */
export async function getStoredAiOutputs(db: Db, topicId: number, articleFetchedAt: Date, config: AiConfig): Promise<StoredAiOutputs> {
  const rows = await db
    .select()
    .from(aiOutputs)
    .where(and(eq(aiOutputs.topicId, topicId), inArray(aiOutputs.model, [config.model, config.translateModel])));
  const out: StoredAiOutputs = {};
  for (const r of rows) {
    if (r.format !== AI_FORMAT[r.kind] || r.articleFetchedAt.getTime() !== articleFetchedAt.getTime()) continue;
    const main = r.model === modelFor(config, r.kind) && !r.fallback;
    const backup = r.fallback && r.model === fallbackModelFor(config, r.kind);
    // The main model's result wins over a backup one.
    if (main || (backup && !out[r.kind])) out[r.kind] = { html: r.html, truncated: r.truncated, model: r.model, inputCut: false, fallback: !main };
  }
  return out;
}

/** The other sources of a merged topic, for its summary: at most 6 000 characters. */
export function repriseBlock(rows: { author: string; title: string | null; content: string }[], max = 6_000): string {
  let out = "Autres sources sur ce même sujet :";
  for (const r of rows) {
    const line = `\n- ${r.author} : ${r.title ?? ""}${r.content ? ` — ${r.content}` : ""}`.replace(/\s+$/, "");
    if (out.length + line.length > max) break;
    out += line;
  }
  return out;
}

type Produced = { ok: true; html: string; truncated: boolean; inputCut: boolean } | { ok: false; error: GeminiError; detail?: string };

/** One call to the Lite model; Markdown rendered by our closed renderer, then sanitized. */
async function summarize(config: AiConfig, row: Article, full: string, deps: Deps, deadline: number, log: (l: string) => void): Promise<Produced> {
  const { text, cut } = truncateForModel(full);
  const id = newMarkerId();
  const res = await generateContent({
    apiKey: config.apiKey,
    model: config.model,
    system: systemInstruction("summary", id),
    user: articleMessage(row.title, text, id),
    maxOutputTokens: SUMMARY_MAX_OUTPUT_TOKENS,
    temperature: 0.2,
    timeoutMs: ATTEMPT_MS,
    deadline,
    log,
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
async function translate(config: AiConfig, model: string, row: Article, deps: Deps, deadline: number, log: (l: string) => void): Promise<Produced> {
  const doc = segmentArticle(row.html);
  if (!doc.segments.length) return { ok: false, error: "empty" };
  const batches = batchSegments(doc.segments, TRANSLATION_BATCH_CHARS);

  async function one(batch: Segment[]): Promise<Produced | null> {
    let lastDetail = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      const id = newMarkerId();
      const res = await generateContent({
        apiKey: config.apiKey,
        model,
        system: systemInstruction("translation", id),
        user: segmentsMessage(batch, id),
        maxOutputTokens: TRANSLATION_MAX_OUTPUT_TOKENS,
        temperature: 0.1,
        json: true,
        thinkingLevel: "low",
        timeoutMs: ATTEMPT_MS,
        deadline,
        log,
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

import "server-only";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { aiOutputs, articleContents, topics, type AiKind } from "@/lib/db/schema";
import { sanitizeArticleHtml } from "@/lib/reader/sanitize";
import { aiConfig, type AiConfig } from "./config";
import { GEMINI_ERROR_MESSAGES, generateContent } from "./gemini";
import { markdownToHtml } from "./markdown";
import { articleMessage, newMarkerId, systemInstruction } from "./prompts";
import { takeAiCall } from "./rate-limit";
import { articleText, isFrench, truncateForModel } from "./text";

export const MAX_OUTPUT_TOKENS: Record<AiKind, number> = { summary: 1024, translation: 12_000 };

export type AiOutput = { html: string; truncated: boolean; model: string; inputCut: boolean };
export type AiResult = ({ ok: true; cached: boolean } & AiOutput) | { ok: false; error: string };

type Deps = { config?: AiConfig | null; fetch?: typeof fetch; now?: Date };

const inFlight = new Map<string, Promise<AiResult>>();

/**
 * Summary or French translation of a topic's article, on demand. Order: cache (same model, same
 * article version) → checks → per-user limit → one Gemini call (concurrent identical requests
 * share it) → Markdown rendered by our closed renderer → reading-mode sanitizer → cache.
 */
export async function generateAi(db: Db, input: { topicId: number; kind: AiKind; userId: string }, deps: Deps = {}): Promise<AiResult> {
  const config = deps.config === undefined ? aiConfig() : deps.config;
  if (!config) return { ok: false, error: "Résumé et traduction indisponibles : aucune clé Gemini configurée." };

  const [row] = await db
    .select({ title: topics.title, url: topics.url, html: articleContents.html, fetchedAt: articleContents.fetchedAt })
    .from(topics)
    .innerJoin(articleContents, eq(articleContents.topicId, topics.id))
    .where(eq(topics.id, input.topicId));
  if (!row?.html) return { ok: false, error: "Article non disponible : rien à traiter." };

  const [cached] = await db
    .select()
    .from(aiOutputs)
    .where(and(eq(aiOutputs.topicId, input.topicId), eq(aiOutputs.kind, input.kind), eq(aiOutputs.model, config.model)));
  if (cached && cached.articleFetchedAt.getTime() === row.fetchedAt.getTime()) {
    return { ok: true, cached: true, html: cached.html, truncated: cached.truncated, model: cached.model, inputCut: false };
  }

  const full = articleText(row.html);
  if (full.length < 40) return { ok: false, error: "Article trop court pour être traité." };
  if (input.kind === "translation" && isFrench(full)) return { ok: false, error: "L'article est déjà en français." };

  const key = `${input.topicId}:${input.kind}:${config.model}`;
  const running = inFlight.get(key);
  if (running) return running;

  const limit = takeAiCall(input.userId, deps.now?.getTime());
  if (!limit.ok) return { ok: false, error: `Trop de demandes : réessaie dans ${limit.retryAfterSec} s.` };

  const job = (async (): Promise<AiResult> => {
    const { text, cut } = truncateForModel(full);
    const id = newMarkerId();
    const res = await generateContent({
      apiKey: config.apiKey,
      model: config.model,
      system: systemInstruction(input.kind, id),
      user: articleMessage(row.title, text, id),
      maxOutputTokens: MAX_OUTPUT_TOKENS[input.kind],
      fetch: deps.fetch,
    });
    if (!res.ok) {
      // Status only: never the key nor the article.
      console.error(`[ai] ${input.kind} topic ${input.topicId}: ${res.error}${res.status ? ` (HTTP ${res.status})` : ""}`);
      return { ok: false, error: GEMINI_ERROR_MESSAGES[res.error] };
    }
    const html = sanitizeArticleHtml(markdownToHtml(res.text), row.url);
    if (!html.trim()) return { ok: false, error: GEMINI_ERROR_MESSAGES.empty };
    const values = { topicId: input.topicId, kind: input.kind, model: config.model, html, truncated: res.truncated, articleFetchedAt: row.fetchedAt };
    await db
      .insert(aiOutputs)
      .values(values)
      .onConflictDoUpdate({
        target: [aiOutputs.topicId, aiOutputs.kind, aiOutputs.model],
        set: { html, truncated: res.truncated, articleFetchedAt: row.fetchedAt, createdAt: deps.now ?? new Date() },
      });
    return { ok: true, cached: false, html, truncated: res.truncated, model: config.model, inputCut: cut };
  })();
  inFlight.set(key, job);
  try {
    return await job;
  } finally {
    inFlight.delete(key);
  }
}

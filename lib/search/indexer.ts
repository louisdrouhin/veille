/**
 * Search index (docs/design/3.3 § 1), run by the worker after each cycle:
 * 1. plain text of the stored articles (exact search; made again when the article is reloaded);
 * 2. embeddings of the topics not indexed yet with the current model (or whose article changed), newest
 *    first, by batches, within the daily limit. The text sent is the title, the feed excerpt and the
 *    start of the article: public content only, never a personal note (they are not even read here).
 * Progress: indexProgress() (« Indexation en cours : 62 % »). No "server-only": bundled by the worker.
 */
import { and, count, desc, eq, isNotNull, isNull, lt, ne, or } from "drizzle-orm";
import type { AiConfig } from "@/lib/ai/config";
import { documentText, EMBED_BATCH, EMBED_ERRORS, embedTexts, embeddingModel, EMBEDDING_DIM, type EmbedError } from "@/lib/ai/embeddings";
import { articleText } from "@/lib/ai/text";
import type { Db } from "@/lib/db";
import { articleContents, articleEmbeddings, topics } from "@/lib/db/schema";
import { dailyLimit, release, reserve } from "./usage";
import { encodeVector } from "./vectors";

type Env = Partial<Record<string, string | undefined>>;
export const ARTICLE_TEXT_MAX = 20_000;
/** Articles indexed at most per worker cycle (EMBED_PER_CYCLE overrides it). */
export const DEFAULT_EMBED_PER_CYCLE = 200;

export function embedPerCycle(env: Partial<Record<string, string | undefined>> = process.env): number {
  return Math.max(1, Number(env.EMBED_PER_CYCLE) || DEFAULT_EMBED_PER_CYCLE);
}

/** Plain text of the articles stored or reloaded since their last pass. Returns how many were done. */
export async function refreshArticleTexts(db: Db, limit = 200): Promise<number> {
  const rows = await db
    .select({ topicId: articleContents.topicId, html: articleContents.html, fetchedAt: articleContents.fetchedAt })
    .from(articleContents)
    .where(or(isNull(articleContents.textOf), ne(articleContents.textOf, articleContents.fetchedAt)))
    .limit(limit);
  for (const r of rows) {
    const text = r.html ? articleText(r.html).slice(0, ARTICLE_TEXT_MAX) : null;
    await db.update(articleContents).set({ text, textOf: r.fetchedAt }).where(eq(articleContents.topicId, r.topicId));
  }
  return rows.length;
}

export type IndexRun = { indexed: number; error?: EmbedError | "limit" };

/** Embeddings of up to `budget` topics waiting for one. */
export async function indexPending(
  db: Db,
  deps: { ai: AiConfig | null; env?: Env; fetch?: typeof fetch; log?: (...a: unknown[]) => void; budget?: number; now?: Date },
): Promise<IndexRun> {
  if (!deps.ai) return { indexed: 0 };
  const env = deps.env ?? process.env;
  const model = embeddingModel(env);
  const waiting = await db
    .select({ id: topics.id, title: topics.title, excerpt: topics.excerpt, text: articleContents.text, textOf: articleContents.textOf })
    .from(topics)
    .leftJoin(articleContents, eq(articleContents.topicId, topics.id))
    .leftJoin(articleEmbeddings, eq(articleEmbeddings.topicId, topics.id))
    .where(
      or(
        isNull(articleEmbeddings.topicId),
        ne(articleEmbeddings.model, model),
        // The article was fetched (or reloaded) after the topic was indexed.
        and(isNotNull(articleContents.text), or(isNull(articleEmbeddings.articleOf), lt(articleEmbeddings.articleOf, articleContents.textOf))),
      ),
    )
    .orderBy(desc(topics.publishedAt), desc(topics.id))
    .limit(deps.budget ?? 200);
  if (waiting.length === 0) return { indexed: 0 };

  const granted = await reserve(db, "embed", waiting.length, dailyLimit("embed", env), deps.now);
  if (granted === 0) {
    deps.log?.(`[index] limite quotidienne atteinte (${dailyLimit("embed", env)} textes) : reprise demain`);
    return { indexed: 0, error: "limit" };
  }

  let indexed = 0;
  const todo = waiting.slice(0, granted);
  for (let i = 0; i < todo.length; i += EMBED_BATCH) {
    const batch = todo.slice(i, i + EMBED_BATCH);
    const res = await embedTexts({
      apiKey: deps.ai.apiKey,
      model,
      texts: batch.map((t) => documentText(t.title, [t.excerpt, t.text ?? ""].filter(Boolean).join("\n"))),
      fetch: deps.fetch,
    });
    if (!res.ok) {
      await release(db, "embed", todo.length - i, deps.now);
      deps.log?.(`[index] ${indexed} indexé(s), arrêt : ${EMBED_ERRORS[res.error]}${res.status ? ` (HTTP ${res.status})` : ""}`);
      return { indexed, error: res.error };
    }
    const now = new Date();
    for (const [j, t] of batch.entries()) {
      const row = { model, dim: EMBEDDING_DIM, vector: encodeVector(res.vectors[j]!), articleOf: t.text ? t.textOf : null, indexedAt: now };
      await db.insert(articleEmbeddings).values({ topicId: t.id, ...row }).onConflictDoUpdate({ target: articleEmbeddings.topicId, set: row });
    }
    indexed += batch.length;
  }
  if (granted < waiting.length) deps.log?.(`[index] limite quotidienne atteinte après ${indexed} texte(s)`);
  return { indexed, ...(granted < waiting.length ? { error: "limit" as const } : {}) };
}

export type IndexProgress = { indexed: number; total: number; model: string };

/** « Indexation en cours : 62 % »: topics indexed with the current model, of all. */
export async function indexProgress(db: Db, env: Env = process.env): Promise<IndexProgress> {
  const model = embeddingModel(env);
  const [[t], [e]] = await Promise.all([
    db.select({ n: count() }).from(topics),
    db.select({ n: count() }).from(articleEmbeddings).where(eq(articleEmbeddings.model, model)),
  ]);
  return { indexed: Math.min(e?.n ?? 0, t?.n ?? 0), total: t?.n ?? 0, model };
}

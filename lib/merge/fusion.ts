/**
 * Fusion of duplicates (docs/design/3.3 § 2). A new article close enough by meaning to a topic of the last
 * 72 hours becomes a « reprise » of it (a reply of type `source`): the topic keeps the title and article #1
 * of the first source, goes up, and is unread again. « Séparer » makes it a topic of its own and remembers
 * not to merge it there again. Works on vectors already computed (lib/search/indexer.ts): no model call.
 * No "server-only": the worker bundles it.
 */
import { and, asc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { EMBEDDING_DIM, embeddingModel, normalize } from "@/lib/ai/embeddings";
import { detectLanguage } from "@/lib/ai/text";
import type { Db } from "@/lib/db";
import { aiOutputs, articleEmbeddings, mergeBlocks, replies, replyEmbeddings, sources, topics } from "@/lib/db/schema";
import { decodeVector, loadCorpus, nearest, similarity } from "@/lib/search/vectors";

type Env = Partial<Record<string, string | undefined>>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export const DEFAULT_MERGE_THRESHOLD = 0.87;
export const MERGE_WINDOW_MS = 72 * 3_600_000;
/** « Sujets proches »: at or above this similarity (RELATED_MIN overrides). */
export const RELATED_MIN = 0.78;

/** Paramètres › Intégrations (merge_threshold) or MERGE_THRESHOLD: 0.50 to 0.99. */
export function mergeThreshold(env: Env = process.env): number {
  const n = Number(env.MERGE_THRESHOLD);
  return Number.isFinite(n) && n >= 0.5 && n <= 0.99 ? n : DEFAULT_MERGE_THRESHOLD;
}

export type MergeRun = { checked: number; merged: number };

/**
 * New topics (merge_checked_at null) compared, oldest arrival first, with the topics that arrived before them
 * in the last 72 hours. A topic without a vector yet waits for the next cycle (within the 72 hours).
 */
export async function mergePending(db: Db, deps: { env?: Env; now?: Date; log?: (...a: unknown[]) => void; limit?: number } = {}): Promise<MergeRun> {
  const env = deps.env ?? process.env;
  const now = deps.now ?? new Date();
  const since = new Date(now.getTime() - MERGE_WINDOW_MS);
  const model = embeddingModel(env);
  const threshold = mergeThreshold(env);
  const pending = await db
    .select({ id: topics.id, createdAt: topics.createdAt, readAt: topics.readAt, normalizedUrl: topics.normalizedUrl, vector: articleEmbeddings.vector, model: articleEmbeddings.model })
    .from(topics)
    .leftJoin(articleEmbeddings, eq(articleEmbeddings.topicId, topics.id))
    .where(isNull(topics.mergeCheckedAt))
    .orderBy(asc(topics.createdAt), asc(topics.id))
    .limit(deps.limit ?? 200);
  if (!pending.length) return { checked: 0, merged: 0 };

  // The topics a newcomer can join: arrived in the window and already checked (kept as topics).
  const windowRows = await db
    .select({ id: topics.id, vector: articleEmbeddings.vector })
    .from(topics)
    .innerJoin(articleEmbeddings, and(eq(articleEmbeddings.topicId, topics.id), eq(articleEmbeddings.model, model)))
    .where(and(gte(topics.createdAt, since), sql`${topics.mergeCheckedAt} is not null`));
  const candidates = new Map(windowRows.map((r) => [r.id, decodeVector(r.vector)]));

  let checked = 0;
  let merged = 0;
  for (const c of pending) {
    const tooOld = c.createdAt < since;
    // First import of a source (already read) or out of the window: kept as is.
    if (tooOld || c.readAt !== null) {
      await markChecked(db, c.id, now);
      checked++;
      continue;
    }
    if (!c.vector || c.model !== model) continue; // not indexed yet: next cycle
    const v = decodeVector(c.vector);
    const blocked = new Set((await db.select({ id: mergeBlocks.topicId }).from(mergeBlocks).where(eq(mergeBlocks.normalizedUrl, c.normalizedUrl))).map((r) => r.id));
    let best: { id: number; score: number } | null = null;
    for (const [id, other] of candidates) {
      if (id === c.id || blocked.has(id)) continue;
      const score = similarity(v, other);
      if (score >= threshold && (!best || score > best.score)) best = { id, score };
    }
    if (best) {
      await mergeArticle(db, c.id, best.id);
      merged++;
    } else {
      await markChecked(db, c.id, now);
      candidates.set(c.id, v);
    }
    checked++;
  }
  if (merged) deps.log?.(`[fusion] ${merged} article(s) regroupé(s) dans un topic existant`);
  return { checked, merged };
}

const markChecked = (db: Db | Tx, id: number, now: Date) => db.update(topics).set({ mergeCheckedAt: now }).where(eq(topics.id, id));

/**
 * Turns the topic `articleId` (a new article) into a « reprise » of `intoId`: a reply with its title, excerpt,
 * source, URL and vector; the topic goes up, is unread again, and its summary is made again (one more source).
 * Returns the reply id.
 */
export async function mergeArticle(db: Db, articleId: number, intoId: number): Promise<number> {
  return db.transaction(async (tx) => {
    const [a] = await tx
      .select({ topic: topics, sourceName: sources.name, vector: articleEmbeddings.vector, model: articleEmbeddings.model, dim: articleEmbeddings.dim })
      .from(topics)
      .leftJoin(sources, eq(sources.id, topics.sourceId))
      .leftJoin(articleEmbeddings, eq(articleEmbeddings.topicId, topics.id))
      .where(eq(topics.id, articleId));
    if (!a) throw new Error("article introuvable");
    const t = a.topic;
    const [reply] = await tx
      .insert(replies)
      .values({
        topicId: intoId,
        type: "source",
        author: a.sourceName ?? "Source supprimée",
        content: t.excerpt,
        url: t.url,
        title: t.title,
        sourceId: t.sourceId,
        normalizedUrl: t.normalizedUrl,
        lang: detectLanguage(`${t.title}. ${t.excerpt}`),
        createdAt: t.publishedAt,
      })
      .returning({ id: replies.id });
    if (a.vector && a.model && a.dim) await tx.insert(replyEmbeddings).values({ replyId: reply!.id, model: a.model, dim: a.dim, vector: a.vector });
    await tx
      .update(topics)
      .set({ replyCount: sql`${topics.replyCount} + 1`, // ISO string: postgres.js does not serialize a Date inside a raw sql fragment (PGlite does).
        lastActivityAt: sql`greatest(${topics.lastActivityAt}, ${t.publishedAt.toISOString()}::timestamptz)`, readAt: null })
      .where(eq(topics.id, intoId));
    // « Résumer les N sources »: the stored summary no longer covers every source.
    await tx.delete(aiOutputs).where(and(eq(aiOutputs.topicId, intoId), eq(aiOutputs.kind, "summary")));
    await tx.delete(topics).where(eq(topics.id, articleId));
    return reply!.id;
  });
}

/**
 * « Séparer de ce topic »: the reprise becomes a topic again (same title, URL, source, vector), read, and is
 * never merged into this topic again. Returns the new topic and the one it left.
 */
export async function separateReprise(db: Db, replyId: number, now = new Date()): Promise<{ topicId: number; fromTopicId: number } | null> {
  return db.transaction(async (tx) => {
    const [r] = await tx
      .select({ reply: replies, forumId: topics.forumId, emb: replyEmbeddings })
      .from(replies)
      .innerJoin(topics, eq(topics.id, replies.topicId))
      .leftJoin(replyEmbeddings, eq(replyEmbeddings.replyId, replies.id))
      .where(and(eq(replies.id, replyId), eq(replies.type, "source")));
    if (!r || !r.reply.normalizedUrl || !r.reply.url) return null;
    const rep = r.reply;
    await tx.delete(replies).where(eq(replies.id, rep.id));
    const [topic] = await tx
      .insert(topics)
      .values({
        forumId: r.forumId,
        sourceId: rep.sourceId,
        title: rep.title ?? rep.content.slice(0, 120),
        url: rep.url!,
        normalizedUrl: rep.normalizedUrl!,
        excerpt: rep.content,
        publishedAt: rep.createdAt,
        lastActivityAt: rep.createdAt,
        readAt: now,
        mergeCheckedAt: now,
      })
      .returning({ id: topics.id });
    if (r.emb) await tx.insert(articleEmbeddings).values({ topicId: topic!.id, model: r.emb.model, dim: r.emb.dim, vector: r.emb.vector, articleOf: null });
    await tx.update(topics).set({ replyCount: sql`greatest(0, ${topics.replyCount} - 1)` }).where(eq(topics.id, rep.topicId));
    await tx.delete(aiOutputs).where(and(eq(aiOutputs.topicId, rep.topicId), eq(aiOutputs.kind, "summary")));
    await tx.insert(mergeBlocks).values({ topicId: rep.topicId, normalizedUrl: rep.normalizedUrl! }).onConflictDoNothing();
    return { topicId: topic!.id, fromTopicId: rep.topicId };
  });
}

/** « Annuler » after « Séparer »: back as a reprise of the topic it left (the block is forgotten). */
export async function undoSeparate(db: Db, topicId: number, fromTopicId: number): Promise<boolean> {
  const [t] = await db.select({ url: topics.normalizedUrl }).from(topics).where(eq(topics.id, topicId));
  const [from] = await db.select({ id: topics.id }).from(topics).where(eq(topics.id, fromTopicId));
  if (!t || !from) return false;
  await db.delete(mergeBlocks).where(and(eq(mergeBlocks.topicId, fromTopicId), eq(mergeBlocks.normalizedUrl, t.url)));
  await mergeArticle(db, topicId, fromTopicId);
  return true;
}

/** Vector of a topic: its article, averaged with its reprises (a merged topic is about all its sources). */
export async function topicVector(db: Db, topicId: number, model: string): Promise<Float32Array | null> {
  const [own, reps] = await Promise.all([
    db.select({ v: articleEmbeddings.vector }).from(articleEmbeddings).where(and(eq(articleEmbeddings.topicId, topicId), eq(articleEmbeddings.model, model))),
    db
      .select({ v: replyEmbeddings.vector })
      .from(replyEmbeddings)
      .innerJoin(replies, eq(replies.id, replyEmbeddings.replyId))
      .where(and(eq(replies.topicId, topicId), eq(replyEmbeddings.model, model))),
  ]);
  const all = [...own, ...reps].map((r) => decodeVector(r.v)).filter((v) => v.length === EMBEDDING_DIM);
  if (!all.length) return null;
  const sum = new Float32Array(EMBEDDING_DIM);
  for (const v of all) for (let i = 0; i < sum.length; i++) sum[i]! += v[i]!;
  return normalize(sum);
}

/** « Sujets proches »: the nearest topics of the whole watch (any date), above the threshold. */
export async function relatedTopicIds(db: Db, topicId: number, opts: { env?: Env; limit?: number } = {}): Promise<number[]> {
  const env = opts.env ?? process.env;
  const model = embeddingModel(env);
  const v = await topicVector(db, topicId, model);
  if (!v) return [];
  const corpus = await loadCorpus(db, model);
  const min = Number(env.RELATED_MIN) || RELATED_MIN;
  return nearest(corpus, v, { limit: opts.limit ?? 5, threshold: min, exclude: new Set([topicId]) }).map((n) => n.topicId);
}

/** Normalized URLs already known as reprises: a feed returning them again does not create a topic. */
export async function knownReprises(db: Db, urls: string[]): Promise<Set<string>> {
  if (!urls.length) return new Set();
  const rows = await db.select({ u: replies.normalizedUrl }).from(replies).where(inArray(replies.normalizedUrl, urls));
  return new Set(rows.map((r) => r.u!).filter(Boolean));
}

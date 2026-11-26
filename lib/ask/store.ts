/**
 * Answers cache and question history of « Demande à ta veille » (docs/design/3.3 § 4, « Historique et cache »).
 */
import { createHash } from "node:crypto";
import { and, count, desc, eq, inArray, lt, max, notInArray, sql } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { articleEmbeddings, askAnswers, askHistory, replies, topics } from "@/lib/db/schema";
import { fold } from "@/lib/search/fold";
import type { CheckedAnswer } from "./answer";
import type { AskScope } from "./scope";

export const CACHE_MS = 6 * 3_600_000;
export const HISTORY_MAX = 20;

/** Version of the index: any new topic, reprise or vector changes it (a cached answer is then written again). */
export async function indexVersion(db: Db): Promise<string> {
  const [[t], [r], [e]] = await Promise.all([
    db.select({ n: count(), last: max(topics.id) }).from(topics),
    db.select({ last: max(replies.id) }).from(replies).where(eq(replies.type, "source")),
    db.select({ last: max(articleEmbeddings.indexedAt) }).from(articleEmbeddings),
  ]);
  return `${t?.n ?? 0}.${t?.last ?? 0}.${r?.last ?? 0}.${e?.last?.getTime() ?? 0}`;
}

/** Per model too: an answer of the backup model is cached apart from the main one's. */
export function cacheKey(question: string, scope: AskScope, version: string, model: string): string {
  const q = fold(question).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return createHash("sha256").update(JSON.stringify([q, scope.period, [...scope.forums].sort(), version, model])).digest("base64url");
}

export type CachedAnswer = { answer: CheckedAnswer; sources: number[] };

export async function readCache(db: Db, key: string, now = new Date()): Promise<CachedAnswer | null> {
  const [row] = await db.select().from(askAnswers).where(eq(askAnswers.key, key));
  if (!row || now.getTime() - row.createdAt.getTime() > CACHE_MS) return null;
  try {
    return { answer: JSON.parse(row.answer) as CheckedAnswer, sources: row.sources as number[] };
  } catch {
    return null;
  }
}

export async function writeCache(db: Db, key: string, value: CachedAnswer, now = new Date()) {
  const row = { answer: JSON.stringify(value.answer), sources: value.sources, createdAt: now };
  await db.insert(askAnswers).values({ key, ...row }).onConflictDoUpdate({ target: askAnswers.key, set: row });
  await db.delete(askAnswers).where(lt(askAnswers.createdAt, new Date(now.getTime() - CACHE_MS)));
}

/** Records a question (the same again moves to the top); keeps the 20 latest. Returns its id. */
export async function remember(db: Db, userId: string, question: string, scope: string): Promise<number> {
  return db.transaction(async (tx) => {
    await tx.delete(askHistory).where(and(eq(askHistory.userId, userId), sql`lower(${askHistory.question}) = lower(${question})`));
    const [row] = await tx.insert(askHistory).values({ userId, question, scope }).returning({ id: askHistory.id });
    const keep = tx.select({ id: askHistory.id }).from(askHistory).where(eq(askHistory.userId, userId)).orderBy(desc(askHistory.askedAt), desc(askHistory.id)).limit(HISTORY_MAX);
    await tx.delete(askHistory).where(and(eq(askHistory.userId, userId), notInArray(askHistory.id, keep)));
    return row!.id;
  });
}

export async function history(db: Db, userId: string, limit = HISTORY_MAX) {
  return db
    .select({ id: askHistory.id, question: askHistory.question, scope: askHistory.scope, askedAt: askHistory.askedAt })
    .from(askHistory)
    .where(eq(askHistory.userId, userId))
    .orderBy(desc(askHistory.askedAt), desc(askHistory.id))
    .limit(limit);
}

export async function forget(db: Db, userId: string, ids: number[] | "all") {
  await db.delete(askHistory).where(and(eq(askHistory.userId, userId), ids === "all" ? undefined : inArray(askHistory.id, ids.length ? ids : [-1])));
}

export async function setFeedback(db: Db, userId: string, id: number, value: "utile" | "pas-utile" | null) {
  await db.update(askHistory).set({ feedback: value }).where(and(eq(askHistory.userId, userId), eq(askHistory.id, id)));
}

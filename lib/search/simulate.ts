import "server-only";
import { and, asc, eq, gte } from "drizzle-orm";
import { embeddingModel } from "@/lib/ai/embeddings";
import type { Db } from "@/lib/db";
import { articleEmbeddings, replies, replyEmbeddings, topics } from "@/lib/db/schema";
import { decodeVector, similarity } from "./vectors";

type Env = Partial<Record<string, string | undefined>>;
const MAX_ARTICLES = 800;

/**
 * Simulation of the fusion threshold on the last 7 days (docs/design/3.5 § 7): for each article that arrived (topics
 * and reprises, with a vector), its best similarity with an article arrived before it within the window. The page
 * counts, for any threshold, how many would have been grouped (score ≥ threshold). Approximate by design: it does not
 * replay the chain of merges, nor the « Séparer » blocks.
 */
export async function fusionScores(db: Db, windowMs: number, env: Env = process.env, now = new Date()): Promise<number[]> {
  const model = embeddingModel(env);
  const since = new Date(now.getTime() - 7 * 86_400_000 - windowMs);
  const [t, r] = await Promise.all([
    db
      .select({ at: topics.createdAt, vector: articleEmbeddings.vector })
      .from(topics)
      .innerJoin(articleEmbeddings, and(eq(articleEmbeddings.topicId, topics.id), eq(articleEmbeddings.model, model)))
      .where(gte(topics.createdAt, since))
      .orderBy(asc(topics.createdAt))
      .limit(MAX_ARTICLES),
    db
      .select({ at: replies.createdAt, vector: replyEmbeddings.vector })
      .from(replies)
      .innerJoin(replyEmbeddings, and(eq(replyEmbeddings.replyId, replies.id), eq(replyEmbeddings.model, model)))
      .where(and(eq(replies.type, "source"), gte(replies.createdAt, since)))
      .limit(MAX_ARTICLES),
  ]);
  const all = [...t, ...r].map((x) => ({ at: x.at.getTime(), v: decodeVector(x.vector) })).sort((a, b) => a.at - b.at);
  const start = now.getTime() - 7 * 86_400_000;
  const scores: number[] = [];
  for (let i = 0; i < all.length; i++) {
    const a = all[i]!;
    if (a.at < start) continue;
    let best = 0;
    for (let j = i - 1; j >= 0 && a.at - all[j]!.at <= windowMs; j--) best = Math.max(best, similarity(a.v, all[j]!.v));
    if (best > 0) scores.push(Math.round(best * 1000) / 1000);
  }
  return scores;
}

/**
 * « Tout réindexer » (§ 7): how long the background indexing needs for `total` texts. The worker indexes up to
 * EMBED_PER_CYCLE (200) every 15 minutes, within the daily limit.
 */
export function reindexEstimate(total: number, dailyLimit: number, perCycle = 200, cyclesPerHour = 4): string {
  if (total <= 0) return "rien à indexer";
  if (dailyLimit <= 0) return "indexation coupée (limite quotidienne à 0)";
  const perHour = perCycle * cyclesPerHour;
  if (total <= dailyLimit) {
    const h = total / perHour;
    return h < 1 ? `moins d'une heure` : `environ ${Math.ceil(h)} h`;
  }
  const days = Math.ceil(total / dailyLimit);
  return `environ ${days} jours (limite de ${dailyLimit.toLocaleString("fr-FR")} textes par jour)`;
}

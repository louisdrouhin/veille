/**
 * Retrieval of « Demande à ta veille » (docs/design/3.3 § 4.2): the ~12 extracts given to the model, from exact
 * matches (any of the question's words) and matches by meaning, merged by reciprocal rank, within the scope.
 * Only articles: title, feed excerpt, start of the article, titles of its reprises. NEVER a personal note: the
 * replies read here are the reprises (type `source`) only. No "server-only" import needed: server code only.
 */
import { and, desc, eq, gte, inArray, sql, type SQL } from "drizzle-orm";
import type { AiConfig } from "@/lib/ai/config";
import { embeddingModel, embedTexts, queryText } from "@/lib/ai/embeddings";
import type { Db } from "@/lib/db";
import { articleContents, forums, replies, sources, topics } from "@/lib/db/schema";
import { savedCountOf } from "@/lib/lists/queries";
import { fold } from "@/lib/search/fold";
import { highlightRanges, queryTerms, type Range } from "@/lib/search/highlight";
import { dailyLimit, reserve } from "@/lib/search/usage";
import { loadCorpus, nearest } from "@/lib/search/vectors";
import { scopeStart, type AskScope } from "./scope";

export const MAX_EXTRACTS = 12;
const EXTRACT_CHARS = 1_400;
/** Similarity at or above which an extract can answer a question (ASK_SEMANTIC_MIN overrides). */
export const ASK_SEMANTIC_MIN = 0.55;

export type Extract = {
  n: number;
  topicId: number;
  title: string;
  forum: { name: string; slug: string };
  sources: string[];
  at: Date;
  read: boolean;
  /** What the model reads (never shown as is). */
  text: string;
};

export type AlsoHit = { id: number; title: string; ranges: Range[]; forum: string; source: string | null; at: Date; read: boolean; savedCount: number };

type Env = Partial<Record<string, string | undefined>>;

function scopeWhere(scope: AskScope, now: Date): SQL[] {
  const w: SQL[] = [];
  const since = scopeStart(scope.period, now);
  if (since) w.push(gte(topics.lastActivityAt, since));
  if (scope.forums.length) w.push(inArray(forums.slug, scope.forums));
  return w;
}

/** Any of the question's words (folded, French or English stemming), best rank first. */
async function exactIds(db: Db, q: string, scope: AskScope, now: Date, limit: number): Promise<{ ids: number[]; total: number }> {
  const words = queryTerms(q).map((w) => w.replace(/[^a-z0-9]/g, "")).filter((w) => w.length >= 2);
  if (!words.length) return { ids: [], total: 0 };
  const expr = words.join(" | ");
  const query = sql`(to_tsquery('french', ${expr}) || to_tsquery('english', ${expr}))`;
  const match = sql`(${topics.searchTsv} @@ ${query} or exists (select 1 from article_contents ac where ac.topic_id = ${topics.id} and ac.search_tsv @@ ${query}))`;
  const rank = sql`ts_rank(${topics.searchTsv}, ${query}) + coalesce((select 0.4 * ts_rank(ac.search_tsv, ${query}) from article_contents ac where ac.topic_id = ${topics.id}), 0)`;
  const rows = await db
    .select({ id: topics.id, total: sql<number>`count(*) over ()`.mapWith(Number) })
    .from(topics)
    .innerJoin(forums, eq(forums.id, topics.forumId))
    .where(and(match, ...scopeWhere(scope, now)))
    .orderBy(desc(rank), desc(topics.lastActivityAt))
    .limit(limit);
  return { ids: rows.map((r) => r.id), total: rows[0]?.total ?? 0 };
}

export type Retrieval = {
  extracts: Extract[];
  also: AlsoHit[];
  alsoTotal: number;
  /** Words of the question, for « Voir les N résultats de recherche ». */
  keywords: string;
  semantic: "ok" | "off" | "limit" | "error";
};

export async function retrieve(db: Db, q: string, scope: AskScope, deps: { ai: AiConfig | null; env?: Env; fetch?: typeof fetch; now?: Date }): Promise<Retrieval> {
  const now = deps.now ?? new Date();
  const env = deps.env ?? process.env;
  const exact = await exactIds(db, q, scope, now, 40);

  // By meaning: the question as a « question answering » query, within the scope.
  let semIds: number[] = [];
  let semantic: Retrieval["semantic"] = "off";
  if (deps.ai) {
    if ((await reserve(db, "embed", 1, dailyLimit("embed", env), now)) === 0) semantic = "limit";
    else {
      const model = embeddingModel(env);
      const res = await embedTexts({ apiKey: deps.ai.apiKey, model, texts: [queryText(q, "question answering")], fetch: deps.fetch, timeoutMs: 10_000 });
      if (!res.ok) semantic = "error";
      else {
        const w = scopeWhere(scope, now);
        const only = w.length ? new Set((await db.select({ id: topics.id }).from(topics).innerJoin(forums, eq(forums.id, topics.forumId)).where(and(...w))).map((r) => r.id)) : undefined;
        const min = Number(env.ASK_SEMANTIC_MIN) || ASK_SEMANTIC_MIN;
        semIds = nearest(await loadCorpus(db, model), res.vectors[0]!, { limit: 40, threshold: min, only }).map((n) => n.topicId);
        semantic = "ok";
      }
    }
  }

  // Reciprocal rank fusion of both lists.
  const score = new Map<number, number>();
  for (const list of [exact.ids, semIds]) list.forEach((id, i) => score.set(id, (score.get(id) ?? 0) + 1 / (60 + i)));
  const chosen = [...score.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]).slice(0, MAX_EXTRACTS).map(([id]) => id);

  const terms = queryTerms(q);
  const keywords = terms.join(" ");
  const alsoIds = exact.ids.filter((id) => !chosen.includes(id)).slice(0, 3);
  const ids = [...chosen, ...alsoIds];
  if (!ids.length) return { extracts: [], also: [], alsoTotal: 0, keywords, semantic };

  const rows = await db
    .select({
      id: topics.id,
      title: topics.title,
      excerpt: topics.excerpt,
      readAt: topics.readAt,
      lastActivityAt: topics.lastActivityAt,
      forumName: forums.name,
      forumSlug: forums.slug,
      sourceName: sources.name,
      text: articleContents.text,
      savedCount: savedCountOf(),
    })
    .from(topics)
    .innerJoin(forums, eq(forums.id, topics.forumId))
    .leftJoin(sources, eq(sources.id, topics.sourceId))
    .leftJoin(articleContents, eq(articleContents.topicId, topics.id))
    .where(inArray(topics.id, ids));
  // Reprises of the chosen topics: their source names and titles (type `source` only: never a note).
  const reps = chosen.length
    ? await db
        .select({ topicId: replies.topicId, author: replies.author, title: replies.title })
        .from(replies)
        .where(and(inArray(replies.topicId, chosen), eq(replies.type, "source")))
    : [];
  const byId = new Map(rows.map((r) => [r.id, r]));

  const extracts: Extract[] = [];
  for (const id of chosen) {
    const r = byId.get(id);
    if (!r) continue;
    const mine = reps.filter((x) => x.topicId === id);
    const body = [r.excerpt, r.text ?? "", ...mine.map((x) => `Repris par ${x.author} : ${x.title ?? ""}`)].filter(Boolean).join("\n");
    extracts.push({
      n: extracts.length + 1,
      topicId: id,
      title: r.title,
      forum: { name: r.forumName, slug: r.forumSlug },
      sources: [...new Set([r.sourceName ?? "Source supprimée", ...mine.map((x) => x.author)])],
      at: r.lastActivityAt,
      read: r.readAt !== null,
      text: body.replace(/\s+/g, " ").trim().slice(0, EXTRACT_CHARS),
    });
  }
  const also = alsoIds
    .map((id) => byId.get(id))
    .filter((r) => r !== undefined)
    .map((r) => ({ id: r.id, title: r.title, ranges: highlightRanges(r.title, terms), forum: r.forumName, source: r.sourceName, at: r.lastActivityAt, read: r.readAt !== null, savedCount: r.savedCount }));
  return { extracts, also, alsoTotal: Math.max(0, exact.total - exact.ids.filter((id) => chosen.includes(id)).length), keywords: keywords || fold(q), semantic };
}

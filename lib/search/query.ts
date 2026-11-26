/**
 * The search (docs/design/3.3 § 3): exact matches (full text, local, notes included) then « proches par le
 * sens » (embeddings), each topic in one section only (the exact one wins). The query is only embedded
 * once the search is asked for (Enter, the results page): never while typing.
 */
import "server-only";
import { and, desc, eq, gte, inArray, sql, type SQL } from "drizzle-orm";
import type { AiConfig } from "@/lib/ai/config";
import { embeddingModel, embedTexts, queryText } from "@/lib/ai/embeddings";
import type { Db } from "@/lib/db";
import { forums, listItems, replies, sources, topics } from "@/lib/db/schema";
import { savedCountOf } from "@/lib/lists/queries";
import { periodStart, type SearchFilters } from "./filters";
import { fold } from "./fold";
import { queryTerms, snippet, type Highlighted, type Range, highlightRanges } from "./highlight";
import { dailyLimit, reserve } from "./usage";
import { loadCorpus, nearest } from "./vectors";

export const SECTION_SIZE = 5;
export const SECTION_MAX = 50;
/** Cosine similarity at or above which a topic is « proche par le sens » (SEARCH_SEMANTIC_MIN overrides). */
export const SEMANTIC_MIN = 0.62;

export type TopicHit = {
  kind: "topic";
  id: number;
  title: Highlighted;
  snippet: Highlighted;
  read: boolean;
  savedCount: number;
  forum: { name: string; slug: string };
  sourceName: string | null;
  url: string;
  at: Date;
};
export type NoteHit = { kind: "note"; topicId: number; replyId: number; postNumber: number; topicTitle: string; snippet: Highlighted; forum: { name: string; slug: string }; at: Date };
export type Hit = TopicHit | NoteHit;

/** The folded query as tsquery: French or English (websearch syntax: "phrases", -excluded). */
export const tsQuery = (q: string) => sql`(websearch_to_tsquery('french', ${fold(q)}) || websearch_to_tsquery('english', ${fold(q)}))`;

/** The filters on topics (forum, period of activity, source, lists). */
function topicScope(f: SearchFilters, now = new Date()): SQL[] {
  const where: SQL[] = [];
  if (f.forums.length) where.push(inArray(forums.slug, f.forums));
  const since = periodStart(f.period, now);
  if (since) where.push(gte(topics.lastActivityAt, since));
  if (f.source) where.push(eq(topics.sourceId, f.source));
  if (f.lists.length) where.push(sql`exists (select 1 from ${listItems} where ${listItems.topicId} = ${topics.id} and ${inArray(listItems.listId, f.lists)})`);
  return where;
}

const topicColumns = {
  id: topics.id,
  title: topics.title,
  excerpt: topics.excerpt,
  url: topics.url,
  readAt: topics.readAt,
  lastActivityAt: topics.lastActivityAt,
  forumName: forums.name,
  forumSlug: forums.slug,
  sourceName: sources.name,
  savedCount: savedCountOf(),
};

type TopicRow = {
  id: number;
  title: string;
  excerpt: string;
  url: string;
  readAt: Date | null;
  lastActivityAt: Date;
  forumName: string;
  forumSlug: string;
  sourceName: string | null;
  savedCount: number;
  text?: string | null;
};

function toHit(r: TopicRow, terms: string[]): TopicHit {
  // The passage: the feed excerpt if it holds the words, else the article around them, else the excerpt.
  const fromExcerpt = snippet(r.excerpt, terms);
  const fromText = r.text ? snippet(r.text, terms) : null;
  const passage = terms.length && !fromExcerpt.ranges.length && fromText?.ranges.length ? fromText : r.excerpt ? fromExcerpt : (fromText ?? fromExcerpt);
  return {
    kind: "topic",
    id: r.id,
    title: { text: r.title, ranges: highlightRanges(r.title, terms) },
    snippet: passage,
    read: r.readAt !== null,
    savedCount: r.savedCount,
    forum: { name: r.forumName, slug: r.forumSlug },
    sourceName: r.sourceName,
    url: r.url,
    at: r.lastActivityAt,
  };
}

export type ExactResults = { topics: TopicHit[]; topicTotal: number; notes: NoteHit[]; noteTotal: number; ids: Set<number> };

/** Exact matches: topics (title, excerpt, article) and, if asked, personal notes. */
export async function exactSearch(db: Db, q: string, f: SearchFilters, opts: { limit?: number; now?: Date } = {}): Promise<ExactResults> {
  const query = tsQuery(q);
  const terms = queryTerms(q);
  const scope = topicScope(f, opts.now);
  const match = sql`(${topics.searchTsv} @@ ${query} or exists (select 1 from article_contents ac where ac.topic_id = ${topics.id} and ac.search_tsv @@ ${query}))`;
  const rank = sql<number>`ts_rank(${topics.searchTsv}, ${query}) + coalesce((select 0.4 * ts_rank(ac.search_tsv, ${query}) from article_contents ac where ac.topic_id = ${topics.id}), 0)`;

  const base = () =>
    db.select({ id: topics.id }).from(topics).innerJoin(forums, eq(forums.id, topics.forumId)).where(and(match, ...scope));
  const [all, rows] = await Promise.all([
    base(),
    db
      .select({ ...topicColumns, text: sql<string | null>`(select ac.text from article_contents ac where ac.topic_id = ${topics.id})` })
      .from(topics)
      .innerJoin(forums, eq(forums.id, topics.forumId))
      .leftJoin(sources, eq(sources.id, topics.sourceId))
      .where(and(match, ...scope))
      .orderBy(desc(rank), desc(topics.lastActivityAt), desc(topics.id))
      .limit(opts.limit ?? SECTION_SIZE),
  ]);

  let notes: NoteHit[] = [];
  let noteTotal = 0;
  if (f.notes) {
    const noteWhere = and(eq(replies.type, "note"), sql`${replies.searchTsv} @@ ${query}`, ...scope);
    const [count, noteRows] = await Promise.all([
      db.select({ n: sql<number>`count(*)::int` }).from(replies).innerJoin(topics, eq(topics.id, replies.topicId)).innerJoin(forums, eq(forums.id, topics.forumId)).where(noteWhere),
      db
        .select({
          replyId: replies.id,
          // Its « #n » in the thread (#1 is the article): replies in order of creation.
          postNumber: sql<number>`(select count(*)::int + 1 from replies r2 where r2.topic_id = ${replies.topicId} and (r2.created_at, r2.id) <= (${replies.createdAt}, ${replies.id}))`,
          topicId: topics.id,
          title: topics.title, content: replies.content, at: replies.createdAt, forumName: forums.name, forumSlug: forums.slug })
        .from(replies)
        .innerJoin(topics, eq(topics.id, replies.topicId))
        .innerJoin(forums, eq(forums.id, topics.forumId))
        .where(noteWhere)
        .orderBy(desc(sql`ts_rank(${replies.searchTsv}, ${query})`), desc(replies.createdAt))
        .limit(opts.limit ?? SECTION_SIZE),
    ]);
    noteTotal = count[0]?.n ?? 0;
    notes = noteRows.map((n) => ({
      kind: "note",
      topicId: n.topicId,
      replyId: n.replyId,
      postNumber: n.postNumber,
      topicTitle: n.title,
      snippet: snippet(n.content, terms, 200),
      forum: { name: n.forumName, slug: n.forumSlug },
      at: n.at,
    }));
  }
  return { topics: rows.map((r) => toHit(r, terms)), topicTotal: all.length, notes, noteTotal, ids: new Set(all.map((r) => r.id)) };
}

export type SemanticResults =
  | { status: "ok"; topics: TopicHit[]; total: number }
  | { status: "off" | "limit" | "error"; topics: []; total: 0; message?: string };

// The vector of a query, per model: pagination and the live count of the filters sheet cost no new call.
const queryVectors = new Map<string, Float32Array>();
function remember(key: string, v: Float32Array) {
  queryVectors.delete(key);
  queryVectors.set(key, v);
  if (queryVectors.size > 200) queryVectors.delete(queryVectors.keys().next().value!);
}

/** « Proches par le sens »: topics near the query, not already exact matches. `cachedOnly`: no call. */
export async function semanticSearch(
  db: Db,
  q: string,
  f: SearchFilters,
  exactIds: ReadonlySet<number>,
  deps: { ai: AiConfig | null; env?: Partial<Record<string, string | undefined>>; fetch?: typeof fetch; limit?: number; cachedOnly?: boolean; now?: Date },
): Promise<SemanticResults> {
  if (!deps.ai) return { status: "off", topics: [], total: 0 };
  const env = deps.env ?? process.env;
  const model = embeddingModel(env);
  const key = `${model}\n${q.toLowerCase()}`;
  let vector = queryVectors.get(key);
  if (!vector) {
    if (deps.cachedOnly) return { status: "off", topics: [], total: 0 };
    if ((await reserve(db, "embed", 1, dailyLimit("embed", env), deps.now)) === 0) {
      return { status: "limit", topics: [], total: 0, message: "Limite quotidienne de Gemini atteinte : seules les correspondances exactes sont affichées." };
    }
    const res = await embedTexts({ apiKey: deps.ai.apiKey, model, texts: [queryText(q)], fetch: deps.fetch, timeoutMs: 10_000 });
    if (!res.ok) return { status: "error", topics: [], total: 0, message: "Recherche par le sens indisponible pour l'instant." };
    vector = res.vectors[0]!;
  }
  remember(key, vector);

  const scope = topicScope(f, deps.now);
  const only = scope.length
    ? new Set((await db.select({ id: topics.id }).from(topics).innerJoin(forums, eq(forums.id, topics.forumId)).where(and(...scope))).map((r) => r.id))
    : undefined;
  const corpus = await loadCorpus(db, model);
  const min = Number(env.SEARCH_SEMANTIC_MIN) || SEMANTIC_MIN;
  const near = nearest(corpus, vector, { limit: SECTION_MAX, threshold: min, exclude: exactIds, only });
  const shown = near.slice(0, deps.limit ?? SECTION_SIZE);
  if (!shown.length) return { status: "ok", topics: [], total: near.length };
  const rows = await db
    .select(topicColumns)
    .from(topics)
    .innerJoin(forums, eq(forums.id, topics.forumId))
    .leftJoin(sources, eq(sources.id, topics.sourceId))
    .where(inArray(topics.id, shown.map((n) => n.topicId)));
  const byId = new Map(rows.map((r) => [r.id, r]));
  // No highlighting: nothing to highlight in a match by meaning (§ 3).
  const hits = shown.map((n) => byId.get(n.topicId)).filter((r): r is TopicRow => !!r).map((r) => toHit(r, []));
  return { status: "ok", topics: hits, total: near.length };
}

/** While typing (debounced): titles holding every word, and forums. Local only: no model call. */
export async function quickSuggestions(db: Db, q: string): Promise<{ topics: { id: number; title: string; ranges: Range[] }[]; forums: { name: string; slug: string }[] }> {
  const words = fold(q)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 2)
    .slice(0, 6);
  if (!words.length) return { topics: [], forums: [] };
  const like = (w: string) => `%${w.replace(/[%_\\]/g, "")}%`;
  const terms = queryTerms(q);
  const [t, fo] = await Promise.all([
    // Every word in the folded title (substring: « securi » finds « Sécurité »). A few thousand titles: no index needed.
    db
      .select({ id: topics.id, title: topics.title })
      .from(topics)
      .where(and(...words.map((w) => sql`folders_fold(${topics.title}) like ${like(w)}`)))
      .orderBy(desc(topics.lastActivityAt))
      .limit(3),
    db
      .select({ name: forums.name, slug: forums.slug })
      .from(forums)
      .where(and(...words.map((w) => sql`folders_fold(${forums.name}) like ${like(w)}`)))
      .limit(3),
  ]);
  return { topics: t.map((r) => ({ id: r.id, title: r.title, ranges: highlightRanges(r.title, terms) })), forums: fo };
}

/** Exact matches per forum, for the counts next to the forum filters (the forum filter itself left out). */
export async function exactForumCounts(db: Db, q: string, f: SearchFilters, now = new Date()): Promise<Map<string, number>> {
  const query = tsQuery(q);
  const match = sql`(${topics.searchTsv} @@ ${query} or exists (select 1 from article_contents ac where ac.topic_id = ${topics.id} and ac.search_tsv @@ ${query}))`;
  const rows = await db
    .select({ slug: forums.slug, n: sql<number>`count(*)::int` })
    .from(topics)
    .innerJoin(forums, eq(forums.id, topics.forumId))
    .where(and(match, ...topicScope({ ...f, forums: [] }, now)))
    .groupBy(forums.slug);
  return new Map(rows.map((r) => [r.slug, r.n]));
}

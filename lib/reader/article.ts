import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { articleContents, type ArticleContent } from "@/lib/db/schema";
import { fetchReadableArticle, type DownloadOptions } from "./extract";

/** A failed extraction is retried automatically on the next opening after this delay. */
export const FAILURE_RETRY_MS = 24 * 60 * 60 * 1000;

type TopicRef = { id: number; url: string };
type Options = DownloadOptions & { now?: Date };

async function upsert(db: Db, values: typeof articleContents.$inferInsert): Promise<ArticleContent> {
  const set = { html: values.html, source: values.source, error: values.error, fetchedAt: values.fetchedAt };
  const [row] = await db
    .insert(articleContents)
    .values(values)
    .onConflictDoUpdate({ target: articleContents.topicId, set })
    .returning();
  return row!;
}

async function extractNow(topic: TopicRef, now: Date, opts: DownloadOptions) {
  const res = await fetchReadableArticle(topic.url, opts);
  return {
    res,
    values: {
      topicId: topic.id,
      source: "readability" as const,
      html: res.ok ? res.html : null,
      error: res.ok ? null : res.error,
      fetchedAt: now,
    },
  };
}

/**
 * Reading-mode content of a topic: the cached row (feed content stored at
 * import, or a previous extraction), else the page is downloaded and
 * extracted now. Failures are cached too (html = null) and retried after a day.
 */
export async function getArticle(db: Db, topic: TopicRef, opts: Options = {}): Promise<ArticleContent> {
  const now = opts.now ?? new Date();
  const [cached] = await db.select().from(articleContents).where(eq(articleContents.topicId, topic.id));
  if (cached && (cached.html !== null || now.getTime() - cached.fetchedAt.getTime() < FAILURE_RETRY_MS)) return cached;
  const { values } = await extractNow(topic, now, opts);
  return upsert(db, values);
}

/**
 * « Recharger l'article »: downloads and extracts the page again. When it
 * fails, content already available (from the feed or an earlier extraction)
 * is kept rather than replaced by an error.
 */
export async function reloadArticle(
  db: Db,
  topic: TopicRef,
  opts: Options = {},
): Promise<{ ok: true; article: ArticleContent } | { ok: false; error: string; article: ArticleContent | null }> {
  const now = opts.now ?? new Date();
  const { res, values } = await extractNow(topic, now, opts);
  if (res.ok) return { ok: true, article: await upsert(db, values) };

  const [cached] = await db.select().from(articleContents).where(eq(articleContents.topicId, topic.id));
  if (cached?.html) return { ok: false, error: res.error, article: cached };
  return { ok: false, error: res.error, article: await upsert(db, values) };
}

/**
 * Writes to the reading-mode cache that need no download (used by the worker,
 * which therefore does not bundle Readability / linkedom).
 */
import { lt } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { articleContents } from "@/lib/db/schema";

export const ARTICLE_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

/** Stores article HTML provided by the feed (already sanitized). Existing rows are left alone. */
export async function storeFeedArticles(db: Db, rows: { topicId: number; html: string }[], now = new Date()) {
  if (!rows.length) return;
  await db
    .insert(articleContents)
    .values(rows.map((r) => ({ topicId: r.topicId, html: r.html, source: "feed" as const, error: null, fetchedAt: now })))
    .onConflictDoNothing({ target: articleContents.topicId });
}

/** Deletes cached articles older than 90 days (re-extracted on demand). Returns the number of rows deleted. */
export async function purgeArticleContents(db: Db, now = new Date()): Promise<number> {
  const deleted = await db
    .delete(articleContents)
    .where(lt(articleContents.fetchedAt, new Date(now.getTime() - ARTICLE_RETENTION_MS)))
    .returning({ topicId: articleContents.topicId });
  return deleted.length;
}

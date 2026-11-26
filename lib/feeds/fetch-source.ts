import { and, eq, isNull, lte, or, sql } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { sources, topics, type Source } from "@/lib/db/schema";
import { knownReprises } from "@/lib/merge/fusion";
import { storeFeedArticles } from "@/lib/reader/store";
import { htmlTextLength, sanitizeArticleHtml } from "@/lib/reader/sanitize";
import { parseFeed, type FeedEntry } from "./parse";

export const FETCH_TIMEOUT_MS = 10_000;
export const MAX_CONSECUTIVE_FAILURES = 3;
export const PAUSE_DURATION_MS = 60 * 60 * 1000;
export const MAX_FEED_BYTES = 10 * 1024 * 1024;
/**
 * Feed content shorter than this (visible text) is treated as a teaser: the
 * topic page then extracts the article from the page itself instead.
 */
export const MIN_FEED_ARTICLE_TEXT = 500;
// `||`, not `??`: docker-compose.yml passes FETCH_USER_AGENT="" when it is not set.
export const DEFAULT_USER_AGENT = "FoldersRSS/1.0 (+self-hosted personal feed reader)";
export const USER_AGENT = process.env.FETCH_USER_AGENT || DEFAULT_USER_AGENT;

export type FetchResult =
  | { status: "ok"; inserted: number; firstImport: boolean }
  | { status: "not-modified" }
  | { status: "error"; error: string; paused: boolean };

class FetchError extends Error {}

async function download(source: Source, fetchImpl: typeof fetch) {
  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
    Accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.5",
  };
  if (source.etag) headers["If-None-Match"] = source.etag;
  if (source.lastModified) headers["If-Modified-Since"] = source.lastModified;

  let res: Response;
  try {
    res = await fetchImpl(source.url, {
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new FetchError(`Délai dépassé (${FETCH_TIMEOUT_MS / 1000} s)`);
    }
    const cause = err instanceof Error && err.cause instanceof Error ? ` (${err.cause.message})` : "";
    throw new FetchError(`Erreur réseau : ${err instanceof Error ? err.message : String(err)}${cause}`);
  }

  if (res.status === 304) return { notModified: true as const };
  if (!res.ok) throw new FetchError(`HTTP ${res.status} ${res.statusText}`.trim());

  const length = Number(res.headers.get("content-length") ?? 0);
  if (length > MAX_FEED_BYTES) throw new FetchError("Flux trop volumineux");
  const body = await res.text();
  if (body.length > MAX_FEED_BYTES) throw new FetchError("Flux trop volumineux");

  return {
    notModified: false as const,
    body,
    finalUrl: res.url || source.url,
    etag: res.headers.get("etag"),
    lastModified: res.headers.get("last-modified"),
  };
}

/**
 * Fetches one source and stores new topics.
 * Shared by the worker and the « Récupérer maintenant » admin action; concurrent
 * runs are safe thanks to `ON CONFLICT (normalized_url) DO NOTHING`.
 */
export async function fetchSource(
  db: Db,
  source: Source,
  opts: { now?: Date; fetchImpl?: typeof fetch } = {},
): Promise<FetchResult> {
  const now = opts.now ?? new Date();
  try {
    const result = await download(source, opts.fetchImpl ?? fetch);

    if (result.notModified) {
      await markSuccess(db, source.id, now, {});
      return { status: "not-modified" };
    }

    let entries;
    try {
      entries = await parseFeed(result.body, { feedUrl: result.finalUrl, now });
    } catch (err) {
      throw new FetchError(`Flux invalide : ${err instanceof Error ? err.message : String(err)}`);
    }

    // First successful import of a source: articles arrive already read,
    // to avoid flooding the forum with a backlog of old posts.
    const firstImport = source.lastFetchedAt === null;
    let inserted = 0;
    // Articles already merged into another topic (« reprises », docs/design/3.3 § 2) are not new topics.
    const reprises = await knownReprises(db, entries.map((e) => e.normalizedUrl));
    if (reprises.size) entries = entries.filter((e) => !reprises.has(e.normalizedUrl));
    if (entries.length) {
      const rows = await db
        .insert(topics)
        .values(
          entries.map((e) => ({
            forumId: source.forumId,
            sourceId: source.id,
            title: e.title,
            url: e.url,
            normalizedUrl: e.normalizedUrl,
            excerpt: e.excerpt,
            publishedAt: e.publishedAt,
            lastActivityAt: e.publishedAt,
            readAt: firstImport ? now : null,
          })),
        )
        .onConflictDoNothing({ target: topics.normalizedUrl })
        .returning({ id: topics.id, normalizedUrl: topics.normalizedUrl });
      inserted = rows.length;
      await storeFeedArticles(db, feedArticles(entries, rows), now);
    }

    await markSuccess(db, source.id, now, { etag: result.etag, lastModified: result.lastModified });
    return { status: "ok", inserted, firstImport };
  } catch (err) {
    const message =
      err instanceof FetchError ? err.message : `Erreur inattendue : ${err instanceof Error ? err.message : String(err)}`;
    const paused = await markFailure(db, source.id, now, message);
    return { status: "error", error: message, paused };
  }
}

/** Sanitized feed content of the topics just created, when it looks like the full article. */
function feedArticles(entries: FeedEntry[], created: { id: number; normalizedUrl: string }[]) {
  const byUrl = new Map(entries.map((e) => [e.normalizedUrl, e]));
  const out: { topicId: number; html: string }[] = [];
  for (const { id, normalizedUrl } of created) {
    const entry = byUrl.get(normalizedUrl);
    if (!entry?.content) continue;
    const html = sanitizeArticleHtml(entry.content, entry.url);
    if (htmlTextLength(html) >= MIN_FEED_ARTICLE_TEXT) out.push({ topicId: id, html });
  }
  return out;
}

async function markSuccess(
  db: Db,
  sourceId: number,
  now: Date,
  cache: { etag?: string | null; lastModified?: string | null },
) {
  await db
    .update(sources)
    .set({
      lastFetchedAt: now,
      lastError: null,
      consecutiveFailures: 0,
      pausedUntil: null,
      ...(cache.etag !== undefined ? { etag: cache.etag } : {}),
      ...(cache.lastModified !== undefined ? { lastModified: cache.lastModified } : {}),
    })
    .where(eq(sources.id, sourceId));
}

/** Returns true when the source has just been paused. */
async function markFailure(db: Db, sourceId: number, now: Date, message: string): Promise<boolean> {
  const pauseUntil = new Date(now.getTime() + PAUSE_DURATION_MS);
  const [row] = await db
    .update(sources)
    .set({
      lastError: message.slice(0, 1000),
      consecutiveFailures: sql`${sources.consecutiveFailures} + 1`,
      pausedUntil: sql`case when ${sources.consecutiveFailures} + 1 >= ${MAX_CONSECUTIVE_FAILURES}
        then ${pauseUntil.toISOString()}::timestamptz else null end`,
    })
    .where(eq(sources.id, sourceId))
    .returning({ pausedUntil: sources.pausedUntil });
  return row?.pausedUntil != null;
}

/** Enabled sources that are not currently paused. */
export async function listDueSources(db: Db, now = new Date()): Promise<Source[]> {
  return db
    .select()
    .from(sources)
    .where(and(eq(sources.enabled, true), or(isNull(sources.pausedUntil), lte(sources.pausedUntil, now))))
    .orderBy(sources.id);
}

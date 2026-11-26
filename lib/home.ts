import "server-only";
import { and, asc, count, desc, eq, gte, isNotNull, isNull, lte, max, notInArray, or, sql } from "drizzle-orm";
import type { TopicRowData } from "@/components/topic/topic-grid";
import type { ForumRowData } from "@/components/forum/forum-table";
import type { Db } from "@/lib/db";
import { forums, replies, sourceFavicons, sources, topics } from "@/lib/db/schema";
import { faviconUrl } from "@/lib/feeds/favicon";
import { savedCountOf } from "@/lib/lists/queries";
import { startOfParisDay } from "@/lib/format-date";

/** Home page data (docs/design/v2 § 2.2): one query per block, run in parallel by the page. */

export type HomeStats = {
  unreadTotal: number;
  /** Topics that arrived in the database since midnight (Europe/Paris), not their publication date. */
  receivedToday: number;
  /** Latest successful fetch of any source; null = never. */
  lastFetchAt: Date | null;
  /** Sources « En erreur » in the admin (sourceStatus): enabled, not paused, with failures. */
  errorCount: number;
  sourceCount: number;
};

export async function getHomeStats(db: Db, now: Date = new Date()): Promise<HomeStats> {
  const [[t], [s]] = await Promise.all([
    db
      .select({
        unreadTotal: sql<number>`count(*) filter (where ${topics.readAt} is null)`.mapWith(Number),
        // gte() encodes the Date through the column (a raw Date in sql`` breaks postgres-js).
        receivedToday: sql<number>`count(*) filter (where ${gte(topics.createdAt, startOfParisDay(now))})`.mapWith(Number),
      })
      .from(topics),
    db
      .select({
        sourceCount: count(),
        lastFetchAt: max(sources.lastFetchedAt),
        errorCount: sql<number>`count(*) filter (where ${and(
          eq(sources.enabled, true),
          sql`${sources.consecutiveFailures} > 0`,
          or(isNull(sources.pausedUntil), lte(sources.pausedUntil, now)),
        )})`.mapWith(Number),
      })
      .from(sources),
  ]);
  return {
    unreadTotal: t?.unreadTotal ?? 0,
    receivedToday: t?.receivedToday ?? 0,
    lastFetchAt: s?.lastFetchAt ?? null,
    errorCount: s?.errorCount ?? 0,
    sourceCount: s?.sourceCount ?? 0,
  };
}

/** Unread topics of every forum, newest publication first. */
export async function getLatestUnread(db: Db, { limit, exclude = [] }: { limit: number; exclude?: number[] }): Promise<TopicRowData[]> {
  const rows = await db
    .select({
      id: topics.id,
      title: topics.title,
      replyCount: topics.replyCount,
      lastActivityAt: topics.lastActivityAt,
      sourceName: sources.name,
      sourceId: topics.sourceId,
      faviconAt: sourceFavicons.fetchedAt,
      forumName: forums.name,
      forumSlug: forums.slug,
      url: topics.url,
      savedCount: savedCountOf(),
    })
    .from(topics)
    .innerJoin(forums, eq(forums.id, topics.forumId))
    .leftJoin(sources, eq(sources.id, topics.sourceId))
    .leftJoin(sourceFavicons, and(eq(sourceFavicons.sourceId, topics.sourceId), isNotNull(sourceFavicons.data)))
    // A topic « À la une » is not shown twice (docs/design/3.3 § 2).
    .where(and(isNull(topics.readAt), exclude.length ? notInArray(topics.id, exclude) : undefined))
    .orderBy(desc(topics.publishedAt), desc(topics.id))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    replyCount: r.replyCount,
    lastActivityAt: r.lastActivityAt,
    read: false,
    sourceName: r.sourceName,
    faviconSrc: faviconUrl(r.sourceId, r.faviconAt),
    forum: { name: r.forumName, slug: r.forumSlug },
    forumSlug: r.forumSlug,
    url: r.url,
    savedCount: r.savedCount,
  }));
}

/** Forums in admin order, with topic and unread counts and their latest topic. */
export async function getForumsWithCounts(db: Db): Promise<ForumRowData[]> {
  const [forumRows, lastTopics] = await Promise.all([
    db
      .select({
        id: forums.id,
        name: forums.name,
        slug: forums.slug,
        description: forums.description,
        icon: forums.icon,
        total: count(topics.id),
        unread: sql<number>`count(${topics.id}) filter (where ${topics.readAt} is null)`.mapWith(Number),
      })
      .from(forums)
      .leftJoin(topics, eq(topics.forumId, forums.id))
      .groupBy(forums.id)
      .orderBy(asc(forums.position), asc(forums.name)),
    // Latest topic of each forum.
    db
      .selectDistinctOn([topics.forumId], {
        forumId: topics.forumId,
        id: topics.id,
        title: topics.title,
        at: topics.lastActivityAt,
        sourceName: sources.name,
      })
      .from(topics)
      .leftJoin(sources, eq(sources.id, topics.sourceId))
      .orderBy(topics.forumId, desc(topics.lastActivityAt), desc(topics.id)),
  ]);
  const lastByForum = new Map(lastTopics.map((t) => [t.forumId, t]));
  return forumRows.map((f) => {
    const last = lastByForum.get(f.id);
    return { ...f, lastTopic: last ? { id: last.id, title: last.title, sourceName: last.sourceName, at: last.at } : null };
  });
}

export type FeaturedTopic = {
  id: number;
  title: string;
  forum: { name: string; slug: string };
  /** The topic's own source, then the sources that picked it up (replies of type `source`). */
  sourceNames: string[];
  savedCount: number;
  read: boolean;
  lastActivityAt: Date;
};

/**
 * « À la une » (docs/design/3.3 § 2): topics with 2 sources or more (merged duplicates: replies of type
 * `source`) and some activity since `since` (48 h), the most picked up first, then the most recent.
 */
export async function getFeatured(db: Db, { limit, since }: { limit: number; since: Date }): Promise<FeaturedTopic[]> {
  const reposts = sql<number>`count(${replies.id})`.mapWith(Number);
  const rows = await db
    .select({
      id: topics.id,
      title: topics.title,
      forumName: forums.name,
      forumSlug: forums.slug,
      sourceName: sources.name,
      authors: sql<string[]>`array_agg(${replies.author} order by ${replies.createdAt})`,
      reposts,
      readAt: topics.readAt,
      lastActivityAt: topics.lastActivityAt,
      savedCount: savedCountOf(),
    })
    .from(topics)
    .innerJoin(forums, eq(forums.id, topics.forumId))
    .innerJoin(replies, and(eq(replies.topicId, topics.id), eq(replies.type, "source")))
    .leftJoin(sources, eq(sources.id, topics.sourceId))
    .where(gte(topics.lastActivityAt, since))
    .groupBy(topics.id, forums.id, sources.id)
    .orderBy(desc(reposts), desc(topics.lastActivityAt), desc(topics.id))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    forum: { name: r.forumName, slug: r.forumSlug },
    sourceNames: [...new Set([r.sourceName ?? "Source supprimée", ...r.authors])],
    savedCount: r.savedCount,
    read: r.readAt !== null,
    lastActivityAt: r.lastActivityAt,
  }));
}

import "server-only";
import { and, asc, count, desc, eq, gt, inArray, isNotNull, isNull, lte, max, or, sql } from "drizzle-orm";
import type { TopicRowData } from "@/components/topic/topic-grid";
import type { Db } from "@/lib/db";
import { forums, listItems, lists, sourceFavicons, sources, topics } from "@/lib/db/schema";
import { faviconUrl } from "@/lib/feeds/favicon";
import type { MarkdownItem } from "@/lib/lists/markdown";
import type { ListColor } from "@/lib/lists/palette";

export type PickerList = { id: number; name: string; color: ListColor; count: number };

/** Every list (display order) with its number of topics, and the ids of those holding `topicId`. */
export async function getPickerLists(db: Db, topicId: number): Promise<{ lists: PickerList[]; selected: number[] }> {
  const [all, holding] = await Promise.all([
    db
      .select({ id: lists.id, name: lists.name, color: lists.color, count: count(listItems.topicId) })
      .from(lists)
      .leftJoin(listItems, eq(listItems.listId, lists.id))
      .groupBy(lists.id)
      .orderBy(asc(lists.position), asc(lists.id)),
    db.select({ listId: listItems.listId }).from(listItems).where(eq(listItems.topicId, topicId)),
  ]);
  return { lists: all, selected: holding.map((h) => h.listId) };
}

/** Number of lists holding the topic, as a select field (« saved » mark of topic rows). */
export const savedCountOf = () =>
  sql<number>`(select count(*) from ${listItems} where ${listItems.topicId} = ${topics.id})`.mapWith(Number);

export type ListSummary = PickerList & { lastAddedAt: Date | null };

/** /listes: every list in display order, with its size and latest addition. */
export async function getListSummaries(db: Db): Promise<ListSummary[]> {
  return db
    .select({
      id: lists.id,
      name: lists.name,
      color: lists.color,
      count: count(listItems.topicId),
      lastAddedAt: max(listItems.addedAt),
    })
    .from(lists)
    .leftJoin(listItems, eq(listItems.listId, lists.id))
    .groupBy(lists.id)
    .orderBy(asc(lists.position), asc(lists.id));
}

export async function getList(db: Db, listId: number) {
  const [row] = await db.select({ id: lists.id, name: lists.name, color: lists.color }).from(lists).where(eq(lists.id, listId));
  return row;
}

export const LIST_PAGE_SIZE = 25;

/** A page of a list, newest addition first, as topic rows (with their forum) plus the date of addition. */
export async function getListItems(db: Db, listId: number, page: number): Promise<(TopicRowData & { addedAt: Date })[]> {
  const rows = await db
    .select({
      id: topics.id,
      title: topics.title,
      replyCount: topics.replyCount,
      lastActivityAt: topics.lastActivityAt,
      readAt: topics.readAt,
      sourceName: sources.name,
      sourceId: topics.sourceId,
      faviconAt: sourceFavicons.fetchedAt,
      forumName: forums.name,
      forumSlug: forums.slug,
      addedAt: listItems.addedAt,
      savedCount: savedCountOf(),
    })
    .from(listItems)
    .innerJoin(topics, eq(topics.id, listItems.topicId))
    .innerJoin(forums, eq(forums.id, topics.forumId))
    .leftJoin(sources, eq(sources.id, topics.sourceId))
    .leftJoin(sourceFavicons, and(eq(sourceFavicons.sourceId, topics.sourceId), isNotNull(sourceFavicons.data)))
    .where(eq(listItems.listId, listId))
    .orderBy(desc(listItems.addedAt), desc(topics.id))
    .limit(LIST_PAGE_SIZE)
    .offset((page - 1) * LIST_PAGE_SIZE);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    replyCount: r.replyCount,
    lastActivityAt: r.lastActivityAt,
    read: r.readAt !== null,
    sourceName: r.sourceName,
    faviconSrc: faviconUrl(r.sourceId, r.faviconAt),
    forum: { name: r.forumName, slug: r.forumSlug },
    savedCount: r.savedCount,
    addedAt: r.addedAt,
  }));
}

/** Every topic of the given lists, in display order (for « Copier en Markdown »: the whole list, not one page). */
export async function getListExports(db: Db, listIds: number[]): Promise<Map<number, MarkdownItem[]>> {
  const out = new Map<number, MarkdownItem[]>(listIds.map((id) => [id, []]));
  if (!listIds.length) return out;
  const rows = await db
    .select({ listId: listItems.listId, topicId: topics.id, title: topics.title, url: topics.url, source: sources.name, forum: forums.name })
    .from(listItems)
    .innerJoin(topics, eq(topics.id, listItems.topicId))
    .innerJoin(forums, eq(forums.id, topics.forumId))
    .leftJoin(sources, eq(sources.id, topics.sourceId))
    .where(inArray(listItems.listId, listIds))
    .orderBy(desc(listItems.addedAt), desc(topics.id));
  for (const r of rows) out.get(r.listId)?.push({ topicId: r.topicId, title: r.title, url: r.url, source: r.source, forum: r.forum });
  return out;
}

/** Counts for the navigation: lists, unread topics, sources in error (same rule as the home page). */
export async function getNavCounts(db: Db, now: Date = new Date()) {
  const [[l], [t], [s]] = await Promise.all([
    db.select({ n: count() }).from(lists),
    db.select({ n: count() }).from(topics).where(isNull(topics.readAt)),
    db
      .select({ n: count() })
      .from(sources)
      .where(and(eq(sources.enabled, true), gt(sources.consecutiveFailures, 0), or(isNull(sources.pausedUntil), lte(sources.pausedUntil, now)))),
  ]);
  return { lists: l?.n ?? 0, unread: t?.n ?? 0, errors: s?.n ?? 0 };
}

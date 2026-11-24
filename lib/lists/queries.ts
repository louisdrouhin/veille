import "server-only";
import { asc, count, eq, sql } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { listItems, lists, topics } from "@/lib/db/schema";
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

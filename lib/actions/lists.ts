"use server";

import { and, count, eq, max } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { listItems, lists, topics } from "@/lib/db/schema";
import { cleanListName, nextListColor, type ListColor } from "@/lib/lists/palette";
import { requireSession } from "@/lib/session";
import { id as validId, ValidationError } from "@/lib/validation";

/*
 * Favorite lists (docs/design/v3 § 1). The topic page applies these changes optimistically
 * (useOptimistic) and calls no revalidatePath: in Next 16, revalidating from a Server Function
 * purges the whole client router cache, and « ← Retour » would lose the forum's page and scroll.
 * Pages showing lists are dynamic and refetched when visited.
 */

export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

function failure(err: unknown): { ok: false; error: string } {
  if (err instanceof ValidationError) return { ok: false, error: err.message };
  console.error("[lists]", err);
  return { ok: false, error: "Enregistrement impossible, réessaie." };
}

async function topicExists(topicId: number) {
  const [row] = await getDb().select({ id: topics.id }).from(topics).where(eq(topics.id, topicId));
  if (!row) throw new ValidationError("Ce topic n'existe plus.");
}

async function savedCount(topicId: number): Promise<number> {
  const [row] = await getDb().select({ n: count() }).from(listItems).where(eq(listItems.topicId, topicId));
  return row?.n ?? 0;
}

/** Adds the topic to the list (`on`) or removes it. Idempotent. */
export async function toggleTopicInList(topicId: number, listId: number, on: boolean): Promise<ActionResult<{ savedCount: number }>> {
  await requireSession();
  try {
    const t = validId(topicId);
    const l = validId(listId);
    const db = getDb();
    if (on) {
      await topicExists(t);
      const [list] = await db.select({ id: lists.id }).from(lists).where(eq(lists.id, l));
      if (!list) throw new ValidationError("Cette liste n'existe plus.");
      await db.insert(listItems).values({ listId: l, topicId: t }).onConflictDoNothing();
    } else {
      await db.delete(listItems).where(and(eq(listItems.listId, l), eq(listItems.topicId, t)));
    }
    return { ok: true, savedCount: await savedCount(t) };
  } catch (err) {
    return failure(err);
  }
}

export type CreatedList = { id: number; name: string; color: ListColor };

/** Creates a list (color: first unused one of the palette, placed last) and, with `topicId`, saves the topic in it. */
export async function createList(input: { name: string; topicId?: number }): Promise<ActionResult<{ list: CreatedList; savedCount?: number }>> {
  await requireSession();
  try {
    const name = cleanListName(input.name);
    if (!name) throw new ValidationError("Le nom doit faire entre 1 et 60 caractères.");
    const topicId = input.topicId === undefined ? undefined : validId(input.topicId);
    if (topicId !== undefined) await topicExists(topicId);
    const list = await getDb().transaction(async (tx) => {
      const existing = await tx.select({ color: lists.color }).from(lists);
      const [{ last } = { last: null }] = await tx.select({ last: max(lists.position) }).from(lists);
      const [created] = await tx
        .insert(lists)
        .values({ name, color: nextListColor(existing.map((e) => e.color)), position: (last ?? -1) + 1 })
        .returning({ id: lists.id, name: lists.name, color: lists.color });
      if (topicId !== undefined) await tx.insert(listItems).values({ listId: created!.id, topicId });
      return created!;
    });
    return { ok: true, list, ...(topicId !== undefined ? { savedCount: await savedCount(topicId) } : {}) };
  } catch (err) {
    return failure(err);
  }
}

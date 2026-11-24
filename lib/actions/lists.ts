"use server";

import { and, asc, count, eq, max } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { listItems, lists, topics } from "@/lib/db/schema";
import { cleanListName, isListColor, nextListColor, type ListColor } from "@/lib/lists/palette";
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

async function listExists(listId: number) {
  const [row] = await getDb().select({ id: lists.id }).from(lists).where(eq(lists.id, listId));
  if (!row) throw new ValidationError("Cette liste n'existe plus.");
}

export async function renameList(listId: number, name: string): Promise<ActionResult<{ name: string }>> {
  await requireSession();
  try {
    const id = validId(listId);
    const clean = cleanListName(name);
    if (!clean) throw new ValidationError("Le nom doit faire entre 1 et 60 caractères.");
    const updated = await getDb().update(lists).set({ name: clean }).where(eq(lists.id, id)).returning({ id: lists.id });
    if (!updated.length) throw new ValidationError("Cette liste n'existe plus.");
    return { ok: true, name: clean };
  } catch (err) {
    return failure(err);
  }
}

export async function setListColor(listId: number, color: string): Promise<ActionResult> {
  await requireSession();
  try {
    const id = validId(listId);
    if (!isListColor(color)) throw new ValidationError("Couleur inconnue.");
    const updated = await getDb().update(lists).set({ color }).where(eq(lists.id, id)).returning({ id: lists.id });
    if (!updated.length) throw new ValidationError("Cette liste n'existe plus.");
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}

/** Rewrites every position (0, 1, 2…) in the given order; ids not given keep their relative order after them. */
async function writeOrder(ids: number[]) {
  await getDb().transaction(async (tx) => {
    const all = await tx.select({ id: lists.id }).from(lists).orderBy(asc(lists.position), asc(lists.id));
    const order = [...ids.filter((id) => all.some((l) => l.id === id)), ...all.map((l) => l.id).filter((id) => !ids.includes(id))];
    for (const [position, id] of order.entries()) await tx.update(lists).set({ position }).where(eq(lists.id, id));
  });
}

/** ↑ / ↓: swaps the list with its neighbour. */
export async function moveList(listId: number, direction: "up" | "down"): Promise<ActionResult> {
  await requireSession();
  try {
    const id = validId(listId);
    if (direction !== "up" && direction !== "down") throw new ValidationError("Direction inconnue.");
    const all = await getDb().select({ id: lists.id }).from(lists).orderBy(asc(lists.position), asc(lists.id));
    const ids = all.map((l) => l.id);
    const from = ids.indexOf(id);
    if (from < 0) throw new ValidationError("Cette liste n'existe plus.");
    const to = direction === "up" ? from - 1 : from + 1;
    if (to < 0 || to >= ids.length) return { ok: true };
    [ids[from], ids[to]] = [ids[to]!, ids[from]!];
    await writeOrder(ids);
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}

/** Drag and drop (desktop): the whole new order. */
export async function reorderLists(ids: number[]): Promise<ActionResult> {
  await requireSession();
  try {
    if (!Array.isArray(ids) || ids.length > 500) throw new ValidationError("Ordre invalide.");
    await writeOrder(ids.map(validId));
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}

/** Deletes the list and its items (cascade); topics are untouched. */
export async function deleteList(listId: number): Promise<ActionResult> {
  await requireSession();
  try {
    await getDb().delete(lists).where(eq(lists.id, validId(listId)));
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}

/** What « Annuler » needs to put a removed topic back where it was (same date of addition). */
export type UndoToken = { listId: number; topicId: number; addedAt: string };

export async function removeFromList(listId: number, topicId: number): Promise<ActionResult<{ undoToken: UndoToken | null }>> {
  await requireSession();
  try {
    const [row] = await getDb()
      .delete(listItems)
      .where(and(eq(listItems.listId, validId(listId)), eq(listItems.topicId, validId(topicId))))
      .returning();
    return { ok: true, undoToken: row ? { listId: row.listId, topicId: row.topicId, addedAt: row.addedAt.toISOString() } : null };
  } catch (err) {
    return failure(err);
  }
}

/** « Annuler » after a removal: puts the topic back with its original date of addition. */
export async function restoreToList(token: UndoToken): Promise<ActionResult> {
  await requireSession();
  try {
    const listId = validId(token?.listId);
    const topicId = validId(token?.topicId);
    const addedAt = new Date(String(token?.addedAt));
    if (Number.isNaN(addedAt.getTime()) || addedAt.getTime() > Date.now() + 60_000) throw new ValidationError("Annulation invalide.");
    await listExists(listId);
    await topicExists(topicId);
    await getDb().insert(listItems).values({ listId, topicId, addedAt }).onConflictDoNothing();
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}

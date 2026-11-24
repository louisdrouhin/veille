/**
 * Favorite lists, part 1 (docs/design/v3): palette, the save actions of the topic page
 * (toggleTopicInList, createList), the picker query and the ★ count of topic rows.
 */
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { cleanListName, LIST_COLORS, nextListColor } from "@/lib/lists/palette";

const state = vi.hoisted(() => ({ db: null as unknown as Db }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireSession: vi.fn(async () => ({ user: { id: "u1", name: "Moi" } })) }));
vi.mock("@/lib/db", () => ({ getDb: () => state.db }));

const { revalidatePath } = await import("next/cache");
const { requireSession } = await import("@/lib/session");
const { createList, toggleTopicInList } = await import("@/lib/actions/lists");
const { getPickerLists, savedCountOf } = await import("@/lib/lists/queries");

const { forums, listItems, lists, topics } = schema;
let t1: number;
let t2: number;

beforeEach(async () => {
  vi.mocked(revalidatePath).mockClear();
  const pg = drizzle(new PGlite(), { schema });
  await migrate(pg, { migrationsFolder: path.join(import.meta.dirname, "..", "drizzle") });
  state.db = pg as unknown as Db;
  const [forum] = await state.db.insert(forums).values({ name: "Labo", slug: "labo" }).returning();
  const now = new Date("2026-11-24T08:00:00Z");
  const rows = await state.db
    .insert(topics)
    .values(["a", "b"].map((x) => ({ forumId: forum!.id, title: x, url: `https://ex.com/${x}`, normalizedUrl: `https://ex.com/${x}`, publishedAt: now, lastActivityAt: now })))
    .returning({ id: topics.id });
  [t1, t2] = rows.map((r) => r.id) as [number, number];
});

describe("palette", () => {
  it("8 colors, the first unused one for a new list, then round again", () => {
    expect(LIST_COLORS).toEqual(["slate", "blue", "teal", "green", "mustard", "orange", "rose", "violet"]);
    expect(nextListColor([])).toBe("slate");
    expect(nextListColor(["slate", "teal"])).toBe("blue");
    expect(nextListColor([...LIST_COLORS])).toBe("slate");
    expect(nextListColor([...LIST_COLORS, "slate"])).toBe("blue");
  });

  it("names: trimmed, 1 to 60 characters", () => {
    expect(cleanListName("  Homelab  ")).toBe("Homelab");
    expect(cleanListName("À  lire")).toBe("À lire");
    expect(cleanListName("   ")).toBeNull();
    expect(cleanListName("x".repeat(61))).toBeNull();
    expect(cleanListName(42)).toBeNull();
  });
});

describe("createList", () => {
  it("creates lists in order with the next free color, and saves the topic in it", async () => {
    const a = await createList({ name: " Homelab ", topicId: t1 });
    const b = await createList({ name: "Travail" });
    expect(a).toMatchObject({ ok: true, list: { name: "Homelab", color: "slate" }, savedCount: 1 });
    expect(b).toMatchObject({ ok: true, list: { name: "Travail", color: "blue" } });
    expect(b).not.toHaveProperty("savedCount");
    const rows = await state.db.select().from(lists).orderBy(asc(lists.position));
    expect(rows.map((r) => [r.name, r.position])).toEqual([
      ["Homelab", 0],
      ["Travail", 1],
    ]);
    expect(await state.db.select().from(listItems)).toHaveLength(1);
  });

  it("allows an exact duplicate name (the UI only warns)", async () => {
    await createList({ name: "Homelab" });
    expect(await createList({ name: "Homelab" })).toMatchObject({ ok: true });
  });

  it("refuses an empty or too long name, or an unknown topic, without creating anything", async () => {
    expect(await createList({ name: "  " })).toMatchObject({ ok: false });
    expect(await createList({ name: "x".repeat(61) })).toMatchObject({ ok: false });
    expect(await createList({ name: "Ok", topicId: 999_999 })).toEqual({ ok: false, error: "Ce topic n'existe plus." });
    expect(await state.db.select().from(lists)).toEqual([]);
  });

  it("the database refuses what the action would refuse", async () => {
    await expect(state.db.insert(lists).values({ name: " ", color: "slate" })).rejects.toThrow();
    await expect(state.db.insert(lists).values({ name: "x", color: "red" as never })).rejects.toThrow();
  });
});

describe("toggleTopicInList", () => {
  it("adds and removes, idempotent, returning how many lists hold the topic", async () => {
    const a = await createList({ name: "A" });
    const b = await createList({ name: "B" });
    if (!a.ok || !b.ok) throw new Error("setup");
    expect(await toggleTopicInList(t1, a.list.id, true)).toEqual({ ok: true, savedCount: 1 });
    expect(await toggleTopicInList(t1, a.list.id, true)).toEqual({ ok: true, savedCount: 1 });
    expect(await toggleTopicInList(t1, b.list.id, true)).toEqual({ ok: true, savedCount: 2 });
    expect(await toggleTopicInList(t1, a.list.id, false)).toEqual({ ok: true, savedCount: 1 });
    expect(await toggleTopicInList(t1, a.list.id, false)).toEqual({ ok: true, savedCount: 1 });
  });

  it("refuses an unknown list or topic and invalid ids", async () => {
    const a = await createList({ name: "A" });
    if (!a.ok) throw new Error("setup");
    expect(await toggleTopicInList(t1, 999, true)).toEqual({ ok: false, error: "Cette liste n'existe plus." });
    expect(await toggleTopicInList(999_999, a.list.id, true)).toEqual({ ok: false, error: "Ce topic n'existe plus." });
    expect(await toggleTopicInList(-1, a.list.id, true)).toMatchObject({ ok: false });
    expect(await toggleTopicInList(1.5, a.list.id, true)).toMatchObject({ ok: false });
  });

  it("never revalidates (it would purge the router cache and lose « ← Retour »'s scroll)", async () => {
    const a = await createList({ name: "A", topicId: t1 });
    if (!a.ok) throw new Error("setup");
    await toggleTopicInList(t2, a.list.id, true);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("checks the session first", async () => {
    vi.mocked(requireSession).mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
    await expect(toggleTopicInList(t1, 1, true)).rejects.toThrow("NEXT_REDIRECT");
  });
});

describe("picker data and ★ count", () => {
  it("lists in display order with their size, and the ones holding the topic", async () => {
    const a = await createList({ name: "A", topicId: t1 });
    const b = await createList({ name: "B", topicId: t2 });
    if (!a.ok || !b.ok) throw new Error("setup");
    await toggleTopicInList(t1, b.list.id, true);
    const picker = await getPickerLists(state.db, t2);
    expect(picker.lists.map((l) => [l.name, l.color, l.count])).toEqual([
      ["A", "slate", 1],
      ["B", "blue", 2],
    ]);
    expect(picker.selected).toEqual([b.list.id]);

    const counts = await state.db.select({ id: topics.id, n: savedCountOf() }).from(topics).orderBy(asc(topics.id));
    expect(counts).toEqual([
      { id: t1, n: 2 },
      { id: t2, n: 1 },
    ]);
  });

  it("deleting a list removes its items, not the topics", async () => {
    const a = await createList({ name: "A", topicId: t1 });
    if (!a.ok) throw new Error("setup");
    await state.db.delete(lists).where(eq(lists.id, a.list.id));
    expect(await state.db.select().from(listItems)).toEqual([]);
    expect(await state.db.select().from(topics)).toHaveLength(2);
  });
});

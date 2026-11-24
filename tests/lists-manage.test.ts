/**
 * Favorite lists, part 2 (docs/design/v3): managing lists (rename, color, order, delete), removal
 * with « Annuler », the queries of /listes and /listes/[id], the navigation counts and the
 * Markdown export.
 */
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { escapeLinkText, listToMarkdown } from "@/lib/lists/markdown";

const state = vi.hoisted(() => ({ db: null as unknown as Db }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireSession: vi.fn(async () => ({ user: { id: "u1", name: "Moi" } })) }));
vi.mock("@/lib/db", () => ({ getDb: () => state.db }));

const { revalidatePath } = await import("next/cache");
const actions = await import("@/lib/actions/lists");
const q = await import("@/lib/lists/queries");

const { forums, listItems, lists, sources, topics } = schema;
let forumId: number;
let topicIds: number[];

async function newList(name: string, topicIds: number[] = []) {
  const res = await actions.createList({ name });
  if (!res.ok) throw new Error(res.error);
  for (const [i, t] of topicIds.entries()) {
    await state.db.insert(listItems).values({ listId: res.list.id, topicId: t, addedAt: new Date(Date.UTC(2026, 10, 20, 8, i)) });
  }
  return res.list.id;
}
const order = async () => (await state.db.select({ name: lists.name }).from(lists).orderBy(asc(lists.position))).map((r) => r.name);

beforeEach(async () => {
  vi.mocked(revalidatePath).mockClear();
  const pg = drizzle(new PGlite(), { schema });
  await migrate(pg, { migrationsFolder: path.join(import.meta.dirname, "..", "drizzle") });
  state.db = pg as unknown as Db;
  const [forum] = await state.db.insert(forums).values({ name: "Proxmox & homelab", slug: "lab" }).returning();
  forumId = forum!.id;
  const [source] = await state.db.insert(sources).values({ forumId, name: "Proxmox Blog", url: "https://proxmox.example/feed" }).returning();
  const now = new Date("2026-11-20T08:00:00Z");
  topicIds = (
    await state.db
      .insert(topics)
      .values(
        ["Proxmox VE 9.2 [beta] disponible", "Ceph", "ZFS"].map((title, i) => ({
          forumId,
          sourceId: i === 2 ? null : source!.id,
          title,
          url: `https://ex.com/${i}`,
          normalizedUrl: `https://ex.com/${i}`,
          publishedAt: now,
          lastActivityAt: now,
          readAt: i === 1 ? now : null,
        })),
      )
      .returning({ id: topics.id })
  ).map((r) => r.id);
});

describe("rename and color", () => {
  it("renames (trimmed) and recolors", async () => {
    const id = await newList("Homelab");
    expect(await actions.renameList(id, "  Mon labo  ")).toEqual({ ok: true, name: "Mon labo" });
    expect(await actions.setListColor(id, "violet")).toEqual({ ok: true });
    const [row] = await state.db.select().from(lists).where(eq(lists.id, id));
    expect(row).toMatchObject({ name: "Mon labo", color: "violet" });
  });

  it("refuses bad names, unknown colors and unknown lists", async () => {
    const id = await newList("Homelab");
    expect(await actions.renameList(id, " ")).toMatchObject({ ok: false });
    expect(await actions.setListColor(id, "red")).toEqual({ ok: false, error: "Couleur inconnue." });
    expect(await actions.renameList(999, "x")).toEqual({ ok: false, error: "Cette liste n'existe plus." });
    expect(await actions.setListColor(999, "blue")).toEqual({ ok: false, error: "Cette liste n'existe plus." });
  });
});

describe("order", () => {
  it("↑ / ↓ swap with the neighbour, no-op at the ends", async () => {
    const [a, , c] = [await newList("A"), await newList("B"), await newList("C")];
    await actions.moveList(c, "up");
    expect(await order()).toEqual(["A", "C", "B"]);
    await actions.moveList(a, "up");
    await actions.moveList(a, "down");
    expect(await order()).toEqual(["C", "A", "B"]);
    expect(await actions.moveList(a, "sideways" as never)).toMatchObject({ ok: false });
  });

  it("drag and drop rewrites the whole order; unknown ids are ignored, missing ones keep their place after", async () => {
    const [a, b, c] = [await newList("A"), await newList("B"), await newList("C")];
    await actions.reorderLists([c, a, b]);
    expect(await order()).toEqual(["C", "A", "B"]);
    await actions.reorderLists([b, 999]);
    expect(await order()).toEqual(["B", "C", "A"]);
    expect(await actions.reorderLists([-1])).toMatchObject({ ok: false });
  });
});

describe("delete, remove and undo", () => {
  it("deleting a list keeps the topics", async () => {
    const id = await newList("A", topicIds);
    expect(await actions.deleteList(id)).toEqual({ ok: true });
    expect(await state.db.select().from(listItems)).toEqual([]);
    expect(await state.db.select().from(topics)).toHaveLength(3);
  });

  it("removal returns what « Annuler » needs, and restoring keeps the original date of addition", async () => {
    const id = await newList("A", topicIds);
    const [before] = await state.db.select().from(listItems).where(eq(listItems.topicId, topicIds[0]!));
    const res = await actions.removeFromList(id, topicIds[0]!);
    if (!res.ok || !res.undoToken) throw new Error("no token");
    expect(await state.db.select().from(listItems)).toHaveLength(2);
    expect(await actions.restoreToList(res.undoToken)).toEqual({ ok: true });
    const [after] = await state.db.select().from(listItems).where(eq(listItems.topicId, topicIds[0]!));
    expect(after!.addedAt.toISOString()).toBe(before!.addedAt.toISOString());
    // Twice: idempotent.
    expect(await actions.restoreToList(res.undoToken)).toEqual({ ok: true });
  });

  it("removing what is not there gives no token; a forged or stale token is refused", async () => {
    const id = await newList("A");
    expect(await actions.removeFromList(id, topicIds[0]!)).toEqual({ ok: true, undoToken: null });
    expect(await actions.restoreToList({ listId: id, topicId: topicIds[0]!, addedAt: "not a date" })).toMatchObject({ ok: false });
    expect(await actions.restoreToList({ listId: 999, topicId: topicIds[0]!, addedAt: new Date().toISOString() })).toEqual({
      ok: false,
      error: "Cette liste n'existe plus.",
    });
  });

  it("no list action revalidates (router cache and « ← Retour » kept; pages are refreshed on visit)", async () => {
    const id = await newList("A", topicIds);
    await actions.renameList(id, "B");
    await actions.setListColor(id, "teal");
    await actions.moveList(id, "up");
    await actions.removeFromList(id, topicIds[0]!);
    await actions.deleteList(id);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("queries of the list pages", () => {
  it("summaries: size and latest addition", async () => {
    await newList("A", topicIds);
    await newList("B");
    const rows = await q.getListSummaries(state.db);
    expect(rows.map((r) => [r.name, r.count, r.lastAddedAt?.toISOString() ?? null])).toEqual([
      ["A", 3, "2026-11-20T08:02:00.000Z"],
      ["B", 0, null],
    ]);
  });

  it("a list's items: newest addition first, with forum, read state and date of addition; 25 per page", async () => {
    const id = await newList("A", topicIds);
    const items = await q.getListItems(state.db, id, 1);
    expect(items.map((i) => [i.title, i.read, i.forum?.slug, i.savedCount])).toEqual([
      ["ZFS", false, "lab", 1],
      ["Ceph", true, "lab", 1],
      ["Proxmox VE 9.2 [beta] disponible", false, "lab", 1],
    ]);
    expect(items[0]!.addedAt.toISOString()).toBe("2026-11-20T08:02:00.000Z");
    expect(await q.getListItems(state.db, id, 2)).toEqual([]);
    expect(q.LIST_PAGE_SIZE).toBe(25);
  });

  it("exports the whole list per id, and nav counts", async () => {
    const a = await newList("A", topicIds);
    const b = await newList("B");
    const exports = await q.getListExports(state.db, [a, b]);
    expect(exports.get(a)!.map((i) => [i.title, i.source, i.forum])).toEqual([
      ["ZFS", null, "Proxmox & homelab"],
      ["Ceph", "Proxmox Blog", "Proxmox & homelab"],
      ["Proxmox VE 9.2 [beta] disponible", "Proxmox Blog", "Proxmox & homelab"],
    ]);
    expect(exports.get(b)).toEqual([]);
    await state.db.update(sources).set({ consecutiveFailures: 2 });
    expect(await q.getNavCounts(state.db)).toEqual({ lists: 2, unread: 2, errors: 1 });
  });
});

describe("Markdown export", () => {
  it("title, count and date (Paris), then one line per article in display order", () => {
    const md = listToMarkdown(
      "Homelab",
      [
        { title: "Proxmox VE 9.2 disponible", url: "https://www.proxmox.com/news", source: "Proxmox Blog", forum: "Proxmox & homelab" },
        { title: "Kubernetes : faille [ingress]", url: "https://news.ycombinator.com/item?id=1", source: "Hacker News", forum: "DevOps" },
      ],
      new Date("2026-11-23T23:30:00Z"), // already the 24th in Paris
    );
    expect(md).toBe(
      [
        "## Homelab",
        "_2 articles · exporté de Folders le 24/11/2026_",
        "",
        "- [Proxmox VE 9.2 disponible](https://www.proxmox.com/news) — Proxmox Blog · Proxmox & homelab",
        "- [Kubernetes : faille \\[ingress\\]](https://news.ycombinator.com/item?id=1) — Hacker News · DevOps",
        "",
      ].join("\n"),
    );
  });

  it("singular, deleted source, and URLs that cannot break the link", () => {
    const md = listToMarkdown("A", [{ title: "x", url: "https://ex.com/a (b)", source: null, forum: "F" }], new Date("2026-11-24T10:00:00Z"));
    expect(md).toContain("_1 article · exporté");
    expect(md).toContain("- [x](https://ex.com/a%20%28b%29) — Source supprimée · F");
    expect(escapeLinkText("a\\b [c]\n d")).toBe("a\\\\b \\[c\\] d");
  });
});

/**
 * Context menu of the topic rows (docs/design/3.2): shortcuts and their conflicts, placement near
 * the edges, the row's ⋯ button, unread counters, and the server actions behind « Marquer comme
 * lu / non lu » and the lists submenu (no revalidatePath: the page and its scroll stay).
 */
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";

const state = vi.hoisted(() => ({ db: null as unknown as Db }));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/session", () => ({ requireSession: vi.fn(async () => ({ user: { id: "u1", name: "Moi" } })) }));
vi.mock("@/lib/db", () => ({ getDb: () => state.db }));
vi.mock("next/link", () => ({
  default: (props: { href: string; prefetch?: boolean }) => {
    const rest: Record<string, unknown> = { ...props, "data-prefetch": String(props.prefetch) };
    delete rest.prefetch;
    return createElement("a", rest);
  },
}));

const { revalidatePath } = await import("next/cache");
const { placeMenu, placeSubmenu, rowAccelerator } = await import("@/components/topic/topic-menu");
const { unreadDelta } = await import("@/components/topic/read-topics");
const { TopicRow } = await import("@/components/topic/topic-row");
const { setTopicReadAction } = await import("@/lib/actions/topics");
const { getTopicListsAction } = await import("@/lib/actions/lists");

const key = (k: string, mods: Partial<Record<"shiftKey" | "ctrlKey" | "metaKey" | "altKey", boolean>> = {}) => ({
  key: k,
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...mods,
});

describe("shortcuts", () => {
  it("the accelerators of the table (§ 2)", () => {
    expect(rowAccelerator(key("ContextMenu"), "forum")).toBe("menu");
    expect(rowAccelerator(key("F10", { shiftKey: true }), "forum")).toBe("menu");
    expect(rowAccelerator(key("Enter", { ctrlKey: true }), "forum")).toBe("newTab");
    expect(rowAccelerator(key("Enter", { metaKey: true }), "forum")).toBe("newTab");
    expect(rowAccelerator(key("m"), "forum")).toBe("toggleRead");
    expect(rowAccelerator(key("e"), "forum")).toBe("lists");
    expect(rowAccelerator(key("o"), "forum")).toBe("article");
    expect(rowAccelerator(key("c"), "forum")).toBe("copyArticle");
    expect(rowAccelerator(key("C", { shiftKey: true }), "forum")).toBe("copyFolders");
    expect(rowAccelerator(key("Delete"), "list")).toBe("remove");
  });

  it("no conflict with the page's own: « u » and Escape stay « back », plain Enter opens the link", () => {
    for (const k of ["u", "U", "Escape", "Enter", "F10", "Backspace"]) expect(rowAccelerator(key(k), "forum"), k).toBeNull();
    // « Retirer » only in a list; never with a modifier the browser uses (Ctrl+C, Alt+…).
    expect(rowAccelerator(key("Delete"), "forum")).toBeNull();
    expect(rowAccelerator(key("c", { ctrlKey: true }), "forum")).toBeNull();
    expect(rowAccelerator(key("m", { altKey: true }), "forum")).toBeNull();
    expect(rowAccelerator(key("M", { shiftKey: true }), "forum")).toBeNull();
  });
});

describe("placement near the edges (§ 6)", () => {
  const view = { w: 1280, h: 800 };
  const size = { w: 284, h: 300 };

  it("at the cursor (+2 px), else up and / or left, never closer than 8 px to the window", () => {
    expect(placeMenu(size, view, { point: { x: 100, y: 100 } })).toEqual({ left: 102, top: 102 });
    expect(placeMenu(size, view, { point: { x: 1270, y: 790 } })).toEqual({ left: 986, top: 490 });
    expect(placeMenu(size, { w: 1280, h: 250 }, { point: { x: 10, y: 10 } })).toEqual({ left: 12, top: 8 });
  });

  it("from ⋯ or the keyboard: under the button, right-aligned; above it near the bottom", () => {
    const anchor = { left: 1000, right: 1028, top: 300, bottom: 328 };
    expect(placeMenu(size, view, { anchor })).toEqual({ left: 744, top: 332 });
    expect(placeMenu(size, view, { anchor: { ...anchor, top: 700, bottom: 728 } })).toEqual({ left: 744, top: 396 });
  });

  it("submenu: right of the menu, aligned on its item; on the left near the right edge", () => {
    const sub = { w: 248, h: 200 };
    expect(placeSubmenu(sub, view, { left: 100, right: 384 }, { top: 200 })).toEqual({ left: 383, top: 195 });
    expect(placeSubmenu(sub, view, { left: 900, right: 1184 }, { top: 700 })).toEqual({ left: 653, top: 592 });
  });
});

describe("unread counters", () => {
  const change = (id: number, read: boolean, at: number, forumSlug = "homelab") => ({ key: id, id, read, at, forumSlug });

  it("only the changes made after the counter was rendered, of its forum", () => {
    const changes = [change(1, true, 1000), change(2, false, 2000), change(3, true, Number.POSITIVE_INFINITY, "securite")];
    expect(unreadDelta(changes, 500)).toBe(-1); // -1 +1 -1
    expect(unreadDelta(changes, 500, "homelab")).toBe(0);
    expect(unreadDelta(changes, 1500, "homelab")).toBe(1);
    expect(unreadDelta(changes, 5000)).toBe(-1); // pending: every counter on screen
  });
});

describe("the row's ⋯ button", () => {
  const html = renderToString(
    createElement(TopicRow, {
      topic: { id: 7, title: "Proxmox VE 9.2", replyCount: 0, lastActivityAt: new Date("2026-11-24T08:00:00Z"), read: false, sourceName: "Proxmox Blog", faviconSrc: null },
    }),
  );

  it("is a menu button, labelled with the topic, desktop with a mouse only, invisible at rest", () => {
    const button = /<span class="hidden desk:flex[^"]*"><button[^>]*>/.exec(html)?.[0] ?? "";
    expect(button).toContain('aria-label="Actions pour « Proxmox VE 9.2 »"');
    expect(button).toContain('aria-haspopup="menu"');
    expect(button).toContain('aria-expanded="false"');
    expect(button).toMatch(/opacity-0 .*group-hover:opacity-100 .*group-focus-within:opacity-100/);
  });

  it("the topic link stays the row's focus point, without prefetch", () => {
    const link = /<a href="\/t\/7"[^>]*>/.exec(html)?.[0] ?? "";
    expect(link).toContain("data-topic-link");
    expect(link).toContain('data-prefetch="false"');
  });
});

describe("server actions", () => {
  beforeEach(async () => {
    vi.mocked(revalidatePath).mockClear();
    const pg = drizzle(new PGlite(), { schema });
    await migrate(pg, { migrationsFolder: path.join(import.meta.dirname, "..", "drizzle") });
    state.db = pg as unknown as Db;
    const [forum] = await state.db.insert(schema.forums).values({ name: "Homelab", slug: "homelab" }).returning();
    await state.db.insert(schema.topics).values({ id: 7, forumId: forum!.id, title: "Proxmox VE 9.2", url: "https://example.com/pve", normalizedUrl: "example.com/pve", publishedAt: new Date(), lastActivityAt: new Date() });
    await state.db.insert(schema.lists).values([
      { id: 1, name: "Homelab", color: "teal", position: 0 },
      { id: 2, name: "À lire plus tard", color: "mustard", position: 1 },
    ]);
    await state.db.insert(schema.listItems).values({ listId: 2, topicId: 7 });
  });

  const readAt = async () => (await state.db.select({ r: schema.topics.readAt }).from(schema.topics).where(eq(schema.topics.id, 7)))[0]!.r;

  it("« Marquer comme lu / non lu »: saved, with the server time, and no revalidatePath", async () => {
    const before = Date.now();
    const r = await setTopicReadAction(7, true);
    expect(r).toMatchObject({ ok: true });
    expect((r as { at: number }).at).toBeGreaterThanOrEqual(before);
    const first = await readAt();
    expect(first).toBeInstanceOf(Date);
    // Already read: the date it was first read stays.
    await setTopicReadAction(7, true);
    expect((await readAt())?.getTime()).toBe(first!.getTime());
    expect(await setTopicReadAction(7, false)).toMatchObject({ ok: true });
    expect(await readAt()).toBeNull();
    expect(await setTopicReadAction(999, true)).toEqual({ ok: false, error: "Ce topic n'existe plus." });
    expect(await setTopicReadAction(-1, true)).toMatchObject({ ok: false });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("the lists submenu: same lists and order as the ★ popover, with those holding the topic", async () => {
    const r = await getTopicListsAction(7);
    expect(r).toMatchObject({ ok: true, selected: [2] });
    expect((r as { lists: { name: string }[] }).lists.map((l) => l.name)).toEqual(["Homelab", "À lire plus tard"]);
    expect(await getTopicListsAction(0)).toMatchObject({ ok: false });
  });
});

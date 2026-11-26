/**
 * Keyboard shortcuts (docs/design/3.5 § 6), the rules: which key does what, ignored while typing or with modifiers
 * (Ctrl+K and the browser keep theirs, Ctrl+Entrée opens in a new tab), « g » + letter, the list a topic was opened
 * from (sessionStorage, validated), the position in it; « S » replaces « E » in the context menu.
 */
import { describe, expect, it, vi } from "vitest";
import { G_TARGETS, globalAction, isTyping, parseOrigin, positionIn } from "@/lib/shortcuts";

vi.mock("server-only", () => ({}));
const { rowAccelerator } = await import("@/components/topic/topic-menu");

const key = (k: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });

describe("keys", () => {
  it("lists, pages, help and « g »", () => {
    expect(globalAction(key("j"))).toEqual({ kind: "move", step: 1 });
    expect(globalAction(key("k"))).toEqual({ kind: "move", step: -1 });
    expect(globalAction(key("n"))).toEqual({ kind: "page", rel: "next" });
    expect(globalAction(key("p"))).toEqual({ kind: "page", rel: "prev" });
    expect(globalAction(key("Enter"))).toEqual({ kind: "row", key: "Enter" });
    expect(globalAction(key("Enter", { ctrlKey: true }))).toEqual({ kind: "row", key: "newTab" });
    expect(globalAction(key("Enter", { metaKey: true }))).toEqual({ kind: "row", key: "newTab" });
    for (const k of ["o", "m", "s"]) expect(globalAction(key(k))).toEqual({ kind: "row", key: k });
    expect(globalAction(key("C", { shiftKey: true }))).toEqual({ kind: "row", key: "C" });
    expect(globalAction(key("?", { shiftKey: true }))).toEqual({ kind: "help" });
    expect(globalAction(key("g"))).toEqual({ kind: "g" });
  });

  it("never steals « / », Ctrl+K, « u », Échap, Espace, nor a key with Ctrl / ⌘ / Alt", () => {
    for (const k of ["/", "u", "Escape", " ", "c", "e", "x"]) expect(globalAction(key(k)), k).toBeNull();
    expect(globalAction(key("k", { ctrlKey: true }))).toBeNull();
    expect(globalAction(key("j", { metaKey: true }))).toBeNull();
    expect(globalAction(key("m", { altKey: true }))).toBeNull();
  });

  it("ignored while typing in a field", () => {
    const el = (tagName: string, extra: object = {}) => ({ tagName, closest: () => null, ...extra });
    expect(isTyping(el("INPUT"))).toBe(true);
    expect(isTyping(el("TEXTAREA"))).toBe(true);
    expect(isTyping(el("SELECT"))).toBe(true);
    expect(isTyping(el("DIV", { isContentEditable: true }))).toBe(true);
    expect(isTyping(el("A"))).toBe(false);
    expect(isTyping(null)).toBe(false);
  });

  it("g + h f b l s p", () => {
    expect(Object.fromEntries(Object.entries(G_TARGETS).map(([k, v]) => [k, v.href]))).toEqual({
      h: "/",
      f: "/#forums-title",
      b: "/briefing",
      l: "/listes",
      s: "/stack",
      p: "/parametres",
    });
  });

  it("« S » opens the lists submenu of the context menu (it was « E »)", () => {
    expect(rowAccelerator(key("s"), "forum")).toBe("lists");
    expect(rowAccelerator(key("e"), "forum")).toBeNull();
  });
});

describe("origin list of a topic", () => {
  const origin = { path: "/", label: "Accueil · Derniers non lus", ids: [5, 8, 13], lastId: 8 };

  it("position and neighbours, or nothing for a topic outside the list", () => {
    expect(positionIn(origin, 8)).toEqual({ index: 2, total: 3, prev: 5, next: 13 });
    expect(positionIn(origin, 13)).toEqual({ index: 3, total: 3, prev: 8, next: null });
    expect(positionIn(origin, 99)).toBeNull();
  });

  it("validated when read back (another tab, an old format, a forged value)", () => {
    expect(parseOrigin(JSON.stringify(origin))).toEqual(origin);
    expect(parseOrigin(JSON.stringify({ ...origin, ids: [1, "2", -3, 4.5, 6] }))?.ids).toEqual([1, 6]);
    for (const bad of [null, "", "{", JSON.stringify({ ...origin, path: "https://evil.example" }), JSON.stringify({ ...origin, ids: "1,2" })]) expect(parseOrigin(bad)).toBeNull();
  });
});

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { scrollTopBehavior, showScrollTop } from "@/lib/scroll-top";

const ROOT = path.join(import.meta.dirname, "..");
const read = (...p: string[]) => readFileSync(path.join(ROOT, ...p), "utf8");

describe("showScrollTop", () => {
  const base = { viewportHeight: 800, noteForm: null };
  it("stays hidden until about one screen has been scrolled", () => {
    expect(showScrollTop({ ...base, scrollY: 0 })).toBe(false);
    expect(showScrollTop({ ...base, scrollY: 799 })).toBe(false);
    expect(showScrollTop({ ...base, scrollY: 800 })).toBe(true);
  });
  it("hides while the note form is on screen, shows again once it is off screen", () => {
    expect(showScrollTop({ ...base, scrollY: 2000, noteForm: { top: 500, bottom: 900 } })).toBe(false);
    expect(showScrollTop({ ...base, scrollY: 2000, noteForm: { top: -300, bottom: 10 } })).toBe(false);
    expect(showScrollTop({ ...base, scrollY: 2000, noteForm: { top: 900, bottom: 1300 } })).toBe(true);
    expect(showScrollTop({ ...base, scrollY: 2000, noteForm: { top: -500, bottom: -100 } })).toBe(true);
  });
  it("ignores a zero-height viewport", () => {
    expect(showScrollTop({ scrollY: 100, viewportHeight: 0, noteForm: null })).toBe(false);
  });
});

describe("scrollTopBehavior", () => {
  it("scrolls smoothly, instantly under prefers-reduced-motion", () => {
    expect(scrollTopBehavior(false)).toBe("smooth");
    expect(scrollTopBehavior(true)).toBe("auto");
  });
});

describe("ScrollTopButton markup", () => {
  const src = read("components", "layout", "scroll-top-button.tsx");
  it("is labelled, at least 44 px, mobile only, bottom right", () => {
    expect(src).toContain('aria-label="Remonter en haut"');
    const cls = /className="([^"]+)"/.exec(src)![1]!.split(" ");
    expect(cls).toEqual(expect.arrayContaining(["size-11", "md:hidden", "self-end", "pointer-events-auto"]));
    expect(src).toContain('"(prefers-reduced-motion: reduce)"');
  });
  it("sits first in the toast stack, which clears the iPhone safe area, so toasts never go under it", () => {
    expect(read("app", "(protected)", "layout.tsx")).toMatch(/<Toaster>\s*<ScrollTopButton \/>/);
    expect(read("components", "ui", "toaster.tsx")).toMatch(/fixed inset-x-\[5px\] bottom-\[calc\(env\(safe-area-inset-bottom\)\+8px\)\]/);
  });
});

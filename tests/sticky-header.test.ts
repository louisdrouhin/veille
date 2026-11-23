import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.join(import.meta.dirname, "..");
const read = (...p: string[]) => readFileSync(path.join(ROOT, ...p), "utf8");

describe("sticky app header (iOS 26 status bar)", () => {
  it("is pinned to the top, above the content, with an opaque background", () => {
    // iOS 26 tints the status bar from a pinned, full-width, opaque box at the top edge and then
    // skips its blur; an in-flow or translucent header gets the blurred band and the page color.
    const header = /<header className="([^"]+)"/.exec(read("components", "layout", "app-header.tsx"))![1]!.split(" ");
    expect(header).toEqual(expect.arrayContaining(["sticky", "top-0", "z-40", "bg-bar", "safe-top"]));
    expect(header.some((c) => /^bg-bar\/|backdrop-/.test(c))).toBe(false);
  });

  it("keeps anchor targets clear of it: scroll-padding-top = header height (min-h-13 + border + inset)", () => {
    expect(read("components", "layout", "app-header.tsx")).toMatch(/min-h-13 /);
    expect(read("app", "globals.css")).toMatch(/scroll-padding-top: calc\(3\.25rem \+ 1px \+ env\(safe-area-inset-top\)\);/);
  });
});

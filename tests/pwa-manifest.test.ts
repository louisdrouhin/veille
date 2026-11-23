import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";
import { THEME } from "@/lib/theme";

const ROOT = path.join(import.meta.dirname, "..");

/** Width × height from a PNG's IHDR chunk. */
function pngSize(file: string): [number, number] {
  const b = readFileSync(file);
  expect(b.subarray(1, 4).toString()).toBe("PNG");
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

describe("web app manifest", () => {
  const m = manifest();

  it("makes an installable standalone app named Veille, starting at /", () => {
    expect(m).toMatchObject({ name: "Veille", short_name: "Veille", display: "standalone", start_url: "/", scope: "/", id: "/" });
  });

  it("takes its colors from the design tokens", () => {
    const css = readFileSync(path.join(ROOT, "app", "globals.css"), "utf8");
    const root = /:root \{([\s\S]*?)\n\}/.exec(css)![1]!;
    const token = (name: string) => new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6});`).exec(root)![1]!;
    expect(THEME).toEqual({ bar: token("bar"), barAccent: token("bar-accent"), bg: token("bg") });
    expect(m.theme_color).toBe(token("bar"));
    expect(m.background_color).toBe(token("bg"));
  });

  it("lists 192 and 512 icons plus a maskable one, and the files have those sizes", () => {
    const icons = m.icons ?? [];
    expect(icons.map((i) => `${i.sizes} ${i.purpose}`)).toEqual(["192x192 any", "512x512 any", "512x512 maskable"]);
    for (const icon of icons) {
      const [w, h] = pngSize(path.join(ROOT, "public", icon.src));
      expect(`${w}x${h}`).toBe(icon.sizes);
    }
  });

  it("iOS: opaque status bar, and the same theme color in the <meta> as in the manifest", () => {
    // app/layout.tsx imports next/font (not loadable here): checked on its source.
    const layout = readFileSync(path.join(ROOT, "app", "layout.tsx"), "utf8");
    // "black-translucent" puts the page under the status bar, where iOS blurs the header.
    expect(layout).toMatch(/statusBarStyle: "default"/);
    expect(layout).toMatch(/themeColor: THEME\.bar\b/);
    expect(m.theme_color).toBe(THEME.bar);
  });

  it("has a 180×180 apple-touch-icon (public/apple-touch-icon.png)", () => {
    expect(pngSize(path.join(ROOT, "public", "apple-touch-icon.png"))).toEqual([180, 180]);
  });
});

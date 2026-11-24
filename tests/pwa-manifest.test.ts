import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";
import { THEME, THEME_DARK, themeColor } from "@/lib/theme";
import { color, DARK, LIGHT } from "./helpers/tokens";

const ROOT = path.join(import.meta.dirname, "..");

/** Width × height from a PNG's IHDR chunk. */
function pngSize(file: string): [number, number] {
  const b = readFileSync(file);
  expect(b.subarray(1, 4).toString()).toBe("PNG");
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

describe("web app manifest", () => {
  const m = manifest();

  it("makes an installable standalone app named Folders, starting at /", () => {
    expect(m).toMatchObject({ name: "Folders", short_name: "Folders", display: "standalone", start_url: "/", scope: "/", id: "/" });
  });

  it("takes its colors from the design tokens", () => {
    expect(THEME).toEqual({ bar: color(LIGHT, "bar"), barAccent: color(LIGHT, "bar-accent"), bg: color(LIGHT, "bg") });
    expect(THEME_DARK).toEqual({ bar: color(DARK, "bar") });
    // Launch screen and title bar: the header's color, in both themes.
    expect(m.theme_color).toBe(THEME.bar);
    expect(m.background_color).toBe(THEME.bar);
  });

  it("lists 192 and 512 icons plus a maskable one, and the files have those sizes", () => {
    const icons = m.icons ?? [];
    expect(icons.map((i) => `${i.sizes} ${i.purpose}`)).toEqual(["192x192 any", "512x512 any", "512x512 maskable"]);
    for (const icon of icons) {
      const [w, h] = pngSize(path.join(ROOT, "public", icon.src));
      expect(`${w}x${h}`).toBe(icon.sizes);
    }
  });

  it("iOS: opaque status bar, and a theme color that follows the header in each theme", () => {
    // app/layout.tsx imports next/font (not loadable here): checked on its source.
    const layout = readFileSync(path.join(ROOT, "app", "layout.tsx"), "utf8");
    // "black-translucent" puts the page under the status bar, where iOS blurs the header.
    expect(layout).toMatch(/statusBarStyle: "default"/);
    expect(layout).toMatch(/themeColor: themeColor\(await themePreference\(\)\)/);
    expect(themeColor("light")).toBe(THEME.bar);
    expect(themeColor("dark")).toBe(THEME_DARK.bar);
    expect(themeColor("system")).toEqual([
      { media: "(prefers-color-scheme: light)", color: THEME.bar },
      { media: "(prefers-color-scheme: dark)", color: THEME_DARK.bar },
    ]);
  });

  it("has a 180×180 apple-touch-icon (public/apple-touch-icon.png)", () => {
    expect(pngSize(path.join(ROOT, "public", "apple-touch-icon.png"))).toEqual([180, 180]);
  });
});

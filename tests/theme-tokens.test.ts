/**
 * Dark mode (docs/design/v2): token blocks of app/globals.css, the theme preference helpers,
 * and the rendering rules that keep the strict CSP intact (no inline script, no anti-flash hack).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseTheme, themeCookieOptions, THEMES } from "@/lib/theme";
import { color, DARK, GLOBALS_CSS, LIGHT, SYSTEM_DARK } from "./helpers/tokens";

const ROOT = path.join(import.meta.dirname, "..");
const read = (...p: string[]) => readFileSync(path.join(ROOT, ...p), "utf8");

describe("design tokens v2", () => {
  it("match docs/design/v2/veille-tokens.css, light and dark", () => {
    const doc = read("docs", "design", "v2", "veille-tokens.css");
    for (const [selector, tokens] of [
      [':root,\n:root[data-theme="light"] {', LIGHT],
      [':root[data-theme="dark"] {', DARK],
    ] as const) {
      const start = doc.indexOf(selector);
      const body = doc.slice(start, doc.indexOf("\n}", start));
      for (const [name, value] of Object.entries(tokens)) expect(body, `--${name}`).toContain(`--${name}: ${value};`);
    }
  });

  it("forced dark and system dark are the same block, with the same names as light", () => {
    expect(SYSTEM_DARK).toEqual(DARK);
    expect(Object.keys(DARK).sort()).toEqual(Object.keys(LIGHT).sort());
    expect(GLOBALS_CSS).not.toMatch(/^\.dark\b/m); // v1 class replaced by data-theme
  });

  it("theme picker previews use the fixed values of both themes", () => {
    const preview = (name: string) => new RegExp(`--color-preview-${name}:\\s*(#[0-9A-F]{6});`).exec(GLOBALS_CSS)![1];
    expect(preview("light-bg")).toBe(color(LIGHT, "bg"));
    expect(preview("light-bar")).toBe(color(LIGHT, "bar"));
    expect(preview("light-surface")).toBe(color(LIGHT, "surface"));
    expect(preview("dark-bg")).toBe(color(DARK, "bg"));
    expect(preview("dark-bar")).toBe(color(DARK, "bar"));
    expect(preview("dark-surface")).toBe(color(DARK, "surface"));
  });

  it("keeps the local rules merged with the v2 tokens (anchors, safe areas, reading mode)", () => {
    expect(GLOBALS_CSS).toMatch(/scroll-padding-top:/);
    expect(GLOBALS_CSS).toMatch(/@utility safe-top/);
    expect(GLOBALS_CSS).toMatch(/\.reader pre/);
    // next/font/local variables of app/fonts.ts
    const fonts = read("app", "fonts.ts");
    for (const v of ["--font-plex-sans", "--font-plex-cond", "--font-plex-mono"]) {
      expect(fonts).toContain(`variable: "${v}"`);
      expect(GLOBALS_CSS).toContain(`var(${v})`);
    }
  });
});

describe("theme preference", () => {
  it("accepts the three values and falls back to system", () => {
    expect(THEMES).toEqual(["system", "light", "dark"]);
    for (const t of THEMES) expect(parseTheme(t)).toBe(t);
    for (const bad of [undefined, null, "", "DARK", "blue", 1]) expect(parseTheme(bad)).toBe("system");
  });

  it("cookie: readable by the page, a year, lax, secure behind https", () => {
    expect(themeCookieOptions(true)).toEqual({ path: "/", maxAge: 31_536_000, sameSite: "lax", httpOnly: false, secure: true });
  });

  it("is rendered by the server on <html>, without any inline script", () => {
    const layout = read("app", "layout.tsx");
    expect(layout).toMatch(/<html lang="fr" data-theme=\{theme\}/);
    for (const file of [layout, read("components", "theme", "theme-sync.tsx"), read("components", "account", "theme-picker.tsx")]) {
      expect(file).not.toMatch(/dangerouslySetInnerHTML|<script|next\/script/);
    }
  });
});

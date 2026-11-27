/**
 * The two theme pickers (account menu, Paramètres › Apparence) read the theme from <html data-theme> through
 * useThemePreference instead of keeping their own copy: a change made in one shows at once in the other, without
 * reloading (3.5.1). Checked in the source (no DOM in these tests), like tests/topic-links-prefetch.test.ts.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const PICKERS = ["components/layout/account-menu.tsx", "components/account/theme-picker.tsx"];

describe("theme pickers stay in sync", () => {
  it.each(PICKERS)("%s reads the theme from useThemePreference and keeps no copy of its own", (file) => {
    const src = readFileSync(file, "utf8");
    expect(src).toMatch(/=\s*useThemePreference\(/);
    // No useState holding the theme (it would go stale when the other picker changes it).
    expect(src).not.toMatch(/useState\((initial|user\.theme)\)/);
    expect(src).not.toMatch(/setThemeState|setValue\(/);
  });

  it("useThemePreference follows the data-theme attribute of <html>", () => {
    const src = readFileSync("components/theme/theme-sync.tsx", "utf8");
    expect(src).toMatch(/useSyncExternalStore\(/);
    expect(src).toMatch(/attributeFilter:\s*\["data-theme"\]/);
  });
});

/** Pull to refresh of the installed app (lib/pull-to-refresh.ts, components/layout/pull-to-refresh.tsx). */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  canStartPull,
  classifyGesture,
  PULL_MAX,
  PULL_THRESHOLD,
  pullDistance,
  pullProgress,
  shouldRefresh,
  type PullContext,
} from "@/lib/pull-to-refresh";

const ROOT = path.join(import.meta.dirname, "..");
const read = (...p: string[]) => readFileSync(path.join(ROOT, ...p), "utf8");

const ok: PullContext = { standalone: true, scrollY: 0, touches: 1, typing: false, overlayOpen: false };

describe("when a pull may start", () => {
  it("installed app, page at the very top, one finger, nothing open", () => {
    expect(canStartPull(ok)).toBe(true);
  });

  it("never in the browser (Safari has its own), below the top, with two fingers, while typing or with a menu open", () => {
    expect(canStartPull({ ...ok, standalone: false })).toBe(false);
    expect(canStartPull({ ...ok, scrollY: 1 })).toBe(false);
    expect(canStartPull({ ...ok, touches: 2 })).toBe(false);
    expect(canStartPull({ ...ok, typing: true })).toBe(false);
    expect(canStartPull({ ...ok, overlayOpen: true })).toBe(false);
  });
});

describe("gesture", () => {
  it("waits a few pixels, then keeps only downward moves steeper than they are wide", () => {
    expect(classifyGesture(2, 5)).toBeNull();
    expect(classifyGesture(3, 20)).toBe("pull");
    expect(classifyGesture(30, 20)).toBe("other"); // horizontal swipe
    expect(classifyGesture(0, -20)).toBe("other"); // scrolling down the page
  });

  it("the wheel follows the finger at half speed, then resists and stops at PULL_MAX", () => {
    expect(pullDistance(-10)).toBe(0);
    expect(pullDistance(100)).toBe(50);
    expect(pullDistance(2 * PULL_THRESHOLD)).toBe(PULL_THRESHOLD);
    expect(pullDistance(2 * PULL_THRESHOLD + 60)).toBe(PULL_THRESHOLD + 10);
    expect(pullDistance(10_000)).toBe(PULL_MAX);
  });

  it("refreshes when released past ~70 px, cancels before", () => {
    expect(PULL_THRESHOLD).toBe(70);
    expect(shouldRefresh(69.9)).toBe(false);
    expect(shouldRefresh(70)).toBe(true);
    expect(pullProgress(35)).toBe(0.5);
    expect(pullProgress(200)).toBe(1);
  });
});

describe("integration in the app", () => {
  const component = read("components", "layout", "pull-to-refresh.tsx");

  it("is mounted for every signed-in page", () => {
    expect(read("app", "(protected)", "layout.tsx")).toMatch(/<PullToRefresh \/>/);
  });

  it("refreshes with router.refresh(), never a full reload", () => {
    expect(component).toMatch(/router\.refresh\(\)/);
    expect(component).not.toMatch(/location\.reload|window\.location\s*=/);
  });

  it("only uses passive touch listeners (scrolling is never delayed)", () => {
    const listeners = [...component.matchAll(/addEventListener\("(touch\w+)", \w+(, \{[^}]*\})?\)/g)];
    expect(listeners.map((m) => m[1])).toEqual(["touchstart", "touchmove", "touchend", "touchcancel"]);
    for (const m of listeners) expect(m[2]).toContain("passive: true");
  });

  it("turns off the native top bounce in the installed app only, and respects reduced motion", () => {
    expect(read("app", "globals.css")).toMatch(/html\[data-standalone\] \{ overscroll-behavior-y: none; \}/);
    expect(component).toMatch(/motion-reduce:animate-none/);
    expect(component).toMatch(/motion-reduce:transition-none/);
    expect(component).toMatch(/motion-reduce:rotate-0/);
  });

  it("keeps the header's « Actualiser » button", () => {
    expect(read("components", "layout", "app-header.tsx")).toMatch(/aria-label="Actualiser"/);
  });
});

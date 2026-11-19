import { describe, expect, it } from "vitest";
import { formatFull, formatRelative, formatShort, formatTitle } from "@/lib/format-date";

// 19/11/2026 09:35 in Paris (UTC+1 in winter)
const NOW = new Date("2026-11-19T08:35:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const MIN = 60_000;
const H = 60 * MIN;

describe("formatRelative", () => {
  it.each([
    [ago(20_000), "à l'instant"],
    [ago(-5 * MIN), "à l'instant"], // future dates never show negative values
    [ago(12 * MIN), "il y a 12 min"],
    [ago(59 * MIN), "il y a 59 min"],
    [ago(3 * H), "il y a 3 h"],
    [new Date("2026-11-18T23:10:00Z"), "il y a 9 h"], // 00:10 Paris, same day
    [new Date("2026-11-18T17:42:00Z"), "hier 18:42"],
    [new Date("2026-11-17T10:00:00Z"), "17 nov."],
    [new Date("2025-11-17T10:00:00Z"), "17 nov. 2025"],
  ])("%s → %s", (date, expected) => {
    expect(formatRelative(date, NOW)).toBe(expected);
  });
});

describe("absolute formats", () => {
  it("formats in Europe/Paris", () => {
    expect(formatTitle(NOW)).toBe("19/11/2026 à 09:35");
    expect(formatFull(NOW)).toBe("19 nov. 2026 à 09:35");
    expect(formatShort(NOW)).toBe("19 nov. · 09:35");
  });

  it("handles summer time", () => {
    expect(formatTitle(new Date("2026-07-01T08:00:00Z"))).toBe("01/07/2026 à 10:00");
  });
});

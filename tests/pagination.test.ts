import { describe, expect, it } from "vitest";
import { pageItems } from "@/components/ui/pagination";

describe("pageItems", () => {
  it("lists every page up to 7", () => {
    expect(pageItems(1, 4)).toEqual([1, 2, 3, 4]);
    expect(pageItems(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("keeps first, last and current ± 1 beyond 7 pages", () => {
    expect(pageItems(6, 12)).toEqual([1, "gap", 5, 6, 7, "gap", 12]);
    expect(pageItems(1, 12)).toEqual([1, 2, "gap", 12]);
    expect(pageItems(12, 12)).toEqual([1, "gap", 11, 12]);
    expect(pageItems(3, 12)).toEqual([1, 2, 3, 4, "gap", 12]);
  });
});

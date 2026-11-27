/**
 * docker-compose.yml passes the tuning variables with the code's own defaults (`${VAR:-default}`): an empty or absent
 * value in the .env must change nothing. Also checks that .env.example documents every variable compose passes.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { ASK_SEMANTIC_MIN } from "@/lib/ask/retrieve";
import { DEFAULT_POOL_SIZE, poolSize } from "@/lib/db";
import { DEFAULT_MERGE_THRESHOLD, MERGE_WINDOW_MS, mergeThreshold, mergeWindowMs, RELATED_MIN } from "@/lib/merge/fusion";
import { DEFAULT_EMBED_PER_CYCLE, embedPerCycle } from "@/lib/search/indexer";
import { SEMANTIC_MIN } from "@/lib/search/query";

vi.mock("server-only", () => ({}));

const compose = readFileSync("docker-compose.yml", "utf8");
const example = readFileSync(".env.example", "utf8");

/** `NAME: ${NAME:-default}` in compose → default (undefined when the line is missing). */
function composeDefault(name: string): string | undefined {
  const m = new RegExp(`^\\s+${name}: \\$\\{${name}:-([^}]*)\\}\\s*$`, "m").exec(compose);
  return m?.[1];
}

const TUNING: Record<string, number> = {
  DATABASE_POOL_SIZE: DEFAULT_POOL_SIZE,
  EMBED_PER_CYCLE: DEFAULT_EMBED_PER_CYCLE,
  MERGE_THRESHOLD: DEFAULT_MERGE_THRESHOLD,
  MERGE_WINDOW_HOURS: MERGE_WINDOW_MS / 3_600_000,
  SEARCH_SEMANTIC_MIN: SEMANTIC_MIN,
  ASK_SEMANTIC_MIN,
  RELATED_MIN,
};

describe("tuning variables in docker-compose.yml", () => {
  it.each(Object.entries(TUNING))("%s is passed with the code's default (%s)", (name, value) => {
    const d = composeDefault(name);
    expect(d, `${name} missing from docker-compose.yml`).toBeDefined();
    expect(Number(d)).toBe(value);
  });

  it("documents each of them in .env.example", () => {
    for (const name of Object.keys(TUNING)) expect(example).toMatch(new RegExp(`^${name}=`, "m"));
  });

  it("an empty value falls back to the default", () => {
    const empty = Object.fromEntries(Object.keys(TUNING).map((k) => [k, ""]));
    expect(poolSize(empty)).toBe(DEFAULT_POOL_SIZE);
    expect(embedPerCycle(empty)).toBe(DEFAULT_EMBED_PER_CYCLE);
    expect(mergeThreshold(empty)).toBe(DEFAULT_MERGE_THRESHOLD);
    expect(mergeWindowMs(empty)).toBe(MERGE_WINDOW_MS);
  });

  it("the pool size refuses 0, negatives and junk", () => {
    for (const v of ["0", "-3", "1.5", "abc", " "]) expect(poolSize({ DATABASE_POOL_SIZE: v })).toBe(DEFAULT_POOL_SIZE);
    expect(poolSize({ DATABASE_POOL_SIZE: "1" })).toBe(1);
    expect(poolSize({})).toBe(DEFAULT_POOL_SIZE);
  });
});

describe(".env.example", () => {
  it("lists every variable docker-compose.yml reads from the .env", () => {
    const names = new Set([...compose.matchAll(/\$\{([A-Z][A-Z0-9_]*)(?::[-?][^}]*)?\}/g)].map((m) => m[1]!));
    const missing = [...names].filter((n) => !new RegExp(`^${n}=`, "m").test(example));
    expect(missing).toEqual([]);
  });
});

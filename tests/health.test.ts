import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { checkAppHealth, checkHealth } from "@/lib/health";
import { recordCycle } from "@/lib/worker/heartbeat";

let db: Db;
const NOW = new Date("2026-11-23T12:00:00Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

beforeEach(async () => {
  const pg = drizzle(new PGlite(), { schema });
  await migrate(pg, { migrationsFolder: path.join(import.meta.dirname, "..", "drizzle") });
  db = pg as unknown as Db;
});

const brokenDb = {
  execute: async () => {
    throw new Error("connection refused");
  },
} as unknown as Db;

describe("checkHealth (/api/health)", () => {
  it("is 503 while the worker has never completed a cycle", async () => {
    const res = await checkHealth(db, NOW);
    expect(res.httpStatus).toBe(503);
    expect(res.body).toEqual({ status: "error", db: "ok", worker: { status: "never" } });
  });

  it("is 200 with the date of the last completed cycle", async () => {
    await recordCycle(db, { startedAt: minutesAgo(6), finishedAt: minutesAgo(5), intervalMinutes: 15 });
    const res = await checkHealth(db, NOW);
    expect(res.httpStatus).toBe(200);
    expect(res.body).toEqual({
      status: "ok",
      db: "ok",
      worker: { status: "ok", lastCycleAt: minutesAgo(5).toISOString(), intervalMinutes: 15, staleAfterMinutes: 45 },
    });
  });

  it("is still 200 at exactly 3 × the interval, 503 beyond", async () => {
    await recordCycle(db, { startedAt: minutesAgo(46), finishedAt: minutesAgo(45), intervalMinutes: 15 });
    expect((await checkHealth(db, NOW)).httpStatus).toBe(200);
    const late = await checkHealth(db, new Date(NOW.getTime() + 1000));
    expect(late.httpStatus).toBe(503);
    expect(late.body.worker).toMatchObject({ status: "stale" });
  });

  it("uses the interval recorded by the worker itself", async () => {
    await recordCycle(db, { startedAt: minutesAgo(8), finishedAt: minutesAgo(7), intervalMinutes: 2 });
    const res = await checkHealth(db, NOW);
    expect(res.httpStatus).toBe(503);
    expect(res.body.worker).toMatchObject({ status: "stale", staleAfterMinutes: 6 });
  });

  it("keeps a single heartbeat row, updated by each cycle", async () => {
    await recordCycle(db, { startedAt: minutesAgo(70), finishedAt: minutesAgo(60), intervalMinutes: 15 });
    expect((await checkHealth(db, NOW)).httpStatus).toBe(503);
    await recordCycle(db, { startedAt: minutesAgo(2), finishedAt: minutesAgo(1), intervalMinutes: 15 });
    expect((await checkHealth(db, NOW)).httpStatus).toBe(200);
    expect(await db.select().from(schema.workerStatus)).toHaveLength(1);
  });

  it("is 503 when the database is unreachable", async () => {
    expect(await checkHealth(brokenDb, NOW)).toEqual({ httpStatus: 503, body: { status: "error", db: "unreachable" } });
  });
});

describe("checkAppHealth (/api/health/app, Docker healthcheck)", () => {
  it("ignores the worker: the worker only starts once the app is healthy", async () => {
    expect(await checkAppHealth(db)).toEqual({ httpStatus: 200, body: { status: "ok", db: "ok" } });
  });

  it("is 503 when the database is unreachable", async () => {
    expect((await checkAppHealth(brokenDb)).httpStatus).toBe(503);
  });
});

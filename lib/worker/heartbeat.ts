import { sql } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { workerStatus } from "@/lib/db/schema";

/** A worker is considered down when no cycle has completed for this many intervals. */
export const STALE_AFTER_INTERVALS = 3;

/** Called by the worker after every completed cycle (single-row upsert). */
export async function recordCycle(db: Db, input: { startedAt: Date; finishedAt: Date; intervalMinutes: number }) {
  const values = {
    id: 1,
    lastCycleStartedAt: input.startedAt,
    lastCycleFinishedAt: input.finishedAt,
    intervalMinutes: input.intervalMinutes,
  };
  await db
    .insert(workerStatus)
    .values(values)
    .onConflictDoUpdate({
      target: workerStatus.id,
      set: {
        lastCycleStartedAt: sql`excluded.last_cycle_started_at`,
        lastCycleFinishedAt: sql`excluded.last_cycle_finished_at`,
        intervalMinutes: sql`excluded.interval_minutes`,
      },
    });
}

export type WorkerHealth =
  | { status: "ok" | "stale"; lastCycleAt: string; intervalMinutes: number; staleAfterMinutes: number }
  | { status: "never" };

/** Worker freshness: "stale" when the last completed cycle is older than 3 × its interval. */
export async function getWorkerHealth(db: Db, now = new Date()): Promise<WorkerHealth> {
  const [row] = await db.select().from(workerStatus).limit(1);
  if (!row) return { status: "never" };
  const staleAfterMinutes = row.intervalMinutes * STALE_AFTER_INTERVALS;
  const ageMs = now.getTime() - row.lastCycleFinishedAt.getTime();
  return {
    status: ageMs > staleAfterMinutes * 60_000 ? "stale" : "ok",
    lastCycleAt: row.lastCycleFinishedAt.toISOString(),
    intervalMinutes: row.intervalMinutes,
    staleAfterMinutes,
  };
}

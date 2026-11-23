import { sql } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { getWorkerHealth, type WorkerHealth } from "@/lib/worker/heartbeat";

export type HealthReport = {
  httpStatus: 200 | 503;
  body: { status: "ok" | "error"; db: "ok" | "unreachable"; worker?: WorkerHealth };
};

/**
 * Health of the whole deployment, for external monitoring (Uptime Kuma…):
 * 503 when the database is unreachable, or when the worker has not completed a
 * cycle for more than 3 × its interval (crashed, stuck or never started).
 * Exposes no user data: only the database state and the worker's last cycle date.
 */
export async function checkHealth(db: Db, now = new Date()): Promise<HealthReport> {
  try {
    await db.execute(sql`select 1`);
  } catch {
    return { httpStatus: 503, body: { status: "error", db: "unreachable" } };
  }
  const worker = await getWorkerHealth(db, now);
  const ok = worker.status === "ok";
  return { httpStatus: ok ? 200 : 503, body: { status: ok ? "ok" : "error", db: "ok", worker } };
}

/** Liveness of the app container alone (Docker healthcheck): the database answers. */
export async function checkAppHealth(db: Db): Promise<HealthReport> {
  try {
    await db.execute(sql`select 1`);
    return { httpStatus: 200, body: { status: "ok", db: "ok" } };
  } catch {
    return { httpStatus: 503, body: { status: "error", db: "unreachable" } };
  }
}

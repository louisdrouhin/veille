/**
 * Daily limits of the calls to the model (docs/design/3.3), in the database so that the app and the
 * worker share them; days in Europe/Paris. EMBED_DAILY_LIMIT (texts indexed per day, default 1 000) and
 * ASK_DAILY_LIMIT (questions per day, default 50) in the server .env lower or raise them.
 */
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { aiUsage, type AiUsageKind } from "@/lib/db/schema";

export const DEFAULT_LIMITS: Record<AiUsageKind, number> = { embed: 1_000, ask: 50 };
const ENV: Record<AiUsageKind, string> = { embed: "EMBED_DAILY_LIMIT", ask: "ASK_DAILY_LIMIT" };

export function dailyLimit(kind: AiUsageKind, env: Partial<Record<string, string | undefined>> = process.env): number {
  const n = Number(env[ENV[kind]]);
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_LIMITS[kind];
}

const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" });
export const parisDay = (now = new Date()) => dayFmt.format(now);

/** Takes up to `wanted` of today's allowance; returns how many were granted (0: limit reached). */
export async function reserve(db: Db, kind: AiUsageKind, wanted: number, limit: number, now = new Date()): Promise<number> {
  if (wanted <= 0 || limit <= 0) return 0;
  const day = parisDay(now);
  return db.transaction(async (tx) => {
    await tx.insert(aiUsage).values({ day, kind, count: 0 }).onConflictDoNothing();
    // Row locked: the app and the worker never both take the last units.
    const [row] = await tx.select({ count: aiUsage.count }).from(aiUsage).where(and(eq(aiUsage.day, day), eq(aiUsage.kind, kind))).for("update");
    const granted = Math.max(0, Math.min(wanted, limit - (row?.count ?? 0)));
    if (granted > 0) await tx.update(aiUsage).set({ count: sql`${aiUsage.count} + ${granted}` }).where(and(eq(aiUsage.day, day), eq(aiUsage.kind, kind)));
    return granted;
  });
}

/** Gives back what was reserved but not used (a failed call). */
export async function release(db: Db, kind: AiUsageKind, n: number, now = new Date()): Promise<void> {
  if (n <= 0) return;
  await db
    .update(aiUsage)
    .set({ count: sql`greatest(0, ${aiUsage.count} - ${n})` })
    .where(and(eq(aiUsage.day, parisDay(now)), eq(aiUsage.kind, kind)));
}

export async function usedToday(db: Db, kind: AiUsageKind, now = new Date()): Promise<number> {
  const [row] = await db.select({ count: aiUsage.count }).from(aiUsage).where(and(eq(aiUsage.day, parisDay(now)), eq(aiUsage.kind, kind)));
  return row?.count ?? 0;
}

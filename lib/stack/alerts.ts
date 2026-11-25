/**
 * Alerts = stack items × vulnerabilities whose ranges contain the item's version (docs/design/3.0
 * § 2.1, step 2). Recomputed after every sync and every change of a version:
 * - version touched, no alert yet → new alert (`new`);
 * - version no longer touched → open alert closed (`done`, reason « updated »);
 * - version touched again after such a close → reopened.
 * Alerts closed or ignored by hand stay as they are. A version the comparator cannot read changes
 * nothing (its item shows « Version non reconnue »).
 * `silent`: alerts found while the owner adds or edits a version are on screen already, they are
 * not pushed (notifiedAt set at once).
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { alerts, products, stackItems, vulnerabilities, vulnerabilityProducts } from "@/lib/db/schema";
import { isAffected } from "./versions";

export type RecomputeResult = { created: number[]; closed: number; reopened: number };

export async function recomputeAlerts(db: Db, opts: { now?: Date; silent?: boolean; itemIds?: number[] } = {}): Promise<RecomputeResult> {
  const now = opts.now ?? new Date();
  const result: RecomputeResult = { created: [], closed: 0, reopened: 0 };
  if (opts.itemIds && opts.itemIds.length === 0) return result;
  const items = await db
    .select({ id: stackItems.id, version: stackItems.version, productId: stackItems.productId, scheme: products.versionScheme })
    .from(stackItems)
    .innerJoin(products, eq(products.id, stackItems.productId))
    .where(and(isNull(stackItems.removedAt), opts.itemIds ? inArray(stackItems.id, opts.itemIds) : undefined));
  if (items.length === 0) return result;

  const productIds = [...new Set(items.map((i) => i.productId!))];
  const vps = await db
    .select({ vulnerabilityId: vulnerabilityProducts.vulnerabilityId, productId: vulnerabilityProducts.productId, ranges: vulnerabilityProducts.ranges, exploited: vulnerabilities.exploited })
    .from(vulnerabilityProducts)
    .innerJoin(vulnerabilities, eq(vulnerabilities.id, vulnerabilityProducts.vulnerabilityId))
    .where(inArray(vulnerabilityProducts.productId, productIds));
  const existing = await db
    .select({ id: alerts.id, stackItemId: alerts.stackItemId, vulnerabilityId: alerts.vulnerabilityId, state: alerts.state, doneReason: alerts.doneReason })
    .from(alerts)
    .where(inArray(alerts.stackItemId, items.map((i) => i.id)));
  const byKey = new Map(existing.map((a) => [`${a.stackItemId}:${a.vulnerabilityId}`, a]));

  const toInsert: (typeof alerts.$inferInsert)[] = [];
  const toClose: number[] = [];
  const toReopen: number[] = [];
  for (const item of items) {
    for (const vp of vps) {
      if (vp.productId !== item.productId) continue;
      const affected = isAffected(item.version, vp.ranges, item.scheme);
      if (affected === null) break; // unreadable version: leave its alerts alone
      const alert = byKey.get(`${item.id}:${vp.vulnerabilityId}`);
      if (affected) {
        if (!alert) {
          toInsert.push({
            stackItemId: item.id,
            vulnerabilityId: vp.vulnerabilityId,
            state: "new",
            notifiedAt: opts.silent ? now : null,
            notifiedExploited: opts.silent ? vp.exploited : false,
            createdAt: now,
            updatedAt: now,
          });
        } else if (alert.state === "done" && alert.doneReason === "updated") {
          toReopen.push(alert.id);
        }
      } else if (alert && (alert.state === "new" || alert.state === "seen")) {
        toClose.push(alert.id);
      }
    }
  }

  for (let i = 0; i < toInsert.length; i += 500) {
    const rows = await db.insert(alerts).values(toInsert.slice(i, i + 500)).onConflictDoNothing().returning({ id: alerts.id });
    result.created.push(...rows.map((r) => r.id));
  }
  if (toClose.length) {
    await db.update(alerts).set({ state: "done", doneReason: "updated", doneAt: now, updatedAt: now }).where(inArray(alerts.id, toClose));
    result.closed = toClose.length;
  }
  if (toReopen.length) {
    await db
      .update(alerts)
      .set({ state: "new", doneReason: null, doneAt: null, updatedAt: now, ...(opts.silent ? { notifiedAt: now } : { notifiedAt: null, notifiedExploited: false }) })
      .where(inArray(alerts.id, toReopen));
    result.reopened = toReopen.length;
  }
  return result;
}

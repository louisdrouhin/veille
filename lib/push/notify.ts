/**
 * Ma stack notifications (docs/design/3.0 § 5). Run by the worker after every cycle and after a
 * check asked by hand:
 * - an alert to handle whose severity reaches the threshold, or exploited when « Toujours si la
 *   faille est exploitée » is on, is pushed once; becoming exploited later pushes it again;
 * - alerts below the threshold are marked as handled for push (no backlog when the threshold drops);
 * - during quiet hours (Europe/Paris) nothing is sent: they wait and go out grouped at the end;
 * - « Notifications discrètes » (per context, on for Travail by default): a generic title and body,
 *   without product nor version.
 * Title in words (« Critique · FortiOS 7.0.12 »), no emoji; tag = alert id, data.url = its page.
 * Subscriptions answering 404 / 410 are deleted. Logs: counts only.
 */
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { alerts, notificationSettings, products, pushSubscriptions, stackItems, vulnerabilities, vulnerabilityProducts, type Severity, type StackContext } from "@/lib/db/schema";
import { SEVERITY_LABEL, SEVERITY_ORDER, severityCounts } from "@/lib/stack/labels";
import { nearestFix } from "@/lib/stack/versions";
import type { Resolver } from "@/lib/net/safe-fetch";
import { sendPush, type PushResult, type Vapid } from "./webpush";

export type NotificationSettings = typeof notificationSettings.$inferSelect;
export const DEFAULT_SETTINGS: NotificationSettings = {
  id: 1,
  threshold: "high",
  exploitedAlways: true,
  quietEnabled: true,
  quietFrom: "22:00:00",
  quietTo: "07:30:00",
  discreetHomelab: false,
  discreetWork: true,
};

export async function getNotificationSettings(db: Db): Promise<NotificationSettings> {
  const [row] = await db.select().from(notificationSettings).where(eq(notificationSettings.id, 1));
  return row ?? DEFAULT_SETTINGS;
}

export type PushPayload = { title: string; body: string; tag: string; url: string; badge: number };

const minutes = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** Paris wall-clock minutes of the day. */
export function parisMinutes(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hourCycle: "h23", hour: "2-digit", minute: "2-digit" }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return get("hour") * 60 + get("minute");
}

/** Inside quiet hours (a range over midnight, 22:00 → 07:30, included). */
export function inQuietHours(s: Pick<NotificationSettings, "quietEnabled" | "quietFrom" | "quietTo">, now: Date): boolean {
  if (!s.quietEnabled) return false;
  const m = parisMinutes(now);
  const from = minutes(s.quietFrom);
  const to = minutes(s.quietTo);
  if (from === to) return false;
  return from < to ? m >= from && m < to : m >= from || m < to;
}

export function meetsThreshold(severity: Severity, threshold: NotificationSettings["threshold"]): boolean {
  if (threshold === "all") return true;
  return SEVERITY_ORDER.indexOf(severity) <= SEVERITY_ORDER.indexOf(threshold);
}

export type PendingAlert = {
  id: number;
  severity: Severity;
  exploited: boolean;
  ref: string;
  product: string;
  version: string;
  context: StackContext;
  fix: string | null;
  /** Already pushed once: this one is for « now exploited ». */
  again: boolean;
};

const discreetFor = (s: NotificationSettings, c: StackContext) => (c === "work" ? s.discreetWork : s.discreetHomelab);

/** One alert, or a group (after quiet hours, or several at once). */
export function buildPayload(list: readonly PendingAlert[], s: NotificationSettings, openCount: number): PushPayload {
  if (list.length === 1) {
    const a = list[0]!;
    if (discreetFor(s, a.context)) {
      return {
        title: `Folders · ${a.again ? "Alerte désormais exploitée" : `Nouvelle alerte ${SEVERITY_LABEL[a.severity].toLowerCase()}`}`,
        body: "Touche pour voir l'alerte.",
        tag: `alert-${a.id}`,
        url: `/stack/alertes/${a.id}`,
        badge: openCount,
      };
    }
    const parts = [`${a.ref}${a.exploited ? ", exploitée" : ""}.`, a.fix ? `Corrigé en ${a.fix}.` : "", "Touche pour voir l'alerte."];
    return { title: `${SEVERITY_LABEL[a.severity]} · ${a.product} ${a.version}`, body: parts.filter(Boolean).join(" "), tag: `alert-${a.id}`, url: `/stack/alertes/${a.id}`, badge: openCount };
  }
  const counts = severityCounts(list.map((a) => a.severity));
  const discreet = list.some((a) => discreetFor(s, a.context));
  const names = [...new Set(list.map((a) => `${a.product} ${a.version}`))];
  return {
    title: discreet ? `Folders · ${list.length} nouvelles alertes` : `Ma stack : ${list.length} nouvelles alertes`,
    body: discreet ? `${counts}.` : `${counts} · ${names.slice(0, 2).join(", ")}${names.length > 2 ? "…" : ""}`,
    tag: "stack-group",
    url: "/stack/alertes",
    badge: openCount,
  };
}

export type DispatchDeps = { vapid: Vapid | null; now?: Date; fetchImpl?: typeof fetch; resolve?: Resolver; log?: (...a: unknown[]) => void };
export type DispatchResult = { sent: number; held: number; skipped: number; devices: number; removed: number };

/** Sends one payload to every device; deletes the gone ones. */
export async function sendToAll(db: Db, payload: PushPayload, deps: DispatchDeps): Promise<{ ok: number; removed: number; devices: number }> {
  if (!deps.vapid) return { ok: 0, removed: 0, devices: 0 };
  const subs = await db.select().from(pushSubscriptions);
  let ok = 0;
  let removed = 0;
  for (const s of subs) {
    const r: PushResult = await sendPush({ endpoint: s.endpoint, keys: s.keys }, payload, deps.vapid, { fetchImpl: deps.fetchImpl, resolve: deps.resolve, topic: payload.tag.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) });
    if (r === "ok") {
      ok++;
      await db.update(pushSubscriptions).set({ lastOkAt: deps.now ?? new Date() }).where(eq(pushSubscriptions.id, s.id));
    } else if (r === "gone" || r === "refused") {
      removed++;
      await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id));
    }
  }
  return { ok, removed, devices: subs.length };
}

export async function dispatchNotifications(db: Db, deps: DispatchDeps): Promise<DispatchResult> {
  const now = deps.now ?? new Date();
  const s = await getNotificationSettings(db);
  const rows = await db
    .select({
      id: alerts.id,
      notifiedAt: alerts.notifiedAt,
      notifiedExploited: alerts.notifiedExploited,
      severity: vulnerabilities.severity,
      exploited: vulnerabilities.exploited,
      ref: vulnerabilities.ref,
      product: products.name,
      scheme: products.versionScheme,
      version: stackItems.version,
      context: stackItems.context,
      fixed: vulnerabilityProducts.fixedVersions,
    })
    .from(alerts)
    .innerJoin(vulnerabilities, eq(vulnerabilities.id, alerts.vulnerabilityId))
    .innerJoin(stackItems, eq(stackItems.id, alerts.stackItemId))
    .innerJoin(products, eq(products.id, stackItems.productId))
    .leftJoin(vulnerabilityProducts, and(eq(vulnerabilityProducts.vulnerabilityId, vulnerabilities.id), eq(vulnerabilityProducts.productId, products.id)))
    .where(
      and(
        inArray(alerts.state, ["new", "seen"]),
        isNull(stackItems.removedAt),
        or(isNull(alerts.notifiedAt), and(eq(vulnerabilities.exploited, true), eq(alerts.notifiedExploited, false))),
      ),
    );
  const result: DispatchResult = { sent: 0, held: 0, skipped: 0, devices: 0, removed: 0 };
  if (rows.length === 0) return result;

  const wanted: PendingAlert[] = [];
  const skipped: number[] = [];
  for (const r of rows) {
    const again = r.notifiedAt !== null;
    const worth = again ? r.exploited && (s.exploitedAlways || meetsThreshold(r.severity, s.threshold)) : meetsThreshold(r.severity, s.threshold) || (r.exploited && s.exploitedAlways);
    if (!worth) {
      skipped.push(r.id);
      continue;
    }
    wanted.push({ id: r.id, severity: r.severity, exploited: r.exploited, ref: r.ref, product: r.product, version: r.version, context: r.context, fix: nearestFix(r.version, r.fixed ?? [], r.scheme), again });
  }
  if (skipped.length) {
    for (const r of rows.filter((x) => skipped.includes(x.id))) {
      await db.update(alerts).set({ notifiedAt: r.notifiedAt ?? now, notifiedExploited: r.exploited }).where(eq(alerts.id, r.id));
    }
    result.skipped = skipped.length;
  }
  if (wanted.length === 0) return result;
  if (inQuietHours(s, now)) {
    result.held = wanted.length;
    return result;
  }
  // Without keys or devices nothing is sent, and nothing piles up for later either.
  const open = (
    await db
      .select({ id: alerts.id })
      .from(alerts)
      .innerJoin(stackItems, eq(stackItems.id, alerts.stackItemId))
      .where(and(inArray(alerts.state, ["new", "seen"]), isNull(stackItems.removedAt)))
  ).length;
  const sorted = [...wanted].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
  const sent = await sendToAll(db, buildPayload(sorted, s, open), deps);
  for (const a of wanted) {
    await db.update(alerts).set({ notifiedAt: now, notifiedExploited: a.exploited }).where(eq(alerts.id, a.id));
  }
  result.sent = wanted.length;
  result.devices = sent.devices;
  result.removed = sent.removed;
  deps.log?.(`[push] ${wanted.length} alerte(s) notifiée(s) sur ${sent.ok}/${sent.devices} appareil(s)${sent.removed ? `, ${sent.removed} abonnement(s) supprimé(s)` : ""}`);
  return result;
}

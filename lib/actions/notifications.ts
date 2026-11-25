"use server";

import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { getDb } from "@/lib/db";
import { NOTIFY_THRESHOLDS, notificationSettings, pushSubscriptions, type NotifyThreshold } from "@/lib/db/schema";
import { vapidConfig } from "@/lib/push/config";
import { areValidKeys, isAllowedEndpoint } from "@/lib/push/endpoint";
import { DEFAULT_SETTINGS } from "@/lib/push/notify";
import { sendPush } from "@/lib/push/webpush";
import { requireSession } from "@/lib/session";

/*
 * Mon compte › Notifications (docs/design/3.0 § 5). Every action re-checks the session. A
 * subscription is only stored for an HTTPS endpoint of a known push service (lib/push/endpoint.ts).
 */

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export async function subscribePushAction(sub: { endpoint?: unknown; keys?: unknown }): Promise<Result> {
  await requireSession();
  if (!vapidConfig()) return { ok: false, error: "Notifications non configurées sur le serveur." };
  if (!isAllowedEndpoint(sub?.endpoint) || !areValidKeys(sub?.keys)) return { ok: false, error: "Activation impossible : service de notification non reconnu." };
  const ua = ((await headers()).get("user-agent") ?? "").slice(0, 200) || null;
  const keys = { p256dh: sub.keys.p256dh, auth: sub.keys.auth };
  try {
    await getDb()
      .insert(pushSubscriptions)
      .values({ endpoint: sub.endpoint, keys, userAgent: ua })
      .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { keys, userAgent: ua } });
    return { ok: true };
  } catch {
    console.error("[push] abonnement non enregistré");
    return { ok: false, error: "Activation impossible : réessaie." };
  }
}

export async function unsubscribePushAction(endpoint: unknown): Promise<Result> {
  await requireSession();
  if (typeof endpoint !== "string" || endpoint.length > 1000) return { ok: false, error: "Abonnement inconnu." };
  await getDb().delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
  return { ok: true };
}

/** « Envoyer une notification de test » to this device only. */
export async function sendTestPushAction(endpoint: unknown): Promise<Result> {
  await requireSession();
  const vapid = vapidConfig();
  if (!vapid) return { ok: false, error: "Notifications non configurées sur le serveur." };
  if (typeof endpoint !== "string") return { ok: false, error: "Abonnement inconnu." };
  const [sub] = await getDb().select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
  if (!sub) return { ok: false, error: "Cet appareil n'est plus abonné : réactive les notifications." };
  const r = await sendPush(
    { endpoint: sub.endpoint, keys: sub.keys },
    { title: "Folders · Notification de test", body: "Les alertes Ma stack arriveront ici.", tag: "test", url: "/compte/notifications", badge: 0 },
    vapid,
    { urgency: "normal", ttl: 600 },
  );
  if (r === "ok") {
    await getDb().update(pushSubscriptions).set({ lastOkAt: new Date() }).where(eq(pushSubscriptions.id, sub.id));
    return { ok: true };
  }
  if (r === "gone" || r === "refused") {
    await getDb().delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
    return { ok: false, error: "Cet appareil n'est plus abonné : réactive les notifications." };
  }
  return { ok: false, error: "Le service de notification n'a pas répondu : réessaie." };
}

export type SettingsInput = Partial<{
  threshold: NotifyThreshold;
  exploitedAlways: boolean;
  quietEnabled: boolean;
  quietFrom: string;
  quietTo: string;
  discreetHomelab: boolean;
  discreetWork: boolean;
}>;

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function updateNotificationSettingsAction(input: SettingsInput): Promise<Result> {
  await requireSession();
  const set: SettingsInput = {};
  if (input.threshold !== undefined) {
    if (!NOTIFY_THRESHOLDS.includes(input.threshold)) return { ok: false, error: "Seuil invalide." };
    set.threshold = input.threshold;
  }
  for (const k of ["exploitedAlways", "quietEnabled", "discreetHomelab", "discreetWork"] as const) {
    if (input[k] !== undefined) {
      if (typeof input[k] !== "boolean") return { ok: false, error: "Réglage invalide." };
      set[k] = input[k];
    }
  }
  for (const k of ["quietFrom", "quietTo"] as const) {
    if (input[k] !== undefined) {
      if (typeof input[k] !== "string" || !TIME.test(input[k])) return { ok: false, error: "Heure invalide (HH:MM)." };
      set[k] = input[k];
    }
  }
  await getDb()
    .insert(notificationSettings)
    .values({ ...DEFAULT_SETTINGS, ...set })
    .onConflictDoUpdate({ target: notificationSettings.id, set });
  return { ok: true };
}

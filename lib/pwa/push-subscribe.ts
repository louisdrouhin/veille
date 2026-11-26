"use client";

import { subscribePushAction } from "@/lib/actions/notifications";

/**
 * Push subscription of this device, asked inside a tap (iOS refuses a permission request made at load time).
 * Shared by Mon compte › Notifications and the first-time card of the briefing (docs/design/3.4 § 6).
 */

export const hasPushApi = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

export function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const s = atob(base64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(base64url.length / 4) * 4, "="));
  const out = new Uint8Array(new ArrayBuffer(s.length));
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Whether this subscription was made with this public key (browsers without `options` say yes). */
export function sameKey(sub: PushSubscription, publicKey: string): boolean {
  const used = sub.options?.applicationServerKey;
  if (!used) return true;
  const a = new Uint8Array(used);
  const b = keyBytes(publicKey);
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

export type SubscribeResult = { ok: true; endpoint: string; permission: NotificationPermission } | { ok: false; error: string | null; permission: NotificationPermission | null };

/** Asks the permission (if needed), subscribes with the server's key and saves the subscription. */
export async function subscribeThisDevice(publicKey: string): Promise<SubscribeResult> {
  try {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return { ok: false, error: null, permission: perm };
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (sub && !sameKey(sub, publicKey)) {
      await sub.unsubscribe().catch(() => {});
      sub = null;
    }
    sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
    const res = await subscribePushAction(sub.toJSON());
    if (!res.ok) {
      await sub.unsubscribe().catch(() => {});
      return { ok: false, error: res.error, permission: perm };
    }
    return { ok: true, endpoint: sub.endpoint, permission: perm };
  } catch {
    return { ok: false, error: "Activation impossible sur cet appareil.", permission: typeof Notification === "undefined" ? null : Notification.permission };
  }
}

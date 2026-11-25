/**
 * Ma stack notifications (lib/push/notify.ts, lib/actions/notifications.ts): threshold, « toujours si
 * exploitée », quiet hours (held, then grouped), discreet titles per context, gone subscriptions,
 * subscription SSRF rules and settings validation, iOS availability. Fictional data only.
 */
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { pushAvailability } from "@/lib/pwa/platform";

const state = vi.hoisted(() => ({ db: null as unknown as Db, env: {} as Record<string, string> }));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "user-agent": "Test iPhone" }) }));
vi.mock("@/lib/session", () => ({ requireSession: vi.fn(async () => ({ user: { id: "u1", name: "Moi" } })) }));
vi.mock("@/lib/db", () => ({ getDb: () => state.db }));

const { buildPayload, dispatchNotifications, inQuietHours, DEFAULT_SETTINGS } = await import("@/lib/push/notify");
const { generateVapidKeys } = await import("@/lib/push/webpush");
const { vapidConfig } = await import("@/lib/push/config");
const actions = await import("@/lib/actions/notifications");
const { syncCatalog } = await import("@/lib/stack/catalog");
const { storeVulns } = await import("@/lib/stack/sync");
const { recomputeAlerts } = await import("@/lib/stack/alerts");

const { alerts, notificationSettings, products, pushSubscriptions, stackItems, vulnerabilities } = schema;
const KEYS = { p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4", auth: "BTBZMqHH6r4Tts7J_aSIgg" };
const vapid = { ...generateVapidKeys(), subject: "https://folders.example" };
/** 14:00 and 23:30, Paris time. */
const DAY = new Date("2026-11-25T13:00:00Z");
const NIGHT = new Date("2026-11-25T22:30:00Z");
const MORNING = new Date("2026-11-26T07:00:00Z");

function pushNet() {
  const sent: { endpoint: string; body: Uint8Array }[] = [];
  const status = new Map<string, number>();
  const fetchImpl = (async (u: string | URL, init?: RequestInit) => {
    sent.push({ endpoint: String(u), body: init?.body as Uint8Array });
    return new Response(null, { status: status.get(String(u)) ?? 201 });
  }) as typeof fetch;
  return { fetchImpl, sent, status, resolve: async () => [{ address: "17.188.1.1", family: 4 }] };
}

async function seed() {
  const db = state.db;
  const all = await db.select().from(products);
  const p = (k: string) => all.find((x) => x.key === k)!;
  const v = (ref: string, cvss: number, end: string, exploited = false) => ({
    ref,
    cveId: ref,
    descriptionEn: "Fictional.",
    cvss,
    severity: null,
    exploited,
    publishedAt: DAY,
    updatedAt: DAY,
    sources: [],
    ranges: [{ end, endIncluding: false, src: "nvd" as const }],
  });
  await storeVulns(db, p("fortios"), "nvd", [v("CVE-2099-1", 9.8, "7.0.16"), v("CVE-2099-2", 5.0, "7.0.20")]);
  await storeVulns(db, p("proxmox-ve"), "nvd", [v("CVE-2099-3", 7.5, "8.1.4")]);
  await db.insert(stackItems).values([
    { productId: p("fortios").id, version: "7.0.12", context: "work" },
    { productId: p("proxmox-ve").id, version: "8.1.3", context: "homelab" },
  ]);
  await recomputeAlerts(db, { now: DAY });
  await db.insert(pushSubscriptions).values([
    { endpoint: "https://web.push.apple.com/device-1", keys: KEYS },
    { endpoint: "https://fcm.googleapis.com/fcm/send/device-2", keys: KEYS },
  ]);
}

beforeEach(async () => {
  const pg = drizzle(new PGlite(), { schema });
  await migrate(pg, { migrationsFolder: path.join(import.meta.dirname, "..", "drizzle") });
  state.db = pg as unknown as Db;
  await syncCatalog(state.db);
  vi.unstubAllEnvs();
});

describe("rules", () => {
  it("quiet hours over midnight (22:00 → 07:30, Paris), off, or empty", () => {
    expect(inQuietHours(DEFAULT_SETTINGS, NIGHT)).toBe(true);
    expect(inQuietHours(DEFAULT_SETTINGS, new Date("2026-11-26T06:00:00Z"))).toBe(true); // 07:00
    expect(inQuietHours(DEFAULT_SETTINGS, MORNING)).toBe(false); // 08:00
    expect(inQuietHours(DEFAULT_SETTINGS, DAY)).toBe(false);
    expect(inQuietHours({ ...DEFAULT_SETTINGS, quietEnabled: false }, NIGHT)).toBe(false);
    expect(inQuietHours({ ...DEFAULT_SETTINGS, quietFrom: "12:00", quietTo: "15:00" }, DAY)).toBe(true);
  });

  it("payloads: severity in words, product and MY version, no emoji; discreet = generic; grouped", () => {
    const a = { id: 3, severity: "critical" as const, exploited: true, ref: "CVE-2099-1", product: "FortiOS", version: "7.0.12", context: "homelab" as const, fix: "7.0.16", again: false };
    const s = { ...DEFAULT_SETTINGS, discreetWork: true };
    expect(buildPayload([a], s, 3)).toEqual({ title: "Critique · FortiOS 7.0.12", body: "CVE-2099-1, exploitée. Corrigé en 7.0.16. Touche pour voir l'alerte.", tag: "alert-3", url: "/stack/alertes/3", badge: 3 });
    expect(buildPayload([{ ...a, context: "work" }], s, 3)).toEqual({ title: "Folders · Nouvelle alerte critique", body: "Touche pour voir l'alerte.", tag: "alert-3", url: "/stack/alertes/3", badge: 3 });
    const b = { ...a, id: 4, severity: "medium" as const, exploited: false, product: "Proxmox VE", version: "8.1.3" };
    const c = { ...b, id: 5 };
    expect(buildPayload([a, b, c], s, 3)).toEqual({ title: "Ma stack : 3 nouvelles alertes", body: "1 critique, 2 moyennes · FortiOS 7.0.12, Proxmox VE 8.1.3", tag: "stack-group", url: "/stack/alertes", badge: 3 });
    const grouped = buildPayload([a, { ...b, context: "work" }], s, 3);
    expect(grouped).toMatchObject({ title: "Folders · 2 nouvelles alertes", body: "1 critique, 1 moyenne." });
    for (const p of [buildPayload([a], s, 1), grouped]) expect(`${p.title} ${p.body}`).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

describe("dispatch", () => {
  it("threshold « haute et plus »: critical and high pushed (grouped), medium marked and never pushed later", async () => {
    await seed();
    const net = pushNet();
    const r = await dispatchNotifications(state.db, { vapid, now: DAY, ...net });
    expect(r).toMatchObject({ sent: 2, skipped: 1, held: 0, devices: 2 });
    expect(net.sent.map((x) => x.endpoint)).toEqual(["https://web.push.apple.com/device-1", "https://fcm.googleapis.com/fcm/send/device-2"]);
    expect((await state.db.select().from(alerts)).every((a) => a.notifiedAt !== null)).toBe(true);
    // Nothing again, even with a lower threshold.
    await state.db.insert(notificationSettings).values({ id: 1, threshold: "all" });
    expect(await dispatchNotifications(state.db, { vapid, now: DAY, ...net })).toMatchObject({ sent: 0 });
    expect(net.sent).toHaveLength(2);
  });

  it("quiet hours: held at night, grouped at the end; the badge and list are unaffected", async () => {
    await seed();
    const net = pushNet();
    expect(await dispatchNotifications(state.db, { vapid, now: NIGHT, ...net })).toMatchObject({ sent: 0, held: 2 });
    expect(net.sent).toHaveLength(0);
    expect(await state.db.$count(alerts, eq(alerts.state, "new"))).toBe(3);
    expect(await dispatchNotifications(state.db, { vapid, now: MORNING, ...net })).toMatchObject({ sent: 2, held: 0 });
  });

  it("becoming exploited pushes again (exploited_always), even under the threshold", async () => {
    await seed();
    const net = pushNet();
    await state.db.insert(notificationSettings).values({ id: 1, threshold: "critical" });
    await dispatchNotifications(state.db, { vapid, now: DAY, ...net });
    expect(net.sent).toHaveLength(2); // the critical one, two devices
    await state.db.update(vulnerabilities).set({ exploited: true }).where(eq(vulnerabilities.ref, "CVE-2099-2"));
    expect(await dispatchNotifications(state.db, { vapid, now: DAY, ...net })).toMatchObject({ sent: 1 });
    expect(await dispatchNotifications(state.db, { vapid, now: DAY, ...net })).toMatchObject({ sent: 0 });
  });

  it("a gone device (410) is deleted; without VAPID keys nothing is sent and nothing piles up", async () => {
    await seed();
    const net = pushNet();
    net.status.set("https://fcm.googleapis.com/fcm/send/device-2", 410);
    const r = await dispatchNotifications(state.db, { vapid, now: DAY, ...net });
    expect(r).toMatchObject({ removed: 1 });
    expect((await state.db.select().from(pushSubscriptions)).map((s) => s.endpoint)).toEqual(["https://web.push.apple.com/device-1"]);
    await state.db.update(alerts).set({ notifiedAt: null });
    expect(await dispatchNotifications(state.db, { vapid: null, now: DAY, ...net })).toMatchObject({ sent: 2, devices: 0 });
    expect(await state.db.$count(alerts, eq(alerts.notifiedAt, DAY))).toBe(3);
  });

  it("logs counts only", async () => {
    await seed();
    const lines: string[] = [];
    await dispatchNotifications(state.db, { vapid, now: DAY, ...pushNet(), log: (...a) => lines.push(a.join(" ")) });
    expect(lines).toEqual(["[push] 2 alerte(s) notifiée(s) sur 2/2 appareil(s)"]);
  });
});

describe("settings and subscriptions", () => {
  it("subscribing: known push service in HTTPS with valid keys only; nothing without VAPID keys", async () => {
    vi.stubEnv("VAPID_PUBLIC_KEY", "");
    expect(await actions.subscribePushAction({ endpoint: "https://web.push.apple.com/x", keys: KEYS })).toEqual({ ok: false, error: "Notifications non configurées sur le serveur." });
    vi.stubEnv("VAPID_PUBLIC_KEY", vapid.publicKey);
    vi.stubEnv("VAPID_PRIVATE_KEY", vapid.privateKey);
    vi.stubEnv("BETTER_AUTH_URL", "https://folders.example");
    for (const endpoint of ["https://192.168.1.20/push", "https://evil.example/web.push.apple.com", "http://web.push.apple.com/x", "https://web.push.apple.com.evil.example/x"]) {
      expect(await actions.subscribePushAction({ endpoint, keys: KEYS }), endpoint).toMatchObject({ ok: false });
    }
    expect(await actions.subscribePushAction({ endpoint: "https://web.push.apple.com/x", keys: { p256dh: "x", auth: "y" } })).toMatchObject({ ok: false });
    expect(await actions.subscribePushAction({ endpoint: "https://web.push.apple.com/x", keys: KEYS })).toEqual({ ok: true });
    expect(await actions.subscribePushAction({ endpoint: "https://web.push.apple.com/x", keys: KEYS })).toEqual({ ok: true });
    const subs = await state.db.select().from(pushSubscriptions);
    expect(subs).toHaveLength(1);
    expect(subs[0]).toMatchObject({ userAgent: "Test iPhone" });
    expect(await actions.unsubscribePushAction("https://web.push.apple.com/x")).toEqual({ ok: true });
    expect(await state.db.$count(pushSubscriptions)).toBe(0);
  });

  it("settings: validated, saved partially, defaults (high, exploited, 22:00-07:30, discreet at work)", async () => {
    expect(await actions.updateNotificationSettingsAction({ threshold: "none" as never })).toEqual({ ok: false, error: "Seuil invalide." });
    expect(await actions.updateNotificationSettingsAction({ quietFrom: "25:00" })).toEqual({ ok: false, error: "Heure invalide (HH:MM)." });
    expect(await actions.updateNotificationSettingsAction({ discreetHomelab: "yes" as never })).toEqual({ ok: false, error: "Réglage invalide." });
    expect(await actions.updateNotificationSettingsAction({ quietFrom: "23:00" })).toEqual({ ok: true });
    expect(await actions.updateNotificationSettingsAction({ threshold: "medium" })).toEqual({ ok: true });
    expect((await state.db.select().from(notificationSettings))[0]).toMatchObject({ threshold: "medium", quietFrom: "23:00:00", quietTo: "07:30:00", exploitedAlways: true, discreetWork: true, discreetHomelab: false });
  });

  it("VAPID config: both keys, and an https or mailto subject", () => {
    const k = { VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey };
    expect(vapidConfig({ ...k, BETTER_AUTH_URL: "https://folders.example" })?.subject).toBe("https://folders.example");
    expect(vapidConfig({ ...k, BETTER_AUTH_URL: "http://localhost:3000" })).toBeNull();
    expect(vapidConfig({ ...k, BETTER_AUTH_URL: "http://localhost:3000", VAPID_SUBJECT: "mailto:admin@folders.example" })?.subject).toBe("mailto:admin@folders.example");
    expect(vapidConfig({ VAPID_PUBLIC_KEY: vapid.publicKey, BETTER_AUTH_URL: "https://x.example" })).toBeNull();
  });

  it("iOS: only in the installed app; refused permission; server without keys", () => {
    const base = { configured: true, ios: true, standalone: true, hasPush: true, permission: "default" as NotificationPermission };
    expect(pushAvailability(base)).toBe("available");
    expect(pushAvailability({ ...base, standalone: false, hasPush: false })).toBe("install-ios");
    expect(pushAvailability({ ...base, permission: "denied" })).toBe("denied");
    expect(pushAvailability({ ...base, configured: false })).toBe("unconfigured");
    expect(pushAvailability({ ...base, ios: false, standalone: false, hasPush: false })).toBe("unsupported");
    expect(pushAvailability({ ...base, ios: false, standalone: false })).toBe("available"); // desktop browsers
  });
});

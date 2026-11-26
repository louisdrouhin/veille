/**
 * Briefing du matin (docs/design/3.4, lib/briefing): schedule in the account's time zone (DST, weekdays, catch-up
 * under 3 hours), selection (a topic once, empty sections, Mes services from the settings), AI sentences (titles
 * and extracts only — never Ma stack nor a note — checked numbers), notification text without AI (Travail stays
 * generic), quota priority over indexing. Fictional data only (CVE-2099-…).
 */
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";

vi.mock("server-only", () => ({}));

const { latestSlot, nextSlot, dueNow, zonedTime, localDay, slotLabel } = await import("@/lib/briefing/schedule");
const { makeBriefing, runDueBriefing, retrySentences, briefingBusy, makeNow, purgeBriefings } = await import("@/lib/briefing/generate");
const { briefingPayload } = await import("@/lib/briefing/push");
const { checkSentence } = await import("@/lib/briefing/sentences");
const { getBriefingSettings, updateBriefingSettings } = await import("@/lib/briefing/settings");
const { isBriefingDay, readingMinutes, EMPTY_CONTENT } = await import("@/lib/briefing/types");
const { dispatchNotifications } = await import("@/lib/push/notify");
const { generateVapidKeys } = await import("@/lib/push/webpush");
const { syncCatalog } = await import("@/lib/stack/catalog");
const { storeVulns } = await import("@/lib/stack/sync");
const { recomputeAlerts } = await import("@/lib/stack/alerts");

const { alerts, briefings, forums, products, pushSubscriptions, replies, sources, stackItems, topics, vulnerabilities } = schema;
const AI = { apiKey: "test-key-123", model: "gemini-3.5-flash-lite", translateModel: "gemini-3.8-flash" };
const vapid = { ...generateVapidKeys(), subject: "https://folders.example" };
const KEYS = { p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4", auth: "BTBZMqHH6r4Tts7J_aSIgg" };
const resolve = async () => [{ address: "17.188.1.1", family: 4 as const }];
const TZ = { sendAt: "07:00", days: "weekdays" as const, timezone: "Europe/Paris" };

/** Thursday 26 Nov 2026, 07:00 in Paris (UTC+1). */
const THU_7 = new Date("2026-11-26T06:00:00Z");
const WED_7 = new Date("2026-11-25T06:00:00Z");
const EVENING = new Date("2026-11-25T20:00:00Z");

let db: Db;
const ids: Record<string, number> = {};

type Net = { gemini: { url: string; body: string }[]; pushes: string[]; reply: (data: Record<string, { titre: string; extraits: string }>) => Record<string, string> | Response };

function net(reply?: Net["reply"]) {
  const n: Net = { gemini: [], pushes: [], reply: reply ?? ((data) => Object.fromEntries(Object.entries(data).map(([k, v]) => [k, `Résumé : ${v.titre.slice(0, 30)}.`]))) };
  const fetchImpl = (async (u: string | URL, init?: RequestInit) => {
    const url = String(u);
    if (url.includes("generativelanguage.googleapis.com")) {
      const body = String(init?.body);
      n.gemini.push({ url, body });
      const user = (JSON.parse(body) as { contents: { parts: { text: string }[] }[] }).contents[0]!.parts[0]!.text;
      const data = JSON.parse(/^<<<EXTRAITS [\w-]+>>>\n([\s\S]*)\n<<<FIN EXTRAITS [\w-]+>>>$/.exec(user)![1]!);
      const r = n.reply(data);
      if (r instanceof Response) return r;
      return Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(r) }] } }] });
    }
    n.pushes.push(url);
    return new Response(null, { status: 201 });
  }) as typeof fetch;
  return { n, deps: { ai: AI, vapid, fetch: fetchImpl, resolve } };
}

async function topic(forum: string, title: string, excerpt: string, at = EVENING, source = "src-a") {
  const [t] = await db
    .insert(topics)
    .values({ forumId: ids[forum]!, sourceId: ids[source]!, title, url: `https://example.org/${encodeURIComponent(title)}`, normalizedUrl: `example.org/${encodeURIComponent(title)}`, excerpt, publishedAt: at, lastActivityAt: at, createdAt: at })
    .returning();
  return t!.id;
}

async function seed() {
  await syncCatalog(db);
  const [news, services, other] = await db
    .insert(forums)
    .values([
      { name: "Actus", slug: "actus" },
      { name: "Mes services", slug: "mes-services" },
      { name: "Releases", slug: "releases" },
    ])
    .returning();
  ids.news = news!.id;
  ids.services = services!.id;
  ids.releases = other!.id;
  const src = await db
    .insert(sources)
    .values([
      { forumId: ids.news, name: "Source A", url: "https://a.example/feed" },
      { forumId: ids.news, name: "Source B", url: "https://b.example/feed" },
      { forumId: ids.services, name: "Releases C", url: "https://c.example/feed" },
    ])
    .returning();
  ids["src-a"] = src[0]!.id;
  ids["src-b"] = src[1]!.id;
  ids["src-c"] = src[2]!.id;

  // Picked up by two sources: À la une.
  ids.hot = await topic("news", "Faille majeure dans un hyperviseur", "Le correctif 9.2.1 est publié pour l'hyperviseur.");
  await db.insert(replies).values([
    { topicId: ids.hot, type: "source", author: "Source B", title: "Hyperviseur : correctif urgent", content: "Mettre à jour vers 9.2.1.", createdAt: EVENING },
    // A personal note: never read for the briefing.
    { topicId: ids.hot, type: "note", author: "Moi", content: "NOTE-PRIVEE mot de passe hunter2", createdAt: EVENING },
  ]);
  await db.update(topics).set({ replyCount: 2 }).where(eq(topics.id, ids.hot));
  ids.release = await topic("services", "Vaultwarden 1.33 publié", "Notes de version : nouvel export chiffré.", EVENING, "src-c");
  ids.plain = await topic("news", "Un article ordinaire", "Rien de spécial ici.");
  ids.old = await topic("news", "Article trop ancien", "Avant la fenêtre.", new Date("2026-11-20T10:00:00Z"));

  // Ma stack: a Travail FortiOS and a Homelab Proxmox (fictional flaws).
  const all = await db.select().from(products);
  const p = (k: string) => all.find((x) => x.key === k)!;
  const v = (ref: string, cvss: number, end: string, exploited = false) => ({
    ref,
    cveId: ref,
    descriptionEn: "Fictional.",
    cvss,
    severity: null,
    exploited,
    publishedAt: EVENING,
    updatedAt: EVENING,
    sources: [],
    ranges: [{ end, endIncluding: false, src: "nvd" as const }],
  });
  await storeVulns(db, p("fortios"), "nvd", [v("CVE-2099-1", 9.8, "7.0.16", true)]);
  await storeVulns(db, p("proxmox-ve"), "nvd", [v("CVE-2099-3", 7.5, "8.1.4")]);
  await db.insert(stackItems).values([
    { productId: p("fortios").id, version: "7.0.12", context: "work" },
    { productId: p("proxmox-ve").id, version: "8.1.3", context: "homelab" },
  ]);
  await recomputeAlerts(db, { now: EVENING });
  await db.update(alerts).set({ createdAt: EVENING });
  // The flaw's own topic is the « hot » one: it must not come back in À la une.
  ids.stackTopic = await topic("news", "Avis CERT : faille FortiOS", "CVE-2099-1 corrigée en 7.0.16.");
  await db.insert(replies).values({ topicId: ids.stackTopic, type: "source", author: "Source B", title: "FortiOS", content: "Idem.", createdAt: EVENING });
  await db.update(vulnerabilities).set({ topicId: ids.stackTopic }).where(eq(vulnerabilities.ref, "CVE-2099-1"));
  await db.insert(pushSubscriptions).values({ endpoint: "https://web.push.apple.com/device-1", keys: KEYS });
}

beforeEach(async () => {
  const pg = drizzle(new PGlite(), { schema });
  await migrate(pg, { migrationsFolder: path.join(import.meta.dirname, "..", "drizzle") });
  db = pg as unknown as Db;
  vi.unstubAllEnvs();
  vi.stubEnv("GEMINI_RETRY_DELAYS_MS", "0,0");
});

describe("schedule (Europe/Paris)", () => {
  it("07:00 is 06:00 UTC in winter and 05:00 UTC in summer, across both DST changes", () => {
    expect(zonedTime(2026, 3, 27, 7, 0, "Europe/Paris").toISOString()).toBe("2026-03-27T06:00:00.000Z");
    expect(zonedTime(2026, 3, 30, 7, 0, "Europe/Paris").toISOString()).toBe("2026-03-30T05:00:00.000Z");
    expect(zonedTime(2026, 10, 23, 7, 0, "Europe/Paris").toISOString()).toBe("2026-10-23T05:00:00.000Z");
    expect(zonedTime(2026, 10, 26, 7, 0, "Europe/Paris").toISOString()).toBe("2026-10-26T06:00:00.000Z");
    // 02:30 does not exist on 29 March: the first instant after the gap (03:30 local).
    expect(zonedTime(2026, 3, 29, 2, 30, "Europe/Paris").toISOString()).toBe("2026-03-29T01:30:00.000Z");
    // 02:30 happens twice on 25 October: the first one (still UTC+2).
    expect(zonedTime(2026, 10, 25, 2, 30, "Europe/Paris").toISOString()).toBe("2026-10-25T00:30:00.000Z");
  });

  it("weekdays: Saturday and Sunday skipped; « tous les jours »; next slot label", () => {
    const sat = new Date("2026-11-28T10:00:00Z");
    expect(latestSlot(sat, TZ)).toEqual({ day: "2026-11-27", at: new Date("2026-11-27T06:00:00Z") });
    expect(nextSlot(sat, TZ)).toEqual({ day: "2026-11-30", at: new Date("2026-11-30T06:00:00Z") });
    expect(latestSlot(sat, { ...TZ, days: "daily" })!.day).toBe("2026-11-28");
    expect(slotLabel(nextSlot(THU_7, TZ)!, "Europe/Paris")).toBe("vendredi 27 nov. à 7:00");
    expect(localDay(new Date("2026-11-26T23:30:00Z"), "Europe/Paris")).toBe("2026-11-27");
  });

  it("due: made at the time, caught up at restart under 3 h late, skipped beyond; once a day", () => {
    const none = () => false;
    // 06:59 on Thursday: Wednesday's slot is a day late → skipped, today's not yet due.
    expect(dueNow(new Date("2026-11-26T05:59:00Z"), TZ, none)).toMatchObject({ action: "skip", slot: { day: "2026-11-25" } });
    expect(dueNow(THU_7, TZ, none)).toMatchObject({ action: "make", slot: { day: "2026-11-26" } });
    expect(dueNow(new Date("2026-11-26T08:59:00Z"), TZ, none)).toMatchObject({ action: "make" });
    expect(dueNow(new Date("2026-11-26T09:00:00Z"), TZ, none)).toMatchObject({ action: "skip", slot: { day: "2026-11-26" } });
    expect(dueNow(THU_7, TZ, (d) => d === "2026-11-26")).toEqual({ action: "none" });
  });

  it("only real days are accepted in the routes", () => {
    expect(isBriefingDay("2026-11-26")).toBe(true);
    for (const bad of ["2026-02-30", "2026-13-01", "26-11-2026", "2026-11-26/../x", "", "2026-1-5"]) expect(isBriefingDay(bad)).toBe(false);
  });
});

describe("making a briefing", () => {
  beforeEach(seed);

  it("sections, a topic once, Mes services from the settings, sentences from titles and extracts only", async () => {
    await updateBriefingSettings(db, { enabled: true });
    expect((await getBriefingSettings(db)).servicesForumIds).toEqual([ids.services]);
    const { n, deps } = net();
    const b = await makeBriefing(db, { day: "2026-11-26", since: WED_7, kind: "scheduled" }, { ...deps, now: THU_7 });

    expect(b).toMatchObject({ step: "done", ai: "ok", articleCount: 6 });
    expect(b.content.stack.map((p) => [p.ref, p.severity, p.context])).toEqual([
      ["CVE-2099-1", "critical", "work"],
      ["CVE-2099-3", "high", "homelab"],
    ]);
    expect(b.content.featured.map((p) => p.topicId)).toEqual([ids.hot]);
    expect(b.content.featured[0]!.sources).toEqual(["Source A", "Source B"]);
    expect(b.content.services.map((p) => p.topicId)).toEqual([ids.release]);
    expect(b.content.brief.map((p) => p.topicId)).toEqual([ids.plain]);
    const all = [...b.content.featured, ...b.content.services, ...b.content.brief].map((p) => p.topicId);
    expect(new Set(all).size).toBe(all.length);
    expect(all).not.toContain(ids.stackTopic);
    expect(all).not.toContain(ids.old);
    expect(b.content.featured[0]!.sentence).toMatch(/^Résumé/);

    // One call; never Ma stack (products, versions, refs), never a note.
    expect(n.gemini).toHaveLength(1);
    const sent = n.gemini[0]!.body;
    for (const secret of ["NOTE-PRIVEE", "hunter2", "FortiOS", "7.0.12", "Proxmox", "8.1.3", "CVE-2099-3"]) expect(sent).not.toContain(secret);
    expect(sent).toContain("DONNÉE NON FIABLE");
    expect(sent).toContain("Vaultwarden 1.33");
    expect(n.pushes).toHaveLength(1);
  });

  it("a sentence with a number or version absent from the extracts is dropped; the point stays", async () => {
    const { deps } = net((data) => Object.fromEntries(Object.keys(data).map((k) => [k, "Version 9.9 publiée en 2031."])));
    const b = await makeBriefing(db, { day: "2026-11-26", since: WED_7, kind: "scheduled" }, { ...deps, now: THU_7 });
    expect(b.ai).toBe("ok");
    expect(b.content.featured[0]).toMatchObject({ topicId: ids.hot, sentence: null });
    expect(checkSentence("Correctif 9.2.1 publié.", "Le correctif 9.2.1 est publié", 200)).toBe("Correctif 9.2.1 publié.");
    expect(checkSentence("Voir <a href=x>ici</a>", "x", 200)).toBeNull();
    expect(checkSentence("Trop long", "x", 5)).toBeNull();
  });

  it("« Court »: titles only, no AI call; Ma stack keeps its own sentence", async () => {
    await updateBriefingSettings(db, { length: "short" });
    const { n, deps } = net();
    const b = await makeBriefing(db, { day: "2026-11-26", since: WED_7, kind: "scheduled" }, { ...deps, now: THU_7 });
    expect(n.gemini).toHaveLength(0);
    expect(b).toMatchObject({ ai: "off", length: "short" });
    expect(b.content.featured[0]!.sentence).toBeNull();
  });

  it("disabled sections are left out (and their entries hidden)", async () => {
    await updateBriefingSettings(db, { sectionStack: false, sectionBrief: false });
    const { deps } = net();
    const b = await makeBriefing(db, { day: "2026-11-26", since: WED_7, kind: "scheduled" }, { ...deps, now: THU_7 });
    expect(b.content.stack).toEqual([]);
    expect(b.content.brief).toEqual([]);
    // Without Ma stack, the flaw's own topic may be À la une.
    expect(b.content.featured.map((p) => p.topicId).sort()).toEqual([ids.hot, ids.stackTopic].sort());
  });

  it("AI error: ready without sentences, notification still sent; « Générer les résumés » writes them", async () => {
    const down = net(() => new Response("{}", { status: 503 }));
    const b = await makeBriefing(db, { day: "2026-11-26", since: WED_7, kind: "scheduled" }, { ...down.deps, now: THU_7 });
    expect(b).toMatchObject({ ai: "error", step: "done" });
    expect(b.readyAt).not.toBeNull();
    expect(b.content.featured[0]!.sentence).toBeNull();
    expect(down.n.pushes).toHaveLength(1);
    const up = net();
    const again = await retrySentences(db, b.id, up.deps);
    expect(again).toMatchObject({ ai: "ok" });
    expect(again!.content.featured[0]!.sentence).toMatch(/^Résumé/);
    // Frozen otherwise: no second retry once ok.
    expect(await retrySentences(db, b.id, up.deps)).toBeNull();
  });

  it("the alerts shown are not pushed again at the end of the quiet hours", async () => {
    const { n, deps } = net();
    await makeBriefing(db, { day: "2026-11-26", since: WED_7, kind: "scheduled" }, { ...deps, now: THU_7 });
    expect(n.pushes).toHaveLength(1);
    const after = await dispatchNotifications(db, { vapid, now: new Date("2026-11-26T07:00:00Z"), fetchImpl: deps.fetch, resolve });
    expect(after.sent).toBe(0);
    expect(n.pushes).toHaveLength(1);
  });

  it("« Rien de neuf »: no notification; an aperçu never notifies", async () => {
    const { n, deps } = net();
    const quiet = await makeBriefing(db, { day: "2026-11-30", since: new Date("2026-11-29T06:00:00Z"), kind: "scheduled" }, { ...deps, now: new Date("2026-11-30T06:00:00Z") });
    expect(quiet.content).toEqual({ ...EMPTY_CONTENT, stackOpen: 2 });
    expect(n.pushes).toHaveLength(0);
    const preview = await makeNow(db, "preview", { ...deps, now: THU_7 });
    expect(preview.created).toBe(true);
    expect(preview.briefing.kind).toBe("preview");
    expect(n.pushes).toHaveLength(0);
    // Asked again the same day: the same briefing (frozen).
    expect((await makeNow(db, "test", { ...deps, now: THU_7 })).created).toBe(false);
  });
});

describe("worker schedule and quota", () => {
  beforeEach(seed);

  it("made at 07:00 (enabled only), once; Monday covers the weekend; skipped beyond 3 h; purged after 30 days", async () => {
    const { deps } = net();
    expect(await runDueBriefing(db, { ...deps, now: THU_7 })).toBeNull();
    await updateBriefingSettings(db, { enabled: true });
    const thu = await runDueBriefing(db, { ...deps, now: new Date("2026-11-26T06:00:30Z") });
    expect(thu).toMatchObject({ day: "2026-11-26", kind: "scheduled" });
    expect(await runDueBriefing(db, { ...deps, now: new Date("2026-11-26T06:01:30Z") })).toBeNull();
    // Friday: the server was off until 10:30 → skipped.
    expect(await runDueBriefing(db, { ...deps, now: new Date("2026-11-27T09:30:00Z") })).toBeNull();
    // Monday: the window starts at Thursday's briefing (Friday skipped, weekend included).
    const mon = await runDueBriefing(db, { ...deps, now: new Date("2026-11-30T06:00:10Z") });
    expect(mon!.since.toISOString()).toBe(thu!.createdAt.toISOString());
    expect((await db.select().from(briefings)).map((b) => b.day).sort()).toEqual(["2026-11-26", "2026-11-30"]);
    expect(await purgeBriefings(db, new Date("2026-12-27T00:00:00Z"))).toBe(1);
  });

  it("the indexing waits in the 30 minutes before the briefing and while it is written", async () => {
    await updateBriefingSettings(db, { enabled: true });
    expect(await briefingBusy(db, new Date("2026-11-26T05:35:00Z"))).toBe(true);
    expect(await briefingBusy(db, new Date("2026-11-26T04:00:00Z"))).toBe(false);
    await db.insert(briefings).values({ day: "2026-11-26", since: WED_7, createdAt: new Date("2026-11-26T09:58:00Z"), ai: "pending", step: "ai", content: EMPTY_CONTENT });
    expect(await briefingBusy(db, new Date("2026-11-26T10:00:00Z"))).toBe(true);
    // Stuck for more than 15 minutes (worker restarted): shown without sentences, indexing resumes.
    await runDueBriefing(db, { ai: AI, vapid: null, now: new Date("2026-11-26T10:20:00Z") });
    expect((await db.select().from(briefings))[0]).toMatchObject({ ai: "error", step: "done" });
    expect(await briefingBusy(db, new Date("2026-11-26T10:20:00Z"))).toBe(false);
  });
});

describe("notification text (no AI)", () => {
  const point = (over = {}) => ({ alertId: 1, severity: "critical" as const, title: "Faille", ref: "CVE-2099-1", product: "FortiOS", version: "7.0.12", context: "homelab" as const, exploited: true, fix: "7.0.16", ...over });
  const topicPoint = (title: string) => ({ topicId: 1, title, sentence: null, sources: ["A"], forum: { name: "Actus", slug: "actus" } });
  const d = { discreetHomelab: false, discreetWork: true };

  it("title by priority: critical flaws, flaws, first topic À la une, number of points", () => {
    const c = { ...EMPTY_CONTENT, stack: [point()], featured: [topicPoint("Un sujet repris")], services: [topicPoint("Vaultwarden 1.33"), topicPoint("Immich 2.0"), topicPoint("Jellyfin 10.11")] };
    expect(briefingPayload("2026-11-26", c, "full", d, 3)).toEqual({
      title: "Briefing · 1 faille critique sur ta stack",
      body: "Critique · FortiOS 7.0.12 : mettre à jour vers 7.0.16.\nÀ la une : Un sujet repris",
      tag: "briefing-2026-11-26",
      url: "/briefing/2026-11-26",
      badge: 3,
    });
    expect(briefingPayload("d", { ...c, stack: [point({ severity: "high" })] }, "full", d, 1).title).toBe("Briefing · 1 faille sur ta stack");
    const noStack = briefingPayload("d", { ...c, stack: [] }, "full", d, 0);
    expect(noStack).toMatchObject({ title: "Briefing · Un sujet repris", body: "Vaultwarden 1.33 et 2 autres versions" });
    expect(briefingPayload("d", { ...EMPTY_CONTENT, brief: [topicPoint("a"), topicPoint("b")] }, "full", d, 0).title).toBe("Briefing · 2 points ce matin");
  });

  it("Travail stays generic even in « Aperçu complet »; « Discret » names no product; no emoji", () => {
    const c = { ...EMPTY_CONTENT, stack: [point({ context: "work" })], services: [topicPoint("Vaultwarden 1.33")] };
    const full = briefingPayload("2026-11-26", c, "full", d, 1);
    expect(`${full.title} ${full.body}`).not.toMatch(/FortiOS|7\.0\.1/);
    expect(full.body).toContain("Critique · un logiciel du contexte Travail à mettre à jour.");
    const discreet = briefingPayload("2026-11-26", c, "discreet", d, 1);
    expect(discreet).toMatchObject({ title: "Ton briefing du matin est prêt", body: `${readingMinutes(c)} min de lecture. Touche pour l'ouvrir.` });
    for (const p of [full, discreet]) expect(`${p.title} ${p.body}`).not.toMatch(/\p{Extended_Pictographic}/u);
    // Homelab with its discreet notifications on: generic too.
    expect(briefingPayload("d", { ...EMPTY_CONTENT, stack: [point()] }, "full", { ...d, discreetHomelab: true }, 1).body).not.toContain("FortiOS");
  });
});

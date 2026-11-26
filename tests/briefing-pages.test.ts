/**
 * Briefing du matin (docs/design/3.4), pages and settings: « Marquer ces N topics lus » and its « Annuler », the
 * home block (today, unread, before noon, hidden until tomorrow, replaces the Ma stack banner unless a newer alert),
 * the header dot, settings validation (15-minute steps, existing forums, all sections off = briefing off), the read
 * mark when the page is opened. Fictional data only.
 */
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";

const state = vi.hoisted(() => ({ db: null as unknown as Db }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/session", () => ({ requireSession: vi.fn(async () => ({ user: { id: "u1", name: "Moi" } })) }));
vi.mock("@/lib/db", () => ({ getDb: () => state.db }));

const actions = await import("@/lib/actions/briefing");
const { homeBriefing, briefingNav, markBriefingRead, getBriefing } = await import("@/lib/briefing/queries");
const { briefingPageData } = await import("@/lib/briefing/page-data");
const { getBriefingSettings, updateBriefingSettings } = await import("@/lib/briefing/settings");
const { parseBriefingPatch } = await import("@/lib/briefing/validate");
const { EMPTY_CONTENT } = await import("@/lib/briefing/types");
const { dayTitle, sinceLabel, weekOf, daysBack } = await import("@/lib/briefing/format");

const { briefings, forums, sources, topics } = schema;
/** Thursday 26 Nov 2026 09:00 and 13:00 in Paris. */
const MORNING = new Date("2026-11-26T08:00:00Z");
const AFTERNOON = new Date("2026-11-26T12:00:00Z");

let ids: number[] = [];
let forumId = 0;

const point = (topicId: number, title: string) => ({ topicId, title, sentence: null, sources: ["Source A"], forum: { name: "Actus", slug: "actus" } });

async function briefing(over: Partial<typeof briefings.$inferInsert> = {}) {
  const [b] = await state.db
    .insert(briefings)
    .values({
      day: "2026-11-26",
      since: new Date("2026-11-25T06:00:00Z"),
      createdAt: new Date("2026-11-26T06:00:00Z"),
      readyAt: new Date("2026-11-26T06:01:00Z"),
      step: "done",
      ai: "ok",
      articleCount: 12,
      content: { ...EMPTY_CONTENT, featured: [point(ids[0]!, "Sujet repris")], services: [point(ids[1]!, "Vaultwarden 1.33")], brief: [point(ids[2]!, "Autre")] },
      ...over,
    })
    .returning();
  return b!;
}

beforeEach(async () => {
  const pg = drizzle(new PGlite(), { schema });
  await migrate(pg, { migrationsFolder: path.join(import.meta.dirname, "..", "drizzle") });
  state.db = pg as unknown as Db;
  const [f] = await state.db.insert(forums).values({ name: "Mes services", slug: "mes-services" }).returning();
  forumId = f!.id;
  const [s] = await state.db.insert(sources).values({ forumId, name: "Source A", url: "https://a.example/feed" }).returning();
  const at = new Date("2026-11-25T20:00:00Z");
  ids = (
    await state.db
      .insert(topics)
      .values(["Sujet repris", "Vaultwarden 1.33", "Autre", "Pas dans le briefing"].map((title) => ({ forumId, sourceId: s!.id, title, url: `https://a.example/${title}`, normalizedUrl: `a.example/${title}`, publishedAt: at, lastActivityAt: at, createdAt: at })))
      .returning()
  ).map((t) => t.id);
  await state.db.update(topics).set({ readAt: at }).where(eq(topics.id, ids[2]!));
});

describe("« Marquer ces N topics lus » and « Annuler »", () => {
  it("marks the unread ones and returns them; « Annuler » gives back exactly those", async () => {
    const res = await actions.setTopicsReadAction([ids[0], ids[1], ids[2]], true);
    expect(res).toMatchObject({ ok: true, changed: [ids[0], ids[1]].sort((a, b) => a! - b!) });
    const undo = await actions.setTopicsReadAction(res.ok ? res.changed : [], false);
    expect(undo).toMatchObject({ ok: true });
    const rows = await state.db.select({ id: topics.id, readAt: topics.readAt }).from(topics);
    expect(rows.filter((r) => r.readAt !== null).map((r) => r.id)).toEqual([ids[2]]);
  });

  it("refuses anything but a short list of ids and a boolean", async () => {
    for (const bad of [[0], ["1"], [1.5], "1", Array(101).fill(1).map((_, i) => i + 1)]) expect(await actions.setTopicsReadAction(bad, true)).toMatchObject({ ok: false });
    expect(await actions.setTopicsReadAction([ids[0]], "yes")).toMatchObject({ ok: false });
  });
});

describe("home block and header", () => {
  it("today's briefing, ready, unread, before noon; hidden until tomorrow by ✕; gone once read", async () => {
    expect(await homeBriefing(state.db, MORNING)).toBeNull();
    const b = await briefing();
    expect(await homeBriefing(state.db, MORNING)).toMatchObject({ day: "2026-11-26", at: "7:00", points: 3, featured: { first: "Sujet repris", more: 0 }, services: { first: "Vaultwarden 1.33" }, replacesStack: true });
    expect(await homeBriefing(state.db, AFTERNOON)).toBeNull();
    expect(await briefingNav(state.db, MORNING)).toEqual({ day: "2026-11-26", unread: true });
    await updateBriefingSettings(state.db, { homeHiddenOn: "2026-11-26" });
    expect(await homeBriefing(state.db, MORNING)).toBeNull();
    // Tomorrow it would show again (another day).
    await updateBriefingSettings(state.db, { homeHiddenOn: "2026-11-25" });
    await markBriefingRead(state.db, b.id, MORNING);
    expect(await homeBriefing(state.db, MORNING)).toBeNull();
    expect(await briefingNav(state.db, MORNING)).toEqual({ day: "2026-11-26", unread: false });
  });

  it("« Rien de neuf » and a briefing in preparation are not announced", async () => {
    await briefing({ content: EMPTY_CONTENT });
    expect(await homeBriefing(state.db, MORNING)).toBeNull();
    expect((await briefingNav(state.db, MORNING)).unread).toBe(false);
  });

  it("✕ « Masquer jusqu'à demain » saves today's local day", async () => {
    await briefing();
    expect(await actions.hideHomeBriefingAction()).toEqual({ ok: true });
    expect((await getBriefingSettings(state.db)).homeHiddenOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("opening the page marks the briefing read, not its topics", async () => {
    const b = await briefing({ readAt: null });
    const data = await briefingPageData(state.db, b, await getBriefingSettings(state.db), MORNING);
    expect((await getBriefing(state.db, "2026-11-26"))!.readAt).not.toBeNull();
    expect([...data.readIds]).toEqual([ids[2]]);
    expect(data.unread).toBe(3);
    // A briefing still being written is not marked read by the polling.
    const prep = await briefing({ day: "2026-11-27", step: "ai", readyAt: null });
    await briefingPageData(state.db, prep, await getBriefingSettings(state.db), MORNING);
    expect((await getBriefing(state.db, "2026-11-27"))!.readAt).toBeNull();
  });
});

describe("settings", () => {
  it("validation: 15-minute steps, known values, existing forums only", () => {
    expect(parseBriefingPatch({ sendAt: "07:15", days: "daily", length: "short", preview: "discreet", servicesForumIds: [forumId] }, [forumId])).toEqual({
      sendAt: "07:15",
      days: "daily",
      length: "short",
      preview: "discreet",
      servicesForumIds: [forumId],
    });
    for (const bad of [{ sendAt: "07:10" }, { sendAt: "24:00" }, { days: "weekend" }, { length: "long" }, { preview: "x" }, { enabled: "true" }, { servicesForumIds: [999] }, { timezone: "Mars/Olympus" }, [], null])
      expect(parseBriefingPatch(bad, [forumId])).toBeNull();
    expect(parseBriefingPatch({ unknown: 1 }, [])).toEqual({});
  });

  it("all sections unchecked turns the briefing off, with a message; turning on marks the first-time card answered", async () => {
    const on = await actions.updateBriefingSettingsAction({ enabled: true });
    expect(on).toMatchObject({ ok: true, enabled: true });
    expect((await getBriefingSettings(state.db)).introSeenAt).not.toBeNull();
    await actions.updateBriefingSettingsAction({ sectionStack: false, sectionFeatured: false, sectionServices: false });
    const off = await actions.updateBriefingSettingsAction({ sectionBrief: false });
    expect(off).toMatchObject({ ok: true, enabled: false, message: expect.stringContaining("coupé") });
    expect(await actions.updateBriefingSettingsAction({ enabled: true })).toMatchObject({ ok: false });
    expect(await actions.updateBriefingSettingsAction({ sendAt: "7h" })).toMatchObject({ ok: false });
  });

  it("Mes services is pre-filled with a forum of that name, once; afterwards only what was chosen", async () => {
    expect((await getBriefingSettings(state.db)).servicesForumIds).toEqual([forumId]);
    await actions.updateBriefingSettingsAction({ servicesForumIds: [] });
    expect((await getBriefingSettings(state.db)).servicesForumIds).toEqual([]);
  });
});

describe("dates", () => {
  it("title, « depuis », weeks and days back", () => {
    expect(dayTitle("2026-11-26")).toBe("Jeudi 26 novembre");
    expect(sinceLabel(new Date("2026-11-25T06:00:00Z"), "Europe/Paris")).toBe("mer. 7:00");
    expect(weekOf("2026-11-29")).toBe("2026-11-23");
    expect(daysBack("2026-03-01", 3)).toEqual(["2026-03-01", "2026-02-28", "2026-02-27"]);
  });
});

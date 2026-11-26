/**
 * Paramètres (docs/design/3.5, lot 2): Sécurité (sessions, devices, backup codes, actions behind the re-confirmation),
 * Recherche et IA (settings saved in clear and read through the environment, fusion window, 7-day simulation,
 * reindexing estimate), Sources filters, settings menu badges.
 */
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";

const state = vi.hoisted(() => ({ db: null as unknown as Db, userId: "u1", sessionId: "s-this" }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireSession: vi.fn(async () => ({ user: { id: state.userId }, session: { id: state.sessionId } })) }));
vi.mock("@/lib/db", () => ({ getDb: () => state.db }));

const { deviceLabel, listSessions } = await import("@/lib/security");
const security = await import("@/lib/actions/security");
const searchSettings = await import("@/lib/actions/search-settings");
const { grant, resetReconfirm } = await import("@/lib/secrets/reconfirm");
const { effectiveEnv } = await import("@/lib/secrets/effective");
const { invalidateSettings } = await import("@/lib/secrets/store");
const { mergeWindowMs, MERGE_WINDOW_MS } = await import("@/lib/merge/fusion");
const { dailyLimit } = await import("@/lib/search/usage");
const { fusionScores, reindexEstimate } = await import("@/lib/search/simulate");
const { encodeVector } = await import("@/lib/search/vectors");
const { EMBEDDING_DIM } = await import("@/lib/ai/embeddings");
const { parseSourceFilter } = await import("@/components/admin/source-errors");
const { sourceErrorCount, settingsValues } = await import("@/lib/settings/summary");

const { user, session, articleEmbeddings, forums, sources, topics, appSettings } = schema;
const NOW = new Date("2026-11-26T10:00:00Z");
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const MAC_CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

beforeEach(async () => {
  const pg = drizzle(new PGlite(), { schema });
  await migrate(pg, { migrationsFolder: path.join(import.meta.dirname, "..", "drizzle") });
  state.db = pg as unknown as Db;
  resetReconfirm();
  invalidateSettings(state.db);
  await state.db.insert(user).values([
    { id: "u1", name: "moi", email: "moi@example.com" },
    { id: "u2", name: "autre", email: "autre@example.com" },
  ]);
  const later = new Date(NOW.getTime() + 86_400_000);
  await state.db.insert(session).values([
    { id: "s-this", token: "t1", userId: "u1", expiresAt: later, userAgent: MAC_CHROME, updatedAt: new Date("2026-11-26T09:00:00Z") },
    { id: "s-phone", token: "t2", userId: "u1", expiresAt: later, userAgent: IPHONE, updatedAt: new Date("2026-11-26T09:30:00Z") },
    { id: "s-old", token: "t3", userId: "u1", expiresAt: later, userAgent: null, updatedAt: new Date("2026-11-20T09:30:00Z") },
    { id: "s-other-user", token: "t4", userId: "u2", expiresAt: later, userAgent: IPHONE },
  ]);
});

describe("Sécurité › Sessions", () => {
  it("readable devices, this session first, never another account's", async () => {
    expect(deviceLabel(IPHONE)).toBe("iPhone · Safari");
    expect(deviceLabel(MAC_CHROME)).toBe("Mac · Chrome");
    expect(deviceLabel(null)).toBe("Appareil inconnu");
    const rows = await listSessions(state.db, "u1", "s-this", NOW);
    expect(rows.map((r) => [r.id, r.device, r.current])).toEqual([
      ["s-this", "Mac · Chrome", true],
      ["s-phone", "iPhone · Safari", false],
      ["s-old", "Appareil inconnu", false],
    ]);
  });

  it("disconnecting needs a recent identity confirmation; never this session nor another account's", async () => {
    expect(await security.revokeSessionAction("s-phone")).toMatchObject({ ok: false, reconfirm: true });
    grant(state.sessionId);
    expect(await security.revokeSessionAction("s-this")).toMatchObject({ ok: false });
    expect(await security.revokeSessionAction("s-other-user")).toMatchObject({ ok: false });
    expect(await security.revokeSessionAction("s-phone")).toEqual({ ok: true });
    expect(await security.revokeOtherSessionsAction()).toEqual({ ok: true, count: 1 });
    const left = await state.db.select({ id: session.id }).from(session);
    expect(left.map((r) => r.id).sort()).toEqual(["s-other-user", "s-this"]);
  });
});

describe("Recherche et IA", () => {
  it("threshold, window and limits are saved in clear and read through the environment; empty = default", async () => {
    expect(await searchSettings.saveSearchSettingAction("merge_window_hours", "48")).toEqual({ ok: true });
    expect(await searchSettings.saveSearchSettingAction("embed_daily_limit", "250")).toEqual({ ok: true });
    expect(await searchSettings.saveSearchSettingAction("merge_threshold", "0,91")).toEqual({ ok: true });
    const env = await effectiveEnv(state.db, {});
    expect(mergeWindowMs(env)).toBe(48 * 3_600_000);
    expect(dailyLimit("embed", env)).toBe(250);
    expect(env.MERGE_THRESHOLD).toBe("0.91");
    const [row] = await state.db.select().from(appSettings).where(eq(appSettings.name, "embed_daily_limit"));
    expect(row).toMatchObject({ value: "250", encrypted: null });
    expect(await searchSettings.saveSearchSettingAction("merge_window_hours", "")).toEqual({ ok: true });
    expect(mergeWindowMs(await effectiveEnv(state.db, {}))).toBe(MERGE_WINDOW_MS);
  });

  it("refuses unknown settings, secrets and invalid values", async () => {
    for (const [n, v] of [
      ["gemini_api_key", "AIza0123456789abcdef"],
      ["merge_window_hours", "12"],
      ["embed_daily_limit", "-1"],
      ["ask_daily_limit", "1e3"],
      ["merge_threshold", "1.5"],
    ])
      expect(await searchSettings.saveSearchSettingAction(n, v)).toMatchObject({ ok: false });
  });

  it("simulation: best similarity of each article of the last 7 days with an earlier one in the window", async () => {
    const [f] = await state.db.insert(forums).values({ name: "F", slug: "f" }).returning();
    const vec = (i: number) => {
      const v = new Float32Array(EMBEDDING_DIM);
      v[0] = 1;
      v[1] = i;
      const n = Math.hypot(1, i);
      v[0] /= n;
      v[1] /= n;
      return v;
    };
    const at = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
    const rows = await state.db
      .insert(topics)
      .values([10, 9, 3, 200].map((h, i) => ({ forumId: f!.id, title: `t${i}`, url: `u${i}`, normalizedUrl: `u${i}`, publishedAt: at(h), lastActivityAt: at(h), createdAt: at(h) })))
      .returning();
    // t0 and t1 almost identical (1 h apart), t2 different, t3 too old for the 7 days.
    await state.db.insert(articleEmbeddings).values(
      rows.map((r, i) => ({ topicId: r.id, model: "gemini-embedding-2", dim: EMBEDDING_DIM, vector: encodeVector(vec([0, 0.05, 3, 0][i]!)), articleOf: null })),
    );
    const scores = await fusionScores(state.db, 72 * 3_600_000, {}, NOW);
    expect(scores).toHaveLength(2);
    expect(Math.max(...scores)).toBeGreaterThan(0.99);
    expect(Math.min(...scores)).toBeLessThan(0.5);
  });

  it("reindexing estimate from the per-cycle budget and the daily limit", () => {
    expect(reindexEstimate(500, 1000)).toBe("moins d'une heure");
    expect(reindexEstimate(950, 1000)).toBe("environ 2 h");
    expect(reindexEstimate(2500, 1000)).toContain("environ 3 jours");
    expect(reindexEstimate(10, 0)).toContain("coupée");
  });

  it("« Tout réindexer » drops the vectors", async () => {
    const [f] = await state.db.insert(forums).values({ name: "F", slug: "f" }).returning();
    const [t] = await state.db.insert(topics).values({ forumId: f!.id, title: "t", url: "u", normalizedUrl: "u", publishedAt: NOW, lastActivityAt: NOW }).returning();
    await state.db.insert(articleEmbeddings).values({ topicId: t!.id, model: "m", dim: 1, vector: encodeVector(new Float32Array([1])), articleOf: null });
    expect(await searchSettings.reindexAllAction()).toEqual({ ok: true, removed: 1 });
    expect(await state.db.select().from(articleEmbeddings)).toEqual([]);
  });
});

describe("Sources and menu badges", () => {
  it("filters in the URL; « N en erreur » counts the same sources as the error block", async () => {
    expect([parseSourceFilter("erreur"), parseSourceFilter("desactivees"), parseSourceFilter("x"), parseSourceFilter(undefined)]).toEqual(["erreur", "desactivees", null, null]);
    const [f] = await state.db.insert(forums).values({ name: "F", slug: "f" }).returning();
    await state.db.insert(sources).values([
      { forumId: f!.id, name: "ok", url: "https://a.example/feed" },
      { forumId: f!.id, name: "ko", url: "https://b.example/feed", consecutiveFailures: 3, lastError: "HTTP 404" },
      { forumId: f!.id, name: "off", url: "https://c.example/feed", enabled: false, consecutiveFailures: 2 },
    ]);
    expect(await sourceErrorCount(state.db, NOW)).toBe(1);
    const values = await settingsValues(state.db, "dark");
    expect(values.sources).toEqual({ badge: "1 en erreur" });
    expect(values.apparence).toEqual({ value: "Sombre" });
    expect(values.integrations).toEqual({});
    await state.db.insert(appSettings).values({ name: "nvd_api_key", value: null, encrypted: "x", hint: "abcd", testOk: false, testMessage: "HTTP 403", testedAt: NOW });
    expect((await settingsValues(state.db, "system")).integrations).toEqual({ badge: "Clé refusée" });
  });
});

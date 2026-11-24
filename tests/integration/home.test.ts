/**
 * Home page queries (lib/home.ts) through the production driver (postgres-js) on a real
 * PostgreSQL. The unit tests run on PGlite, which accepts values postgres-js rejects
 * (a raw Date inside sql`` broke the home page once).
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { startPostgres, type TestDatabase } from "./helpers/postgres";

vi.mock("server-only", () => ({}));
const { getFeatured, getForumsWithCounts, getHomeStats, getLatestUnread } = await import("@/lib/home");

describe("home page queries (real PostgreSQL, postgres-js)", () => {
  let pg: TestDatabase;
  let db: Db;
  const now = new Date("2026-11-24T10:00:00Z");

  beforeAll(async () => {
    pg = await startPostgres();
    db = drizzle(pg.sql, { schema }) as unknown as Db;
    const [forum] = await db.insert(schema.forums).values({ name: "Sécurité", slug: "securite" }).returning();
    const [source] = await db
      .insert(schema.sources)
      .values([
        { forumId: forum!.id, name: "CERT-FR", url: "https://cert.example/feed", lastFetchedAt: new Date("2026-11-24T09:41:00Z") },
        { forumId: forum!.id, name: "Broken", url: "https://broken.example/feed", consecutiveFailures: 2 },
        { forumId: forum!.id, name: "Paused", url: "https://paused.example/feed", consecutiveFailures: 3, pausedUntil: new Date("2026-11-24T11:00:00Z") },
      ])
      .returning();
    const base = { forumId: forum!.id, sourceId: source!.id, publishedAt: new Date("2026-11-20T08:00:00Z"), lastActivityAt: new Date("2026-11-23T08:00:00Z") };
    const [hot] = await db
      .insert(schema.topics)
      .values([
        { ...base, title: "today", url: "u1", normalizedUrl: "u1", createdAt: new Date("2026-11-24T06:00:00Z") },
        { ...base, title: "older", url: "u2", normalizedUrl: "u2", createdAt: new Date("2026-11-20T08:00:00Z") },
        { ...base, title: "read", url: "u3", normalizedUrl: "u3", readAt: now, createdAt: new Date("2026-11-20T08:00:00Z") },
      ])
      .returning();
    await db.insert(schema.replies).values({ topicId: hot!.id, type: "source", author: "LWN", content: "" });
  }, 180_000);

  afterAll(async () => {
    await pg?.stop();
  }, 60_000);

  it("getHomeStats", async () => {
    expect(await getHomeStats(db, now)).toEqual({
      unreadTotal: 2,
      receivedToday: 1,
      lastFetchAt: new Date("2026-11-24T09:41:00Z"),
      errorCount: 1,
      sourceCount: 3,
    });
  });

  it("getLatestUnread, getForumsWithCounts, getFeatured", async () => {
    expect((await getLatestUnread(db, { limit: 8 })).map((t) => t.title).sort()).toEqual(["older", "today"]);
    expect((await getForumsWithCounts(db)).map((f) => [f.slug, f.total, f.unread])).toEqual([["securite", 3, 2]]);
    expect((await getFeatured(db, { limit: 3, since: new Date("2026-11-21T00:00:00Z") })).map((t) => [t.title, t.sourceNames])).toEqual([
      ["today", ["CERT-FR", "LWN"]],
    ]);
  });
});

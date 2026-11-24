/** Home page data (lib/home.ts) on PGlite, the Paris day boundary, and the created_at backfill of migration 0006. */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { startOfParisDay } from "@/lib/format-date";

vi.mock("server-only", () => ({}));
const { getFeatured, getForumsWithCounts, getHomeStats, getLatestUnread } = await import("@/lib/home");

const MIGRATIONS = path.join(import.meta.dirname, "..", "drizzle");
const { forums, replies, sources, topics } = schema;
const NOW = new Date("2026-11-24T10:00:00Z"); // 11:00 in Paris
const at = (iso: string) => new Date(iso);

let db: Db;
let secu: number;
let infra: number;
let cert: number;

async function topic(values: Partial<typeof topics.$inferInsert> & { title: string }) {
  const [row] = await db
    .insert(topics)
    .values({
      forumId: secu,
      sourceId: cert,
      url: `https://ex.com/${values.title}`,
      normalizedUrl: `https://ex.com/${values.title}`,
      publishedAt: at("2026-11-20T08:00:00Z"),
      lastActivityAt: at("2026-11-20T08:00:00Z"),
      createdAt: at("2026-11-20T08:00:00Z"),
      ...values,
    })
    .returning({ id: topics.id });
  return row!.id;
}

beforeEach(async () => {
  const pg = drizzle(new PGlite(), { schema });
  await migrate(pg, { migrationsFolder: MIGRATIONS });
  db = pg as unknown as Db;
  [{ id: secu }, { id: infra }] = (await db
    .insert(forums)
    .values([
      { name: "Sécurité", slug: "securite", position: 1 },
      { name: "Infra", slug: "infra", position: 2 },
    ])
    .returning({ id: forums.id })) as [{ id: number }, { id: number }];
  [{ id: cert }] = (await db
    .insert(sources)
    .values({ forumId: secu, name: "CERT-FR", url: "https://cert.example/feed", lastFetchedAt: at("2026-11-24T09:41:00Z") })
    .returning({ id: sources.id })) as [{ id: number }];
});

describe("startOfParisDay", () => {
  it("is midnight in Paris, in winter (UTC+1) and in summer (UTC+2)", () => {
    expect(startOfParisDay(NOW).toISOString()).toBe("2026-11-23T23:00:00.000Z");
    expect(startOfParisDay(at("2026-07-01T21:59:00Z")).toISOString()).toBe("2026-06-30T22:00:00.000Z");
    // 00:30 in Paris is already the next day there.
    expect(startOfParisDay(at("2026-11-23T23:30:00Z")).toISOString()).toBe("2026-11-23T23:00:00.000Z");
  });

  it("on DST change days", () => {
    expect(startOfParisDay(at("2026-03-29T12:00:00Z")).toISOString()).toBe("2026-03-28T23:00:00.000Z");
    expect(startOfParisDay(at("2026-10-25T12:00:00Z")).toISOString()).toBe("2026-10-24T22:00:00.000Z");
  });
});

describe("getHomeStats", () => {
  it("counts unread topics, topics received since midnight in Paris (arrival, not publication) and the last fetch", async () => {
    await topic({ title: "old-unread" });
    await topic({ title: "old-read", readAt: at("2026-11-21T08:00:00Z") });
    // Published long ago but arrived today: counted.
    await topic({ title: "today", publishedAt: at("2026-01-01T00:00:00Z"), createdAt: at("2026-11-23T23:05:00Z") });
    // Arrived yesterday evening in Paris (22:59 UTC = 23:59 Paris): not counted.
    await topic({ title: "yesterday", createdAt: at("2026-11-23T22:59:00Z") });

    expect(await getHomeStats(db, NOW)).toEqual({
      unreadTotal: 3,
      receivedToday: 1,
      lastFetchAt: at("2026-11-24T09:41:00Z"),
      errorCount: 0,
      sourceCount: 1,
    });
  });

  it("errorCount: sources « En erreur » only, not paused or disabled ones", async () => {
    await db.insert(sources).values([
      { forumId: secu, name: "err", url: "https://a.example/feed", consecutiveFailures: 2 },
      { forumId: secu, name: "err2", url: "https://b.example/feed", consecutiveFailures: 1, pausedUntil: at("2026-11-24T09:00:00Z") },
      { forumId: secu, name: "paused", url: "https://c.example/feed", consecutiveFailures: 3, pausedUntil: at("2026-11-24T11:00:00Z") },
      { forumId: secu, name: "off", url: "https://d.example/feed", consecutiveFailures: 3, enabled: false },
    ]);
    const stats = await getHomeStats(db, NOW);
    expect(stats.errorCount).toBe(2);
    expect(stats.sourceCount).toBe(5);
  });

  it("an empty database", async () => {
    await db.delete(sources);
    expect(await getHomeStats(db, NOW)).toEqual({ unreadTotal: 0, receivedToday: 0, lastFetchAt: null, errorCount: 0, sourceCount: 0 });
  });
});

describe("getLatestUnread", () => {
  it("unread topics of every forum, newest publication first, with their forum", async () => {
    await topic({ title: "a", publishedAt: at("2026-11-22T08:00:00Z") });
    await topic({ title: "b", forumId: infra, sourceId: null, publishedAt: at("2026-11-23T08:00:00Z") });
    await topic({ title: "c", publishedAt: at("2026-11-24T08:00:00Z"), readAt: NOW });
    const rows = await getLatestUnread(db, { limit: 8 });
    expect(rows.map((r) => [r.title, r.forum?.slug, r.sourceName, r.read])).toEqual([
      ["b", "infra", null, false],
      ["a", "securite", "CERT-FR", false],
    ]);
  });

  it("stops at the limit", async () => {
    for (let i = 0; i < 10; i++) await topic({ title: `t${i}`, publishedAt: new Date(Date.UTC(2026, 10, 1 + i)) });
    const rows = await getLatestUnread(db, { limit: 8 });
    expect(rows.map((r) => r.title)).toEqual(["t9", "t8", "t7", "t6", "t5", "t4", "t3", "t2"]);
  });
});

describe("getForumsWithCounts", () => {
  it("forums in admin order with totals, unread counts and their latest topic", async () => {
    await topic({ title: "x", lastActivityAt: at("2026-11-22T08:00:00Z") });
    await topic({ title: "y", lastActivityAt: at("2026-11-23T08:00:00Z"), readAt: NOW });
    const rows = await getForumsWithCounts(db);
    expect(rows.map((f) => [f.slug, f.total, f.unread, f.lastTopic?.title ?? null])).toEqual([
      ["securite", 2, 1, "y"],
      ["infra", 0, 0, null],
    ]);
  });
});

describe("getFeatured (behind FEATURED_ENABLED)", () => {
  it("unread topics picked up by other sources, the most picked up first", async () => {
    const once = await topic({ title: "once", lastActivityAt: at("2026-11-23T08:00:00Z") });
    const twice = await topic({ title: "twice", lastActivityAt: at("2026-11-23T07:00:00Z") });
    const read = await topic({ title: "read", lastActivityAt: at("2026-11-23T08:00:00Z"), readAt: NOW });
    await topic({ title: "alone", lastActivityAt: at("2026-11-23T08:00:00Z") });
    await db.insert(replies).values([
      { topicId: once, type: "source", author: "LWN", content: "" },
      { topicId: twice, type: "source", author: "LWN", content: "" },
      { topicId: twice, type: "source", author: "HN", content: "" },
      { topicId: twice, type: "note", author: "Moi", content: "note" },
      { topicId: read, type: "source", author: "LWN", content: "" },
    ]);
    const rows = await getFeatured(db, { limit: 3, since: at("2026-11-21T00:00:00Z") });
    expect(rows.map((r) => [r.title, r.sourceNames])).toEqual([
      ["twice", ["CERT-FR", "LWN", "HN"]],
      ["once", ["CERT-FR", "LWN"]],
    ]);
  });
});

describe("migration 0006 (topics.created_at)", () => {
  it("fills existing topics with their publication date; new ones get now()", async () => {
    // Database as it was before 0006: journal truncated after 0005.
    const dir = mkdtempSync(path.join(tmpdir(), "veille-mig-"));
    try {
      cpSync(MIGRATIONS, dir, { recursive: true });
      const journalPath = path.join(dir, "meta", "_journal.json");
      const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: { tag: string }[] };
      const upTo = journal.entries.findIndex((e) => e.tag.startsWith("0006_"));
      writeFileSync(journalPath, JSON.stringify({ ...journal, entries: journal.entries.slice(0, upTo) }));

      const pg = new PGlite();
      const old = drizzle(pg);
      await migrate(old, { migrationsFolder: dir });
      await pg.exec(`
        insert into forums (id, name, slug) values (1, 'F', 'f');
        insert into topics (forum_id, title, url, normalized_url, published_at, last_activity_at)
        values (1, 'old', 'u', 'u', '2026-01-02T03:04:05Z', '2026-01-02T03:04:05Z');`);

      await migrate(drizzle(pg, { schema }), { migrationsFolder: MIGRATIONS });
      const after = drizzle(pg, { schema });
      const [old1] = await after.select().from(topics).where(eq(topics.title, "old"));
      expect(old1!.createdAt.toISOString()).toBe("2026-01-02T03:04:05.000Z");

      await pg.exec(`insert into topics (forum_id, title, url, normalized_url, published_at, last_activity_at)
        values (1, 'new', 'v', 'v', '2020-01-01T00:00:00Z', '2020-01-01T00:00:00Z');`);
      const [{ recent } = { recent: false }] = await after
        .select({ recent: sql<boolean>`${topics.createdAt} > now() - interval '1 minute'` })
        .from(topics)
        .where(eq(topics.title, "new"));
      expect(recent).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

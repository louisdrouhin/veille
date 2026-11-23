import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { fetchSource, listDueSources } from "@/lib/feeds/fetch-source";

const { forums, sources, topics } = schema;
const RSS = readFileSync(path.join(import.meta.dirname, "fixtures", "rss2.xml"), "utf8");

let db: Db;

beforeEach(async () => {
  const pg = drizzle(new PGlite(), { schema });
  await migrate(pg, { migrationsFolder: path.join(import.meta.dirname, "..", "drizzle") });
  db = pg as unknown as Db;
  await db.insert(forums).values({ name: "Sécu", slug: "secu", position: 1 });
});

async function addSource(url = "https://secu.example.org/feed.xml") {
  const [forum] = await db.select().from(forums);
  const [source] = await db.insert(sources).values({ forumId: forum!.id, name: "Blog Sécu", url }).returning();
  return source!;
}

const reload = async (id: number) => (await db.select().from(sources).where(eq(sources.id, id)))[0]!;

function fakeFetch(handler: (init: RequestInit | undefined) => Response | Promise<Response>): typeof fetch {
  return (async (_url: string | URL | Request, init?: RequestInit) => handler(init)) as typeof fetch;
}

describe("fetchSource", () => {
  it("first import creates topics already marked as read, and stores cache headers", async () => {
    const source = await addSource();
    const res = await fetchSource(db, source, {
      fetchImpl: fakeFetch(() => new Response(RSS, { headers: { etag: '"v1"', "last-modified": "Mon, 24 Mar 2025 10:00:00 GMT" } })),
    });
    expect(res).toEqual({ status: "ok", inserted: 4, firstImport: true });
    const rows = await db.select().from(topics);
    expect(rows).toHaveLength(4);
    expect(rows.every((t) => t.readAt !== null)).toBe(true);
    expect(rows.every((t) => t.lastActivityAt.getTime() === t.publishedAt.getTime())).toBe(true);

    const updated = await reload(source.id);
    expect(updated).toMatchObject({ etag: '"v1"', lastModified: "Mon, 24 Mar 2025 10:00:00 GMT", consecutiveFailures: 0 });
    expect(updated.lastFetchedAt).not.toBeNull();
  });

  it("later imports create unread topics and skip known URLs (ON CONFLICT DO NOTHING)", async () => {
    const source = await addSource();
    await fetchSource(db, source, { fetchImpl: fakeFetch(() => new Response(RSS)) });

    const extra = RSS.replace(
      "<item>",
      `<item><title>Nouveau</title><link>https://secu.example.org/nouveau?fbclid=1</link></item><item>`,
    );
    const res = await fetchSource(db, await reload(source.id), { fetchImpl: fakeFetch(() => new Response(extra)) });
    expect(res).toEqual({ status: "ok", inserted: 1, firstImport: false });

    const [fresh] = await db.select().from(topics).where(eq(topics.normalizedUrl, "https://secu.example.org/nouveau"));
    expect(fresh?.readAt).toBeNull();
  });

  it("concurrent runs on the same feed do not fail or duplicate", async () => {
    const source = await addSource();
    const other = await addSource("https://mirror.example.org/feed.xml");
    const f = fakeFetch(() => new Response(RSS));
    const results = await Promise.all([fetchSource(db, source, { fetchImpl: f }), fetchSource(db, other, { fetchImpl: f })]);
    expect(results.every((r) => r.status === "ok")).toBe(true);
    // 3 absolute URLs shared by both feeds + the relative link, resolved against each source URL.
    expect(await db.select().from(topics)).toHaveLength(5);
  });

  it("sends conditional headers and handles 304", async () => {
    const source = await addSource();
    await db.update(sources).set({ etag: '"v1"', lastModified: "Mon, 24 Mar 2025 10:00:00 GMT", lastFetchedAt: new Date() });
    let sent: Headers | undefined;
    const res = await fetchSource(db, await reload(source.id), {
      fetchImpl: fakeFetch((init) => {
        sent = new Headers(init?.headers);
        return new Response(null, { status: 304 });
      }),
    });
    expect(res).toEqual({ status: "not-modified" });
    expect(sent?.get("if-none-match")).toBe('"v1"');
    expect(sent?.get("if-modified-since")).toBe("Mon, 24 Mar 2025 10:00:00 GMT");
    expect(sent?.get("user-agent")).toMatch(/^FoldersRSS\/1\.0 /);
    expect((await reload(source.id)).etag).toBe('"v1"');
  });

  it("pauses the source for 1 h after 3 consecutive failures, then resets on success", async () => {
    const source = await addSource();
    const now = new Date("2026-03-01T10:00:00Z");
    const failing = fakeFetch(() => new Response("nope", { status: 503, statusText: "Service Unavailable" }));

    for (let i = 1; i <= 3; i++) {
      const res = await fetchSource(db, await reload(source.id), { fetchImpl: failing, now });
      expect(res).toEqual({ status: "error", error: "HTTP 503 Service Unavailable", paused: i === 3 });
    }
    const paused = await reload(source.id);
    expect(paused.consecutiveFailures).toBe(3);
    expect(paused.lastError).toBe("HTTP 503 Service Unavailable");
    expect(paused.pausedUntil?.toISOString()).toBe("2026-03-01T11:00:00.000Z");

    expect(await listDueSources(db, new Date("2026-03-01T10:30:00Z"))).toHaveLength(0);
    expect(await listDueSources(db, new Date("2026-03-01T11:00:01Z"))).toHaveLength(1);

    await fetchSource(db, paused, { fetchImpl: fakeFetch(() => new Response(RSS)) });
    expect(await reload(source.id)).toMatchObject({ consecutiveFailures: 0, lastError: null, pausedUntil: null });
  });

  it("reports invalid feeds and network errors", async () => {
    const source = await addSource();
    const bad = await fetchSource(db, source, { fetchImpl: fakeFetch(() => new Response("<html>nope</html>")) });
    expect(bad.status === "error" && bad.error.startsWith("Flux invalide")).toBe(true);

    const net = await fetchSource(db, await reload(source.id), {
      fetchImpl: fakeFetch(() => {
        throw new TypeError("fetch failed", { cause: new Error("getaddrinfo ENOTFOUND") });
      }),
    });
    expect(net).toMatchObject({ status: "error", error: "Erreur réseau : fetch failed (getaddrinfo ENOTFOUND)" });
  });

  it("skips disabled sources", async () => {
    const source = await addSource();
    await db.update(sources).set({ enabled: false }).where(eq(sources.id, source.id));
    expect(await listDueSources(db)).toHaveLength(0);
  });

  it("deleting a source keeps its topics (source_id set to null)", async () => {
    const source = await addSource();
    await fetchSource(db, source, { fetchImpl: fakeFetch(() => new Response(RSS)) });
    await db.delete(sources).where(eq(sources.id, source.id));
    const rows = await db.select().from(topics);
    expect(rows).toHaveLength(4);
    expect(rows.every((t) => t.sourceId === null)).toBe(true);
  });
});

describe("feed User-Agent", () => {
  it("defaults to FoldersRSS/1.0 when FETCH_USER_AGENT is unset or empty (docker-compose.yml passes \"\")", async () => {
    for (const value of [undefined, ""]) {
      vi.resetModules();
      vi.stubEnv("FETCH_USER_AGENT", value);
      const mod = await import("@/lib/feeds/fetch-source");
      expect(mod.USER_AGENT).toBe(mod.DEFAULT_USER_AGENT);
      expect(mod.USER_AGENT).toMatch(/^FoldersRSS\/1\.0 /);
    }
    vi.resetModules();
    vi.stubEnv("FETCH_USER_AGENT", "Custom/2");
    expect((await import("@/lib/feeds/fetch-source")).USER_AGENT).toBe("Custom/2");
    vi.unstubAllEnvs();
  });
});

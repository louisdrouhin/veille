import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { downloadFavicon, FAVICON_TTL_MS, findIconLinks, refreshFavicon, sniffImage } from "@/lib/feeds/favicon";
import type { Resolver } from "@/lib/net/safe-fetch";

const { forums, sources, sourceFavicons, topics } = schema;

// 1×1 transparent PNG
const PNG = Uint8Array.from(
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"),
);
const ICO = Uint8Array.from([0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x10, 0x10]);

type Routes = Record<string, () => Response>;
function fakeFetch(routes: Routes, calls: string[] = []): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const route = routes[url];
    return route ? route() : new Response("not found", { status: 404 });
  }) as typeof fetch;
}
// Every test host "resolves" to a public documentation-free address (no real DNS in unit tests).
const PUBLIC: Resolver = async () => [{ address: "93.184.215.14", family: 4 }];
const opts = (f: typeof fetch) => ({ resolve: PUBLIC, fetchImpl: f });

const html = (body: string) => () => new Response(body, { headers: { "content-type": "text/html" } });
const bytes = (data: Uint8Array) => () => new Response(Buffer.from(data));

describe("sniffImage", () => {
  it("recognizes raster formats", () => {
    expect(sniffImage(PNG)).toBe("image/png");
    expect(sniffImage(ICO)).toBe("image/x-icon");
    expect(sniffImage(Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBe("image/gif");
    expect(sniffImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
  });

  it("rejects SVG, HTML and garbage", () => {
    expect(sniffImage(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull();
    expect(sniffImage(new TextEncoder().encode("<!doctype html><html>"))).toBeNull();
    expect(sniffImage(new Uint8Array())).toBeNull();
  });
});

describe("findIconLinks", () => {
  it("ranks icon links and resolves relative URLs", () => {
    const page = `<head>
      <link rel="apple-touch-icon" href="/touch.png">
      <link rel="shortcut icon" href='/old.ico'>
      <link rel="icon" type="image/png" sizes="32x32" href="icons/32.png?v=2&amp;x=1">
      <link rel="icon" href="/logo.svg">
      <link rel="stylesheet" href="/style.css">
    </head>`;
    expect(findIconLinks(page, "https://blog.example.org/")).toEqual([
      "https://blog.example.org/icons/32.png?v=2&x=1",
      "https://blog.example.org/old.ico",
      "https://blog.example.org/touch.png",
    ]);
  });
});

describe("downloadFavicon", () => {
  it("uses the icon declared in the home page", async () => {
    const icon = await downloadFavicon("https://blog.example.org/2026/article", opts(fakeFetch({
        "https://blog.example.org/": html('<link rel="icon" href="/img/fav.png">'),
        "https://blog.example.org/img/fav.png": bytes(PNG),
      })),
    );
    expect(icon?.contentType).toBe("image/png");
    expect(icon?.data).toEqual(PNG);
  });

  it("falls back to /favicon.ico and skips non-images", async () => {
    const icon = await downloadFavicon("https://blog.example.org/a", opts(fakeFetch({
        "https://blog.example.org/": html('<link rel="icon" href="/fake.png">'),
        "https://blog.example.org/fake.png": html("<html>soft 404</html>"),
        "https://blog.example.org/favicon.ico": bytes(ICO),
      })),
    );
    expect(icon?.contentType).toBe("image/x-icon");
  });

  it("returns null when nothing usable exists, and rejects oversized files", async () => {
    expect(await downloadFavicon("https://none.example.org/", opts(fakeFetch({})))).toBeNull();
    const big = new Uint8Array(200 * 1024);
    big.set(PNG);
    expect(await downloadFavicon("https://big.example.org/", opts(fakeFetch({ "https://big.example.org/favicon.ico": bytes(big) })))).toBeNull();
  });
});

describe("refreshFavicon", () => {
  let db: Db;
  let source: schema.Source;

  beforeEach(async () => {
    const pg = drizzle(new PGlite(), { schema });
    await migrate(pg, { migrationsFolder: path.join(import.meta.dirname, "..", "drizzle") });
    db = pg as unknown as Db;
    const [forum] = await db.insert(forums).values({ name: "Sécu", slug: "secu" }).returning();
    [source] = (await db.insert(sources).values({ forumId: forum!.id, name: "Blog", url: "https://feeds.example.net/blog.xml" }).returning()) as [schema.Source];
  });

  const stored = async () => (await db.select().from(sourceFavicons).where(eq(sourceFavicons.sourceId, source.id)))[0];

  it("uses the site of the latest article rather than the feed host", async () => {
    await db.insert(topics).values({
      forumId: source.forumId,
      sourceId: source.id,
      title: "t",
      url: "https://blog.example.org/post",
      normalizedUrl: "https://blog.example.org/post",
      publishedAt: new Date(),
      lastActivityAt: new Date(),
    });
    const calls: string[] = [];
    const res = await refreshFavicon(db, source, { resolve: PUBLIC, fetchImpl: fakeFetch({ "https://blog.example.org/favicon.ico": bytes(ICO) }, calls) });
    expect(res).toBe("stored");
    expect(calls.every((u) => u.startsWith("https://blog.example.org/"))).toBe(true);
    const row = await stored();
    expect(row?.contentType).toBe("image/x-icon");
    expect(Uint8Array.from(row!.data!)).toEqual(ICO);
  });

  it("stores « none », skips while fresh, retries after 7 days", async () => {
    const now = new Date("2026-11-01T10:00:00Z");
    expect(await refreshFavicon(db, source, { now, resolve: PUBLIC, fetchImpl: fakeFetch({}) })).toBe("none");
    expect((await stored())?.data).toBeNull();

    const later = new Date(now.getTime() + FAVICON_TTL_MS - 60_000);
    const routes = { "https://feeds.example.net/favicon.ico": bytes(PNG) };
    expect(await refreshFavicon(db, source, { now: later, resolve: PUBLIC, fetchImpl: fakeFetch(routes) })).toBe("fresh");

    const afterTtl = new Date(now.getTime() + FAVICON_TTL_MS + 60_000);
    expect(await refreshFavicon(db, source, { now: afterTtl, resolve: PUBLIC, fetchImpl: fakeFetch(routes) })).toBe("stored");
    expect((await stored())?.fetchedAt).toEqual(afterTtl);
  });

  it("is deleted with its source", async () => {
    await refreshFavicon(db, source, { resolve: PUBLIC, fetchImpl: fakeFetch({ "https://feeds.example.net/favicon.ico": bytes(PNG) }) });
    await db.delete(sources).where(eq(sources.id, source.id));
    expect(await db.select().from(sourceFavicons)).toHaveLength(0);
  });
});

import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { fetchSource } from "@/lib/feeds/fetch-source";
import type { Resolver } from "@/lib/net/safe-fetch";
import { FAILURE_RETRY_MS, getArticle, reloadArticle } from "@/lib/reader/article";
import { ARTICLE_RETENTION_MS, purgeArticleContents } from "@/lib/reader/store";
import { articlePage, PARA } from "./helpers/article-page";

const { articleContents, forums, sources, topics } = schema;
const publicDns: Resolver = async () => [{ address: "93.184.215.14", family: 4 }];
const NOW = new Date("2025-06-01T12:00:00Z");

let db: Db;
let topic: { id: number; url: string };

beforeEach(async () => {
  const pg = drizzle(new PGlite(), { schema });
  await migrate(pg, { migrationsFolder: path.join(import.meta.dirname, "..", "drizzle") });
  db = pg as unknown as Db;
  const [forum] = await db.insert(forums).values({ name: "Ops", slug: "ops" }).returning();
  const [row] = await db
    .insert(topics)
    .values({
      forumId: forum!.id,
      title: "Mon article",
      url: "https://blog.example.org/2025/mon-article",
      normalizedUrl: "https://blog.example.org/2025/mon-article",
      publishedAt: NOW,
      lastActivityAt: NOW,
    })
    .returning();
  topic = { id: row!.id, url: row!.url };
});

function transport(handler: () => Response) {
  let calls = 0;
  const fetchImpl = (async () => {
    calls++;
    return handler();
  }) as unknown as typeof fetch;
  return { fetchImpl, calls: () => calls };
}
const page = (body?: string) => () => new Response(articlePage(body), { headers: { "content-type": "text/html" } });
const status = (code: number) => () => new Response("nope", { status: code, headers: { "content-type": "text/html" } });
const rows = () => db.select().from(articleContents);

describe("getArticle", () => {
  it("extracts the page on the first opening and caches it", async () => {
    const t = transport(page());
    const article = await getArticle(db, topic, { resolve: publicDns, fetchImpl: t.fetchImpl, now: NOW });
    expect(article).toMatchObject({ topicId: topic.id, source: "readability", error: null });
    expect(article.html).toContain("Proxmox VE 9");

    const again = await getArticle(db, topic, { resolve: publicDns, fetchImpl: t.fetchImpl, now: NOW });
    expect(again.html).toBe(article.html);
    expect(t.calls()).toBe(1);
  });

  it("caches a failure (403, paywall) and retries it only after a day", async () => {
    const forbidden = transport(status(403));
    const failed = await getArticle(db, topic, { resolve: publicDns, fetchImpl: forbidden.fetchImpl, now: NOW });
    expect(failed).toMatchObject({ html: null, source: "readability", error: "HTTP 403" });

    const later = new Date(NOW.getTime() + FAILURE_RETRY_MS - 1000);
    await getArticle(db, topic, { resolve: publicDns, fetchImpl: forbidden.fetchImpl, now: later });
    expect(forbidden.calls()).toBe(1);

    const ok = transport(page());
    const retried = await getArticle(db, topic, {
      resolve: publicDns,
      fetchImpl: ok.fetchImpl,
      now: new Date(NOW.getTime() + FAILURE_RETRY_MS + 1000),
    });
    expect(retried.html).toContain("Proxmox VE 9");
    expect(await rows()).toHaveLength(1);
  });

  it("stores an empty extraction as a failure", async () => {
    const t = transport(page("<p>Contenu réservé aux abonnés.</p>"));
    const article = await getArticle(db, topic, { resolve: publicDns, fetchImpl: t.fetchImpl, now: NOW });
    expect(article.html).toBeNull();
    expect(article.error).toMatch(/Extraction vide|Aucun article/);
  });
});

describe("reloadArticle", () => {
  it("replaces the cached content when the extraction succeeds", async () => {
    await getArticle(db, topic, { resolve: publicDns, fetchImpl: transport(status(500)).fetchImpl, now: NOW });
    const res = await reloadArticle(db, topic, { resolve: publicDns, fetchImpl: transport(page()).fetchImpl, now: NOW });
    expect(res.ok).toBe(true);
    expect(res.article?.html).toContain("Proxmox VE 9");
  });

  it("keeps existing content (e.g. from the feed) when the extraction fails", async () => {
    await db.insert(articleContents).values({ topicId: topic.id, html: "<p>Contenu du flux</p>", source: "feed", fetchedAt: NOW });
    const res = await reloadArticle(db, topic, { resolve: publicDns, fetchImpl: transport(status(403)).fetchImpl, now: NOW });
    expect(res).toMatchObject({ ok: false, error: "HTTP 403", article: { html: "<p>Contenu du flux</p>", source: "feed" } });
    expect((await rows())[0]).toMatchObject({ html: "<p>Contenu du flux</p>", source: "feed" });
  });
});

describe("purgeArticleContents", () => {
  it("deletes rows fetched more than 90 days ago", async () => {
    const [other] = await db
      .insert(topics)
      .values({ forumId: (await db.select().from(forums))[0]!.id, title: "b", url: "https://b.example.org/", normalizedUrl: "https://b.example.org", publishedAt: NOW, lastActivityAt: NOW })
      .returning();
    await db.insert(articleContents).values([
      { topicId: topic.id, html: "<p>vieux</p>", source: "feed", fetchedAt: new Date(NOW.getTime() - ARTICLE_RETENTION_MS - 1000) },
      { topicId: other!.id, html: "<p>récent</p>", source: "readability", fetchedAt: new Date(NOW.getTime() - ARTICLE_RETENTION_MS + 60_000) },
    ]);
    expect(await purgeArticleContents(db, NOW)).toBe(1);
    expect((await rows()).map((r) => r.topicId)).toEqual([other!.id]);
  });

  it("rows go away with their topic", async () => {
    await db.insert(articleContents).values({ topicId: topic.id, html: "<p>x</p>", source: "feed", fetchedAt: NOW });
    await db.delete(topics).where(eq(topics.id, topic.id));
    expect(await rows()).toHaveLength(0);
  });
});

describe("feed content stored at import", () => {
  const LONG = `<p>${PARA.repeat(8)}</p><script>alert(1)</script><img src="/img/a.png" onerror="x()">`;

  async function importFeed(xml: string, url = "https://feeds.example.org/feed.xml") {
    const [forum] = await db.select().from(forums);
    const [source] = await db.insert(sources).values({ forumId: forum!.id, name: "Feed", url }).returning();
    const res = await fetchSource(db, source!, { now: NOW, fetchImpl: (async () => new Response(xml)) as unknown as typeof fetch });
    expect(res.status).toBe("ok");
    return db
      .select({ url: topics.url, html: articleContents.html, source: articleContents.source })
      .from(articleContents)
      .innerJoin(topics, eq(topics.id, articleContents.topicId));
  }

  it("RSS: content:encoded is sanitized and stored, a short teaser is not", async () => {
    const stored = await importFeed(`<?xml version="1.0"?>
      <rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>t</title>
        <item><title>Complet</title><link>https://feeds.example.org/complet</link>
          <description>Résumé court</description><content:encoded><![CDATA[${LONG}]]></content:encoded></item>
        <item><title>Teaser</title><link>https://feeds.example.org/teaser</link>
          <content:encoded><![CDATA[<p>Lire la suite…</p>]]></content:encoded></item>
        <item><title>Description seule</title><link>https://feeds.example.org/desc</link>
          <description><![CDATA[${LONG}]]></description></item>
      </channel></rss>`);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ url: "https://feeds.example.org/complet", source: "feed" });
    expect(stored[0]!.html).toContain("Proxmox VE 9");
    expect(stored[0]!.html).not.toMatch(/<script|onerror/);
    expect(stored[0]!.html).toContain(encodeURIComponent("https://feeds.example.org/img/a.png"));
  });

  it("Atom: <content> is stored, <summary> is not", async () => {
    const stored = await importFeed(`<?xml version="1.0" encoding="utf-8"?>
      <!-- generated -->
      <feed xmlns="http://www.w3.org/2005/Atom"><title>t</title><id>urn:f</id><updated>2025-05-01T00:00:00Z</updated>
        <entry><title>Avec contenu</title><link href="https://atom.example.org/a"/><id>urn:a</id><updated>2025-05-01T00:00:00Z</updated>
          <content type="html">${LONG.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</content></entry>
        <entry><title>Résumé seul</title><link href="https://atom.example.org/b"/><id>urn:b</id><updated>2025-05-01T00:00:00Z</updated>
          <summary>${PARA.repeat(8)}</summary></entry>
      </feed>`, "https://atom.example.org/feed.atom");
    expect(stored.map((s) => s.url)).toEqual(["https://atom.example.org/a"]);
    expect(stored[0]!.html).not.toMatch(/<script|onerror/);
  });
});

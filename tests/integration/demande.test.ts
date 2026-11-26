/**
 * « Demande à ta veille » (3.3) through the production driver (postgres-js) on a real PostgreSQL 17: full text and
 * folding function, daily usage, indexing, exact and semantic search, fusion, « Séparer », related topics.
 * PGlite accepts values postgres-js rejects (a Date inside a raw sql`` fragment broke the fusion once).
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { startPostgres, type TestDatabase } from "./helpers/postgres";

vi.mock("server-only", () => ({}));
const { EMBEDDING_DIM } = await import("@/lib/ai/embeddings");
const { NO_FILTERS } = await import("@/lib/search/filters");
const { indexPending, refreshArticleTexts } = await import("@/lib/search/indexer");
const { exactSearch, quickSuggestions, semanticSearch } = await import("@/lib/search/query");
const { reserve, usedToday } = await import("@/lib/search/usage");
const { mergePending, relatedTopicIds, separateReprise, undoSeparate } = await import("@/lib/merge/fusion");
const { getFeatured, getLatestUnread } = await import("@/lib/home");

/** Fake Gemini: texts mentioning OpenSSH point one way, the others another. */
const gemini = (async (_u: string, init: RequestInit) => {
  const { requests } = JSON.parse(String(init.body)) as { requests: { content: { parts: { text: string }[] } }[] };
  return Response.json({
    embeddings: requests.map((r) => {
      const v = new Array(EMBEDDING_DIM).fill(0);
      v[/openssh/i.test(r.content.parts[0]!.text) ? 0 : 1] = 1;
      return { values: v };
    }),
  });
}) as unknown as typeof fetch;
const AI = { apiKey: "k", model: "m", translateModel: "t" };

describe("Demande à ta veille (real PostgreSQL, postgres-js)", () => {
  let pg: TestDatabase;
  let db: Db;
  let first = 0;
  let dup = 0;

  beforeAll(async () => {
    pg = await startPostgres();
    db = drizzle(pg.sql, { schema }) as unknown as Db;
    const [forum] = await db.insert(schema.forums).values({ name: "Sécurité", slug: "securite" }).returning();
    const s = await db
      .insert(schema.sources)
      .values([
        { forumId: forum!.id, name: "CERT-FR", url: "https://cert.example/feed" },
        { forumId: forum!.id, name: "BleepingComputer", url: "https://bc.example/feed" },
      ])
      .returning();
    const now = Date.now();
    const rows = await db
      .insert(schema.topics)
      .values([
        { title: "Vulnérabilité critique dans OpenSSH", excerpt: "Exécution de code à distance.", src: 0, h: 10, checked: true },
        { title: "Kubernetes 1.36 est sorti", excerpt: "Nouveautés.", src: 0, h: 20, checked: true },
        { title: "Critical OpenSSH flaw", excerpt: "Remote code execution in OpenSSH.", src: 1, h: 1, checked: false },
      ].map((t, i) => ({
        forumId: forum!.id,
        sourceId: s[t.src]!.id,
        title: t.title,
        excerpt: t.excerpt,
        url: `https://ex.example/${i}`,
        normalizedUrl: `https://ex.example/${i}`,
        publishedAt: new Date(now - t.h * 3_600_000),
        lastActivityAt: new Date(now - t.h * 3_600_000),
        createdAt: new Date(now - t.h * 3_600_000),
        mergeCheckedAt: t.checked ? new Date(now - t.h * 3_600_000) : null,
      })))
      .returning({ id: schema.topics.id });
    first = rows[0]!.id;
    dup = rows[2]!.id;
    await db.insert(schema.articleContents).values({ topicId: first, html: "<p>Les correctifs sont disponibles.</p>", source: "feed", fetchedAt: new Date() });
    await db.insert(schema.replies).values({ topicId: rows[1]!.id, type: "note", author: "Moi", content: "Penser à migrer le cluster" });
  }, 180_000);

  afterAll(async () => {
    await pg?.stop();
  });

  it("daily usage, article text, indexing", async () => {
    expect(await reserve(db, "ask", 2, 3)).toBe(2);
    expect(await reserve(db, "ask", 2, 3)).toBe(1);
    expect(await usedToday(db, "ask")).toBe(3);
    expect(await refreshArticleTexts(db)).toBe(1);
    expect(await indexPending(db, { ai: AI, env: {}, fetch: gemini })).toEqual({ indexed: 3 });
  });

  it("exact search (folded, notes), suggestions, search by meaning", async () => {
    const r = await exactSearch(db, "vulnerabilite", NO_FILTERS, { now: new Date() });
    expect(r.topics.map((t) => t.id)).toEqual([first]);
    expect((await exactSearch(db, "correctifs", NO_FILTERS)).topicTotal).toBe(1);
    expect((await exactSearch(db, "migrer", { ...NO_FILTERS, period: "7j" })).notes).toHaveLength(1);
    expect((await quickSuggestions(db, "kuber")).topics).toHaveLength(1);
    const sem = await semanticSearch(db, "openssh", { ...NO_FILTERS, period: "30j" }, new Set([first]), { ai: AI, env: {}, fetch: gemini });
    expect(sem).toMatchObject({ status: "ok" });
    expect(sem.topics.map((t) => t.id)).toEqual([dup]);
  });

  it("fusion, « À la une », « Séparer » and « Annuler », related topics", async () => {
    expect(await mergePending(db, { env: {} })).toEqual({ checked: 1, merged: 1 });
    const [t] = await db.select().from(schema.topics).where(eq(schema.topics.id, first));
    expect(t).toMatchObject({ replyCount: 1, readAt: null });
    const featured = await getFeatured(db, { limit: 4, since: new Date(Date.now() - 48 * 3_600_000) });
    expect(featured.map((f) => [f.id, f.sourceNames])).toEqual([[first, ["CERT-FR", "BleepingComputer"]]]);
    expect((await getLatestUnread(db, { limit: 8, exclude: [first] })).map((x) => x.id)).not.toContain(first);
    const [r] = await db.select().from(schema.replies).where(eq(schema.replies.topicId, first));
    const sep = (await separateReprise(db, r!.id))!;
    expect(await relatedTopicIds(db, first, { env: {} })).toEqual([sep.topicId]);
    expect(await undoSeparate(db, sep.topicId, first)).toBe(true);
    expect((await db.select().from(schema.topics).where(eq(schema.topics.id, first)))[0]!.replyCount).toBe(1);
  });
});

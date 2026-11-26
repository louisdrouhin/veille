/**
 * Search index of « Demande à ta veille » (docs/design/3.3 § 1): accent folding identical in SQL and JS,
 * French and English full text, the notes kept local (never in a request to the model), embeddings by
 * batches within the daily limit, reindexing when the article or the model changes.
 */
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import { documentText, EMBEDDING_DIM, embedTexts, queryText } from "@/lib/ai/embeddings";
import type { Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { fold, FOLD_FROM } from "@/lib/search/fold";
import { indexPending, indexProgress, refreshArticleTexts } from "@/lib/search/indexer";
import { dailyLimit, reserve, release, usedToday } from "@/lib/search/usage";
import { decodeVector, encodeVector, loadCorpus, nearest } from "@/lib/search/vectors";

let db: Db;
const AI = { apiKey: "test-key", model: "gemini-x", translateModel: "gemini-y" };
const NOTE = "Mot de passe du NAS : hunter2, ne jamais partager";

beforeEach(async () => {
  const pg = drizzle(new PGlite(), { schema });
  await migrate(pg, { migrationsFolder: path.join(import.meta.dirname, "..", "drizzle") });
  db = pg as unknown as Db;
  const [forum] = await db.insert(schema.forums).values({ name: "Infra", slug: "infra" }).returning();
  const now = Date.now();
  await db.insert(schema.topics).values(
    [
      { title: "Sécurité des réseaux d'entreprise", excerpt: "Les pare-feux évoluent." },
      { title: "Proxmox Backup Server 4 released", excerpt: "New features for backups." },
      { title: "Kubernetes : les nouveautés", excerpt: "" },
    ].map((t, i) => ({
      ...t,
      forumId: forum!.id,
      url: `https://example.com/${i}`,
      normalizedUrl: `example.com/${i}`,
      publishedAt: new Date(now - i * 60_000),
      lastActivityAt: new Date(now - i * 60_000),
    })),
  );
  const ids = (await db.select({ id: schema.topics.id }).from(schema.topics)).map((r) => r.id).sort();
  await db.insert(schema.replies).values({ topicId: ids[0]!, type: "note", author: "Moi", content: NOTE });
  await db.insert(schema.articleContents).values({ topicId: ids[1]!, html: "<p>Sauvegardes incrémentales <b>chiffrées</b>.</p>", source: "feed", fetchedAt: new Date(now) });
});

/** A fake Gemini: one deterministic vector per text, every request body kept. */
function fakeGemini(opts: { status?: number } = {}) {
  const bodies: string[] = [];
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    bodies.push(String(init.body));
    if (opts.status) return new Response("{}", { status: opts.status });
    const { requests } = JSON.parse(String(init.body)) as { requests: { content: { parts: { text: string }[] } }[] };
    return Response.json({
      embeddings: requests.map((r) => ({ values: Array.from({ length: EMBEDDING_DIM }, (_, i) => ((r.content.parts[0]!.text.length * (i + 1)) % 7) + 1) })),
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, bodies };
}

describe("accent folding", () => {
  it("the SQL function folds exactly like the JS one, one character for one", async () => {
    const sample = `${FOLD_FROM} Élève À l'ŒUVRE: Ça marche — 42 ÉTÉ`;
    const res = await db.execute(sql`select folders_fold(${sample}) as f`);
    const sqlFolded = (res as unknown as { rows: { f: string }[] }).rows[0]!.f;
    expect(sqlFolded).toBe(fold(sample));
    expect(fold(sample)).toHaveLength(sample.length);
    expect(fold("Sécurité ÉTÉ")).toBe("securite ete");
  });
});

describe("exact search vectors", () => {
  const match = async (table: "topics" | "article_contents" | "replies", q: string) => {
    const res = await db.execute(
      sql`select count(*)::int as n from ${sql.raw(table)} where search_tsv @@ (websearch_to_tsquery('french', folders_fold(${q})) || websearch_to_tsquery('english', folders_fold(${q})))`,
    );
    return (res as unknown as { rows: { n: number }[] }).rows[0]!.n;
  };

  it("French and English, without accents, with stemming", async () => {
    expect(await match("topics", "securite")).toBe(1);
    expect(await match("topics", "réseau")).toBe(1); // « réseaux » stemmed
    expect(await match("topics", "backup")).toBe(1); // « backups »
    expect(await match("topics", '"backup server"')).toBe(1);
    expect(await match("topics", "nouveaute kubernetes")).toBe(1);
  });

  it("the article text once made, and the notes only among the replies", async () => {
    expect(await match("article_contents", "chiffrees")).toBe(0);
    expect(await refreshArticleTexts(db)).toBe(1);
    expect(await match("article_contents", "chiffrées")).toBe(1);
    expect(await refreshArticleTexts(db)).toBe(0); // done once per article version
    expect(await match("replies", "hunter2")).toBe(1);
    const [topic] = await db.select({ id: schema.topics.id }).from(schema.topics).limit(1);
    await db.insert(schema.replies).values({ topicId: topic!.id, type: "comment", author: "x", content: "hunter2 en commentaire" });
    expect(await match("replies", "hunter2")).toBe(1); // a comment is not indexed as a note
  });
});

describe("embeddings", () => {
  it("formats documents and queries as the docs advise", () => {
    expect(documentText("Titre | x", "Corps\n  long")).toBe("title: Titre / x | text: Corps long");
    expect(documentText("", "abc")).toBe("title: none | text: abc");
    expect(queryText("proxmox ?")).toBe("task: search result | query: proxmox ?");
  });

  it("parses and normalizes the vectors, refuses a short answer", async () => {
    const { fetchImpl } = fakeGemini();
    const r = await embedTexts({ apiKey: "k", model: "gemini-embedding-2", texts: ["a", "bb"], fetch: fetchImpl });
    expect(r.ok).toBe(true);
    const v = (r as { vectors: Float32Array[] }).vectors[0]!;
    expect(Math.hypot(...v)).toBeCloseTo(1, 5);
    expect(decodeVector(encodeVector(v))).toEqual(v);
    const short = (async () => Response.json({ embeddings: [{ values: [1, 2] }] })) as unknown as typeof fetch;
    expect(await embedTexts({ apiKey: "k", model: "m", texts: ["a"], fetch: short })).toEqual({ ok: false, error: "failed" });
    expect(await embedTexts({ apiKey: "k", model: "m", texts: ["a"], fetch: fakeGemini({ status: 429 }).fetchImpl })).toMatchObject({ ok: false, error: "quota" });
  });

  it("indexes every topic, never sends a note, then has nothing left to do", async () => {
    await refreshArticleTexts(db);
    const { fetchImpl, bodies } = fakeGemini();
    const r = await indexPending(db, { ai: AI, env: {}, fetch: fetchImpl });
    expect(r).toEqual({ indexed: 3 });
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain("Sauvegardes incrémentales chiffrées");
    for (const b of bodies) expect(b).not.toContain("hunter2");
    expect(await indexProgress(db, {})).toMatchObject({ indexed: 3, total: 3, model: "gemini-embedding-2" });
    expect(await indexPending(db, { ai: AI, env: {}, fetch: fetchImpl })).toEqual({ indexed: 0 });
    // Without a Gemini key: nothing, no call.
    expect(await indexPending(db, { ai: null, env: {}, fetch: fetchImpl })).toEqual({ indexed: 0 });
    expect(bodies).toHaveLength(1);
  });

  it("indexes again a reloaded article, and everything for another model", async () => {
    await refreshArticleTexts(db);
    const { fetchImpl, bodies } = fakeGemini();
    await indexPending(db, { ai: AI, env: {}, fetch: fetchImpl });
    const [art] = await db.select().from(schema.articleContents);
    await db.update(schema.articleContents).set({ html: "<p>Nouvelle version</p>", fetchedAt: new Date(art!.fetchedAt.getTime() + 1000) });
    await refreshArticleTexts(db);
    expect(await indexPending(db, { ai: AI, env: {}, fetch: fetchImpl })).toEqual({ indexed: 1 });
    expect(bodies.at(-1)).toContain("Nouvelle version");
    expect(await indexPending(db, { ai: AI, env: { GEMINI_EMBEDDING_MODEL: "gemini-embedding-3" }, fetch: fetchImpl })).toEqual({ indexed: 3 });
    expect(await indexProgress(db, {})).toMatchObject({ indexed: 0 });
  });

  it("stops at the daily limit, and gives back what a failed call did not use", async () => {
    const { fetchImpl } = fakeGemini();
    expect(await indexPending(db, { ai: AI, env: { EMBED_DAILY_LIMIT: "2" }, fetch: fetchImpl })).toEqual({ indexed: 2, error: "limit" });
    expect(await indexPending(db, { ai: AI, env: { EMBED_DAILY_LIMIT: "2" }, fetch: fetchImpl })).toEqual({ indexed: 0, error: "limit" });
    expect(await usedToday(db, "embed")).toBe(2);
    const failing = fakeGemini({ status: 503 });
    expect(await indexPending(db, { ai: AI, env: { EMBED_DAILY_LIMIT: "10" }, fetch: failing.fetchImpl })).toEqual({ indexed: 0, error: "unavailable" });
    expect(await usedToday(db, "embed")).toBe(2);
  });

  it("finds the nearest topics in the corpus kept in memory", async () => {
    const { fetchImpl } = fakeGemini();
    await indexPending(db, { ai: AI, env: {}, fetch: fetchImpl });
    const corpus = await loadCorpus(db, "gemini-embedding-2");
    expect(corpus.ids).toHaveLength(3);
    const first = corpus.vectors[0]!;
    const best = nearest(corpus, first, { limit: 2 });
    expect(best[0]).toMatchObject({ topicId: corpus.ids[0], score: expect.closeTo(1, 5) });
    expect(nearest(corpus, first, { limit: 5, exclude: new Set([corpus.ids[0]!]) }).map((n) => n.topicId)).not.toContain(corpus.ids[0]);
    // Same table: the same cached corpus.
    expect(await loadCorpus(db, "gemini-embedding-2")).toBe(corpus);
  });
});

describe("daily usage", () => {
  it("an empty variable (docker-compose, unset) means the default, not 0", () => {
    expect(dailyLimit("embed", { EMBED_DAILY_LIMIT: "" })).toBe(1000);
    expect(dailyLimit("ask", { ASK_DAILY_LIMIT: "  " })).toBe(50);
    expect(dailyLimit("ask", {})).toBe(50);
    expect(dailyLimit("embed", { EMBED_DAILY_LIMIT: "0" })).toBe(0);
    expect(dailyLimit("embed", { EMBED_DAILY_LIMIT: "300" })).toBe(300);
    expect(dailyLimit("embed", { EMBED_DAILY_LIMIT: "beaucoup" })).toBe(1000);
  });

  it("grants up to the limit, shared, and gives back", async () => {
    expect(await reserve(db, "ask", 3, 5)).toBe(3);
    expect(await reserve(db, "ask", 3, 5)).toBe(2);
    expect(await reserve(db, "ask", 1, 5)).toBe(0);
    await release(db, "ask", 2);
    expect(await usedToday(db, "ask")).toBe(3);
    expect(await reserve(db, "embed", 4, 5)).toBe(4);
    const rows = await db.select().from(schema.aiUsage).where(eq(schema.aiUsage.kind, "ask"));
    expect(rows).toHaveLength(1);
  });
});

/**
 * Fusion of duplicates, « À la une » and « Sujets proches » (docs/design/3.3 § 2, 6): a close new article becomes a
 * reprise of a topic of the last 72 h (which goes up and is unread again), never when it should not; a feed returning
 * it does not recreate it; « Séparer » and its « Annuler »; the summary covers every source, never a note.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EMBEDDING_DIM, normalize } from "@/lib/ai/embeddings";
import type { Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";

vi.mock("server-only", () => ({}));

const { DEFAULT_MERGE_THRESHOLD, mergePending, mergeThreshold, relatedTopicIds, separateReprise, topicVector, undoSeparate } = await import("@/lib/merge/fusion");
const { fetchSource } = await import("@/lib/feeds/fetch-source");
const { encodeVector } = await import("@/lib/search/vectors");
const { generateAi, repriseBlock } = await import("@/lib/ai/service");
const { validateSetting } = await import("@/lib/secrets/write");

const { aiOutputs, articleContents, articleEmbeddings, forums, mergeBlocks, replies, replyEmbeddings, sources, topics } = schema;
const MODEL = "gemini-embedding-2";
const NOW = new Date("2026-11-25T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

let db: Db;
let forumId: number;
let src: Record<string, number> = {};

/** A vector along axis `a`, leaning towards axis `b` by `w` (similarity with axis a ≈ 1 / √(1 + w²)). */
const vec = (a: number, b = 0, w = 0) => {
  const v = new Array(EMBEDDING_DIM).fill(0);
  v[a] = 1;
  if (w) v[b] = w;
  return normalize(v);
};

async function topic(t: { title: string; source: string; createdAt: Date; vector?: Float32Array; checked?: boolean; readAt?: Date | null; url?: string }) {
  const url = t.url ?? `https://${t.source.toLowerCase().replace(/\W/g, "")}.example/${encodeURIComponent(t.title)}`;
  const [row] = await db
    .insert(topics)
    .values({
      forumId,
      sourceId: src[t.source],
      title: t.title,
      excerpt: `Extrait : ${t.title}`,
      url,
      normalizedUrl: url,
      publishedAt: t.createdAt,
      lastActivityAt: t.createdAt,
      createdAt: t.createdAt,
      readAt: t.readAt ?? null,
      mergeCheckedAt: t.checked === false ? null : t.createdAt,
    })
    .returning({ id: topics.id });
  if (t.vector) await db.insert(articleEmbeddings).values({ topicId: row!.id, model: MODEL, dim: EMBEDDING_DIM, vector: encodeVector(t.vector) });
  return row!.id;
}

const get = async (id: number) => (await db.select().from(topics).where(eq(topics.id, id)))[0];

beforeEach(async () => {
  const pg = drizzle(new PGlite(), { schema });
  await migrate(pg, { migrationsFolder: path.join(import.meta.dirname, "..", "drizzle") });
  db = pg as unknown as Db;
  const [f] = await db.insert(forums).values({ name: "Sécurité", slug: "securite" }).returning();
  forumId = f!.id;
  const s = await db
    .insert(sources)
    .values(["CERT-FR", "Le Monde Informatique", "BleepingComputer"].map((name, i) => ({ forumId, name, url: `https://feed${i}.example/rss` })))
    .returning();
  src = Object.fromEntries(s.map((x) => [x.name, x.id]));
});

describe("fusion", () => {
  it("a close new article becomes a reprise: the topic goes up, is unread again, its summary is made again", async () => {
    const first = await topic({ title: "Faille critique dans OpenSSH", source: "CERT-FR", createdAt: hoursAgo(10), vector: vec(1), readAt: hoursAgo(5) });
    await db.insert(articleContents).values({ topicId: first, html: "<p>x</p>", source: "feed", fetchedAt: NOW });
    await db.insert(aiOutputs).values({ topicId: first, kind: "summary", model: "m", html: "<p>x</p>", truncated: false, format: 1, articleFetchedAt: NOW });
    const dup = await topic({ title: "Critical OpenSSH flaw lets attackers in", source: "BleepingComputer", createdAt: hoursAgo(1), vector: vec(1, 2, 0.2), checked: false });

    await db
      .update(topics)
      .set({ excerpt: "A critical vulnerability in OpenSSH lets remote attackers run code on the server before any authentication, and patches are available for the main distributions." })
      .where(eq(topics.id, dup));
    expect(await mergePending(db, { env: {}, now: NOW })).toEqual({ checked: 1, merged: 1 });
    expect(await get(dup)).toBeUndefined();
    const t = (await get(first))!;
    expect(t).toMatchObject({ replyCount: 1, readAt: null, title: "Faille critique dans OpenSSH" });
    expect(t.lastActivityAt.getTime()).toBe(hoursAgo(1).getTime());
    const [r] = await db.select().from(replies).where(eq(replies.topicId, first));
    expect(r).toMatchObject({ type: "source", author: "BleepingComputer", title: "Critical OpenSSH flaw lets attackers in", sourceId: src.BleepingComputer, lang: "en" });
    expect(await db.select().from(replyEmbeddings)).toHaveLength(1);
    expect(await db.select().from(aiOutputs)).toEqual([]);
  });

  it("not merged: below the threshold, older than 72 h, first import, blocked; waits without a vector", async () => {
    await topic({ title: "OpenSSH", source: "CERT-FR", createdAt: hoursAgo(80), vector: vec(1) }); // out of the window
    const far = await topic({ title: "Autre sujet", source: "Le Monde Informatique", createdAt: hoursAgo(2), vector: vec(1, 2, 1.2), checked: false }); // 0.64
    const backlog = await topic({ title: "Import initial", source: "BleepingComputer", createdAt: hoursAgo(1), vector: vec(1), checked: false, readAt: hoursAgo(1) });
    const noVector = await topic({ title: "Pas encore indexé", source: "BleepingComputer", createdAt: hoursAgo(1), checked: false });
    expect(await mergePending(db, { env: {}, now: NOW })).toEqual({ checked: 2, merged: 0 });
    for (const id of [far, backlog]) expect((await get(id))?.mergeCheckedAt).not.toBeNull();
    expect((await get(noVector))?.mergeCheckedAt).toBeNull(); // next cycle

    const kept = await topic({ title: "Cible", source: "CERT-FR", createdAt: hoursAgo(5), vector: vec(7) });
    const url = "https://blocked.example/a";
    await db.insert(mergeBlocks).values({ topicId: kept, normalizedUrl: url });
    const blocked = await topic({ title: "Séparé avant", source: "BleepingComputer", createdAt: hoursAgo(1), vector: vec(7), checked: false, url });
    expect(await mergePending(db, { env: {}, now: NOW })).toMatchObject({ merged: 0 });
    expect(await get(blocked)).toBeDefined();
  });

  it("the threshold: Admin › Intégrations or MERGE_THRESHOLD, 0.50 to 0.99", async () => {
    expect(mergeThreshold({})).toBe(DEFAULT_MERGE_THRESHOLD);
    expect(mergeThreshold({ MERGE_THRESHOLD: "0.6" })).toBe(0.6);
    expect(mergeThreshold({ MERGE_THRESHOLD: "1.2" })).toBe(DEFAULT_MERGE_THRESHOLD);
    expect(validateSetting("merge_threshold", "0.87")).toBeNull();
    expect(validateSetting("merge_threshold", "0.4")).toMatch(/0,50 et 0,99/);
    const a = await topic({ title: "A", source: "CERT-FR", createdAt: hoursAgo(5), vector: vec(3) });
    await topic({ title: "B", source: "BleepingComputer", createdAt: hoursAgo(1), vector: vec(3, 4, 1.2), checked: false }); // 0.64
    expect(await mergePending(db, { env: { MERGE_THRESHOLD: "0.6" }, now: NOW })).toMatchObject({ merged: 1 });
    expect((await get(a))!.replyCount).toBe(1);
  });

  it("a feed returning a merged article does not create a topic again", async () => {
    const first = await topic({ title: "OpenSSH", source: "CERT-FR", createdAt: hoursAgo(5), vector: vec(1) });
    const rss = readFileSync(path.join(import.meta.dirname, "fixtures", "rss2.xml"), "utf8");
    const [s] = await db.select().from(sources).where(eq(sources.id, src.BleepingComputer!));
    const fetchImpl = (async () => new Response(rss)) as unknown as typeof fetch;
    await fetchSource(db, { ...s!, lastFetchedAt: hoursAgo(2) }, { fetchImpl, now: NOW });
    const created = await db.select().from(topics).where(eq(topics.sourceId, src.BleepingComputer!));
    expect(created.length).toBeGreaterThan(0);
    // Every article of the feed merged into the first topic…
    for (const c of created) {
      await db.insert(articleEmbeddings).values({ topicId: c.id, model: MODEL, dim: EMBEDDING_DIM, vector: encodeVector(vec(1)) });
      await db.update(topics).set({ createdAt: hoursAgo(1), readAt: null }).where(eq(topics.id, c.id));
    }
    await mergePending(db, { env: {}, now: NOW });
    expect(await db.select().from(topics).where(eq(topics.sourceId, src.BleepingComputer!))).toEqual([]);
    // …then the same feed again: nothing new.
    const again = await fetchSource(db, { ...s!, lastFetchedAt: hoursAgo(1), etag: null, lastModified: null }, { fetchImpl, now: NOW });
    expect(again).toMatchObject({ status: "ok", inserted: 0 });
    expect((await get(first))!.replyCount).toBe(created.length);
  });
});

describe("Séparer", () => {
  it("makes the reprise a topic again, never merged there again; « Annuler » puts it back", async () => {
    const first = await topic({ title: "OpenSSH", source: "CERT-FR", createdAt: hoursAgo(10), vector: vec(1) });
    const dup = await topic({ title: "OpenSSH flaw", source: "BleepingComputer", createdAt: hoursAgo(1), vector: vec(1), checked: false });
    await mergePending(db, { env: {}, now: NOW });
    void dup;
    const [r] = await db.select().from(replies).where(eq(replies.topicId, first));
    const sep = (await separateReprise(db, r!.id, NOW))!;
    expect(sep.fromTopicId).toBe(first);
    expect(await get(sep.topicId)).toMatchObject({ title: "OpenSSH flaw", sourceId: src.BleepingComputer, readAt: NOW });
    expect((await get(first))!.replyCount).toBe(0);
    expect(await db.select().from(articleEmbeddings).where(eq(articleEmbeddings.topicId, sep.topicId))).toHaveLength(1);
    expect(await db.select().from(mergeBlocks)).toHaveLength(1);

    expect(await undoSeparate(db, sep.topicId, first)).toBe(true);
    expect(await get(sep.topicId)).toBeUndefined();
    expect((await get(first))!.replyCount).toBe(1);
    expect(await db.select().from(mergeBlocks)).toEqual([]);
    expect(await separateReprise(db, 999_999, NOW)).toBeNull();
  });
});

describe("Sujets proches", () => {
  it("by the mean vector of the sources, any date, above the threshold, never the topic itself", async () => {
    const t = await topic({ title: "T", source: "CERT-FR", createdAt: hoursAgo(10), vector: vec(1) });
    const near = await topic({ title: "Proche", source: "CERT-FR", createdAt: hoursAgo(5000), vector: vec(1, 2, 0.3) });
    await topic({ title: "Loin", source: "CERT-FR", createdAt: hoursAgo(5), vector: vec(9) });
    expect(await relatedTopicIds(db, t, { env: {} })).toEqual([near]);
    const v = (await topicVector(db, t, MODEL))!;
    expect(Math.hypot(...v)).toBeCloseTo(1, 5);
    expect(await relatedTopicIds(db, t, { env: { RELATED_MIN: "0.999" } })).toEqual([]);
  });
});

describe("« Résumer les N sources »", () => {
  it("the summary input adds each reprise (title, excerpt), capped, and never a note", async () => {
    expect(repriseBlock([{ author: "LMI", title: "Titre", content: "Extrait" }])).toBe("Autres sources sur ce même sujet :\n- LMI : Titre — Extrait");
    expect(repriseBlock([{ author: "A", title: "x".repeat(100), content: "" }, { author: "B", title: "y", content: "" }], 140)).not.toContain("- B");
    const first = await topic({ title: "OpenSSH", source: "CERT-FR", createdAt: hoursAgo(10), vector: vec(1) });
    await db.insert(articleContents).values({ topicId: first, html: `<p>${"Article du CERT-FR sur la faille. ".repeat(4)}</p>`, source: "feed", fetchedAt: NOW });
    await db.insert(replies).values([
      { topicId: first, type: "source", author: "BleepingComputer", title: "OpenSSH flaw", content: "Attackers can get in.", url: "https://b.example/x", normalizedUrl: "https://b.example/x" },
      { topicId: first, type: "note", author: "Moi", content: "NOTE-SECRETE à ne jamais envoyer" },
    ]);
    const bodies: string[] = [];
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      bodies.push(String(init.body));
      return Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "- Un résumé." }] } }] });
    }) as unknown as typeof fetch;
    const res = await generateAi(db, { topicId: first, kind: "summary", userId: "u-merge" }, { config: { apiKey: "k", model: "m", translateModel: "t" }, fetch: fetchImpl, now: NOW });
    expect(res).toMatchObject({ ok: true });
    expect(bodies[0]).toContain("OpenSSH flaw");
    expect(bodies[0]).toContain("Attackers can get in.");
    expect(bodies[0]).not.toContain("NOTE-SECRETE");
  });
});

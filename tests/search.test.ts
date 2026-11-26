/**
 * Search of « Demande à ta veille » (docs/design/3.3 § 3, 5): the single-field rule, filters in the URL,
 * highlighting, exact matches (notes included or not, filters), matches by meaning (never an exact one twice,
 * daily limit), suggestions while typing (local), and the question suggestions (never the Ma stack inventory).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EMBEDDING_DIM } from "@/lib/ai/embeddings";
import type { Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";

const state = vi.hoisted(() => ({ db: null as unknown as Db, openAlerts: 0 }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/session", () => ({ requireSession: vi.fn(async () => ({ user: { id: "u1" }, session: { id: "s1" } })) }));
vi.mock("@/lib/db", () => ({ getDb: () => state.db }));
vi.mock("@/lib/stack/queries", () => ({ countOpenAlerts: vi.fn(async () => ({ open: state.openAlerts, critical: 0 })) }));

const { defaultIntent, otherIntent, searchWords } = await import("@/lib/search/intent");
const { activeFilters, NO_FILTERS, parseFilters, parseQuery, searchHref } = await import("@/lib/search/filters");
const { highlightRanges, queryTerms, snippet } = await import("@/lib/search/highlight");
const { exactSearch, exactForumCounts, quickSuggestions, semanticSearch } = await import("@/lib/search/query");
const { encodeVector } = await import("@/lib/search/vectors");
const { normalize } = await import("@/lib/ai/embeddings");
const { startSuggestionsAction } = await import("@/lib/actions/search");

describe("one field: what Enter does (§ 5)", () => {
  it("keywords search, questions ask, quotes search exactly", () => {
    expect(defaultIntent("proxmox backup")).toBe("search");
    expect(defaultIntent("proxmox backup ?")).toBe("ask");
    for (const q of ["Qu'est-ce que Talos ?", "quelles failles cette semaine", "Comment migrer vers PBS 4", "pourquoi", "Résume l'actu Kubernetes", "quoi de neuf sur Debian", "Est-ce que PBS chiffre"])
      expect(defaultIntent(q), q).toBe("ask");
    expect(defaultIntent('"comment migrer"')).toBe("search");
    expect(defaultIntent("commentaires debian")).toBe("search"); // « comment » must be a whole word
    expect(defaultIntent("")).toBe("search");
    expect(otherIntent("ask")).toBe("search");
    expect(searchWords("proxmox backup ??")).toBe("proxmox backup");
  });
});

describe("filters in the URL", () => {
  it("parse, ignore what is invalid, and write back the same URL", () => {
    const f = parseFilters({ forum: ["infra", "BAD SLUG", "infra"], periode: "30j", source: "12", liste: ["3", "x"], notes: "0" });
    expect(f).toEqual({ forums: ["infra"], period: "30j", source: 12, lists: [3], notes: false });
    expect(searchHref("pbs 4", f)).toBe("/recherche?q=pbs+4&forum=infra&periode=30j&source=12&liste=3&notes=0");
    expect(parseFilters(Object.fromEntries(new URL(searchHref("x", f), "http://h").searchParams))).toMatchObject({ period: "30j", source: 12, notes: false });
    expect(activeFilters(f)).toBe(5);
    expect(parseFilters({ periode: "2ans" })).toEqual(NO_FILTERS);
    expect(searchHref("q", NO_FILTERS, {}, "/demander")).toBe("/demander?q=q");
    expect(parseQuery({ q: "  a   b  " })).toBe("a b");
  });
});

describe("highlighting", () => {
  it("whole words starting with the folded query words, positions of the original text", () => {
    const terms = queryTerms("Réseau sécurité le");
    expect(terms).toEqual(["reseau", "securite"]);
    const text = "Sécurité des RÉSEAUX : la securité avant tout";
    expect(highlightRanges(text, terms).map(([s, e]) => text.slice(s, e))).toEqual(["Sécurité", "RÉSEAUX", "securité"]);
  });

  it("a passage around the first match, cut on spaces", () => {
    const long = `${"Intro sans rapport. ".repeat(30)}Le nouveau Proxmox Backup Server chiffre les sauvegardes. ${"Suite. ".repeat(30)}`;
    const s = snippet(long, queryTerms("proxmox"), 120);
    expect(s.text.startsWith("… ")).toBe(true);
    expect(s.text.endsWith(" …")).toBe(true);
    expect(s.ranges.map(([a, b]) => s.text.slice(a, b))).toEqual(["Proxmox"]);
  });
});

let ids: Record<string, number> = {};

beforeEach(async () => {
  const pg = drizzle(new PGlite(), { schema });
  await migrate(pg, { migrationsFolder: path.join(import.meta.dirname, "..", "drizzle") });
  state.db = pg as unknown as Db;
  state.openAlerts = 0;
  const db = state.db;
  const [infra, secu] = await db.insert(schema.forums).values([{ name: "Infra & Ops", slug: "infra", position: 0 }, { name: "Sécurité", slug: "securite", position: 1 }]).returning();
  const [src] = await db.insert(schema.sources).values({ forumId: infra!.id, name: "Proxmox Blog", url: "https://example.com/feed" }).returning();
  const now = Date.now();
  const mk = (title: string, excerpt: string, forumId: number, daysAgo: number) => ({
    forumId,
    sourceId: forumId === infra!.id ? src!.id : null,
    title,
    excerpt,
    url: `https://example.com/${title.length}-${daysAgo}`,
    normalizedUrl: `example.com/${title}`,
    publishedAt: new Date(now - daysAgo * 86_400_000),
    lastActivityAt: new Date(now - daysAgo * 86_400_000),
  });
  const rows = await db
    .insert(schema.topics)
    .values([
      mk("Proxmox Backup Server 4 est sorti", "Sauvegardes chiffrées et dédupliquées.", infra!.id, 1),
      mk("Sauvegarder ses VM avec PBS", "Un guide pas à pas.", infra!.id, 40),
      mk("Faille critique dans OpenSSH", "Exécution de code à distance.", secu!.id, 2),
      mk("Ransomware : les hyperviseurs visés", "Les attaquants laissent des sauvegardes chiffrées des machines virtuelles.", secu!.id, 3),
    ])
    .returning({ id: schema.topics.id, title: schema.topics.title });
  ids = Object.fromEntries(rows.map((r) => [r.title.split(" ")[0]!, r.id]));
  await db.insert(schema.replies).values({ topicId: ids.Faille!, type: "note", author: "Moi", content: "À patcher sur le bastion proxmox avant vendredi" });
});

describe("exact matches", () => {
  it("topics by title, excerpt and article, without accents; the notes too, unless switched off", async () => {
    const r = await exactSearch(state.db, "proxmox", NO_FILTERS);
    expect(r.topics.map((t) => t.id)).toEqual([ids.Proxmox]);
    expect(r.topics[0]!.title.ranges.length).toBe(1);
    expect(r.notes).toHaveLength(1);
    expect(r.notes[0]).toMatchObject({ topicId: ids.Faille, postNumber: 2 });
    expect(r.noteTotal).toBe(1);
    const without = await exactSearch(state.db, "proxmox", { ...NO_FILTERS, notes: false });
    expect(without.notes).toEqual([]);
    expect((await exactSearch(state.db, "sauvegarde", NO_FILTERS)).topicTotal).toBe(3); // stemmed: « sauvegardes », « sauvegarder »
    expect((await exactSearch(state.db, "chiffrees", NO_FILTERS)).topicTotal).toBe(2);
  });

  it("filters: forum, period, source; counts per forum ignore the forum filter", async () => {
    const f = { ...NO_FILTERS, forums: ["securite"] };
    expect((await exactSearch(state.db, "chiffrees", f)).topics.map((t) => t.id)).toEqual([ids.Ransomware]);
    expect((await exactSearch(state.db, "sauvegarde", { ...NO_FILTERS, period: "30j" })).topics.map((t) => t.id).sort()).toEqual([ids.Proxmox, ids.Ransomware].sort()); // not the 40-day-old guide
    const counts = await exactForumCounts(state.db, "chiffrees", f);
    expect(Object.fromEntries(counts)).toEqual({ infra: 1, securite: 1 });
    const [src] = await state.db.select().from(schema.sources);
    expect((await exactSearch(state.db, "chiffrees", { ...NO_FILTERS, source: src!.id })).topicTotal).toBe(1);
  });

  it("while typing: titles holding every word, forums; nothing for one letter", async () => {
    const s = await quickSuggestions(state.db, "securi");
    expect(s.forums).toEqual([{ name: "Sécurité", slug: "securite" }]);
    expect((await quickSuggestions(state.db, "backup prox")).topics.map((t) => t.id)).toEqual([ids.Proxmox]);
    expect(await quickSuggestions(state.db, "x")).toEqual({ topics: [], forums: [] });
  });
});

describe("matches by meaning", () => {
  /** Topic vectors: each topic points along its own axis, « hyperviseurs » close to the query. */
  async function index() {
    const axis = (i: number, extra: [number, number][] = []) => {
      const v = new Array(EMBEDDING_DIM).fill(0);
      v[i] = 1;
      for (const [k, x] of extra) v[k] = x;
      return normalize(v);
    };
    const vectors: Record<string, Float32Array> = { Proxmox: axis(0, [[9, 0.9]]), Sauvegarder: axis(1), Faille: axis(2), Ransomware: axis(3, [[9, 1]]) };
    for (const [k, v] of Object.entries(vectors))
      await state.db.insert(schema.articleEmbeddings).values({ topicId: ids[k]!, model: "gemini-embedding-2", dim: EMBEDDING_DIM, vector: encodeVector(v) });
  }
  const queryAlong9 = (async () => Response.json({ embeddings: [{ values: Array.from({ length: EMBEDDING_DIM }, (_, i) => (i === 9 ? 1 : 0)) }] })) as unknown as typeof fetch;
  const AI = { apiKey: "k", model: "m", translateModel: "m" };

  it("near the query, above the threshold, never an exact match twice", async () => {
    await index();
    const exact = await exactSearch(state.db, "proxmox", NO_FILTERS);
    const sem = await semanticSearch(state.db, "virtualisation attaquée", NO_FILTERS, exact.ids, { ai: AI, env: {}, fetch: queryAlong9 });
    expect(sem.status).toBe("ok");
    expect(sem.topics.map((t) => t.id)).toEqual([ids.Ransomware]); // Proxmox is close too, but already exact
    expect(sem.topics[0]!.title.ranges).toEqual([]); // no highlight by meaning
    // The same query again: cached vector, no call (the filters sheet counts without the model).
    const again = await semanticSearch(state.db, "virtualisation attaquée", NO_FILTERS, new Set(), { ai: AI, env: {}, cachedOnly: true });
    expect(again.total).toBe(2);
    const scoped = await semanticSearch(state.db, "virtualisation attaquée", { ...NO_FILTERS, forums: ["infra"] }, new Set(), { ai: AI, env: {}, cachedOnly: true });
    expect(scoped.topics.map((t) => t.id)).toEqual([ids.Proxmox]);
  });

  it("without a key, over the daily limit, or when Gemini fails: exact matches only, with a message", async () => {
    await index();
    expect(await semanticSearch(state.db, "q1", NO_FILTERS, new Set(), { ai: null })).toMatchObject({ status: "off", topics: [] });
    expect(await semanticSearch(state.db, "q2", NO_FILTERS, new Set(), { ai: AI, env: { EMBED_DAILY_LIMIT: "0" }, fetch: queryAlong9 })).toMatchObject({ status: "limit" });
    const failing = (async () => new Response("", { status: 503 })) as unknown as typeof fetch;
    expect(await semanticSearch(state.db, "q3", NO_FILTERS, new Set(), { ai: AI, env: {}, fetch: failing })).toMatchObject({ status: "error", message: expect.any(String) });
  });
});

describe("question suggestions (empty field)", () => {
  it("built here from forum names; Ma stack only as a count and a link", async () => {
    state.openAlerts = 2;
    const s = await startSuggestionsAction();
    expect(s).toHaveLength(3);
    expect(s.find((x) => x.href === "/stack/alertes")?.text).toBe("Ma stack : 2 alertes à traiter");
    expect(s.filter((x) => x.ask).every((x) => /Infra & Ops|Sécurité/.test(x.ask!))).toBe(true);
    // Never the inventory: the action does not even read the software of the stack.
    const src = readFileSync(path.join(import.meta.dirname, "..", "lib", "actions", "search.ts"), "utf8");
    expect(src).not.toMatch(/stackItems|products|getHomeStack|stack_items/);
  });
});

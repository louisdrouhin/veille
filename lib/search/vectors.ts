/**
 * Article vectors, compared in the app (no database extension, docs/design/3.3 § 1 — choice in the PR):
 * at ~800 articles a month, a year is < 10 000 vectors of 768 float32 (30 MB), and comparing a query to all
 * of them takes a few milliseconds. The corpus is kept in memory per process and reloaded when the table
 * changes (count or latest indexed_at).
 */
import { and, count, eq, max } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { articleEmbeddings } from "@/lib/db/schema";

export function encodeVector(v: Float32Array): Uint8Array {
  const out = new Uint8Array(v.length * 4);
  const view = new DataView(out.buffer);
  v.forEach((x, i) => view.setFloat32(i * 4, x, true));
  return out;
}

export function decodeVector(b: Uint8Array): Float32Array {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out = new Float32Array(b.byteLength / 4);
  for (let i = 0; i < out.length; i++) out[i] = view.getFloat32(i * 4, true);
  return out;
}

/** Cosine similarity of two L2-normalized vectors (their dot product). */
export function similarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

export type Corpus = { model: string; ids: Int32Array; vectors: Float32Array[] };

const cache = new WeakMap<object, { key: string; corpus: Promise<Corpus> }>();

/** Every vector of `model`, cached while the table is unchanged. */
export async function loadCorpus(db: Db, model: string): Promise<Corpus> {
  const [stamp] = await db
    .select({ n: count(), last: max(articleEmbeddings.indexedAt) })
    .from(articleEmbeddings)
    .where(eq(articleEmbeddings.model, model));
  const key = `${model}:${stamp?.n ?? 0}:${stamp?.last?.getTime() ?? 0}`;
  const hit = cache.get(db);
  if (hit?.key === key) return hit.corpus;
  const corpus = db
    .select({ id: articleEmbeddings.topicId, vector: articleEmbeddings.vector })
    .from(articleEmbeddings)
    .where(and(eq(articleEmbeddings.model, model)))
    .then((rows) => ({ model, ids: Int32Array.from(rows.map((r) => r.id)), vectors: rows.map((r) => decodeVector(r.vector)) }));
  cache.set(db, { key, corpus });
  corpus.catch(() => cache.delete(db));
  return corpus;
}

/** The `limit` nearest topics to `query`, at or above `threshold`, best first. */
export function nearest(corpus: Corpus, query: Float32Array, opts: { limit: number; threshold?: number; exclude?: ReadonlySet<number>; only?: ReadonlySet<number> }) {
  const out: { topicId: number; score: number }[] = [];
  for (let i = 0; i < corpus.ids.length; i++) {
    const id = corpus.ids[i]!;
    if (opts.exclude?.has(id) || (opts.only && !opts.only.has(id))) continue;
    const score = similarity(corpus.vectors[i]!, query);
    if (score >= (opts.threshold ?? -1)) out.push({ topicId: id, score });
  }
  return out.sort((a, b) => b.score - a.score || b.topicId - a.topicId).slice(0, opts.limit);
}

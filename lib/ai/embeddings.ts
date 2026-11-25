/**
 * Embeddings of the Gemini API (docs/design/3.3 § 1), server side only: the key never reaches the browser.
 * Checked in the docs (aistudio.google.com/docs/embeddings, nov. 2026):
 * - gemini-embedding-2: stable, multilingual (100+ languages, French and English in one space), 8 192 tokens;
 * - output_dimensionality 768 (recommended value): renormalized by the model, normalized again here anyway;
 * - no task_type: the task goes in the text (« title: … | text: … » for documents, « task: … | query: … »
 *   for queries);
 * - free tier: the texts sent may be used by Google to improve its products. Only public articles are
 *   sent (title, feed excerpt, start of the article): never a personal note, never Ma stack.
 * No "server-only" import: the worker bundles it.
 */
import { GEMINI_API } from "./gemini";

export const DEFAULT_EMBEDDING_MODEL = "gemini-embedding-2";
export const EMBEDDING_DIM = 768;
/** Texts per batchEmbedContents request. */
export const EMBED_BATCH = 50;
/** Characters of a document sent at most (≈ 512 tokens, docs/design/3.3 § 1). */
export const DOC_MAX_CHARS = 2_000;
const MODEL = /^[a-z0-9][a-z0-9.-]{0,63}$/;

export type EmbedError = "quota" | "auth" | "model" | "timeout" | "unavailable" | "failed";
export type EmbedResult = { ok: true; vectors: Float32Array[] } | { ok: false; error: EmbedError; status?: number };

export function embeddingModel(env: Partial<Record<string, string | undefined>> = process.env): string {
  const m = env.GEMINI_EMBEDDING_MODEL?.trim();
  return m && MODEL.test(m) ? m : DEFAULT_EMBEDDING_MODEL;
}

const clean = (s: string) => s.replace(/\s+/g, " ").replace(/\|/g, "/").trim();

/** An article, as the docs advise for search documents. */
export function documentText(title: string, body: string): string {
  const t = clean(title) || "none";
  return `title: ${t} | text: ${clean(body)}`.slice(0, DOC_MAX_CHARS);
}

/** A search query or a question, as the docs advise. */
export function queryText(query: string, task: "search result" | "question answering" = "search result"): string {
  return `task: ${task} | query: ${clean(query)}`.slice(0, DOC_MAX_CHARS);
}

export function normalize(values: ArrayLike<number>): Float32Array {
  const v = Float32Array.from(values);
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n);
  if (n > 0) for (let i = 0; i < v.length; i++) v[i]! /= n;
  return v;
}

export async function embedTexts(
  req: { apiKey: string; model: string; texts: string[]; fetch?: typeof fetch; timeoutMs?: number },
): Promise<EmbedResult> {
  if (req.texts.length === 0) return { ok: true, vectors: [] };
  if (req.texts.length > EMBED_BATCH || !MODEL.test(req.model)) return { ok: false, error: "failed" };
  let res: Response;
  try {
    res = await (req.fetch ?? fetch)(`${GEMINI_API}/models/${encodeURIComponent(req.model)}:batchEmbedContents`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": req.apiKey },
      // One Content per text: several parts in one Content would give a single, aggregated embedding.
      body: JSON.stringify({
        requests: req.texts.map((text) => ({ model: `models/${req.model}`, content: { parts: [{ text }] }, output_dimensionality: EMBEDDING_DIM })),
      }),
      signal: AbortSignal.timeout(req.timeoutMs ?? 30_000),
      redirect: "error",
      cache: "no-store",
    });
  } catch (err) {
    const name = (err as Error)?.name;
    return { ok: false, error: name === "TimeoutError" || name === "AbortError" ? "timeout" : "unavailable" };
  }
  if (!res.ok) {
    const s = res.status;
    await res.body?.cancel().catch(() => {});
    return { ok: false, status: s, error: s === 429 ? "quota" : s === 400 || s === 401 || s === 403 ? "auth" : s === 404 ? "model" : s >= 500 ? "unavailable" : "failed" };
  }
  try {
    const raw = await res.text();
    if (raw.length > 8 * 1024 * 1024) return { ok: false, error: "failed" };
    const body = JSON.parse(raw) as { embeddings?: { values?: unknown }[] };
    const list = body.embeddings ?? [];
    if (list.length !== req.texts.length) return { ok: false, error: "failed" };
    const vectors: Float32Array[] = [];
    for (const e of list) {
      const v = e.values;
      if (!Array.isArray(v) || v.length !== EMBEDDING_DIM || !v.every((x) => typeof x === "number" && Number.isFinite(x))) return { ok: false, error: "failed" };
      vectors.push(normalize(v as number[]));
    }
    return { ok: true, vectors };
  } catch {
    return { ok: false, error: "failed" };
  }
}

export const EMBED_ERRORS: Record<EmbedError, string> = {
  quota: "quota Gemini atteint",
  auth: "clé Gemini refusée",
  model: "modèle d'embeddings introuvable",
  timeout: "Gemini n'a pas répondu à temps",
  unavailable: "Gemini indisponible",
  failed: "réponse inattendue de Gemini",
};

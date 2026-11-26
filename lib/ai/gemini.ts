/**
 * generateContent of the Gemini API (REST, server side only: the key never reaches the browser).
 * No "server-only" import: the worker (Ma stack summaries) bundles it too, outside Next.js.
 */
export const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta";
export const GEMINI_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 512 * 1024;

export type GeminiError =
  | "quota"
  | "auth"
  | "model"
  | "overloaded"
  | "server"
  | "network"
  | "request"
  | "blocked"
  | "timeout"
  | "empty"
  | "failed"
  | "invalid";
export type GeminiResult = { ok: true; text: string; truncated: boolean } | { ok: false; error: GeminiError; status?: number };

export type GeminiRequest = {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  maxOutputTokens: number;
  /** Ignored by Gemini 3.6 Flash and newer (docs), still honoured by Flash-Lite. */
  temperature?: number;
  /** Ask for a JSON document (responseMimeType: application/json). */
  json?: boolean;
  /** thinkingConfig.thinkingLevel (Gemini 3+): "low" keeps the translation fast. */
  thinkingLevel?: "minimal" | "low" | "medium" | "high";
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Waits before each new attempt after an overloaded / server error (default RETRY_DELAYS_MS; [] = no retry). */
  retryDelaysMs?: number[];
};

/** A 503 « high demand » is often over within seconds: two more attempts before giving up. */
export const RETRY_DELAYS_MS = [2_000, 5_000];
const MAX_RETRY_AFTER_MS = 10_000;

/**
 * The HTTP error of Gemini, from its status and body (docs: API errors). 400 is an invalid key when the body
 * says so (API_KEY_INVALID), otherwise a request of ours that Gemini refused.
 */
export function classifyHttpError(status: number, body = ""): GeminiError {
  if (status === 429) return "quota";
  if (status === 401 || status === 403) return "auth";
  if (status === 400) return /API_KEY_INVALID|API key not valid/i.test(body) ? "auth" : "request";
  if (status === 404) return "model";
  if (status === 503) return "overloaded";
  if (status >= 500) return "server";
  return "failed";
}

const retryable = (e: GeminiError) => e === "overloaded" || e === "server";

function retryWait(res: Response, planned: number): number {
  const after = Number(res.headers.get("retry-after"));
  return Number.isFinite(after) && after > 0 ? Math.min(after * 1000, MAX_RETRY_AFTER_MS) : planned;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (ms <= 0) return resolve();
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });

const fetchError = (err: unknown): GeminiError => {
  const name = (err as Error)?.name;
  return name === "TimeoutError" || name === "AbortError" ? "timeout" : "network";
};

/** The response, retried on 503 / 5xx; or the error once out of attempts. */
async function post(
  url: string,
  init: RequestInit,
  opts: { fetch?: typeof fetch; retryDelaysMs?: number[]; timeoutMs: number; signal?: AbortSignal },
): Promise<{ res: Response } | { error: GeminiError; status?: number }> {
  const doFetch = opts.fetch ?? fetch;
  const delays = opts.retryDelaysMs ?? RETRY_DELAYS_MS;
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      const timeout = AbortSignal.timeout(opts.timeoutMs);
      res = await doFetch(url, { ...init, signal: opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout });
    } catch (err) {
      return { error: fetchError(err) };
    }
    if (res.ok) return { res };
    const body = await res.text().catch(() => "");
    const error = classifyHttpError(res.status, body.slice(0, 2_000));
    if (!retryable(error) || attempt >= delays.length || opts.signal?.aborted) return { error, status: res.status };
    await sleep(retryWait(res, delays[attempt]!), opts.signal);
    if (opts.signal?.aborted) return { error: "timeout" };
  }
}

const BLOCKED = new Set(["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "IMAGE_SAFETY", "OTHER"]);

type GeminiResponse = {
  promptFeedback?: { blockReason?: string };
  candidates?: { finishReason?: string; content?: { parts?: { text?: string; thought?: boolean }[] } }[];
};

export async function generateContent(req: GeminiRequest): Promise<GeminiResult> {
  const sent = await post(
    `${GEMINI_API}/models/${encodeURIComponent(req.model)}:generateContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": req.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: req.system }] },
        contents: [{ role: "user", parts: [{ text: req.user }] }],
        generationConfig: {
          temperature: req.temperature ?? 0.2,
          maxOutputTokens: req.maxOutputTokens,
          ...(req.json ? { responseMimeType: "application/json" } : {}),
          ...(req.thinkingLevel ? { thinkingConfig: { thinkingLevel: req.thinkingLevel.toUpperCase() } } : {}),
        },
      }),
      redirect: "error",
      cache: "no-store",
    },
    { fetch: req.fetch, retryDelaysMs: req.retryDelaysMs, timeoutMs: req.timeoutMs ?? GEMINI_TIMEOUT_MS },
  );
  if ("error" in sent) return { ok: false, error: sent.error, ...(sent.status ? { status: sent.status } : {}) };
  const res = sent.res;

  let body: GeminiResponse;
  try {
    const raw = await res.text();
    if (raw.length > MAX_RESPONSE_BYTES) return { ok: false, error: "failed" };
    body = JSON.parse(raw) as GeminiResponse;
  } catch {
    return { ok: false, error: "failed" };
  }
  if (body.promptFeedback?.blockReason) return { ok: false, error: "blocked" };
  const candidate = body.candidates?.[0];
  const text = (candidate?.content?.parts ?? [])
    .filter((p) => !p.thought && typeof p.text === "string")
    .map((p) => p.text)
    .join("")
    .trim();
  if (candidate?.finishReason && BLOCKED.has(candidate.finishReason)) return { ok: false, error: "blocked" };
  if (!text) return { ok: false, error: "empty" };
  return { ok: true, text, truncated: candidate?.finishReason === "MAX_TOKENS" };
}

export const GEMINI_ERROR_MESSAGES: Record<GeminiError, string> = {
  quota: "Quota Gemini atteint : réessaie dans quelques minutes.",
  auth: "Clé Gemini refusée : vérifie-la dans Administration › Intégrations.",
  model: "Modèle Gemini introuvable : vérifie son nom dans Administration › Intégrations.",
  overloaded: "Modèle Gemini surchargé chez Google : réessaie dans quelques minutes.",
  server: "Erreur interne de Gemini chez Google : réessaie dans quelques minutes.",
  network: "Gemini injoignable depuis le serveur (réseau) : réessaie plus tard.",
  request: "Requête refusée par Gemini : réessaie, et signale-le si ça se reproduit.",
  blocked: "Gemini a refusé de traiter cet article.",
  timeout: "Gemini n'a pas répondu à temps : réessaie.",
  empty: "Gemini n'a rien renvoyé : réessaie.",
  failed: "Réponse de Gemini illisible : réessaie.",
  invalid: "Traduction incomplète ou mal formée renvoyée par Gemini : réessaie.",
};

export type StreamEvent = { text: string } | { done: true; truncated: boolean } | { error: GeminiError; status?: number };

/**
 * streamGenerateContent (SSE): the text as it comes, for « Demande à ta veille » (docs/design/3.3 § 4.5).
 * `signal` stops it (« Arrêter »); the caller keeps the whole text to check it once complete.
 */
export async function* streamContent(
  req: Omit<GeminiRequest, "json" | "timeoutMs"> & { signal?: AbortSignal; timeoutMs?: number },
): AsyncGenerator<StreamEvent> {
  // Retried before anything is streamed only (an overloaded model answers 503 at once).
  const sent = await post(
    `${GEMINI_API}/models/${encodeURIComponent(req.model)}:streamGenerateContent?alt=sse`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": req.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: req.system }] },
        contents: [{ role: "user", parts: [{ text: req.user }] }],
        generationConfig: {
          temperature: req.temperature ?? 0.2,
          maxOutputTokens: req.maxOutputTokens,
          ...(req.thinkingLevel ? { thinkingConfig: { thinkingLevel: req.thinkingLevel.toUpperCase() } } : {}),
        },
      }),
      redirect: "error",
      cache: "no-store",
    },
    { fetch: req.fetch, retryDelaysMs: req.retryDelaysMs, timeoutMs: req.timeoutMs ?? 60_000, signal: req.signal },
  );
  if ("error" in sent) {
    yield { error: sent.error, ...(sent.status ? { status: sent.status } : {}) };
    return;
  }
  const res = sent.res;
  if (!res.body) {
    yield { error: "empty" };
    return;
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let size = 0;
  let truncated = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_RESPONSE_BYTES * 4) {
        yield { error: "failed" };
        return;
      }
      buffer += value;
      let cut: number;
      while ((cut = buffer.indexOf("\n\n")) >= 0) {
        const event = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        const data = event
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trim())
          .join("");
        if (!data) continue;
        let chunk: GeminiResponse;
        try {
          chunk = JSON.parse(data) as GeminiResponse;
        } catch {
          continue;
        }
        if (chunk.promptFeedback?.blockReason) {
          yield { error: "blocked" };
          return;
        }
        const cand = chunk.candidates?.[0];
        if (cand?.finishReason && BLOCKED.has(cand.finishReason)) {
          yield { error: "blocked" };
          return;
        }
        if (cand?.finishReason === "MAX_TOKENS") truncated = true;
        const text = (cand?.content?.parts ?? []).filter((p) => !p.thought && typeof p.text === "string").map((p) => p.text).join("");
        if (text) yield { text };
      }
    }
  } catch (err) {
    yield { error: fetchError(err) };
    return;
  } finally {
    reader.releaseLock();
  }
  yield { done: true, truncated };
}

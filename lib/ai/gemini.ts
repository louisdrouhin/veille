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
  /** Time allowed to ONE attempt (response headers and body; for a stream: until the headers). */
  timeoutMs?: number;
  /**
   * Absolute end (epoch ms) of the whole call, retries included: an attempt never runs past it, and no retry starts
   * when too little is left. The user's request must get an answer or a clear message in time (docs: timeouts).
   */
  deadline?: number;
  /** Waits before each new attempt after an overloaded / server error (default RETRY_DELAYS_MS; [] = no retry). */
  retryDelaysMs?: number[];
  /** One line per failed attempt (model, attempt, duration, error): never the key, never the text. */
  log?: (line: string) => void;
};

/** A 503 « high demand » is often over within seconds: two more attempts before giving up. */
export const RETRY_DELAYS_MS = [2_000, 5_000];
const MAX_RETRY_AFTER_MS = 10_000;
/** GEMINI_RETRY_DELAYS_MS="2000,5000" overrides them ("" = default; "0,0" in the tests). */
function envDelays(): number[] | null {
  const raw = process.env.GEMINI_RETRY_DELAYS_MS?.trim();
  if (!raw) return null;
  const list = raw.split(",").map((x) => Number(x.trim()));
  return list.every((n) => Number.isInteger(n) && n >= 0 && n <= 60_000) ? list.slice(0, 5) : null;
}

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

/**
 * Errors that are asked again, then handed to a backup model (translation, questions): an overload or a server
 * error of Google. Never a quota, a refused key or an unknown model (they would fail the same way, or must be fixed).
 */
const RETRYABLE: ReadonlySet<GeminiError> = new Set<GeminiError>(["overloaded", "server"]);
const retryable = (e: GeminiError) => RETRYABLE.has(e);
/**
 * Errors after which the backup model is tried (translation, questions): an overload, a server error, or a model
 * that does not answer in time (it was seen hanging for minutes while overloaded). Never a quota, a refused key or an
 * unknown model (they would fail the same way, or must be fixed).
 */
export const FALLBACK_ERRORS: ReadonlySet<GeminiError> = new Set<GeminiError>(["overloaded", "server", "timeout"]);
/** Below this, an attempt is not worth starting (the deadline is too close). */
export const MIN_ATTEMPT_MS = 3_000;

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

type PostOpts = {
  fetch?: typeof fetch;
  retryDelaysMs?: number[];
  timeoutMs: number;
  deadline?: number;
  signal?: AbortSignal;
  /** generateContent: the body is read within the attempt's time. A stream: only the headers (then the deadline). */
  readBody: boolean;
  model: string;
  log?: (line: string) => void;
};
type Posted = { res: Response; text: string; done: () => void } | { error: GeminiError; status?: number };

/**
 * One call with its attempts: each one limited to `timeoutMs` and to the deadline; retried on 503 / 5xx while time is
 * left; a timeout is not retried (the caller may try the backup model instead). Every failed attempt is logged with
 * its duration.
 */
async function post(url: string, init: RequestInit, opts: PostOpts): Promise<Posted> {
  const doFetch = opts.fetch ?? fetch;
  const delays = opts.retryDelaysMs ?? envDelays() ?? RETRY_DELAYS_MS;
  const left = () => (opts.deadline === undefined ? Number.POSITIVE_INFINITY : opts.deadline - Date.now());
  for (let attempt = 1; ; attempt++) {
    const budget = Math.min(opts.timeoutMs, left());
    if (budget < MIN_ATTEMPT_MS && attempt > 1) return { error: "timeout" };
    const started = Date.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new DOMException("attempt timed out", "TimeoutError")), Math.max(budget, 1));
    const done = () => clearTimeout(timer);
    const fail = (error: GeminiError, status?: number) => {
      opts.log?.(`${opts.model} tentative ${attempt} : ${error}${status ? ` (HTTP ${status})` : ""} après ${Date.now() - started} ms`);
      return error;
    };
    let res: Response;
    try {
      res = await doFetch(url, { ...init, signal: opts.signal ? AbortSignal.any([opts.signal, ctrl.signal]) : ctrl.signal });
    } catch (err) {
      done();
      return { error: opts.signal?.aborted ? "timeout" : fail(fetchError(err)) };
    }
    if (res.ok) {
      if (!opts.readBody) {
        done();
        return { res, text: "", done };
      }
      try {
        const text = await res.text();
        done();
        return { res, text, done };
      } catch (err) {
        done();
        return { error: opts.signal?.aborted ? "timeout" : fail(fetchError(err)) };
      }
    }
    const body = await res.text().catch(() => "");
    done();
    const error = fail(classifyHttpError(res.status, body.slice(0, 2_000)), res.status);
    if (!retryable(error) || attempt > delays.length || opts.signal?.aborted) return { error, status: res.status };
    const wait = retryWait(res, delays[attempt - 1]!);
    // No retry that could not finish before the deadline.
    if (left() - wait < MIN_ATTEMPT_MS) return { error, status: res.status };
    await sleep(wait, opts.signal);
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
    {
      fetch: req.fetch,
      retryDelaysMs: req.retryDelaysMs,
      timeoutMs: req.timeoutMs ?? GEMINI_TIMEOUT_MS,
      deadline: req.deadline,
      readBody: true,
      model: req.model,
      log: req.log,
    },
  );
  if ("error" in sent) return { ok: false, error: sent.error, ...(sent.status ? { status: sent.status } : {}) };

  let body: GeminiResponse;
  try {
    const raw = sent.text;
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
  timeout: "Gemini n'a pas répondu à temps (modèle saturé chez Google) : réessaie dans quelques minutes.",
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
  req: Omit<GeminiRequest, "json"> & { signal?: AbortSignal },
): AsyncGenerator<StreamEvent> {
  // The rest of the stream is bounded by the deadline (or 60 s without one).
  const end = req.deadline ?? Date.now() + 60_000;
  const whole = AbortSignal.timeout(Math.max(1, end - Date.now()));
  const signal = req.signal ? AbortSignal.any([req.signal, whole]) : whole;
  // Retried before anything is streamed only (an overloaded model answers 503 at once). `timeoutMs`: until the headers.
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
    {
      fetch: req.fetch,
      retryDelaysMs: req.retryDelaysMs,
      timeoutMs: req.timeoutMs ?? 60_000,
      deadline: end,
      signal,
      readBody: false,
      model: req.model,
      log: req.log,
    },
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

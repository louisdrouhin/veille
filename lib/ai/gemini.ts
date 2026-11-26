/**
 * generateContent of the Gemini API (REST, server side only: the key never reaches the browser).
 * No "server-only" import: the worker (Ma stack summaries) bundles it too, outside Next.js.
 */
export const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta";
export const GEMINI_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 512 * 1024;

export type GeminiError = "quota" | "auth" | "model" | "blocked" | "timeout" | "unavailable" | "empty" | "failed" | "invalid";
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
};

const BLOCKED = new Set(["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "IMAGE_SAFETY", "OTHER"]);

type GeminiResponse = {
  promptFeedback?: { blockReason?: string };
  candidates?: { finishReason?: string; content?: { parts?: { text?: string; thought?: boolean }[] } }[];
};

export async function generateContent(req: GeminiRequest): Promise<GeminiResult> {
  const doFetch = req.fetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${GEMINI_API}/models/${encodeURIComponent(req.model)}:generateContent`, {
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
      signal: AbortSignal.timeout(req.timeoutMs ?? GEMINI_TIMEOUT_MS),
      redirect: "error",
      cache: "no-store",
    });
  } catch (err) {
    const name = (err as Error)?.name;
    return { ok: false, error: name === "TimeoutError" || name === "AbortError" ? "timeout" : "unavailable" };
  }

  if (!res.ok) {
    const s = res.status;
    const error: GeminiError = s === 429 ? "quota" : s === 401 || s === 403 ? "auth" : s === 404 ? "model" : s >= 500 ? "unavailable" : s === 400 ? "auth" : "failed";
    // 400 is what an invalid key returns; a malformed request would be a bug of ours (logged).
    return { ok: false, error, status: s };
  }

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
  auth: "Clé Gemini refusée : vérifie GEMINI_API_KEY sur le serveur.",
  model: "Modèle Gemini introuvable : vérifie GEMINI_MODEL.",
  blocked: "Gemini a refusé de traiter cet article.",
  timeout: "Gemini n'a pas répondu à temps : réessaie.",
  unavailable: "Service Gemini injoignable : réessaie plus tard.",
  empty: "Gemini n'a rien renvoyé : réessaie.",
  failed: "Réponse de Gemini illisible : réessaie.",
  invalid: "Traduction incomplète ou mal formée renvoyée par Gemini : réessaie.",
};

export type StreamEvent = { text: string } | { done: true; truncated: boolean } | { error: GeminiError; status?: number };

/**
 * streamGenerateContent (SSE): the text as it comes, for « Demande à ta veille » (docs/design/3.3 § 4.5).
 * `signal` stops it (« Arrêter »); the caller keeps the whole text to check it once complete.
 */
export async function* streamContent(req: Omit<GeminiRequest, "json" | "timeoutMs"> & { signal?: AbortSignal; timeoutMs?: number }): AsyncGenerator<StreamEvent> {
  const doFetch = req.fetch ?? fetch;
  let res: Response;
  try {
    const timeout = AbortSignal.timeout(req.timeoutMs ?? 60_000);
    res = await doFetch(`${GEMINI_API}/models/${encodeURIComponent(req.model)}:streamGenerateContent?alt=sse`, {
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
      signal: req.signal ? AbortSignal.any([req.signal, timeout]) : timeout,
      redirect: "error",
      cache: "no-store",
    });
  } catch (err) {
    const name = (err as Error)?.name;
    yield { error: name === "TimeoutError" || name === "AbortError" ? "timeout" : "unavailable" };
    return;
  }
  if (!res.ok || !res.body) {
    const s = res.status;
    await res.body?.cancel().catch(() => {});
    yield { error: s === 429 ? "quota" : s === 401 || s === 403 || s === 400 ? "auth" : s === 404 ? "model" : s >= 500 ? "unavailable" : "failed", status: s };
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
    const name = (err as Error)?.name;
    yield { error: name === "TimeoutError" || name === "AbortError" ? "timeout" : "unavailable" };
    return;
  } finally {
    reader.releaseLock();
  }
  yield { done: true, truncated };
}

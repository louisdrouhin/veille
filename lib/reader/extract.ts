import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { FETCH_TIMEOUT_MS, USER_AGENT } from "@/lib/feeds/fetch-source";
import { readLimited, safeFetch, SsrfError, type Resolver } from "@/lib/net/safe-fetch";
import { htmlTextLength, sanitizeArticleHtml } from "./sanitize";

export const MAX_PAGE_BYTES = 2 * 1024 * 1024;
/** Below this many characters of text, an extraction is considered empty (paywall, cookie wall, SPA shell…). */
export const MIN_ARTICLE_TEXT = 200;

export type ExtractResult = { ok: true; html: string } | { ok: false; error: string };

const SOFT_404_ERROR = "Page d'erreur renvoyée à la place de l'article";
/** Error pages served with a 200 (« soft 404 »): recognised by their <title>… */
const ERROR_TITLE = /^\s*(?:(?:erreur|error)\s*)?(?:404|410)\b|^\s*(?:page\s+)?(?:not\s+found|introuvable|non\s+trouvée)\b/i;
/** …or by the path they redirect to (only checked after a redirect). */
const ERROR_PATH = /(?:^|[/_.-])(?:404|410|not[-_]?found|page[-_]?introuvable)(?:[/_.-]|$)/i;

function documentTitle(document: { title?: string; querySelector(s: string): { textContent: string | null } | null }): string {
  return document.title || document.querySelector("title")?.textContent || "";
}

/**
 * Extracts the main article of an HTML page with Readability (on a linkedom
 * DOM: no script execution, no network) and sanitizes it.
 */
export function extractArticle(html: string, pageUrl: string): ExtractResult {
  let content: string | null | undefined;
  try {
    const { document } = parseHTML(html);
    if (ERROR_TITLE.test(documentTitle(document))) return { ok: false, error: SOFT_404_ERROR };
    content = new Readability(document as unknown as Document).parse()?.content;
  } catch (err) {
    return { ok: false, error: `Extraction impossible : ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!content) return { ok: false, error: "Aucun article trouvé dans la page" };
  const clean = sanitizeArticleHtml(content, pageUrl);
  if (htmlTextLength(clean) < MIN_ARTICLE_TEXT) return { ok: false, error: "Extraction vide (paywall ou page dynamique ?)" };
  return { ok: true, html: clean };
}

/** Charset from the Content-Type header, else from a <meta> in the first bytes, else UTF-8. */
export function decodeHtml(bytes: Uint8Array, contentType: string | null): string {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 2048));
  const label =
    /charset\s*=\s*["']?([\w-]+)/i.exec(contentType ?? "")?.[1] ??
    /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head)?.[1] ??
    "utf-8";
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

export type DownloadOptions = {
  /** Injected in tests (defaults: system DNS, guarded undici fetch). */
  resolve?: Resolver;
  fetchImpl?: typeof fetch;
};

/**
 * Downloads an article page through safeFetch (SSRF checks on every hop,
 * 10 s timeout for the whole download, 2 MB cap) and extracts it.
 * Never throws.
 */
export async function fetchReadableArticle(url: string, opts: DownloadOptions = {}): Promise<ExtractResult> {
  try {
    const res = await safeFetch(url, {
      accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
      userAgent: USER_AGENT,
      timeoutMs: FETCH_TIMEOUT_MS,
      resolve: opts.resolve,
      fetchImpl: opts.fetchImpl,
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return { ok: false, error: `HTTP ${res.status}` };
    }
    const type = res.headers.get("content-type");
    if (type && !/html/i.test(type)) {
      await res.body?.cancel().catch(() => {});
      return { ok: false, error: `Pas une page HTML (${type.split(";")[0]})` };
    }
    const bytes = await readLimited(res, MAX_PAGE_BYTES);
    if (!bytes) return { ok: false, error: "Page trop volumineuse (> 2 Mo)" };
    const finalUrl = res.url || url;
    if (finalUrl !== url && ERROR_PATH.test(new URL(finalUrl).pathname)) return { ok: false, error: SOFT_404_ERROR };
    return extractArticle(decodeHtml(bytes, type), finalUrl);
  } catch (err) {
    const ssrf = err instanceof SsrfError ? err : err instanceof Error && err.cause instanceof SsrfError ? err.cause : null;
    if (ssrf) return { ok: false, error: `Adresse refusée : ${ssrf.message}` };
    if (err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError")) {
      return { ok: false, error: `Délai dépassé (${FETCH_TIMEOUT_MS / 1000} s)` };
    }
    return { ok: false, error: `Erreur réseau : ${err instanceof Error ? err.message : String(err)}` };
  }
}

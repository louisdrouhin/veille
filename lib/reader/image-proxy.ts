import { FETCH_TIMEOUT_MS, USER_AGENT } from "@/lib/feeds/fetch-source";
import { sniffImage } from "@/lib/feeds/favicon";
import { readLimited, safeFetch, SsrfError, type Resolver } from "@/lib/net/safe-fetch";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_URL_LENGTH = 4096;
export const PROXY_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"] as const;

/** AVIF = ISO-BMFF « ftyp » box whose major or compatible brands include avif/avis. */
function isAvif(b: Uint8Array): boolean {
  if (b.length < 16 || String.fromCharCode(...b.subarray(4, 8)) !== "ftyp") return false;
  const boxSize = Math.min(((b[0]! << 24) | (b[1]! << 16) | (b[2]! << 8) | b[3]!) >>> 0, b.length, 64);
  for (let i = 8; i + 4 <= boxSize; i += 4) {
    if (i === 12) continue; // minor version
    const brand = String.fromCharCode(...b.subarray(i, i + 4));
    if (brand === "avif" || brand === "avis") return true;
  }
  return false;
}

/**
 * Type of an image allowed through the proxy, from its bytes (the upstream
 * Content-Type is ignored). SVG, ICO, HTML… are refused.
 */
export function sniffProxyImage(bytes: Uint8Array): (typeof PROXY_IMAGE_TYPES)[number] | null {
  const type = sniffImage(bytes);
  if (type && (PROXY_IMAGE_TYPES as readonly string[]).includes(type)) return type as (typeof PROXY_IMAGE_TYPES)[number];
  return isAvif(bytes) ? "image/avif" : null;
}

export type ProxyImageResult =
  | { ok: true; contentType: string; data: Uint8Array }
  | { ok: false; status: 400 | 403 | 413 | 415 | 502 | 504; error: string };

export type ProxyImageOptions = {
  /** Injected in tests (defaults: system DNS, guarded undici fetch). */
  resolve?: Resolver;
  fetchImpl?: typeof fetch;
};

/** Downloads an image for /api/image-proxy: SSRF-safe, 5 MB max, raster formats only. Never throws. */
export async function fetchProxiedImage(rawUrl: string | null, opts: ProxyImageOptions = {}): Promise<ProxyImageResult> {
  if (!rawUrl || rawUrl.length > MAX_IMAGE_URL_LENGTH) return { ok: false, status: 400, error: "URL manquante ou trop longue" };
  try {
    const res = await safeFetch(rawUrl, {
      accept: "image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.9,*/*;q=0.1",
      userAgent: USER_AGENT,
      timeoutMs: FETCH_TIMEOUT_MS,
      resolve: opts.resolve,
      fetchImpl: opts.fetchImpl,
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return { ok: false, status: 502, error: `HTTP ${res.status}` };
    }
    const data = await readLimited(res, MAX_IMAGE_BYTES);
    if (!data) return { ok: false, status: 413, error: "Image trop volumineuse (> 5 Mo)" };
    const contentType = sniffProxyImage(data);
    if (!contentType) return { ok: false, status: 415, error: "Format d'image refusé" };
    return { ok: true, contentType, data };
  } catch (err) {
    const ssrf = err instanceof SsrfError ? err : err instanceof Error && err.cause instanceof SsrfError ? err.cause : null;
    if (ssrf) return { ok: false, status: 403, error: ssrf.message };
    if (err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError")) {
      return { ok: false, status: 504, error: "Délai dépassé" };
    }
    return { ok: false, status: 502, error: err instanceof Error ? err.message : String(err) };
  }
}

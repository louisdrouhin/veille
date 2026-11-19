const TRACKING_PARAMS = new Set(["fbclid", "gclid"]);

function isTrackingParam(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.startsWith("utm_") || TRACKING_PARAMS.has(lower);
}

/**
 * Normalizes an article URL; the result is the deduplication key of topics.
 *
 * - drops `utm_*`, `fbclid`, `gclid` query params (other params keep their order)
 * - drops the `#fragment`
 * - lowercases scheme and host, drops the default port (WHATWG URL does both)
 * - drops credentials
 * - drops trailing `/` from the path (`https://x.com/` → `https://x.com`)
 *
 * Returns null for anything that is not an absolute http(s) URL.
 */
export function normalizeUrl(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.hostname) return null;

  const kept = [...url.searchParams].filter(([name]) => !isTrackingParam(name));
  const search = kept.length ? `?${new URLSearchParams(kept).toString()}` : "";
  const pathname = url.pathname.replace(/\/+$/, "");

  return `${url.protocol}//${url.host.toLowerCase()}${pathname}${search}`;
}

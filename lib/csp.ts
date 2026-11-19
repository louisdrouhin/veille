/**
 * Strict Content-Security-Policy, required by the topic page (its reading mode
 * renders third-party HTML) and applied to every page by proxy.ts. Scripts
 * need the per-request nonce, which Next.js reads from the request header set
 * by proxy.ts and puts on its own scripts; images only from our origin
 * (article images go through /api/image-proxy). Inline style attributes stay allowed: the sanitized HTML
 * never carries any, and React components use a few.
 */
export function pageCsp(nonce: string, dev = process.env.NODE_ENV === "development"): string {
  return [
    "default-src 'self'",
    // 'unsafe-eval' only in dev (React debugging / Turbopack HMR).
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self'",
    "font-src 'self'",
    "connect-src 'self'",
    "media-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export function newNonce(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
}

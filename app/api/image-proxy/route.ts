import { getAuth } from "@/lib/auth";
import { fetchProxiedImage } from "@/lib/reader/image-proxy";

export const dynamic = "force-dynamic";

const COMMON_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; sandbox",
  "Cross-Origin-Resource-Policy": "same-origin",
};

/**
 * Images of topic articles (/api/image-proxy?url=…): downloaded server-side
 * through safeFetch (SSRF checks), 5 MB max, PNG/JPEG/GIF/WebP/AVIF only (from
 * the bytes, not the upstream Content-Type). The browser never contacts the
 * third-party site. Session required, like every API route.
 * Cached by the browser (private) for a week: an image URL is immutable here.
 */
export async function GET(request: Request) {
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session) return new Response(null, { status: 401, headers: COMMON_HEADERS });

  const result = await fetchProxiedImage(new URL(request.url).searchParams.get("url"));
  if (!result.ok) {
    return new Response(null, {
      status: result.status,
      // No reason in the response: it could reveal how internal hostnames resolve.
      headers: { ...COMMON_HEADERS, "Cache-Control": "private, max-age=300" },
    });
  }
  return new Response(Buffer.from(result.data), {
    headers: {
      ...COMMON_HEADERS,
      "Content-Type": result.contentType,
      "Content-Length": String(result.data.byteLength),
      "Cache-Control": "private, max-age=604800, immutable",
    },
  });
}

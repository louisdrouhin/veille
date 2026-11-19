import { and, eq, isNotNull } from "drizzle-orm";
import { getAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { sourceFavicons } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

/** Serves a favicon stored by the worker. Authenticated like every API route. */
export async function GET(request: Request, { params }: { params: Promise<{ sourceId: string }> }) {
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session) return new Response(null, { status: 401 });

  const sourceId = Number((await params).sourceId);
  if (!Number.isSafeInteger(sourceId) || sourceId <= 0) return new Response(null, { status: 404 });

  const [icon] = await getDb()
    .select()
    .from(sourceFavicons)
    .where(and(eq(sourceFavicons.sourceId, sourceId), isNotNull(sourceFavicons.data)));
  if (!icon?.data || !icon.contentType) return new Response(null, { status: 404 });

  const etag = `"${icon.fetchedAt.getTime()}"`;
  const headers = {
    "Cache-Control": "private, max-age=86400",
    ETag: etag,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'",
  };
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });

  return new Response(Buffer.from(icon.data), { headers: { ...headers, "Content-Type": icon.contentType } });
}

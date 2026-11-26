import { eq } from "drizzle-orm";
import { getAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { userPhotos } from "@/lib/db/schema";
import { checkPhoto, PHOTO_MAX_BYTES } from "@/lib/photo";

export const dynamic = "force-dynamic";

/**
 * Profile picture (docs/design/3.5 § 5): served only to the signed-in account, never guessed nor sniffed
 * (nosniff, its own CSP), private cache (the URL changes with each picture: ?v=). Sent by the page as two pictures
 * already cropped and re-encoded in the browser (512 and 64 px); every byte is checked again here (lib/photo.ts).
 */
async function me(request: Request): Promise<string | null> {
  const session = await getAuth().api.getSession({ headers: request.headers });
  return session?.user.id ?? null;
}

/** Changes only from our own pages (the session cookie is SameSite=Lax; a form of another site must not get here). */
function sameOrigin(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  return !!origin && !!host && new URL(origin).host === host;
}

const HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; sandbox",
  "Cross-Origin-Resource-Policy": "same-origin",
};

export async function GET(request: Request) {
  const userId = await me(request);
  if (!userId) return new Response(null, { status: 401 });
  const size = new URL(request.url).searchParams.get("taille") === "512" ? "large" : "small";
  const [row] = await getDb().select().from(userPhotos).where(eq(userPhotos.userId, userId));
  if (!row) return new Response(null, { status: 404, headers: { ...HEADERS, "Cache-Control": "private, no-store" } });
  const body = size === "large" ? row.large : row.small;
  // Never a long cache for something that is not one of our pictures: a broken answer must not stick for a year.
  if (!body?.length || (row.mime !== "image/jpeg" && row.mime !== "image/webp")) {
    return new Response(null, { status: 404, headers: { ...HEADERS, "Cache-Control": "private, no-store" } });
  }
  return new Response(new Uint8Array(body), {
    headers: {
      ...HEADERS,
      "Content-Type": row.mime,
      "Content-Length": String(body.length),
      // A new picture gets a new URL (?v=updatedAt): cached in this browser only, for long.
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}

export async function POST(request: Request) {
  const userId = await me(request);
  if (!userId) return Response.json({ error: "Session expirée : reconnecte-toi." }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: "Requête refusée." }, { status: 403 });
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > PHOTO_MAX_BYTES.large + PHOTO_MAX_BYTES.small + 16_000) return Response.json({ error: "Image trop lourde." }, { status: 413 });
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Envoi illisible : réessaie." }, { status: 400 });
  }
  const large = form.get("large");
  const small = form.get("small");
  if (!(large instanceof Blob) || !(small instanceof Blob)) return Response.json({ error: "Image manquante." }, { status: 400 });
  const [l, s] = [new Uint8Array(await large.arrayBuffer()), new Uint8Array(await small.arrayBuffer())];
  const cl = checkPhoto(l, "large");
  const cs = checkPhoto(s, "small");
  if (!cl.ok) return Response.json({ error: cl.error }, { status: 415 });
  if (!cs.ok) return Response.json({ error: cs.error }, { status: 415 });
  if (cl.mime !== cs.mime) return Response.json({ error: "Les deux tailles doivent avoir le même format." }, { status: 415 });
  const now = new Date();
  await getDb()
    .insert(userPhotos)
    .values({ userId, mime: cl.mime, large: l, small: s, updatedAt: now })
    .onConflictDoUpdate({ target: userPhotos.userId, set: { mime: cl.mime, large: l, small: s, updatedAt: now } });
  return Response.json({ ok: true, version: now.getTime() });
}

export async function DELETE(request: Request) {
  const userId = await me(request);
  if (!userId) return Response.json({ error: "Session expirée : reconnecte-toi." }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: "Requête refusée." }, { status: 403 });
  await getDb().delete(userPhotos).where(eq(userPhotos.userId, userId));
  return Response.json({ ok: true });
}

import { desc, eq } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { sourceFavicons, topics, type Source } from "@/lib/db/schema";
import { FETCH_TIMEOUT_MS, USER_AGENT } from "./fetch-source";

export const FAVICON_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_FAVICON_BYTES = 100 * 1024;
const MAX_HTML_BYTES = 512 * 1024;
const MAX_CANDIDATES = 4;

/**
 * Identifies a raster image from its first bytes. SVG is deliberately not
 * accepted: served from our origin it could carry scripts.
 */
export function sniffImage(bytes: Uint8Array): string | null {
  const b = bytes;
  const starts = (...sig: number[]) => sig.every((v, i) => b[i] === v);
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (starts(0x00, 0x00, 0x01, 0x00)) return "image/x-icon";
  if (starts(0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x52, 0x49, 0x46, 0x46) && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}

/** Icon URLs declared in an HTML page, best first (rel="icon" > "shortcut icon" > "apple-touch-icon"). */
export function findIconLinks(html: string, baseUrl: string): string[] {
  const head = html.slice(0, MAX_HTML_BYTES);
  const found: { url: string; rank: number }[] = [];
  for (const [tag] of head.matchAll(/<link\b[^>]*>/gi)) {
    const rel = /\brel\s*=\s*["']?([^"'>]+)/i.exec(tag)?.[1]?.toLowerCase().trim();
    const href = /\bhref\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i.exec(tag);
    const value = href?.[1] ?? href?.[2] ?? href?.[3];
    if (!rel || !value) continue;
    const rels = rel.split(/\s+/);
    let rank: number;
    if (rels.includes("icon") && !rels.includes("shortcut")) rank = 0;
    else if (rels.includes("icon")) rank = 1;
    else if (rels.includes("apple-touch-icon")) rank = 2;
    else continue;
    if (/\.svg(\?|$)/i.test(value) || /type\s*=\s*["']image\/svg/i.test(tag)) continue;
    try {
      const url = new URL(value.replace(/&amp;/g, "&"), baseUrl);
      if (url.protocol === "http:" || url.protocol === "https:") found.push({ url: url.toString(), rank });
    } catch {
      // ignore invalid href
    }
  }
  return [...new Set(found.sort((a, b) => a.rank - b.rank).map((f) => f.url))];
}

async function readLimited(res: Response, max: number): Promise<Uint8Array | null> {
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > max) return null;
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

async function get(url: string, accept: string, fetchImpl: typeof fetch): Promise<Response | null> {
  try {
    const res = await fetchImpl(url, {
      headers: { "User-Agent": USER_AGENT, Accept: accept },
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    return res.ok ? res : null;
  } catch {
    return null;
  }
}

/** Downloads the favicon of a site: icons declared in its home page, then /favicon.ico. */
export async function downloadFavicon(
  siteUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ contentType: string; data: Uint8Array } | null> {
  const origin = new URL(siteUrl).origin;
  const candidates: string[] = [];

  const page = await get(`${origin}/`, "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5", fetchImpl);
  if (page) {
    const bytes = await readLimited(page, MAX_HTML_BYTES).catch(() => null);
    if (bytes) candidates.push(...findIconLinks(new TextDecoder().decode(bytes), page.url || `${origin}/`));
  }
  candidates.push(`${origin}/favicon.ico`);

  for (const url of [...new Set(candidates)].slice(0, MAX_CANDIDATES)) {
    const res = await get(url, "image/*", fetchImpl);
    if (!res) continue;
    const data = await readLimited(res, MAX_FAVICON_BYTES).catch(() => null);
    if (!data || data.byteLength === 0) continue;
    const contentType = sniffImage(data);
    if (contentType) return { contentType, data };
  }
  return null;
}

/** Site whose favicon represents the source: its latest article, else the feed URL. */
async function siteUrlFor(db: Db, source: Source): Promise<string> {
  const [latest] = await db
    .select({ url: topics.url })
    .from(topics)
    .where(eq(topics.sourceId, source.id))
    .orderBy(desc(topics.publishedAt))
    .limit(1);
  return latest?.url ?? source.url;
}

export type FaviconResult = "fresh" | "stored" | "none" | "error";

/**
 * Downloads and stores the source's favicon when missing or older than 7 days.
 * Never throws; failures only affect the icon (initial shown instead).
 */
export async function refreshFavicon(
  db: Db,
  source: Source,
  opts: { now?: Date; fetchImpl?: typeof fetch; force?: boolean } = {},
): Promise<FaviconResult> {
  const now = opts.now ?? new Date();
  try {
    const [existing] = await db
      .select({ fetchedAt: sourceFavicons.fetchedAt })
      .from(sourceFavicons)
      .where(eq(sourceFavicons.sourceId, source.id));
    if (!opts.force && existing && now.getTime() - existing.fetchedAt.getTime() < FAVICON_TTL_MS) return "fresh";

    const icon = await downloadFavicon(await siteUrlFor(db, source), opts.fetchImpl);
    const values = { contentType: icon?.contentType ?? null, data: icon?.data ?? null, fetchedAt: now };
    await db
      .insert(sourceFavicons)
      .values({ sourceId: source.id, ...values })
      .onConflictDoUpdate({ target: sourceFavicons.sourceId, set: values });
    return icon ? "stored" : "none";
  } catch (err) {
    console.error(`[favicon] source ${source.id}:`, err);
    return "error";
  }
}

/** URL of the stored favicon (versioned so browsers refetch after a refresh). */
export function faviconUrl(sourceId: number | null, fetchedAt: Date | null): string | null {
  if (sourceId === null || fetchedAt === null) return null;
  return `/api/favicon/${sourceId}?v=${fetchedAt.getTime()}`;
}

/**
 * Profile picture (docs/design/3.5 § 5, privacy rules): the server checks the real format from the bytes (JPEG or
 * WebP only: SVG, PNG, HEIC refused), refuses any metadata (EXIF, XMP, IPTC, comment), checks the exact dimensions
 * and the weight; the route serves it to the signed-in account only, nosniff, private cache; changes from our own
 * pages only. Files are forged byte by byte (no image library).
 */
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";

const state = vi.hoisted(() => ({ db: null as unknown as Db, userId: "u1" as string | null }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ getDb: () => state.db }));
vi.mock("@/lib/auth", () => ({ getAuth: () => ({ api: { getSession: async () => (state.userId ? { user: { id: state.userId } } : null) } }) }));

const { checkPhoto, sniffPhoto, sourceKind, megabytes } = await import("@/lib/photo");
const route = await import("@/app/api/profil/photo/route");

const seg = (marker: number, payload: number[]) => [0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xff, ...payload];
/** A minimal JPEG: SOI, JFIF, optional extra segments, SOF0 with the size, SOS, a few bytes, EOI. */
function jpeg(w: number, h: number, extra: number[][] = []): Uint8Array {
  const jfif = seg(0xe0, [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const sof = seg(0xc0, [8, h >> 8, h & 0xff, w >> 8, w & 0xff, 1, 1, 0x11, 0]);
  const sos = seg(0xda, [1, 1, 0, 0, 0x3f, 0]);
  return new Uint8Array([0xff, 0xd8, ...jfif, ...extra.flat(), ...sof, ...sos, 1, 2, 3, 0xff, 0xd9]);
}
const exif = seg(0xe1, [...Buffer.from("Exif\0\0"), 0x4d, 0x4d, 0, 0x2a]);
const xmp = seg(0xe1, [...Buffer.from("http://ns.adobe.com/xap/1.0/\0<x:xmpmeta/>")]);
const comment = seg(0xfe, [...Buffer.from("GPS 48.85,2.35")]);
const icc = seg(0xe2, [...Buffer.from("ICC_PROFILE\0"), 1, 1]);

const chunk = (type: string, data: number[]) => {
  const pad = data.length % 2 ? [0] : [];
  return [...Buffer.from(type), data.length & 0xff, (data.length >> 8) & 0xff, (data.length >> 16) & 0xff, 0, ...data, ...pad];
};
function riff(chunks: number[][]): Uint8Array {
  const body = [...Buffer.from("WEBP"), ...chunks.flat()];
  const n = body.length;
  return new Uint8Array([...Buffer.from("RIFF"), n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, 0, ...body]);
}
/** Lossless WebP header with its size. */
const vp8l = (w: number, h: number) => {
  const bits = (w - 1) | ((h - 1) << 14);
  return chunk("VP8L", [0x2f, bits & 0xff, (bits >> 8) & 0xff, (bits >> 16) & 0xff, (bits >> 24) & 0xff, 0, 0]);
};
const vp8x = (w: number, h: number, flags = 0) => chunk("VP8X", [flags, 0, 0, 0, (w - 1) & 0xff, ((w - 1) >> 8) & 0xff, 0, (h - 1) & 0xff, ((h - 1) >> 8) & 0xff, 0]);

beforeEach(async () => {
  const pg = drizzle(new PGlite(), { schema });
  await migrate(pg, { migrationsFolder: path.join(import.meta.dirname, "..", "drizzle") });
  state.db = pg as unknown as Db;
  state.userId = "u1";
  await state.db.insert(schema.user).values({ id: "u1", name: "moi", email: "moi@example.com" });
});

describe("real format, metadata, dimensions", () => {
  it("JPEG and WebP read from their bytes, whatever the name or declared type", () => {
    expect(sniffPhoto(jpeg(512, 512))).toEqual({ mime: "image/jpeg", width: 512, height: 512, metadata: false });
    expect(sniffPhoto(riff([vp8l(64, 64)]))).toEqual({ mime: "image/webp", width: 64, height: 64, metadata: false });
    expect(sniffPhoto(riff([vp8x(512, 512), vp8l(512, 512)]))).toMatchObject({ width: 512, height: 512, metadata: false });
    expect(checkPhoto(jpeg(512, 512), "large")).toEqual({ ok: true, mime: "image/jpeg" });
    // An ICC color profile (APP2) is not personal data: kept.
    expect(checkPhoto(jpeg(64, 64, [icc]), "small")).toEqual({ ok: true, mime: "image/jpeg" });
  });

  it("refuses EXIF, XMP and comments in a JPEG, EXIF / XMP in a WebP", () => {
    for (const extra of [exif, xmp, comment]) expect(checkPhoto(jpeg(512, 512, [extra]), "large")).toMatchObject({ ok: false, error: expect.stringContaining("métadonnées") });
    expect(checkPhoto(riff([vp8x(512, 512, 0x08), vp8l(512, 512)]), "large")).toMatchObject({ ok: false, error: expect.stringContaining("métadonnées") });
    expect(checkPhoto(riff([vp8x(512, 512), vp8l(512, 512), chunk("XMP ", [...Buffer.from("<x/>")])]), "large")).toMatchObject({ ok: false });
  });

  it("refuses SVG, PNG, HEIC, a wrong size, a too heavy file, an empty one", () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
    const heic = new Uint8Array([0, 0, 0, 24, ...Buffer.from("ftypheic"), 0, 0, 0, 0]);
    for (const f of [svg, png, heic]) expect(checkPhoto(f, "large")).toMatchObject({ ok: false, error: expect.stringContaining("Format") });
    expect(checkPhoto(jpeg(500, 512), "large")).toMatchObject({ ok: false, error: expect.stringContaining("512 × 512") });
    expect(checkPhoto(jpeg(512, 512), "small")).toMatchObject({ ok: false, error: expect.stringContaining("64 × 64") });
    const heavy = new Uint8Array(70_000);
    heavy.set(jpeg(64, 64));
    expect(checkPhoto(heavy, "small")).toMatchObject({ ok: false, error: "Image trop lourde." });
    expect(checkPhoto(new Uint8Array(), "small")).toMatchObject({ ok: false });
  });

  it("the file picked is named in the browser's message (HEIC from an iPhone library), sizes in Mo", () => {
    expect(sourceKind(new Uint8Array([0, 0, 0, 24, ...Buffer.from("ftypheic")]))).toBe("heic");
    expect(sourceKind(jpeg(10, 10))).toBe("jpeg");
    expect(sourceKind(new Uint8Array([0x89, ...Buffer.from("PNG")]))).toBe("png");
    expect(sourceKind(riff([vp8l(1, 1)]))).toBe("webp");
    expect(sourceKind(new TextEncoder().encode("<?xml version='1.0'?><svg/>"))).toBe("svg");
    expect(megabytes(13_002_342)).toBe("12,4 Mo");
  });
});

const ORIGIN = "https://folders.example";
function post(files: { large?: Uint8Array; small?: Uint8Array }, headers: Record<string, string> = { "sec-fetch-site": "same-origin" }) {
  const form = new FormData();
  if (files.large) form.append("large", new Blob([new Uint8Array(files.large)]), "a.jpg");
  if (files.small) form.append("small", new Blob([new Uint8Array(files.small)]), "b.jpg");
  return route.POST(new Request(`${ORIGIN}/api/profil/photo`, { method: "POST", body: form, headers }));
}

describe("route /api/profil/photo", () => {
  it("saved after the checks, served nosniff with a private cache to the signed-in account only", async () => {
    const res = await post({ large: jpeg(512, 512), small: jpeg(64, 64) });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, version: expect.any(Number) });
    const got = await route.GET(new Request(`${ORIGIN}/api/profil/photo?taille=64`));
    expect(got.status).toBe(200);
    expect(got.headers.get("content-type")).toBe("image/jpeg");
    expect(got.headers.get("x-content-type-options")).toBe("nosniff");
    expect(got.headers.get("cache-control")).toContain("private");
    expect(got.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(jpeg(64, 64));
    state.userId = null;
    expect((await route.GET(new Request(`${ORIGIN}/api/profil/photo?taille=512`))).status).toBe(401);
    expect((await post({ large: jpeg(512, 512), small: jpeg(64, 64) })).status).toBe(401);
  });

  it("refuses another site's request, metadata, mixed formats, a missing size; the current picture is kept", async () => {
    await post({ large: jpeg(512, 512), small: jpeg(64, 64) });
    expect((await post({ large: jpeg(512, 512), small: jpeg(64, 64) }, { "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await post({ large: jpeg(512, 512), small: jpeg(64, 64) }, { origin: "https://evil.example", host: "folders.example" })).status).toBe(403);
    expect((await post({ large: jpeg(512, 512, [exif]), small: jpeg(64, 64) })).status).toBe(415);
    expect((await post({ large: jpeg(512, 512), small: riff([vp8l(64, 64)]) })).status).toBe(415);
    expect((await post({ large: jpeg(512, 512) })).status).toBe(400);
    const kept = await route.GET(new Request(`${ORIGIN}/api/profil/photo?taille=512`));
    expect(new Uint8Array(await kept.arrayBuffer())).toEqual(jpeg(512, 512));
  });

  it("deleted (same origin only)", async () => {
    await post({ large: jpeg(512, 512), small: jpeg(64, 64) });
    expect((await route.DELETE(new Request(`${ORIGIN}/api/profil/photo`, { method: "DELETE", headers: { "sec-fetch-site": "cross-site" } }))).status).toBe(403);
    expect((await route.DELETE(new Request(`${ORIGIN}/api/profil/photo`, { method: "DELETE", headers: { "sec-fetch-site": "same-origin" } }))).status).toBe(200);
    expect((await route.GET(new Request(`${ORIGIN}/api/profil/photo?taille=64`))).status).toBe(404);
  });
});

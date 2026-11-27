/**
 * Profile picture, server side (docs/design/3.5 § 5 and the privacy rules of 3.5): the browser crops and re-encodes it
 * on a canvas (JPEG or WebP, which drops every metadata, GPS included); the server trusts nothing it receives and checks
 * the REAL format from the bytes, refuses SVG (or anything else), refuses a file that still carries metadata (EXIF,
 * XMP, IPTC, comments), and checks the size and the exact dimensions (512 × 512 and 64 × 64). No native dependency.
 */
export const PHOTO_SIZES = { large: 512, small: 64 } as const;
export const PHOTO_MAX_BYTES = { large: 1_000_000, small: 64_000 } as const;
/** What the user may pick (checked before the upload, in the browser). */
export const SOURCE_MAX_BYTES = 5 * 1024 * 1024;
export const SOURCE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export type PhotoMime = "image/jpeg" | "image/webp";
export type Sniffed = { mime: PhotoMime; width: number; height: number; metadata: boolean };

const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));
const u16be = (b: Uint8Array, at: number) => (b[at]! << 8) | b[at + 1]!;
const u24le = (b: Uint8Array, at: number) => b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16);
const u32le = (b: Uint8Array, at: number) => (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16) | (b[at + 3]! << 24)) >>> 0;

/** JPEG: SOFn gives the size; APP1 (EXIF, XMP), APP13 (IPTC) and COM count as metadata. */
function sniffJpeg(b: Uint8Array): Sniffed | null {
  let i = 2;
  let width = 0;
  let height = 0;
  let metadata = false;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1]!;
    if (marker === 0xff) {
      i++;
      continue;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i += 2;
      continue;
    }
    if (marker === 0xd9) break;
    const len = u16be(b, i + 2);
    if (len < 2 || i + 2 + len > b.length) return null;
    if (marker === 0xe1 || marker === 0xed || marker === 0xfe || (marker >= 0xe2 && marker <= 0xef && marker !== 0xe2 && marker !== 0xee)) metadata = true;
    // SOF0..SOF15, except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      height = u16be(b, i + 5);
      width = u16be(b, i + 7);
    }
    if (marker === 0xda) break; // start of scan: the image data follows
    i += 2 + len;
  }
  return width && height ? { mime: "image/jpeg", width, height, metadata } : null;
}

/** WebP: VP8 / VP8L / VP8X give the size; EXIF and XMP chunks (or their VP8X flags) count as metadata. */
function sniffWebp(b: Uint8Array): Sniffed | null {
  if (b.length < 20 || ascii(b, 8, 4) !== "WEBP") return null;
  let i = 12;
  let width = 0;
  let height = 0;
  let metadata = false;
  while (i + 8 <= b.length) {
    const type = ascii(b, i, 4);
    const size = u32le(b, i + 4);
    const data = i + 8;
    if (data + size > b.length) return null;
    if (type === "VP8X") {
      const flags = b[data]!;
      if (flags & 0x0c) metadata = true; // EXIF (0x08), XMP (0x04)
      width = u24le(b, data + 4) + 1;
      height = u24le(b, data + 7) + 1;
    } else if (type === "VP8 " && !width) {
      if (b[data + 3] !== 0x9d || b[data + 4] !== 0x01 || b[data + 5] !== 0x2a) return null;
      width = (b[data + 6]! | (b[data + 7]! << 8)) & 0x3fff;
      height = (b[data + 8]! | (b[data + 9]! << 8)) & 0x3fff;
    } else if (type === "VP8L" && !width) {
      if (b[data] !== 0x2f) return null;
      const bits = u32le(b, data + 1);
      width = (bits & 0x3fff) + 1;
      height = ((bits >> 14) & 0x3fff) + 1;
    } else if (type === "EXIF" || type === "XMP ") {
      metadata = true;
    }
    i = data + size + (size % 2);
  }
  return width && height ? { mime: "image/webp", width, height, metadata } : null;
}

/** The real format of a picture from its first bytes; null for anything that is not a JPEG or a WebP (SVG, PNG, HEIC…). */
export function sniffPhoto(bytes: Uint8Array): Sniffed | null {
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return sniffJpeg(bytes);
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF") return sniffWebp(bytes);
  return null;
}

export type PhotoCheck = { ok: true; mime: PhotoMime } | { ok: false; error: string };

/** One of the two pictures sent: right format, no metadata, exact size, not too heavy. */
export function checkPhoto(bytes: Uint8Array, kind: keyof typeof PHOTO_SIZES): PhotoCheck {
  if (bytes.length === 0 || bytes.length > PHOTO_MAX_BYTES[kind]) return { ok: false, error: "Image trop lourde." };
  const s = sniffPhoto(bytes);
  if (!s) return { ok: false, error: "Format non pris en charge : JPEG ou WebP attendu." };
  if (s.metadata) return { ok: false, error: "Image refusée : elle contient encore des métadonnées." };
  const side = PHOTO_SIZES[kind];
  if (s.width !== side || s.height !== side) return { ok: false, error: `Image refusée : ${side} × ${side} pixels attendus.` };
  return { ok: true, mime: s.mime };
}

/**
 * The format of the file picked, from its first bytes (in the browser, before anything is sent): HEIC is named, so
 * that the message can say so.
 */
export function sourceKind(head: Uint8Array): "jpeg" | "png" | "webp" | "heic" | "svg" | "other" {
  if (head[0] === 0xff && head[1] === 0xd8) return "jpeg";
  if (head[0] === 0x89 && ascii(head, 1, 3) === "PNG") return "png";
  if (ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 4) === "WEBP") return "webp";
  if (ascii(head, 4, 4) === "ftyp" && /^(heic|heix|hevc|heim|heis|mif1|msf1|avif)$/.test(ascii(head, 8, 4))) return "heic";
  if (/^\s*<(\?xml|svg)/i.test(ascii(head, 0, 64))) return "svg";
  return "other";
}

/** « 12,4 Mo » */
export const megabytes = (n: number) => `${(n / (1024 * 1024)).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mo`;

/**
 * A new picture gets a new URL (?v=updatedAt in ms, components/account/user-avatar.tsx): that exact URL is cached in this
 * browser only, for a year. Any other `v` (a page rendered before a change, or none) is revalidated every time, so the
 * current picture never sticks under a URL that may name another one.
 */
export function photoCacheControl(v: string | null, updatedAt: Date): string {
  return v === String(updatedAt.getTime()) ? "private, max-age=31536000, immutable" : "private, no-cache";
}

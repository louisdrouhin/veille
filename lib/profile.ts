/**
 * Prénom / Nom (docs/design/3.5 § 5). No server import: used by the header, the menus and the settings.
 */
import { LIST_COLORS, type ListColor } from "@/lib/lists/palette";

export const NAME_MAX = 50;

export type PersonName = { name: string; firstName?: string | null; lastName?: string | null };

/** « Prénom Nom », or the identifier while both are empty. */
export function displayName(u: PersonName): string {
  const full = `${u.firstName ?? ""} ${u.lastName ?? ""}`.replace(/\s+/g, " ").trim();
  return full || u.name;
}

/** Initials of the avatar without photo: Prénom[0] + Nom[0] (or the first letter of the identifier). */
export function initials(u: PersonName): string {
  const f = (u.firstName ?? "").trim()[0];
  const l = (u.lastName ?? "").trim()[0];
  return ((f ?? "") + (l ?? "")).toUpperCase() || (u.name.trim()[0] ?? "?").toUpperCase();
}

/** Like PostgreSQL initcap() (migration 0017): upper case after any character that is not a letter or a digit. */
const cap = (s: string) => s.toLowerCase().replace(/(^|[^\p{L}\p{N}])(\p{L})/gu, (_, sep: string, c: string) => sep + c.toUpperCase());

/** The migration's split (drizzle/0017_profile.sql), for accounts created afterwards: « louis.drouhin » → Louis / Drouhin. */
export function splitIdentifier(name: string): { firstName: string; lastName: string } {
  const [first = "", ...rest] = name.trim().split(/[._\s]+/).filter(Boolean);
  return { firstName: cap(first).slice(0, NAME_MAX), lastName: cap(rest.join(".")).slice(0, NAME_MAX) };
}

/** A first or last name as saved: trimmed, single spaces, 1 to 50 characters, no control character. */
export function cleanName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  if (!s || s.length > NAME_MAX || /[\p{Cc}<>]/u.test(s)) return null;
  return s;
}

/**
 * Color of the initials disc: one of the list colors (--list-*), stable for an identifier (hash). Text in --surface:
 * AA in both themes (list colors are dark in light mode and light in dark mode).
 */
export function avatarColor(id: string): ListColor {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return LIST_COLORS[h % LIST_COLORS.length]!;
}

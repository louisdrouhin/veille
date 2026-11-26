import "server-only";
import { symmetricDecrypt } from "better-auth/crypto";
import { and, desc, eq, gt } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { session, twoFactor } from "@/lib/db/schema";

/** Paramètres › Sécurité (docs/design/3.5 § 7): sessions and backup codes. */

/** « iPhone · Safari », « Mac · Chrome », « Windows · Firefox » from a User-Agent (no IP shown). */
export function deviceLabel(ua: string | null): string {
  if (!ua) return "Appareil inconnu";
  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Mac OS X|Macintosh/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : /Linux/.test(ua)
              ? "Linux"
              : "Appareil";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\/|FxiOS/.test(ua)
      ? "Firefox"
      : /Chrome\/|CriOS/.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : /node|curl|undici/i.test(ua)
            ? "script"
            : "navigateur";
  return `${os} · ${browser}`;
}

export type SessionRow = { id: string; device: string; lastActive: string; current: boolean };

/** Open sessions of the account, this one first, then the most recently active. */
export async function listSessions(db: Db, userId: string, currentId: string, now = new Date()): Promise<SessionRow[]> {
  const rows = await db
    .select({ id: session.id, ua: session.userAgent, updatedAt: session.updatedAt })
    .from(session)
    .where(and(eq(session.userId, userId), gt(session.expiresAt, now)))
    .orderBy(desc(session.updatedAt));
  return rows
    .map((r) => ({ id: r.id, device: deviceLabel(r.ua), lastActive: r.updatedAt.toISOString(), current: r.id === currentId }))
    .sort((a, b) => Number(b.current) - Number(a.current));
}

/** « 8 restants sur 10 »: backup codes not used yet (Better Auth stores them encrypted, as a JSON array). */
export async function backupCodesLeft(db: Db, userId: string, authSecret: string | undefined): Promise<number | null> {
  if (!authSecret) return null;
  const [row] = await db.select({ codes: twoFactor.backupCodes }).from(twoFactor).where(eq(twoFactor.userId, userId));
  if (!row?.codes) return null;
  try {
    const list: unknown = JSON.parse(await symmetricDecrypt({ key: authSecret, data: row.codes }));
    return Array.isArray(list) ? list.length : null;
  } catch {
    return null;
  }
}

export const BACKUP_CODES_TOTAL = 10;

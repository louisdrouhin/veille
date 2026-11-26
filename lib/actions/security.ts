"use server";

import { and, eq, ne } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { session } from "@/lib/db/schema";
import { grantUntil } from "@/lib/secrets/reconfirm";
import { requireSession } from "@/lib/session";

type Result = ({ ok: true } & { count?: number }) | { ok: false; error: string; reconfirm?: true };

/** Paramètres › Sécurité › Sessions (docs/design/3.5 § 7): behind the identity re-confirmation (10 min). */
async function guarded(): Promise<{ userId: string; current: string } | Result> {
  const s = await requireSession();
  if (!grantUntil(s.session.id)) return { ok: false, error: "Confirme d'abord ton identité.", reconfirm: true };
  return { userId: s.user.id, current: s.session.id };
}

/** « Déconnecter » one other session (never this one: « Se déconnecter » does). */
export async function revokeSessionAction(id: unknown): Promise<Result> {
  const g = await guarded();
  if ("ok" in g) return g;
  if (typeof id !== "string" || !id || id === g.current) return { ok: false, error: "Session inconnue." };
  const rows = await getDb()
    .delete(session)
    .where(and(eq(session.id, id), eq(session.userId, g.userId)))
    .returning({ id: session.id });
  return rows.length ? { ok: true } : { ok: false, error: "Cette session n'existe plus." };
}

/** « Déconnecter toutes les autres sessions » (asked for confirmation in the page). */
export async function revokeOtherSessionsAction(): Promise<Result> {
  const g = await guarded();
  if ("ok" in g) return g;
  const rows = await getDb()
    .delete(session)
    .where(and(eq(session.userId, g.userId), ne(session.id, g.current)))
    .returning({ id: session.id });
  return { ok: true, count: rows.length };
}

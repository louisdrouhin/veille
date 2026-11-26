"use server";

import { getDb } from "@/lib/db";
import { forget, setFeedback } from "@/lib/ask/store";
import { requireSession } from "@/lib/session";

/** « Tes dernières questions » (docs/design/3.3 § 4): erase one or all; « Utile » / « Pas utile ». */
export async function forgetQuestionsAction(ids: unknown): Promise<{ ok: boolean }> {
  const session = await requireSession();
  const list = ids === "all" ? "all" : Array.isArray(ids) ? ids.filter((x): x is number => Number.isSafeInteger(x) && x > 0).slice(0, 50) : null;
  if (!list) return { ok: false };
  await forget(getDb(), session.user.id, list);
  return { ok: true };
}

export async function feedbackAction(id: unknown, value: unknown): Promise<{ ok: boolean }> {
  const session = await requireSession();
  if (!Number.isSafeInteger(id) || (value !== "utile" && value !== "pas-utile" && value !== null)) return { ok: false };
  await setFeedback(getDb(), session.user.id, id as number, value as "utile" | "pas-utile" | null);
  return { ok: true };
}

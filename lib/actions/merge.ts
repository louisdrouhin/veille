"use server";

import { getDb } from "@/lib/db";
import { separateReprise, undoSeparate } from "@/lib/merge/fusion";
import { requireSession } from "@/lib/session";

/*
 * « Séparer de ce topic » and its « Annuler » (docs/design/3.3 § 2). No revalidatePath: the topic page refreshes
 * itself (router.refresh), the other pages are dynamic and read again when visited.
 */

export type SeparateResult = { ok: true; topicId: number; fromTopicId: number } | { ok: false; error: string };

const isId = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;

export async function separateRepriseAction(replyId: unknown): Promise<SeparateResult> {
  await requireSession();
  if (!isId(replyId)) return { ok: false, error: "Reprise inconnue." };
  try {
    const r = await separateReprise(getDb(), replyId);
    return r ? { ok: true, ...r } : { ok: false, error: "Cette reprise n'existe plus." };
  } catch (err) {
    console.error("[fusion] séparation en échec :", (err as Error)?.name ?? "erreur");
    return { ok: false, error: "Séparation impossible, réessaie." };
  }
}

export async function undoSeparateAction(topicId: unknown, fromTopicId: unknown): Promise<{ ok: boolean; error?: string }> {
  await requireSession();
  if (!isId(topicId) || !isId(fromTopicId)) return { ok: false, error: "Topic inconnu." };
  try {
    return (await undoSeparate(getDb(), topicId, fromTopicId)) ? { ok: true } : { ok: false, error: "Un des deux topics n'existe plus." };
  } catch (err) {
    console.error("[fusion] annulation en échec :", (err as Error)?.name ?? "erreur");
    return { ok: false, error: "Annulation impossible, réessaie." };
  }
}

"use server";

import { generateAi, type AiResult } from "@/lib/ai/service";
import { getDb } from "@/lib/db";
import { AI_KINDS, type AiKind } from "@/lib/db/schema";
import { requireSession } from "@/lib/session";
import { id as validId, ValidationError } from "@/lib/validation";

/**
 * « Résumer » / « Traduire en français » on the topic page; `primary`: « Refaire avec le modèle principal ».
 * No revalidatePath (router cache kept).
 */
export async function runAi(topicId: number, kind: AiKind, primary = false): Promise<AiResult> {
  const session = await requireSession();
  try {
    const t = validId(topicId);
    if (!(AI_KINDS as readonly string[]).includes(kind)) throw new ValidationError("Action inconnue.");
    return await generateAi(getDb(), { topicId: t, kind, userId: session.user.id, primary: primary === true });
  } catch (err) {
    if (err instanceof ValidationError) return { ok: false, error: err.message };
    console.error("[ai] unexpected", (err as Error)?.name);
    return { ok: false, error: "Erreur inattendue : réessaie." };
  }
}

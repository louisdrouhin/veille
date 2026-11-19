"use server";

import { and, eq, isNull, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { flashUrl } from "@/components/flash";
import { getDb } from "@/lib/db";
import { forums, replies, topics } from "@/lib/db/schema";
import { requireSession } from "@/lib/session";
import { id, NOTE_MAX_LENGTH, str, ValidationError } from "@/lib/validation";

/** « Tout marquer comme lu » — applies to the whole forum, not just the current page. */
export async function markForumRead(formData: FormData) {
  await requireSession();
  const forumId = id(formData.get("forumId"));
  const db = getDb();
  const [forum] = await db.select({ slug: forums.slug }).from(forums).where(eq(forums.id, forumId));
  if (!forum) redirect("/");
  const marked = await db
    .update(topics)
    .set({ readAt: new Date() })
    .where(and(eq(topics.forumId, forumId), isNull(topics.readAt)))
    .returning({ id: topics.id });
  redirect(flashUrl(`/f/${forum.slug}`, "ok", `${marked.length} topic(s) marqué(s) comme lu(s).`));
}

/** Adds a personal note (a reply of type `note`). Does not bump `last_activity_at`. */
export async function addNote(formData: FormData) {
  const session = await requireSession();
  const topicId = id(formData.get("topicId"));
  let content: string;
  try {
    content = str(formData, "content", { max: NOTE_MAX_LENGTH });
  } catch (err) {
    const message = err instanceof ValidationError ? "La note ne peut pas être vide (10 000 caractères max)." : "Erreur";
    redirect(flashUrl(`/t/${topicId}`, "error", message, "#note-form"));
  }

  const db = getDb();
  const replyId = await db.transaction(async (tx) => {
    const [topic] = await tx
      .update(topics)
      .set({ replyCount: sql`${topics.replyCount} + 1` })
      .where(eq(topics.id, topicId))
      .returning({ id: topics.id });
    if (!topic) return null;
    const [reply] = await tx
      .insert(replies)
      .values({ topicId, type: "note", author: session.user.name, content })
      .returning({ id: replies.id });
    return reply!.id;
  });
  if (replyId === null) redirect("/");
  redirect(`/t/${topicId}#reply-${replyId}`);
}

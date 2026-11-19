"use server";

import { and, eq, isNull, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { forums, replies, topics } from "@/lib/db/schema";
import { plural } from "@/lib/format-date";
import { requireSession } from "@/lib/session";
import { toastUrl } from "@/lib/toast";
import { id, NOTE_MAX_LENGTH, str } from "@/lib/validation";

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
  redirect(
    toastUrl(`/f/${forum.slug}`, {
      kind: "ok",
      title: "Forum lu :",
      msg: marked.length ? `${plural(marked.length, "topic")} marqué${marked.length > 1 ? "s" : ""} comme lu${marked.length > 1 ? "s" : ""}` : "rien de nouveau",
    }),
  );
}

/** Adds a personal note (a reply of type `note`). Does not bump `last_activity_at`. */
export async function addNote(formData: FormData) {
  const session = await requireSession();
  const topicId = id(formData.get("topicId"));
  let content: string;
  try {
    content = str(formData, "content", { max: NOTE_MAX_LENGTH });
  } catch {
    redirect(
      toastUrl(`/t/${topicId}`, { kind: "error", title: "Note vide.", msg: "Écris quelque chose (10 000 caractères max)." }, "#note-form"),
    );
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
  redirect(toastUrl(`/t/${topicId}`, { kind: "ok", title: "Note ajoutée." }, `#reply-${replyId}`));
}

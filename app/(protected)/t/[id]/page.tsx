import { and, asc, eq, isNull } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Breadcrumb } from "@/components/layout/breadcrumb";
import { AddNoteForm } from "@/components/thread/add-note-form";
import { Post } from "@/components/thread/post";
import { buttonClass } from "@/components/ui/button";
import { getDb } from "@/lib/db";
import { forums, replies, sources, topics, type ReplyType } from "@/lib/db/schema";
import { requireSession } from "@/lib/session";

type Props = { params: Promise<{ id: string }> };

const REPLY_ROLE: Record<ReplyType, string> = {
  note: "Toi",
  source: "Source",
  comment: "Commentaire",
};

async function getTopic(rawId: string) {
  const topicId = Number(rawId);
  if (!Number.isSafeInteger(topicId) || topicId <= 0) return undefined;
  const [row] = await getDb()
    .select({ topic: topics, forum: forums, sourceName: sources.name })
    .from(topics)
    .innerJoin(forums, eq(forums.id, topics.forumId))
    .leftJoin(sources, eq(sources.id, topics.sourceId))
    .where(eq(topics.id, topicId));
  return row;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  await requireSession();
  const row = await getTopic((await params).id);
  return { title: row?.topic.title ?? "Topic introuvable" };
}

export default async function TopicPage({ params }: Props) {
  await requireSession();
  const row = await getTopic((await params).id);
  if (!row) notFound();
  const { topic, forum, sourceName } = row;

  const db = getDb();
  // Opening the topic marks it as read.
  if (topic.readAt === null) {
    await db.update(topics).set({ readAt: new Date() }).where(and(eq(topics.id, topic.id), isNull(topics.readAt)));
  }
  const replyRows = await db
    .select()
    .from(replies)
    .where(eq(replies.topicId, topic.id))
    .orderBy(asc(replies.createdAt), asc(replies.id));

  return (
    <>
      <Breadcrumb items={[{ label: forum.name, href: `/f/${forum.slug}` }, { label: topic.title }]} />

      <div className="flex flex-col gap-3">
        <Post
          n={1}
          type="topic"
          date={topic.publishedAt}
          author={{ name: sourceName ?? "Source supprimée", role: "Source", muted: !sourceName, siteUrl: topic.url }}
        >
          <h1 className="text-lg font-semibold">{topic.title}</h1>
          {topic.excerpt ? (
            <p className="max-w-[72ch] text-md">{topic.excerpt}</p>
          ) : (
            <p className="text-md text-fg-muted italic">Pas de résumé dans le flux.</p>
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <a href={topic.url} target="_blank" rel="noopener noreferrer" className={buttonClass("primary", "md")}>
              Lire l&apos;article <span aria-hidden="true">↗</span>
            </a>
            <span className="truncate font-mono text-sm text-fg-muted">{hostOf(topic.url)}</span>
          </div>
        </Post>

        {replyRows.map((r, i) => (
          <Post
            key={r.id}
            n={i + 2}
            type={r.type}
            date={r.createdAt}
            author={{ name: r.author, role: REPLY_ROLE[r.type], siteUrl: r.url }}
          >
            <p className="text-md break-words whitespace-pre-line">{r.content}</p>
            {r.url && (
              <a href={r.url} target="_blank" rel="noopener noreferrer" className="self-start text-sm">
                Voir l&apos;article <span aria-hidden="true">↗</span>
              </a>
            )}
          </Post>
        ))}

        <AddNoteForm topicId={topic.id} />
      </div>
    </>
  );
}

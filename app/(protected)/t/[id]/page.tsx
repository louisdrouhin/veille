import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Breadcrumb } from "@/components/layout/breadcrumb";
import { AddNoteForm } from "@/components/thread/add-note-form";
import { Post } from "@/components/thread/post";
import { ReaderArticle, ReaderArticleSkeleton } from "@/components/thread/reader-article";
import { getDb } from "@/lib/db";
import { forums, replies, sourceFavicons, sources, topics, type ReplyType } from "@/lib/db/schema";
import { faviconUrl } from "@/lib/feeds/favicon";
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
    .select({ topic: topics, forum: forums, sourceName: sources.name, faviconAt: sourceFavicons.fetchedAt })
    .from(topics)
    .innerJoin(forums, eq(forums.id, topics.forumId))
    .leftJoin(sources, eq(sources.id, topics.sourceId))
    .leftJoin(sourceFavicons, and(eq(sourceFavicons.sourceId, topics.sourceId), isNotNull(sourceFavicons.data)))
    .where(eq(topics.id, topicId));
  return row;
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
  const { topic, forum, sourceName, faviconAt } = row;

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
          author={{ name: sourceName ?? "Source supprimée", role: "Source", muted: !sourceName, faviconSrc: faviconUrl(topic.sourceId, faviconAt) }}
        >
          <h1 className="text-lg font-semibold">{topic.title}</h1>
          {/* Reading mode: the first opening may download the page (up to 10 s), so it is streamed. */}
          <Suspense fallback={<ReaderArticleSkeleton topic={topic} />}>
            <ReaderArticle topic={topic} />
          </Suspense>
        </Post>

        {replyRows.map((r, i) => (
          <Post
            key={r.id}
            n={i + 2}
            type={r.type}
            date={r.createdAt}
            author={{ name: r.author, role: REPLY_ROLE[r.type] }}
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

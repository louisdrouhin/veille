import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageNav } from "@/components/layout/page-nav";
import { AddNoteForm } from "@/components/thread/add-note-form";
import { Post } from "@/components/thread/post";
import { RelatedTopics } from "@/components/thread/related-topics";
import { RepriseMenu } from "@/components/thread/reprise";
import { SourcesBlock, type SourceLine } from "@/components/thread/sources-block";
import { TopicShortcuts } from "@/components/shortcuts/topic-shortcuts";
import { MarkTopicRead } from "@/components/topic/mark-topic-read";
import { ArticleFetchedAt, TopicArticle, TopicArticleSkeleton } from "@/components/thread/topic-article";
import { RelativeTime } from "@/components/ui/relative-time";
import { getDb } from "@/lib/db";
import { forums, replies, sourceFavicons, sources, topics, type ReplyType } from "@/lib/db/schema";
import { faviconUrl } from "@/lib/feeds/favicon";
import { plural } from "@/lib/format-date";
import { getPickerLists } from "@/lib/lists/queries";
import { requireSession } from "@/lib/session";

type Props = { params: Promise<{ id: string }> };

const REPLY_ROLE: Record<ReplyType, string> = {
  note: "Toi",
  source: "Reprise",
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
  const [replyRows, saved] = await Promise.all([
    db
      .select({ reply: replies, faviconAt: sourceFavicons.fetchedAt })
      .from(replies)
      .leftJoin(sourceFavicons, and(eq(sourceFavicons.sourceId, replies.sourceId), isNotNull(sourceFavicons.data)))
      .where(eq(replies.topicId, topic.id))
      .orderBy(asc(replies.createdAt), asc(replies.id)),
    getPickerLists(db, topic.id),
  ]);

  // « Sources · N » of a merged topic (docs/design/3.3 § 2): the first source, then each reprise.
  const sourceLines: SourceLine[] = [
    { n: 1, name: sourceName ?? "Source supprimée", faviconSrc: faviconUrl(topic.sourceId, faviconAt), url: topic.url, at: topic.publishedAt },
    ...replyRows.flatMap(({ reply: r, faviconAt: fa }, i) =>
      r.type === "source" && r.url ? [{ n: i + 2, name: r.author, faviconSrc: faviconUrl(r.sourceId, fa), url: r.url, at: r.createdAt }] : [],
    ),
  ];
  const merged = sourceLines.length > 1;

  return (
    <>
      <MarkTopicRead topicId={topic.id} />
      <PageNav
        items={[{ label: forum.name, href: `/f/${forum.slug}` }, { label: topic.title }]}
        back={{ href: `/f/${forum.slug}`, mode: "parent" }}
      />
      <TopicShortcuts topicId={topic.id} url={topic.url} forumSlug={forum.slug} />

      <div className={merged ? "md:grid md:grid-cols-[minmax(0,1fr)_300px] md:items-start md:gap-4" : ""}>
      <div className="flex min-w-0 flex-col gap-3">
        <Post
          n={1}
          type="topic"
          date={topic.publishedAt}
          dateSlot={
            <Suspense fallback={null}>
              <ArticleFetchedAt topic={topic} />
            </Suspense>
          }
          author={{ name: sourceName ?? "Source supprimée", role: "Source", muted: !sourceName, faviconSrc: faviconUrl(topic.sourceId, faviconAt) }}
        >
          {/* docs/design/v3.1: title, meta line, then the action bar (★ + AI tools) and the article. */}
          <div className="flex flex-col gap-1">
            <h1 className="text-lg font-semibold">{topic.title}</h1>
            <p className="text-sm text-fg-muted">
              {sourceName ?? "Source supprimée"} · <RelativeTime date={topic.publishedAt} /> · {plural(replyRows.length + 1, "message")}
            </p>
          </div>
          {/* The first opening may download the page (up to 10 s), so the article is streamed. */}
          <Suspense fallback={<TopicArticleSkeleton topic={topic} saved={saved} />}>
            <TopicArticle topic={topic} saved={saved} />
          </Suspense>
          {/* Mobile: the sources under the action bar; desktop: the sticky column. */}
          <SourcesBlock sources={sourceLines} className="md:hidden" />
        </Post>

        {replyRows.map(({ reply: r, faviconAt: fa }, i) =>
          r.type === "source" && r.url ? (
            <Post
              key={r.id}
              n={i + 2}
              type="source"
              date={r.createdAt}
              author={{ name: r.author, role: REPLY_ROLE.source, faviconSrc: faviconUrl(r.sourceId, fa) }}
              headerAction={<RepriseMenu replyId={r.id} url={r.url} source={r.author} />}
            >
              <p className="text-sm text-fg-muted">
                Repris par{" "}
                <a href={r.url} target="_blank" rel="noopener noreferrer" className="font-semibold">
                  {r.author} <span aria-hidden="true">↗</span>
                  <span className="sr-only"> (nouvel onglet)</span>
                </a>
              </p>
              <p className="flex items-start gap-2 text-md font-semibold">
                <span lang={r.lang && r.lang !== "fr" ? r.lang : undefined}>{r.title}</span>
                {r.lang && r.lang !== "fr" && (
                  <span className="mt-0.5 rounded-sm border border-line-strong px-1 font-cond text-2xs font-bold text-fg-muted uppercase">{r.lang}</span>
                )}
              </p>
              {r.content && (
                <p lang={r.lang && r.lang !== "fr" ? r.lang : undefined} className="line-clamp-3 text-base break-words text-fg-muted">
                  {r.content}
                </p>
              )}
            </Post>
          ) : (
            <Post key={r.id} n={i + 2} type={r.type} date={r.createdAt} author={{ name: r.author, role: REPLY_ROLE[r.type] }}>
              <p className="text-md break-words whitespace-pre-line">{r.content}</p>
              {r.url && (
                <a href={r.url} target="_blank" rel="noopener noreferrer" className="self-start text-sm">
                  Voir l&apos;article <span aria-hidden="true">↗</span>
                </a>
              )}
            </Post>
          ),
        )}

        <AddNoteForm topicId={topic.id} />
        <Suspense fallback={null}>
          <RelatedTopics topicId={topic.id} />
        </Suspense>
      </div>
      {merged && (
        <aside aria-label="Sources du topic" className="sticky top-[calc(3.25rem+1px+env(safe-area-inset-top)+16px)] hidden md:block">
          <SourcesBlock sources={sourceLines} />
        </aside>
      )}
      </div>
    </>
  );
}

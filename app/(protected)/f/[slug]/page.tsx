import { and, count, desc, eq, isNotNull, sql } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PageNav } from "@/components/layout/page-nav";
import { FolderIcon, FolderLegend } from "@/components/topic/folder-icon";
import { TopicList } from "@/components/topic/topic-list";
import { TopicListActions } from "@/components/topic/topic-list-actions";
import { ForumUnreadSummary } from "@/components/topic/unread-counters";
import { EmptyState } from "@/components/ui/empty-state";
import { getDb } from "@/lib/db";
import { forums, sourceFavicons, sources, topics } from "@/lib/db/schema";
import { faviconUrl } from "@/lib/feeds/favicon";
import { savedCountOf } from "@/lib/lists/queries";
import { requireSession } from "@/lib/session";

const PAGE_SIZE = 25;

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function getForum(slug: string) {
  const [forum] = await getDb().select().from(forums).where(eq(forums.slug, slug));
  return forum;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  await requireSession();
  const forum = await getForum((await params).slug);
  return { title: forum?.name ?? "Forum introuvable" };
}

export default async function ForumPage({ params, searchParams }: Props) {
  await requireSession();
  const { slug } = await params;
  const query = await searchParams;
  const forum = await getForum(slug);
  if (!forum) notFound();

  const db = getDb();
  const [{ total, unread } = { total: 0, unread: 0 }] = await db
    .select({
      total: count(),
      unread: sql<number>`count(*) filter (where ${topics.readAt} is null)`.mapWith(Number),
    })
    .from(topics)
    .where(eq(topics.forumId, forum.id));
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Number.parseInt(typeof query.page === "string" ? query.page : "1", 10);
  if (!Number.isFinite(page) || page < 1 || page > pageCount) redirect(`/f/${slug}`);

  const rows = await db
    .select({
      id: topics.id,
      title: topics.title,
      replyCount: topics.replyCount,
      lastActivityAt: topics.lastActivityAt,
      readAt: topics.readAt,
      sourceName: sources.name,
      sourceId: topics.sourceId,
      faviconAt: sourceFavicons.fetchedAt,
      url: topics.url,
      savedCount: savedCountOf(),
    })
    .from(topics)
    .leftJoin(sources, eq(sources.id, topics.sourceId))
    .leftJoin(sourceFavicons, and(eq(sourceFavicons.sourceId, topics.sourceId), isNotNull(sourceFavicons.data)))
    .where(eq(topics.forumId, forum.id))
    .orderBy(desc(topics.lastActivityAt), desc(topics.id))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);

  // Server time of this render: the unread counters add the read changes made after it (read-topics.tsx).
  const renderedAt = new Date().getTime();
  const href = (p: number) => (p === 1 ? `/f/${slug}` : `/f/${slug}?page=${p}`);
  const actions = { forumId: forum.id, page, pageCount, href, hasUnread: unread > 0 };

  return (
    <>
      <PageNav items={[{ label: forum.name }]} back={{ href: "/", mode: "parent" }} />
      <header className="mb-3">
        <h1 className="font-cond text-xl font-bold">{forum.name}</h1>
        {forum.description && <p className="text-sm text-fg-muted">{forum.description}</p>}
        <ForumUnreadSummary total={total} unread={unread} renderedAt={renderedAt} slug={slug} />
      </header>

      {rows.length === 0 ? (
        <EmptyState icon={<FolderIcon state="read" size={40} />} title="Aucun topic dans ce forum" />
      ) : (
        <>
          <TopicListActions {...actions} position="top" />
          <TopicList
            topics={rows.map((r) => ({
              id: r.id,
              title: r.title,
              replyCount: r.replyCount,
              lastActivityAt: r.lastActivityAt,
              read: r.readAt !== null,
              sourceName: r.sourceName,
              faviconSrc: faviconUrl(r.sourceId, r.faviconAt),
              savedCount: r.savedCount,
              url: r.url,
              forumSlug: slug,
            }))}
          />
          <TopicListActions {...actions} position="bottom" />
          <FolderLegend />
        </>
      )}
    </>
  );
}

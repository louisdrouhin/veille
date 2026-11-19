import { count, desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Breadcrumb } from "@/components/breadcrumb";
import { Flash } from "@/components/flash";
import { FolderIcon } from "@/components/folder-icon";
import { Pagination } from "@/components/pagination";
import { SubmitButton } from "@/components/submit-button";
import { markForumRead } from "@/lib/actions/topics";
import { getDb } from "@/lib/db";
import { forums, sources, topics } from "@/lib/db/schema";
import { formatCompact } from "@/lib/format";
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
  const [{ total } = { total: 0 }] = await db.select({ total: count() }).from(topics).where(eq(topics.forumId, forum.id));
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
    })
    .from(topics)
    .leftJoin(sources, eq(sources.id, topics.sourceId))
    .where(eq(topics.forumId, forum.id))
    .orderBy(desc(topics.lastActivityAt), desc(topics.id))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);

  const href = (p: number) => (p === 1 ? `/f/${slug}` : `/f/${slug}?page=${p}`);
  const toolbar = (
    <div className="my-2 flex flex-wrap items-center justify-between gap-2">
      <Pagination page={page} pageCount={pageCount} href={href} />
      <form action={markForumRead} className="ml-auto">
        <input type="hidden" name="forumId" value={forum.id} />
        <SubmitButton pendingLabel="…">Tout marquer comme lu</SubmitButton>
      </form>
    </div>
  );

  return (
    <>
      <Breadcrumb items={[{ label: forum.name }]} />
      <Flash ok={query.ok} error={query.error} />
      <h1 className="mb-1 text-xl font-bold text-bar">{forum.name}</h1>
      {toolbar}
      <div className="overflow-x-auto">
        <table className="forum-table">
          <thead>
            <tr>
              <th className="w-8" aria-label="État" />
              <th>Sujet</th>
              <th className="w-40">Auteur</th>
              <th className="w-12 text-right">Nb</th>
              <th className="w-36">Dernier msg</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="py-4 text-center text-read">
                  Aucun topic dans ce forum pour l&apos;instant.
                </td>
              </tr>
            )}
            {rows.map((t) => {
              const read = t.readAt !== null;
              return (
                <tr key={t.id}>
                  <td className="text-center">
                    <FolderIcon state={read ? "read" : "unread"} />
                  </td>
                  <td>
                    {/* prefetch disabled: opening a topic marks it as read */}
                    <Link href={`/t/${t.id}`} prefetch={false} className={read ? "text-read" : "font-bold"}>
                      {t.title}
                    </Link>
                  </td>
                  <td className={`truncate ${t.sourceName ? "" : "italic text-read"}`}>{t.sourceName ?? "Source supprimée"}</td>
                  <td className="text-right">{t.replyCount}</td>
                  <td className="whitespace-nowrap text-[0.85rem]">{formatCompact(t.lastActivityAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {toolbar}
    </>
  );
}

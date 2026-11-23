import { asc, count, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { ForumsPanel, type AdminForum } from "@/components/admin/forums-panel";
import { SourcesPanel } from "@/components/admin/sources-panel";
import { PageNav } from "@/components/layout/page-nav";
import { getDb } from "@/lib/db";
import { forums, sources, topics } from "@/lib/db/schema";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Administration" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function AdminPage({ searchParams }: Props) {
  await requireSession();
  const query = await searchParams;
  const db = getDb();
  const now = new Date();

  const [forumRows, topicCounts, sourceRows] = await Promise.all([
    db.select().from(forums).orderBy(asc(forums.position), asc(forums.name)),
    db.select({ forumId: topics.forumId, n: count() }).from(topics).groupBy(topics.forumId),
    db
      .select({ source: sources, forumName: forums.name })
      .from(sources)
      .innerJoin(forums, eq(forums.id, sources.forumId))
      .orderBy(asc(forums.position), asc(forums.name), asc(sources.name)),
  ]);

  const topicsByForum = new Map(topicCounts.map((r) => [r.forumId, r.n]));
  const sourcesByForum = new Map<number, number>();
  for (const { source } of sourceRows) sourcesByForum.set(source.forumId, (sourcesByForum.get(source.forumId) ?? 0) + 1);

  const adminForums: AdminForum[] = forumRows.map((f) => ({
    id: f.id,
    name: f.name,
    slug: f.slug,
    description: f.description,
    icon: f.icon,
    sourceCount: sourcesByForum.get(f.id) ?? 0,
    topicCount: topicsByForum.get(f.id) ?? 0,
  }));
  const adminSources = sourceRows.map(({ source, forumName }) => ({ ...source, forumName }));
  const editId = typeof query.edit === "string" ? Number(query.edit) : NaN;
  const editing = adminSources.find((s) => s.id === editId);

  return (
    <>
      {/* Editing a source (?edit=…) is a form: back goes to the previous page, else to the admin itself. */}
      <PageNav items={[{ label: "Administration" }]} back={{ href: editing ? "/admin" : "/", mode: "any" }} />
      <h1 className="mb-3 font-cond text-xl font-bold">Administration</h1>
      <div className="flex flex-wrap items-start gap-5">
        <ForumsPanel forums={adminForums} />
        <SourcesPanel sources={adminSources} forums={forumRows} editing={editing} now={now} />
      </div>
    </>
  );
}

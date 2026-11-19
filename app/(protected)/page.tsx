import { asc, count, desc, eq, sql } from "drizzle-orm";
import { ForumTable, type ForumRowData } from "@/components/forum/forum-table";
import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { IconPlus, IconRss } from "@/components/ui/icons";
import { getDb } from "@/lib/db";
import { forums, sources, topics } from "@/lib/db/schema";
import { requireSession } from "@/lib/session";

export default async function HomePage() {
  await requireSession();
  const db = getDb();

  const [forumRows, lastTopics, [{ n: sourceCount } = { n: 0 }]] = await Promise.all([
    db
      .select({
        id: forums.id,
        name: forums.name,
        slug: forums.slug,
        description: forums.description,
        icon: forums.icon,
        total: count(topics.id),
        unread: sql<number>`count(${topics.id}) filter (where ${topics.readAt} is null)`.mapWith(Number),
      })
      .from(forums)
      .leftJoin(topics, eq(topics.forumId, forums.id))
      .groupBy(forums.id)
      .orderBy(asc(forums.position), asc(forums.name)),
    // Latest topic of each forum.
    db
      .selectDistinctOn([topics.forumId], {
        forumId: topics.forumId,
        id: topics.id,
        title: topics.title,
        at: topics.lastActivityAt,
        sourceName: sources.name,
      })
      .from(topics)
      .leftJoin(sources, eq(sources.id, topics.sourceId))
      .orderBy(topics.forumId, desc(topics.lastActivityAt), desc(topics.id)),
    db.select({ n: count() }).from(sources),
  ]);

  const lastByForum = new Map(lastTopics.map((t) => [t.forumId, t]));
  const rows: ForumRowData[] = forumRows.map((f) => {
    const last = lastByForum.get(f.id);
    return { ...f, lastTopic: last ? { id: last.id, title: last.title, sourceName: last.sourceName, at: last.at } : null };
  });
  const totalUnread = rows.reduce((sum, f) => sum + f.unread, 0);

  return (
    <>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-cond text-xl font-bold">Forums</h1>
        {rows.length > 0 && (
          <p className="text-sm text-fg-muted">
            {totalUnread > 0 ? (
              <strong className="font-bold text-accent">
                {totalUnread} non lu{totalUnread > 1 ? "s" : ""}
              </strong>
            ) : (
              "Tout est lu"
            )}
          </p>
        )}
      </div>

      {sourceCount === 0 && (
        <div className="mb-4">
          <EmptyState
            icon={<IconRss size={40} strokeWidth={1.2} />}
            title="Aucune source configurée"
            action={
              <LinkButton href="/admin#sources" variant="primary">
                <IconPlus size={14} /> Ajouter une source
              </LinkButton>
            }
          >
            Ajoute un flux RSS ou Atom pour commencer ta veille.
          </EmptyState>
        </div>
      )}

      {rows.length > 0 ? (
        <ForumTable forums={rows} />
      ) : (
        <EmptyState
          icon={<IconPlus size={40} strokeWidth={1.2} />}
          title="Aucun forum"
          action={
            <LinkButton href="/admin#forums" variant="secondary">
              Créer un forum
            </LinkButton>
          }
        >
          Les forums regroupent tes sources par thème (Sécu, DevOps…).
        </EmptyState>
      )}
    </>
  );
}

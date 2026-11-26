import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { TopicRow } from "@/components/topic/topic-row";
import { TOPIC_GRID_WITH_FORUM, type TopicRowData } from "@/components/topic/topic-grid";
import { TableHead } from "@/components/ui/table-head";
import { getDb } from "@/lib/db";
import { forums, sourceFavicons, sources, topics } from "@/lib/db/schema";
import { faviconUrl } from "@/lib/feeds/favicon";
import { savedCountOf } from "@/lib/lists/queries";
import { relatedTopicIds } from "@/lib/merge/fusion";
import { effectiveEnv } from "@/lib/secrets/effective";

const MOBILE_VISIBLE = 3;
const RELATED_MENU = { context: "forum" } as const;

/**
 * « Sujets proches » (docs/design/3.3 § 6), at the bottom of a topic: the nearest topics of the whole watch, any
 * date, by the mean vector of its sources. Hidden when none is close enough. Local: no model call.
 */
export async function RelatedTopics({ topicId }: { topicId: number }) {
  const db = getDb();
  let ids: number[] = [];
  try {
    ids = await relatedTopicIds(db, topicId, { env: await effectiveEnv(db), limit: 5 });
  } catch {
    return null;
  }
  if (!ids.length) return null;
  const rows = await db
    .select({
      id: topics.id,
      title: topics.title,
      replyCount: topics.replyCount,
      lastActivityAt: topics.lastActivityAt,
      readAt: topics.readAt,
      url: topics.url,
      sourceName: sources.name,
      sourceId: topics.sourceId,
      faviconAt: sourceFavicons.fetchedAt,
      forumName: forums.name,
      forumSlug: forums.slug,
      savedCount: savedCountOf(),
    })
    .from(topics)
    .innerJoin(forums, eq(forums.id, topics.forumId))
    .leftJoin(sources, eq(sources.id, topics.sourceId))
    .leftJoin(sourceFavicons, and(eq(sourceFavicons.sourceId, topics.sourceId), isNotNull(sourceFavicons.data)))
    .where(inArray(topics.id, ids));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const items: TopicRowData[] = ids
    .map((id) => byId.get(id))
    .filter((r) => r !== undefined)
    .map((r) => ({
      id: r.id,
      title: r.title,
      replyCount: r.replyCount,
      lastActivityAt: r.lastActivityAt,
      read: r.readAt !== null,
      sourceName: r.sourceName,
      faviconSrc: faviconUrl(r.sourceId, r.faviconAt),
      savedCount: r.savedCount,
      forum: { name: r.forumName, slug: r.forumSlug },
      forumSlug: r.forumSlug,
      url: r.url,
    }));
  return (
    <section aria-labelledby="related-title" className="overflow-hidden rounded-md border border-line bg-surface shadow-sm">
      <h2 id="related-title" className="flex min-h-9 items-center bg-bar-2 px-3.5 font-cond text-sm font-semibold tracking-caps text-bar-fg uppercase md:px-4">
        Sujets proches
      </h2>
      <TableHead
        grid={TOPIC_GRID_WITH_FORUM}
        className="border-t border-white/10"
        columns={[
          { label: "" },
          { label: "Sujet" },
          { label: "Forum" },
          { label: "Source" },
          { label: "Nb", align: "right" },
          { label: "Dernier msg", align: "right" },
          { label: "", className: "hidden desk:block" },
        ]}
      />
      <ul>
        {items.map((t, i) => (
          <TopicRow key={t.id} topic={t} showForum menu={RELATED_MENU} className={i >= MOBILE_VISIBLE ? "max-md:hidden" : ""} />
        ))}
      </ul>
    </section>
  );
}

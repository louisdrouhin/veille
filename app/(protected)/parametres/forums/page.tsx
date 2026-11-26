import { asc, count, sql } from "drizzle-orm";
import type { Metadata } from "next";
import { ForumsPanel, type AdminForum } from "@/components/admin/forums-panel";
import { SettingsPage } from "@/components/settings/settings-page";
import { getDb } from "@/lib/db";
import { forums, sources, topics } from "@/lib/db/schema";
import { requireSession } from "@/lib/session";
import { settingsTitle } from "@/lib/settings/nav";

export const metadata: Metadata = { title: settingsTitle("forums") };
export const dynamic = "force-dynamic";

/** Paramètres › Forums (docs/design/3.5 § 7): ordered list, creation, editing. */
export default async function ForumsSettingsPage() {
  await requireSession();
  const db = getDb();
  const [forumRows, topicCounts, sourceCounts] = await Promise.all([
    db.select().from(forums).orderBy(asc(forums.position), asc(forums.name)),
    db
      .select({ forumId: topics.forumId, n: count(), unread: sql<number>`count(*) filter (where ${topics.readAt} is null)`.mapWith(Number) })
      .from(topics)
      .groupBy(topics.forumId),
    db.select({ forumId: sources.forumId, n: count() }).from(sources).groupBy(sources.forumId),
  ]);
  const topicsBy = new Map(topicCounts.map((r) => [r.forumId, r.n]));
  const unreadBy = new Map(topicCounts.map((r) => [r.forumId, r.unread]));
  const sourcesBy = new Map(sourceCounts.map((r) => [r.forumId, r.n]));
  const list: AdminForum[] = forumRows.map((f) => ({
    id: f.id,
    name: f.name,
    slug: f.slug,
    description: f.description,
    icon: f.icon,
    sourceCount: sourcesBy.get(f.id) ?? 0,
    topicCount: topicsBy.get(f.id) ?? 0,
    unreadCount: unreadBy.get(f.id) ?? 0,
  }));
  return (
    <SettingsPage page="forums" title="Forums" description="Les forums de ta veille, dans l'ordre de l'accueil. Une source appartient toujours à un forum.">
      <ForumsPanel forums={list} />
    </SettingsPage>
  );
}

import { ForumTable } from "@/components/forum/forum-table";
import { FeaturedSection } from "@/components/home/featured";
import { HomeStats } from "@/components/home/home-stats";
import { StackBlock } from "@/components/home/stack-block";
import { LatestUnread } from "@/components/home/latest-unread";
import { InstallBanner } from "@/components/pwa/install-banner";
import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { IconPlus, IconRss } from "@/components/ui/icons";
import { getDb } from "@/lib/db";
import { FEATURED_ENABLED } from "@/lib/flags";
import { getFeatured, getForumsWithCounts, getHomeStats, getLatestUnread } from "@/lib/home";
import { requireSession } from "@/lib/session";
import { getHomeStack } from "@/lib/stack/queries";

/** « À la une »: activity in the last 48 hours (docs/design/3.3 § 2). */
const FEATURED_WINDOW_MS = 48 * 3_600_000;

/** Home (docs/design/v2 § 2): À la une · Ma stack (3.0) · summary · latest unread · forums, same order on mobile and desktop. */
export default async function HomePage() {
  await requireSession();
  const db = getDb();
  const now = new Date();

  const featured = FEATURED_ENABLED ? await getFeatured(db, { limit: 10, since: new Date(now.getTime() - FEATURED_WINDOW_MS) }) : [];
  const [stats, latest, forums, stack] = await Promise.all([
    getHomeStats(db, now),
    // No topic twice: those « À la une » are left out of « Derniers non lus ».
    getLatestUnread(db, { limit: 8, exclude: featured.map((f) => f.id) }),
    getForumsWithCounts(db),
    getHomeStack(db),
  ]);

  if (stats.sourceCount === 0) {
    return (
      <>
        <h1 className="sr-only">Accueil</h1>
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
      </>
    );
  }

  return (
    <>
      <InstallBanner />
      <h1 className="sr-only">Accueil</h1>
      <div className="flex flex-col gap-4">
        <FeaturedSection items={featured} />
        {/* Ma stack (3.0): above the stats, under « À la une ». */}
        <StackBlock stack={stack} />
        <HomeStats stats={stats} renderedAt={now.getTime()} />
        <LatestUnread topics={latest} />
        <section aria-labelledby="forums-title">
          <h2 id="forums-title" className="mb-2 font-cond text-lg font-bold">
            Forums
          </h2>
          {/* A source always belongs to a forum: with sources, there is at least one forum. */}
          <ForumTable forums={forums} renderedAt={now.getTime()} />
        </section>
      </div>
    </>
  );
}

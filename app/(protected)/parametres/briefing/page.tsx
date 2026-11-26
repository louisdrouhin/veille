import { asc } from "drizzle-orm";
import type { Metadata } from "next";
import { BriefingSettingsPanel } from "@/components/account/briefing-settings";
import { SettingsPage } from "@/components/settings/settings-page";
import { nextLabel } from "@/lib/briefing/queries";
import { getBriefingSettings } from "@/lib/briefing/settings";
import { getDb } from "@/lib/db";
import { forums } from "@/lib/db/schema";
import { requireSession } from "@/lib/session";
import { settingsTitle } from "@/lib/settings/nav";

export const metadata: Metadata = { title: settingsTitle("briefing") };
export const dynamic = "force-dynamic";

/** Paramètres › Briefing du matin (docs/design/3.5 § 7): the 3.4 settings, titled « Envoi et contenu ». */
export default async function BriefingSettingsPage() {
  await requireSession();
  const db = getDb();
  const [b, forumRows] = await Promise.all([getBriefingSettings(db), db.select({ id: forums.id, name: forums.name }).from(forums).orderBy(asc(forums.position), asc(forums.name))]);
  return (
    <SettingsPage page="briefing" title="Briefing du matin" description="Ta veille en 2 minutes, chaque matin, à l'heure que tu choisis.">
      <BriefingSettingsPanel
        title="Envoi et contenu"
        initial={{
          enabled: b.enabled,
          sendAt: b.sendAt.slice(0, 5),
          days: b.days,
          sectionStack: b.sectionStack,
          sectionFeatured: b.sectionFeatured,
          sectionServices: b.sectionServices,
          sectionBrief: b.sectionBrief,
          length: b.length,
          preview: b.preview,
          servicesForumIds: b.servicesForumIds,
        }}
        forums={forumRows}
        next={nextLabel(b)}
      />
    </SettingsPage>
  );
}

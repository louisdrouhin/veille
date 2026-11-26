import { asc } from "drizzle-orm";
import type { Metadata } from "next";
import { AccountNav } from "@/components/account/account-nav";
import { BriefingSettingsPanel } from "@/components/account/briefing-settings";
import { NotificationsSettings } from "@/components/account/notifications-panel";
import { PageNav } from "@/components/layout/page-nav";
import { nextLabel } from "@/lib/briefing/queries";
import { getBriefingSettings } from "@/lib/briefing/settings";
import { getDb } from "@/lib/db";
import { forums } from "@/lib/db/schema";
import { currentVapid } from "@/lib/secrets/effective";
import { getNotificationSettings } from "@/lib/push/notify";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

/**
 * Mon compte › Notifications: the morning briefing first (docs/design/3.4 § 7), then Ma stack (docs/design/3.0 § 5).
 * The public VAPID key is read at runtime, never inlined.
 */
export default async function NotificationsPage() {
  await requireSession();
  const db = getDb();
  const [s, b, forumRows] = await Promise.all([getNotificationSettings(db), getBriefingSettings(db), db.select({ id: forums.id, name: forums.name }).from(forums).orderBy(asc(forums.position), asc(forums.name))]);
  const hhmm = (t: string) => t.slice(0, 5);
  return (
    <div className="pb-[calc(env(safe-area-inset-bottom)+96px)] md:pb-0">
      <PageNav items={[{ label: "Mon compte", href: "/compte" }, { label: "Notifications" }]} back={{ href: "/compte", mode: "any" }} />
      <h1 className="mb-3 font-cond text-xl font-bold">Notifications</h1>
      <AccountNav current="notifications" />
      <div className="grid max-w-[700px] gap-4">
        <BriefingSettingsPanel
          initial={{
            enabled: b.enabled,
            sendAt: hhmm(b.sendAt),
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
        <NotificationsSettings
          publicKey={(await currentVapid(db))?.publicKey ?? null}
          settings={{
            threshold: s.threshold,
            exploitedAlways: s.exploitedAlways,
            quietEnabled: s.quietEnabled,
            quietFrom: hhmm(s.quietFrom),
            quietTo: hhmm(s.quietTo),
            discreetHomelab: s.discreetHomelab,
            discreetWork: s.discreetWork,
          }}
        />
      </div>
    </div>
  );
}

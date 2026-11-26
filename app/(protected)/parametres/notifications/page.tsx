import type { Metadata } from "next";
import Link from "next/link";
import { NotificationsSettings } from "@/components/account/notifications-panel";
import { SettingsPage } from "@/components/settings/settings-page";
import { IconChevronRight, IconSun } from "@/components/ui/icons";
import { nextLabel } from "@/lib/briefing/queries";
import { getBriefingSettings } from "@/lib/briefing/settings";
import { getDb } from "@/lib/db";
import { getNotificationSettings } from "@/lib/push/notify";
import { currentVapid } from "@/lib/secrets/effective";
import { requireSession } from "@/lib/session";
import { settingsTitle } from "@/lib/settings/nav";

export const metadata: Metadata = { title: settingsTitle("notifications") };
export const dynamic = "force-dynamic";

/**
 * Paramètres › Notifications (docs/design/3.5 § 7): devices, Ma stack alerts, quiet hours, and a link to the morning
 * briefing. The public VAPID key is read at runtime, never inlined.
 */
export default async function NotificationsPage() {
  await requireSession();
  const db = getDb();
  const [s, b, vapid] = await Promise.all([getNotificationSettings(db), getBriefingSettings(db), currentVapid(db)]);
  const hhmm = (t: string) => t.slice(0, 5);
  const next = nextLabel(b);
  return (
    <SettingsPage page="notifications" title="Notifications" description="Les alertes Ma stack sur tes appareils, et quand elles arrivent.">
      <NotificationsSettings
        publicKey={vapid?.publicKey ?? null}
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
      <Link href="/parametres/briefing" className="flex min-h-14 items-center gap-3 rounded-md border border-line bg-surface p-3.5 text-fg no-underline shadow-sm hover:bg-surface-hover hover:text-fg">
        <IconSun size={18} className="shrink-0 text-accent" />
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">Briefing du matin</span>
          <span className="block text-sm text-fg-muted">{b.enabled && next ? `Prochain : ${next}` : "Désactivé"}</span>
        </span>
        <IconChevronRight size={16} className="text-fg-muted" />
      </Link>
    </SettingsPage>
  );
}

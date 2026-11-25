import type { Metadata } from "next";
import { NotificationsSettings } from "@/components/account/notifications-panel";
import { PageNav } from "@/components/layout/page-nav";
import { getDb } from "@/lib/db";
import { vapidConfig } from "@/lib/push/config";
import { getNotificationSettings } from "@/lib/push/notify";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

/** Mon compte › Notifications (docs/design/3.0 § 5). The public VAPID key is read at runtime, never inlined. */
export default async function NotificationsPage() {
  await requireSession();
  const s = await getNotificationSettings(getDb());
  const hhmm = (t: string) => t.slice(0, 5);
  return (
    <div className="pb-[calc(env(safe-area-inset-bottom)+96px)] md:pb-0">
      <PageNav items={[{ label: "Mon compte", href: "/compte" }, { label: "Notifications" }]} back={{ href: "/compte", mode: "any" }} />
      <h1 className="mb-3 font-cond text-xl font-bold">Notifications</h1>
      <NotificationsSettings
        publicKey={vapidConfig()?.publicKey ?? null}
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
  );
}

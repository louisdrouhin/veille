import type { Metadata } from "next";
import { BriefingIntro } from "@/components/briefing/briefing-intro";
import { BriefingView } from "@/components/briefing/briefing-view";
import { briefingPageData } from "@/lib/briefing/page-data";
import { getLatestBriefing } from "@/lib/briefing/queries";
import { getBriefingSettings } from "@/lib/briefing/settings";
import { getDb } from "@/lib/db";
import { currentVapid } from "@/lib/secrets/effective";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Briefing du matin" };
export const dynamic = "force-dynamic";

/**
 * /briefing (docs/design/3.4 § 3): the latest briefing. Before the first one, or while the briefing is off and
 * its card was never answered: « Nouveau dans Folders 3.4 » (§ 6, Première fois).
 */
export default async function BriefingPage() {
  await requireSession();
  const db = getDb();
  const s = await getBriefingSettings(db);
  const b = await getLatestBriefing(db);
  if (!b || (!s.enabled && !s.introSeenAt)) return <BriefingIntro publicKey={(await currentVapid(db))?.publicKey ?? null} latestDay={b?.day ?? null} />;
  return <BriefingView {...await briefingPageData(db, b, s)} />;
}

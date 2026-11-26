import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BriefingView } from "@/components/briefing/briefing-view";
import { dayLong } from "@/lib/briefing/format";
import { briefingPageData } from "@/lib/briefing/page-data";
import { getBriefing } from "@/lib/briefing/queries";
import { getBriefingSettings } from "@/lib/briefing/settings";
import { isBriefingDay } from "@/lib/briefing/types";
import { getDb } from "@/lib/db";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ day: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { day } = await params;
  return { title: isBriefingDay(day) ? `Briefing · ${dayLong(day)}` : "Briefing" };
}

/** /briefing/AAAA-MM-JJ (docs/design/3.4 § 3): the notification opens it; strict date. */
export default async function BriefingDayPage({ params }: Props) {
  await requireSession();
  const { day } = await params;
  if (!isBriefingDay(day)) notFound();
  const db = getDb();
  const b = await getBriefing(db, day);
  if (!b) notFound();
  const s = await getBriefingSettings(db);
  return <BriefingView {...await briefingPageData(db, b, s)} />;
}

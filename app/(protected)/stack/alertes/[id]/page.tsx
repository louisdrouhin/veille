import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AlertsPage } from "@/components/stack/alerts-page";
import { getDb } from "@/lib/db";
import { getAlertDetail, markAlertSeen, parseAlertFilter } from "@/lib/stack/queries";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Alerte · Ma stack" };
export const dynamic = "force-dynamic";

/** One alert. Opening it marks it seen (`new` → `seen`): links to it are never prefetched. */
export default async function AlertRoute({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ etat?: string }> }) {
  await requireSession();
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id <= 0) notFound();
  const db = getDb();
  await markAlertSeen(db, id);
  const detail = await getAlertDetail(db, id);
  if (!detail) notFound();
  return <AlertsPage filter={parseAlertFilter((await searchParams).etat)} detail={detail} />;
}

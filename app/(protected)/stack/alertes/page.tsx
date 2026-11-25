import type { Metadata } from "next";
import { AlertsPage } from "@/components/stack/alerts-page";
import { parseAlertFilter } from "@/lib/stack/queries";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Alertes · Ma stack" };
export const dynamic = "force-dynamic";

export default async function AlertsRoute({ searchParams }: { searchParams: Promise<{ etat?: string }> }) {
  await requireSession();
  return <AlertsPage filter={parseAlertFilter((await searchParams).etat)} />;
}

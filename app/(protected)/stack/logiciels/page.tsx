import type { Metadata } from "next";
import { PageNav } from "@/components/layout/page-nav";
import { CheckLine } from "@/components/stack/check-line";
import { SoftwareView } from "@/components/stack/software-view";
import { StackTabs } from "@/components/stack/stack-tabs";
import { getDb } from "@/lib/db";
import { countOpenAlerts, getCheckSummary, getSoftware } from "@/lib/stack/queries";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Logiciels · Ma stack" };
export const dynamic = "force-dynamic";

/** Ma stack › Logiciels (docs/design/3.0 § 4.1). */
export default async function SoftwarePage() {
  await requireSession();
  const db = getDb();
  const [rows, check, counts] = await Promise.all([getSoftware(db), getCheckSummary(db), countOpenAlerts(db)]);
  return (
    <div className="pb-[calc(env(safe-area-inset-bottom)+96px)] md:pb-0">
      <PageNav items={[{ label: "Ma stack", href: "/stack" }, { label: "Logiciels" }]} back={{ href: "/", mode: "any" }} />
      <h1 className="sr-only">Ma stack · Logiciels</h1>
      <div className="grid gap-3">
        <StackTabs current="logiciels" toHandle={counts.open} />
        <CheckLine
          lastCheckAt={check.lastCheckAt?.toISOString() ?? null}
          lastFullCheckAt={check.lastFullCheckAt?.toISOString() ?? null}
          failed={check.failed}
          sources={check.sources}
        />
        <SoftwareView rows={rows} />
      </div>
    </div>
  );
}

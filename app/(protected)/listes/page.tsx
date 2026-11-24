import type { Metadata } from "next";
import { PageNav } from "@/components/layout/page-nav";
import { ListsIndex } from "@/components/lists/lists-index";
import { getDb } from "@/lib/db";
import { getListExports, getListSummaries } from "@/lib/lists/queries";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Listes" };
export const dynamic = "force-dynamic";

export default async function ListsPage() {
  await requireSession();
  const db = getDb();
  const summaries = await getListSummaries(db);
  // « Copier en Markdown » (desktop rows) copies inside the click: the text must already be here.
  const exports = await getListExports(
    db,
    summaries.map((l) => l.id),
  );
  return (
    <>
      <PageNav items={[{ label: "Listes" }]} back={{ href: "/", mode: "any" }} />
      <ListsIndex initial={summaries.map((l) => ({ ...l, items: exports.get(l.id) ?? [] }))} />
    </>
  );
}

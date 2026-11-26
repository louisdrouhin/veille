import { asc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { SourcesPanel } from "@/components/admin/sources-panel";
import { SettingsPage } from "@/components/settings/settings-page";
import { getDb } from "@/lib/db";
import { forums, sources } from "@/lib/db/schema";
import { requireSession } from "@/lib/session";
import { settingsTitle } from "@/lib/settings/nav";

export const metadata: Metadata = { title: settingsTitle("sources") };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Paramètres › Sources (docs/design/3.5 § 7). ?edit=12: the form of that source. */
export default async function SourcesSettingsPage({ searchParams }: Props) {
  await requireSession();
  const query = await searchParams;
  const db = getDb();
  const [forumRows, sourceRows] = await Promise.all([
    db.select().from(forums).orderBy(asc(forums.position), asc(forums.name)),
    db
      .select({ source: sources, forumName: forums.name })
      .from(sources)
      .innerJoin(forums, eq(forums.id, sources.forumId))
      .orderBy(asc(forums.position), asc(forums.name), asc(sources.name)),
  ]);
  const list = sourceRows.map(({ source, forumName }) => ({ ...source, forumName }));
  const editId = typeof query.edit === "string" ? Number(query.edit) : NaN;
  return (
    <SettingsPage page="sources" title="Sources" description="Les flux RSS et Atom récupérés par Folders, rangés par forum." wide>
      <SourcesPanel sources={list} forums={forumRows} editing={list.find((s) => s.id === editId)} now={new Date()} />
    </SettingsPage>
  );
}

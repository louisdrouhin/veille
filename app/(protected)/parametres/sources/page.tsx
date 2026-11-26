import { asc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { parseSourceFilter, SourceErrors, SourceFilters } from "@/components/admin/source-errors";
import { sourceStatus } from "@/components/admin/source-status-badge";
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
  const now = new Date();
  const all = sourceRows.map(({ source, forumName }) => ({ ...source, forumName }));
  const editId = typeof query.edit === "string" ? Number(query.edit) : NaN;
  const filter = parseSourceFilter(query.filtre);
  const errors = all.filter((s) => sourceStatus(s, now) === "error");
  const disabled = all.filter((s) => !s.enabled);
  const list = filter === "erreur" ? errors : filter === "desactivees" ? disabled : all;
  return (
    <SettingsPage page="sources" title="Sources" description="Les flux RSS et Atom récupérés par Folders, rangés par forum." wide>
      <SourceFilters current={filter} counts={{ all: all.length, erreur: errors.length, desactivees: disabled.length }} />
      {filter !== "desactivees" && <SourceErrors sources={errors} />}
      <SourcesPanel sources={list} forums={forumRows} editing={all.find((s) => s.id === editId)} now={now} />
    </SettingsPage>
  );
}

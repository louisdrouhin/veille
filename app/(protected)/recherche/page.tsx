import { asc } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageNav } from "@/components/layout/page-nav";
import { NoteResultRow, TopicResultRow } from "@/components/search/result-row";
import { FiltersChips, FiltersColumn, type FilterChoices } from "@/components/search/search-filters";
import { SearchField } from "@/components/search/search-field";
import { IconAlertCircle, IconSparkle } from "@/components/ui/icons";
import { getDb } from "@/lib/db";
import { forums, lists, sources } from "@/lib/db/schema";
import { currentAiConfig, effectiveEnv } from "@/lib/secrets/effective";
import { parseFilters, parseQuery, PERIODS, searchHref, type SearchFilters } from "@/lib/search/filters";
import { indexProgress } from "@/lib/search/indexer";
import { exactForumCounts, exactSearch, SECTION_MAX, SECTION_SIZE, semanticSearch, type ExactResults } from "@/lib/search/query";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Recherche" };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
type Env = Partial<Record<string, string | undefined>>;

const SECTION_HEAD = "flex min-h-9 flex-wrap items-center gap-x-2 bg-bar-2 px-3.5 py-1 font-cond text-sm font-semibold tracking-caps text-bar-fg uppercase";

/**
 * Results (docs/design/3.3 § 3): prefilled field, filters, « Demander à ta veille » card, exact matches, then
 * matches by meaning (streamed: the exact ones never wait for Gemini). Nothing is written by the model from
 * here: the question page only opens on a click.
 */
export default async function SearchPage({ searchParams }: Props) {
  await requireSession();
  const params = await searchParams;
  const q = parseQuery(params);
  const filters = parseFilters(params);
  const more = typeof params.plus === "string" ? params.plus : "";
  const db = getDb();
  const env = await effectiveEnv(db);

  const [forumRows, sourceRows, listRows, progress] = await Promise.all([
    db.select({ slug: forums.slug, name: forums.name }).from(forums).orderBy(asc(forums.position), asc(forums.name)),
    db.select({ id: sources.id, name: sources.name }).from(sources).orderBy(asc(sources.name)),
    db.select({ id: lists.id, name: lists.name, color: lists.color }).from(lists).orderBy(asc(lists.position)),
    indexProgress(db, env),
  ]);

  let exact: ExactResults | null = null;
  let failed = false;
  let counts = new Map<string, number>();
  if (q) {
    try {
      [exact, counts] = await Promise.all([exactSearch(db, q, filters, { limit: more === "exact" ? SECTION_MAX : SECTION_SIZE }), exactForumCounts(db, q, filters)]);
    } catch {
      console.error("[search] recherche exacte en échec");
      failed = true;
    }
  }
  const choices: FilterChoices = { forums: forumRows.map((f) => ({ ...f, count: counts.get(f.slug) ?? 0 })), sources: sourceRows, lists: listRows };
  const indexing = progress.total > 0 && progress.indexed < progress.total;

  return (
    <div className="pb-[calc(env(safe-area-inset-bottom)+96px)] md:pb-0">
      <PageNav items={[{ label: "Recherche" }]} back={{ href: "/", mode: "any" }} />
      <h1 className="sr-only">Recherche{q ? ` : ${q}` : ""}</h1>
      <div className="flex gap-6">
        {q && (
          <aside aria-label="Filtres" className="hidden w-[230px] shrink-0 md:block">
            <FiltersColumn q={q} filters={filters} choices={choices} />
          </aside>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-3.5">
          <SearchField key={q} variant="page" initial={q} filters={filters} />
          {!q ? (
            <p className="text-base text-fg-muted">Tape des mots-clés pour chercher dans tes articles et tes notes, ou pose une question à ta veille.</p>
          ) : (
            <>
              <div className="md:hidden">
                <FiltersChips q={q} filters={filters} choices={choices} />
              </div>
              {indexing && (
                <p role="status" className="rounded-md border border-warn bg-warn-soft px-3.5 py-2.5 text-sm">
                  <strong className="font-semibold">Indexation en cours : {Math.floor((progress.indexed / progress.total) * 100)} %.</strong> Les correspondances
                  exactes sont complètes ; les résultats par le sens arrivent au fil de l&apos;indexation.
                </p>
              )}
              <AskCard q={q} filters={filters} />
              {failed ? (
                <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md border border-err bg-err-soft p-3.5 text-base text-err">
                  <IconAlertCircle size={18} />
                  <span className="flex-1">La recherche a échoué.</span>
                  <Link href={searchHref(q, filters)} className="font-semibold text-err">
                    Réessayer
                  </Link>
                </div>
              ) : (
                exact && (
                  <>
                    <ExactSection q={q} filters={filters} exact={exact} expanded={more === "exact"} />
                    <Suspense fallback={<SectionSkeleton title="Proches par le sens" />}>
                      <SemanticSection q={q} filters={filters} exact={exact} expanded={more === "sens"} env={env} />
                    </Suspense>
                  </>
                )
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function AskCard({ q, filters }: { q: string; filters: SearchFilters }) {
  return (
    <Link
      href={searchHref(q, filters, { go: "1" }, "/demander")}
      className="flex min-h-14 items-center gap-3 rounded-md border border-accent bg-surface px-3.5 py-2.5 text-fg no-underline shadow-sm hover:bg-accent-soft hover:text-fg"
    >
      <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
        <IconSparkle size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">Demander à ta veille</span>
        <span className="block truncate text-sm text-fg-muted">« {q} » : une réponse rédigée à partir de tes articles, avec leurs sources</span>
      </span>
      <kbd className="hidden font-mono text-[11.5px] text-fg-muted md:inline">Ctrl ↵</kbd>
    </Link>
  );
}

function ExactSection({ q, filters, exact, expanded }: { q: string; filters: SearchFilters; exact: ExactResults; expanded: boolean }) {
  const total = exact.topicTotal + exact.noteTotal;
  if (total === 0) return null;
  const shown = exact.topics.length + exact.notes.length;
  return (
    <section aria-labelledby="exact-title" className="overflow-hidden rounded-md border border-line bg-surface shadow-sm">
      <h2 id="exact-title" className={SECTION_HEAD}>
        Correspondances exactes · {total}
      </h2>
      <ul>
        {exact.topics.map((h) => (
          <TopicResultRow key={h.id} hit={h} />
        ))}
        {exact.notes.map((h) => (
          <NoteResultRow key={`n${h.replyId}`} hit={h} />
        ))}
      </ul>
      {!expanded && total > shown && <MoreLink href={searchHref(q, filters, { plus: "exact" })} n={Math.min(total, SECTION_MAX * 2) - shown} />}
    </section>
  );
}

async function SemanticSection({ q, filters, exact, expanded, env }: { q: string; filters: SearchFilters; exact: ExactResults; expanded: boolean; env: Env }) {
  const db = getDb();
  const sem = await semanticSearch(db, q, filters, exact.ids, { ai: await currentAiConfig(db), env, limit: expanded ? SECTION_MAX : SECTION_SIZE });
  const total = exact.topicTotal + exact.noteTotal + sem.total;
  return (
    <>
      <p aria-live="polite" className="sr-only">
        {total} résultat{total > 1 ? "s" : ""}
      </p>
      {(sem.status === "limit" || sem.status === "error") && <p className="text-sm text-fg-muted">{sem.message}</p>}
      {sem.topics.length > 0 && (
        <section aria-labelledby="sens-title" className="overflow-hidden rounded-md border border-line bg-surface shadow-sm">
          <h2 id="sens-title" className={SECTION_HEAD}>
            Proches par le sens · {sem.total}
            <span className="font-sans text-xs font-normal tracking-normal text-bar-muted normal-case">même sujet, autres mots</span>
          </h2>
          <ul>
            {sem.topics.map((h) => (
              <TopicResultRow key={h.id} hit={h} semantic />
            ))}
          </ul>
          {!expanded && sem.total > sem.topics.length && <MoreLink href={searchHref(q, filters, { plus: "sens" })} n={sem.total - sem.topics.length} />}
        </section>
      )}
      {total === 0 && <NoResult q={q} filters={filters} />}
    </>
  );
}

function NoResult({ q, filters }: { q: string; filters: SearchFilters }) {
  const period = PERIODS.find((p) => p.key === filters.period)!;
  return (
    <div className="flex flex-col items-start gap-3 rounded-md border border-dashed border-line-strong bg-surface px-4 py-5">
      <p className="text-[15px] font-semibold">Aucun résultat pour « {q} »</p>
      <p className="text-sm text-fg-muted">
        {filters.period !== "tout" ? `Sur les ${period.long}.` : "Sur toute la période."} Essaie d&apos;autres mots, ou pose la question à ta veille.
      </p>
      <div className="flex flex-wrap gap-2">
        {filters.period !== "tout" && (
          <Link href={searchHref(q, { ...filters, period: "tout" })} className="inline-flex h-11 items-center rounded-sm border border-line-strong px-3.5 text-base font-semibold text-fg no-underline md:h-9">
            Chercher sur toute la période
          </Link>
        )}
        <Link href={searchHref(q, filters, { go: "1" }, "/demander")} className="inline-flex h-11 items-center gap-1.5 rounded-sm bg-accent px-3.5 text-base font-semibold text-accent-fg no-underline hover:text-accent-fg md:h-9">
          <IconSparkle size={14} /> Demander à ta veille
        </Link>
      </div>
    </div>
  );
}

function MoreLink({ href, n }: { href: string; n: number }) {
  return (
    <Link href={href} scroll={false} className="flex min-h-11 items-center justify-center border-t border-line text-sm font-semibold text-accent no-underline hover:bg-surface-hover">
      Voir {n} autre{n > 1 ? "s" : ""} résultat{n > 1 ? "s" : ""}…
    </Link>
  );
}

function SectionSkeleton({ title }: { title: string }) {
  return (
    <section aria-busy="true" className="overflow-hidden rounded-md border border-line bg-surface shadow-sm">
      <p className={SECTION_HEAD}>{title}</p>
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex flex-col gap-2 border-t border-line px-4 py-3">
          <span className="h-4 w-2/3 animate-pulse-soft rounded-sm bg-off-soft" />
          <span className="h-3 w-full animate-pulse-soft rounded-sm bg-off-soft" />
        </div>
      ))}
    </section>
  );
}

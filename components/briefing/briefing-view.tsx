import Link from "next/link";
import { SeverityBadge } from "@/components/stack/badges";
import { IconChevronRight, IconSparkle, IconSun } from "@/components/ui/icons";
import { dayShort, dayTitle, sinceLabel } from "@/lib/briefing/format";
import type { Briefing, HistoryRow } from "@/lib/briefing/queries";
import { isEmptyBriefing, pointCount, readingMinutes, stackSentence, topicPoints, type TopicPoint } from "@/lib/briefing/types";
import { MarkBriefingSeen } from "@/lib/briefing/seen-client";
import { BriefingFooter, BriefingToc, PreparingWatcher, RetrySentences } from "./briefing-client";
import { BriefRow, TopicPointRow } from "./points";

export type BriefingPageData = {
  briefing: Briefing;
  readIds: Set<number>;
  urls: Map<number, string>;
  unread: number;
  renderedAt: number;
  timezone: string;
  next: string | null;
  previousDay: string | null;
  recent: HistoryRow[];
  settingsSummary: string;
};

const SECTION_HEAD = "flex min-h-10 items-center gap-2 bg-bar-2 px-3.5 py-1.5 md:px-4";
const SECTION_TITLE = "font-cond text-sm font-semibold tracking-caps text-bar-fg uppercase";

function AiBand({ ai }: { ai: Briefing["ai"] }) {
  if (ai === "off") return null;
  if (ai === "error")
    return <p className="border-b border-line bg-surface-alt px-3.5 py-1.5 text-[12.5px] text-fg-muted md:px-4">Résumés indisponibles : titres et nombre de sources seulement</p>;
  return (
    <p className="border-b border-line bg-surface-alt px-3.5 py-1.5 md:px-4">
      <span className="inline-flex h-5 items-center gap-1 rounded-full border border-line-strong px-[7px] text-[11.5px] font-semibold text-fg-muted">
        <IconSparkle size={11} filled strokeWidth={1} /> Généré par IA
      </span>
    </p>
  );
}

function Skeleton() {
  return (
    <ul aria-hidden className="grid gap-3 px-3.5 py-3 md:px-4">
      {[92, 76, 84].map((w) => (
        <li key={w} className="grid gap-1.5">
          <span className="h-4 animate-pulse-soft rounded-sm bg-surface-alt" style={{ width: `${w}%` }} />
          <span className="h-3 w-1/2 animate-pulse-soft rounded-sm bg-surface-alt" />
        </li>
      ))}
    </ul>
  );
}

function Section({
  id,
  title,
  count,
  nature,
  ai,
  children,
}: {
  id: string;
  title: string;
  count: number;
  nature: string;
  ai?: Briefing["ai"];
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-20 overflow-hidden rounded-md border border-line bg-surface shadow-sm">
      <div className={SECTION_HEAD}>
        <h2 id={`${id}-title`} className={SECTION_TITLE}>
          {title}
        </h2>
        <span className="font-mono text-sm text-bar-fg">{count}</span>
        <span className="ml-auto text-[12.5px] text-bar-muted">{nature}</span>
      </div>
      {ai && <AiBand ai={ai} />}
      {children}
    </section>
  );
}

/** Briefing du matin (docs/design/3.4 § 3): one <article>, h1 = the date, a section per block. */
export function BriefingView(d: BriefingPageData) {
  const b = d.briefing;
  const c = b.content;
  const preparing = b.step !== "done";
  const aiState = preparing && b.step === "ai" ? "pending" : b.ai;
  const point = (p: TopicPoint) => ({ ...p, read: d.readIds.has(p.topicId), url: d.urls.get(p.topicId) });
  const critical = c.stack.some((p) => p.severity === "critical");
  const empty = !preparing && isEmptyBriefing(c);
  const toc = [
    c.stack.length && { id: "ma-stack", label: "Ma stack", count: c.stack.length, alert: critical },
    c.featured.length && { id: "a-la-une", label: "À la une", count: c.featured.length },
    c.services.length && { id: "mes-services", label: "Mes services", count: c.services.length },
    c.brief.length && { id: "en-bref", label: "En bref", count: c.brief.length },
  ].filter((x): x is { id: string; label: string; count: number; alert?: boolean } => !!x);
  const all = topicPoints(c);
  const minutes = readingMinutes(c);

  return (
    <div className="grid gap-5 pb-[calc(env(safe-area-inset-bottom)+110px)] lg:grid-cols-[minmax(0,820px)_300px] lg:items-start lg:pb-8">
      <article aria-labelledby="briefing-title" className="flex min-w-0 flex-col gap-4">
        <PreparingWatcher preparing={preparing} />
        {!preparing && <MarkBriefingSeen day={b.day} />}
        <header className="flex flex-col gap-1">
          <p className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 font-cond text-sm font-bold tracking-caps text-accent uppercase">
              <IconSun size={16} /> Briefing du matin
            </span>
            <Link href="/briefing/historique" prefetch={false} className="inline-flex min-h-11 items-center text-sm font-semibold lg:hidden">
              Historique
            </Link>
          </p>
          <h1 id="briefing-title" className="font-cond text-2xl font-bold">
            {dayTitle(b.day)}
          </h1>
          <p className="text-sm text-fg-muted">
            Depuis {sinceLabel(b.since, d.timezone)} · {b.articleCount} article{b.articleCount > 1 ? "s" : ""}
            {!empty && ` · ${minutes} min de lecture`}
          </p>
        </header>

        {preparing && (
          <div role="status" className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-accent bg-accent-soft px-3.5 py-2.5 text-sm">
            <strong>En préparation…</strong>
            {(
              [
                ["Ma stack", b.step !== "stack"],
                ["Mes services", !["stack", "services"].includes(b.step)],
                ["Résumés", false],
              ] as const
            ).map(([label, done]) => (
              <span key={label} className={done ? "text-fg" : "text-fg-muted"}>
                {done ? "✓" : "…"} {label}
              </span>
            ))}
          </div>
        )}

        {empty ? (
          <EmptyBriefing articles={b.articleCount} previousDay={d.previousDay} />
        ) : (
          <>
            <BriefingToc items={toc} />
            {!preparing && b.ai === "error" && <RetrySentences day={b.day} />}

            {c.stack.length > 0 && (
              <Section id="ma-stack" title="Ma stack" count={c.stack.length} nature="nouvelles failles">
                <ul>
                  {c.stack.map((p) => (
                    <li key={p.alertId} className="relative flex min-h-12 items-center gap-2 border-t border-line px-3.5 py-2.5 first:border-t-0 hover:bg-surface-hover md:px-4">
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-2">
                          <SeverityBadge severity={p.severity} />
                          <Link href={`/stack/alertes/${p.alertId}`} prefetch={false} className="text-md font-bold text-fg no-underline after:absolute after:inset-0 hover:text-fg">
                            {p.title}
                          </Link>
                        </p>
                        <p className="mt-0.5 font-mono text-[13px] text-fg-muted">
                          {p.product} {p.version} · {stackSentence(p)}
                        </p>
                      </div>
                      <IconChevronRight size={16} className="shrink-0 text-fg-muted" />
                    </li>
                  ))}
                </ul>
                {c.stackOpen > c.stack.length && (
                  <p className="border-t border-line px-3.5 py-2 md:px-4">
                    <Link href="/stack/alertes" className="inline-flex min-h-11 items-center text-sm font-semibold md:min-h-0">
                      Voir les {c.stackOpen} alertes à traiter
                    </Link>
                  </p>
                )}
              </Section>
            )}

            {(c.featured.length > 0 || preparing) && (
              <Section id="a-la-une" title="À la une" count={c.featured.length} nature="les plus repris" ai={aiState}>
                {aiState === "pending" && !c.featured.length ? <Skeleton /> : <ul>{c.featured.map((p) => <TopicPointRow key={p.topicId} point={point(p)} />)}</ul>}
              </Section>
            )}
            {c.services.length > 0 && (
              <Section id="mes-services" title="Mes services" count={c.services.length} nature="nouvelles versions" ai={aiState}>
                <ul>
                  {c.services.map((p) => (
                    <TopicPointRow key={p.topicId} point={point(p)} />
                  ))}
                </ul>
              </Section>
            )}
            {c.brief.length > 0 && (
              <Section id="en-bref" title="Le reste en bref" count={c.brief.length} nature="à survoler" ai={aiState}>
                <ul>
                  {c.brief.map((p) => (
                    <BriefRow key={p.topicId} point={point(p)} />
                  ))}
                </ul>
              </Section>
            )}

            {!preparing && (
              <BriefingFooter
                topics={all.map((p) => ({ id: p.topicId, read: d.readIds.has(p.topicId), forumSlug: p.forum.slug }))}
                points={pointCount(c)}
                articles={b.articleCount}
                unread={d.unread}
                renderedAt={d.renderedAt}
                next={d.next}
              />
            )}
          </>
        )}
      </article>
      <BriefingAside current={b.day} recent={d.recent} settingsSummary={d.settingsSummary} />
    </div>
  );
}

/** « Rien de neuf » (§ 6): what was looked at; no notification was sent. */
function EmptyBriefing({ articles, previousDay }: { articles: number; previousDay: string | null }) {
  return (
    <section className="flex flex-col items-start gap-3 rounded-md border border-line bg-surface p-4 shadow-sm">
      <h2 className="font-cond text-lg font-bold">Rien de neuf depuis hier</h2>
      <p className="text-base text-fg-muted">
        {articles} article{articles > 1 ? "s" : ""} reçu{articles > 1 ? "s" : ""}. Aucune faille sur ta stack, aucun sujet repris par plusieurs sources, aucune nouvelle
        version. Pas de notification ce matin.
      </p>
      <div className="flex flex-wrap gap-2">
        {articles > 0 && (
          <Link href="/#latest-unread-title" className="inline-flex h-11 items-center rounded-sm bg-accent px-4 font-semibold text-accent-fg no-underline hover:text-accent-fg md:h-9">
            Voir les {articles} article{articles > 1 ? "s" : ""}
          </Link>
        )}
        {previousDay && (
          <Link href={`/briefing/${previousDay}`} prefetch={false} className="inline-flex h-11 items-center rounded-sm border border-line-strong px-4 font-semibold text-fg no-underline hover:text-fg md:h-9">
            Briefing d&apos;hier
          </Link>
        )}
      </div>
    </section>
  );
}

/** Desktop column (§ 3): briefings of the last 7 days, the settings, help on the context menu. */
function BriefingAside({ current, recent, settingsSummary }: { current: string; recent: HistoryRow[]; settingsSummary: string }) {
  return (
    <aside aria-label="Briefings précédents et réglages" className="hidden flex-col gap-4 lg:sticky lg:top-20 lg:flex">
      <section aria-labelledby="aside-recent" className="overflow-hidden rounded-md border border-line bg-surface shadow-sm">
        <h2 id="aside-recent" className={`${SECTION_HEAD} ${SECTION_TITLE}`}>
          Briefings précédents
        </h2>
        <ul>
          {recent.slice(0, 7).map((r) => (
            <li key={r.day} className="border-t border-line first:border-t-0">
              <Link
                href={`/briefing/${r.day}`}
                prefetch={false}
                aria-current={r.day === current ? "page" : undefined}
                className="flex items-center gap-2 px-3.5 py-2 text-sm text-fg no-underline hover:bg-surface-hover hover:text-fg aria-[current=page]:bg-accent-soft aria-[current=page]:font-semibold"
              >
                <span aria-hidden className={`size-2 shrink-0 rounded-full ${r.read ? "" : "bg-accent"}`} />
                <span className={r.read ? "" : "font-bold"}>{dayShort(r.day)}</span>
                <span className="ml-auto font-mono text-xs text-fg-muted">{r.empty ? "rien" : `${r.points} pts`}</span>
              </Link>
            </li>
          ))}
        </ul>
        <p className="border-t border-line px-3.5 py-2">
          <Link href="/briefing/historique" prefetch={false} className="text-sm font-semibold">
            Tout l&apos;historique
          </Link>
        </p>
      </section>
      <section aria-labelledby="aside-settings" className="rounded-md border border-line bg-surface p-3.5 text-sm shadow-sm">
        <h2 id="aside-settings" className="mb-1 font-semibold">
          Réglages
        </h2>
        <p className="text-fg-muted">{settingsSummary}</p>
        <Link href="/parametres/briefing" className="mt-1 inline-block font-semibold">
          Modifier
        </Link>
      </section>
      <p className="px-1 text-[12.5px] text-fg-muted">Clic droit ou ⋯ sur un point : ouvrir, enregistrer dans une liste, marquer comme lu.</p>
    </aside>
  );
}

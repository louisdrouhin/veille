import type { Metadata } from "next";
import Link from "next/link";
import { PageNav } from "@/components/layout/page-nav";
import { daysBack, dayShort, isWeekend, weekOf } from "@/lib/briefing/format";
import { recentBriefings, type HistoryRow } from "@/lib/briefing/queries";
import { localDay } from "@/lib/briefing/schedule";
import { getBriefingSettings } from "@/lib/briefing/settings";
import { getDb } from "@/lib/db";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Historique des briefings" };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ jours?: string }> };

function Row({ day, row, today, weekdays }: { day: string; row: HistoryRow | undefined; today: string; weekdays: boolean }) {
  const label = (
    <span className="flex flex-wrap items-baseline gap-x-2">
      <span className={row && !row.read ? "font-bold" : ""}>{dayShort(day)}</span>
      {day === today && <span className="rounded-full bg-accent-soft px-2 text-xs font-semibold text-accent">Aujourd&apos;hui</span>}
    </span>
  );
  if (!row)
    return (
      <li className="flex min-h-12 items-center gap-3 border-t border-line px-3.5 py-2 text-fg-muted first:border-t-0 md:px-4">
        <span aria-hidden className="size-2 shrink-0" />
        <span className="min-w-0 flex-1">
          {label}
          <span className="block text-sm">Pas de briefing{weekdays && isWeekend(day) ? " · Envoi du lundi au vendredi" : ""}</span>
        </span>
      </li>
    );
  return (
    <li className="border-t border-line first:border-t-0">
      <Link
        href={`/briefing/${day}`}
        prefetch={false}
        className={`flex min-h-12 items-center gap-3 px-3.5 py-2 no-underline hover:bg-surface-hover md:px-4 ${row.empty ? "text-fg-muted hover:text-fg-muted" : "text-fg hover:text-fg"}`}
      >
        <span aria-hidden className={`size-2 shrink-0 rounded-full ${row.read ? "" : "bg-accent"}`} />
        <span className="min-w-0 flex-1">
          {label}
          <span className="block text-sm text-fg-muted">
            {row.preparing
              ? "En préparation…"
              : row.empty
                ? "Rien de neuf"
                : `${row.points} point${row.points > 1 ? "s" : ""}${row.flaws ? ` · ${row.flaws} faille${row.flaws > 1 ? "s" : ""}` : ""}`}
          </span>
          {!row.empty && row.titles.length > 0 && <span className="block truncate text-sm">{row.titles.join(" · ")}</span>}
          {!row.read && <span className="sr-only">, non lu</span>}
        </span>
        {!row.empty && <span className="shrink-0 font-mono text-xs text-fg-muted">{row.minutes} min</span>}
      </Link>
    </li>
  );
}

/** /briefing/historique (docs/design/3.4 § 4): 7 or 30 days; in 30 days, grouped by week. */
export default async function BriefingHistoryPage({ searchParams }: Props) {
  await requireSession();
  const thirty = (await searchParams).jours === "30";
  const db = getDb();
  const s = await getBriefingSettings(db);
  const now = new Date();
  const today = localDay(now, s.timezone);
  const rows = new Map((await recentBriefings(db, thirty ? 30 : 7, now)).map((r) => [r.day, r]));
  const days = daysBack(today, thirty ? 30 : 7);
  const weeks = thirty ? [...new Set(days.map(weekOf))] : [null];
  const weekdays = s.days === "weekdays";

  return (
    <div className="mx-auto flex max-w-[820px] flex-col gap-4 pb-[calc(env(safe-area-inset-bottom)+110px)] md:pb-8">
      <PageNav items={[{ label: "Briefing", href: "/briefing" }, { label: "Historique" }]} back={{ href: "/briefing", mode: "any" }} />
      <h1 className="font-cond text-xl font-bold">Historique des briefings</h1>
      <nav aria-label="Période" className="inline-flex w-fit rounded-sm border border-line-strong bg-surface p-0.5">
        {[
          ["7 derniers jours", "/briefing/historique", !thirty],
          ["30 derniers jours", "/briefing/historique?jours=30", thirty],
        ].map(([label, href, on]) => (
          <Link
            key={String(href)}
            href={String(href)}
            aria-current={on ? "page" : undefined}
            className="inline-flex h-9 items-center rounded-sm px-3 text-sm font-semibold text-fg-muted no-underline hover:text-fg aria-[current=page]:bg-accent aria-[current=page]:text-accent-fg max-md:h-11"
          >
            {label}
          </Link>
        ))}
      </nav>
      {weeks.map((week) => (
        <section key={week ?? "all"} aria-label={week ? `Semaine du ${dayShort(week)}` : undefined} className="overflow-hidden rounded-md border border-line bg-surface shadow-sm">
          {week && <h2 className="flex min-h-9 items-center bg-bar-2 px-3.5 font-cond text-sm font-semibold tracking-caps text-bar-fg uppercase md:px-4">Semaine du {dayShort(week)}</h2>}
          <ul>
            {days
              .filter((d) => !week || weekOf(d) === week)
              .map((d) => (
                <Row key={d} day={d} row={rows.get(d)} today={today} weekdays={weekdays} />
              ))}
          </ul>
        </section>
      ))}
      <p className="text-sm text-fg-muted">Les briefings sont gardés 30 jours.</p>
    </div>
  );
}

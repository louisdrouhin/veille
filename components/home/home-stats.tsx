import { formatTime, formatTitle } from "@/lib/format-date";
import type { HomeStats as Stats } from "@/lib/home";
import { UnreadStat } from "@/components/topic/unread-counters";
import { ErrorAlert } from "./error-alert";

const ITEM =
  "flex flex-col-reverse items-center gap-0.5 px-1 py-2.5 text-center not-first:border-l not-first:border-line " +
  "md:flex-row-reverse md:items-baseline md:gap-2 md:px-0 md:py-0 md:not-first:border-0";
const LABEL = "text-[11.5px] leading-4 text-fg-muted md:text-sm";
const VALUE = "font-mono text-xl font-semibold md:text-lg";

/** Summary row: unread · received today · last fetch, plus the sources-in-error alert (docs/design/v2 § 2.1). */
export function HomeStats({ stats, renderedAt }: { stats: Stats; renderedAt?: number }) {
  const { unreadTotal, receivedToday, lastFetchAt, errorCount } = stats;
  return (
    <section aria-label="Résumé" className="flex flex-col gap-2">
      <div className="flex items-center gap-6 rounded-md border border-line bg-surface shadow-sm md:min-h-13 md:px-4">
        <dl className="grid flex-1 grid-cols-3 md:flex md:flex-none md:gap-6">
          <UnreadStat unread={unreadTotal} renderedAt={renderedAt} className={ITEM} labelClass={LABEL} valueClass={VALUE} />
          <div className={ITEM}>
            <dt className={LABEL}>reçu{receivedToday > 1 ? "s" : ""} aujourd&apos;hui</dt>
            <dd className={VALUE}>{receivedToday}</dd>
          </div>
          <div className={ITEM}>
            <dt className={LABEL}>dernière récup.</dt>
            <dd className={VALUE}>
              {lastFetchAt ? (
                <time dateTime={lastFetchAt.toISOString()} title={`dernière récupération : ${formatTitle(lastFetchAt)}`}>
                  {formatTime(lastFetchAt)}
                </time>
              ) : (
                <span title="aucune récupération réussie">—</span>
              )}
            </dd>
          </div>
        </dl>
        <ErrorAlert errorCount={errorCount} className="ml-auto max-md:hidden" />
      </div>
      <ErrorAlert errorCount={errorCount} className="md:hidden" />
    </section>
  );
}

import { PageNav } from "@/components/layout/page-nav";
import { getDb } from "@/lib/db";
import { countOpenAlerts, countTrackedSoftware, getAlerts, getCheckSummary, type AlertDetail as Detail, type AlertFilter } from "@/lib/stack/queries";
import { AlertDetail } from "./alert-detail";
import { AlertFilters, AlertList, NothingToHandle } from "./alert-list";
import { CheckLine } from "./check-line";
import { StackTabs } from "./stack-tabs";

/**
 * Ma stack › Alertes (docs/design/3.0 § 4.4-4.5). Mobile: the list, or one alert. Desktop: the list
 * (440 px) on the left, the alert on the right (the active card highlighted).
 */
export async function AlertsPage({ filter, detail }: { filter: AlertFilter; detail?: Detail }) {
  const db = getDb();
  const [list, check, counts, software] = await Promise.all([getAlerts(db, filter), getCheckSummary(db), countOpenAlerts(db), countTrackedSoftware(db)]);
  return (
    <div className="pb-[calc(env(safe-area-inset-bottom)+96px)] md:pb-0">
      <PageNav items={[{ label: "Ma stack", href: "/stack" }, { label: "Alertes", href: detail ? "/stack/alertes" : undefined }]} back={{ href: "/", mode: "any" }} />
      {!detail && <h1 className="sr-only">Ma stack · Alertes</h1>}
      <div className={`grid gap-3 ${detail ? "max-md:hidden" : ""}`}>
        <StackTabs current="alertes" toHandle={counts.open} />
        <CheckLine
          lastCheckAt={check.lastCheckAt?.toISOString() ?? null}
          lastFullCheckAt={check.lastFullCheckAt?.toISOString() ?? null}
          failed={check.failed}
          sources={check.sources}
        />
        <AlertFilters current={filter} counts={{ "a-traiter": counts.open }} />
      </div>
      <div className="mt-3 grid gap-5 md:grid-cols-[440px_minmax(0,1fr)] md:items-start">
        <div className={detail ? "max-md:hidden" : ""}>
          {list.length > 0 ? (
            <AlertList alerts={list} filter={filter} activeId={detail?.id} />
          ) : filter === "a-traiter" ? (
            <NothingToHandle software={software} lastCheckAt={check.lastCheckAt} />
          ) : (
            <p className="rounded-md border border-dashed border-line-strong bg-surface px-4 py-6 text-center text-sm text-fg-muted">
              {filter === "traitees" ? "Aucune alerte traitée pour l'instant." : "Aucune alerte ignorée."}
            </p>
          )}
        </div>
        {detail ? (
          <div className="md:rounded-md md:border md:border-line md:bg-surface md:p-5 md:shadow-sm">
            <AlertDetail alert={detail} filter={filter} />
          </div>
        ) : (
          list.length > 0 && <p className="hidden rounded-md border border-dashed border-line-strong p-6 text-center text-sm text-fg-muted md:block">Choisis une alerte pour voir le détail.</p>
        )}
      </div>
    </div>
  );
}

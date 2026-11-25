import Link from "next/link";
import { FolderIcon } from "@/components/topic/folder-icon";
import { IconArrowLeft, IconExternal } from "@/components/ui/icons";
import { formatTitle } from "@/lib/format-date";
import { SOURCE_KIND_LABEL } from "@/lib/stack/labels";
import type { AlertDetail as Detail, AlertFilter } from "@/lib/stack/queries";
import { AlertActions } from "./alert-actions";
import { ContextTag, ExploitedBadge, SEVERITY_BORDER, SEVERITY_PANEL, SEVERITY_TEXT, SeverityBadge } from "./badges";

const H2 = "font-cond text-sm font-bold tracking-caps text-fg-muted uppercase";
const day = (d: Date) => d.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "short", year: "numeric" });

/**
 * An alert, top to bottom (docs/design/3.0 § 4.5): back link, badges, French title, CVE and dates,
 * « Ton logiciel », summary, recommended action, actions in the flow, sources (the Folders topic
 * first). Texts from the sources are plain text (React escapes them).
 */
export function AlertDetail({ alert: a, filter }: { alert: Detail; filter: AlertFilter }) {
  const open = a.state === "new" || a.state === "seen";
  const back = filter === "a-traiter" ? "/stack/alertes" : `/stack/alertes?etat=${filter}`;
  const actionSource = a.textSource === "certfr" ? "d'après l'avis CERT-FR" : a.textSource === "ai" ? "Généré par IA" : "d'après les versions corrigées connues";
  return (
    <article aria-labelledby="alert-title" className="grid gap-4">
      <Link href={back} className="inline-flex h-11 w-fit items-center gap-1 text-base font-medium no-underline md:h-8 md:hidden">
        <IconArrowLeft size={14} /> Alertes
      </Link>
      <div className="grid gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <SeverityBadge severity={a.severity} cvss={a.cvss} />
          {a.exploited && <ExploitedBadge long />}
          <span className="text-sm text-fg-muted">{a.state === "new" ? "Nouvelle" : a.state === "seen" ? "Vue" : a.state === "done" ? "Traitée" : "Ignorée"}</span>
        </div>
        <h1 id="alert-title" className="font-cond text-xl leading-7 font-bold">
          {a.title}
        </h1>
        <p className="flex flex-wrap gap-x-2 text-sm text-fg-muted">
          <span className="font-mono text-fg">{a.ref}</span>
          <span>
            · publiée le <time dateTime={a.publishedAt.toISOString()} title={formatTitle(a.publishedAt)}>{day(a.publishedAt)}</time>
          </span>
          <span>
            · mise à jour le <time dateTime={a.updatedAt.toISOString()} title={formatTitle(a.updatedAt)}>{day(a.updatedAt)}</time>
          </span>
        </p>
      </div>

      <section aria-labelledby="alert-mine" className={`overflow-hidden rounded-md border bg-surface ${SEVERITY_BORDER[a.severity]}`}>
        <h2 id="alert-mine" className={`border-b px-3 py-1.5 ${H2} ${SEVERITY_PANEL[a.severity]}`}>
          Ton logiciel
        </h2>
        <div className="grid gap-2 p-3">
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{a.product}</span>
            <ContextTag context={a.context} />
          </p>
          <p className="flex flex-wrap items-baseline gap-2">
            <span className="text-sm text-fg-muted">Ta version</span>
            <span className="font-mono text-lg font-semibold">{a.version}</span>
            {open && <span className={`text-sm font-bold ${SEVERITY_TEXT[a.severity]}`}>vulnérable</span>}
          </p>
          {a.fixedVersions.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-sm text-fg-muted">Corrigé en</span>
              {a.fixedVersions.map((v) => (
                <span
                  key={v}
                  className={`inline-flex h-6 items-center rounded-sm border px-2 font-mono text-sm ${v === a.fix ? "border-ok bg-ok-soft font-semibold text-ok" : "border-line text-fg-muted"}`}
                >
                  {v}
                  {v === a.fix && <span className="sr-only"> (le plus proche de ta version)</span>}
                </span>
              ))}
            </div>
          )}
          {open && !a.itemRemoved && (
            <Link href={`/stack/logiciels?modifier=${a.itemId}`} className="inline-flex min-h-11 w-fit items-center text-base font-medium md:min-h-8">
              J&apos;ai mis à jour : changer ma version
            </Link>
          )}
        </div>
      </section>

      {a.summary && (
        <section aria-labelledby="alert-summary" className="grid gap-1.5">
          <h2 id="alert-summary" className={`flex items-center gap-2 ${H2}`}>
            Résumé
            {a.textSource === "ai" && <span className="rounded-full bg-accent-soft px-2 py-0.5 font-sans text-xs font-semibold tracking-normal text-accent normal-case">Généré par IA</span>}
            {a.summaryLang === "en" && <span className="font-sans text-xs font-normal tracking-normal normal-case">(description de la source, en anglais)</span>}
          </h2>
          <p lang={a.summaryLang} className="text-md leading-6 whitespace-pre-line">
            {a.summary}
          </p>
        </section>
      )}

      {a.actions.length > 0 && (
        <section aria-labelledby="alert-action" className="grid gap-1.5">
          <h2 id="alert-action" className={H2}>
            Action recommandée
          </h2>
          <ol className="list-decimal space-y-1 pl-5 text-md leading-6">
            {a.actions.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ol>
          <p className="text-sm text-fg-muted">{actionSource}</p>
        </section>
      )}

      <AlertActions id={a.id} state={a.state} doneAt={a.doneAt?.toISOString() ?? null} ignored={a.ignoredReason ? { reason: a.ignoredReason, note: a.ignoredNote } : null} />

      <section aria-labelledby="alert-sources" className="grid gap-1.5">
        <h2 id="alert-sources" className={H2}>
          Sources
        </h2>
        <ul className="overflow-hidden rounded-md border border-line bg-surface">
          {a.topic && (
            <li className="border-b border-line last:border-b-0">
              <Link href={`/t/${a.topic.id}`} prefetch={false} className="flex min-h-12 items-center gap-2.5 px-3 py-2 text-fg no-underline hover:bg-surface-hover hover:text-fg">
                <FolderIcon state="unread" className="shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{a.topic.title}</span>
                  <span className="block text-sm text-fg-muted">Topic Folders</span>
                </span>
              </Link>
            </li>
          )}
          {a.sources.map((s) => (
            <li key={`${s.kind}:${s.ref}`} className="border-b border-line last:border-b-0">
              <a href={s.url} target="_blank" rel="noopener noreferrer" className="flex min-h-12 items-center gap-2.5 px-3 py-2 text-fg no-underline hover:bg-surface-hover hover:text-fg">
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{SOURCE_KIND_LABEL[s.kind]}</span>
                  <span className="block truncate font-mono text-sm text-fg-muted">{s.ref}</span>
                </span>
                <IconExternal size={14} className="shrink-0 text-fg-muted" />
                <span className="sr-only">(nouvel onglet)</span>
              </a>
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}

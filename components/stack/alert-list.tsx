import Link from "next/link";
import { IconCheck, IconShieldCheck } from "@/components/ui/icons";
import { RelativeTime } from "@/components/ui/relative-time";
import { IGNORE_LABEL, SEVERITY_LABEL } from "@/lib/stack/labels";
import type { AlertCard, AlertFilter } from "@/lib/stack/queries";
import { ContextTag, ExploitedBadge, formatCvss, SeverityBadge } from "./badges";

const FILTERS: { key: AlertFilter; label: string }[] = [
  { key: "a-traiter", label: "À traiter" },
  { key: "traitees", label: "Traitées" },
  { key: "ignorees", label: "Ignorées" },
];

/** « Critique 9.8, exploitée, Nouvelle : FortiOS… » — the whole card as one name. */
export function alertLabel(a: AlertCard): string {
  const score = formatCvss(a.cvss);
  const state = a.state === "new" ? "Nouvelle" : a.state === "seen" ? "Vue" : a.state === "done" ? "Traitée" : "Ignorée";
  return `${SEVERITY_LABEL[a.severity]}${score ? ` ${score}` : ""}${a.exploited ? ", exploitée" : ""}, ${state} : ${a.title} — ${a.product} ${a.version}`;
}

/** Filters À traiter · Traitées · Ignorées (links; the current one is pressed). */
export function AlertFilters({ current, counts }: { current: AlertFilter; counts: Partial<Record<AlertFilter, number>> }) {
  return (
    <nav aria-label="État des alertes" className="flex gap-2">
      {FILTERS.map((f) => (
        <Link
          key={f.key}
          href={f.key === "a-traiter" ? "/stack/alertes" : `/stack/alertes?etat=${f.key}`}
          aria-current={current === f.key ? "page" : undefined}
          className="inline-flex h-11 items-center gap-1.5 rounded-full border border-line-strong bg-surface px-3.5 text-base font-medium text-fg no-underline hover:text-fg aria-[current=page]:border-accent aria-[current=page]:bg-accent aria-[current=page]:text-accent-fg md:h-8 md:text-sm"
        >
          {f.label}
          {counts[f.key] !== undefined && <span className="font-mono text-xs opacity-80">{counts[f.key]}</span>}
        </Link>
      ))}
    </nav>
  );
}

/**
 * One alert (docs/design/3.0 § 4.4): the whole card is a link. Line 1: severity, exploited, state;
 * line 2: title (bold when new); line 3: product, MY version, context, fix, date. Never prefetched:
 * opening an alert marks it seen.
 */
export function AlertCardLink({ alert: a, filter, active = false }: { alert: AlertCard; filter: AlertFilter; active?: boolean }) {
  const open = a.state === "new" || a.state === "seen";
  return (
    <Link
      href={`/stack/alertes/${a.id}${filter === "a-traiter" ? "" : `?etat=${filter}`}`}
      prefetch={false}
      aria-label={alertLabel(a)}
      aria-current={active ? "page" : undefined}
      className="block rounded-md border border-line bg-surface px-3 py-2.5 text-fg no-underline shadow-sm hover:bg-surface-hover hover:text-fg aria-[current=page]:border-accent aria-[current=page]:bg-accent-soft aria-[current=page]:outline-2 aria-[current=page]:outline-accent"
    >
      <span className="flex flex-wrap items-center gap-1.5">
        <SeverityBadge severity={a.severity} cvss={a.cvss} />
        {a.exploited && <ExploitedBadge />}
        <span className="ml-auto inline-flex items-center gap-1.5 text-sm">
          {a.state === "new" && (
            <>
              <span aria-hidden className="size-2 rounded-full bg-accent" />
              <span className="font-bold text-accent">Nouvelle</span>
            </>
          )}
          {a.state === "seen" && <span className="text-fg-muted">Vue</span>}
          {a.state === "done" && (
            <span className="inline-flex items-center gap-1 text-ok">
              <IconCheck size={14} /> Traitée
            </span>
          )}
          {a.state === "ignored" && a.ignoredReason && <span className="text-fg-muted">ignorée : {IGNORE_LABEL[a.ignoredReason]}</span>}
        </span>
      </span>
      <span className={`mt-1.5 block text-base leading-5 ${a.state === "new" ? "font-bold" : open ? "font-medium" : "text-fg-read"}`}>{a.title}</span>
      <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-fg-muted">
        <span className="font-semibold text-fg">{a.product}</span>
        <span className="font-mono">{a.version}</span>
        <ContextTag context={a.context} />
        {a.fix && open && <span>· corrigé en <span className="font-mono">{a.fix}</span></span>}
        <span>
          · <RelativeTime date={open ? a.publishedAt : (a.doneAt ?? a.publishedAt)} />
        </span>
      </span>
    </Link>
  );
}

export function AlertList({ alerts, filter, activeId }: { alerts: AlertCard[]; filter: AlertFilter; activeId?: number }) {
  return (
    <ul className="grid gap-2" aria-label="Alertes">
      {alerts.map((a) => (
        <li key={a.id}>
          <AlertCardLink alert={a} filter={filter} active={a.id === activeId} />
        </li>
      ))}
    </ul>
  );
}

/** « Rien à traiter » (§ 6). */
export function NothingToHandle({ software, lastCheckAt }: { software: number; lastCheckAt: Date | null }) {
  return (
    <div className="flex flex-col items-center gap-2.5 rounded-md border border-dashed border-line-strong bg-surface px-5 py-8 text-center">
      <IconShieldCheck size={40} strokeWidth={1.2} className="text-ok" />
      <p className="text-[15px] font-semibold">Rien à traiter</p>
      <p className="max-w-[300px] text-sm text-fg-muted">
        Aucune faille connue ne touche tes {software} logiciel{software > 1 ? "s" : ""}.
        {lastCheckAt && (
          <>
            {" "}
            Vérifié <RelativeTime date={lastCheckAt} />.
          </>
        )}
      </p>
      <Link href="/stack/alertes?etat=traitees" className="inline-flex min-h-11 items-center text-base font-medium">
        Voir les alertes traitées
      </Link>
    </div>
  );
}

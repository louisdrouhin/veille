import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { IconAlert, IconRefresh } from "@/components/ui/icons";
import { RelativeTime } from "@/components/ui/relative-time";
import { SubmitButton } from "@/components/ui/submit-button";
import { fetchSourceNow } from "@/lib/actions/admin";
import type { Source } from "@/lib/db/schema";
import { plural } from "@/lib/format-date";

export const SOURCE_FILTERS = [
  { key: null, label: "Toutes" },
  { key: "erreur", label: "En erreur" },
  { key: "desactivees", label: "Désactivées" },
] as const;
export type SourceFilter = (typeof SOURCE_FILTERS)[number]["key"];
export const parseSourceFilter = (v: unknown): SourceFilter => (v === "erreur" || v === "desactivees" ? v : null);

/** A readable cause: « HTTP 404 », « délai dépassé »… as stored by the worker (lib/feeds), never rewritten. */
const cause = (s: Source) => s.lastError?.trim() || "erreur inconnue";

/** Filters of Paramètres › Sources (docs/design/3.5 § 7), in the URL (?filtre=erreur), with their counts. */
export function SourceFilters({ current, counts }: { current: SourceFilter; counts: Record<"all" | "erreur" | "desactivees", number> }) {
  return (
    <nav aria-label="Filtrer les sources" className="inline-flex w-full rounded-sm border border-line-strong bg-surface p-0.5 md:w-fit">
      {SOURCE_FILTERS.map((f) => (
        <Link
          key={f.label}
          href={f.key ? `/parametres/sources?filtre=${f.key}` : "/parametres/sources"}
          aria-current={current === f.key ? "page" : undefined}
          className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-sm px-3 text-sm font-semibold text-fg-muted no-underline hover:text-fg aria-[current=page]:bg-accent aria-[current=page]:text-accent-fg max-md:h-11 md:flex-none"
        >
          {f.label}
          <span className="font-mono text-xs">{counts[f.key ?? "all"]}</span>
        </Link>
      ))}
    </nav>
  );
}

/**
 * « En erreur » first (docs/design/3.5 § 7): --err frame, each source with its precise cause (« HTTP 404 · 12 échecs,
 * dernière récupération réussie il y a 2 jours »), Réessayer and Modifier. Same count as the menu badge.
 */
export function SourceErrors({ sources }: { sources: (Source & { forumName: string })[] }) {
  if (!sources.length) return null;
  return (
    <section aria-labelledby="source-errors" className="overflow-hidden rounded-md border-2 border-err bg-surface shadow-sm">
      <h2 id="source-errors" className="flex min-h-10 items-center gap-2 bg-err-soft px-3.5 font-cond text-sm font-bold tracking-caps text-err uppercase">
        <IconAlert size={15} /> En erreur · {sources.length}
      </h2>
      <ul>
        {sources.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line px-3.5 py-2.5 first:border-t-0">
            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                {s.name} <span className="text-sm font-normal text-fg-muted">· {s.forumName}</span>
              </p>
              <p className="text-sm text-err">
                <span className="font-mono">{cause(s)}</span> · {plural(s.consecutiveFailures, "échec")} consécutif{s.consecutiveFailures > 1 ? "s" : ""}
              </p>
              <p className="text-xs text-fg-muted">
                {s.lastFetchedAt ? (
                  <>
                    Dernière récupération réussie <RelativeTime date={s.lastFetchedAt} />
                  </>
                ) : (
                  "Jamais récupérée"
                )}
              </p>
            </div>
            <div className="flex gap-2">
              <form action={fetchSourceNow}>
                <input type="hidden" name="id" value={s.id} />
                <SubmitButton variant="secondary" className="max-md:min-h-11">
                  <IconRefresh size={14} /> Réessayer
                </SubmitButton>
              </form>
              <Link href={`/parametres/sources?edit=${s.id}#source-form`} className={`${buttonClass("secondary")} max-md:min-h-11`}>
                Modifier
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

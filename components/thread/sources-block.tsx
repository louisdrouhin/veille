import { RelativeTime } from "@/components/ui/relative-time";
import { SourceAvatar } from "@/components/ui/source-avatar";

export type SourceLine = { n: number; name: string; faviconSrc: string | null; url: string; at: Date };

/**
 * « Sources · N » of a merged topic (docs/design/3.3 § 2): one line per source — avatar, name, #n (anchor to its
 * message), date, ↗ to the original article (new tab). Under the action bar on mobile, sticky column on desktop.
 */
export function SourcesBlock({ sources, className = "" }: { sources: SourceLine[]; className?: string }) {
  if (sources.length < 2) return null;
  return (
    <section aria-labelledby="sources-title" className={`overflow-hidden rounded-md border border-line bg-surface shadow-sm ${className}`}>
      <h2 id="sources-title" className="flex min-h-9 items-center bg-bar-2 px-3.5 font-cond text-sm font-semibold tracking-caps text-bar-fg uppercase">
        Sources · {sources.length}
      </h2>
      <ul>
        {sources.map((s) => (
          <li key={s.n} className="flex min-h-11 items-center gap-2.5 border-t border-line px-3.5 py-1.5 first:border-t-0">
            <SourceAvatar name={s.name} src={s.faviconSrc} size={20} />
            <a href={`#p${s.n}`} className="flex min-w-0 flex-1 items-baseline gap-1.5 text-fg no-underline hover:text-fg">
              <span className="truncate text-base font-semibold">{s.name}</span>
              <span className="font-mono text-xs text-fg-muted">#{s.n}</span>
            </a>
            <RelativeTime date={s.at} className="shrink-0 text-xs text-fg-muted" />
            <a
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Article d'origine sur ${s.name} (nouvel onglet)`}
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-sm text-fg-muted no-underline hover:bg-surface-hover hover:text-fg max-md:size-11"
            >
              ↗
            </a>
          </li>
        ))}
      </ul>
      <p className="border-t border-line px-3.5 py-2 text-xs text-fg-muted">
        Regroupés automatiquement, car ils parlent du même sujet. Pas le même sujet ? « Séparer » dans le menu ⋯ du message.
      </p>
    </section>
  );
}

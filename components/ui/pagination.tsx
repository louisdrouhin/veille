import Link from "next/link";

/** Page numbers to show: everything up to 7 pages, otherwise first, last, current ± 1 with gaps. */
export function pageItems(page: number, pageCount: number): (number | "gap")[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);
  const keep = [...new Set([1, page - 1, page, page + 1, pageCount])]
    .filter((p) => p >= 1 && p <= pageCount)
    .sort((a, b) => a - b);
  const items: (number | "gap")[] = [];
  keep.forEach((p, i) => {
    if (i > 0 && p - keep[i - 1]! > 1) items.push("gap");
    items.push(p);
  });
  return items;
}

const CELL = "inline-flex min-w-8 h-8 items-center justify-center rounded-sm border px-1.5 font-mono text-sm no-underline";
const LINK = `${CELL} border-line bg-surface text-fg hover:bg-surface-hover hover:text-fg`;
const DISABLED = `${CELL} border-line bg-surface text-line-strong`;
const CURRENT = `${CELL} border-transparent bg-accent font-semibold text-accent-fg`;
const MOBILE = "inline-flex h-11 items-center rounded-sm border border-line bg-surface px-3 text-sm font-medium no-underline";

export function Pagination({
  page,
  pageCount,
  href,
  label,
}: {
  page: number;
  pageCount: number;
  href: (p: number) => string;
  label: string;
}) {
  if (pageCount <= 1) return null;
  const prev = page > 1 ? page - 1 : null;
  const next = page < pageCount ? page + 1 : null;

  return (
    <nav aria-label={label} className="flex items-center gap-1">
      {/* Desktop: numbered */}
      <div className="hidden items-center gap-1 md:flex">
        {prev ? (
          <Link href={href(prev)} className={LINK} rel="prev" aria-label="Page précédente">
            ‹
          </Link>
        ) : (
          <span className={DISABLED} aria-disabled="true">
            ‹
          </span>
        )}
        {pageItems(page, pageCount).map((p, i) =>
          p === "gap" ? (
            <span key={`gap-${i}`} className="px-1 font-mono text-sm text-fg-muted" aria-hidden="true">
              …
            </span>
          ) : p === page ? (
            <span key={p} aria-current="page" className={CURRENT}>
              {p}
            </span>
          ) : (
            <Link key={p} href={href(p)} className={LINK} aria-label={`Page ${p}`}>
              {p}
            </Link>
          ),
        )}
        {next ? (
          <Link href={href(next)} className={LINK} rel="next" aria-label="Page suivante">
            ›
          </Link>
        ) : (
          <span className={DISABLED} aria-disabled="true">
            ›
          </span>
        )}
      </div>

      {/* Mobile: prev / n of N / next */}
      <div className="flex items-center gap-2 md:hidden">
        {prev ? (
          <Link href={href(prev)} className={`${MOBILE} text-fg`} rel="prev">
            ‹ Préc.
          </Link>
        ) : (
          <span className={`${MOBILE} text-line-strong`} aria-disabled="true">
            ‹ Préc.
          </span>
        )}
        <span className="font-mono text-sm text-fg-muted">
          {page} / {pageCount}
        </span>
        {next ? (
          <Link href={href(next)} className={`${MOBILE} text-fg`} rel="next">
            Suiv. ›
          </Link>
        ) : (
          <span className={`${MOBILE} text-line-strong`} aria-disabled="true">
            Suiv. ›
          </span>
        )}
      </div>
    </nav>
  );
}

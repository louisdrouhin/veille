import Link from "next/link";

export function Pagination({ page, pageCount, href }: { page: number; pageCount: number; href: (p: number) => string }) {
  if (pageCount <= 1) return null;
  const pages = new Set([1, pageCount, page - 2, page - 1, page, page + 1, page + 2].filter((p) => p >= 1 && p <= pageCount));
  const sorted = [...pages].sort((a, b) => a - b);

  return (
    <nav aria-label="Pages" className="flex flex-wrap items-center gap-1 text-[0.85rem]">
      <span className="text-gray-600">Page :</span>
      {page > 1 && (
        <Link className="btn" href={href(page - 1)} rel="prev">
          «
        </Link>
      )}
      {sorted.map((p, i) => (
        <span key={p} className="flex items-center gap-1">
          {i > 0 && p - sorted[i - 1]! > 1 && <span>…</span>}
          {p === page ? (
            <span aria-current="page" className="px-1 font-bold">
              {p}
            </span>
          ) : (
            <Link href={href(p)} className="px-1">
              {p}
            </Link>
          )}
        </span>
      ))}
      {page < pageCount && (
        <Link className="btn" href={href(page + 1)} rel="next">
          »
        </Link>
      )}
    </nav>
  );
}

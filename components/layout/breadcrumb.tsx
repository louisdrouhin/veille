import Link from "next/link";
import { Fragment } from "react";

export function Breadcrumb({ items, className = "mb-3" }: { items: { label: string; href?: string }[]; className?: string }) {
  const all = [{ label: "Accueil", href: "/" }, ...items];
  return (
    <nav aria-label="Fil d'Ariane" className={className}>
      <ol className="flex flex-wrap items-center gap-1.5 text-sm text-fg-muted">
        {all.map((item, i) => {
          const last = i === all.length - 1;
          return (
            <Fragment key={i}>
              {i > 0 && (
                <li aria-hidden="true" className="text-line-strong">
                  ›
                </li>
              )}
              <li className={last ? "min-w-0" : ""}>
                {last ? (
                  <span aria-current="page" className="block max-w-[min(520px,70vw)] truncate font-medium text-fg">
                    {item.label}
                  </span>
                ) : (
                  <Link href={item.href!}>{item.label}</Link>
                )}
              </li>
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}

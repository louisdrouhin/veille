import Link from "next/link";
import { Fragment } from "react";

export function Breadcrumb({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Fil d'Ariane" className="mb-2 text-[0.9rem]">
      <Link href="/">Accueil</Link>
      {items.map((item, i) => (
        <Fragment key={i}>
          <span className="mx-1 text-gray-500">›</span>
          {item.href ? <Link href={item.href}>{item.label}</Link> : <strong>{item.label}</strong>}
        </Fragment>
      ))}
    </nav>
  );
}

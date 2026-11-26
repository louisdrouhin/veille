import Link from "next/link";

const ITEMS = [
  { key: "profil", label: "Profil", href: "/compte#profil" },
  { key: "apparence", label: "Apparence", href: "/compte#apparence" },
  { key: "notifications", label: "Notifications", href: "/compte/notifications" },
  // The page stays in the admin (docs/design/3.4 § 7): a link, not a page of Mon compte.
  { key: "integrations", label: "Intégrations", href: "/admin/integrations" },
  { key: "securite", label: "Sécurité", href: "/compte#securite" },
] as const;

/** Sub-navigation of Mon compte, desktop (docs/design/3.4 § 7): Profil · Apparence · Notifications · Intégrations · Sécurité. */
export function AccountNav({ current }: { current: (typeof ITEMS)[number]["key"] }) {
  return (
    <nav aria-label="Mon compte" className="mb-4 hidden border-b border-line md:block">
      <ul className="flex gap-1">
        {ITEMS.map((it) => (
          <li key={it.key}>
            <Link
              href={it.href}
              aria-current={it.key === current ? "page" : undefined}
              className="inline-flex h-9 items-center border-b-2 border-transparent px-3 text-sm font-semibold text-fg-muted no-underline hover:text-fg aria-[current=page]:border-accent aria-[current=page]:text-fg"
            >
              {it.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

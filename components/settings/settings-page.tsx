import Link from "next/link";
import { IconArrowLeft } from "@/components/ui/icons";
import { FocusHeading, LegacyAnchor } from "./settings-client";
import type { SettingsKey } from "@/lib/settings/nav";

/**
 * A page of Paramètres (docs/design/3.5 § 3, § 8): « ‹ Paramètres » on mobile (44 px), the title (focused on each
 * page change), its description, then the blocks. Desktop: 700 px column next to the side menu.
 */
export function SettingsPage({ page, title, description, children, wide = false }: { page: SettingsKey; title: string; description?: React.ReactNode; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`flex min-w-0 flex-1 flex-col gap-4 pb-[calc(env(safe-area-inset-bottom)+110px)] md:pb-8 ${wide ? "" : "md:max-w-[700px]"}`}>
      <LegacyAnchor page={page} />
      <Link href="/parametres" className="-ml-1 inline-flex min-h-11 w-fit items-center gap-1 px-1 text-sm font-semibold no-underline md:hidden">
        <IconArrowLeft size={16} /> Paramètres
      </Link>
      <header>
        <FocusHeading>{title}</FocusHeading>
        {description && <p className="mt-1 max-w-[72ch] text-base text-fg-muted">{description}</p>}
      </header>
      {children}
    </div>
  );
}

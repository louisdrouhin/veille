import Link from "next/link";
import { SEVERITY_PANEL, SeverityBadge } from "@/components/stack/badges";
import { IconChevronRight, IconShield } from "@/components/ui/icons";
import type { HomeStack } from "@/lib/stack/queries";

/**
 * « Ma stack » on the home page (docs/design/3.0 § 4.6), above the stats: one link of 56 px at least,
 * tinted by the worst severity of the alerts to handle. Absent when there is nothing to handle.
 */
export function StackBlock({ stack }: { stack: HomeStack | null }) {
  if (!stack) return null;
  return (
    <Link
      href="/stack/alertes"
      className={`flex min-h-14 items-center gap-3 rounded-md border px-3 py-2.5 text-fg no-underline shadow-sm hover:text-fg hover:brightness-[.98] ${SEVERITY_PANEL[stack.severity]}`}
    >
      <span aria-hidden className="inline-flex size-10 shrink-0 items-center justify-center rounded-md bg-surface text-fg">
        <IconShield size={20} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="font-cond text-xs font-bold tracking-caps text-fg-muted uppercase">Ma stack</span>
          <SeverityBadge severity={stack.severity} />
        </span>
        <span className="mt-0.5 block text-base font-bold">{stack.title}</span>
        <span className="block truncate font-mono text-sm text-fg-muted">{stack.products}</span>
      </span>
      <IconChevronRight size={18} className="shrink-0" />
    </Link>
  );
}

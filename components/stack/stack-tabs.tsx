import Link from "next/link";

/** Segmented control Alertes / Logiciels (docs/design/3.0 § 4.1): two links, the current one pressed. */
export function StackTabs({ current, toHandle }: { current: "alertes" | "logiciels"; toHandle?: number }) {
  const tab = (key: "alertes" | "logiciels", href: string, label: React.ReactNode) => (
    <Link
      href={href}
      aria-current={current === key ? "page" : undefined}
      className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-sm px-4 text-base font-semibold text-fg-muted no-underline hover:text-fg aria-[current=page]:bg-surface aria-[current=page]:text-fg aria-[current=page]:shadow-sm md:h-9 md:flex-none"
    >
      {label}
    </Link>
  );
  return (
    <nav aria-label="Ma stack" className="flex w-full rounded-md border border-line bg-surface-alt p-1 md:w-auto">
      {tab(
        "alertes",
        "/stack/alertes",
        <>
          Alertes
          {toHandle ? (
            <span className="rounded-full bg-accent px-1.5 font-mono text-xs leading-[18px] font-semibold text-accent-fg">
              {toHandle}
              <span className="sr-only"> à traiter</span>
            </span>
          ) : null}
        </>,
      )}
      {tab("logiciels", "/stack/logiciels", "Logiciels")}
    </nav>
  );
}

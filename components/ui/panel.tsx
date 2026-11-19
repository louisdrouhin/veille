/** Panel with a dark (bar-2) title bar, used by the admin and forms. */
export function Panel({
  id,
  title,
  action,
  children,
  className = "",
}: {
  id?: string;
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const titleId = id ? `${id}-title` : undefined;
  return (
    <section id={id} aria-labelledby={titleId} className={`scroll-mt-4 overflow-hidden rounded-md border border-line bg-surface shadow-sm ${className}`}>
      <div className="flex min-h-10 items-center justify-between gap-3 bg-bar-2 px-3.5 py-1.5">
        <h2 id={titleId} className="font-cond text-sm font-semibold tracking-caps text-bar-fg uppercase">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Light button for a dark panel header. */
export const BAR_BUTTON =
  "inline-flex h-7 items-center gap-1.5 rounded-sm border border-white/28 px-2.5 text-sm font-medium text-bar-fg no-underline hover:bg-white/8 hover:text-bar-fg max-md:h-11 focus-visible:outline-bar-accent";

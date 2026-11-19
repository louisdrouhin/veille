export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2.5 rounded-md border border-dashed border-line-strong bg-surface px-5 py-8 text-center">
      <div className="text-fg-muted">{icon}</div>
      <p className="text-[15px] font-semibold">{title}</p>
      {children && <p className="max-w-[260px] text-sm text-fg-muted">{children}</p>}
      {action}
    </div>
  );
}

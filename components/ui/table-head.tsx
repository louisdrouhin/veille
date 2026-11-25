/** Column headers bar (md+ only, decorative: aria-hidden). `grid` must match the rows' md grid. */
export function TableHead({
  grid,
  columns,
  className = "",
  alwaysVisible = false,
}: {
  grid: string;
  columns: { label: string; align?: "left" | "right" | "center"; className?: string }[];
  className?: string;
  alwaysVisible?: boolean;
}) {
  return (
    <div
      aria-hidden="true"
      className={`${alwaysVisible ? "grid" : "hidden md:grid"} h-8 items-center gap-x-3 bg-bar-2 px-4 font-cond text-xs font-semibold uppercase tracking-caps text-bar-muted ${grid} ${className}`}
    >
      {columns.map((c, i) => (
        <span key={i} className={`${c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : ""} ${c.className ?? ""}`}>
          {c.label}
        </span>
      ))}
    </div>
  );
}

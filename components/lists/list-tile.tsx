import { LIST_BORDER, LIST_TEXT, type ListColor } from "@/lib/lists/palette";

/** Bookmark tile of a list (docs/design/v3 § 3.5): colored border and a bookmark filled with the list color. */
export function ListTile({ color, size = 36, className = "" }: { color: ListColor; size?: number; className?: string }) {
  const icon = Math.round(size * 0.5);
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-md border-2 bg-surface ${LIST_BORDER[color]} ${LIST_TEXT[color]} ${className}`}
      style={{ width: size, height: size }}
    >
      <svg width={icon} height={icon} viewBox="0 0 16 16" className="fill-current">
        <path d="M4 1.75h8c.41 0 .75.34.75.75v11.6a.4.4 0 0 1-.64.32L8 11.3l-4.11 3.12a.4.4 0 0 1-.64-.32V2.5c0-.41.34-.75.75-.75z" />
      </svg>
    </span>
  );
}

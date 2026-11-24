import { LIST_BG, type ListColor } from "@/lib/lists/palette";

/** Color dot of a list (rounded square). Decorative: the list name is always shown next to it. */
export function ListSwatch({ color, size = 10, className = "" }: { color: ListColor; size?: number; className?: string }) {
  return <span aria-hidden="true" className={`inline-block shrink-0 rounded-[3px] ${LIST_BG[color]} ${className}`} style={{ width: size, height: size }} />;
}

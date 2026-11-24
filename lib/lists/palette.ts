/**
 * Colors of the favorite lists (docs/design/v3 § 4): 8 tokens (--list-*), each readable as text
 * on every surface in both themes. Class names are written out in full so that Tailwind generates
 * them (never build `bg-list-${color}`).
 */
export const LIST_COLORS = ["slate", "blue", "teal", "green", "mustard", "orange", "rose", "violet"] as const;
export type ListColor = (typeof LIST_COLORS)[number];

export const LIST_COLOR_LABELS: Record<ListColor, string> = {
  slate: "Ardoise",
  blue: "Bleu",
  teal: "Sarcelle",
  green: "Vert",
  mustard: "Moutarde",
  orange: "Orange",
  rose: "Framboise",
  violet: "Violet",
};

export const LIST_BG: Record<ListColor, string> = {
  slate: "bg-list-slate",
  blue: "bg-list-blue",
  teal: "bg-list-teal",
  green: "bg-list-green",
  mustard: "bg-list-mustard",
  orange: "bg-list-orange",
  rose: "bg-list-rose",
  violet: "bg-list-violet",
};

export const LIST_TEXT: Record<ListColor, string> = {
  slate: "text-list-slate",
  blue: "text-list-blue",
  teal: "text-list-teal",
  green: "text-list-green",
  mustard: "text-list-mustard",
  orange: "text-list-orange",
  rose: "text-list-rose",
  violet: "text-list-violet",
};

export const LIST_BORDER: Record<ListColor, string> = {
  slate: "border-list-slate",
  blue: "border-list-blue",
  teal: "border-list-teal",
  green: "border-list-green",
  mustard: "border-list-mustard",
  orange: "border-list-orange",
  rose: "border-list-rose",
  violet: "border-list-violet",
};

export function isListColor(value: unknown): value is ListColor {
  return typeof value === "string" && (LIST_COLORS as readonly string[]).includes(value);
}

/** Color of a new list: the first one of the palette not used yet, then round again. */
export function nextListColor(used: readonly string[]): ListColor {
  const free = LIST_COLORS.find((c) => !used.includes(c));
  return free ?? LIST_COLORS[used.length % LIST_COLORS.length]!;
}

export const LIST_NAME_MAX = 60;

/** Trimmed name, or null when empty or longer than LIST_NAME_MAX (same rule as the database check). */
export function cleanListName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ");
  return name.length >= 1 && name.length <= LIST_NAME_MAX ? name : null;
}

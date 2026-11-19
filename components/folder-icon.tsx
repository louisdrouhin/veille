// v2 will add a "hot" (red) variant.
export type FolderState = "unread" | "read";

const COLORS: Record<FolderState, { body: string; tab: string; edge: string; label: string }> = {
  unread: { body: "#f2c230", tab: "#e0ad1c", edge: "#a87d0c", label: "Non lu" },
  read: { body: "#d2d0ca", tab: "#bdbab2", edge: "#8e8b83", label: "Lu" },
};

export function FolderIcon({ state }: { state: FolderState }) {
  const c = COLORS[state];
  return (
    <svg width="18" height="14" viewBox="0 0 18 14" role="img" aria-label={c.label} className="inline-block">
      <title>{c.label}</title>
      <path d="M1 2.5h5.5l1.5 1.5h9v9.5H1z" fill={c.tab} stroke={c.edge} />
      <path d="M1 5h16v8.5H1z" fill={c.body} stroke={c.edge} />
      <path d="M2 6h14" stroke="#fff" strokeOpacity="0.55" />
    </svg>
  );
}

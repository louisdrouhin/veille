export type FolderState = "unread" | "read" | "hot" | "hot-read";

const LABELS: Record<FolderState, string> = {
  unread: "Non lu",
  read: "Lu",
  hot: "Chaud, non lu",
  "hot-read": "Chaud, lu",
};

const FILLED =
  "M2.5 5.25c0-.69.56-1.25 1.25-1.25h3.6c.33 0 .65.13.88.37L9.6 5.75h6.65c.69 0 1.25.56 1.25 1.25v8.25c0 .69-.56 1.25-1.25 1.25H3.75c-.69 0-1.25-.56-1.25-1.25z";
const OUTLINE =
  "M3.25 5.25c0-.28.22-.5.5-.5h3.6c.13 0 .26.05.35.15l1.9 1.6h6.65c.28 0 .5.22.5.5v8.25c0 .28-.22.5-.5.5H3.75a.5.5 0 0 1-.5-.5z";
const FLAME = "M10 7.6c.2 1 .9 1.6 1.6 2.3.6.6 1 1.3 1 2.2a2.6 2.6 0 0 1-5.2 0c0-.8.3-1.4.8-1.9.1.6.4 1 .9 1.2-.2-1.4.2-2.7.9-3.8z";

/** Unread: filled folder; read: outline. Hot (v2): red, with a flame. Never color alone. */
export function FolderIcon({ state, size = 20, className = "" }: { state: FolderState; size?: number; className?: string }) {
  const hot = state === "hot" || state === "hot-read";
  const filled = state === "unread" || state === "hot";
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" role="img" aria-label={LABELS[state]} className={`shrink-0 ${className}`}>
      {filled ? (
        <>
          <path d={FILLED} className={hot ? "fill-hot" : "fill-folder"} />
          <path d="M2.5 8.5h15" stroke="var(--surface)" strokeOpacity=".45" />
          {hot && <path d={FLAME} className="fill-hot-flame" />}
        </>
      ) : (
        <>
          <path d={OUTLINE} fill="none" strokeWidth="1.5" className={hot ? "stroke-hot" : "stroke-folder-read"} />
          {hot && <path d={FLAME} className="fill-hot" />}
        </>
      )}
    </svg>
  );
}

export function FolderLegend({ states = ["unread", "read"] }: { states?: FolderState[] }) {
  return (
    <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 border-t border-dashed border-line pt-1.5 text-xs text-fg-muted">
      {states.map((s) => (
        <li key={s} className="flex items-center gap-1.5">
          <FolderIcon state={s} size={16} />
          <span aria-hidden="true">{LABELS[s]}</span>
        </li>
      ))}
    </ul>
  );
}

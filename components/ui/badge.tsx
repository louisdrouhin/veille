import type { ReplyType } from "@/lib/db/schema";
import { IconChat, IconNote, IconRepost } from "./icons";

const CAPS = "font-cond text-2xs font-bold uppercase tracking-caps";

/** « Chaud » badge (v2). */
export function HotBadge({ label = "Chaud", className = "" }: { label?: string; className?: string }) {
  return (
    <span className={`shrink-0 rounded-sm border border-hot bg-hot-soft px-1.25 text-hot ${CAPS} ${className}`}>{label}</span>
  );
}

export type PostType = "topic" | ReplyType;

const POST_TYPES: Record<PostType, { label: string; className: string; icon?: React.ReactNode }> = {
  topic: { label: "Article", className: "bg-accent-soft text-accent" },
  note: { label: "Note perso", className: "bg-accent text-accent-fg", icon: <IconNote size={11} /> },
  source: { label: "Reprise", className: "bg-off-soft text-fg-muted", icon: <IconRepost size={11} /> },
  comment: { label: "Commentaire", className: "bg-off-soft text-fg-muted", icon: <IconChat size={11} /> },
};

export function PostTypeBadge({ type }: { type: PostType }) {
  const t = POST_TYPES[type];
  return (
    <span className={`inline-flex h-4.5 items-center gap-1 rounded-sm px-1.5 ${CAPS} ${t.className}`}>
      {t.icon}
      {t.label}
    </span>
  );
}

/** Platform badge under a commenter's name (v2: « Hacker News », « Reddit »). */
export function PlatformBadge({ name }: { name: string }) {
  return (
    <span className="rounded-full border border-line-strong px-2 font-mono text-[11px] font-semibold text-fg-muted">
      {name}
    </span>
  );
}

/** Unread counter pill, with a screen-reader label. */
export function CountPill({ count, srLabel }: { count: number; srLabel: string }) {
  if (count === 0) {
    return (
      <span className="font-mono text-sm text-fg-read">
        0<span className="sr-only"> {srLabel}</span>
      </span>
    );
  }
  return (
    <span className="inline-block min-w-7 rounded-full bg-accent px-2 text-center font-mono text-sm font-semibold leading-[22px] text-accent-fg">
      {count}
      <span className="sr-only"> {srLabel}</span>
    </span>
  );
}

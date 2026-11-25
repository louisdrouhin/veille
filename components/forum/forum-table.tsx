import Link from "next/link";
import { ForumUnreadPill } from "@/components/topic/unread-counters";
import { RelativeTime } from "@/components/ui/relative-time";
import { TableHead } from "@/components/ui/table-head";
import type { ForumIconName } from "@/lib/db/schema";
import { ForumIconTile } from "./forum-icon";

export type ForumRowData = {
  id: number;
  name: string;
  slug: string;
  description: string;
  icon: ForumIconName;
  total: number;
  unread: number;
  lastTopic: { id: number; title: string; sourceName: string | null; at: Date } | null;
};

const GRID = "md:grid-cols-[40px_minmax(0,1fr)_80px_88px_280px]";

export function ForumTable({ forums, renderedAt }: { forums: ForumRowData[]; renderedAt?: number }) {
  return (
    <div className="overflow-hidden rounded-md border border-line bg-surface shadow-sm">
      <TableHead
        grid={GRID}
        columns={[
          { label: "" },
          { label: "Forum" },
          { label: "Topics", align: "right" },
          { label: "Non lus", align: "center" },
          { label: "Dernier topic" },
        ]}
      />
      <ul>
        {forums.map((f) => (
          <ForumRow key={f.id} forum={f} renderedAt={renderedAt} />
        ))}
      </ul>
    </div>
  );
}

function ForumRow({ forum: f, renderedAt }: { forum: ForumRowData; renderedAt?: number }) {
  const hasUnread = f.unread > 0;
  return (
    <li
      className={`relative grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-x-3 border-t border-line px-3.5 py-3 first:border-t-0 odd:bg-surface even:bg-surface-alt hover:bg-surface-hover has-[a:focus-visible]:outline-2 has-[a:focus-visible]:-outline-offset-2 has-[a:focus-visible]:outline-focus md:px-4 ${GRID}`}
    >
      <ForumIconTile icon={f.icon} active={hasUnread} />
      <div className="min-w-0">
        <Link
          href={`/f/${f.slug}`}
          className={`text-[15px] text-fg no-underline after:absolute after:inset-0 hover:text-fg focus-visible:outline-none ${
            hasUnread ? "font-bold" : "font-medium"
          }`}
        >
          {f.name}
        </Link>
        {f.description && <p className="truncate text-sm text-fg-muted">{f.description}</p>}
      </div>
      <span className="hidden text-right font-mono text-sm md:block">{f.total}</span>
      <span className="text-right md:text-center">
        <ForumUnreadPill unread={f.unread} renderedAt={renderedAt} slug={f.slug} />
      </span>
      <div className="hidden min-w-0 md:block">
        {f.lastTopic ? (
          <>
            <p className="truncate text-sm">{f.lastTopic.title}</p>
            <p className="truncate text-xs text-fg-muted">
              {f.lastTopic.sourceName ?? "Source supprimée"} · <RelativeTime date={f.lastTopic.at} />
            </p>
          </>
        ) : (
          <span className="text-sm text-fg-read">—</span>
        )}
      </div>
    </li>
  );
}

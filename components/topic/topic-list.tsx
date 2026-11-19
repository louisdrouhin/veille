import Link from "next/link";
import { HotBadge } from "@/components/ui/badge";
import { RelativeTime } from "@/components/ui/relative-time";
import { SourceAvatar } from "@/components/ui/source-avatar";
import { TableHead } from "@/components/ui/table-head";
import { plural } from "@/lib/format-date";
import { FolderIcon, type FolderState } from "./folder-icon";

export type TopicRowData = {
  id: number;
  title: string;
  replyCount: number;
  lastActivityAt: Date;
  read: boolean;
  hot?: boolean; // v2
  sourceName: string | null;
  /** Article URL: its host gives the favicon. */
  siteUrl: string;
};

export const TOPIC_GRID = "md:grid-cols-[28px_minmax(0,1fr)_190px_56px_124px]";
export const TOPIC_ROW =
  `relative grid grid-cols-[22px_minmax(0,1fr)] gap-x-2.5 px-3.5 py-2.5 md:min-h-[38px] md:items-center md:gap-x-3 md:px-4 md:py-0 ${TOPIC_GRID} ` +
  "border-t border-line first:border-t-0 odd:bg-surface even:bg-surface-alt";

export function TopicListHead() {
  return (
    <TableHead
      grid={TOPIC_GRID}
      columns={[{ label: "" }, { label: "Sujet" }, { label: "Source" }, { label: "Nb", align: "right" }, { label: "Dernier msg", align: "right" }]}
    />
  );
}

export function TopicList({ topics }: { topics: TopicRowData[] }) {
  return (
    <div className="overflow-hidden rounded-md border border-line bg-surface shadow-sm">
      <TopicListHead />
      <ul>
        {topics.map((t) => (
          <TopicRow key={t.id} topic={t} />
        ))}
      </ul>
    </div>
  );
}

function stateOf(t: TopicRowData): FolderState {
  if (t.hot) return t.read ? "hot-read" : "hot";
  return t.read ? "read" : "unread";
}

function TopicRow({ topic: t }: { topic: TopicRowData }) {
  const source = t.sourceName ?? "Source supprimée";
  return (
    <li
      className={`${TOPIC_ROW} hover:bg-surface-hover has-[a:focus-visible]:outline-2 has-[a:focus-visible]:-outline-offset-2 has-[a:focus-visible]:outline-focus`}
    >
      <FolderIcon state={stateOf(t)} className="pt-px md:pt-0" />
      <div className="flex min-w-0 flex-col gap-1 md:flex-row md:items-center md:gap-2">
        {/* Stretched link: the whole row is clickable, one tab stop. Prefetch off: opening marks as read. */}
        <Link
          href={`/t/${t.id}`}
          prefetch={false}
          className={`line-clamp-2 text-md no-underline after:absolute after:inset-0 focus-visible:outline-none md:line-clamp-none md:truncate md:text-base ${
            t.read ? "font-normal text-fg-read hover:text-fg-read" : "font-bold text-fg hover:text-fg"
          }`}
        >
          {t.title}
        </Link>
        {t.hot && <HotBadge />}
        <p className="flex flex-wrap gap-x-1.5 text-[12.5px] leading-4 text-fg-muted md:hidden">
          <span className={t.sourceName ? "" : "italic"}>{source}</span>
          <span aria-hidden="true">·</span>
          <span>{plural(t.replyCount, "réponse")}</span>
          <span aria-hidden="true">·</span>
          <RelativeTime date={t.lastActivityAt} />
        </p>
      </div>
      <span className={`hidden min-w-0 items-center gap-1.75 text-sm text-fg-muted md:flex ${t.sourceName ? "" : "italic"}`}>
        <SourceAvatar name={source} url={t.siteUrl} size={16} />
        <span className="truncate">{source}</span>
      </span>
      <span className="hidden text-right font-mono text-sm font-medium md:block">
        {t.replyCount}
        <span className="sr-only"> réponses</span>
      </span>
      <RelativeTime date={t.lastActivityAt} className="hidden text-right text-sm whitespace-nowrap text-fg-muted md:block" />
    </li>
  );
}

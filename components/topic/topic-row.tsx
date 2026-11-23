"use client";

import Link from "next/link";
import { HotBadge } from "@/components/ui/badge";
import { RelativeTime } from "@/components/ui/relative-time";
import { SourceAvatar } from "@/components/ui/source-avatar";
import { plural } from "@/lib/format-date";
import { FolderIcon, type FolderState } from "./folder-icon";
import { useReadTopics } from "./read-topics";
import { TOPIC_ROW, type TopicRowData } from "./topic-grid";

function stateOf(t: TopicRowData): FolderState {
  if (t.hot) return t.read ? "hot-read" : "hot";
  return t.read ? "read" : "unread";
}

/**
 * Client component: a topic opened during this visit shows as read immediately,
 * even when the row comes from the router cache (back button), see read-topics.tsx.
 */
export function TopicRow({ topic }: { topic: TopicRowData }) {
  const { isRead } = useReadTopics();
  const t = isRead(topic.id) && !topic.read ? { ...topic, read: true } : topic;
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
        <SourceAvatar name={source} src={t.faviconSrc} size={16} />
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

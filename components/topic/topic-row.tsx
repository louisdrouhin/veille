"use client";

import Link from "next/link";
import { SavedMark } from "@/components/lists/saved-mark";
import { useSavedCount } from "@/components/lists/saved-state";
import { HotBadge } from "@/components/ui/badge";
import { RelativeTime } from "@/components/ui/relative-time";
import { SourceAvatar } from "@/components/ui/source-avatar";
import { plural } from "@/lib/format-date";
import { FolderIcon, type FolderState } from "./folder-icon";
import { ROW_MENU_STATES, useCurrentRead, useRowMenu } from "./row-menu";
import type { RowMenu } from "./topic-menu";
import { FORUM_BADGE, TOPIC_ROW, TOPIC_ROW_IN_LIST, TOPIC_ROW_WITH_FORUM, type TopicRowData } from "./topic-grid";

function stateOf(t: TopicRowData): FolderState {
  if (t.hot) return t.read ? "hot-read" : "hot";
  return t.read ? "read" : "unread";
}

/**
 * Client component: a topic opened during this visit shows as read immediately,
 * even when the row comes from the router cache (back button), see read-topics.tsx.
 * `showForum` (home « Derniers non lus »): forum badge first in the mobile metadata,
 * and an extra desktop column whose badge links to the forum.
 */
export function TopicRow({
  topic,
  showForum = false,
  className = "",
  trailing,
  menu = FORUM_MENU,
}: {
  topic: TopicRowData;
  showForum?: boolean;
  className?: string;
  /** Last column, outside the row's link (favorite lists: « retirer »). */
  trailing?: React.ReactNode;
  /** Context menu of the row (desktop, docs/design/3.2): where it is, and « Retirer » in a list. */
  menu?: RowMenu;
}) {
  const t = useCurrentRead(topic);
  const source = t.sourceName ?? "Source supprimée";
  const forum = showForum ? t.forum : undefined;
  const saved = useSavedCount(t.id, t.savedCount ?? 0);
  const { rowProps, more } = useRowMenu(t, menu);

  return (
    <li {...rowProps} className={`${trailing ? TOPIC_ROW_IN_LIST : showForum ? TOPIC_ROW_WITH_FORUM : TOPIC_ROW} ${className} ${ROW_MENU_STATES}`}>
      <FolderIcon state={stateOf(t)} className="pt-px md:pt-0" />
      <div className="flex min-w-0 flex-col gap-1 md:flex-row md:items-center md:gap-2">
        {/* Stretched link: the whole row is clickable, one tab stop. prefetch={false} is required: rendering the
            topic page marks it read, and prefetching it would mark every visible row (tests/topic-links-prefetch.test.ts). */}
        <Link
          href={`/t/${t.id}`}
          prefetch={false}
          data-topic-link
          className={`line-clamp-2 text-md no-underline after:absolute after:inset-0 focus-visible:outline-none md:line-clamp-none md:truncate md:text-base ${
            t.read ? "font-normal text-fg-read hover:text-fg-read" : "font-bold text-fg hover:text-fg"
          }`}
        >
          {t.title}
        </Link>
        <SavedMark count={saved} className="max-md:hidden" />
        {t.hot && <HotBadge className={showForum ? "max-md:hidden" : ""} />}
        <p className="flex flex-wrap items-center gap-x-1.5 text-[12.5px] leading-4 text-fg-muted md:hidden">
          <SavedMark count={saved} />
          {forum && <span className={FORUM_BADGE}>{forum.name}</span>}
          {forum && t.hot && <HotBadge />}
          {forum && <span aria-hidden="true">·</span>}
          <span className={t.sourceName ? "" : "italic"}>{source}</span>
          <span aria-hidden="true">·</span>
          <span>{plural(t.replyCount, "réponse")}</span>
          <span aria-hidden="true">·</span>
          <RowDate topic={t} />
        </p>
      </div>
      {forum && (
        // Above the row's stretched link (z-10): its own target.
        <span className="hidden min-w-0 md:block">
          <Link href={`/f/${forum.slug}`} className={`${FORUM_BADGE} relative z-10 inline-block max-w-full truncate no-underline hover:border-accent hover:text-accent`}>
            {forum.name}
          </Link>
        </span>
      )}
      <span className={`hidden min-w-0 items-center gap-1.75 text-sm text-fg-muted md:flex ${t.sourceName ? "" : "italic"}`}>
        <SourceAvatar name={source} src={t.faviconSrc} size={16} />
        <span className="truncate">{source}</span>
      </span>
      <span className="hidden text-right font-mono text-sm font-medium md:block">
        {t.replyCount}
        <span className="sr-only"> réponses</span>
      </span>
      <RowDate topic={t} className="hidden truncate text-right text-sm whitespace-nowrap text-fg-muted md:block" />
      {trailing}
      {more}
    </li>
  );
}

const FORUM_MENU: RowMenu = { context: "forum" };

/** Last activity, or in a favorite list the date of addition. */
function RowDate({ topic, className }: { topic: TopicRowData; className?: string }) {
  if (!topic.addedAt) return <RelativeTime date={topic.lastActivityAt} className={className} />;
  return (
    <span className={className}>
      ajouté <RelativeTime date={topic.addedAt} />
    </span>
  );
}

"use client";

import Link from "next/link";
import { useRef } from "react";
import { SavedMark } from "@/components/lists/saved-mark";
import { useSavedCount } from "@/components/lists/saved-state";
import { HotBadge } from "@/components/ui/badge";
import { IconMore } from "@/components/ui/icons";
import { RelativeTime } from "@/components/ui/relative-time";
import { SourceAvatar } from "@/components/ui/source-avatar";
import { plural } from "@/lib/format-date";
import { FolderIcon, type FolderState } from "./folder-icon";
import { useReadTopics } from "./read-topics";
import { DESK_QUERY, rowAccelerator, useTopicMenu, type MenuRequest, type RowMenu } from "./topic-menu";
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
  const { readOf } = useReadTopics();
  const { openFor, open, run } = useTopicMenu();
  const rowRef = useRef<HTMLLIElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  // This visit's change (topic opened, or « Marquer comme lu / non lu ») wins over the server's state.
  const changed = readOf(topic.id);
  const t = changed !== undefined && changed !== topic.read ? { ...topic, read: changed } : topic;
  const menuOpen = openFor === t.id;
  const source = t.sourceName ?? "Source supprimée";
  const forum = showForum ? t.forum : undefined;
  const saved = useSavedCount(t.id, t.savedCount ?? 0);
  const request = (via: MenuRequest["via"], point: MenuRequest["point"] = null): MenuRequest | null =>
    rowRef.current ? { topic: t, read: t.read, menu, row: rowRef.current, button: moreRef.current, point, via } : null;
  const desk = () => window.matchMedia(DESK_QUERY).matches;

  return (
    <li
      ref={rowRef}
      data-menu-open={menuOpen ? "" : undefined}
      // Right click: the menu at the cursor. Shift + right click, or a touch screen: the browser's own menu.
      onContextMenu={(e) => {
        if (e.shiftKey || !desk()) return;
        const r = request("pointer", { x: e.clientX, y: e.clientY });
        if (!r) return;
        e.preventDefault();
        open(r);
      }}
      // Shortcuts of a focused row (its link or ⋯): accelerators of the menu, never global.
      onKeyDown={(e) => {
        if (!desk() || e.nativeEvent.isComposing || openFor !== null) return;
        const acc = rowAccelerator(e, menu.context);
        if (!acc) return;
        const r = request("keyboard");
        if (!r) return;
        e.preventDefault();
        e.stopPropagation();
        if (acc === "menu") open(r);
        else run(r, acc);
      }}
      className={`group ${trailing ? TOPIC_ROW_IN_LIST : showForum ? TOPIC_ROW_WITH_FORUM : TOPIC_ROW} ${className} hover:bg-surface-hover has-[a:focus-visible]:outline-2 has-[a:focus-visible]:-outline-offset-2 has-[a:focus-visible]:outline-focus data-menu-open:bg-accent-soft data-menu-open:outline-2 data-menu-open:-outline-offset-2 data-menu-open:outline-accent`}
    >
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
      {/* ⋯: desktop with a mouse only, column always reserved; invisible at rest but focusable. */}
      <span className="hidden desk:flex desk:justify-end">
        <button
          ref={moreRef}
          type="button"
          aria-label={`Actions pour « ${t.title} »`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title="Actions (clic droit, Maj+F10)"
          onClick={() => {
            const r = request("button");
            if (r) open(r);
          }}
          className="relative z-10 inline-flex size-7 cursor-pointer items-center justify-center rounded-sm border border-transparent text-fg-muted opacity-0 group-hover:border-line-strong group-hover:bg-surface group-hover:opacity-100 group-focus-within:opacity-100 hover:text-fg focus-visible:opacity-100 aria-expanded:border-accent aria-expanded:bg-surface aria-expanded:text-accent aria-expanded:opacity-100"
        >
          <IconMore size={16} />
        </button>
      </span>
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

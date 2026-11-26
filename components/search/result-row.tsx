"use client";

import Link from "next/link";
import { SavedMark } from "@/components/lists/saved-mark";
import { useSavedCount } from "@/components/lists/saved-state";
import { FolderIcon } from "@/components/topic/folder-icon";
import { ROW_MENU_STATES, useCurrentRead, useRowMenu } from "@/components/topic/row-menu";
import { FORUM_BADGE } from "@/components/topic/topic-grid";
import { IconNote } from "@/components/ui/icons";
import { RelativeTime } from "@/components/ui/relative-time";
import type { NoteHit, TopicHit } from "@/lib/search/query";
import { Highlighted } from "./highlighted";

const ROW = "relative grid grid-cols-[22px_minmax(0,1fr)] gap-x-2.5 border-t border-line px-3.5 py-3 first:border-t-0 md:gap-x-3 md:px-4 desk:grid-cols-[22px_minmax(0,1fr)_32px]";
const SEARCH_MENU = { context: "forum" } as const;

/**
 * A search result (docs/design/3.3 § 3): title (bold if unread, ★ if saved), 2-line passage, forum, source,
 * date; the same context menu as every topic row. `semantic`: no highlight, title in 600 so that it does not
 * look read.
 */
export function TopicResultRow({ hit, semantic = false }: { hit: TopicHit; semantic?: boolean }) {
  const t = useCurrentRead({ ...hit, read: hit.read });
  const saved = useSavedCount(hit.id, hit.savedCount);
  const { rowProps, more } = useRowMenu(
    {
      id: hit.id,
      title: hit.title.text,
      read: t.read,
      replyCount: 0,
      lastActivityAt: hit.at,
      sourceName: hit.sourceName,
      faviconSrc: null,
      savedCount: hit.savedCount,
      url: hit.url,
      forumSlug: hit.forum.slug,
    },
    SEARCH_MENU,
  );
  const weight = t.read ? "font-normal text-fg-read hover:text-fg-read" : semantic ? "font-semibold text-fg hover:text-fg" : "font-bold text-fg hover:text-fg";
  return (
    <li {...rowProps} className={`${ROW} odd:bg-surface even:bg-surface-alt ${ROW_MENU_STATES}`}>
      <FolderIcon state={t.read ? "read" : "unread"} className="pt-0.5" />
      <div className="flex min-w-0 flex-col gap-1">
        <p className="flex min-w-0 items-center gap-2">
          {/* Stretched link over the row; prefetch={false}: rendering a topic marks it read. */}
          <Link href={`/t/${hit.id}`} prefetch={false} data-topic-link className={`line-clamp-2 text-md no-underline after:absolute after:inset-0 focus-visible:outline-none md:text-base ${weight}`}>
            <Highlighted value={hit.title} />
          </Link>
          <SavedMark count={saved} />
        </p>
        {hit.snippet.text && (
          <p className="line-clamp-2 text-sm text-fg-muted">
            <Highlighted value={hit.snippet} />
          </p>
        )}
        <p className="flex flex-wrap items-center gap-x-1.5 text-[12.5px] leading-4 text-fg-muted">
          <span className={FORUM_BADGE}>{hit.forum.name}</span>
          <span className={hit.sourceName ? "" : "italic"}>{hit.sourceName ?? "Source supprimée"}</span>
          <span aria-hidden="true">·</span>
          <RelativeTime date={hit.at} />
        </p>
      </div>
      {more}
    </li>
  );
}

/** A personal note matching the search: icon, « Ta note · date », the passage between quotes. */
export function NoteResultRow({ hit }: { hit: NoteHit }) {
  return (
    <li className={`${ROW} odd:bg-surface even:bg-surface-alt hover:bg-surface-hover has-[a:focus-visible]:outline-2 has-[a:focus-visible]:-outline-offset-2 has-[a:focus-visible]:outline-focus`}>
      <IconNote size={18} className="mt-0.5 text-fg-muted" />
      <div className="flex min-w-0 flex-col gap-1">
        <Link href={`/t/${hit.topicId}#p${hit.postNumber}`} prefetch={false} className="line-clamp-2 text-base font-semibold text-fg no-underline after:absolute after:inset-0 hover:text-fg focus-visible:outline-none">
          {hit.topicTitle}
        </Link>
        <p className="line-clamp-2 text-sm text-fg">
          « <Highlighted value={hit.snippet} /> »
        </p>
        <p className="flex flex-wrap items-center gap-x-1.5 text-[12.5px] leading-4 text-fg-muted">
          <span className={FORUM_BADGE}>{hit.forum.name}</span>
          <span>
            Ta note · <RelativeTime date={hit.at} />
          </span>
        </p>
      </div>
    </li>
  );
}

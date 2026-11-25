"use client";

import { useId, useState } from "react";
import type { TopicRowData } from "@/components/topic/topic-grid";
import { TopicRow } from "@/components/topic/topic-row";

const HOME_MENU = { context: "home" } as const;

/** Topics shown on mobile before « + N autres non lus »: the forums stay close to the top of the screen. */
export const MOBILE_VISIBLE = 3;

/**
 * Below md, only the first MOBILE_VISIBLE rows are shown (CSS only: same HTML on every screen,
 * no layout jump, no hydration mismatch); the button unfolds the others in place. Desktop shows all.
 */
export function LatestUnreadList({ topics }: { topics: TopicRowData[] }) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const hidden = topics.length - MOBILE_VISIBLE;
  return (
    <>
      <ul id={listId}>
        {topics.map((t, i) => (
          <TopicRow key={t.id} topic={t} showForum menu={HOME_MENU} className={!expanded && i >= MOBILE_VISIBLE ? "max-md:hidden" : ""} />
        ))}
      </ul>
      {hidden > 0 && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setExpanded((v) => !v)}
          className="flex min-h-11 w-full cursor-pointer items-center justify-center border-t border-line text-sm font-semibold text-accent hover:bg-surface-hover md:hidden"
        >
          {expanded ? "Afficher moins" : `+ ${hidden} autre${hidden > 1 ? "s" : ""} non lu${hidden > 1 ? "s" : ""}`}
        </button>
      )}
    </>
  );
}

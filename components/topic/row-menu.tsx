"use client";

import { useRef } from "react";
import { IconMore } from "@/components/ui/icons";
import { useReadTopics } from "./read-topics";
import { DESK_QUERY, rowAccelerator, useTopicMenu, type MenuRequest, type RowMenu } from "./topic-menu";
import type { TopicRowData } from "./topic-grid";

/** Classes of a row with the context menu: hover, keyboard focus of its link, « menu ouvert » (docs/design/3.2 § 4). */
export const ROW_MENU_STATES =
  "group hover:bg-surface-hover has-[a:focus-visible]:outline-2 has-[a:focus-visible]:-outline-offset-2 has-[a:focus-visible]:outline-focus " +
  "data-menu-open:bg-accent-soft data-menu-open:outline-2 data-menu-open:-outline-offset-2 data-menu-open:outline-accent";

/**
 * The context menu of a topic row (right click, ⋯, Menu key, Shift+F10, accelerators), for every row that shows a
 * topic: forum lists, home, lists, search results, « Sujets proches ». `topic.read` already includes this visit's
 * change. Spread `rowProps` on the <li>, render `more` in its last column; the link needs `data-topic-link`.
 */
export function useRowMenu(topic: TopicRowData, menu: RowMenu) {
  const { openFor, open, run } = useTopicMenu();
  const rowRef = useRef<HTMLLIElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const menuOpen = openFor === topic.id;
  const request = (via: MenuRequest["via"], point: MenuRequest["point"] = null): MenuRequest | null =>
    rowRef.current ? { topic, read: topic.read, menu, row: rowRef.current, button: moreRef.current, point, via } : null;
  const desk = () => window.matchMedia(DESK_QUERY).matches;

  const rowProps = {
    ref: rowRef,
    "data-menu-open": menuOpen ? "" : undefined,
    // Right click: the menu at the cursor. Shift + right click, or a touch screen: the browser's own menu.
    onContextMenu: (e: React.MouseEvent) => {
      if (e.shiftKey || !desk()) return;
      const r = request("pointer", { x: e.clientX, y: e.clientY });
      if (!r) return;
      e.preventDefault();
      open(r);
    },
    // Shortcuts of a focused row (its link or ⋯): accelerators of the menu, never global.
    onKeyDown: (e: React.KeyboardEvent) => {
      if (!desk() || e.nativeEvent.isComposing || openFor !== null) return;
      const acc = rowAccelerator(e, menu.context);
      if (!acc) return;
      const r = request("keyboard");
      if (!r) return;
      e.preventDefault();
      e.stopPropagation();
      if (acc === "menu") open(r);
      else run(r, acc);
    },
  };

  const more = (
    // ⋯: desktop with a mouse only, column always reserved; invisible at rest but focusable.
    <span className="hidden desk:flex desk:justify-end">
      <button
        ref={moreRef}
        type="button"
        aria-label={`Actions pour « ${topic.title} »`}
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
  );

  return { rowProps, more };
}

/** The row's topic with this visit's read change (topic opened, « Marquer comme lu / non lu »). */
export function useCurrentRead<T extends { id: number; read: boolean }>(topic: T): T {
  const { readOf } = useReadTopics();
  const changed = readOf(topic.id);
  return changed !== undefined && changed !== topic.read ? { ...topic, read: changed } : topic;
}

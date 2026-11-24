"use client";

import { useState } from "react";
import type { MarkdownItem } from "@/lib/lists/markdown";
import type { ListColor } from "@/lib/lists/palette";
import { CopyMarkdownButton } from "./copy-markdown-button";
import { ListMenu } from "./list-menu";
import { ListTile } from "./list-tile";

/** Header of a list's page: tile, name, count, « Copier en Markdown » and « … ». Renaming / recoloring update it in place. */
export function ListHeader({
  list,
  count,
  exportItems,
  onNameChange,
}: {
  list: { id: number; name: string; color: ListColor };
  count: number;
  exportItems: MarkdownItem[];
  onNameChange?: (name: string) => void;
}) {
  const [shown, setShownState] = useState({ name: list.name, color: list.color });
  const setShown = (next: { name: string; color: ListColor }) => {
    setShownState(next);
    onNameChange?.(next.name);
  };
  const current = { id: list.id, ...shown };
  return (
    <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <ListTile color={shown.color} size={40} />
        <div className="min-w-0">
          <h1 className="font-cond text-xl font-bold break-words">{shown.name}</h1>
          <p className="text-sm text-fg-muted">
            {count} article{count > 1 ? "s" : ""} · du plus récent ajout au plus ancien
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <CopyMarkdownButton name={shown.name} items={exportItems} className="max-md:flex-1" />
        <ListMenu list={current} count={count} onChange={setShown} />
      </div>
    </div>
  );
}

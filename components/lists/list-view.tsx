"use client";

import { useState } from "react";
import type { TopicRowData } from "@/components/topic/topic-grid";
import type { MarkdownItem } from "@/lib/lists/markdown";
import type { ListColor } from "@/lib/lists/palette";
import { ListHeader } from "./list-header";
import { ListItems } from "./list-items";

/**
 * A list's page body: the header (count, « Copier en Markdown ») follows the rows, so a removed
 * topic is neither counted nor exported, and comes back with « Annuler ».
 */
export function ListView({
  list,
  count,
  exportItems,
  items,
}: {
  list: { id: number; name: string; color: ListColor };
  count: number;
  exportItems: MarkdownItem[];
  items: (TopicRowData & { addedAt: Date })[];
}) {
  const [removed, setRemoved] = useState<ReadonlySet<number>>(() => new Set());
  const [name, setName] = useState(list.name);
  const kept = exportItems.filter((i) => i.topicId === undefined || !removed.has(i.topicId));
  return (
    <>
      <ListHeader
        list={list}
        count={count - removed.size}
        exportItems={kept}
        onNameChange={setName}
      />
      <ListItems
        listId={list.id}
        listName={name}
        initial={items}
        onRemoved={(id) => setRemoved((prev) => new Set(prev).add(id))}
        onRestored={(id) =>
          setRemoved((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          })
        }
      />
    </>
  );
}

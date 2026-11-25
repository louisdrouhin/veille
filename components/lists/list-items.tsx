"use client";

import { useState, useTransition } from "react";
import type { TopicRowData } from "@/components/topic/topic-grid";
import { TopicRow } from "@/components/topic/topic-row";
import { IconClose } from "@/components/ui/icons";
import { removeFromList, restoreToList } from "@/lib/actions/lists";
import { showToast } from "@/lib/toast-client";

type Item = TopicRowData & { addedAt: Date };

const byAddedDesc = (a: Item, b: Item) => b.addedAt.getTime() - a.addedAt.getTime() || b.id - a.id;

/**
 * Topics of a favorite list (docs/design/v3 § 3.6). « Retirer » is optimistic, then a toast offers
 * « Annuler » for 5 s (restoreToList puts it back with its date of addition).
 */
export function ListItems({
  listId,
  listName,
  initial,
  onRemoved,
  onRestored,
}: {
  listId: number;
  listName: string;
  initial: Item[];
  /** Keeps the header (count, Markdown export) in step with the rows. */
  onRemoved?: (topicId: number) => void;
  onRestored?: (topicId: number) => void;
}) {
  const [items, setItems] = useState(initial);
  const [syncedFrom, setSyncedFrom] = useState(initial);
  if (initial !== syncedFrom) {
    setSyncedFrom(initial);
    setItems(initial);
  }
  const [, startTransition] = useTransition();

  function remove(item: Item) {
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    onRemoved?.(item.id);
    startTransition(async () => {
      const res = await removeFromList(listId, item.id);
      if (!res.ok) {
        setItems((prev) => [...prev, item].sort(byAddedDesc));
        onRestored?.(item.id);
        showToast({ kind: "error", title: "Retrait impossible :", msg: res.error });
        return;
      }
      const token = res.undoToken;
      showToast({
        kind: "ok",
        title: `Retiré de « ${listName} »`,
        action: token
          ? {
              label: "Annuler",
              onClick: () => {
                setItems((prev) => (prev.some((i) => i.id === item.id) ? prev : [...prev, item].sort(byAddedDesc)));
                onRestored?.(item.id);
                void restoreToList(token).then((r) => {
                  if (r.ok) return;
                  setItems((prev) => prev.filter((i) => i.id !== item.id));
                  onRemoved?.(item.id);
                  showToast({ kind: "error", title: "Annulation impossible :", msg: r.error });
                });
              },
            }
          : undefined,
      });
    });
  }

  if (items.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-line-strong bg-surface px-5 py-8 text-center">
        <p className="text-[15px] font-semibold">Cette liste est vide</p>
        <p className="mt-1 text-sm text-fg-muted">Ajoute des topics avec ★ Enregistrer depuis n&apos;importe quelle page topic.</p>
      </div>
    );
  }

  return (
    <ul className="overflow-hidden rounded-md border border-line bg-surface shadow-sm">
      {items.map((t) => (
        <TopicRow
          key={t.id}
          topic={t}
          showForum
          menu={{ context: "list", list: { id: listId, name: listName }, onRemove: () => remove(t) }}
          trailing={
            // Beside the row's link, above its stretched area (z-10): its own target. Touch screens only: with a
            // mouse, « Retirer » is in the row's ⋯ menu (docs/design/3.2).
            <button
              type="button"
              onClick={() => remove(t)}
              aria-label={`Retirer « ${t.title} » de la liste`}
              title="Retirer de la liste"
              className="relative z-10 -my-2.5 inline-flex w-12 cursor-pointer items-center justify-center self-stretch text-fg-muted hover:bg-surface-hover hover:text-err md:my-0 md:size-8 md:w-8 md:self-center md:rounded-sm desk:hidden"
            >
              <IconClose size={16} />
            </button>
          }
        />
      ))}
    </ul>
  );
}

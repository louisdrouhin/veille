"use client";

import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { buttonClass } from "@/components/ui/button";
import { ConfirmDialog, type ConfirmDialogHandle } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { IconArrowDown, IconArrowUp, IconChevronRight, IconGrip, IconPencil, IconTrash } from "@/components/ui/icons";
import { RelativeTime } from "@/components/ui/relative-time";
import { TableHead } from "@/components/ui/table-head";
import { createList, deleteList, moveList, renameList, reorderLists, setListColor } from "@/lib/actions/lists";
import type { MarkdownItem } from "@/lib/lists/markdown";
import { LIST_NAME_MAX, type ListColor } from "@/lib/lists/palette";
import type { ListSummary } from "@/lib/lists/queries";
import { showToast } from "@/lib/toast-client";
import { CopyMarkdownButton } from "./copy-markdown-button";
import { ListColorPicker } from "./list-color-picker";
import { ListSwatch } from "./list-swatch";
import { ListTile } from "./list-tile";
import { Star } from "./star";

export type IndexList = ListSummary & { items: MarkdownItem[] };

const GRID = "md:grid-cols-[20px_36px_minmax(0,1fr)_90px_130px_196px]";
const FIELD = "h-11 min-w-0 rounded-sm border border-line-strong bg-surface px-3 text-[16px] text-fg md:h-8 md:text-base";

const articles = (n: number) => `${n} article${n > 1 ? "s" : ""}`;

function failed(error: string) {
  showToast({ kind: "error", title: "Listes :", msg: error });
}

/**
 * /listes (docs/design/v3 § 3.5). Changes are applied locally at once, then saved; on failure the
 * previous state comes back with an error toast. No revalidatePath: the page is dynamic, and
 * BackForwardRefresh resyncs it after « ← Retour ».
 */
export function ListsIndex({ initial }: { initial: IndexList[] }) {
  const [lists, setLists] = useState(initial);
  const [syncedFrom, setSyncedFrom] = useState(initial);
  if (initial !== syncedFrom) {
    setSyncedFrom(initial);
    setLists(initial);
  }
  const [editing, setEditing] = useState(false);
  const [, startTransition] = useTransition();

  /** Applies `next` now; runs `save`; puts `lists` back if it fails. */
  function change(next: IndexList[], save: () => Promise<{ ok: boolean; error?: string }>) {
    const previous = lists;
    setLists(next);
    startTransition(async () => {
      const res = await save();
      if (!res.ok) {
        setLists(previous);
        failed(res.error ?? "Enregistrement impossible.");
      }
    });
  }

  const ops = {
    rename(id: number, name: string) {
      const clean = name.trim();
      const current = lists.find((l) => l.id === id);
      if (!current || !clean || clean === current.name) return;
      change(
        lists.map((l) => (l.id === id ? { ...l, name: clean } : l)),
        () => renameList(id, clean),
      );
    },
    color(id: number, color: ListColor) {
      change(
        lists.map((l) => (l.id === id ? { ...l, color } : l)),
        () => setListColor(id, color),
      );
    },
    move(id: number, direction: "up" | "down") {
      const from = lists.findIndex((l) => l.id === id);
      const to = direction === "up" ? from - 1 : from + 1;
      if (from < 0 || to < 0 || to >= lists.length) return;
      change(arrayMove(lists, from, to), () => moveList(id, direction));
    },
    reorder(next: IndexList[]) {
      change(next, () => reorderLists(next.map((l) => l.id)));
    },
    remove(id: number) {
      change(
        lists.filter((l) => l.id !== id),
        () => deleteList(id),
      );
    },
    create(name: string) {
      startTransition(async () => {
        const res = await createList({ name });
        if (res.ok) setLists((prev) => [...prev, { ...res.list, count: 0, lastAddedAt: null, items: [] }]);
        else failed(res.error);
      });
    },
  };

  const total = lists.reduce((n, l) => n + l.count, 0);

  return (
    <div className="flex flex-col gap-4 max-md:pb-16">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="font-cond text-xl font-bold">Listes</h1>
          {lists.length > 0 && (
            <p className="text-sm text-fg-muted">
              {lists.length} liste{lists.length > 1 ? "s" : ""} · {articles(total)}
            </p>
          )}
        </div>
        {lists.length > 0 && (
          <button
            type="button"
            aria-pressed={editing}
            onClick={() => setEditing((v) => !v)}
            className={buttonClass(editing ? "primary" : "secondary", "md", "md:hidden")}
          >
            {editing ? "Terminé" : "Modifier"}
          </button>
        )}
      </div>

      {lists.length === 0 ? (
        <EmptyState icon={<Star size={40} className="text-fg-muted" />} title="Aucune liste">
          Enregistre un topic avec ★ pour créer ta première liste.
        </EmptyState>
      ) : (
        <>
          {/* Mobile */}
          <ul className="overflow-hidden rounded-md border border-line bg-surface shadow-sm md:hidden">
            {lists.map((l, i) =>
              editing ? (
                <MobileEditRow key={l.id} list={l} first={i === 0} last={i === lists.length - 1} ops={ops} />
              ) : (
                <MobileRow key={l.id} list={l} />
              ),
            )}
          </ul>
          {/* Desktop */}
          <DesktopTable lists={lists} ops={ops} />
        </>
      )}

      <NewListForm onCreate={ops.create} existing={lists.map((l) => l.name)} />
    </div>
  );
}

type Ops = {
  rename: (id: number, name: string) => void;
  color: (id: number, color: ListColor) => void;
  move: (id: number, direction: "up" | "down") => void;
  reorder: (next: IndexList[]) => void;
  remove: (id: number) => void;
  create: (name: string) => void;
};

function LastAdded({ list }: { list: IndexList }) {
  return list.lastAddedAt ? (
    <>
      ajout <RelativeTime date={list.lastAddedAt} />
    </>
  ) : (
    <>vide</>
  );
}

function MobileRow({ list }: { list: IndexList }) {
  return (
    <li className="border-t border-line first:border-t-0">
      <Link href={`/listes/${list.id}`} className="flex min-h-16 items-center gap-3 px-3.5 py-2 text-fg no-underline hover:bg-surface-hover hover:text-fg">
        <ListTile color={list.color} size={36} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-md font-bold">{list.name}</span>
          <span className="block text-sm text-fg-muted">
            {articles(list.count)} · <LastAdded list={list} />
          </span>
        </span>
        <IconChevronRight size={16} className="shrink-0 text-fg-muted" />
      </Link>
    </li>
  );
}

function DeleteListDialog({ list, ops, trigger }: { list: IndexList; ops: Ops; trigger: { className?: string; size: number } }) {
  const dialog = useRef<ConfirmDialogHandle>(null);
  return (
    <ConfirmDialog
      handle={dialog}
      title={`Supprimer la liste « ${list.name} » ?`}
      description={`${list.count > 0 ? `Ses ${articles(list.count)} n'y seront plus.` : "Elle est vide."} Les topics restent dans leurs forums et dans tes autres listes.`}
      trigger={{ label: `Supprimer « ${list.name} »`, className: `text-err ${trigger.className ?? ""}`, icon: <IconTrash size={trigger.size} /> }}
    >
      <button
        type="button"
        className={buttonClass("danger-solid")}
        onClick={() => {
          dialog.current?.close();
          ops.remove(list.id);
        }}
      >
        Supprimer
      </button>
    </ConfirmDialog>
  );
}

/** Name field saved on blur or Enter; Escape restores the current name. */
function NameField({ list, ops, className = "" }: { list: IndexList; ops: Ops; className?: string }) {
  return (
    <input
      key={list.name}
      defaultValue={list.name}
      maxLength={LIST_NAME_MAX}
      enterKeyHint="done"
      aria-label={`Nom de la liste « ${list.name} »`}
      onBlur={(e) => ops.rename(list.id, e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          e.currentTarget.value = list.name;
          e.currentTarget.blur();
        }
      }}
      className={`${FIELD} ${className}`}
    />
  );
}

function MobileEditRow({ list, first, last, ops }: { list: IndexList; first: boolean; last: boolean; ops: Ops }) {
  const [colorOpen, setColorOpen] = useState(false);
  return (
    <li className="flex flex-col gap-2 border-t border-line px-2.5 py-2 first:border-t-0">
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-expanded={colorOpen}
          aria-label={`Couleur de « ${list.name} »`}
          onClick={() => setColorOpen((v) => !v)}
          className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-sm hover:bg-surface-hover"
        >
          <ListSwatch color={list.color} size={24} className="rounded-md" />
        </button>
        <NameField list={list} ops={ops} className="flex-1" />
        <button
          type="button"
          aria-label={`Monter « ${list.name} »`}
          disabled={first}
          onClick={() => ops.move(list.id, "up")}
          className="inline-flex h-11 w-10 shrink-0 cursor-pointer items-center justify-center rounded-sm text-fg-muted hover:bg-surface-hover disabled:text-line-strong"
        >
          <IconArrowUp size={16} />
        </button>
        <button
          type="button"
          aria-label={`Descendre « ${list.name} »`}
          disabled={last}
          onClick={() => ops.move(list.id, "down")}
          className="inline-flex h-11 w-10 shrink-0 cursor-pointer items-center justify-center rounded-sm text-fg-muted hover:bg-surface-hover disabled:text-line-strong"
        >
          <IconArrowDown size={16} />
        </button>
        <DeleteListDialog list={list} ops={ops} trigger={{ size: 16 }} />
      </div>
      {colorOpen && (
        <div className="px-1 pb-1">
          <ListColorPicker value={list.color} listName={list.name} onChange={(c) => ops.color(list.id, c)} />
        </div>
      )}
    </li>
  );
}

function DesktopTable({ lists, ops }: { lists: IndexList[]; ops: Ops }) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const from = lists.findIndex((l) => l.id === active.id);
    const to = lists.findIndex((l) => l.id === over.id);
    ops.reorder(arrayMove(lists, from, to));
  }
  const names = new Map(lists.map((l) => [l.id, l.name]));
  return (
    <div className="hidden overflow-hidden rounded-md border border-line bg-surface shadow-sm md:block">
      <TableHead
        grid={GRID}
        columns={[{ label: "" }, { label: "" }, { label: "Liste" }, { label: "Articles", align: "right" }, { label: "Dernier ajout" }, { label: "Actions", align: "right" }]}
      />
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
        accessibility={{
          announcements: {
            onDragStart: ({ active }) => `« ${names.get(Number(active.id))} » saisie.`,
            onDragOver: ({ active, over }) => (over ? `« ${names.get(Number(active.id))} » au-dessus de « ${names.get(Number(over.id))} ».` : undefined),
            onDragEnd: ({ active, over }) => (over ? `« ${names.get(Number(active.id))} » déposée.` : undefined),
            onDragCancel: ({ active }) => `Déplacement de « ${names.get(Number(active.id))} » annulé.`,
          },
          screenReaderInstructions: { draggable: "Espace pour saisir, flèches pour déplacer, Espace pour déposer, Échap pour annuler." },
        }}
      >
        <SortableContext items={lists.map((l) => l.id)} strategy={verticalListSortingStrategy}>
          <ol>
            {lists.map((l, i) => (
              <DesktopRow key={l.id} list={l} first={i === 0} last={i === lists.length - 1} ops={ops} />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
    </div>
  );
}

function DesktopRow({ list, first, last, ops }: { list: IndexList; first: boolean; last: boolean; ops: Ops }) {
  const [renaming, setRenaming] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);
  const draft = useRef<HTMLInputElement>(null);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: list.id });
  const icon = "size-8";
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`border-t border-line first:border-t-0 odd:bg-surface even:bg-surface-alt ${isDragging ? "relative z-10 shadow-md" : ""}`}
    >
      <div className={`grid min-h-12 items-center gap-x-3 px-4 ${GRID}`}>
        <button
          ref={setActivatorNodeRef}
          type="button"
          className="inline-flex h-8 w-5 cursor-grab touch-none items-center justify-center rounded-sm text-fg-read hover:text-fg-muted active:cursor-grabbing"
          aria-label={`Déplacer « ${list.name} »`}
          title="Glisser pour réordonner"
          {...attributes}
          {...listeners}
        >
          <IconGrip size={14} />
        </button>
        <button
          type="button"
          aria-expanded={colorOpen}
          aria-label={`Couleur de « ${list.name} »`}
          title="Changer la couleur"
          onClick={() => setColorOpen((v) => !v)}
          className="inline-flex cursor-pointer rounded-md"
        >
          <ListTile color={list.color} size={32} />
        </button>
        {renaming ? (
          <form
            className="flex min-w-0 items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              ops.rename(list.id, draft.current?.value ?? "");
              setRenaming(false);
            }}
          >
            <input
              ref={draft}
              defaultValue={list.name}
              maxLength={LIST_NAME_MAX}
              aria-label={`Nouveau nom de « ${list.name} »`}
              autoFocus
              onKeyDown={(e) => e.key === "Escape" && (e.preventDefault(), setRenaming(false))}
              className={`${FIELD} flex-1`}
            />
            <button type="submit" className={buttonClass("primary", "sm")}>
              OK
            </button>
            <button type="button" className={buttonClass("secondary", "sm")} onClick={() => setRenaming(false)}>
              Annuler
            </button>
          </form>
        ) : (
          <Link href={`/listes/${list.id}`} className="truncate text-base font-semibold text-fg no-underline hover:text-accent hover:underline">
            {list.name}
          </Link>
        )}
        <span className="text-right font-mono text-sm">{list.count}</span>
        <span className="text-sm text-fg-muted">{list.lastAddedAt ? <RelativeTime date={list.lastAddedAt} /> : "—"}</span>
        <div className="flex justify-end">
          <button type="button" className={buttonClass("ghost-icon", "sm", icon)} aria-label={`Monter « ${list.name} »`} title="Monter" disabled={first} onClick={() => ops.move(list.id, "up")}>
            <IconArrowUp size={14} />
          </button>
          <button type="button" className={buttonClass("ghost-icon", "sm", icon)} aria-label={`Descendre « ${list.name} »`} title="Descendre" disabled={last} onClick={() => ops.move(list.id, "down")}>
            <IconArrowDown size={14} />
          </button>
          <button type="button" className={buttonClass("ghost-icon", "sm", icon)} aria-label={`Renommer « ${list.name} »`} title="Renommer" aria-expanded={renaming} onClick={() => setRenaming(true)}>
            <IconPencil size={14} />
          </button>
          <CopyMarkdownButton name={list.name} items={list.items} compact />
          <DeleteListDialog list={list} ops={ops} trigger={{ size: 14 }} />
        </div>
      </div>
      {colorOpen && (
        <div className="border-t border-line px-4 py-2.5 pl-[76px]">
          <ListColorPicker value={list.color} listName={list.name} onChange={(c) => ops.color(list.id, c)} />
        </div>
      )}
    </li>
  );
}

function NewListForm({ onCreate, existing }: { onCreate: (name: string) => void; existing: string[] }) {
  const [name, setName] = useState("");
  const trimmed = name.trim();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!trimmed) return;
        onCreate(trimmed);
        setName("");
      }}
      className="flex flex-col gap-2 rounded-md border border-line bg-surface-alt p-3.5"
    >
      <label htmlFor="new-list" className="text-sm font-semibold">
        Nouvelle liste
      </label>
      <div className="flex gap-2">
        <input
          id="new-list"
          value={name}
          maxLength={LIST_NAME_MAX}
          placeholder="Homelab, À lire plus tard…"
          autoComplete="off"
          enterKeyHint="done"
          onChange={(e) => setName(e.target.value)}
          className={`${FIELD} flex-1 md:h-9`}
        />
        <button type="submit" disabled={!trimmed} className={buttonClass("primary", "md")}>
          Créer
        </button>
      </div>
      {trimmed && existing.includes(trimmed) && <p className="text-sm text-warn">Une liste porte déjà ce nom.</p>}
    </form>
  );
}

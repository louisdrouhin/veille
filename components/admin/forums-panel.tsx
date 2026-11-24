"use client";

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { FORUM_ICON_LABELS, ForumIcon } from "@/components/forum/forum-icon";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, type ConfirmDialogHandle } from "@/components/ui/confirm-dialog";
import { IconArrowDown, IconArrowUp, IconGrip, IconMore, IconPencil, IconPlus, IconTrash } from "@/components/ui/icons";
import { Panel } from "@/components/ui/panel";
import { SubmitButton } from "@/components/ui/submit-button";
import { Tooltip } from "@/components/ui/tooltip";
import { createForum, deleteForum, moveForum, reorderForums, updateForum } from "@/lib/actions/admin";
import { FORUM_ICONS, type ForumIconName } from "@/lib/db/schema";
import { plural } from "@/lib/format-date";

export type AdminForum = {
  id: number;
  name: string;
  slug: string;
  description: string;
  icon: ForumIconName;
  sourceCount: number;
  topicCount: number;
};

const FIELD = "h-9 w-full rounded-sm border border-line-strong bg-surface px-2.5 text-base font-normal text-fg max-md:h-11 max-md:text-[16px]";
const LABEL = "flex flex-col gap-1 text-xs font-semibold text-fg-muted";

function IconSelect({ defaultValue }: { defaultValue?: ForumIconName }) {
  return (
    <select name="icon" defaultValue={defaultValue ?? "news"} className={FIELD}>
      {FORUM_ICONS.map((icon) => (
        <option key={icon} value={icon}>
          {FORUM_ICON_LABELS[icon]}
        </option>
      ))}
    </select>
  );
}

function ForumEditForm({ forum, onCancel }: { forum: AdminForum; onCancel: () => void }) {
  return (
    <form action={updateForum} className="mt-2 flex flex-col gap-2 rounded-sm border border-line bg-surface-alt p-2.5">
      <input type="hidden" name="id" value={forum.id} />
      <label className={LABEL}>
        Nom
        <input name="name" defaultValue={forum.name} required maxLength={100} className={FIELD} autoFocus />
      </label>
      <label className={LABEL}>
        Description
        <input name="description" defaultValue={forum.description} maxLength={300} className={FIELD} />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className={LABEL}>
          Icône
          <IconSelect defaultValue={forum.icon} />
        </label>
        <label className={LABEL}>
          Slug
          <input name="slug" defaultValue={forum.slug} maxLength={60} className={`${FIELD} font-mono text-sm`} />
        </label>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          Annuler
        </Button>
        <SubmitButton variant="primary">Enregistrer</SubmitButton>
      </div>
    </form>
  );
}

/**
 * Mobile « … » of a forum: Renommer, Supprimer (or why it cannot be deleted). A disclosure
 * (button + aria-expanded), closed by Escape, a tap outside or choosing an item.
 */
function ForumMenu({
  forum,
  blockedReason,
  onRename,
  onDelete,
}: {
  forum: AdminForum;
  blockedReason: string | null;
  onRename: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setOpen(false);
      root.current?.querySelector("button")?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const item = "flex min-h-11 w-full cursor-pointer items-center gap-2 px-3 text-left text-base hover:bg-surface-hover";
  return (
    <div ref={root} className="relative md:hidden">
      <Button
        variant="ghost-icon"
        aria-label={`Actions pour « ${forum.name} »`}
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
      >
        <IconMore size={16} />
      </Button>
      <div
        id={menuId}
        hidden={!open}
        className="absolute top-full right-0 z-20 mt-1 w-60 overflow-hidden rounded-md border border-line bg-surface py-1 shadow-md"
      >
        <button
          type="button"
          className={item}
          onClick={() => {
            setOpen(false);
            onRename();
          }}
        >
          <IconPencil size={15} /> Renommer
        </button>
        {blockedReason ? (
          <div className="px-3 py-2">
            <button type="button" disabled className={`${item} -mx-3 cursor-not-allowed text-fg-read`} aria-describedby={`${menuId}-why`}>
              <IconTrash size={15} /> Supprimer
            </button>
            <p id={`${menuId}-why`} className="text-sm text-fg-muted">
              {blockedReason}
            </p>
          </div>
        ) : (
          <button
            type="button"
            className={`${item} text-err`}
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
          >
            <IconTrash size={15} /> Supprimer
          </button>
        )}
      </div>
    </div>
  );
}

function ForumItem({
  forum,
  index,
  count,
  onMove,
  busy,
}: {
  forum: AdminForum;
  index: number;
  count: number;
  onMove: (direction: "up" | "down") => void;
  busy: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: forum.id });
  const blockedReason =
    forum.sourceCount > 0
      ? `Impossible : ce forum contient ${plural(forum.sourceCount, "source")}. Déplace-les ou supprime-les d'abord.`
      : forum.topicCount > 0
        ? `Impossible : ce forum contient ${plural(forum.topicCount, "topic")} (et tes notes).`
        : null;
  const tipId = `forum-del-tip-${forum.id}`;
  const deleteDialog = useRef<ConfirmDialogHandle>(null);

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`border-t border-line px-2.5 py-2 first:border-t-0 odd:bg-surface even:bg-surface-alt ${
        isDragging ? "relative z-10 shadow-md" : ""
      }`}
    >
      <div className="flex items-center gap-1.5">
        <button
          ref={setActivatorNodeRef}
          type="button"
          className="inline-flex h-8 w-5 shrink-0 cursor-grab touch-none items-center justify-center rounded-sm text-fg-read hover:text-fg-muted active:cursor-grabbing max-md:hidden"
          aria-label={`Déplacer « ${forum.name} »`}
          title="Glisser pour réordonner"
          {...attributes}
          {...listeners}
        >
          <IconGrip size={14} />
        </button>
        <span className="text-fg-muted">
          <ForumIcon icon={forum.icon} size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold">{forum.name}</p>
          <p className="truncate text-xs text-fg-muted">
            {plural(forum.sourceCount, "source")} · {plural(forum.topicCount, "topic")}
          </p>
        </div>
        <div className="flex shrink-0 items-center">
          <Button
            variant="ghost-icon"
            className="size-7.5 max-md:size-11"
            aria-label={`Monter « ${forum.name} »`}
            title="Monter"
            disabled={index === 0 || busy}
            onClick={() => onMove("up")}
          >
            <IconArrowUp size={14} />
          </Button>
          <Button
            variant="ghost-icon"
            className="size-7.5 max-md:size-11"
            aria-label={`Descendre « ${forum.name} »`}
            title="Descendre"
            disabled={index === count - 1 || busy}
            onClick={() => onMove("down")}
          >
            <IconArrowDown size={14} />
          </Button>
          <Button
            variant="ghost-icon"
            className="size-7.5 max-md:hidden"
            aria-label={`Renommer « ${forum.name} »`}
            title="Renommer"
            aria-expanded={editing}
            onClick={() => setEditing((v) => !v)}
          >
            <IconPencil size={14} />
          </Button>
          {blockedReason ? (
            <span className="max-md:hidden">
              <Tooltip id={tipId} text={blockedReason}>
                <Button
                  variant="ghost-icon"
                  className="size-7.5"
                  aria-label={`Supprimer « ${forum.name} »`}
                  aria-disabled="true"
                  aria-describedby={tipId}
                  onClick={(e) => e.preventDefault()}
                >
                  <IconTrash size={14} />
                </Button>
              </Tooltip>
            </span>
          ) : (
            <ConfirmDialog
              handle={deleteDialog}
              title={`Supprimer « ${forum.name} » ?`}
              description="Le forum est vide. Cette action est définitive."
              trigger={{ label: `Supprimer « ${forum.name} »`, className: "size-7.5 text-err max-md:hidden", icon: <IconTrash size={14} /> }}
            >
              <form action={deleteForum}>
                <input type="hidden" name="id" value={forum.id} />
                <SubmitButton variant="danger-solid">Supprimer</SubmitButton>
              </form>
            </ConfirmDialog>
          )}
          <ForumMenu
            forum={forum}
            blockedReason={blockedReason}
            onRename={() => setEditing(true)}
            onDelete={() => deleteDialog.current?.open()}
          />
        </div>
      </div>
      {editing && <ForumEditForm forum={forum} onCancel={() => setEditing(false)} />}
    </li>
  );
}

const announcements = (names: Map<number, string>): Announcements => ({
  onDragStart: ({ active }) => `« ${names.get(Number(active.id))} » saisi.`,
  onDragOver: ({ active, over }) => (over ? `« ${names.get(Number(active.id))} » au-dessus de « ${names.get(Number(over.id))} ».` : undefined),
  onDragEnd: ({ active, over }) => (over ? `« ${names.get(Number(active.id))} » déposé.` : undefined),
  onDragCancel: ({ active }) => `Déplacement de « ${names.get(Number(active.id))} » annulé.`,
});

export function ForumsPanel({ forums }: { forums: AdminForum[] }) {
  const [items, setItems] = useState(forums);
  const [syncedFrom, setSyncedFrom] = useState(forums);
  const [busy, startTransition] = useTransition();
  // New server data (after an action): reset the local (optimistic) order.
  if (forums !== syncedFrom) {
    setSyncedFrom(forums);
    setItems(forums);
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const names = new Map(items.map((f) => [f.id, f.name]));

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const from = items.findIndex((f) => f.id === active.id);
    const to = items.findIndex((f) => f.id === over.id);
    const next = arrayMove(items, from, to);
    setItems(next);
    startTransition(() => reorderForums(next.map((f) => f.id)));
  }

  function onMove(forum: AdminForum, direction: "up" | "down") {
    const from = items.indexOf(forum);
    const to = direction === "up" ? from - 1 : from + 1;
    if (to < 0 || to >= items.length) return;
    setItems(arrayMove(items, from, to));
    startTransition(() => moveForum(forum.id, direction));
  }

  return (
    <Panel id="forums" title="Forums" className="w-full min-[1000px]:max-w-[360px] min-[1000px]:flex-[1_1_320px]">
      {items.length === 0 ? (
        <p className="px-3.5 py-4 text-sm text-fg-muted">Aucun forum. Crée le premier ci-dessous.</p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
          accessibility={{
            announcements: announcements(names),
            screenReaderInstructions: {
              draggable: "Espace pour saisir, flèches pour déplacer, Espace pour déposer, Échap pour annuler.",
            },
          }}
        >
          <SortableContext items={items.map((f) => f.id)} strategy={verticalListSortingStrategy}>
            <ol aria-busy={busy || undefined}>
              {items.map((forum, i) => (
                <ForumItem key={forum.id} forum={forum} index={i} count={items.length} busy={busy} onMove={(d) => onMove(forum, d)} />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      )}

      <form action={createForum} className="flex flex-col gap-2 border-t border-line bg-surface-alt p-3">
        <p className="text-sm font-semibold">Nouveau forum</p>
        <label className={LABEL}>
          Nom
          <input name="name" required maxLength={100} placeholder="Sécu / CVE" className={FIELD} />
        </label>
        <label className={LABEL}>
          <span>
            Description <span className="font-normal">(facultatif)</span>
          </span>
          <input name="description" maxLength={300} placeholder="Alertes, CVE, advisories" className={FIELD} />
        </label>
        <div className="flex items-end gap-2">
          <label className={`${LABEL} flex-1`}>
            Icône
            <IconSelect />
          </label>
          <SubmitButton variant="primary" size="md">
            <IconPlus size={14} /> Créer
          </SubmitButton>
        </div>
      </form>
    </Panel>
  );
}

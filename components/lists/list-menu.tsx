"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Button, buttonClass } from "@/components/ui/button";
import { ConfirmDialog, type ConfirmDialogHandle } from "@/components/ui/confirm-dialog";
import { IconMore } from "@/components/ui/icons";
import { deleteList, renameList, setListColor } from "@/lib/actions/lists";
import { LIST_NAME_MAX, type ListColor } from "@/lib/lists/palette";
import { showToast } from "@/lib/toast-client";
import { ListColorPicker } from "./list-color-picker";

/**
 * « … » of a list's page: rename, color, delete. A disclosure (button + aria-expanded), closed by
 * Escape or a tap outside. Saves at once and reports to the client header (onChange): no
 * router.refresh(), which would purge the router cache like revalidatePath.
 */
export function ListMenu({
  list,
  count,
  onChange,
}: {
  list: { id: number; name: string; color: ListColor };
  count: number;
  onChange: (next: { name: string; color: ListColor }) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const dialog = useRef<ConfirmDialogHandle>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node) && !(e.target as Element).closest?.("dialog")) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || document.querySelector("dialog[open]")) return;
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

  /** Shows `next` at once, saves, and goes back to `list` if saving fails. */
  function save(next: { name: string; color: ListColor }, run: () => Promise<{ ok: boolean; error?: string }>) {
    onChange(next);
    startTransition(async () => {
      const res = await run();
      if (res.ok) return;
      onChange({ name: list.name, color: list.color });
      showToast({ kind: "error", title: "Listes :", msg: res.error ?? "Enregistrement impossible." });
    });
  }

  return (
    <div ref={root} className="relative">
      <Button variant="ghost-icon" className="md:size-9" aria-label={`Gérer la liste « ${list.name} »`} aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((v) => !v)}>
        <IconMore size={18} />
      </Button>
      <div id={panelId} hidden={!open} className="absolute top-full right-0 z-20 mt-1 flex w-72 flex-col gap-3 rounded-md border border-line bg-surface p-3 shadow-md">
        <form
          className="flex flex-col gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            const name = String(new FormData(e.currentTarget).get("name") ?? "").trim();
            if (name && name !== list.name) save({ name, color: list.color }, () => renameList(list.id, name));
          }}
        >
          <label htmlFor={`${panelId}-name`} className="text-sm font-semibold">
            Nom
          </label>
          <div className="flex gap-1.5">
            <input
              id={`${panelId}-name`}
              name="name"
              key={list.name}
              defaultValue={list.name}
              maxLength={LIST_NAME_MAX}
              enterKeyHint="done"
              className="h-11 min-w-0 flex-1 rounded-sm border border-line-strong bg-surface px-3 text-[16px] text-fg md:h-9 md:text-base"
            />
            <button type="submit" className={buttonClass("secondary", "md")}>
              Renommer
            </button>
          </div>
        </form>
        <ListColorPicker value={list.color} listName={list.name} onChange={(c) => save({ name: list.name, color: c }, () => setListColor(list.id, c))} />
        <div className="border-t border-line pt-3">
          <button type="button" className={buttonClass("danger", "md", "w-full")} onClick={() => dialog.current?.open()}>
            Supprimer la liste
          </button>
        </div>
      </div>
      <ConfirmDialog
        handle={dialog}
        title={`Supprimer la liste « ${list.name} » ?`}
        description={`${count > 0 ? `Ses ${count} article${count > 1 ? "s" : ""} n'y seront plus.` : "Elle est vide."} Les topics restent dans leurs forums et dans tes autres listes.`}
      >
        <button
          type="button"
          className={buttonClass("danger-solid")}
          onClick={() =>
            startTransition(async () => {
              const res = await deleteList(list.id);
              dialog.current?.close();
              if (res.ok) router.replace("/listes");
              else showToast({ kind: "error", title: "Listes :", msg: res.error });
            })
          }
        >
          Supprimer
        </button>
      </ConfirmDialog>
    </div>
  );
}

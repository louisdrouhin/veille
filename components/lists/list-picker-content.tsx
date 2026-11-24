"use client";

import { useId, useState } from "react";
import { LIST_NAME_MAX, nextListColor } from "@/lib/lists/palette";
import type { PickerList } from "@/lib/lists/queries";
import { ListSwatch } from "./list-swatch";
import { Star } from "./star";

export type PickerStatus = { kind: "ok" | "error"; text: string } | null;

const SUGGESTIONS = ["À lire plus tard", "Homelab", "Travail"];

/** One list: the whole row is the label of a real checkbox (≥ 44 px on mobile). */
function ListCheckRow({ list, checked, onChange }: { list: PickerList; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <li>
      <label
        className={`flex min-h-13 cursor-pointer items-center gap-3 px-4 hover:bg-surface-hover md:min-h-[38px] md:gap-2.5 md:px-3 ${
          checked ? "bg-accent-soft" : ""
        } has-[input:focus-visible]:outline-2 has-[input:focus-visible]:-outline-offset-2 has-[input:focus-visible]:outline-focus`}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="size-[22px] shrink-0 cursor-pointer accent-accent focus-visible:outline-none md:size-4"
        />
        <ListSwatch color={list.color} size={14} />
        <span className={`min-w-0 flex-1 truncate text-base ${checked ? "font-semibold" : ""}`}>{list.name}</span>
        <span className="font-mono text-sm text-fg-muted">
          {list.count}
          <span className="sr-only"> article{list.count > 1 ? "s" : ""}</span>
        </span>
      </label>
    </li>
  );
}

/** « Nouvelle liste » on the spot: Enter creates the list and saves the topic in it. */
function NewListInline({
  lists,
  onCreate,
  onClose,
  autoFocus = true,
}: {
  lists: PickerList[];
  onCreate: (name: string) => void;
  onClose?: () => void;
  autoFocus?: boolean;
}) {
  const [name, setName] = useState("");
  const inputId = useId();
  const color = nextListColor(lists.map((l) => l.color));
  const trimmed = name.trim();
  const duplicate = trimmed !== "" && lists.some((l) => l.name === trimmed);

  function submit() {
    if (!trimmed) return;
    onCreate(trimmed);
    setName("");
  }

  return (
    <div className="flex flex-col gap-1.5 px-4 py-2.5 md:px-3">
      <label htmlFor={inputId} className="sr-only">
        Nom de la nouvelle liste
      </label>
      <div className="flex items-center gap-2">
        <ListSwatch color={color} size={14} />
        <input
          id={inputId}
          autoFocus={autoFocus}
          value={name}
          maxLength={LIST_NAME_MAX}
          enterKeyHint="done"
          placeholder="Nom de la liste"
          autoComplete="off"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            } else if (e.key === "Escape" && onClose) {
              // Closes the field only, not the sheet or popover.
              e.preventDefault();
              e.stopPropagation();
              onClose();
            }
          }}
          onBlur={() => {
            if (!trimmed && onClose) onClose();
          }}
          className="h-11 min-w-0 flex-1 rounded-sm border border-line-strong bg-surface px-3 text-[16px] text-fg md:h-9 md:text-base"
        />
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault() /* keep the focus: no blur-close before the click */}
          onClick={submit}
          disabled={!trimmed}
          className="h-11 shrink-0 cursor-pointer rounded-sm bg-accent px-3.5 text-base font-semibold text-accent-fg disabled:cursor-not-allowed disabled:bg-off-soft disabled:text-fg-read md:h-9"
        >
          Créer
        </button>
      </div>
      {duplicate ? (
        <p className="text-sm text-warn">Une liste porte déjà ce nom.</p>
      ) : (
        <p className="text-sm text-fg-muted">Le topic y sera ajouté tout de suite. Couleur modifiable dans Listes.</p>
      )}
    </div>
  );
}

/**
 * Body of the save sheet (mobile) and popover (desktop): one checkbox per list, applied at once,
 * « + Nouvelle liste », the empty state with suggestions, and a status line (no toast while open).
 */
export function ListPickerContent({
  lists,
  selected,
  status,
  onToggle,
  onCreate,
}: {
  lists: PickerList[];
  selected: ReadonlySet<number>;
  status: PickerStatus;
  onToggle: (list: PickerList, on: boolean) => void;
  onCreate: (name: string) => void;
}) {
  const [adding, setAdding] = useState(false);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {lists.length === 0 ? (
        <div className="flex flex-col gap-3 overflow-y-auto py-3">
          <div className="flex items-start gap-3 px-4 md:px-3">
            <span aria-hidden className="inline-flex size-11 shrink-0 items-center justify-center rounded-md bg-saved-soft text-saved">
              <Star filled size={22} />
            </span>
            <div>
              <p className="text-[15px] font-semibold">Aucune liste pour l&apos;instant</p>
              <p className="text-sm text-fg-muted">Crée ta première liste : ce topic y sera ajouté tout de suite.</p>
            </div>
          </div>
          <NewListInline lists={lists} onCreate={onCreate} />
          <div className="flex flex-col gap-2 px-4 md:px-3">
            <p className="text-sm text-fg-muted">Ou en un geste :</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => onCreate(s)}
                  className="inline-flex h-11 cursor-pointer items-center rounded-full border border-line-strong bg-surface px-3.5 text-base hover:bg-surface-hover md:h-8 md:text-sm"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <ul>
            {lists.map((l) => (
              <ListCheckRow key={l.id} list={l} checked={selected.has(l.id)} onChange={(on) => onToggle(l, on)} />
            ))}
          </ul>
          {adding ? (
            <NewListInline
              lists={lists}
              onCreate={(name) => {
                onCreate(name);
                setAdding(false);
              }}
              onClose={() => setAdding(false)}
            />
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="flex min-h-13 w-full cursor-pointer items-center gap-2 border-t border-line px-4 text-base font-semibold text-accent hover:bg-surface-hover md:min-h-[38px] md:px-3"
            >
              <span aria-hidden className="text-lg leading-none">+</span> Nouvelle liste
            </button>
          )}
        </div>
      )}
      <p role="status" className={`min-h-9 border-t border-line px-4 py-2 text-sm md:px-3 ${status?.kind === "error" ? "text-err" : "text-ok"}`}>
        {status?.text ?? ""}
      </p>
    </div>
  );
}

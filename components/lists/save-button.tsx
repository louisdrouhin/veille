"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { PickerList } from "@/lib/lists/queries";
import { ListPickerContent, type PickerStatus } from "./list-picker-content";
import { ListPickerPopover, POPOVER_WIDTH } from "./list-picker-popover";
import { ListSwatch } from "./list-swatch";
import type { SavedState } from "./saved-state";
import { Star } from "./star";
import { useSavedLists } from "./use-saved-lists";

const DESKTOP = "(min-width: 48rem)";

/**
 * « ★ Enregistrer » of the topic page (docs/design/v3 § 3.1-3.4). Opens a bottom sheet (<dialog>,
 * mobile) or an anchored popover (native popover API, desktop) with the same content. Every change
 * applies at once (useOptimistic), rolls back with a message in the status line if the action fails.
 *
 * Rendered as the topic's action bar (docs/design/v3.1 § 1-2): ★ on the left, `actions` (the AI
 * tools) on the right, on one line; the « Dans … » chips under it.
 */
export function SaveButton({
  topicId,
  topicTitle,
  initial,
  actions,
}: {
  topicId: number;
  topicTitle: string;
  initial: SavedState;
  actions?: React.ReactNode;
}) {
  const [status, setStatus] = useState<PickerStatus>(null);
  const { state, toggle: toggleList, create: createNamed } = useSavedLists(topicId, initial, setStatus);
  const [mode, setMode] = useState<"sheet" | "popover" | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDialogElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);
  const titleId = useId();
  const count = state.selected.length;
  const selected = new Set(state.selected);

  function toggle(list: PickerList, on: boolean) {
    setStatus(null);
    toggleList(list, on);
  }

  function create(name: string) {
    setStatus(null);
    createNamed(name);
  }

  function open() {
    setStatus(null);
    if (window.matchMedia(DESKTOP).matches) {
      setMode("popover");
      const pop = popoverRef.current;
      if (pop && !pop.matches(":popover-open")) {
        placePopover();
        pop.showPopover();
      }
    } else {
      setMode("sheet");
      sheetRef.current?.showModal();
    }
  }

  function placePopover() {
    const pop = popoverRef.current;
    const btn = buttonRef.current;
    if (!pop || !btn) return;
    const r = btn.getBoundingClientRect();
    // Left-aligned on the button (left of the action bar), kept on screen.
    const left = Math.max(8, Math.min(r.left, window.innerWidth - POPOVER_WIDTH - 8));
    pop.style.top = `${r.bottom + 8}px`;
    pop.style.left = `${left}px`;
  }

  // Popover: light dismiss (Escape, click outside) closes it natively; follow it, keep it anchored.
  useEffect(() => {
    const pop = popoverRef.current;
    if (!pop) return;
    const onToggle = (e: Event) => {
      if ((e as ToggleEvent).newState === "closed") {
        setMode(null);
        if (pop.contains(document.activeElement) || document.activeElement === document.body) buttonRef.current?.focus();
      }
    };
    pop.addEventListener("toggle", onToggle);
    return () => pop.removeEventListener("toggle", onToggle);
  }, []);
  useEffect(() => {
    if (mode !== "popover") return;
    window.addEventListener("scroll", placePopover, { passive: true });
    window.addEventListener("resize", placePopover);
    return () => {
      window.removeEventListener("scroll", placePopover);
      window.removeEventListener("resize", placePopover);
    };
  }, [mode]);

  // Focus back on the button explicitly: a tap does not focus it (iOS), so the dialog's own
  // focus restoration would land on <body>.
  const onSheetClosed = useCallback(() => {
    setMode(null);
    buttonRef.current?.focus();
  }, []);

  const label = count > 0 ? `Enregistré dans ${count} liste${count > 1 ? "s" : ""}, modifier` : "Enregistrer dans une liste";
  const savedLists = state.lists.filter((l) => selected.has(l.id));

  return (
    <div className="flex flex-col gap-2">
      <div role="group" aria-label="Actions sur l'article" className="flex flex-nowrap items-center justify-between gap-2">
        <button
          ref={buttonRef}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={mode !== null}
          aria-label={label}
          // A click on the button while the popover is open: light dismiss has already closed it
          // (on pointerdown/up), so the click must not reopen it.
          onPointerDown={() => {
            wasOpen.current = popoverRef.current?.matches(":popover-open") ?? false;
          }}
          onClick={() => {
            if (wasOpen.current) {
              wasOpen.current = false;
              const pop = popoverRef.current;
              if (pop?.matches(":popover-open")) pop.hidePopover();
              return;
            }
            open();
          }}
          // Mobile spacing a little tighter than v3 so that ★ + the AI tools fit on one line at 390 px.
          className={`inline-flex h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-sm border px-3 text-base font-semibold text-fg md:h-[34px] md:gap-2 md:px-3.5 md:text-sm ${
            count > 0 ? "border-saved bg-saved-soft" : "border-line-strong bg-surface shadow-sm hover:bg-surface-hover"
          }`}
        >
          <Star filled={count > 0} size={16} />
          {count > 0 ? "Enregistré" : "Enregistrer"}
          {count > 0 && <span className="rounded-full bg-saved px-1.5 font-mono text-xs font-bold text-saved-soft">{count}</span>}
        </button>
        {actions}
      </div>

      {savedLists.length > 0 && <ListChips lists={savedLists} />}

      {/* Mobile: bottom sheet. showModal() makes the page inert (toasts, « Remonter en haut ») under the scrim. */}
      <BottomSheet ref={sheetRef} titleId={titleId} topicTitle={topicTitle} onClosed={onSheetClosed}>
        {mode === "sheet" && (
          <ListPickerContent lists={state.lists} selected={selected} status={status} onToggle={toggle} onCreate={create} />
        )}
      </BottomSheet>

      {/* Desktop: popover anchored under the button, left-aligned. */}
      <ListPickerPopover ref={popoverRef} titleId={`${titleId}-pop`}>
        {mode === "popover" && <ListPickerContent lists={state.lists} selected={selected} status={status} onToggle={toggle} onCreate={create} />}
      </ListPickerPopover>
    </div>
  );
}

/** « Dans [■ Homelab] [■ À lire plus tard] » under the action bar. */
function ListChips({ lists }: { lists: PickerList[] }) {
  return (
    <p className="flex flex-wrap items-center gap-1.5 text-sm text-fg-muted">
      <span>Dans</span>
      {lists.map((l) => (
        <Link
          key={l.id}
          href={`/listes/${l.id}`}
          className="inline-flex h-7 items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 text-sm text-fg no-underline hover:bg-surface-hover hover:text-fg"
        >
          <ListSwatch color={l.color} size={10} />
          {l.name}
        </Link>
      ))}
    </p>
  );
}

/**
 * Modal <dialog> styled as a bottom sheet: scrim over everything, focus kept inside, focus back on
 * the opener when closed (native). Closes with « Fermer », a tap on the scrim, Escape, or a swipe down
 * on its top bar. Rises above the iOS keyboard (visualViewport).
 */
function BottomSheet({
  ref,
  titleId,
  topicTitle,
  onClosed,
  children,
}: {
  ref: React.RefObject<HTMLDialogElement | null>;
  titleId: string;
  topicTitle: string;
  onClosed: () => void;
  children: React.ReactNode;
}) {
  const [drag, setDrag] = useState(0);
  const [keyboard, setKeyboard] = useState(0);
  const start = useRef<number | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const onClick = (e: MouseEvent) => {
      if (e.target === dialog) dialog.close(); // tap on the scrim
    };
    const onClose = () => {
      setDrag(0);
      onClosed();
    };
    dialog.addEventListener("click", onClick);
    dialog.addEventListener("close", onClose);
    return () => {
      dialog.removeEventListener("click", onClick);
      dialog.removeEventListener("close", onClose);
    };
  }, [ref, onClosed]);

  // iOS keyboard: the layout viewport keeps its height, the sheet would stay under the keyboard.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setKeyboard(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)));
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className="fixed inset-x-0 top-auto bottom-0 m-0 max-h-[85dvh] w-full max-w-none flex-col rounded-t-[14px] border-t border-line-strong bg-surface p-0 pb-[calc(env(safe-area-inset-bottom)+12px)] text-fg shadow-[0_-8px_30px_rgba(0,0,0,.25)] backdrop:bg-scrim open:flex motion-safe:transition-transform"
      style={{ transform: drag ? `translateY(${drag}px)` : undefined, bottom: keyboard || undefined }}
    >
      <div
        className="shrink-0 touch-none pt-2"
        onPointerDown={(e) => {
          start.current = e.clientY;
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (start.current !== null) setDrag(Math.max(0, e.clientY - start.current));
        }}
        onPointerUp={() => {
          if (drag > 80) ref.current?.close();
          else setDrag(0);
          start.current = null;
        }}
        onPointerCancel={() => {
          start.current = null;
          setDrag(0);
        }}
      >
        <span aria-hidden className="mx-auto block h-[5px] w-10 rounded-full bg-line-strong" />
        <div className="flex items-start gap-3 px-4 pt-2 pb-2.5">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="font-cond text-lg font-bold">
              Enregistrer dans…
            </h2>
            <p className="truncate text-sm text-fg-muted">{topicTitle}</p>
          </div>
          <button
            type="button"
            onClick={() => ref.current?.close()}
            className="-mr-2 inline-flex h-11 shrink-0 cursor-pointer items-center px-2 text-base font-semibold text-accent"
          >
            Fermer
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col border-t border-line">{children}</div>
    </dialog>
  );
}

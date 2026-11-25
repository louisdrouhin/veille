"use client";

export const POPOVER_WIDTH = 320;

/**
 * The ★ popover (desktop, native popover API, light dismiss): « Enregistrer dans… » and the list
 * picker. Used by the topic page's ★ and by « Nouvelle liste… » of a topic row's menu.
 */
export function ListPickerPopover({
  ref,
  titleId,
  arrowLeft = 28,
  children,
}: {
  ref: React.RefObject<HTMLDivElement | null>;
  titleId: string;
  /** Position of the arrow (px from the left), under the anchor. */
  arrowLeft?: number;
  children: React.ReactNode;
}) {
  return (
    <div
      ref={ref}
      popover="auto"
      role="dialog"
      aria-labelledby={titleId}
      className="fixed m-0 w-80 overflow-visible rounded-md border border-line bg-surface p-0 text-fg shadow-md [inset:auto]"
    >
      <span aria-hidden className="absolute -top-1.5 size-3 rotate-45 border-t border-l border-line bg-bar-2" style={{ left: arrowLeft }} />
      <div className="relative flex h-9 items-center rounded-t-md bg-bar-2 px-3">
        <h2 id={titleId} className="font-cond text-sm font-semibold tracking-caps text-bar-fg uppercase">
          Enregistrer dans…
        </h2>
      </div>
      <div className="flex max-h-[60vh] flex-col">{children}</div>
    </div>
  );
}

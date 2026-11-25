"use client";

import { useEffect, useId, useRef, useState } from "react";
import { IconClose } from "./icons";

/**
 * Modal <dialog>: a bottom sheet on mobile, a centered dialog from md (docs/design/3.0 § 4.2).
 * showModal() makes the page inert under the scrim (« Remonter en haut » and toasts included), keeps
 * the focus inside, and gives it back to the opener when closed. Closes with ✕, Escape, a tap on the
 * scrim, or (mobile) a swipe down on its top bar. Rises above the iOS keyboard.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [drag, setDrag] = useState(0);
  const [keyboard, setKeyboard] = useState(0);
  const start = useRef<number | null>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      opener.current = document.activeElement;
      dialog.showModal();
    } else if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const onClick = (e: MouseEvent) => {
      if (e.target === dialog) dialog.close();
    };
    const onCloseEvent = () => {
      setDrag(0);
      onClose();
      // A tap does not focus the opener on iOS: give the focus back explicitly.
      if (opener.current instanceof HTMLElement && opener.current.isConnected) opener.current.focus();
    };
    dialog.addEventListener("click", onClick);
    dialog.addEventListener("close", onCloseEvent);
    return () => {
      dialog.removeEventListener("click", onClick);
      dialog.removeEventListener("close", onCloseEvent);
    };
  }, [onClose]);

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
      className={`fixed inset-x-0 top-auto bottom-0 m-0 max-h-[88dvh] w-full max-w-none flex-col rounded-t-[14px] border-t border-line-strong bg-surface p-0 pb-[calc(env(safe-area-inset-bottom)+12px)] text-fg shadow-[0_-8px_30px_rgba(0,0,0,.25)] backdrop:bg-scrim open:flex motion-safe:transition-transform md:inset-0 md:m-auto md:max-h-[min(720px,90dvh)] md:rounded-lg md:border md:pb-4 md:shadow-md ${
        wide ? "md:w-[560px]" : "md:w-[480px]"
      }`}
      style={{ transform: drag ? `translateY(${drag}px)` : undefined, bottom: keyboard || undefined }}
    >
      <div
        className="shrink-0 touch-none pt-2 md:hidden"
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
          setDrag(0);
          start.current = null;
        }}
      >
        <div className="mx-auto h-1.5 w-10 rounded-full bg-line-strong" />
      </div>
      <div className="flex shrink-0 items-center gap-2 px-4 pt-2 pb-1 md:pt-4">
        <h2 id={titleId} className="min-w-0 flex-1 font-cond text-lg font-bold">
          {title}
        </h2>
        <button
          type="button"
          onClick={() => ref.current?.close()}
          aria-label="Fermer"
          title="Fermer"
          className="-mr-2 inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-sm text-fg-muted hover:bg-surface-hover md:size-8"
        >
          <IconClose size={16} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-1 pb-1">{children}</div>
    </dialog>
  );
}

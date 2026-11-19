"use client";

import { useEffect, useId, useRef } from "react";

/**
 * Native <dialog> confirmation. `trigger` renders the opening button; the dialog
 * body (`children`) usually contains forms bound to server actions.
 * The « Annuler » button gets the focus by default.
 */
export function ConfirmDialog({
  title,
  description,
  trigger,
  children,
}: {
  title: string;
  description: React.ReactNode;
  trigger: (open: () => void) => React.ReactNode;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    // Close when clicking the backdrop.
    const onClick = (e: MouseEvent) => {
      if (e.target === dialog) dialog.close();
    };
    dialog.addEventListener("click", onClick);
    return () => dialog.removeEventListener("click", onClick);
  }, []);

  return (
    <>
      {trigger(() => ref.current?.showModal())}
      <dialog
        ref={ref}
        aria-labelledby={titleId}
        aria-describedby={descId}
        className="m-auto w-[min(420px,calc(100vw-24px))] rounded-lg border border-line bg-surface p-4.5 text-fg shadow-md backdrop:bg-black/40"
      >
        <h2 id={titleId} className="text-md font-semibold">
          {title}
        </h2>
        <div id={descId} className="mt-1.5 text-base text-fg-muted">
          {description}
        </div>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            autoFocus
            onClick={() => ref.current?.close()}
            className="inline-flex h-8 cursor-pointer items-center rounded-sm border border-line-strong bg-surface px-3 text-sm font-semibold text-fg shadow-sm hover:bg-surface-hover max-md:h-11"
          >
            Annuler
          </button>
          {children}
        </div>
      </dialog>
    </>
  );
}

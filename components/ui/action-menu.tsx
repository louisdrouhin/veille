"use client";

import { useEffect, useId, useRef } from "react";
import { IconMore } from "./icons";

export type MenuAction = { label: string; icon?: React.ReactNode; onSelect: () => void; danger?: boolean };

/**
 * A small ⋯ menu (docs/design/3.3 § 2, a reprise's menu): native popover (light dismiss, top layer), ARIA menu
 * pattern — arrows, Home / End, Escape and Tab close it and give the focus back to the button.
 */
export function ActionMenu({ label, actions, className = "" }: { label: string; actions: MenuAction[]; className?: string }) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = menu.current;
    if (!el) return;
    const onToggle = (e: Event) => {
      const open = (e as ToggleEvent).newState === "open";
      button.current?.setAttribute("aria-expanded", String(open));
      if (open) {
        const r = button.current!.getBoundingClientRect();
        el.style.top = `${Math.min(r.bottom + 4, window.innerHeight - el.offsetHeight - 8)}px`;
        el.style.left = `${Math.max(8, r.right - el.offsetWidth)}px`;
        el.querySelector<HTMLElement>("[role=menuitem]")?.focus();
      } else if (el.contains(document.activeElement) || document.activeElement === document.body) button.current?.focus();
    };
    el.addEventListener("toggle", onToggle);
    return () => el.removeEventListener("toggle", onToggle);
  }, []);

  function onKeyDown(e: React.KeyboardEvent) {
    e.stopPropagation(); // never the page shortcuts (« u », Escape: back)
    const items = [...(menu.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => items[(n + items.length) % items.length]?.focus();
    if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(-1);
    else if (e.key === "Escape" || e.key === "Tab") menu.current?.hidePopover();
    else return;
    e.preventDefault();
  }

  return (
    <>
      <button
        ref={button}
        type="button"
        popoverTarget={id}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded="false"
        className={`inline-flex size-7 cursor-pointer items-center justify-center rounded-sm text-fg-muted hover:bg-surface-hover hover:text-fg max-md:size-11 ${className}`}
      >
        <IconMore size={16} />
      </button>
      <div
        ref={menu}
        id={id}
        popover="auto"
        role="menu"
        aria-label={label}
        onKeyDown={onKeyDown}
        className="fixed m-0 w-max max-w-[300px] min-w-[240px] rounded-md border border-line-strong bg-surface p-0 py-1 text-fg shadow-md [inset:auto]"
      >
        {actions.map((a) => (
          <button
            key={a.label}
            type="button"
            role="menuitem"
            tabIndex={-1}
            onClick={() => {
              menu.current?.hidePopover();
              a.onSelect();
            }}
            onPointerEnter={(e) => e.currentTarget.focus()}
            className={`flex h-8 w-full cursor-pointer items-center gap-2.5 px-3 text-left text-[13.5px] outline-none hover:bg-surface-hover focus:bg-surface-hover max-md:h-11 max-md:text-base ${a.danger ? "text-err" : "text-fg"}`}
          >
            {a.icon && <span className={`inline-flex shrink-0 ${a.danger ? "" : "text-fg-muted"}`}>{a.icon}</span>}
            {a.label}
          </button>
        ))}
      </div>
    </>
  );
}

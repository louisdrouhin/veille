"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { IconSearch } from "@/components/ui/icons";
import { shouldIgnoreShortcut } from "@/lib/nav-history";
import { SearchField } from "./search-field";

const DESKTOP = "(min-width: 48rem)";

/**
 * The search entry of the header (docs/design/3.3 § 3): a 300 px field on desktop; on mobile a magnifier
 * left of the Ma stack shield, opening a full-screen input screen (modal <dialog>: the page, « Remonter en
 * haut » and pull to refresh are inert behind it). `/` or Ctrl+K (⌘K) focuses it — no other shortcut of the
 * app uses them; ignored while typing in a field or with a dialog or menu open.
 */
export function HeaderSearch({ part }: { part: "desktop" | "mobile" }) {
  const pathname = usePathname();
  const desktopInput = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [overlay, setOverlay] = useState(false);

  useEffect(() => {
    if (part !== "desktop") return;
    function onKey(e: KeyboardEvent) {
      const ctrlK = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k";
      const slash = e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey;
      if (!ctrlK && !slash) return;
      // Ctrl+K works from a field too (like most apps); « / » never steals a character being typed.
      if (slash && shouldIgnoreShortcut(e)) return;
      if (ctrlK && (e.isComposing || document.querySelector("dialog[open]"))) return;
      e.preventDefault();
      if (window.matchMedia(DESKTOP).matches) desktopInput.current?.focus();
      else window.dispatchEvent(new Event("folders:open-search"));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [part]);

  useEffect(() => {
    if (part !== "mobile") return;
    const open = () => setOverlay(true);
    window.addEventListener("folders:open-search", open);
    return () => window.removeEventListener("folders:open-search", open);
  }, [part]);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (overlay && !d.open) d.showModal();
    else if (!overlay && d.open) d.close();
  }, [overlay]);

  if (part === "desktop") return <SearchField key={pathname} variant="header" inputRef={desktopInput} />;

  return (
    <>
      <button
        type="button"
        aria-label="Rechercher ou demander à ta veille"
        aria-haspopup="dialog"
        onClick={() => setOverlay(true)}
        className="inline-flex size-11 cursor-pointer items-center justify-center rounded-sm text-bar-fg hover:bg-white/8 focus-visible:outline-bar-accent"
      >
        <IconSearch size={20} />
      </button>
      <dialog
        ref={dialog}
        aria-label="Rechercher ou demander à ta veille"
        onClose={() => setOverlay(false)}
        className="fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none bg-bg p-0 text-fg backdrop:bg-scrim"
      >
        {overlay && (
          <div className="safe-top safe-x flex min-h-full flex-col">
            <div className="flex items-center gap-2 border-b border-black/30 bg-bar px-3 py-2">
              <div className="min-w-0 flex-1">
                <SearchField variant="overlay" autoFocus onDone={() => setOverlay(false)} />
              </div>
              <button type="button" onClick={() => setOverlay(false)} className="h-11 shrink-0 cursor-pointer px-2 text-base font-semibold text-bar-fg">
                Annuler
              </button>
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}

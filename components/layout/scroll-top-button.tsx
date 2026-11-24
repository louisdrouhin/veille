"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { IconArrowUp } from "@/components/ui/icons";
import { scrollTopBehavior, showScrollTop } from "@/lib/scroll-top";

/**
 * Mobile-only floating « Remonter en haut » button, bottom right. Rendered as the first item of
 * the toast stack (components/ui/toaster.tsx), so toasts stack under it instead of behind it and
 * it inherits the stack's safe-area offset. Hidden while the note form is on screen.
 */
export function ScrollTopButton() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const form = document.getElementById("note-form")?.getBoundingClientRect() ?? null;
      setVisible(showScrollTop({ scrollY: window.scrollY, viewportHeight: window.innerHeight, noteForm: form }));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    schedule(); // new page (pathname): re-check, the note form may have appeared or gone
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [pathname]);

  if (!visible) return null;
  return (
    <button
      type="button"
      aria-label="Remonter en haut"
      title="Remonter en haut"
      onClick={() => {
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        window.scrollTo({ top: 0, behavior: scrollTopBehavior(reduced) });
      }}
      className="pointer-events-auto inline-flex size-11 cursor-pointer items-center justify-center self-end rounded-full border border-line-strong bg-surface text-fg shadow-md hover:bg-surface-hover md:hidden"
    >
      <IconArrowUp size={18} />
    </button>
  );
}

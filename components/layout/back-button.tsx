"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { IconArrowLeft } from "@/components/ui/icons";
import { backAction, shouldIgnoreShortcut, type BackMode } from "@/lib/nav-history";

const CLASS =
  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-sm border border-line-strong bg-surface px-2.5 text-sm font-semibold " +
  "text-fg no-underline shadow-sm hover:bg-surface-hover hover:text-fg max-md:h-11 max-md:px-3.5 max-md:text-base";

/**
 * "← Retour": router.back() when the previous in-app page is where we go back to
 * (keeps its page and scroll position), otherwise a plain link to `href`.
 * Keyboard: Escape or "u" go up one level the same way.
 */
export function BackButton({ href, mode = "parent", label = "Retour" }: { href: string; mode?: BackMode; label?: string }) {
  const router = useRouter();

  function goBack(event?: { preventDefault(): void }) {
    if (backAction(href, mode) === "history") {
      event?.preventDefault();
      router.back();
    } else if (!event) {
      router.push(href);
    }
    // Click without history: the <Link> navigates to href itself.
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape" && event.key !== "u") return;
      if (shouldIgnoreShortcut(event)) return;
      event.preventDefault();
      goBack();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <Link href={href} onClick={(e) => goBack(e)} className={CLASS} aria-keyshortcuts="Escape u" title="Retour (Échap ou U)">
      <IconArrowLeft size={14} />
      {label}
    </Link>
  );
}

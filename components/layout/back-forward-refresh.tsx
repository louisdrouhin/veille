"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";

/** Delay after popstate: the router has restored the page and the browser its scroll position. */
const SETTLE_MS = 250;

/**
 * After a browser back / forward navigation (the « ← Retour » button uses router.back()
 * too), the page comes from the router cache: same page, same scroll, but data as of
 * the first visit. Once it is shown, refresh it in the background to resync counters
 * (unread, « Tout marquer comme lu »…). router.refresh() re-renders the server components
 * in place; should the re-render still move the page, the scroll position is put back.
 */
export function BackForwardRefresh() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const savedScroll = useRef<number | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onPop = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        savedScroll.current = window.scrollY;
        startTransition(() => router.refresh());
      }, SETTLE_MS);
    };
    window.addEventListener("popstate", onPop);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("popstate", onPop);
    };
  }, [router]);

  useEffect(() => {
    if (isPending || savedScroll.current === null) return;
    const y = savedScroll.current;
    savedScroll.current = null;
    if (Math.abs(window.scrollY - y) > 2) window.scrollTo(0, y);
  }, [isPending]);

  return null;
}

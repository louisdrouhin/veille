"use client";

import { useEffect, useSyncExternalStore } from "react";

/**
 * The briefings opened during this visit: the header (kept across navigations, rendered before) drops its « nouveau »
 * dot at once, without router.refresh (docs/design/3.4 § 5).
 */
const seen = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useBriefingSeen(day: string | null | undefined): boolean {
  useSyncExternalStore(subscribe, () => version, () => 0);
  return !!day && seen.has(day);
}

/** Rendered by the briefing page once it is shown (ready). */
export function MarkBriefingSeen({ day }: { day: string }) {
  useEffect(() => {
    if (seen.has(day)) return;
    seen.add(day);
    version++;
    listeners.forEach((l) => l());
  }, [day]);
  return null;
}

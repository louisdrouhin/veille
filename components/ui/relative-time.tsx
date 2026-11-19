"use client";

import { useSyncExternalStore } from "react";
import { formatRelative, formatTitle } from "@/lib/format-date";

// One shared clock ticking every minute for all <RelativeTime> on the page.
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

function subscribe(listener: () => void) {
  listeners.add(listener);
  timer ??= setInterval(() => listeners.forEach((l) => l()), 60_000);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}
/** Current time in 10 s buckets: stable between calls, so React does not loop or re-render needlessly. */
const nowBucket = () => Math.floor(Date.now() / 10_000) * 10_000;

/**
 * <time> rendered on the server, then refreshed every 60 s on the client
 * (suppressHydrationWarning absorbs the small server/client gap).
 */
export function RelativeTime({ date, className }: { date: Date | string; className?: string }) {
  const d = typeof date === "string" ? new Date(date) : date;
  const now = useSyncExternalStore(subscribe, nowBucket, nowBucket);

  return (
    <time dateTime={d.toISOString()} title={formatTitle(d)} className={className} suppressHydrationWarning>
      {formatRelative(d, new Date(now))}
    </time>
  );
}

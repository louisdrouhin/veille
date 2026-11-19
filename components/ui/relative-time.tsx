"use client";

import { useEffect, useState } from "react";
import { formatRelative, formatTitle } from "@/lib/format-date";

/**
 * <time> rendered on the server, then refreshed every 60 s on the client
 * (suppressHydrationWarning absorbs the small server/client gap).
 */
export function RelativeTime({ date, className }: { date: Date | string; className?: string }) {
  const d = typeof date === "string" ? new Date(date) : date;
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <time dateTime={d.toISOString()} title={formatTitle(d)} className={className} suppressHydrationWarning>
      {formatRelative(d, now)}
    </time>
  );
}

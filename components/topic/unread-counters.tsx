"use client";

import { CountPill } from "@/components/ui/badge";
import { plural } from "@/lib/format-date";
import { useUnreadCount } from "./read-topics";

/*
 * Unread counters rendered by the server, kept in step with « Marquer comme lu / non lu » of the
 * topic row menu (docs/design/3.2 § 5) without refreshing the page: see read-topics.tsx.
 * `renderedAt`: server time of the render (ms).
 */

/** Forum page: « 42 topics · 3 non lus » / « tout est lu ». */
export function ForumUnreadSummary({ total, unread, renderedAt, slug }: { total: number; unread: number; renderedAt: number; slug: string }) {
  const n = useUnreadCount(unread, renderedAt, slug);
  return (
    <p className="mt-0.5 text-sm text-fg-muted">
      {plural(total, "topic")} · {n > 0 ? <strong className="font-bold text-accent">{n} non lu{n > 1 ? "s" : ""}</strong> : "tout est lu"}
    </p>
  );
}

/** Home, forum table: the unread pill of one forum. */
export function ForumUnreadPill({ unread, renderedAt, slug }: { unread: number; renderedAt: number | undefined; slug: string }) {
  return <CountPill count={useUnreadCount(unread, renderedAt, slug)} srLabel="non lus" />;
}

/** Home summary: « N non lus ». */
export function UnreadStat({ unread, renderedAt, className, labelClass, valueClass }: { unread: number; renderedAt: number | undefined; className: string; labelClass: string; valueClass: string }) {
  const n = useUnreadCount(unread, renderedAt);
  return (
    <div className={className}>
      <dt className={labelClass}>non lu{n > 1 ? "s" : ""}</dt>
      <dd className={`${valueClass} ${n > 0 ? "text-accent" : "text-fg-read"}`}>{n}</dd>
    </div>
  );
}

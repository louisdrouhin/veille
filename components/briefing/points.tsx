"use client";

import Link from "next/link";
import { useId } from "react";
import { SourceStack } from "@/components/home/featured";
import { FORUM_BADGE, type TopicRowData } from "@/components/topic/topic-grid";
import { ROW_MENU_STATES, useCurrentRead, useRowMenu } from "@/components/topic/row-menu";
import type { RowMenu } from "@/components/topic/topic-menu";
import { IconChevronRight } from "@/components/ui/icons";
import type { TopicPoint } from "@/lib/briefing/types";

const MENU: RowMenu = { context: "home" };

export type PointData = TopicPoint & { read: boolean; url?: string };

const rowData = (p: PointData): TopicRowData => ({
  id: p.topicId,
  title: p.title,
  replyCount: 0,
  lastActivityAt: new Date(0),
  read: p.read,
  sourceName: p.sources[0] ?? null,
  faviconSrc: null,
  forum: p.forum,
  forumSlug: p.forum.slug,
  url: p.url,
});

/**
 * A point of À la une or Mes services (docs/design/3.4 § 3): one link to the topic (its name is the title, the sentence
 * describes it), sources and forum; chevron on mobile, ⋯ and the context menu (3.2) on desktop. 48 px at least.
 */
export function TopicPointRow({ point }: { point: PointData }) {
  const topic = useCurrentRead(rowData(point));
  const { rowProps, more } = useRowMenu(topic, MENU);
  const descId = useId();
  return (
    <li {...rowProps} className={`relative grid min-h-12 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-t border-line px-3.5 py-2.5 first:border-t-0 md:px-4 ${ROW_MENU_STATES}`}>
      <div className="min-w-0">
        <Link
          href={`/t/${point.topicId}`}
          prefetch={false}
          data-topic-link
          aria-describedby={point.sentence ? descId : undefined}
          className={`text-md no-underline after:absolute after:inset-0 focus-visible:outline-none ${topic.read ? "font-normal text-fg-read hover:text-fg-read" : "font-bold text-fg hover:text-fg"}`}
        >
          {point.title}
          {topic.read && <span className="font-normal text-fg-muted"> · lu</span>}
        </Link>
        {point.sentence && (
          <p id={descId} className="mt-0.5 text-[14.5px] leading-[21px] text-fg">
            {point.sentence}
          </p>
        )}
        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12.5px] leading-4 text-fg-muted">
          <SourceStack names={point.sources} size={20} />
          <span className="font-semibold text-fg">
            {point.sources.length} source{point.sources.length > 1 ? "s" : ""}
          </span>
          <span aria-hidden>·</span>
          <span className={FORUM_BADGE}>{point.forum.name}</span>
        </p>
      </div>
      <IconChevronRight size={16} className="text-fg-muted desk:hidden" />
      {more}
    </li>
  );
}

/** « Le reste en bref »: one line, « Titre — phrase », number of sources in mono on the right. */
export function BriefRow({ point }: { point: PointData }) {
  const topic = useCurrentRead(rowData(point));
  const { rowProps, more } = useRowMenu(topic, MENU);
  return (
    <li {...rowProps} className={`relative grid min-h-12 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 border-t border-line px-3.5 py-2 first:border-t-0 md:px-4 ${ROW_MENU_STATES}`}>
      <p className="min-w-0 text-[14.5px] leading-[21px]">
        <Link
          href={`/t/${point.topicId}`}
          prefetch={false}
          data-topic-link
          className={`no-underline after:absolute after:inset-0 focus-visible:outline-none ${topic.read ? "font-normal text-fg-read hover:text-fg-read" : "font-bold text-fg hover:text-fg"}`}
        >
          {point.title}
          {topic.read && <span className="font-normal text-fg-muted"> · lu</span>}
        </Link>
        {point.sentence && <span className="text-fg-muted"> — {point.sentence}</span>}
      </p>
      <span className="font-mono text-xs text-fg-muted" aria-label={`${point.sources.length} source${point.sources.length > 1 ? "s" : ""}`}>
        {point.sources.length}
      </span>
      {more}
    </li>
  );
}

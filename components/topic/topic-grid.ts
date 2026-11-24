/** Topic table layout and row data, shared by the server list and the client row. */
export type TopicRowData = {
  id: number;
  title: string;
  replyCount: number;
  lastActivityAt: Date;
  read: boolean;
  hot?: boolean; // v2
  sourceName: string | null;
  /** Stored favicon (faviconUrl()), null → initial. */
  faviconSrc: string | null;
  /** Number of favorite lists holding the topic (★ mark). */
  savedCount?: number;
  /** Lists mixing forums (home « Derniers non lus »): shown with `showForum`. */
  forum?: { name: string; slug: string };
};

export const TOPIC_GRID = "md:grid-cols-[28px_minmax(0,1fr)_190px_56px_124px]";
/** icon | subject | forum | source | Nb | date */
export const TOPIC_GRID_WITH_FORUM = "md:grid-cols-[28px_minmax(0,1fr)_150px_170px_48px_112px]";

const ROW_BASE =
  "relative grid grid-cols-[22px_minmax(0,1fr)] gap-x-2.5 px-3.5 py-2.5 md:min-h-[38px] md:items-center md:gap-x-3 md:px-4 md:py-0 " +
  "border-t border-line first:border-t-0 odd:bg-surface even:bg-surface-alt";

export const TOPIC_ROW = `${ROW_BASE} ${TOPIC_GRID}`;
export const TOPIC_ROW_WITH_FORUM = `${ROW_BASE} ${TOPIC_GRID_WITH_FORUM}`;

/** Forum name as a small caps badge (docs/design/v2 § 2.1). */
export const FORUM_BADGE =
  "rounded-sm border border-line-strong px-1 font-cond text-2xs font-bold uppercase tracking-[.06em] text-fg-muted";

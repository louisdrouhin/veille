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
};

export const TOPIC_GRID = "md:grid-cols-[28px_minmax(0,1fr)_190px_56px_124px]";
export const TOPIC_ROW =
  `relative grid grid-cols-[22px_minmax(0,1fr)] gap-x-2.5 px-3.5 py-2.5 md:min-h-[38px] md:items-center md:gap-x-3 md:px-4 md:py-0 ${TOPIC_GRID} ` +
  "border-t border-line first:border-t-0 odd:bg-surface even:bg-surface-alt";

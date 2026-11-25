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
  /** In a favorite list: the date shown is the date of addition (« ajouté il y a 2 h »). */
  addedAt?: Date;
  /** Lists mixing forums (home « Derniers non lus »): shown with `showForum`. */
  forum?: { name: string; slug: string };
  /** Article on its site (« Ouvrir l'article d'origine », « Copier le lien de l'article »). */
  url?: string;
  /** Forum of the topic, for the unread counters of the row menu (docs/design/3.2). */
  forumSlug?: string;
};

// desk: (≥ md with a fine pointer) adds the 32 px column of the row's ⋯ button, always reserved (docs/design/3.2 § 4).
export const TOPIC_GRID = "md:grid-cols-[28px_minmax(0,1fr)_190px_56px_124px] desk:grid-cols-[28px_minmax(0,1fr)_190px_56px_124px_32px]";
/** icon | subject | forum | source | Nb | date */
export const TOPIC_GRID_WITH_FORUM =
  "md:grid-cols-[28px_minmax(0,1fr)_150px_170px_48px_112px] desk:grid-cols-[28px_minmax(0,1fr)_150px_170px_48px_112px_32px]";

const ROW_BASE =
  "relative grid grid-cols-[22px_minmax(0,1fr)] gap-x-2.5 px-3.5 py-2.5 md:min-h-[38px] md:items-center md:gap-x-3 md:px-4 md:py-0 " +
  "border-t border-line first:border-t-0 odd:bg-surface even:bg-surface-alt";

export const TOPIC_ROW = `${ROW_BASE} ${TOPIC_GRID}`;
export const TOPIC_ROW_WITH_FORUM = `${ROW_BASE} ${TOPIC_GRID_WITH_FORUM}`;
/** A favorite list's rows: same columns plus « retirer » (36 px on desktop, 48 px beside the link on mobile). */
export const TOPIC_GRID_IN_LIST =
  "md:grid-cols-[28px_minmax(0,1fr)_150px_170px_48px_140px_36px] desk:grid-cols-[28px_minmax(0,1fr)_150px_170px_48px_140px_36px_32px]";
export const TOPIC_ROW_IN_LIST =
  "relative grid grid-cols-[22px_minmax(0,1fr)_48px] gap-x-2.5 pl-3.5 py-2.5 md:min-h-[38px] md:items-center md:gap-x-3 md:px-4 md:py-0 " +
  `border-t border-line first:border-t-0 odd:bg-surface even:bg-surface-alt ${TOPIC_GRID_IN_LIST}`;

/** Forum name as a small caps badge (docs/design/v2 § 2.1). */
export const FORUM_BADGE =
  "rounded-sm border border-line-strong px-1 font-cond text-2xs font-bold uppercase tracking-[.06em] text-fg-muted";

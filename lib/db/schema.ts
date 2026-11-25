import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  index,
  integer,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { LIST_COLORS } from "@/lib/lists/palette";
import { THEMES } from "@/lib/theme";

const tsz = (name: string) => timestamp(name, { withTimezone: true });

// ---------------------------------------------------------------------------
// Application tables
// ---------------------------------------------------------------------------

/** Forum icons drawn in the design system (components/forum/forum-icon.tsx). */
export const FORUM_ICONS = ["sec", "ops", "lab", "news", "web"] as const;
export type ForumIconName = (typeof FORUM_ICONS)[number];

export const forums = pgTable("forums", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  position: integer("position").notNull().default(0),
  description: text("description").notNull().default(""),
  icon: text("icon", { enum: FORUM_ICONS }).notNull().default("news"),
});

export const sources = pgTable(
  "sources",
  {
    id: serial("id").primaryKey(),
    // A forum cannot be deleted while it still has sources.
    forumId: integer("forum_id")
      .notNull()
      .references(() => forums.id, { onDelete: "restrict" }),
    type: text("type", { enum: ["rss"] }).notNull().default("rss"),
    name: text("name").notNull(),
    url: text("url").notNull().unique(),
    enabled: boolean("enabled").notNull().default(true),
    etag: text("etag"),
    lastModified: text("last_modified"),
    /** Last successful fetch (200 or 304). Null = never fetched successfully. */
    lastFetchedAt: tsz("last_fetched_at"),
    lastError: text("last_error"),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    /** Set for 1 h after 3 consecutive failures; the worker skips the source until then. */
    pausedUntil: tsz("paused_until"),
  },
  (t) => [index("sources_forum_idx").on(t.forumId)],
);

const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({ dataType: () => "bytea" });

/**
 * Favicon of each source, downloaded by the worker (never by the browser) and
 * served by /api/favicon/[sourceId]. A row with `data = null` means « looked,
 * nothing usable »; it is retried after FAVICON_TTL like a real icon.
 */
export const sourceFavicons = pgTable("source_favicons", {
  sourceId: integer("source_id")
    .primaryKey()
    .references(() => sources.id, { onDelete: "cascade" }),
  contentType: text("content_type"),
  data: bytea("data"),
  fetchedAt: tsz("fetched_at").notNull(),
});

export const topics = pgTable(
  "topics",
  {
    id: serial("id").primaryKey(),
    // Restrict: topics (and the personal notes in them) are never deleted implicitly.
    forumId: integer("forum_id")
      .notNull()
      .references(() => forums.id, { onDelete: "restrict" }),
    // Set null: deleting a source keeps its topics (displayed as « Source supprimée »).
    sourceId: integer("source_id").references(() => sources.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    url: text("url").notNull(),
    normalizedUrl: text("normalized_url").notNull().unique(),
    excerpt: text("excerpt").notNull().default(""),
    publishedAt: tsz("published_at").notNull(),
    lastActivityAt: tsz("last_activity_at").notNull(),
    /** All replies, notes included (shown in the « Nb » column). */
    replyCount: integer("reply_count").notNull().default(0),
    readAt: tsz("read_at"),
    score: integer("score").notNull().default(0),
    /** Arrival in the database (« reçus aujourd'hui » on the home page). Topics from before migration 0006: publishedAt. */
    createdAt: tsz("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("topics_forum_activity_idx").on(t.forumId, t.lastActivityAt.desc()),
    index("topics_forum_unread_idx").on(t.forumId).where(sql`read_at is null`),
    index("topics_source_idx").on(t.sourceId),
  ],
);

export const ARTICLE_SOURCES = ["feed", "readability"] as const;
export type ArticleSource = (typeof ARTICLE_SOURCES)[number];

/**
 * Reading-mode cache (lib/reader): article HTML, already sanitized, taken from
 * the feed (content:encoded / Atom content) or extracted from the page with
 * Readability. `html = null` means « extraction failed » (`error` says why);
 * failures are retried after a day or on « Recharger l'article ».
 * Rows older than 90 days are purged by the worker.
 */
export const articleContents = pgTable(
  "article_contents",
  {
    topicId: integer("topic_id")
      .primaryKey()
      .references(() => topics.id, { onDelete: "cascade" }),
    html: text("html"),
    source: text("source", { enum: ARTICLE_SOURCES }).notNull(),
    error: text("error"),
    fetchedAt: tsz("fetched_at").notNull(),
  },
  (t) => [
    index("article_contents_fetched_idx").on(t.fetchedAt),
    check("article_contents_source_check", sql`source in ('feed', 'readability')`),
  ],
);

export const AI_KINDS = ["summary", "translation"] as const;
export type AiKind = (typeof AI_KINDS)[number];

/**
 * Gemini summaries and translations (lib/ai), per topic + kind + model. Already rendered and
 * sanitized HTML. References the cached article: purging the article (90 days, never for a topic
 * saved in a list) removes them too. `articleFetchedAt` = the article version they were made from;
 * a newer article (« Recharger l'article ») makes them stale.
 */
export const aiOutputs = pgTable(
  "ai_outputs",
  {
    topicId: integer("topic_id")
      .notNull()
      .references(() => articleContents.topicId, { onDelete: "cascade" }),
    kind: text("kind", { enum: AI_KINDS }).notNull(),
    model: text("model").notNull(),
    html: text("html").notNull(),
    /** The model stopped at its output limit (shown as « tronqué »). */
    truncated: boolean("truncated").notNull().default(false),
    /** Version of the output format (lib/ai/service.ts AI_FORMAT): an older one is a cache miss. */
    format: integer("format").notNull().default(1),
    articleFetchedAt: tsz("article_fetched_at").notNull(),
    createdAt: tsz("created_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.topicId, t.kind, t.model] }),
    check("ai_outputs_kind_check", sql`${t.kind} in ('summary', 'translation')`),
  ],
);

export const REPLY_TYPES = ["note", "source", "comment"] as const;
export type ReplyType = (typeof REPLY_TYPES)[number];
/**
 * Reply types that count towards the "hot topic" threshold (v2).
 * Personal notes are deliberately excluded: `reply_count` includes them,
 * so the v2 hot computation must count replies by type instead.
 */
export const HOT_REPLY_TYPES: readonly ReplyType[] = ["source", "comment"];

export const replies = pgTable(
  "replies",
  {
    id: serial("id").primaryKey(),
    topicId: integer("topic_id")
      .notNull()
      .references(() => topics.id, { onDelete: "cascade" }),
    type: text("type", { enum: REPLY_TYPES }).notNull(),
    author: text("author").notNull(),
    content: text("content").notNull(),
    url: text("url"),
    createdAt: tsz("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("replies_topic_idx").on(t.topicId, t.createdAt),
    check("replies_type_check", sql`type in ('note', 'source', 'comment')`),
  ],
);

/**
 * Favorite lists (docs/design/v3). Single-user app: lists are not tied to an account.
 * `position`: display order, 0 first. The name need not be unique (the UI warns about an exact duplicate).
 */
export const lists = pgTable(
  "lists",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    color: text("color", { enum: LIST_COLORS }).notNull(),
    position: integer("position").notNull().default(0),
    createdAt: tsz("created_at").notNull().defaultNow(),
  },
  (t) => [
    check("lists_name_check", sql`length(trim(${t.name})) between 1 and 60`),
    check("lists_color_check", sql`${t.color} in ('slate', 'blue', 'teal', 'green', 'mustard', 'orange', 'rose', 'violet')`),
  ],
);

/** A topic saved in a list. Deleting the list or the topic removes the row. */
export const listItems = pgTable(
  "list_items",
  {
    listId: integer("list_id")
      .notNull()
      .references(() => lists.id, { onDelete: "cascade" }),
    topicId: integer("topic_id")
      .notNull()
      .references(() => topics.id, { onDelete: "cascade" }),
    addedAt: tsz("added_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.listId, t.topicId] }),
    // « saved » mark in topic lists
    index("list_items_topic_idx").on(t.topicId),
    // a list's page, newest addition first
    index("list_items_list_added_idx").on(t.listId, t.addedAt.desc()),
  ],
);

/**
 * Worker heartbeat: a single row (id = 1) updated at the end of every completed
 * cycle. Read by /api/health to detect a crashed or stuck worker.
 */
export const workerStatus = pgTable(
  "worker_status",
  {
    id: integer("id").primaryKey().default(1),
    lastCycleStartedAt: tsz("last_cycle_started_at").notNull(),
    lastCycleFinishedAt: tsz("last_cycle_finished_at").notNull(),
    // The worker's own FETCH_INTERVAL_MINUTES: the app does not need to share its config.
    intervalMinutes: integer("interval_minutes").notNull(),
  },
  (t) => [check("worker_status_singleton", sql`${t.id} = 1`)],
);

// ---------------------------------------------------------------------------
// Better Auth tables (core schema for email + password, two-factor plugin)
// ---------------------------------------------------------------------------

export const user = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),
    /** Mon compte › Apparence (lib/theme.ts). Declared to Better Auth as an additional field (lib/auth.ts). */
    theme: text("theme", { enum: THEMES }).notNull().default("system"),
    createdAt: tsz("created_at").notNull().defaultNow(),
    updatedAt: tsz("updated_at").notNull().defaultNow(),
  },
  (t) => [check("user_theme_check", sql`${t.theme} in ('system', 'light', 'dark')`)],
);

/** Better Auth two-factor plugin: TOTP secret and backup codes (both encrypted with BETTER_AUTH_SECRET). */
export const twoFactor = pgTable(
  "two_factor",
  {
    id: text("id").primaryKey(),
    secret: text("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    verified: boolean("verified").notNull().default(true),
    failedVerificationCount: integer("failed_verification_count").notNull().default(0),
    lockedUntil: tsz("locked_until"),
  },
  (t) => [index("two_factor_user_idx").on(t.userId), index("two_factor_secret_idx").on(t.secret)],
);

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: tsz("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: tsz("created_at").notNull().defaultNow(),
    updatedAt: tsz("updated_at").notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: tsz("access_token_expires_at"),
    refreshTokenExpiresAt: tsz("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: tsz("created_at").notNull().defaultNow(),
    updatedAt: tsz("updated_at").notNull().defaultNow(),
  },
  (t) => [index("account_user_idx").on(t.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: tsz("expires_at").notNull(),
    createdAt: tsz("created_at").notNull().defaultNow(),
    updatedAt: tsz("updated_at").notNull().defaultNow(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

export type Forum = typeof forums.$inferSelect;
export type Source = typeof sources.$inferSelect;
export type Topic = typeof topics.$inferSelect;
export type Reply = typeof replies.$inferSelect;
export type SourceFavicon = typeof sourceFavicons.$inferSelect;
export type ArticleContent = typeof articleContents.$inferSelect;

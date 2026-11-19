import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

const tsz = (name: string) => timestamp(name, { withTimezone: true });

// ---------------------------------------------------------------------------
// Application tables
// ---------------------------------------------------------------------------

export const forums = pgTable("forums", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  position: integer("position").notNull().default(0),
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
  },
  (t) => [
    index("topics_forum_activity_idx").on(t.forumId, t.lastActivityAt.desc()),
    index("topics_forum_unread_idx").on(t.forumId).where(sql`read_at is null`),
    index("topics_source_idx").on(t.sourceId),
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

// ---------------------------------------------------------------------------
// Better Auth tables (core schema for email + password)
// ---------------------------------------------------------------------------

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: tsz("created_at").notNull().defaultNow(),
  updatedAt: tsz("updated_at").notNull().defaultNow(),
});

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

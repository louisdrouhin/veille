/**
 * What goes in a briefing (docs/design/3.4 § 1, « Sélection »), for the window [since, until):
 * 1. Ma stack: new alerts to handle, worst first then newest, 5 at most (data of the alert, no AI);
 * 2. Mes services: new topics of the forums chosen in the settings (never guessed from a forum name);
 * 3. À la une: the 3 to 5 topics most picked up (2 sources or more), outside Ma stack's topics;
 *    Le reste en bref: 3 to 6 notable topics (picked up, score, newest) not cited elsewhere.
 * A topic appears once. Only articles are read here: replies of type `source` (reprises), never a note.
 * No "server-only": bundled by the worker.
 */
import { and, count, desc, eq, gte, inArray, isNull, lt, notInArray, sql } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { alerts, forums, products, replies, sources, stackItems, topics, vulnerabilities, vulnerabilityProducts } from "@/lib/db/schema";
import { distinctSources, FEATURED_MIN_SOURCES } from "@/lib/featured-rules";
import { severityRank } from "@/lib/stack/labels";
import { nearestFix } from "@/lib/stack/versions";
import type { BriefingSection, StackPoint, TopicPoint } from "./types";

export const MAX_STACK = 5;
export const MAX_FEATURED = 5;
export const MAX_SERVICES = 8;
export const MAX_BRIEF = 6;

export type Window = { since: Date; until: Date };

/** New alerts of the window, to handle; `topicIds`: the topics of their flaws (kept out of À la une). */
export async function selectStack(db: Db, w: Window): Promise<{ points: StackPoint[]; open: number; topicIds: number[] }> {
  const rows = await db
    .select({ a: alerts, v: vulnerabilities, item: stackItems, product: products, fixed: vulnerabilityProducts.fixedVersions })
    .from(alerts)
    .innerJoin(vulnerabilities, eq(vulnerabilities.id, alerts.vulnerabilityId))
    .innerJoin(stackItems, eq(stackItems.id, alerts.stackItemId))
    .innerJoin(products, eq(products.id, stackItems.productId))
    .leftJoin(vulnerabilityProducts, and(eq(vulnerabilityProducts.vulnerabilityId, vulnerabilities.id), eq(vulnerabilityProducts.productId, products.id)))
    .where(and(inArray(alerts.state, ["new", "seen"]), isNull(stackItems.removedAt)));
  const fresh = rows
    .filter((r) => r.a.createdAt >= w.since && r.a.createdAt < w.until)
    .sort((x, y) => severityRank(x.v.severity) - severityRank(y.v.severity) || y.a.createdAt.getTime() - x.a.createdAt.getTime() || y.a.id - x.a.id);
  return {
    open: rows.length,
    topicIds: fresh.map((r) => r.v.topicId).filter((id): id is number => id !== null),
    points: fresh.slice(0, MAX_STACK).map((r) => ({
      alertId: r.a.id,
      severity: r.v.severity,
      // Same title as Ma stack (lib/stack/queries.ts alertTitle, server-only there).
      title: r.v.titleFr ?? `${r.v.ref} dans ${r.product.name}`,
      ref: r.v.ref,
      product: r.product.name,
      version: r.item.version,
      context: r.item.context,
      exploited: r.v.exploited,
      fix: nearestFix(r.item.version, r.fixed ?? [], r.product.versionScheme),
    })),
  };
}

const reposts = sql<number>`(select count(*) from ${replies} r where r.topic_id = ${topics.id} and r.type = 'source')`.mapWith(Number);

/** Topics as briefing points (sources: the topic's own, then its reprises). */
async function asPoints(db: Db, ids: number[]): Promise<Map<number, TopicPoint>> {
  if (!ids.length) return new Map();
  const [rows, reps] = await Promise.all([
    db
      .select({ id: topics.id, title: topics.title, forumName: forums.name, forumSlug: forums.slug, sourceName: sources.name })
      .from(topics)
      .innerJoin(forums, eq(forums.id, topics.forumId))
      .leftJoin(sources, eq(sources.id, topics.sourceId))
      .where(inArray(topics.id, ids)),
    db
      .select({ topicId: replies.topicId, author: replies.author })
      .from(replies)
      .where(and(inArray(replies.topicId, ids), eq(replies.type, "source")))
      .orderBy(replies.createdAt, replies.id),
  ]);
  return new Map(
    rows.map((r) => [
      r.id,
      {
        topicId: r.id,
        title: r.title,
        sentence: null,
        sources: distinctSources(
          r.sourceName,
          reps.filter((x) => x.topicId === r.id).map((x) => x.author),
        ),
        forum: { name: r.forumName, slug: r.forumSlug },
      },
    ]),
  );
}

const ordered = (ids: number[], map: Map<number, TopicPoint>) => ids.map((id) => map.get(id)).filter((p): p is TopicPoint => p !== undefined);

export async function selectServices(db: Db, w: Window, forumIds: number[], exclude: number[]): Promise<TopicPoint[]> {
  if (!forumIds.length) return [];
  const rows = await db
    .select({ id: topics.id })
    .from(topics)
    .where(and(inArray(topics.forumId, forumIds), gte(topics.createdAt, w.since), lt(topics.createdAt, w.until), exclude.length ? notInArray(topics.id, exclude) : undefined))
    .orderBy(desc(topics.publishedAt), desc(topics.id))
    .limit(MAX_SERVICES);
  const ids = rows.map((r) => r.id);
  return ordered(ids, await asPoints(db, ids));
}

/** Picked up by 2 sources or more, with activity in the window: the most picked up, then the most recent. */
export async function selectFeatured(db: Db, w: Window, exclude: number[]): Promise<TopicPoint[]> {
  const rows = await db
    .select({ id: topics.id, n: reposts })
    .from(topics)
    .where(and(gte(topics.lastActivityAt, w.since), lt(topics.lastActivityAt, w.until), sql`${reposts} >= 1`, exclude.length ? notInArray(topics.id, exclude) : undefined))
    .orderBy(desc(reposts), desc(topics.lastActivityAt), desc(topics.id))
    // A reprise by the topic's own source counts once (lib/home.ts): read more, keep 2 distinct sources or more.
    .limit(MAX_FEATURED * 3);
  const ids = rows.map((r) => r.id);
  return ordered(ids, await asPoints(db, ids))
    .filter((p) => p.sources.length >= FEATURED_MIN_SOURCES)
    .slice(0, MAX_FEATURED);
}

/** Notable new topics not cited elsewhere (nor in the Mes services forums): picked up, score, newest. */
export async function selectBrief(db: Db, w: Window, exclude: number[], serviceForums: number[]): Promise<TopicPoint[]> {
  const rows = await db
    .select({ id: topics.id })
    .from(topics)
    .where(
      and(
        gte(topics.createdAt, w.since),
        lt(topics.createdAt, w.until),
        exclude.length ? notInArray(topics.id, exclude) : undefined,
        serviceForums.length ? notInArray(topics.forumId, serviceForums) : undefined,
      ),
    )
    .orderBy(desc(reposts), desc(topics.score), desc(topics.replyCount), desc(topics.publishedAt), desc(topics.id))
    .limit(MAX_BRIEF);
  const ids = rows.map((r) => r.id);
  return ordered(ids, await asPoints(db, ids));
}

/** Articles received in the window: new topics and new reprises. */
export async function countArticles(db: Db, w: Window): Promise<number> {
  const [[t], [r]] = await Promise.all([
    db.select({ n: count() }).from(topics).where(and(gte(topics.createdAt, w.since), lt(topics.createdAt, w.until))),
    db
      .select({ n: count() })
      .from(replies)
      .where(and(eq(replies.type, "source"), gte(replies.createdAt, w.since), lt(replies.createdAt, w.until))),
  ]);
  return (t?.n ?? 0) + (r?.n ?? 0);
}

export type Sections = Record<BriefingSection, boolean>;

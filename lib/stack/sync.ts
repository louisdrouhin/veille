/**
 * Ma stack check (docs/design/3.0 § 2.1), run by the worker every 30 min and on request (pull to
 * refresh, « Réessayer »: at most once every 5 min; adding a product checks that product):
 * 1. for each product of the stack: NVD (by CPE) and GitHub (advisories, releases);
 * 2. CERT-FR: new advisories of its feeds, whose French texts go to the matching CVEs;
 * 3. alerts recomputed (lib/stack/alerts.ts);
 * 4. French summary by Gemini for the vulnerabilities with an open alert and no CERT-FR text;
 * 5. link to the Folders topic that mentions the same CVE;
 * 6. status: a source that failed keeps the previous statuses and is shown in the error banner.
 * A lease in stack_status keeps two checks (worker, app) from overlapping.
 * Logs carry counts and source names only: never a product, a version or a CVE of the stack.
 */
import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { AiConfig } from "@/lib/ai/config";
import type { Db } from "@/lib/db";
import {
  alerts,
  articleContents,
  certfrAdvisories,
  products,
  stackItems,
  stackStatus,
  topics,
  vulnerabilities,
  vulnerabilityProducts,
  type AffectedRange,
  type Product,
  type VersionScheme,
  type VulnSource,
} from "@/lib/db/schema";
import { recomputeAlerts } from "./alerts";
import { fetchCertfrAdvisory, fetchCertfrFeed, type FeedEntry } from "./sources/certfr";
import { fetchGithubAdvisories, fetchGithubReleases } from "./sources/github";
import { fetchNvd } from "./sources/nvd";
import { CVE_ID, severityOf, SourceError, type FetchedVuln, type SourceDeps, type SourceName } from "./sources/types";
import { summarizeVuln } from "./summarize";
import { sortVersionsDesc } from "./versions";

export const STACK_SOURCES: readonly SourceName[] = ["certfr", "nvd", "github"];
export const SOURCE_LABELS: Record<SourceName, string> = { certfr: "CERT-FR", nvd: "NVD", github: "GitHub" };
/** Background check interval (worker). */
export const CHECK_INTERVAL_MIN = 30;
/** A check asked by hand is refused within 5 min of the previous one (NVD quota). */
export const REQUEST_MIN_INTERVAL_MS = 5 * 60_000;
/** GitHub is asked at most every 2 h per repository (60 requests per hour without a token). */
const GITHUB_REFRESH_MS = 2 * 3_600_000;
const LEASE_MS = 15 * 60_000;
const MAX_CERTFR_PER_RUN = 30;
const MAX_AI_PER_RUN = 6;
const MAX_TOPIC_LINKS_PER_RUN = 40;

export type StackDeps = SourceDeps & {
  now?: () => Date;
  log?: (...args: unknown[]) => void;
  /** Gemini (null: no summary, the English description is shown). Defaults to none. */
  ai?: AiConfig | null;
  aiFetch?: typeof fetch;
};

export type SyncResult = { products: number; failed: SourceName[]; created: number[]; closed: number; reopened: number };

const clock = (deps: StackDeps) => (deps.now ?? (() => new Date()))();

// ---------------------------------------------------------------------------------------- storing

/** The fixed versions a set of ranges implies: exclusive ends, and the sources' own « patched ». */
export function fixedVersionsOf(ranges: readonly AffectedRange[], scheme: VersionScheme): string[] {
  const fixed = ranges.flatMap((r) => (r.fixed ? [r.fixed] : r.end !== undefined && r.endIncluding === false ? [r.end] : []));
  return sortVersionsDesc([...new Set(fixed)], scheme);
}

function mergeSources(a: readonly VulnSource[], b: readonly VulnSource[]): VulnSource[] {
  const out = [...a];
  for (const s of b) if (!out.some((x) => x.kind === s.kind && x.ref === s.ref)) out.push(s);
  return out;
}

/**
 * Stores what one source says about one product: the vulnerabilities (merged with what the other
 * sources said: NVD's score wins, « exploitée » never goes back) and this source's ranges.
 */
export async function storeVulns(db: Db, product: Pick<Product, "id" | "versionScheme">, src: "nvd" | "github", list: readonly FetchedVuln[]): Promise<void> {
  // One row per ref (two GitHub advisories can share a CVE): an insert cannot touch a row twice.
  const unique = new Map<string, FetchedVuln>();
  for (const v of list) {
    const d = unique.get(v.ref);
    unique.set(
      v.ref,
      d
        ? { ...d, ranges: [...d.ranges, ...v.ranges], sources: mergeSources(d.sources, v.sources), exploited: d.exploited || v.exploited, cvss: d.cvss ?? v.cvss, severity: d.severity ?? v.severity }
        : v,
    );
  }
  const vulns = [...unique.values()];
  for (let i = 0; i < vulns.length; i += 200) {
    const batch = vulns.slice(i, i + 200);
    const refs = batch.map((v) => v.ref);
    const existing = await db.select().from(vulnerabilities).where(inArray(vulnerabilities.ref, refs));
    const old = new Map(existing.map((e) => [e.ref, e]));
    const rows = batch.map((v) => {
      const e = old.get(v.ref);
      const cvss = src === "nvd" ? (v.cvss ?? e?.cvss ?? null) : (e?.cvss ?? v.cvss);
      return {
        ref: v.ref,
        cveId: e?.cveId ?? v.cveId,
        descriptionEn: src === "nvd" || !e?.descriptionEn ? v.descriptionEn : e.descriptionEn,
        cvss,
        severity: severityOf(cvss) ?? v.severity ?? e?.severity ?? "medium",
        exploited: (e?.exploited ?? false) || v.exploited,
        publishedAt: e && e.publishedAt < v.publishedAt ? e.publishedAt : v.publishedAt,
        updatedAt: e && e.updatedAt > v.updatedAt ? e.updatedAt : v.updatedAt,
        sources: mergeSources(e?.sources ?? [], v.sources),
      };
    });
    const stored = await db
      .insert(vulnerabilities)
      .values(rows)
      .onConflictDoUpdate({
        target: vulnerabilities.ref,
        set: {
          cveId: sql`excluded.cve_id`,
          descriptionEn: sql`excluded.description_en`,
          cvss: sql`excluded.cvss`,
          severity: sql`excluded.severity`,
          exploited: sql`excluded.exploited`,
          publishedAt: sql`excluded.published_at`,
          updatedAt: sql`excluded.updated_at`,
          sources: sql`excluded.sources`,
        },
      })
      .returning({ id: vulnerabilities.id, ref: vulnerabilities.ref });
    const ids = new Map(stored.map((s) => [s.ref, s.id]));
    const currentVps = await db
      .select()
      .from(vulnerabilityProducts)
      .where(and(eq(vulnerabilityProducts.productId, product.id), inArray(vulnerabilityProducts.vulnerabilityId, [...ids.values()])));
    const current = new Map(currentVps.map((vp) => [vp.vulnerabilityId, vp.ranges]));
    const vpRows = batch.map((v) => {
      const id = ids.get(v.ref)!;
      const ranges = [...(current.get(id) ?? []).filter((r) => r.src !== src), ...v.ranges];
      return { vulnerabilityId: id, productId: product.id, ranges, fixedVersions: fixedVersionsOf(ranges, product.versionScheme) };
    });
    await db
      .insert(vulnerabilityProducts)
      .values(vpRows)
      .onConflictDoUpdate({
        target: [vulnerabilityProducts.vulnerabilityId, vulnerabilityProducts.productId],
        set: { ranges: sql`excluded.ranges`, fixedVersions: sql`excluded.fixed_versions` },
      });
  }
}

/** CVEs rejected since the last check: NVD's ranges are dropped (and the row when nothing is left). */
async function dropRejected(db: Db, productId: number, refs: readonly string[]): Promise<void> {
  if (refs.length === 0) return;
  const rows = await db
    .select({ vulnerabilityId: vulnerabilityProducts.vulnerabilityId, ranges: vulnerabilityProducts.ranges })
    .from(vulnerabilityProducts)
    .innerJoin(vulnerabilities, eq(vulnerabilities.id, vulnerabilityProducts.vulnerabilityId))
    .where(and(eq(vulnerabilityProducts.productId, productId), inArray(vulnerabilities.ref, [...refs])));
  for (const r of rows) {
    const left = r.ranges.filter((x) => x.src !== "nvd");
    const where = and(eq(vulnerabilityProducts.productId, productId), eq(vulnerabilityProducts.vulnerabilityId, r.vulnerabilityId));
    if (left.length) await db.update(vulnerabilityProducts).set({ ranges: left }).where(where);
    else await db.delete(vulnerabilityProducts).where(where);
  }
}

// ---------------------------------------------------------------------------------------- products

/**
 * NVD and GitHub for one product. NVD incrementally (modified since the last check), GitHub at most
 * every 2 h unless `force`. Returns the sources that failed; a failure keeps what was stored.
 */
export async function syncProduct(db: Db, product: Product, deps: StackDeps, opts: { force?: boolean } = {}): Promise<SourceName[]> {
  const failed: SourceName[] = [];
  const now = clock(deps);
  if (product.cpePrefix) {
    try {
      const { vulns, rejected } = await fetchNvd(product.cpePrefix, deps, { since: product.nvdSyncedAt, now });
      await storeVulns(db, product, "nvd", vulns);
      await dropRejected(db, product.id, rejected);
      await db.update(products).set({ nvdSyncedAt: now }).where(eq(products.id, product.id));
    } catch (err) {
      if (!(err instanceof SourceError)) throw err;
      failed.push("nvd");
    }
  }
  const githubDue = !product.githubSyncedAt || opts.force || now.getTime() - product.githubSyncedAt.getTime() >= GITHUB_REFRESH_MS;
  if (product.githubRepo && githubDue) {
    try {
      const advisories = await fetchGithubAdvisories(product.githubRepo, deps);
      const releases = await fetchGithubReleases(product.githubRepo, product.versionScheme, deps);
      await storeVulns(db, product, "github", advisories);
      await db
        .update(products)
        .set({ githubSyncedAt: now, ...(releases.length ? { latestVersion: releases[0], recentVersions: releases.slice(0, 5) } : {}) })
        .where(eq(products.id, product.id));
    } catch (err) {
      if (!(err instanceof SourceError)) throw err;
      failed.push("github");
    }
  }
  return failed;
}

// ---------------------------------------------------------------------------------------- CERT-FR

/** New or updated advisories of both feeds (at most 30 downloads per check). */
export async function syncCertfr(db: Db, deps: StackDeps): Promise<void> {
  const entries: FeedEntry[] = [...(await fetchCertfrFeed("alerte", deps)), ...(await fetchCertfrFeed("avis", deps))];
  if (entries.length === 0) return;
  const known = await db
    .select({ ref: certfrAdvisories.ref, feedTitle: certfrAdvisories.feedTitle })
    .from(certfrAdvisories)
    .where(inArray(certfrAdvisories.ref, entries.map((e) => e.ref)));
  const seen = new Map(known.map((k) => [k.ref, k.feedTitle]));
  const todo = entries.filter((e) => seen.get(e.ref) !== e.feedTitle).slice(0, MAX_CERTFR_PER_RUN);
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  let failure: SourceError | null = null;
  for (const [i, entry] of todo.entries()) {
    if (i > 0) await sleep(300);
    try {
      const adv = await fetchCertfrAdvisory(entry, deps);
      if (!adv) continue;
      const values = { ...adv, feedTitle: entry.feedTitle, fetchedAt: clock(deps) };
      await db.insert(certfrAdvisories).values(values).onConflictDoUpdate({ target: certfrAdvisories.ref, set: values });
    } catch (err) {
      if (!(err instanceof SourceError)) throw err;
      failure = err;
    }
  }
  if (failure) throw failure;
}

/** Actions of a CERT-FR advisory: its « Solutions » paragraphs. */
const solutionActions = (solution: string) =>
  solution
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length >= 10)
    .slice(0, 3);

/**
 * French texts of CERT-FR for the CVEs of the stack: an alerte wins over an avis, then the most
 * recent. « Exploitée » when the advisory says so.
 */
export async function applyCertfr(db: Db): Promise<number> {
  const pairs = await db
    .select({
      vulnId: vulnerabilities.id,
      certfrRef: vulnerabilities.certfrRef,
      sources: vulnerabilities.sources,
      exploited: vulnerabilities.exploited,
      adv: certfrAdvisories,
    })
    .from(vulnerabilities)
    .innerJoin(certfrAdvisories, sql`${vulnerabilities.cveId} = any(${certfrAdvisories.cves})`)
    .orderBy(desc(sql`${certfrAdvisories.kind} = 'alerte'`), desc(certfrAdvisories.ref));
  const done = new Set<number>();
  let applied = 0;
  for (const p of pairs) {
    if (done.has(p.vulnId)) continue;
    done.add(p.vulnId);
    const exploited = p.exploited || p.adv.exploited;
    if (p.certfrRef === p.adv.ref && exploited === p.exploited && p.sources.some((s) => s.ref === p.adv.ref)) continue;
    await db
      .update(vulnerabilities)
      .set({
        titleFr: p.adv.title,
        summaryFr: p.adv.summary,
        actionsFr: solutionActions(p.adv.solution),
        textSource: "certfr",
        certfrRef: p.adv.ref,
        exploited,
        sources: mergeSources([{ kind: "certfr", ref: p.adv.ref, url: p.adv.url }], p.sources),
      })
      .where(eq(vulnerabilities.id, p.vulnId));
    applied++;
  }
  return applied;
}

// ---------------------------------------------------------------------------------------- AI, topics

/** Vulnerabilities with an open alert, no French text, a description: summarized by Gemini. */
async function summarizeOpen(db: Db, deps: StackDeps): Promise<number> {
  if (!deps.ai) return 0;
  const rows = await db
    .selectDistinct({ id: vulnerabilities.id, ref: vulnerabilities.ref, description: vulnerabilities.descriptionEn, product: products.name })
    .from(alerts)
    .innerJoin(vulnerabilities, eq(vulnerabilities.id, alerts.vulnerabilityId))
    .innerJoin(stackItems, eq(stackItems.id, alerts.stackItemId))
    .innerJoin(products, eq(products.id, stackItems.productId))
    .where(and(inArray(alerts.state, ["new", "seen"]), isNull(vulnerabilities.textSource), sql`${vulnerabilities.descriptionEn} <> ''`))
    .limit(MAX_AI_PER_RUN);
  let done = 0;
  for (const r of rows) {
    const summary = await summarizeVuln(deps.ai, { ref: r.ref, product: r.product, description: r.description }, { fetch: deps.aiFetch });
    if (!summary) continue;
    await db
      .update(vulnerabilities)
      .set({ ...summary, textSource: "ai" })
      .where(and(eq(vulnerabilities.id, r.id), isNull(vulnerabilities.textSource)));
    done++;
  }
  return done;
}

/** The Folders topic that mentions the CVE (title, excerpt or article), most recent first. */
export async function linkTopics(db: Db): Promise<number> {
  const rows = await db
    .selectDistinct({ id: vulnerabilities.id, cveId: vulnerabilities.cveId })
    .from(alerts)
    .innerJoin(vulnerabilities, eq(vulnerabilities.id, alerts.vulnerabilityId))
    .where(and(isNull(vulnerabilities.topicId), sql`${vulnerabilities.cveId} is not null`))
    .limit(MAX_TOPIC_LINKS_PER_RUN);
  let linked = 0;
  for (const r of rows) {
    if (!r.cveId || !CVE_ID.test(r.cveId)) continue;
    const like = `%${r.cveId}%`;
    const [topic] = await db
      .select({ id: topics.id })
      .from(topics)
      .where(
        or(
          sql`${topics.title} ilike ${like}`,
          sql`${topics.excerpt} ilike ${like}`,
          sql`exists (select 1 from ${articleContents} where ${articleContents.topicId} = ${topics.id} and ${articleContents.html} ilike ${like})`,
        ),
      )
      .orderBy(desc(topics.publishedAt))
      .limit(1);
    if (!topic) continue;
    await db.update(vulnerabilities).set({ topicId: topic.id }).where(eq(vulnerabilities.id, r.id));
    linked++;
  }
  return linked;
}

// ---------------------------------------------------------------------------------------- run

async function takeLease(db: Db, now: Date): Promise<boolean> {
  await db.insert(stackStatus).values({ id: 1 }).onConflictDoNothing();
  const got = await db
    .update(stackStatus)
    .set({ runningUntil: new Date(now.getTime() + LEASE_MS) })
    .where(and(eq(stackStatus.id, 1), or(isNull(stackStatus.runningUntil), lt(stackStatus.runningUntil, now))))
    .returning({ id: stackStatus.id });
  return got.length > 0;
}

/** Products of the stack (items not removed, matched to a product). */
async function stackProducts(db: Db): Promise<Product[]> {
  const rows = await db
    .selectDistinct({ p: products })
    .from(stackItems)
    .innerJoin(products, eq(products.id, stackItems.productId))
    .where(isNull(stackItems.removedAt));
  return rows.map((r) => r.p);
}

/** The full check. Null when another one is running. */
export async function runStackSync(db: Db, deps: StackDeps = {}): Promise<SyncResult | null> {
  const log = deps.log ?? (() => {});
  const started = clock(deps);
  if (!(await takeLease(db, started))) return null;
  try {
    const failed = new Set<SourceName>();
    const list = await stackProducts(db);
    for (const product of list) for (const s of await syncProduct(db, product, deps)) failed.add(s);
    try {
      await syncCertfr(db, deps);
    } catch (err) {
      if (!(err instanceof SourceError)) throw err;
      failed.add("certfr");
    }
    await applyCertfr(db);
    const alertsResult = await recomputeAlerts(db, { now: clock(deps) });
    await summarizeOpen(db, deps);
    await linkTopics(db);
    const finished = clock(deps);
    const failedList = STACK_SOURCES.filter((s) => failed.has(s));
    await db
      .update(stackStatus)
      .set({ lastCheckAt: finished, failedSources: failedList, ...(failedList.length === 0 ? { lastFullCheckAt: finished } : {}) })
      .where(eq(stackStatus.id, 1));
    log(
      `[stack] Vérification : ${list.length} produit(s), ${alertsResult.created.length} nouvelle(s) alerte(s), ${alertsResult.closed} close(s)` +
        (failedList.length ? `, échec : ${failedList.map((s) => SOURCE_LABELS[s]).join(", ")}` : ""),
    );
    return { products: list.length, failed: failedList, ...alertsResult };
  } finally {
    await db.update(stackStatus).set({ runningUntil: null }).where(eq(stackStatus.id, 1));
  }
}

export type StackStatusRow = typeof stackStatus.$inferSelect;

export async function getStackStatus(db: Db): Promise<StackStatusRow | null> {
  const [row] = await db.select().from(stackStatus).where(eq(stackStatus.id, 1));
  return row ?? null;
}

/** Worker: a check when the last one is older than the interval (or never ran). */
export async function checkIfDue(db: Db, deps: StackDeps, intervalMin = CHECK_INTERVAL_MIN): Promise<SyncResult | null> {
  const status = await getStackStatus(db);
  const now = clock(deps);
  if (status?.lastCheckAt && now.getTime() - status.lastCheckAt.getTime() < intervalMin * 60_000) return null;
  return runStackSync(db, deps);
}

/**
 * Check asked by hand (pull to refresh, « Réessayer »): refused within 5 min of the previous
 * request (NVD quota). « running »: another check is in progress.
 */
export async function requestStackCheck(db: Db, deps: StackDeps): Promise<{ status: "done"; result: SyncResult } | { status: "recent" | "running" }> {
  const now = clock(deps);
  await db.insert(stackStatus).values({ id: 1 }).onConflictDoNothing();
  const claimed = await db
    .update(stackStatus)
    .set({ requestedAt: now })
    .where(and(eq(stackStatus.id, 1), or(isNull(stackStatus.requestedAt), lt(stackStatus.requestedAt, new Date(now.getTime() - REQUEST_MIN_INTERVAL_MS)))))
    .returning({ id: stackStatus.id });
  if (claimed.length === 0) return { status: "recent" };
  const result = await runStackSync(db, deps);
  return result ? { status: "done", result } : { status: "running" };
}

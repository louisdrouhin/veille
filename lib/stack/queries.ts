import "server-only";
import { and, asc, eq, ilike, inArray, isNull, or } from "drizzle-orm";
import type { Db } from "@/lib/db";
import {
  alerts,
  products,
  stackItems,
  topics,
  vulnerabilities,
  vulnerabilityProducts,
  type AlertState,
  type DoneReason,
  type IgnoreReason,
  type Product,
  type Severity,
  type StackContext,
  type VersionScheme,
  type VulnSource,
} from "@/lib/db/schema";
import { homeTitle, severityRank, worstSeverity, type VersionPreview } from "./labels";
import { getStackStatus, SOURCE_LABELS } from "./sync";
import { compareVersions, isAffected, nearestFix, parseVersion, sortVersionsDesc } from "./versions";

export type SoftwareStatus = "vulnerable" | "update" | "ok" | "unknown" | "pending" | "untracked";

export type SoftwareRow = {
  id: number;
  name: string;
  productId: number | null;
  version: string;
  context: StackContext;
  distroPackage: string | null;
  scheme: VersionScheme;
  versionHint: string | null;
  sources: string[];
  status: SoftwareStatus;
  worst: Severity | null;
  /** Open alerts of the worst severity, and in all. */
  worstCount: number;
  openCount: number;
  exploited: boolean;
  latestVersion: string | null;
  /** The worst open alert (edit sheet link). */
  topAlert: { id: number; severity: Severity; cvss: number | null; ref: string } | null;
};

export const productSources = (p: Pick<Product, "cpePrefix" | "githubRepo">) => [...(p.cpePrefix ? ["NVD"] : []), ...(p.githubRepo ? ["GitHub"] : [])];

const STATUS_ORDER: SoftwareStatus[] = ["vulnerable", "update", "unknown", "pending", "ok", "untracked"];

/** Logiciels: vulnerable (worst first), then updates available, then the rest, alphabetical. */
export function sortSoftware(rows: SoftwareRow[]): SoftwareRow[] {
  return [...rows].sort(
    (a, b) =>
      STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) ||
      severityRank(a.worst) - severityRank(b.worst) ||
      a.name.localeCompare(b.name, "fr", { sensitivity: "base" }) ||
      a.context.localeCompare(b.context),
  );
}

export async function getSoftware(db: Db): Promise<SoftwareRow[]> {
  const items = await db
    .select({ item: stackItems, product: products })
    .from(stackItems)
    .leftJoin(products, eq(products.id, stackItems.productId))
    .where(isNull(stackItems.removedAt));
  if (items.length === 0) return [];
  const open = await db
    .select({ itemId: alerts.stackItemId, id: alerts.id, severity: vulnerabilities.severity, cvss: vulnerabilities.cvss, exploited: vulnerabilities.exploited, ref: vulnerabilities.ref })
    .from(alerts)
    .innerJoin(vulnerabilities, eq(vulnerabilities.id, alerts.vulnerabilityId))
    .where(and(inArray(alerts.state, ["new", "seen"]), inArray(alerts.stackItemId, items.map((i) => i.item.id))));

  const rows = items.map(({ item, product: p }): SoftwareRow => {
    const mine = open.filter((a) => a.itemId === item.id).sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || (b.cvss ?? 0) - (a.cvss ?? 0));
    const worst = worstSeverity(mine.map((a) => a.severity));
    const scheme = p?.versionScheme ?? "vendor";
    let status: SoftwareStatus;
    if (!p) status = "untracked";
    else if (mine.length) status = "vulnerable";
    else if (!parseVersion(item.version, scheme)) status = "unknown";
    else if (!p.nvdSyncedAt && !p.githubSyncedAt) status = "pending";
    else if (p.latestVersion && compareVersions(p.latestVersion, item.version, scheme) === 1) status = "update";
    else status = "ok";
    const top = mine[0];
    return {
      id: item.id,
      name: p?.name ?? item.customName ?? "",
      productId: item.productId,
      version: item.version,
      context: item.context,
      distroPackage: item.distroPackage,
      scheme,
      versionHint: p?.versionHint ?? null,
      sources: p ? productSources(p) : [],
      status,
      worst,
      worstCount: mine.filter((a) => a.severity === worst).length,
      openCount: mine.length,
      exploited: mine.some((a) => a.severity === worst && a.exploited),
      latestVersion: p?.latestVersion ?? null,
      topAlert: top ? { id: top.id, severity: top.severity, cvss: top.cvss, ref: top.ref } : null,
    };
  });
  return sortSoftware(rows);
}

export type CheckSummary = { lastCheckAt: Date | null; lastFullCheckAt: Date | null; failed: string[]; sources: string[] };

export async function getCheckSummary(db: Db): Promise<CheckSummary> {
  const s = await getStackStatus(db);
  return {
    lastCheckAt: s?.lastCheckAt ?? null,
    lastFullCheckAt: s?.lastFullCheckAt ?? null,
    failed: (s?.failedSources ?? []).map((f) => SOURCE_LABELS[f as keyof typeof SOURCE_LABELS] ?? f),
    sources: Object.values(SOURCE_LABELS),
  };
}

export type CatalogResult = {
  id: number;
  name: string;
  vendor: string;
  sources: string[];
  versionHint: string | null;
  /** Already in the stack: version per context. */
  inStack: { context: StackContext; version: string }[];
};

/** Products matching the query (name or vendor); everything (alphabetical) for an empty query. */
export async function searchCatalog(db: Db, query: string): Promise<CatalogResult[]> {
  const q = query.trim().slice(0, 60);
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const list = await db
    .select()
    .from(products)
    .where(q ? or(ilike(products.name, like), ilike(products.vendor, like)) : undefined)
    .orderBy(asc(products.name))
    .limit(q ? 20 : 60);
  if (list.length === 0) return [];
  const items = await db
    .select({ productId: stackItems.productId, context: stackItems.context, version: stackItems.version })
    .from(stackItems)
    .where(and(isNull(stackItems.removedAt), inArray(stackItems.productId, list.map((p) => p.id))));
  return list.map((p) => ({
    id: p.id,
    name: p.name,
    vendor: p.vendor,
    sources: productSources(p),
    versionHint: p.versionHint,
    inStack: items.filter((i) => i.productId === p.id).map((i) => ({ context: i.context, version: i.version })),
  }));
}

/**
 * The immediate check of a version (add and edit sheets): vulnerabilities touching it, latest
 * release, and for an edited item the open alerts it would close.
 */
export async function previewVersion(db: Db, input: { productId: number; version: string; itemId?: number }): Promise<VersionPreview> {
  const [p] = await db.select().from(products).where(eq(products.id, input.productId));
  if (!p) return { kind: "unchecked" };
  if (!parseVersion(input.version, p.versionScheme)) return { kind: "unrecognized" };
  if (!p.nvdSyncedAt && !p.githubSyncedAt) return { kind: "unchecked" };
  const vps = await db
    .select({ ranges: vulnerabilityProducts.ranges, fixed: vulnerabilityProducts.fixedVersions, id: vulnerabilities.id, ref: vulnerabilities.ref, severity: vulnerabilities.severity, cvss: vulnerabilities.cvss, exploited: vulnerabilities.exploited })
    .from(vulnerabilityProducts)
    .innerJoin(vulnerabilities, eq(vulnerabilities.id, vulnerabilityProducts.vulnerabilityId))
    .where(eq(vulnerabilityProducts.productId, p.id));
  const touching = vps.filter((v) => isAffected(input.version, v.ranges, p.versionScheme));
  let fixes: string[] = [];
  if (input.itemId) {
    const openAlerts = await db
      .select({ vulnId: alerts.vulnerabilityId, ref: vulnerabilities.ref })
      .from(alerts)
      .innerJoin(vulnerabilities, eq(vulnerabilities.id, alerts.vulnerabilityId))
      .where(and(eq(alerts.stackItemId, input.itemId), inArray(alerts.state, ["new", "seen"])));
    const still = new Set(touching.map((t) => t.id));
    fixes = openAlerts.filter((a) => !still.has(a.vulnId)).map((a) => a.ref);
  }
  return {
    kind: "checked",
    vulns: touching
      .sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || (b.cvss ?? 0) - (a.cvss ?? 0))
      .map((v) => ({ ref: v.ref, severity: v.severity, cvss: v.cvss, exploited: v.exploited, fix: nearestFix(input.version, v.fixed, p.versionScheme) })),
    latest: p.latestVersion,
    updateAvailable: !!p.latestVersion && compareVersions(p.latestVersion, input.version, p.versionScheme) === 1,
    fixes,
  };
}

/** Counts for the « Tous / Homelab / Travail » filters. */
export function contextCounts(rows: readonly SoftwareRow[]): Record<"all" | StackContext, number> {
  return { all: rows.length, homelab: rows.filter((r) => r.context === "homelab").length, work: rows.filter((r) => r.context === "work").length };
}

/** Alerts to handle (new + seen), and how many are critical: badge, tab, /stack redirect. */
export async function countOpenAlerts(db: Db): Promise<{ open: number; critical: number }> {
  const rows = await db
    .select({ severity: vulnerabilities.severity })
    .from(alerts)
    .innerJoin(vulnerabilities, eq(vulnerabilities.id, alerts.vulnerabilityId))
    .innerJoin(stackItems, eq(stackItems.id, alerts.stackItemId))
    .where(and(inArray(alerts.state, ["new", "seen"]), isNull(stackItems.removedAt)));
  return { open: rows.length, critical: rows.filter((r) => r.severity === "critical").length };
}

// ---------------------------------------------------------------------------------------- alerts

export const ALERT_FILTERS = { "a-traiter": ["new", "seen"], traitees: ["done"], ignorees: ["ignored"] } as const;
export type AlertFilter = keyof typeof ALERT_FILTERS;
export const parseAlertFilter = (v: unknown): AlertFilter => (typeof v === "string" && v in ALERT_FILTERS ? (v as AlertFilter) : "a-traiter");

export type AlertCard = {
  id: number;
  state: AlertState;
  title: string;
  severity: Severity;
  cvss: number | null;
  exploited: boolean;
  product: string;
  version: string;
  context: StackContext;
  fix: string | null;
  publishedAt: Date;
  doneAt: Date | null;
  doneReason: DoneReason | null;
  ignoredReason: IgnoreReason | null;
};

/** Title shown for an alert: the French one, else « CVE-… dans Produit ». */
export const alertTitle = (v: { titleFr: string | null; ref: string }, product: string) => v.titleFr ?? `${v.ref} dans ${product}`;

/**
 * Alerts of a filter. « À traiter »: severity (worst first), then most recent; the others: most
 * recently handled first.
 */
export async function getAlerts(db: Db, filter: AlertFilter): Promise<AlertCard[]> {
  const rows = await db
    .select({ a: alerts, v: vulnerabilities, item: stackItems, product: products, fixed: vulnerabilityProducts.fixedVersions })
    .from(alerts)
    .innerJoin(vulnerabilities, eq(vulnerabilities.id, alerts.vulnerabilityId))
    .innerJoin(stackItems, eq(stackItems.id, alerts.stackItemId))
    .innerJoin(products, eq(products.id, stackItems.productId))
    .leftJoin(vulnerabilityProducts, and(eq(vulnerabilityProducts.vulnerabilityId, vulnerabilities.id), eq(vulnerabilityProducts.productId, products.id)))
    .where(inArray(alerts.state, [...ALERT_FILTERS[filter]]))
    .limit(300);
  const cards = rows.map(
    (r): AlertCard => ({
      id: r.a.id,
      state: r.a.state,
      title: alertTitle(r.v, r.product.name),
      severity: r.v.severity,
      cvss: r.v.cvss,
      exploited: r.v.exploited,
      product: r.product.name,
      version: r.item.version,
      context: r.item.context,
      fix: nearestFix(r.item.version, r.fixed ?? [], r.product.versionScheme),
      publishedAt: r.v.publishedAt,
      doneAt: r.a.doneAt,
      doneReason: r.a.doneReason,
      ignoredReason: r.a.ignoredReason,
    }),
  );
  const handled = (c: AlertCard) => (c.doneAt ?? c.publishedAt).getTime();
  return cards.sort((a, b) =>
    filter === "a-traiter"
      ? severityRank(a.severity) - severityRank(b.severity) || b.publishedAt.getTime() - a.publishedAt.getTime() || b.id - a.id
      : handled(b) - handled(a) || b.id - a.id,
  );
}

export type AlertDetail = AlertCard & {
  ref: string;
  cveId: string | null;
  itemId: number;
  itemRemoved: boolean;
  summary: string | null;
  summaryLang: "fr" | "en";
  textSource: "certfr" | "ai" | null;
  actions: string[];
  fixedVersions: string[];
  updatedAt: Date;
  ignoredNote: string | null;
  sources: VulnSource[];
  topic: { id: number; title: string } | null;
};

export async function getAlertDetail(db: Db, id: number): Promise<AlertDetail | null> {
  const [r] = await db
    .select({ a: alerts, v: vulnerabilities, item: stackItems, product: products, fixed: vulnerabilityProducts.fixedVersions, topicTitle: topics.title })
    .from(alerts)
    .innerJoin(vulnerabilities, eq(vulnerabilities.id, alerts.vulnerabilityId))
    .innerJoin(stackItems, eq(stackItems.id, alerts.stackItemId))
    .innerJoin(products, eq(products.id, stackItems.productId))
    .leftJoin(vulnerabilityProducts, and(eq(vulnerabilityProducts.vulnerabilityId, vulnerabilities.id), eq(vulnerabilityProducts.productId, products.id)))
    .leftJoin(topics, eq(topics.id, vulnerabilities.topicId))
    .where(eq(alerts.id, id));
  if (!r) return null;
  const scheme = r.product.versionScheme;
  const fix = nearestFix(r.item.version, r.fixed ?? [], scheme);
  const update = fix ? [`Mettre à jour ${r.product.name} vers la ${fix} ou une version ultérieure.`] : [];
  return {
    id: r.a.id,
    state: r.a.state,
    title: alertTitle(r.v, r.product.name),
    severity: r.v.severity,
    cvss: r.v.cvss,
    exploited: r.v.exploited,
    product: r.product.name,
    version: r.item.version,
    context: r.item.context,
    fix,
    publishedAt: r.v.publishedAt,
    doneAt: r.a.doneAt,
    doneReason: r.a.doneReason,
    ignoredReason: r.a.ignoredReason,
    ignoredNote: r.a.ignoredNote,
    ref: r.v.ref,
    cveId: r.v.cveId,
    itemId: r.item.id,
    itemRemoved: r.item.removedAt !== null,
    summary: r.v.summaryFr ?? (r.v.descriptionEn || null),
    summaryLang: r.v.summaryFr ? "fr" : "en",
    textSource: r.v.textSource,
    actions: [...update, ...r.v.actionsFr.filter((a) => !update.includes(a))],
    fixedVersions: sortVersionsDesc(r.fixed ?? [], scheme).reverse(),
    updatedAt: r.v.updatedAt,
    sources: r.v.sources,
    topic: r.v.topicId && r.topicTitle ? { id: r.v.topicId, title: r.topicTitle } : null,
  };
}

/** Opening an alert: `new` → `seen`. */
export async function markAlertSeen(db: Db, id: number): Promise<void> {
  await db.update(alerts).set({ state: "seen", updatedAt: new Date() }).where(and(eq(alerts.id, id), eq(alerts.state, "new")));
}

export type HomeStack = { severity: Severity; title: string; products: string; count: number };

/** Home block (§ 4.6): worst severity of the alerts to handle; null when none (or empty stack). */
export async function getHomeStack(db: Db): Promise<HomeStack | null> {
  const open = await getAlerts(db, "a-traiter");
  if (open.length === 0) return null;
  const worst = open[0]!.severity;
  const ofWorst = open.filter((a) => a.severity === worst);
  const names = [...new Set(ofWorst.map((a) => `${a.product} ${a.version}`))];
  return {
    severity: worst,
    count: open.length,
    title: homeTitle(ofWorst.length, worst),
    products: names.slice(0, 3).join(", ") + (names.length > 3 ? "…" : ""),
  };
}

/** « Aucune faille connue ne touche tes 14 logiciels »: software matched automatically. */
export async function countTrackedSoftware(db: Db): Promise<number> {
  const rows = await db.select({ id: stackItems.id }).from(stackItems).where(and(isNull(stackItems.removedAt)));
  return rows.length;
}

"use server";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { aiConfig } from "@/lib/ai/config";
import { getDb } from "@/lib/db";
import { alerts, products, STACK_CONTEXTS, stackItems, type Product, type StackContext, type VersionScheme } from "@/lib/db/schema";
import { recomputeAlerts } from "@/lib/stack/alerts";
import type { VersionPreview } from "@/lib/stack/labels";
import { previewVersion, searchCatalog, type CatalogResult } from "@/lib/stack/queries";
import { CPE_PREFIX, searchCpe, type CpeCandidate } from "@/lib/stack/sources/nvd";
import { SourceError } from "@/lib/stack/sources/types";
import { requestStackCheck, syncProduct, type StackDeps } from "@/lib/stack/sync";
import { requireSession } from "@/lib/session";
import { id as validId, ValidationError } from "@/lib/validation";

/*
 * Ma stack (docs/design/3.0 § 4.1-4.3). Every action re-checks the session. Pages are dynamic and
 * refreshed by the client (router.refresh()) after a change. Errors never log the inventory.
 */

export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

function failure(err: unknown): { ok: false; error: string } {
  if (err instanceof ValidationError) return { ok: false, error: err.message };
  const e = err as { code?: string; cause?: { code?: string } };
  if ((e?.code ?? e?.cause?.code) === "23505") return { ok: false, error: "Ce logiciel est déjà dans ta stack pour ce contexte." };
  console.error("[stack] action en échec :", (err as Error)?.name ?? "erreur");
  return { ok: false, error: "Enregistrement impossible, réessaie." };
}

const deps = (): StackDeps => ({ env: process.env, ai: aiConfig() });

function cleanVersion(v: unknown): string {
  const s = typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "";
  if (!s) throw new ValidationError("Indique une version.");
  if (s.length > 64) throw new ValidationError("Version trop longue (64 caractères au plus).");
  return s;
}
function cleanContext(c: unknown): StackContext {
  if (!STACK_CONTEXTS.includes(c as StackContext)) throw new ValidationError("Contexte invalide.");
  return c as StackContext;
}
function cleanOptional(s: unknown, max: number, label: string): string | null {
  const v = typeof s === "string" ? s.trim().replace(/\s+/g, " ") : "";
  if (v.length > max) throw new ValidationError(`${label} : ${max} caractères au plus.`);
  return v || null;
}

// ---------------------------------------------------------------------------------------- search

export async function searchProductsAction(query: string): Promise<CatalogResult[]> {
  await requireSession();
  return searchCatalog(getDb(), typeof query === "string" ? query : "");
}

/** « Introuvable ? » the NVD CPE dictionary. */
export async function searchNvdAction(query: string): Promise<ActionResult<{ candidates: CpeCandidate[] }>> {
  await requireSession();
  try {
    return { ok: true, candidates: await searchCpe(typeof query === "string" ? query : "", deps()) };
  } catch (err) {
    if (err instanceof SourceError) return { ok: false, error: "Le dictionnaire NVD ne répond pas : réessaie plus tard, ou ajoute-le en suivi par nom." };
    return failure(err);
  }
}

/** Products being checked for the first time, shared by concurrent requests of this process. */
const firstChecks = new Map<number, Promise<unknown>>();
const FIRST_CHECK_WAIT_MS = 20_000;

/** First check of a product never checked: waited for up to 20 s, then left running. */
async function ensureChecked(product: Product): Promise<boolean> {
  if (product.nvdSyncedAt || product.githubSyncedAt) return true;
  let job = firstChecks.get(product.id);
  if (!job) {
    job = syncProduct(getDb(), product, deps(), { force: true })
      .catch(() => {})
      .finally(() => firstChecks.delete(product.id));
    firstChecks.set(product.id, job);
  }
  const done = await Promise.race([job.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), FIRST_CHECK_WAIT_MS))]);
  if (!done) return false;
  const [fresh] = await getDb().select().from(products).where(eq(products.id, product.id));
  return !!(fresh?.nvdSyncedAt || fresh?.githubSyncedAt);
}

export type ProductInfo = {
  id: number;
  name: string;
  scheme: VersionScheme;
  latestVersion: string | null;
  recentVersions: string[];
  versionHint: string | null;
  checked: boolean;
};

/** Step 2 of « Ajouter »: the product, checked first if it never was (immediate check). */
export async function prepareProductAction(productId: number): Promise<ActionResult<{ product: ProductInfo }>> {
  await requireSession();
  try {
    const [p] = await getDb().select().from(products).where(eq(products.id, validId(productId)));
    if (!p) throw new ValidationError("Produit introuvable.");
    const checked = await ensureChecked(p);
    const [fresh] = await getDb().select().from(products).where(eq(products.id, p.id));
    const f = fresh ?? p;
    return { ok: true, product: { id: f.id, name: f.name, scheme: f.versionScheme, latestVersion: f.latestVersion, recentVersions: f.recentVersions, versionHint: f.versionHint, checked } };
  } catch (err) {
    return failure(err);
  }
}

/** A product of the NVD dictionary: created (or found) by its CPE prefix. */
export async function adoptCpeAction(candidate: CpeCandidate): Promise<ActionResult<{ productId: number }>> {
  await requireSession();
  try {
    if (!candidate || typeof candidate.cpePrefix !== "string" || !CPE_PREFIX.test(candidate.cpePrefix)) throw new ValidationError("Produit NVD invalide.");
    const name = cleanOptional(candidate.name, 80, "Nom") ?? candidate.cpePrefix.split(":")[4]!;
    const vendor = cleanOptional(candidate.vendor, 80, "Éditeur") ?? "";
    const db = getDb();
    await db.insert(products).values({ name, vendor, cpePrefix: candidate.cpePrefix.toLowerCase(), versionScheme: "vendor" }).onConflictDoNothing();
    const [p] = await db.select({ id: products.id }).from(products).where(eq(products.cpePrefix, candidate.cpePrefix.toLowerCase()));
    return { ok: true, productId: p!.id };
  } catch (err) {
    return failure(err);
  }
}

export async function previewVersionAction(input: { productId: number; version: string; itemId?: number }): Promise<VersionPreview> {
  await requireSession();
  if (typeof input?.version !== "string" || input.version.length > 64) return { kind: "unrecognized" };
  return previewVersion(getDb(), {
    productId: validId(input.productId),
    version: input.version,
    itemId: input.itemId === undefined ? undefined : validId(input.itemId),
  });
}

// ---------------------------------------------------------------------------------------- changes

export type AddInput = { productId?: number; customName?: string; version: string; context: StackContext; distroPackage?: string };

export async function addStackItemAction(input: AddInput): Promise<ActionResult<{ id: number; name: string; alerts: number }>> {
  await requireSession();
  try {
    const version = cleanVersion(input.version);
    const context = cleanContext(input.context);
    const distroPackage = cleanOptional(input.distroPackage, 120, "Paquet de distribution");
    const db = getDb();
    let name: string;
    let productId: number | null = null;
    let customName: string | null = null;
    if (input.productId !== undefined) {
      productId = validId(input.productId);
      const [p] = await db.select().from(products).where(eq(products.id, productId));
      if (!p) throw new ValidationError("Produit introuvable.");
      name = p.name;
      await ensureChecked(p);
    } else {
      customName = cleanOptional(input.customName, 80, "Nom");
      if (!customName) throw new ValidationError("Indique le nom du logiciel.");
      name = customName;
    }
    const [row] = await db.insert(stackItems).values({ productId, customName, version, context, distroPackage }).returning({ id: stackItems.id });
    const { created } = await recomputeAlerts(db, { silent: true, itemIds: [row!.id] });
    return { ok: true, id: row!.id, name, alerts: created.length };
  } catch (err) {
    return failure(err);
  }
}

export async function updateStackItemAction(input: { id: number; version: string; context: StackContext; distroPackage?: string }): Promise<ActionResult<{ closed: number; created: number }>> {
  await requireSession();
  try {
    const id = validId(input.id);
    const version = cleanVersion(input.version);
    const context = cleanContext(input.context);
    const distroPackage = cleanOptional(input.distroPackage, 120, "Paquet de distribution");
    const db = getDb();
    const updated = await db
      .update(stackItems)
      .set({ version, context, distroPackage, updatedAt: new Date() })
      .where(and(eq(stackItems.id, id), isNull(stackItems.removedAt)))
      .returning({ id: stackItems.id });
    if (updated.length === 0) throw new ValidationError("Ce logiciel n'est plus dans ta stack.");
    const r = await recomputeAlerts(db, { silent: true, itemIds: [id] });
    return { ok: true, closed: r.closed, created: r.created.length + r.reopened };
  } catch (err) {
    return failure(err);
  }
}

/** Removed from the stack: its open alerts are closed (« removed »), its history stays in « Traitées ». */
export async function removeStackItemAction(itemId: number): Promise<ActionResult> {
  await requireSession();
  try {
    const id = validId(itemId);
    const now = new Date();
    await getDb().transaction(async (tx) => {
      await tx.update(stackItems).set({ removedAt: now, updatedAt: now }).where(and(eq(stackItems.id, id), isNull(stackItems.removedAt)));
      await tx
        .update(alerts)
        .set({ state: "done", doneReason: "removed", doneAt: now, updatedAt: now })
        .where(and(eq(alerts.stackItemId, id), inArray(alerts.state, ["new", "seen"])));
    });
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}

/** Pull to refresh and « Réessayer »: a full check, at most once every 5 min. */
export async function checkStackNowAction(): Promise<{ status: "done" | "recent" | "running"; failed?: string[] }> {
  await requireSession();
  try {
    const r = await requestStackCheck(getDb(), deps());
    return r.status === "done" ? { status: "done", failed: r.result.failed } : r;
  } catch (err) {
    console.error("[stack] vérification en échec :", (err as Error)?.name ?? "erreur");
    return { status: "done", failed: ["nvd", "github", "certfr"] };
  }
}

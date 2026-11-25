/**
 * Ma stack › Logiciels (docs/design/3.0 § 4.1-4.3): server actions (add, edit, remove, search,
 * immediate check), the list's statuses and order, the wording, and the server render of the view.
 */
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";

const state = vi.hoisted(() => ({ db: null as unknown as Db }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), usePathname: () => "/stack/logiciels" }));
vi.mock("@/lib/session", () => ({ requireSession: vi.fn(async () => ({ user: { id: "u1", name: "Moi" } })) }));
vi.mock("@/lib/db", () => ({ getDb: () => state.db }));

const actions = await import("@/lib/actions/stack");
const { requireSession } = await import("@/lib/session");
const { getSoftware, previewVersion, searchCatalog, countOpenAlerts } = await import("@/lib/stack/queries");
const { previewMessage, alertsDetail, homeTitle, severityCounts } = await import("@/lib/stack/labels");
const { syncCatalog } = await import("@/lib/stack/catalog");
const { storeVulns } = await import("@/lib/stack/sync");
const { SoftwareView, detailOf } = await import("@/components/stack/software-view");

const { alerts, products, stackItems } = schema;
const at = new Date("2026-11-20T10:00:00Z");

/** Products marked as checked, with fictional vulnerabilities (no real inventory here). */
async function seedVulns() {
  const [vw] = await state.db.select().from(products).where(eq(products.key, "vaultwarden"));
  const [fortios] = await state.db.select().from(products).where(eq(products.key, "fortios"));
  await state.db.update(products).set({ nvdSyncedAt: at, githubSyncedAt: at, latestVersion: "1.40.2", recentVersions: ["1.40.2", "1.40.1"] }).where(eq(products.id, vw!.id));
  await state.db.update(products).set({ nvdSyncedAt: at }).where(eq(products.id, fortios!.id));
  const v = (ref: string, cvss: number, range: schema.AffectedRange, exploited = false) => ({
    ref,
    cveId: ref,
    descriptionEn: "Fictional flaw.",
    cvss,
    severity: null,
    exploited,
    publishedAt: at,
    updatedAt: at,
    sources: [],
    ranges: [range],
  });
  await storeVulns(state.db, vw!, "github", [v("CVE-2099-0001", 7.5, { end: "1.40.0", endIncluding: false, src: "github" })]);
  await storeVulns(state.db, fortios!, "nvd", [
    v("CVE-2099-0002", 9.8, { start: "7.2.0", startIncluding: true, end: "7.2.9", endIncluding: false, src: "nvd" }, true),
    v("CVE-2099-0003", 5.3, { start: "7.2.0", startIncluding: true, end: "7.2.11", endIncluding: false, src: "nvd" }),
  ]);
  return { vw: vw!, fortios: fortios! };
}

beforeEach(async () => {
  vi.mocked(requireSession).mockClear();
  const pg = drizzle(new PGlite(), { schema });
  await migrate(pg, { migrationsFolder: path.join(import.meta.dirname, "..", "drizzle") });
  state.db = pg as unknown as Db;
  await syncCatalog(state.db);
});

describe("wording", () => {
  it("immediate check messages (§ 4.2, § 4.3)", () => {
    expect(previewMessage("9.1", { kind: "checked", vulns: [], latest: "9.2", updateAvailable: true, fixes: [] }, "X")).toBe("Aucune faille connue pour la 9.1. Mise à jour 9.2 disponible.");
    expect(previewMessage("9.2", { kind: "checked", vulns: [], latest: "9.2", updateAvailable: false, fixes: [] }, "X")).toBe("Aucune faille connue pour la 9.2.");
    const crit = { ref: "CVE-2099-1", severity: "critical" as const, cvss: 9.8, exploited: true, fix: "7.2.9" };
    const med = { ref: "CVE-2099-2", severity: "medium" as const, cvss: 5, exploited: false, fix: "7.2.11" };
    expect(previewMessage("7.2.4", { kind: "checked", vulns: [crit, med], latest: null, updateAvailable: false, fixes: [] }, "X")).toBe(
      "2 failles, dont 1 critique exploitée pour la 7.2.4. Corrigé en 7.2.9.",
    );
    expect(previewMessage("7.2.10", { kind: "checked", vulns: [med], latest: null, updateAvailable: false, fixes: ["CVE-2099-1"] }, "X")).toBe(
      "1 faille moyenne pour la 7.2.10. Corrigé en 7.2.11. La 7.2.10 corrige CVE-2099-1 : l'alerte passera en traitée à l'enregistrement.",
    );
    expect(previewMessage("abc", { kind: "unrecognized" }, "X")).toMatch(/^Version non reconnue/);
    expect(previewMessage("1", { kind: "pending" }, "Immich")).toBe("Première vérification de Immich…");
  });

  it("list details, home title, grouped counts", () => {
    expect(alertsDetail(1, "critical", true)).toBe("1 alerte critique · exploitée");
    expect(alertsDetail(3, "high", false)).toBe("3 alertes hautes");
    expect(homeTitle(2, "critical")).toBe("2 failles critiques à traiter");
    expect(homeTitle(1, "high")).toBe("1 faille haute à traiter");
    expect(severityCounts(["medium", "high", "medium"])).toBe("1 haute, 2 moyennes");
  });
});

describe("actions", () => {
  it("add a catalog product: alerts found at once (silent: no push), toast data; same product in the other context OK, twice not", async () => {
    const { fortios } = await seedVulns();
    const res = await actions.addStackItemAction({ productId: fortios.id, version: " 7.2.4 ", context: "work" });
    expect(res).toMatchObject({ ok: true, name: "FortiOS", alerts: 2 });
    expect(requireSession).toHaveBeenCalled();
    const rows = await state.db.select().from(alerts);
    expect(rows.every((a) => a.state === "new" && a.notifiedAt !== null)).toBe(true);
    expect((await actions.addStackItemAction({ productId: fortios.id, version: "7.2.4", context: "homelab" })).ok).toBe(true);
    expect(await actions.addStackItemAction({ productId: fortios.id, version: "7.4.1", context: "work" })).toEqual({ ok: false, error: "Ce logiciel est déjà dans ta stack pour ce contexte." });
  });

  it("add « suivi par nom »; validation of version, context, name", async () => {
    expect(await actions.addStackItemAction({ customName: "Outil maison", version: "2.1", context: "homelab" })).toMatchObject({ ok: true, name: "Outil maison", alerts: 0 });
    expect(await actions.addStackItemAction({ customName: "  ", version: "2.1", context: "homelab" })).toMatchObject({ ok: false });
    expect(await actions.addStackItemAction({ customName: "X", version: "", context: "homelab" })).toEqual({ ok: false, error: "Indique une version." });
    expect(await actions.addStackItemAction({ customName: "X", version: "1", context: "bureau" as never })).toEqual({ ok: false, error: "Contexte invalide." });
    expect(await actions.addStackItemAction({ customName: "X", version: "1".repeat(65), context: "work" })).toMatchObject({ ok: false });
  });

  it("edit to a fixed version: preview says so, saving closes the alert (« updated »); remove archives the rest", async () => {
    const { fortios } = await seedVulns();
    const added = await actions.addStackItemAction({ productId: fortios.id, version: "7.2.4", context: "work" });
    const id = (added as { id: number }).id;
    const preview = await actions.previewVersionAction({ productId: fortios.id, version: "7.2.10", itemId: id });
    expect(preview).toMatchObject({ kind: "checked", fixes: ["CVE-2099-0002"] });
    expect(await actions.updateStackItemAction({ id, version: "7.2.10", context: "work" })).toEqual({ ok: true, closed: 1, created: 0 });
    expect(await countOpenAlerts(state.db)).toEqual({ open: 1, critical: 0 });
    expect(await actions.removeStackItemAction(id)).toEqual({ ok: true });
    const all = await state.db.select().from(alerts);
    expect(all.map((a) => [a.state, a.doneReason]).sort()).toEqual([["done", "removed"], ["done", "updated"]]);
    expect(await countOpenAlerts(state.db)).toEqual({ open: 0, critical: 0 });
    expect((await state.db.select().from(stackItems).where(eq(stackItems.id, id)))[0]!.removedAt).not.toBeNull();
    expect(await actions.updateStackItemAction({ id, version: "7.2.11", context: "work" })).toEqual({ ok: false, error: "Ce logiciel n'est plus dans ta stack." });
  });

  it("immediate check: unrecognized, never checked, vulnerable with nearest fix, update available", async () => {
    const { vw, fortios } = await seedVulns();
    const [immich] = await state.db.select().from(products).where(eq(products.key, "immich"));
    expect(await previewVersion(state.db, { productId: fortios.id, version: "latest" })).toEqual({ kind: "unrecognized" });
    expect(await previewVersion(state.db, { productId: immich!.id, version: "1.120.0" })).toEqual({ kind: "unchecked" });
    expect(await previewVersion(state.db, { productId: fortios.id, version: "7.2.4" })).toMatchObject({
      kind: "checked",
      vulns: [
        { ref: "CVE-2099-0002", severity: "critical", cvss: 9.8, exploited: true, fix: "7.2.9" },
        { ref: "CVE-2099-0003", severity: "medium", fix: "7.2.11" },
      ],
    });
    expect(await previewVersion(state.db, { productId: vw.id, version: "1.40.1" })).toMatchObject({ kind: "checked", vulns: [], latest: "1.40.2", updateAvailable: true });
  });

  it("catalog search: name or vendor, already in the stack per context; NVD dictionary product adopted once", async () => {
    const { fortios } = await seedVulns();
    await actions.addStackItemAction({ productId: fortios.id, version: "7.2.4", context: "work" });
    const res = await searchCatalog(state.db, "forti");
    expect(res.map((r) => r.name)).toEqual(["FortiOS"]);
    expect(res[0]).toMatchObject({ sources: ["NVD"], inStack: [{ context: "work", version: "7.2.4" }] });
    expect((await searchCatalog(state.db, "microsoft")).map((r) => r.name)).toEqual(["Windows Server 2019", "Windows Server 2022", "Windows Server 2025"]);
    expect(await searchCatalog(state.db, "%")).toEqual([]);
    const c = { cpePrefix: "cpe:2.3:a:example:widget", name: "Widget", vendor: "Example" };
    const a = await actions.adoptCpeAction(c);
    const b = await actions.adoptCpeAction(c);
    expect(a).toEqual(b);
    expect(await actions.adoptCpeAction({ ...c, cpePrefix: "cpe:2.3:a:x:y'; drop" })).toMatchObject({ ok: false });
  });
});

describe("list", () => {
  it("statuses and order: vulnerable (worst first), update, unreadable, ok, by name", async () => {
    const { vw, fortios } = await seedVulns();
    const [ssh] = await state.db.select().from(products).where(eq(products.key, "openssh"));
    await state.db.update(products).set({ nvdSyncedAt: at }).where(eq(products.id, ssh!.id));
    await actions.addStackItemAction({ productId: vw.id, version: "1.39.0", context: "homelab" });
    await actions.addStackItemAction({ productId: fortios.id, version: "7.2.4", context: "work" });
    await actions.addStackItemAction({ productId: vw.id, version: "1.40.1", context: "work" });
    await actions.addStackItemAction({ productId: ssh!.id, version: "dernière", context: "homelab" });
    await actions.addStackItemAction({ customName: "Annuaire maison", version: "3", context: "work" });
    const rows = await getSoftware(state.db);
    expect(rows.map((r) => [r.name, r.version, r.status])).toEqual([
      ["FortiOS", "7.2.4", "vulnerable"],
      ["Vaultwarden", "1.39.0", "vulnerable"],
      ["Vaultwarden", "1.40.1", "update"],
      ["OpenSSH", "dernière", "unknown"],
      ["Annuaire maison", "3", "untracked"],
    ]);
    expect(detailOf(rows[0]!)).toBe("1 alerte critique · exploitée (+1)");
    expect(detailOf(rows[1]!)).toBe("1 alerte haute");
    expect(rows[0]!.topAlert).toMatchObject({ severity: "critical", cvss: 9.8, ref: "CVE-2099-0002" });

    const html = renderToString(createElement(SoftwareView, { rows })).replaceAll("<!-- -->", "");
    expect(html).toContain("Ajouter un logiciel");
    expect(html).toContain('role="radiogroup"');
    expect(html).toMatch(/Vulnérable<span class="sr-only"> \(Critique\)<\/span>/);
    expect(html).toContain("Non reconnue");
    expect(html).toContain("Par nom");
    expect(html).toContain("1.40.2"); // « ↑ 1.40.2 »
    expect(html).toContain("Tous<span");
  });

  it("empty stack: « Ta stack est vide » with the add button", () => {
    const html = renderToString(createElement(SoftwareView, { rows: [] }));
    expect(html).toContain("Ta stack est vide");
    expect(html).toContain("Ajouter un logiciel");
  });
});

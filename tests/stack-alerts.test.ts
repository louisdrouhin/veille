/**
 * Ma stack › Alertes (docs/design/3.0 § 3, 4.4-4.6): order, filters, detail, new → seen, done with
 * undo, ignore with a reason, the navigation badge and the home block. Fictional data only.
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
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), usePathname: () => "/stack/alertes" }));
vi.mock("next/link", () => ({
  default: ({ href, prefetch, ...rest }: { href: string; prefetch?: boolean; children?: React.ReactNode }) => createElement("a", { href, "data-prefetch": String(prefetch), ...rest }),
}));
vi.mock("@/lib/session", () => ({ requireSession: vi.fn(async () => ({ user: { id: "u1", name: "Moi" } })) }));
vi.mock("@/lib/db", () => ({ getDb: () => state.db }));

const actions = await import("@/lib/actions/stack");
const q = await import("@/lib/stack/queries");
const { syncCatalog } = await import("@/lib/stack/catalog");
const { storeVulns } = await import("@/lib/stack/sync");
const { recomputeAlerts } = await import("@/lib/stack/alerts");
const { AlertCardLink, alertLabel } = await import("@/components/stack/alert-list");
const { AlertDetail } = await import("@/components/stack/alert-detail");
const { StackBlock } = await import("@/components/home/stack-block");
const { stackLabel } = await import("@/components/layout/app-header");

const { alerts, forums, products, stackItems, topics, vulnerabilities } = schema;
const at = (d: string) => new Date(`2026-11-${d}T10:00:00Z`);

async function seed() {
  const db = state.db;
  const all = await db.select().from(products);
  const p = (k: string) => all.find((x) => x.key === k)!;
  const v = (ref: string, cvss: number, range: schema.AffectedRange, day: string, exploited = false) => ({
    ref,
    cveId: ref,
    descriptionEn: "Fictional flaw: a crafted request lets an attacker run code.",
    cvss,
    severity: null,
    exploited,
    publishedAt: at(day),
    updatedAt: at(day),
    sources: [{ kind: "nvd" as const, ref, url: `https://nvd.nist.gov/vuln/detail/${ref}` }],
    ranges: [range],
  });
  await storeVulns(db, p("fortios"), "nvd", [
    v("CVE-2099-1", 9.8, { end: "7.0.16", endIncluding: false, src: "nvd" }, "10", true),
    v("CVE-2099-2", 5.3, { end: "7.0.20", endIncluding: false, src: "nvd" }, "20"),
  ]);
  await storeVulns(db, p("vaultwarden"), "github", [v("CVE-2099-3", 7.5, { end: "1.40.0", endIncluding: false, fixed: "1.40.0", src: "github" }, "15")]);
  await storeVulns(db, p("proxmox-ve"), "nvd", [v("CVE-2099-4", 9.1, { end: "8.1.4", endIncluding: false, src: "nvd" }, "21")]);
  await db.update(vulnerabilities).set({ titleFr: "Exécution de code à distance dans FortiOS (fictive)", summaryFr: "Résumé fictif.", actionsFr: ["Appliquer le correctif."], textSource: "certfr" }).where(eq(vulnerabilities.ref, "CVE-2099-1"));
  const [forum] = await db.insert(forums).values({ name: "Sécurité", slug: "securite" }).returning();
  const [topic] = await db.insert(topics).values({ forumId: forum!.id, title: "Alerte CVE-2099-1", url: "https://ex.com/x", normalizedUrl: "https://ex.com/x", publishedAt: at("11"), lastActivityAt: at("11") }).returning();
  await db.update(vulnerabilities).set({ topicId: topic!.id }).where(eq(vulnerabilities.ref, "CVE-2099-1"));
  await db.insert(stackItems).values([
    { productId: p("fortios").id, version: "7.0.12", context: "work" },
    { productId: p("vaultwarden").id, version: "1.39.0", context: "homelab" },
    { productId: p("proxmox-ve").id, version: "8.1.3", context: "homelab" },
  ]);
  await recomputeAlerts(db, { now: at("22") });
  const ids = Object.fromEntries((await db.select({ id: alerts.id, ref: vulnerabilities.ref }).from(alerts).innerJoin(vulnerabilities, eq(vulnerabilities.id, alerts.vulnerabilityId))).map((r) => [r.ref, r.id]));
  return { ids: ids as Record<string, number>, topicId: topic!.id };
}

beforeEach(async () => {
  const pg = drizzle(new PGlite(), { schema });
  await migrate(pg, { migrationsFolder: path.join(import.meta.dirname, "..", "drizzle") });
  state.db = pg as unknown as Db;
  await syncCatalog(state.db);
});

describe("alerts list", () => {
  it("« À traiter »: severity first, then most recent; badge counts and the home block", async () => {
    await seed();
    const list = await q.getAlerts(state.db, "a-traiter");
    expect(list.map((a) => a.title)).toEqual([
      "CVE-2099-4 dans Proxmox VE", // critical 9.1, 21/11
      "Exécution de code à distance dans FortiOS (fictive)", // critical 9.8, 10/11
      "CVE-2099-3 dans Vaultwarden",
      "CVE-2099-2 dans FortiOS",
    ]);
    expect(list[1]).toMatchObject({ severity: "critical", exploited: true, product: "FortiOS", version: "7.0.12", context: "work", fix: "7.0.16", state: "new" });
    expect(alertLabel(list[1]!)).toBe("Critique 9.8, exploitée, Nouvelle : Exécution de code à distance dans FortiOS (fictive) — FortiOS 7.0.12");
    expect(await q.countOpenAlerts(state.db)).toEqual({ open: 4, critical: 2 });
    expect(stackLabel({ open: 4, critical: 2 })).toBe("Ma stack, 4 alertes à traiter dont 2 critiques");
    expect(stackLabel({ open: 1, critical: 0 })).toBe("Ma stack, 1 alerte à traiter");
    expect(stackLabel({ open: 0, critical: 0 })).toBe("Ma stack");
    expect(await q.getHomeStack(state.db)).toEqual({ severity: "critical", count: 4, title: "2 failles critiques à traiter", products: "Proxmox VE 8.1.3, FortiOS 7.0.12" });
  });

  it("home block: red for critical, orange (high) otherwise, absent at 0", async () => {
    const { ids } = await seed();
    const html = renderToString(createElement(StackBlock, { stack: await q.getHomeStack(state.db) }));
    expect(html).toContain('href="/stack/alertes"');
    expect(html).toContain("border-sev-critical bg-sev-critical-soft");
    for (const ref of ["CVE-2099-1", "CVE-2099-4"]) await actions.markAlertDoneAction(ids[ref]!);
    const high = await q.getHomeStack(state.db);
    expect(high).toMatchObject({ severity: "high", title: "1 faille haute à traiter" });
    expect(renderToString(createElement(StackBlock, { stack: high }))).toContain("border-sev-high bg-sev-high-soft");
    for (const ref of ["CVE-2099-2", "CVE-2099-3"]) await actions.ignoreAlertAction({ id: ids[ref]!, reason: "not_exposed" });
    expect(await q.getHomeStack(state.db)).toBeNull();
    expect(renderToString(createElement(StackBlock, { stack: null }))).toBe("");
  });

  it("a card is one link, never prefetched, with « Nouvelle » as dot + bold + word", async () => {
    await seed();
    const [first] = await q.getAlerts(state.db, "a-traiter");
    const html = renderToString(createElement(AlertCardLink, { alert: first!, filter: "a-traiter" })).replaceAll("<!-- -->", "");
    expect(html).toMatch(/^<a href="\/stack\/alertes\/\d+"/);
    expect(html).toContain("Nouvelle");
    expect(html).toContain("font-bold");
    expect(html).toContain('aria-label="Critique 9.1, Nouvelle : CVE-2099-4 dans Proxmox VE — Proxmox VE 8.1.3"');
  });
});

describe("states", () => {
  it("opening marks new → seen (once); done → « Traitées », undo → back to « à traiter »", async () => {
    const { ids } = await seed();
    const id = ids["CVE-2099-1"]!;
    await q.markAlertSeen(state.db, id);
    expect((await state.db.select().from(alerts).where(eq(alerts.id, id)))[0]!.state).toBe("seen");
    const done = await actions.markAlertDoneAction(id);
    expect(done).toMatchObject({ ok: true, previous: "seen" });
    expect(await actions.markAlertDoneAction(id)).toEqual({ ok: false, error: "Cette alerte n'est plus à traiter." });
    expect((await q.getAlerts(state.db, "traitees")).map((a) => a.id)).toEqual([id]);
    expect(await q.countOpenAlerts(state.db)).toEqual({ open: 3, critical: 1 });
    // Opening a done alert does not change it.
    await q.markAlertSeen(state.db, id);
    expect((await state.db.select().from(alerts).where(eq(alerts.id, id)))[0]).toMatchObject({ state: "done", doneReason: "manual" });
    expect(await actions.reopenAlertAction(id)).toEqual({ ok: true });
    expect((await state.db.select().from(alerts).where(eq(alerts.id, id)))[0]).toMatchObject({ state: "seen", doneAt: null, doneReason: null });
  });

  it("ignore with a reason (« autre » needs a word), listed with its reason", async () => {
    const { ids } = await seed();
    expect(await actions.ignoreAlertAction({ id: ids["CVE-2099-2"]!, reason: "other" })).toEqual({ ok: false, error: "Précise la raison." });
    expect(await actions.ignoreAlertAction({ id: ids["CVE-2099-2"]!, reason: "bogus" as never })).toEqual({ ok: false, error: "Raison invalide." });
    expect(await actions.ignoreAlertAction({ id: ids["CVE-2099-2"]!, reason: "backport", note: "Paquet Debian corrigé" })).toEqual({ ok: true });
    const [ignored] = await q.getAlerts(state.db, "ignorees");
    expect(ignored).toMatchObject({ state: "ignored", ignoredReason: "backport" });
    const html = renderToString(createElement(AlertCardLink, { alert: ignored!, filter: "ignorees" })).replaceAll("<!-- -->", "");
    expect(html).toContain("ignorée : corrigé par la distribution (rétroportage)");
    expect(html).toContain("text-fg-read");
    expect(html).toContain("?etat=ignorees");
  });
});

describe("detail", () => {
  it("« Ton logiciel », nearest fix highlighted, CERT-FR texts, update action first, Folders topic first in the sources", async () => {
    const { ids, topicId } = await seed();
    const d = (await q.getAlertDetail(state.db, ids["CVE-2099-1"]!))!;
    expect(d).toMatchObject({ ref: "CVE-2099-1", fix: "7.0.16", fixedVersions: ["7.0.16"], textSource: "certfr", summaryLang: "fr", topic: { id: topicId, title: "Alerte CVE-2099-1" } });
    expect(d.actions).toEqual(["Mettre à jour FortiOS vers la 7.0.16 ou une version ultérieure.", "Appliquer le correctif."]);
    const html = renderToString(createElement(AlertDetail, { alert: d, filter: "a-traiter" })).replaceAll("<!-- -->", "");
    expect(html).toContain("Exploitée activement");
    expect(html).toContain("Ton logiciel");
    expect(html).toMatch(/7\.0\.12<\/span><span class="[^"]*text-sev-critical">vulnérable/);
    expect(html).toContain("border-ok bg-ok-soft");
    expect(html).toContain("d&#x27;après l&#x27;avis CERT-FR");
    expect(html).toContain("Marquer comme traitée");
    expect(html).toContain(`href="/stack/logiciels?modifier=${d.itemId}"`);
    expect(html.indexOf(`href="/t/${topicId}"`)).toBeLessThan(html.indexOf("https://nvd.nist.gov"));
    expect(html).toContain('target="_blank" rel="noopener noreferrer"');
  });

  it("no French text: the source's English description, marked as such; « Généré par IA » when Gemini wrote it", async () => {
    const { ids } = await seed();
    const en = (await q.getAlertDetail(state.db, ids["CVE-2099-3"]!))!;
    expect(en).toMatchObject({ summaryLang: "en", textSource: null, actions: ["Mettre à jour Vaultwarden vers la 1.40.0 ou une version ultérieure."] });
    const html = renderToString(createElement(AlertDetail, { alert: en, filter: "a-traiter" }));
    expect(html).toContain('lang="en"');
    expect(html).toContain("description de la source, en anglais");
    await state.db.update(vulnerabilities).set({ summaryFr: "Résumé IA fictif.", textSource: "ai" }).where(eq(vulnerabilities.ref, "CVE-2099-3"));
    const ai = (await q.getAlertDetail(state.db, ids["CVE-2099-3"]!))!;
    expect(renderToString(createElement(AlertDetail, { alert: ai, filter: "a-traiter" }))).toContain("Généré par IA");
    expect(await q.getAlertDetail(state.db, 99_999)).toBeNull();
  });
});

/**
 * Paramètres (docs/design/3.5, lot 1): permanent redirects of /compte and /admin, Prénom / Nom (migration 0017 split of
 * the identifier, display, initials, validation), the e-mail behind the identity re-confirmation (no e-mail sent),
 * the old anchors, the settings pages list.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";

const MIGRATIONS = path.join(import.meta.dirname, "..", "drizzle");
const state = vi.hoisted(() => ({ db: null as unknown as Db, userId: "u1", sessionId: "s1" }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireSession: vi.fn(async () => ({ user: { id: state.userId }, session: { id: state.sessionId } })) }));
vi.mock("@/lib/db", () => ({ getDb: () => state.db }));

const { displayName, initials, splitIdentifier, cleanName, avatarColor } = await import("@/lib/profile");
const { LEGACY_REDIRECTS } = await import("../next.config");
const { LEGACY_ANCHORS, SETTINGS_PAGES, settingsTitle } = await import("@/lib/settings/nav");
const profile = await import("@/lib/actions/profile");
const { grant, resetReconfirm } = await import("@/lib/secrets/reconfirm");
const { getMe } = await import("@/lib/settings/summary");

const { user } = schema;

beforeEach(async () => {
  const pg = drizzle(new PGlite(), { schema });
  await migrate(pg, { migrationsFolder: MIGRATIONS });
  state.db = pg as unknown as Db;
  resetReconfirm();
  await state.db.insert(user).values([
    { id: "u1", name: "louis.drouhin", firstName: "Louis", lastName: "Drouhin", email: "louis@example.com" },
    { id: "u2", name: "autre", email: "autre@example.com" },
  ]);
});

describe("old URLs", () => {
  it("/compte and /admin are permanent redirects (308) to their settings page; a source being edited goes to Sources", async () => {
    const config = (await import("../next.config")).default("phase-production-build");
    const redirects = await config.redirects!();
    expect(redirects).toEqual(LEGACY_REDIRECTS);
    expect(redirects.every((r) => r.permanent)).toBe(true);
    const to = (source: string, edit = false) => redirects.find((r) => r.source === source && ("has" in r) === edit)?.destination;
    expect(to("/compte")).toBe("/parametres/profil");
    expect(to("/compte/notifications")).toBe("/parametres/notifications");
    expect(to("/compte/nouveautes")).toBe("/parametres/a-propos");
    expect(to("/admin")).toBe("/parametres/forums");
    expect(to("/admin", true)).toBe("/parametres/sources");
    expect(to("/admin/integrations")).toBe("/parametres/integrations");
    // A redirect with a query condition comes first, or the plain one would win.
    expect(redirects.findIndex((r) => r.source === "/admin" && "has" in r)).toBeLessThan(redirects.findIndex((r) => r.source === "/admin" && !("has" in r)));
  });

  it("old anchors (kept by the browser through the redirect) point to the page that holds the block now", () => {
    expect(LEGACY_ANCHORS.apparence).toBe("apparence");
    expect(LEGACY_ANCHORS.sources).toBe("sources");
    expect(LEGACY_ANCHORS["2fa"]).toBe("securite");
    for (const k of Object.values(LEGACY_ANCHORS)) expect(SETTINGS_PAGES.some((p) => p.key === k)).toBe(true);
  });

  it("no page is named « Mon compte » or « Admin » any more; titles « Sources · Paramètres »", () => {
    expect(SETTINGS_PAGES.map((p) => p.label)).not.toContain("Mon compte");
    expect(SETTINGS_PAGES.map((p) => p.label)).not.toContain("Admin");
    expect(settingsTitle("sources")).toBe("Sources · Paramètres");
  });
});

describe("Prénom / Nom", () => {
  it("split of the identifier (as migration 0017), display, initials", () => {
    expect(splitIdentifier("louis.drouhin")).toEqual({ firstName: "Louis", lastName: "Drouhin" });
    expect(splitIdentifier("jean-pierre_de.la_fontaine")).toEqual({ firstName: "Jean-Pierre", lastName: "De.La.Fontaine" });
    expect(splitIdentifier("Démo")).toEqual({ firstName: "Démo", lastName: "" });
    expect(displayName({ name: "louis.drouhin", firstName: "Louis", lastName: "Drouhin" })).toBe("Louis Drouhin");
    expect(displayName({ name: "louis.drouhin", firstName: "", lastName: "" })).toBe("louis.drouhin");
    expect(initials({ name: "x", firstName: "Louis", lastName: "Drouhin" })).toBe("LD");
    expect(initials({ name: "démo", firstName: "", lastName: "" })).toBe("D");
    expect(avatarColor("u1")).toBe(avatarColor("u1"));
  });

  it("validation: required, 50 characters at most, no markup or control character", () => {
    expect(cleanName("  Louis   Paul ")).toBe("Louis Paul");
    for (const bad of ["", "   ", "x".repeat(51), "<b>", "a\u0000b", 42]) expect(cleanName(bad)).toBeNull();
  });

  it("migration 0017 splits the identifier of an existing account", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "veille-mig-"));
    try {
      cpSync(MIGRATIONS, dir, { recursive: true });
      const journalPath = path.join(dir, "meta", "_journal.json");
      const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: { tag: string }[] };
      const upTo = journal.entries.findIndex((e) => e.tag.startsWith("0017_"));
      writeFileSync(journalPath, JSON.stringify({ ...journal, entries: journal.entries.slice(0, upTo) }));
      const pg = new PGlite();
      await migrate(drizzle(pg), { migrationsFolder: dir });
      await pg.query(`insert into "user" (id, name, email) values ('a', 'louis.drouhin', 'a@x.fr'), ('b', 'Démo', 'b@x.fr'), ('c', 'marie_curie dupont', 'c@x.fr')`);
      await migrate(drizzle(pg), { migrationsFolder: MIGRATIONS });
      const rows = await pg.query<{ id: string; first_name: string; last_name: string }>(`select id, first_name, last_name from "user" order by id`);
      expect(rows.rows).toEqual([
        { id: "a", first_name: "Louis", last_name: "Drouhin" },
        { id: "b", first_name: "Démo", last_name: "" },
        { id: "c", first_name: "Marie", last_name: "Curie.Dupont" },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("saved one field at a time; refused when empty or too long", async () => {
    expect(await profile.updateNameAction("firstName", "  Louis-Marie ")).toEqual({ ok: true });
    expect(await profile.updateNameAction("lastName", "")).toMatchObject({ ok: false });
    expect(await profile.updateNameAction("email", "x")).toMatchObject({ ok: false });
    expect(await getMe(state.db, "u1")).toMatchObject({ firstName: "Louis-Marie", lastName: "Drouhin", photo: null });
  });
});

describe("e-mail (no verification e-mail: the identity re-confirmation protects it)", () => {
  it("refused without a recent confirmation, then changed; never someone else's address", async () => {
    expect(await profile.updateEmailAction("nouveau@example.com")).toMatchObject({ ok: false, reconfirm: true });
    grant(state.sessionId);
    expect(await profile.updateEmailAction("pas une adresse")).toMatchObject({ ok: false });
    expect(await profile.updateEmailAction("AUTRE@example.com")).toMatchObject({ ok: false, error: expect.stringContaining("déjà utilisée") });
    expect(await profile.updateEmailAction("  Nouveau@Example.com ")).toEqual({ ok: true });
    const [row] = await state.db.select({ email: user.email }).from(user).where(eq(user.id, "u1"));
    expect(row!.email).toBe("nouveau@example.com");
  });
});

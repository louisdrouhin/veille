/**
 * Admin › Intégrations (lib/secrets, lib/actions/integrations.ts): encryption, interface-over-.env
 * priority, values never sent back to the client nor logged, re-confirmation, read-only mode,
 * « Tester la clé », VAPID keys.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { symmetricEncrypt } from "better-auth/crypto";
import { createOTP } from "@better-auth/utils/otp";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { createUser } from "@/lib/users";

const state = vi.hoisted(() => ({ db: null as unknown as Db, userId: "", sessionId: "s1" }));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireSession: vi.fn(async () => ({ user: { id: state.userId }, session: { id: state.sessionId } })) }));
vi.mock("@/lib/db", () => ({ getDb: () => state.db }));

const { decryptSecret, encryptSecret, hintOf, masterKey } = await import("@/lib/secrets/crypto");
const { resolveSettings, effectiveEnv } = await import("@/lib/secrets/store");
const { currentAiConfig, currentVapid } = await import("@/lib/secrets/effective");
const { saveSetting } = await import("@/lib/secrets/write");
const { integrationsView } = await import("@/lib/secrets/view");
const { resetReconfirm, RECONFIRM_MS } = await import("@/lib/secrets/reconfirm");
const { resetKeyTests, testGeminiKey, testNvdKey } = await import("@/lib/secrets/test-key");
const { generateVapidKeys } = await import("@/lib/push/webpush");
const actions = await import("@/lib/actions/integrations");

const KEY_B64 = Buffer.alloc(32, 7).toString("base64");
const OTHER_B64 = Buffer.alloc(32, 9).toString("base64");
const KEY = Buffer.alloc(32, 7);
const PASSWORD = "un mot de passe long";
const GEMINI = "AIzaSyD-gemini-secret-value-0123456789";
const GEMINI_ENV = "AIzaSyENV-gemini-from-dotenv-abcdefgh";
const NVD = "0b2e6c1a-4f3d-4c8e-9a7b-123456789abc";
const AUTH_SECRET = "test-secret-test-secret-test-secret-123";

let logs: string[] = [];

beforeEach(async () => {
  const pg = drizzle(new PGlite(), { schema });
  await migrate(pg, { migrationsFolder: path.join(import.meta.dirname, "..", "drizzle") });
  state.db = pg as unknown as Db;
  await createUser(state.db, { email: "moi@example.com", password: PASSWORD });
  state.userId = (await state.db.select({ id: schema.user.id }).from(schema.user))[0]!.id;
  state.sessionId = `s-${Math.random()}`;
  resetReconfirm();
  resetKeyTests();
  vi.stubEnv("SECRETS_KEY", KEY_B64);
  vi.stubEnv("BETTER_AUTH_SECRET", AUTH_SECRET);
  for (const v of ["GEMINI_API_KEY", "GEMINI_MODEL", "GEMINI_TRANSLATE_MODEL", "NVD_API_KEY", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"]) vi.stubEnv(v, "");
  vi.stubEnv("BETTER_AUTH_URL", "https://folders.example.com");
  logs = [];
  for (const m of ["log", "info", "warn", "error"] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(" ")));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const confirm = () => actions.reconfirmAction({ password: PASSWORD });

describe("encryption (AES-256-GCM)", () => {
  it("round-trips, with a new IV each time", () => {
    const a = encryptSecret(KEY, "gemini_api_key", GEMINI);
    const b = encryptSecret(KEY, "gemini_api_key", GEMINI);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^v1\.[\w-]{16}\.[\w-]{22}\.[\w-]+$/);
    expect(a).not.toContain(GEMINI);
    expect(decryptSecret(KEY, "gemini_api_key", a)).toBe(GEMINI);
  });

  it("refuses another key, another name, or altered data", () => {
    const blob = encryptSecret(KEY, "gemini_api_key", GEMINI);
    expect(decryptSecret(Buffer.alloc(32, 9), "gemini_api_key", blob)).toBeNull();
    expect(decryptSecret(KEY, "nvd_api_key", blob)).toBeNull();
    const parts = blob.split(".");
    const ct = Buffer.from(parts[3]!, "base64url");
    ct[0] = ct[0]! ^ 1;
    expect(decryptSecret(KEY, "gemini_api_key", [...parts.slice(0, 3), ct.toString("base64url")].join("."))).toBeNull();
    expect(decryptSecret(KEY, "gemini_api_key", "garbage")).toBeNull();
  });

  it("reads SECRETS_KEY in base64 or hex, 32 bytes exactly", () => {
    expect(masterKey({})).toEqual({ ok: false, reason: "missing" });
    expect(masterKey({ SECRETS_KEY: "trop-courte" })).toEqual({ ok: false, reason: "invalid" });
    expect(masterKey({ SECRETS_KEY: Buffer.alloc(16).toString("base64") })).toEqual({ ok: false, reason: "invalid" });
    expect(masterKey({ SECRETS_KEY: KEY_B64 })).toMatchObject({ ok: true });
    expect(masterKey({ SECRETS_KEY: KEY.toString("hex") })).toMatchObject({ ok: true });
    expect(hintOf(GEMINI)).toBe("6789");
    expect(hintOf("short")).toBe("");
  });
});

describe("priority: interface, then .env", () => {
  it("a key saved in the interface replaces the .env; removed, the .env is back", async () => {
    vi.stubEnv("GEMINI_API_KEY", GEMINI_ENV);
    expect((await currentAiConfig(state.db))?.apiKey).toBe(GEMINI_ENV);
    expect((await resolveSettings(state.db, { ...process.env })).settings.gemini_api_key.source).toBe("env");

    expect(await confirm()).toMatchObject({ ok: true });
    expect(await actions.saveKeyAction("gemini_api_key", `  ${GEMINI}  `)).toEqual({ ok: true });
    expect((await currentAiConfig(state.db))?.apiKey).toBe(GEMINI);
    const [row] = await state.db.select().from(schema.appSettings).where(eq(schema.appSettings.name, "gemini_api_key"));
    expect(row!.encrypted).not.toContain(GEMINI);
    expect(row!.value).toBeNull();
    expect(row!.hint).toBe("6789");

    expect(await actions.removeSettingAction("gemini_api_key")).toEqual({ ok: true });
    expect((await currentAiConfig(state.db))?.apiKey).toBe(GEMINI_ENV);
  });

  it("models: interface, else .env, else the default", async () => {
    vi.stubEnv("GEMINI_API_KEY", GEMINI_ENV);
    vi.stubEnv("GEMINI_TRANSLATE_MODEL", "gemini-env-translate");
    await confirm();
    expect(await actions.saveModelsAction({ model: "gemini-9-pro", translateModel: "" })).toEqual({ ok: true });
    expect(await currentAiConfig(state.db)).toMatchObject({ model: "gemini-9-pro", translateModel: "gemini-env-translate" });
    const view = await integrationsView(state.db);
    expect(view.gemini.models.map((m) => m.source)).toEqual(["interface", "env"]);
    expect(await actions.saveModelsAction({ model: "pas un modèle !", translateModel: "" })).toMatchObject({ ok: false });
    expect(await actions.saveModelsAction({ model: "", translateModel: "" })).toEqual({ ok: true });
    expect((await currentAiConfig(state.db))?.model).toBe("gemini-3.5-flash-lite");
  });

  it("with another SECRETS_KEY, the saved key is unreadable: the .env is used and it is shown as such", async () => {
    vi.stubEnv("NVD_API_KEY", "dotenv-nvd-key-0000000000");
    await saveSetting(state.db, KEY, "nvd_api_key", NVD);
    expect((await effectiveEnv(state.db)).NVD_API_KEY).toBe(NVD);

    const other = await resolveSettings(state.db, { ...process.env, SECRETS_KEY: OTHER_B64 });
    expect(other.env.NVD_API_KEY).toBe("dotenv-nvd-key-0000000000");
    expect(other.settings.nvd_api_key).toMatchObject({ source: "env", unreadable: true });
    const missing = await resolveSettings(state.db, { ...process.env, SECRETS_KEY: "" });
    expect(missing.env.NVD_API_KEY).toBe("dotenv-nvd-key-0000000000");
    expect(logs.join("\n")).not.toContain(NVD);
  });

  it("the VAPID pair comes from one place only", async () => {
    const envPair = generateVapidKeys();
    vi.stubEnv("VAPID_PUBLIC_KEY", envPair.publicKey);
    vi.stubEnv("VAPID_PRIVATE_KEY", envPair.privateKey);
    // Only the private key in the interface: ignored, both from the .env.
    await saveSetting(state.db, KEY, "vapid_private_key", generateVapidKeys().privateKey);
    expect(await currentVapid(state.db)).toMatchObject(envPair);
  });

  it("without the table (migration not applied yet), the .env alone", async () => {
    vi.stubEnv("GEMINI_API_KEY", GEMINI_ENV);
    await state.db.execute("drop table app_settings");
    expect((await currentAiConfig(state.db))?.apiKey).toBe(GEMINI_ENV);
  });
});

describe("never sent back to the client, never logged", () => {
  it("the page data has the source and the last 4 characters only", async () => {
    vi.stubEnv("NVD_API_KEY", NVD);
    await saveSetting(state.db, KEY, "gemini_api_key", GEMINI);
    const vapid = generateVapidKeys();
    vi.stubEnv("VAPID_PUBLIC_KEY", vapid.publicKey);
    vi.stubEnv("VAPID_PRIVATE_KEY", vapid.privateKey);
    const view = await integrationsView(state.db);
    const json = JSON.stringify(view);
    for (const secret of [GEMINI, NVD, vapid.privateKey, GEMINI.slice(0, -4), NVD.slice(0, 12)]) expect(json).not.toContain(secret);
    expect(view.gemini.key).toMatchObject({ source: "interface", hint: "6789" });
    expect(view.nvd.key).toMatchObject({ source: "env", hint: "9abc" });
    expect(view.vapid).toMatchObject({ source: "env", envPair: true });
  });

  it("no action returns, logs or journals a value", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    const results = [
      await confirm(),
      await actions.saveKeyAction("gemini_api_key", GEMINI),
      await actions.saveKeyAction("nvd_api_key", NVD),
      await actions.testKeyAction("gemini_api_key"),
      await actions.testKeyAction("nvd_api_key"),
      await actions.generateVapidAction(),
      await actions.removeSettingAction("nvd_api_key"),
    ];
    const keys = await state.db.select().from(schema.appSettings);
    const vapidPrivate = decryptSecret(KEY, "vapid_private_key", keys.find((k) => k.name === "vapid_private_key")!.encrypted!)!;
    const out = JSON.stringify(results) + logs.join("\n") + JSON.stringify(await state.db.select().from(schema.settingsLog));
    for (const secret of [GEMINI, NVD, vapidPrivate]) expect(out).not.toContain(secret);
    expect((await state.db.select().from(schema.settingsLog)).map((l) => `${l.name}:${l.action}`)).toEqual([
      "gemini_api_key:set",
      "nvd_api_key:set",
      "vapid_public_key:generate",
      "vapid_private_key:generate",
      "nvd_api_key:delete",
    ]);
  });

  it("a database error is logged by its name only", async () => {
    await confirm();
    await state.db.execute("drop table settings_log");
    expect(await actions.saveKeyAction("gemini_api_key", GEMINI)).toEqual({ ok: false, error: "Enregistrement impossible : réessaie." });
    expect(logs.join("\n")).not.toContain(GEMINI);
  });

  it("no client component imports the secrets modules (types aside)", () => {
    const root = path.join(import.meta.dirname, "..");
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(dir, e.name)] : []));
    for (const f of [...files(path.join(root, "components")), ...files(path.join(root, "app"))]) {
      const src = readFileSync(f, "utf8");
      if (/^["']use client["']/.test(src)) expect(src, f).not.toMatch(/^import (?!type )[^;]*from "@\/lib\/secrets\//m);
    }
    expect(readFileSync(path.join(root, "lib", "secrets", "view.ts"), "utf8")).toMatch(/^import "server-only";/m);
  });
});

describe("re-confirmation", () => {
  it("every change needs it; a wrong password is refused", async () => {
    expect(await actions.saveKeyAction("gemini_api_key", GEMINI)).toMatchObject({ ok: false, reconfirm: true });
    expect(await actions.generateVapidAction()).toMatchObject({ ok: false, reconfirm: true });
    expect(await actions.removeSettingAction("gemini_api_key")).toMatchObject({ ok: false, reconfirm: true });
    expect(await actions.saveModelsAction({ model: "", translateModel: "" })).toMatchObject({ ok: false, reconfirm: true });
    expect(await actions.importVapidAction()).toMatchObject({ ok: false, reconfirm: true });
    expect(await actions.reconfirmAction({ password: "pas le bon mot de passe" })).toEqual({ ok: false, error: "Mot de passe incorrect." });
    expect(await state.db.select().from(schema.appSettings)).toEqual([]);
  });

  it("lasts 5 minutes, in this session only", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-25T18:00:00Z"));
    const r = await confirm();
    expect(r).toEqual({ ok: true, until: Date.now() + RECONFIRM_MS });
    expect(await actions.saveKeyAction("nvd_api_key", NVD)).toEqual({ ok: true });

    const mine = state.sessionId;
    state.sessionId = "another-device";
    expect(await actions.saveKeyAction("nvd_api_key", NVD)).toMatchObject({ reconfirm: true });
    state.sessionId = mine;

    vi.setSystemTime(new Date("2026-11-25T18:05:01Z"));
    expect(await actions.saveKeyAction("nvd_api_key", NVD)).toMatchObject({ ok: false, reconfirm: true });
  });

  it("5 attempts per 10 minutes", async () => {
    for (let i = 0; i < 5; i++) expect(await actions.reconfirmAction({ password: "mauvais" })).toMatchObject({ ok: false, error: "Mot de passe incorrect." });
    expect(await confirm()).toMatchObject({ ok: false, error: expect.stringContaining("Trop de tentatives") });
  });

  it("with 2FA on, the authenticator code is asked (the password is not enough)", async () => {
    const totpSecret = "ABCDEFGHIJKLMNOPQRSTUVWXYZ012345";
    await state.db.insert(schema.twoFactor).values({
      id: "tf1",
      userId: state.userId,
      secret: await symmetricEncrypt({ key: AUTH_SECRET, data: totpSecret }),
      backupCodes: "x",
    });
    await state.db.update(schema.user).set({ twoFactorEnabled: true }).where(eq(schema.user.id, state.userId));
    expect(await confirm()).toMatchObject({ ok: false });
    expect(await actions.reconfirmAction({ code: "000000" })).toMatchObject({ ok: false, error: expect.stringContaining("Code invalide") });
    const code = await createOTP(totpSecret, { period: 30, digits: 6 }).totp();
    expect(await actions.reconfirmAction({ code: `${code.slice(0, 3)} ${code.slice(3)}` })).toMatchObject({ ok: true });
  });
});

describe("without SECRETS_KEY: read-only", () => {
  it("changes are refused, the .env keeps working, tests still run", async () => {
    vi.stubEnv("SECRETS_KEY", "");
    vi.stubEnv("NVD_API_KEY", NVD);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    await confirm();
    expect(await actions.saveKeyAction("gemini_api_key", GEMINI)).toEqual({ ok: false, error: expect.stringContaining("lecture seule") });
    expect(await actions.generateVapidAction()).toMatchObject({ ok: false, error: expect.stringContaining("lecture seule") });
    expect((await integrationsView(state.db)).master).toBe("missing");
    expect(await actions.testKeyAction("nvd_api_key")).toMatchObject({ ok: true, test: { ok: true } });
    expect((await effectiveEnv(state.db)).NVD_API_KEY).toBe(NVD);
  });
});

describe("« Tester la clé »", () => {
  it("Gemini: the description of both models, with the key in a header", async () => {
    const calls: { url: string; key: string | null }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), key: new Headers(init.headers).get("x-goog-api-key") });
      return new Response("{}", { status: String(url).endsWith("gemini-absent") ? 404 : 200 });
    }) as typeof fetch;
    expect(await testGeminiKey(GEMINI, ["gemini-a", "gemini-b", "gemini-a"], { fetch: fetchImpl })).toEqual({ ok: true, message: "Clé acceptée, modèles disponibles." });
    expect(calls).toEqual([
      { url: "https://generativelanguage.googleapis.com/v1beta/models/gemini-a", key: GEMINI },
      { url: "https://generativelanguage.googleapis.com/v1beta/models/gemini-b", key: GEMINI },
    ]);
    expect(await testGeminiKey(GEMINI, ["gemini-absent"], { fetch: fetchImpl })).toEqual({ ok: false, message: "Clé acceptée, mais modèle introuvable : gemini-absent." });
    const refused = (async () => new Response("{}", { status: 400 })) as unknown as typeof fetch;
    expect(await testGeminiKey(GEMINI, ["gemini-a"], { fetch: refused })).toEqual({ ok: false, message: "Clé refusée par Google." });
  });

  it("NVD: one known CVE, apiKey header; refused key, timeout", async () => {
    let seen: Headers | null = null;
    const ok = (async (_u: string, init: RequestInit) => {
      seen = new Headers(init.headers);
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    expect(await testNvdKey(NVD, { fetch: ok })).toEqual({ ok: true, message: "Clé acceptée par NVD." });
    expect(seen!.get("apikey")).toBe(NVD);
    expect(await testNvdKey(NVD, { fetch: (async () => new Response("", { status: 404 })) as unknown as typeof fetch })).toMatchObject({ ok: false, message: "Clé refusée par NVD." });
    const slow = (async () => {
      throw Object.assign(new Error("t"), { name: "TimeoutError" });
    }) as unknown as typeof fetch;
    expect((await testNvdKey(NVD, { fetch: slow })).message).toContain("pas répondu");
  });

  it("records the result and is rate limited (5 per minute)", async () => {
    vi.stubEnv("NVD_API_KEY", NVD);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    const r = await actions.testKeyAction("nvd_api_key");
    expect(r).toMatchObject({ ok: true, test: { ok: false, message: "Clé refusée par NVD." } });
    expect((await integrationsView(state.db)).nvd.key.test).toMatchObject({ ok: false, message: "Clé refusée par NVD." });
    for (let i = 0; i < 4; i++) await actions.testKeyAction("nvd_api_key");
    expect(await actions.testKeyAction("nvd_api_key")).toMatchObject({ ok: false, error: expect.stringContaining("Trop de tests") });
    // A test only: the key still comes from the .env.
    expect((await integrationsView(state.db)).nvd.key.source).toBe("env");
  });
});

describe("VAPID", () => {
  const sub = (n: number) => ({ endpoint: `https://web.push.apple.com/abc${n}`, keys: { p256dh: "p", auth: "a" } });

  it("« Reprendre les clés du .env »: same keys, the devices stay subscribed", async () => {
    const pair = generateVapidKeys();
    vi.stubEnv("VAPID_PUBLIC_KEY", pair.publicKey);
    vi.stubEnv("VAPID_PRIVATE_KEY", pair.privateKey);
    await state.db.insert(schema.pushSubscriptions).values([sub(1), sub(2)]);
    await confirm();
    expect(await actions.importVapidAction()).toEqual({ ok: true });
    vi.stubEnv("VAPID_PUBLIC_KEY", "");
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    expect(await currentVapid(state.db)).toMatchObject(pair);
    expect(await state.db.select().from(schema.pushSubscriptions)).toHaveLength(2);
    expect((await integrationsView(state.db)).vapid).toMatchObject({ source: "interface", devices: 2 });
  });

  it("« Générer les clés »: a new pair, every device unsubscribed", async () => {
    await state.db.insert(schema.pushSubscriptions).values([sub(1), sub(2), sub(3)]);
    await confirm();
    const r = await actions.generateVapidAction();
    expect(r).toEqual({ ok: true, removedDevices: 3 });
    const vapid = await currentVapid(state.db);
    expect(vapid?.publicKey).toMatch(/^[\w-]{87}$/);
    expect(await state.db.select().from(schema.pushSubscriptions)).toEqual([]);
    expect(JSON.stringify(await integrationsView(state.db))).not.toContain(vapid!.privateKey);
  });
});

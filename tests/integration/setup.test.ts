/**
 * First-run setup on a REAL PostgreSQL:
 *  A. createFirstUser() raced from 8 separate connections → exactly one account;
 *  B. the built app over HTTP (needs `npm run build`): every page leads to /setup,
 *     two simultaneous setup submissions → one wins, the other gets 404,
 *     then /setup is 404 for good.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { AlreadySetupError, createFirstUser, resetSetupCache } from "@/lib/users";
import { ROOT, startPostgres, type TestDatabase } from "./helpers/postgres";

// ---------------------------------------------------------------------------
// A. Advisory lock, raced from separate connections
// ---------------------------------------------------------------------------
describe("createFirstUser under concurrency (real PostgreSQL)", () => {
  let pg: TestDatabase;
  beforeAll(async () => {
    pg = await startPostgres();
  }, 180_000);
  afterAll(async () => {
    await pg?.stop();
  }, 60_000);

  it("8 setups released at the same instant: exactly one account is created", async () => {
    resetSetupCache();
    const N = 8;
    const clients = Array.from({ length: N }, () => postgres(pg.url, { max: 1, onnotice: () => {} }));
    const control = postgres(pg.url, { max: 1, onnotice: () => {} });
    try {
      let attempts: Promise<PromiseSettledResult<unknown>[]> | undefined;
      // Deterministic race: while a control transaction holds an exclusive lock on "user",
      // every attempt blocks inside its transaction (on the advisory lock, or on the table
      // itself without it). Once all N are waiting, the lock is released at once.
      await control.begin(async (tx) => {
        await tx`lock table "user" in access exclusive mode`;
        attempts = Promise.allSettled(
          clients.map((c, i) =>
            createFirstUser(drizzle(c, { schema }) as unknown as Db, { email: `admin${i}@example.com`, password: `mot de passe numéro ${i}` }),
          ),
        );
        for (let i = 0; ; i++) {
          const [{ waiting } = { waiting: 0 }] = await pg.sql<{ waiting: number }[]>`
            select count(*)::int waiting from pg_stat_activity
            where wait_event_type = 'Lock' and datname = current_database()`;
          if (waiting >= N) break;
          if (i > 600) throw new Error(`only ${waiting}/${N} attempts reached the database`);
          await new Promise((r) => setTimeout(r, 50));
        }
      }); // commit → lock released, all attempts resume together

      const results = await attempts!;
      const won = results.filter((r) => r.status === "fulfilled");
      const lost = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      expect(won).toHaveLength(1);
      expect(lost).toHaveLength(N - 1);
      expect(lost.every((r) => r.reason instanceof AlreadySetupError)).toBe(true);

      expect(await pg.sql`select email from "user"`).toHaveLength(1);
      expect(await pg.sql`select user_id from account`).toHaveLength(1);
    } finally {
      await Promise.all([...clients, control].map((c) => c.end()));
    }
  });
});

// ---------------------------------------------------------------------------
// B. The real app over HTTP
// ---------------------------------------------------------------------------
const SERVER = path.join(ROOT, ".next", "standalone", "server.js");

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** Hidden inputs of the setup form (server action reference), as a no-JS browser would post them. */
function hiddenFields(html: string): [string, string][] {
  const form = /<form[^>]*>([\s\S]*?)<\/form>/.exec(html)?.[1] ?? "";
  return [...form.matchAll(/<input[^>]*type="hidden"[^>]*>/g)].map(([tag]) => [
    decode(/name="([^"]*)"/.exec(tag)?.[1] ?? ""),
    decode(/value="([^"]*)"/.exec(tag)?.[1] ?? ""),
  ]);
}

describe("setup wizard over HTTP (built app, real PostgreSQL)", () => {
  let pg: TestDatabase;
  let app: ChildProcess;
  let base = "";
  let logs = "";
  /** Action fields captured while /setup still existed (replayed after setup). */
  let setupFields: [string, string][] = [];

  const get = (p: string, cookie = "") => fetch(base + p, { redirect: "manual", headers: cookie ? { cookie } : {} });
  async function postSetup(fields: [string, string][], values: Record<string, string>) {
    const fd = new FormData();
    for (const [k, v] of fields) fd.append(k, v);
    for (const [k, v] of Object.entries(values)) fd.append(k, v);
    return fetch(`${base}/setup`, { method: "POST", body: fd, redirect: "manual", headers: { origin: base } });
  }

  beforeAll(async () => {
    if (!existsSync(SERVER)) throw new Error(`${SERVER} introuvable : lance « npm run build » avant les tests d'intégration.`);
    pg = await startPostgres();
    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    app = spawn(process.execPath, [SERVER], {
      cwd: path.dirname(SERVER),
      env: {
        ...process.env,
        NODE_ENV: "production",
        DATABASE_URL: pg.url,
        BETTER_AUTH_SECRET: "integration-secret-integration-secret-42",
        BETTER_AUTH_URL: base,
        PORT: String(port),
        HOSTNAME: "127.0.0.1",
        NEXT_TELEMETRY_DISABLED: "1",
      },
    });
    app.stdout?.on("data", (d) => (logs += d));
    app.stderr?.on("data", (d) => (logs += d));
    for (let i = 0; i < 120; i++) {
      try {
        if ((await fetch(`${base}/api/health/app`)).ok) return;
      } catch {
        // not up yet
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`L'app n'a pas démarré :\n${logs}`);
  }, 240_000);

  afterAll(async () => {
    app?.kill();
    await pg?.stop();
  }, 60_000);

  it("without any account, every page leads to /setup", async () => {
    // No cookie: proxy → /login → /setup
    const home = await get("/");
    expect(home.status).toBe(307);
    expect(new URL(home.headers.get("location")!, base).pathname).toBe("/login");
    const login = await get("/login");
    expect(new URL(login.headers.get("location")!, base).pathname).toBe("/setup");
    // A (forged) cookie gets past the proxy: the protected layout itself redirects.
    for (const p of ["/", "/parametres/forums", "/f/x", "/t/1"]) {
      const res = await get(p, "better-auth.session_token=forged.value");
      expect([p, res.status, new URL(res.headers.get("location") ?? "/", base).pathname]).toEqual([p, 307, "/setup"]);
    }
    expect((await get("/setup")).status).toBe(200);
  });

  it("validates the form server-side (password confirmation)", async () => {
    const fields = hiddenFields(await (await get("/setup")).text());
    const res = await postSetup(fields, { email: "moi@example.com", password: "un mot de passe long", confirm: "un autre mot de passe" });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("ne correspondent pas");
    expect(await pg.sql`select 1 from "user"`).toHaveLength(0);
  });

  it("two simultaneous setups: one wins (signed in), the other gets 404", async () => {
    const fields = hiddenFields(await (await get("/setup")).text());
    expect(fields.length).toBeGreaterThan(0);
    setupFields = fields;
    const [a, b] = await Promise.all([
      postSetup(fields, { email: "alice@example.com", password: "mot de passe d'alice", confirm: "mot de passe d'alice" }),
      postSetup(fields, { email: "bob@example.com", password: "mot de passe de bob", confirm: "mot de passe de bob" }),
    ]);
    const results = [a, b].map((r) => ({ status: r.status, location: r.headers.get("location"), cookies: r.headers.getSetCookie() }));
    const winners = results.filter((r) => r.status === 303);
    const losers = results.filter((r) => r.status === 404);
    expect({ winners: winners.length, losers: losers.length }).toEqual({ winners: 1, losers: 1 });
    expect(winners[0]!.location).toBe("/");

    const users = await pg.sql<{ email: string }[]>`select email from "user"`;
    expect(users).toHaveLength(1);

    // The winner is signed in.
    const cookie = winners[0]!.cookies.map((c) => c.split(";")[0]).join("; ");
    expect(cookie).toContain("better-auth.session_token=");
    const home = await get("/", cookie);
    expect(home.status).toBe(200);
    expect(await home.text()).toContain("Forums");
  });

  it("once an account exists, /setup is 404 for good (GET and POST)", async () => {
    expect((await get("/setup")).status).toBe(404);
    // Replaying a valid setup submission (captured before) after the fact.
    const res = await postSetup(setupFields, { email: "late@example.com", password: "un mot de passe long", confirm: "un mot de passe long" });
    expect(res.status).toBe(404);
    expect(await pg.sql`select 1 from "user"`).toHaveLength(1);
    // And the login page is back.
    expect((await get("/login")).status).toBe(200);
  });
});

/**
 * Integration test on a REAL PostgreSQL: runs the actual worker process
 * (`worker/index.ts --once`, FETCH_CONCURRENCY=4) against 10 sources whose
 * feeds share many articles under URL variants (utm_*, fbclid, #fragment,
 * trailing slash), then two workers at the same time.
 * Checks: no error, no duplicate topic, every favicon stored.
 *
 * Database: TEST_DATABASE_URL if set (a throwaway database is created and
 * dropped on that server), otherwise a postgres:17-alpine container started
 * with testcontainers (Docker required).
 *
 *   npm run test:integration
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";
import { normalizeUrl } from "@/lib/feeds/normalize-url";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const SOURCE_COUNT = 10;
const ITEMS_PER_FEED = 30;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

// ---------------------------------------------------------------------------
// Feeds: feed i contains articles (i*7 + k) % POOL, each under a URL variant
// ---------------------------------------------------------------------------
let pool = 60;
let server: http.Server;
let base = "";

const VARIANTS = [
  (u: string) => u,
  (u: string, i: number) => `${u}?utm_source=feed${i}&utm_medium=rss`,
  (u: string) => `${u}/`,
  (u: string) => `${u}#comments`,
  (u: string, i: number) => `${u}?fbclid=abc${i}`,
];

function articleIds(feed: number): number[] {
  return Array.from({ length: ITEMS_PER_FEED }, (_, k) => (feed * 7 + k) % pool);
}

function feedXml(feed: number): string {
  const items = articleIds(feed)
    .map((n, k) => {
      const url = VARIANTS[(feed + k) % VARIANTS.length]!(`${base}/articles/${n}`, feed);
      const date = new Date(Date.UTC(2026, 9, 1) + n * 3_600_000).toUTCString();
      return `<item><title>Article ${n}</title><link>${url.replace(/&/g, "&amp;")}</link><pubDate>${date}</pubDate><description>Résumé ${n}</description></item>`;
    })
    .join("");
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>Feed ${feed}</title><link>${base}/</link>${items}</channel></rss>`;
}

const feedKeys = () => Array.from({ length: SOURCE_COUNT }, (_, i) => articleIds(i)).flat().map((n) => `${base}/articles/${n}`);
/** Every normalized URL published so far (topics are never deleted). */
const published = new Set<string>();
const expectedKeys = () => {
  feedKeys().forEach((k) => published.add(k));
  return published;
};

function startServer(): Promise<void> {
  server = http.createServer((req, res) => {
    // Random latency so that lanes and processes interleave.
    setTimeout(() => {
      const url = new URL(req.url ?? "/", base);
      const feed = /^\/feeds\/(\d+)$/.exec(url.pathname);
      if (feed) {
        res.writeHead(200, { "content-type": "application/rss+xml" });
        return res.end(feedXml(Number(feed[1])));
      }
      if (url.pathname === "/") {
        res.writeHead(200, { "content-type": "text/html" });
        return res.end('<html><head><link rel="icon" href="/icon.png"></head></html>');
      }
      if (url.pathname === "/icon.png") {
        res.writeHead(200, { "content-type": "image/png" });
        return res.end(PNG);
      }
      res.writeHead(404).end();
    }, Math.random() * 60);
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    }),
  );
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------
let container: StartedPostgreSqlContainer | undefined;
let adminUrl: string | undefined;
let dbName: string | undefined;
let databaseUrl = "";
let sql: ReturnType<typeof postgres>;

async function startDatabase() {
  const external = process.env.TEST_DATABASE_URL;
  if (external) {
    // Never touch the given database: create a throwaway one next to it.
    adminUrl = external;
    dbName = `veille_it_${randomBytes(4).toString("hex")}`;
    const admin = postgres(external, { max: 1, onnotice: () => {} });
    await admin.unsafe(`create database ${dbName}`);
    await admin.end();
    const u = new URL(external);
    u.pathname = `/${dbName}`;
    databaseUrl = u.toString();
  } else {
    container = await new PostgreSqlContainer("postgres:17-alpine").start();
    databaseUrl = container.getConnectionUri();
  }
  sql = postgres(databaseUrl, { max: 2, onnotice: () => {} });
  await migrate(drizzle(sql, { schema }), { migrationsFolder: path.join(ROOT, "drizzle") });
}

async function stopDatabase() {
  await sql?.end({ timeout: 5 });
  if (container) await container.stop();
  if (adminUrl && dbName) {
    const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
    await admin.unsafe(`drop database if exists ${dbName} with (force)`);
    await admin.end();
  }
}

// ---------------------------------------------------------------------------
// Worker process
// ---------------------------------------------------------------------------
type WorkerRun = { code: number | null; stdout: string; stderr: string };

function runWorker(): Promise<WorkerRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs"), "worker/index.ts", "--once"], {
      cwd: ROOT,
      env: { ...process.env, DATABASE_URL: databaseUrl, FETCH_CONCURRENCY: "4", DATABASE_POOL_SIZE: "4" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function expectCleanRun(run: WorkerRun) {
  expect(run.stdout).not.toMatch(/ERREUR|Cycle en échec/);
  expect(run.stderr).not.toMatch(/error/i);
  expect(run.code).toBe(0);
}

async function expectConsistent() {
  const rows = await sql<{ url: string; normalized_url: string }[]>`select url, normalized_url from topics`;
  const keys = rows.map((r) => r.normalized_url);
  // No duplicate topic: neither on the stored key nor after re-normalizing the raw URL.
  expect(new Set(keys).size).toBe(rows.length);
  expect(new Set(rows.map((r) => normalizeUrl(r.url))).size).toBe(rows.length);
  expect(new Set(keys)).toEqual(expectedKeys());

  const failing = await sql`select name, last_error from sources where last_error is not null or consecutive_failures > 0 or last_fetched_at is null`;
  expect(failing).toEqual([]);
}

// ---------------------------------------------------------------------------

describe("worker on a real PostgreSQL (FETCH_CONCURRENCY=4)", () => {
  beforeAll(async () => {
    await startServer();
    await startDatabase();
    const [forumA, forumB] = await sql<{ id: number }[]>`
      insert into forums (name, slug, position) values ('Sécu', 'secu', 10), ('DevOps', 'devops', 20) returning id`;
    for (let i = 0; i < SOURCE_COUNT; i++) {
      const forumId = i % 2 ? forumB!.id : forumA!.id;
      await sql`insert into sources (forum_id, name, url) values (${forumId}, ${`Source ${i}`}, ${`${base}/feeds/${i}`})`;
    }
  }, 180_000);

  afterAll(async () => {
    await stopDatabase();
    server?.close();
  }, 60_000);

  it("first import: no error, no duplicate topic, favicons stored", async () => {
    const run = await runWorker();
    expectCleanRun(run);
    await expectConsistent();

    const [{ n } = { n: 0 }] = await sql<{ n: number }[]>`select count(*)::int n from topics`;
    expect(n).toBe(new Set(feedKeys()).size);
    expect(n).toBeLessThan(SOURCE_COUNT * ITEMS_PER_FEED); // the feeds really overlap

    const icons = await sql<{ content_type: string; size: number }[]>`
      select content_type, octet_length(data)::int size from source_favicons`;
    expect(icons).toHaveLength(SOURCE_COUNT);
    expect(icons.every((i) => i.content_type === "image/png" && i.size === PNG.length)).toBe(true);
  });

  it("two workers at the same time on updated feeds: still no error nor duplicate", async () => {
    pool = 90; // new articles, still shared between feeds
    const runs = await Promise.all([runWorker(), runWorker()]);
    runs.forEach(expectCleanRun);
    await expectConsistent();

    // Articles that appeared after the first import are unread.
    const [{ unread } = { unread: 0 }] = await sql<{ unread: number }[]>`select count(*)::int unread from topics where read_at is null`;
    expect(unread).toBeGreaterThan(0);
  });
});

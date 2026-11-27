import { drizzle } from "drizzle-orm/postgres-js";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import postgres from "postgres";
import * as schema from "./schema";

/** Any Postgres drizzle database using our schema (postgres-js in prod, PGlite in tests). */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

type PgClient = ReturnType<typeof postgres>;

// Reuse the client across hot reloads in dev.
const globalForDb = globalThis as unknown as { veillePg?: PgClient };

let instance: ReturnType<typeof drizzle<typeof schema>> | undefined;
let client: PgClient | undefined;

/** Connections of the app (or the worker) to PostgreSQL. DATABASE_POOL_SIZE overrides it (1 with pglite-server). */
export const DEFAULT_POOL_SIZE = 10;

/** A positive integer, else the default: an empty value (docker-compose, .env) changes nothing. */
export function poolSize(env: Partial<Record<string, string | undefined>> = process.env): number {
  const n = Number(env.DATABASE_POOL_SIZE?.trim() || NaN);
  return Number.isInteger(n) && n >= 1 ? n : DEFAULT_POOL_SIZE;
}

/** Lazily created so that importing this module (e.g. during `next build`) never needs a DB. */
export function getDb() {
  if (!instance) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    client = globalForDb.veillePg ?? postgres(url, { max: poolSize(), onnotice: () => {} });
    if (process.env.NODE_ENV !== "production") globalForDb.veillePg = client;
    instance = drizzle(client, { schema });
  }
  return instance;
}

export async function closeDb() {
  const c = client;
  client = undefined;
  instance = undefined;
  globalForDb.veillePg = undefined;
  await c?.end({ timeout: 5 });
}

export { schema };

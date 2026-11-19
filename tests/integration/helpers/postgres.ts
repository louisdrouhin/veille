/**
 * Real PostgreSQL for integration tests, migrated with the project's migrations.
 * - TEST_DATABASE_URL set: a throwaway database is created on that server and
 *   dropped afterwards (the given database itself is never touched);
 * - otherwise: a postgres:17-alpine container through testcontainers (Docker).
 */
import { randomBytes } from "node:crypto";
import path from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";

export const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");

export type TestDatabase = { url: string; sql: ReturnType<typeof postgres>; stop: () => Promise<void> };

export async function startPostgres(): Promise<TestDatabase> {
  let container: StartedPostgreSqlContainer | undefined;
  let url: string;
  let dropExternal: (() => Promise<void>) | undefined;

  const external = process.env.TEST_DATABASE_URL;
  if (external) {
    const name = `veille_it_${randomBytes(4).toString("hex")}`;
    const admin = postgres(external, { max: 1, onnotice: () => {} });
    await admin.unsafe(`create database ${name}`);
    await admin.end();
    const u = new URL(external);
    u.pathname = `/${name}`;
    url = u.toString();
    dropExternal = async () => {
      const a = postgres(external, { max: 1, onnotice: () => {} });
      await a.unsafe(`drop database if exists ${name} with (force)`);
      await a.end();
    };
  } else {
    container = await new PostgreSqlContainer("postgres:17-alpine").start();
    url = container.getConnectionUri();
  }

  const sql = postgres(url, { max: 4, onnotice: () => {} });
  await migrate(drizzle(sql, { schema }), { migrationsFolder: path.join(ROOT, "drizzle") });

  return {
    url,
    sql,
    stop: async () => {
      await sql.end({ timeout: 5 });
      await container?.stop();
      await dropExternal?.();
    },
  };
}

/** Applies pending Drizzle migrations. Run at container start, before the app server. */
import path from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { closeDb, getDb } from "@/lib/db";

const migrationsFolder = process.env.MIGRATIONS_DIR ?? path.join(process.cwd(), "drizzle");

try {
  await migrate(getDb(), { migrationsFolder });
  console.log("Migrations appliquées.");
} catch (err) {
  console.error("Échec des migrations :", err);
  process.exitCode = 1;
} finally {
  await closeDb();
}

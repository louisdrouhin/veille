import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Locally only (GitHub Actions sets CI): fewer workers and a longer hook timeout. On a Windows
 * workstation, the full suite runs many PGlite instances at once and their migrations in
 * beforeEach can exceed the default 10 s hook timeout. CI keeps vitest's defaults.
 */
const local = !process.env.CI;

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname) } },
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/integration/**", "node_modules/**"],
    testTimeout: 30_000,
    ...(local ? { maxWorkers: 4, hookTimeout: 60_000 } : {}),
  },
});

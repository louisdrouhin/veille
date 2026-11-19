import path from "node:path";
import { defineConfig } from "vitest/config";

/** Integration tests: real PostgreSQL (testcontainers or TEST_DATABASE_URL). `npm run test:integration` */
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname) } },
  test: {
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});

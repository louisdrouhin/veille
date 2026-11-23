import "server-only";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

/** Source of the worker, read at runtime (traced into the standalone build, cf. next.config.ts). */
export const SERVICE_WORKER_SOURCE = path.join("lib", "pwa", "service-worker.js");

/**
 * The served worker: its source preceded by a version comment. The version
 * hashes the Next.js build id with the source, so every deploy changes the
 * bytes of /sw.js — which is how the browser detects an update.
 */
export function buildServiceWorker(source: string, buildId: string): { version: string; body: string } {
  const version = createHash("sha256").update(buildId).update("\0").update(source).digest("hex").slice(0, 16);
  return { version, body: `// Veille service worker — version ${version}\n${source}` };
}

let cached: string | undefined;

export function serviceWorkerScript(cwd = process.cwd()): string {
  if (cached !== undefined) return cached;
  const source = readFileSync(path.join(cwd, SERVICE_WORKER_SOURCE), "utf8");
  let buildId = "dev";
  try {
    buildId = readFileSync(path.join(cwd, ".next", "BUILD_ID"), "utf8").trim();
  } catch {
    // next dev: no build id (the worker is not registered in dev anyway)
  }
  cached = buildServiceWorker(source, buildId).body;
  return cached;
}

export const SERVICE_WORKER_HEADERS = {
  "Content-Type": "text/javascript; charset=utf-8",
  // Always revalidated: an update must be seen on the next check.
  "Cache-Control": "no-cache, no-store, must-revalidate",
  "X-Content-Type-Options": "nosniff",
  // CSP of the worker itself: it only talks to our origin.
  "Content-Security-Policy": "default-src 'self'",
} as const;

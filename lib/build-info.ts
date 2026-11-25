/**
 * Build metadata (version, commit, date) for Mon compte › À propos. Used by next.config.ts only,
 * at build time; the app reads the inlined values through lib/app-info.ts.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

const COMMIT = /^[0-9a-f]{7,40}$/;

/** Short commit of the build: APP_COMMIT (Docker build arg, .git is not in the image), else git, else "". */
export function buildCommit(env: Partial<Record<string, string | undefined>> = process.env): string {
  const given = env.APP_COMMIT?.trim().toLowerCase();
  if (given) return COMMIT.test(given) ? given.slice(0, 12) : "";
  try {
    const out = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return COMMIT.test(out) ? out : "";
  } catch {
    return "";
  }
}

/**
 * Version shown in Mon compte › À propos (lib/app-info.ts). Inlined into the bundle at build
 * (`env` below): nothing is read at runtime. Under `next dev`, commit and date are « dev ».
 */
export function buildInfoEnv(phase: string, env: Partial<Record<string, string | undefined>> = process.env, now = new Date(), cwd = process.cwd()) {
  // next.config.ts is compiled by Next: the build runs from the project root.
  const pkg = JSON.parse(readFileSync(path.join(cwd, "package.json"), "utf8")) as { version: string; repository?: { url?: string } };
  const dev = phase === PHASE_DEVELOPMENT_SERVER;
  return {
    APP_VERSION: pkg.version,
    APP_COMMIT: dev ? "dev" : buildCommit(env),
    APP_BUILT_AT: dev ? "dev" : now.toISOString(),
    APP_REPOSITORY_URL: (pkg.repository?.url ?? "").replace(/^git\+/, "").replace(/\.git$/, ""),
  };
}

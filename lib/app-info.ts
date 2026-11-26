import { formatFull, formatTitle } from "@/lib/format-date";

/**
 * Version of the running app, for Paramètres › À propos. The values are inlined at build by
 * next.config.ts (lib/build-info.ts): nothing comes from git or the environment at runtime.
 * Each `process.env.X` is written out in full so that the bundler can replace it.
 */
export type BuildEnv = { version?: string; commit?: string; builtAt?: string; repositoryUrl?: string };

export const BUILD_ENV: BuildEnv = {
  version: process.env.APP_VERSION,
  commit: process.env.APP_COMMIT,
  builtAt: process.env.APP_BUILT_AT,
  repositoryUrl: process.env.APP_REPOSITORY_URL,
};

export type AppInfo = {
  version: string;
  /** Short commit, « dev » under `next dev`, null when the build was not given one. */
  commit: string | null;
  commitUrl: string | null;
  /** « 25 nov. 2026 à 10:42 » (Paris), « dev » under `next dev`, null if unknown. */
  builtAt: { label: string; iso: string; title: string } | "dev" | null;
};

export function appInfo(env: BuildEnv = BUILD_ENV): AppInfo {
  const dev = env.commit === "dev";
  const commit = dev ? "dev" : /^[0-9a-f]{7,40}$/.test(env.commit ?? "") ? env.commit! : null;
  const repo = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(env.repositoryUrl ?? "") ? env.repositoryUrl! : null;
  const date = env.builtAt && env.builtAt !== "dev" ? new Date(env.builtAt) : null;
  return {
    version: env.version || "inconnue",
    commit,
    commitUrl: commit && !dev && repo ? `${repo}/commit/${commit}` : null,
    builtAt:
      env.builtAt === "dev" || dev
        ? "dev"
        : date && !Number.isNaN(date.getTime())
          ? { label: formatFull(date), iso: date.toISOString(), title: formatTitle(date) }
          : null,
  };
}

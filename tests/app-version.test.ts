/**
 * Version of the app (Paramètres › À propos) and the changelog (« Nouveautés »): values inlined at
 * build, never read from git or the environment at runtime, and a CHANGELOG entry per version.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/link", () => ({ default: (props: { href: string; prefetch?: boolean }) => createElement("a", { href: props.href }, (props as { children?: React.ReactNode }).children) }));

const { buildCommit, buildInfoEnv } = await import("@/lib/build-info");
const { appInfo } = await import("@/lib/app-info");
const { changelogHtml } = await import("@/lib/changelog");
const { AboutPanel } = await import("@/components/account/about-panel");
const nextConfig = (await import("../next.config")).default;

const ROOT = path.join(import.meta.dirname, "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
const PKG = JSON.parse(read("package.json")) as { version: string };
const REPO = "https://github.com/louisdrouhin/veille";
const BUILT = new Date("2026-11-25T09:42:00Z");

describe("build metadata (next.config.ts → bundle)", () => {
  it("takes the commit from APP_COMMIT (Docker build arg), validated", () => {
    expect(buildCommit({ APP_COMMIT: "12bdc40" })).toBe("12bdc40");
    expect(buildCommit({ APP_COMMIT: " 12BDC40 " })).toBe("12bdc40");
    expect(buildCommit({ APP_COMMIT: "12bdc40; rm -rf /" })).toBe("");
    // Without the arg, git is asked (local builds, CI): a short hash or nothing.
    expect(buildCommit({})).toMatch(/^([0-9a-f]{7,40})?$/);
  });

  it("production build: version of package.json, commit, date and repository; next dev: « dev »", () => {
    expect(buildInfoEnv("phase-production-build", { APP_COMMIT: "12bdc40" }, BUILT, ROOT)).toEqual({
      APP_VERSION: PKG.version,
      APP_COMMIT: "12bdc40",
      APP_BUILT_AT: "2026-11-25T09:42:00.000Z",
      APP_REPOSITORY_URL: REPO,
    });
    expect(buildInfoEnv("phase-development-server", { APP_COMMIT: "12bdc40" }, BUILT, ROOT)).toMatchObject({ APP_COMMIT: "dev", APP_BUILT_AT: "dev" });
  });

  it("next.config inlines them (env) and ships CHANGELOG.md with the Nouveautés page", () => {
    const cfg = nextConfig("phase-production-build");
    expect(Object.keys(cfg.env ?? {}).sort()).toEqual(["APP_BUILT_AT", "APP_COMMIT", "APP_REPOSITORY_URL", "APP_VERSION"]);
    expect(cfg.outputFileTracingIncludes?.["/parametres/a-propos"]).toEqual(["./CHANGELOG.md"]);
    expect(cfg.output).toBe("standalone");
  });

  it("Docker: APP_COMMIT is a build arg set before the build, passed by CI and the local build file; CHANGELOG.md is in the context", () => {
    const dockerfile = read("Dockerfile");
    expect(dockerfile.indexOf('ARG APP_COMMIT=""')).toBeGreaterThan(0);
    expect(dockerfile.indexOf("ARG APP_COMMIT")).toBeLessThan(dockerfile.indexOf("RUN npm run build"));
    expect(dockerfile).toContain("ENV APP_COMMIT=$APP_COMMIT");
    expect(read("docker-compose.build.yml")).toMatch(/args:\n(?:\s+#.*\n)*\s+APP_COMMIT: \$\{APP_COMMIT:-\}/);
    expect(read(".github/workflows/release.yml")).toContain("build-args: APP_COMMIT=");
    expect(read("docker-compose.yml")).toMatch(/^name: veille$/m);
    expect(read(".dockerignore")).not.toMatch(/CHANGELOG/);
  });
});

describe("appInfo and the « À propos » panel", () => {
  it("production: version, short commit linked to GitHub, build date in Paris", () => {
    const info = appInfo({ version: "2.12.0", commit: "12bdc40", builtAt: BUILT.toISOString(), repositoryUrl: REPO });
    expect(info).toEqual({
      version: "2.12.0",
      commit: "12bdc40",
      commitUrl: `${REPO}/commit/12bdc40`,
      builtAt: { label: "25 nov. 2026 à 10:42", iso: "2026-11-25T09:42:00.000Z", title: "25/11/2026 à 10:42" },
    });
    const html = renderToString(createElement(AboutPanel, { info }));
    expect(html).toContain("À propos");
    expect(html).toContain(`href="${REPO}/commit/12bdc40" target="_blank" rel="noopener noreferrer"`);
    expect(html).toContain('dateTime="2026-11-25T09:42:00.000Z"');
  });

  it("next dev: « dev » for the commit and the build, no link", () => {
    const info = appInfo({ version: "2.12.0", commit: "dev", builtAt: "dev", repositoryUrl: REPO });
    expect(info).toMatchObject({ commit: "dev", commitUrl: null, builtAt: "dev" });
    const html = renderToString(createElement(AboutPanel, { info }));
    expect(html).not.toContain("github.com");
    expect(html.match(/>dev</g)).toHaveLength(2);
  });

  it("a build without the commit or with odd values: « inconnu », never a broken link", () => {
    expect(appInfo({ version: "2.12.0", commit: "", builtAt: "", repositoryUrl: REPO })).toMatchObject({ commit: null, commitUrl: null, builtAt: null });
    expect(appInfo({ version: "2.12.0", commit: "12bdc40", builtAt: "pas une date", repositoryUrl: "javascript:alert(1)" })).toMatchObject({
      commitUrl: null,
      builtAt: null,
    });
    expect(appInfo({})).toMatchObject({ version: "inconnue", commit: null });
    expect(renderToString(createElement(AboutPanel, { info: appInfo({ version: "2.12.0" }) })).match(/inconnu</g)).toHaveLength(2);
  });
});

describe("CHANGELOG.md", () => {
  const md = read("CHANGELOG.md");
  const versions = [...md.matchAll(/^## (\d+)\.(\d+)\.(\d+) — (\d{2})\/(\d{2})\/(\d{4})$/gm)];

  it("has an entry for the current version, first, matching package.json and package-lock.json", () => {
    expect(versions[0]![0]).toMatch(new RegExp(`^## ${PKG.version.replaceAll(".", "\\.")} — `));
    const lock = JSON.parse(read("package-lock.json")) as { version: string; packages: Record<string, { version?: string }> };
    expect(lock.version).toBe(PKG.version);
    expect(lock.packages[""]!.version).toBe(PKG.version);
  });

  it("every version heading is well formed, newest first, with at least one line", () => {
    expect(md.match(/^## /gm)).toHaveLength(versions.length);
    const key = (m: RegExpMatchArray) => [Number(m[1]), Number(m[2]), Number(m[3])];
    for (let i = 1; i < versions.length; i++) {
      const [a, b] = [key(versions[i - 1]!), key(versions[i]!)];
      expect(a[0]! * 1e6 + a[1]! * 1e3 + a[2]!, versions[i]![0]).toBeGreaterThan(b[0]! * 1e6 + b[1]! * 1e3 + b[2]!);
    }
    for (const section of md.split(/^## /m).slice(1)) expect(section, section.split("\n")[0]).toMatch(/^- /m);
  });

  it("« Nouveautés » renders it without its title, versions as headings, everything escaped", () => {
    const html = changelogHtml(ROOT)!;
    expect(html).not.toContain("Changelog");
    expect(html.startsWith(`<h2>${PKG.version} — `)).toBe(true);
    expect(html).toContain("<ul><li>");
    expect(changelogHtml(path.join(ROOT, "nowhere"))).toBeNull();
    // The in-app wording of v3.1: no « Mode lecture » anywhere in the app.
    expect(html).not.toMatch(/mode lecture/i);
  });
});

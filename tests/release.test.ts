/**
 * Release chain (.github/workflows/release.yml): notes from the CHANGELOG, actions pinned by SHA,
 * least privilege per job, the image scanned before it is pushed, and deployment from GHCR.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
// @ts-expect-error -- plain ESM script, no types
import { releaseNotes } from "../scripts/release-notes.mjs";

const ROOT = path.join(import.meta.dirname, "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");

type Step = { uses?: string; run?: string; with?: Record<string, unknown>; if?: string; name?: string };
type Job = { needs?: string | string[]; if?: string; permissions?: Record<string, string>; steps: Step[] };
const workflow = parse(read(".github/workflows/release.yml")) as {
  on: Record<string, unknown>;
  permissions: Record<string, string>;
  jobs: Record<string, Job>;
};
const jobs = workflow.jobs;
const allSteps = Object.values(jobs).flatMap((j) => j.steps);

describe("release notes (scripts/release-notes.mjs)", () => {
  const md = "# Changelog\n\nIntro.\n\n## 2.13.0 — 25/11/2026\n\n- Un.\n- Deux.\n\n## 2.12.0 — 25/11/2026\n\n- Avant.\n";

  it("returns the section of the version, without its heading", () => {
    expect(releaseNotes(md, "2.13.0")).toBe("- Un.\n- Deux.");
    expect(releaseNotes(md, "2.12.0")).toBe("- Avant.");
  });

  it("null for a missing version, an empty section, or a near miss (2.1.0 is not 2.13.0)", () => {
    expect(releaseNotes(md, "2.14.0")).toBeNull();
    expect(releaseNotes(md, "2.1.0")).toBeNull();
    expect(releaseNotes("## 3.0.0 — 01/01/2027\n\n## 2.0.0 — x\n- a", "3.0.0")).toBeNull();
  });

  it("the real CHANGELOG has notes for the current version", () => {
    const { version } = JSON.parse(read("package.json")) as { version: string };
    expect(releaseNotes(read("CHANGELOG.md"), version)).toMatch(/^- /);
  });
});

describe("release workflow", () => {
  it("runs on PRs (build + scan) and on master; nothing granted by default", () => {
    expect(Object.keys(workflow.on).sort()).toEqual(["pull_request", "push", "workflow_dispatch"]);
    expect(workflow.permissions).toEqual({});
  });

  it("every action is pinned by a full commit SHA", () => {
    const uses = allSteps.flatMap((s) => (s.uses ? [s.uses] : []));
    expect(uses.length).toBeGreaterThan(8);
    for (const u of uses) expect(u, u).toMatch(/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/);
    // Also in the other workflows.
    for (const f of ["ci.yml", "codeql.yml"]) {
      for (const m of read(`.github/workflows/${f}`).matchAll(/uses:\s*(\S+)/g)) expect(m[1], f).toMatch(/@[0-9a-f]{40}$/);
    }
  });

  it("least privilege: packages:write only to publish, contents:write only to release, SARIF upload only in the scan", () => {
    expect(jobs.version!.permissions).toEqual({ contents: "read" });
    expect(jobs.scan!.permissions).toEqual({ contents: "read", "security-events": "write" });
    expect(jobs.publish!.permissions).toEqual({ contents: "read", packages: "write" });
    expect(jobs.release!.permissions).toEqual({ contents: "write" });
    // No checkout keeps the token in .git/config.
    for (const s of allSteps.filter((s) => s.uses?.startsWith("actions/checkout@"))) expect(s.with?.["persist-credentials"]).toBe(false);
    // No ${{ }} expansion inside shell scripts (injection): values go through env.
    for (const s of allSteps.filter((s) => s.run)) expect(s.run, s.name).not.toMatch(/\$\{\{/);
  });

  it("publishes only a new version, after the scan, then releases with the CHANGELOG section", () => {
    expect(jobs.scan!.needs).toBe("version");
    expect(jobs.publish!.needs).toEqual(["version", "scan"]);
    expect(jobs.publish!.if).toBe("needs.version.outputs.release == 'true'");
    expect(jobs.release!.needs).toEqual(["version", "publish"]);
    const decide = jobs.version!.steps.find((s) => s.run?.includes("release=true"))!.run!;
    expect(decide).toContain('git ls-remote --exit-code --tags origin "refs/tags/v$version"');
    expect(decide).toContain('[ "$version" != "$previous" ]');
    expect(jobs.release!.steps.at(-1)!.run).toContain('node scripts/release-notes.mjs "$VERSION" > notes.md');
    expect(jobs.release!.steps.at(-1)!.run).toContain('gh release create "v$VERSION"');
  });

  it("the scan builds amd64 with APP_COMMIT, checks the image for secrets, and Trivy fails on fixable CRITICAL", () => {
    const build = jobs.scan!.steps.find((s) => s.uses?.startsWith("docker/build-push-action@"))!;
    expect(build.with).toMatchObject({ platforms: "${{ env.PLATFORM }}", "build-args": "APP_COMMIT=${{ env.APP_COMMIT }}", push: false, load: true });
    expect(read(".github/workflows/release.yml")).toContain("PLATFORM: linux/amd64");
    const check = jobs.scan!.steps.find((s) => s.name?.startsWith("No secret"))!.run!;
    for (const pattern of ['".env"', '".env.*"', '".git"', '"*.pem"', '"CLAUDE.local.md"']) expect(check).toContain(pattern);
    const trivy = jobs.scan!.steps.filter((s) => s.uses?.startsWith("aquasecurity/trivy-action@"));
    const gate = trivy.find((s) => s.with?.["exit-code"] === "1")!;
    expect(gate.with).toMatchObject({ severity: "CRITICAL", "ignore-unfixed": true, scanners: "vuln,secret" });
    const report = trivy.find((s) => s.with?.format === "sarif")!;
    expect(report.with).toMatchObject({ output: "trivy.sarif", "exit-code": "0" });
    const upload = jobs.scan!.steps.find((s) => s.uses?.startsWith("github/codeql-action/upload-sarif@"))!;
    expect(upload.with).toMatchObject({ sarif_file: "trivy.sarif" });
    expect(upload.if).toContain("always()");
  });

  it("pushes to ghcr.io/louisdrouhin/veille with X.Y.Z, X.Y, short sha and latest, provenance and SBOM", () => {
    expect(read(".github/workflows/release.yml")).toContain("IMAGE: ghcr.io/louisdrouhin/veille");
    const meta = jobs.publish!.steps.find((s) => s.uses?.startsWith("docker/metadata-action@"))!;
    const tags = String(meta.with?.tags).trim().split("\n");
    expect(tags).toEqual([
      "type=raw,value=${{ needs.version.outputs.version }}",
      "type=raw,value=${{ needs.version.outputs.minor }}",
      "type=sha,prefix=,format=short",
      "type=raw,value=latest",
    ]);
    const push = jobs.publish!.steps.find((s) => s.uses?.startsWith("docker/build-push-action@"))!;
    expect(push.with).toMatchObject({ push: true, provenance: "mode=max", sbom: true, platforms: "${{ env.PLATFORM }}" });
  });
});

describe("image contents and deployment", () => {
  it("the build context leaves out secrets and git data; the runtime image has no package manager", () => {
    const ignore = read(".dockerignore").split("\n");
    for (const entry of [".git", ".env", ".env.*", "backups"]) expect(ignore).toContain(entry);
    const runner = read("Dockerfile").split("AS runner")[1]!;
    expect(runner).toContain("rm -rf /usr/local/lib/node_modules/npm");
    // Only build outputs are copied into the runtime image.
    expect([...runner.matchAll(/^COPY .*$/gm)].map((m) => m[0].split(" ").at(-2))).toEqual([
      "/app/.next/standalone",
      "/app/.next/static",
      "/app/public",
      "/app/dist",
      "/app/drizzle",
    ]);
  });

  it("compose runs the GHCR image at APP_VERSION (required); a separate file builds locally", () => {
    const compose = read("docker-compose.yml");
    const image = "image: ghcr.io/louisdrouhin/veille:${APP_VERSION:?";
    expect(compose.split(image)).toHaveLength(3); // app and worker
    expect(compose).not.toMatch(/^\s+build:/m);
    expect(compose).toMatch(/^name: veille$/m);
    const local = read("docker-compose.build.yml");
    expect(local).toMatch(/build:\n\s+context: \.\n\s+args:\n(?:\s+#.*\n)*\s+APP_COMMIT: \$\{APP_COMMIT:-\}/);
    expect(read(".env.example")).toMatch(/^APP_VERSION=\d+\.\d+\.\d+$/m);
  });
});

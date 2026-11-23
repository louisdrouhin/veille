import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.join(import.meta.dirname, "..");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? sources(p) : /\.(tsx?|js)$/.test(f) ? [p] : [];
  });
}

describe("app name « Folders »", () => {
  // Shown text only: identifiers, cache names, the Compose project and the domain keep "veille".
  it("no displayed « Veille » left in pages, components, auth (TOTP issuer) or the service worker", () => {
    const files = [...sources(path.join(ROOT, "app")), ...sources(path.join(ROOT, "components")), ...sources(path.join(ROOT, "lib"))];
    const shown = /"Veille"|>Veille<|· Veille<|Installe Veille|appName: "Veille"/;
    const hits = files.filter((f) => shown.test(readFileSync(f, "utf8"))).map((f) => path.relative(ROOT, f));
    expect(hits).toEqual([]);
  });

  it("the Compose project name stays veille, so the volumes (and the database) are unchanged", () => {
    expect(readFileSync(path.join(ROOT, "docker-compose.yml"), "utf8")).toMatch(/^name: veille$/m);
  });
});

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { buildServiceWorker, SERVICE_WORKER_HEADERS, serviceWorkerScript } = await import("@/lib/pwa/sw-script");

describe("/sw.js", () => {
  it("changes with every build (so the browser sees the update) and with the source", () => {
    const a = buildServiceWorker("self.x = 1;", "build-1");
    expect(a.body).toBe(`// Veille service worker — version ${a.version}\nself.x = 1;`);
    expect(buildServiceWorker("self.x = 1;", "build-1").version).toBe(a.version);
    expect(buildServiceWorker("self.x = 1;", "build-2").version).not.toBe(a.version);
    expect(buildServiceWorker("self.x = 2;", "build-1").version).not.toBe(a.version);
  });

  it("reads the worker and the Next.js build id from the app directory", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "veille-sw-"));
    mkdirSync(path.join(dir, "lib", "pwa"), { recursive: true });
    mkdirSync(path.join(dir, ".next"));
    writeFileSync(path.join(dir, "lib", "pwa", "service-worker.js"), "self.ok = true;");
    writeFileSync(path.join(dir, ".next", "BUILD_ID"), "abc123\n");
    expect(serviceWorkerScript(dir)).toBe(buildServiceWorker("self.ok = true;", "abc123").body);
  });

  it("is never cached by HTTP and only talks to our origin", () => {
    expect(SERVICE_WORKER_HEADERS["Cache-Control"]).toContain("no-cache");
    expect(SERVICE_WORKER_HEADERS["Content-Type"]).toMatch(/^text\/javascript/);
    expect(SERVICE_WORKER_HEADERS["Content-Security-Policy"]).toBe("default-src 'self'");
  });
});

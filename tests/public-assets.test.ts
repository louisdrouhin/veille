import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";
import { config } from "@/proxy";

const ROOT = path.join(import.meta.dirname, "..");

/** True when proxy.ts runs on this path, i.e. it is redirected to /login without a session. */
function goesThroughProxy(pathname: string): boolean {
  return config.matcher.some((m) => new RegExp(`^${m}$`).test(pathname));
}

// Fetched without cookies: by iOS when adding to the home screen, by browsers for the
// manifest and by the service worker registration on the login page.
const PUBLIC = [
  "/apple-icon.png", // <link rel="apple-touch-icon"> (app/apple-icon.png)
  "/apple-touch-icon.png", // what iOS also tries at the root
  "/apple-touch-icon-precomposed.png",
  "/icon.svg",
  "/manifest.webmanifest",
  "/sw.js",
  ...(manifest().icons ?? []).map((i) => i.src),
];

describe("public files (no session)", () => {
  it.each(PUBLIC)("%s is not redirected to /login", (p) => {
    expect(goesThroughProxy(p)).toBe(false);
  });

  it.each(["/", "/login", "/f/securite", "/t/1", "/admin", "/apple-touch-icon.png.txt", "/sw.json", "/xicons/a.png"])(
    "%s still goes through the proxy",
    (p) => expect(goesThroughProxy(p)).toBe(true),
  );

  it("the root apple-touch-icons are the 180×180 PNG of app/apple-icon.png", () => {
    const icon = readFileSync(path.join(ROOT, "app", "apple-icon.png"));
    for (const f of ["apple-touch-icon.png", "apple-touch-icon-precomposed.png"]) {
      expect(readFileSync(path.join(ROOT, "public", f)).equals(icon)).toBe(true);
    }
    expect(icon.subarray(1, 4).toString()).toBe("PNG");
    expect([icon.readUInt32BE(16), icon.readUInt32BE(20)]).toEqual([180, 180]);
  });
});

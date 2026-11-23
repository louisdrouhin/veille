import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";
import { APPLE_TOUCH_ICON, ICONS } from "@/lib/pwa/icons";
import { config } from "@/proxy";

const ROOT = path.join(import.meta.dirname, "..");
const goesThroughProxy = (url: string) => unstable_doesMiddlewareMatch({ config, url });
const linkUrls = ICONS.icon.map((i) => i.url);

// What iOS asks for at the root when adding to the home screen (seen in the proxy logs).
const ROOT_TOUCH_ICONS = [
  "/apple-touch-icon.png",
  "/apple-touch-icon-precomposed.png",
  "/apple-touch-icon-180x180.png",
  "/apple-touch-icon-180x180-precomposed.png",
];

// Fetched without cookies: by iOS when adding to the home screen, by browsers for the
// manifest and by the service worker registration on the login page.
const PUBLIC = [...ROOT_TOUCH_ICONS, ...linkUrls, "/favicon.ico", "/manifest.webmanifest", "/sw.js", ...(manifest().icons ?? []).map((i) => i.src)];

describe("public files (no session)", () => {
  it.each([...new Set(PUBLIC)])("%s is not redirected to /login", (url) => {
    expect(goesThroughProxy(url)).toBe(false);
  });

  it.each(["/", "/login", "/f/securite", "/t/1", "/admin", "/apple-touch-icon.png.txt", "/apple-touch-icon-x.png", "/sw.json", "/xicons/a.png"])(
    "%s still goes through the proxy",
    (url) => expect(goesThroughProxy(url)).toBe(true),
  );

  it("the root touch icons are one opaque 180×180 PNG", () => {
    const icon = readFileSync(path.join(ROOT, "public", "apple-touch-icon.png"));
    expect(icon.subarray(1, 4).toString()).toBe("PNG");
    expect([icon.readUInt32BE(16), icon.readUInt32BE(20)]).toEqual([180, 180]);
    expect(icon[25]).toBe(2); // color type 2: RGB, no alpha channel
    for (const f of ROOT_TOUCH_ICONS) expect(readFileSync(path.join(ROOT, "public", f)).equals(icon), f).toBe(true);
  });
});

describe("/favicon.ico", () => {
  it("is an ICO with 16, 32 and 48 px PNG images of the logo, and no <link> (browsers ask for it by name)", () => {
    const ico = readFileSync(path.join(ROOT, "public", "favicon.ico"));
    expect([ico.readUInt16LE(0), ico.readUInt16LE(2)]).toEqual([0, 1]); // reserved, type 1 = icon
    const sizes = Array.from({ length: ico.readUInt16LE(4) }, (_, i) => {
      const e = 6 + 16 * i;
      const png = ico.subarray(ico.readUInt32LE(e + 12), ico.readUInt32LE(e + 12) + ico.readUInt32LE(e + 8));
      expect(png.subarray(1, 4).toString()).toBe("PNG");
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([ico[e], ico[e + 1]]);
      return ico[e];
    });
    expect(sizes).toEqual([16, 32, 48]);
    expect(linkUrls).not.toContain("/favicon.ico");
  });
});

describe("<link> icons", () => {
  it("apple-touch-icon first, then the PNG icon, then the SVG; plain URLs without a query", () => {
    expect(ICONS.icon.map((i) => `${"rel" in i ? i.rel : "icon"} ${i.url} ${i.type}`)).toEqual([
      `apple-touch-icon ${APPLE_TOUCH_ICON} image/png`,
      `icon ${APPLE_TOUCH_ICON} image/png`,
      "icon /icon.svg image/svg+xml",
    ]);
    expect(Object.keys(ICONS)).toEqual(["icon"]); // an `apple` list would be rendered after the SVG
    for (const url of linkUrls) expect(url).not.toContain("?");
  });

  it("no file-based icon (app/icon.*, app/apple-icon.*) adds a hashed <link> before them", () => {
    expect(readdirSync(path.join(ROOT, "app")).filter((f) => /^(?:icon|apple-icon)\d*\./.test(f))).toEqual([]);
  });
});

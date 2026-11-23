import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { basic, html, loadServiceWorker, png, SW_SOURCE } from "./helpers/service-worker-env";

const TOPIC_BODY =
  '<img src="/api/favicon/3?v=1"><div id="article"><img src="/api/image-proxy?url=https%3A%2F%2Fex.com%2Fa.png&amp;w=1" loading="lazy">' +
  '<img src="/api/image-proxy?url=https%3A%2F%2Fex.com%2Fb.png"></div>';

let sw: ReturnType<typeof loadServiceWorker>;
beforeEach(() => {
  sw = loadServiceWorker();
});

describe("service worker — static assets (cache-first)", () => {
  it("serves /_next/static and icons from the cache after the first download", async () => {
    sw.network.routes.set("/_next/static/chunks/app-1a2b.js", () => basic("console.log(1)"));
    sw.network.routes.set("/icons/icon-192.png", () => png("png"));
    await sw.fetchEvent("/_next/static/chunks/app-1a2b.js");
    await sw.fetchEvent("/icons/icon-192.png");
    sw.network.online = false;
    sw.network.calls.length = 0;
    expect(await (await sw.fetchEvent("/_next/static/chunks/app-1a2b.js"))!.text()).toBe("console.log(1)");
    expect((await sw.fetchEvent("/icons/icon-192.png"))!.status).toBe(200);
    expect(sw.network.calls).toEqual([]);
  });

  it("does not cache a failed download", async () => {
    await sw.fetchEvent("/_next/static/chunks/missing.js");
    expect(sw.caches.paths("veille-static")).toEqual([]);
  });

  it("refuses a redirect (e.g. to /login) and a non-image for an icon: network error, nothing cached", async () => {
    sw.network.routes.set("/icons/icon-192.png", () => png("<html>login</html>", { redirected: true }));
    sw.network.routes.set("/icons/icon-512.png", () => basic("<html>login</html>", { headers: { "content-type": "text/html" } }));
    sw.network.routes.set("/_next/static/chunks/moved.js", () => basic("x", { redirected: true }));
    sw.network.routes.set("/api/image-proxy?url=x", () => basic("<html></html>", { headers: { "content-type": "text/html" } }));
    for (const url of ["/icons/icon-192.png", "/icons/icon-512.png", "/_next/static/chunks/moved.js", "/api/image-proxy?url=x"]) {
      expect((await sw.fetchEvent(url))!.type, url).toBe("error");
    }
    expect([...sw.caches.paths("veille-static"), ...sw.caches.paths("veille-images")]).toEqual([]);
  });

  it("drops a non-image left under an icon's URL by an older version, and downloads it again", async () => {
    const cache = await sw.caches.open("veille-static");
    await cache.put("/icons/icon-192.png", new Response("<html>login</html>", { headers: { "content-type": "text/html" } }));
    sw.network.routes.set("/icons/icon-192.png", () => png("png"));
    const res = (await sw.fetchEvent("/icons/icon-192.png"))!;
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(sw.network.calls).toEqual(["/icons/icon-192.png"]);
    expect(await (await cache.match("/icons/icon-192.png"))!.text()).toBe("png");
  });

  it("scripts and styles are not held to the image check", async () => {
    sw.network.routes.set("/_next/static/chunks/a.css", () => basic("a{}", { headers: { "content-type": "text/css" } }));
    await sw.fetchEvent("/_next/static/chunks/a.css");
    expect(sw.caches.paths("veille-static")).toEqual(["/_next/static/chunks/a.css"]);
  });

  it("leaves the root touch icons to the network (iOS fetches them itself)", async () => {
    for (const url of ["/apple-touch-icon.png", "/apple-touch-icon-180x180-precomposed.png"]) {
      expect(await sw.fetchEvent(url), url).toBeUndefined();
    }
  });
});

describe("service worker — pages (network-first)", () => {
  it("returns the network response and keeps a copy, without the toast parameters", async () => {
    sw.network.routes.set("/f/securite", () => html("Sécurité · Veille"));
    const res = await sw.navigate("/f/securite?toast=ok&title=Fait&page=2#top");
    expect(res!.status).toBe(200);
    expect(sw.caches.paths("veille-pages")).toEqual(["/f/securite?page=2"]);
  });

  it("falls back to the cached copy offline", async () => {
    sw.network.routes.set("/", () => html("Forums · Veille", "en ligne"));
    await sw.navigate("/");
    sw.network.online = false;
    const res = await sw.navigate("/");
    expect(res!.status).toBe(200);
    expect(await res!.text()).toContain("en ligne");
  });

  it("offline with nothing cached: a « Hors ligne » page listing the topics saved for offline reading", async () => {
    sw.network.routes.set("/t/7", () => html("Faille &lt;critique&gt; &amp; correctif · Veille"));
    sw.network.routes.set("/t/8", () => html("Kubernetes 2.0 · Folders"));
    await sw.navigate("/t/7");
    await sw.navigate("/t/8");
    sw.network.online = false;
    const res = await sw.navigate("/f/devops");
    expect(res!.status).toBe(503);
    expect(res!.headers.get("content-security-policy")).toMatch(/^default-src 'none'/);
    const page = await res!.text();
    expect(page).toContain("<h1>Hors ligne</h1>");
    expect(page).toContain('<a class="btn" href="">Réessayer</a>');
    // Most recent first, titles escaped again, no " · Folders" suffix (nor " · Veille", saved before the rename).
    expect(page).toMatch(/href="\/t\/8">Kubernetes 2\.0<\/a>.*href="\/t\/7">Faille &lt;critique&gt; &amp; correctif<\/a>/s);
    expect(page).not.toContain("<script");
    expect(page).toContain("<title>Hors ligne · Folders</title>");
    expect(page).toContain("<span>Folders</span>");
  });

  it("never caches a redirect (expired session → /login), an error or a non-HTML response", async () => {
    sw.network.routes.set("/t/1", () => basic("", { status: 200, redirected: true, headers: { "content-type": "text/html" } }));
    sw.network.routes.set("/t/2", () => basic("", { status: 500, headers: { "content-type": "text/html" } }));
    sw.network.routes.set("/t/3", () => basic("{}", { headers: { "content-type": "application/json" } }));
    for (const p of ["/t/1", "/t/2", "/t/3", "/t/404"]) await sw.navigate(p);
    expect(sw.caches.paths("veille-pages")).toEqual([]);
  });
});

describe("service worker — never cached", () => {
  it.each(["/api/auth/get-session", "/setup", "/admin", "/admin/sources", "/login", "/compte", "/api/health", "/sw.js"])(
    "%s goes straight to the network and is never stored nor served from the cache",
    async (p) => {
      sw.network.routes.set(p, () => html("x"));
      expect(await sw.fetchEvent(p)).toBeUndefined();
      expect((await sw.navigate(p))!.status).toBe(200);
      await sw.message({ type: "cache-page", url: p });
      expect(sw.caches.paths("veille-pages")).toEqual([]);
      // Even if a copy were there, offline it is the « Hors ligne » page, not the copy.
      await (await sw.caches.open("veille-pages")).put(new URL(p, "https://veille.test").href, html("copie"));
      sw.network.online = false;
      const offline = await sw.navigate(p);
      expect(offline!.status).toBe(503);
      expect(await offline!.text()).toContain("<h1>Hors ligne</h1>");
    },
  );

  it("ignores data changes (POST: server actions, forms), Next.js router data and other origins", async () => {
    expect(await sw.fetchEvent("/f/securite", { method: "POST", mode: "navigate" })).toBeUndefined();
    expect(await sw.fetchEvent("/t/1", { headers: { RSC: "1" } })).toBeUndefined();
    expect(await sw.fetchEvent("/t/1?_rsc=abc")).toBeUndefined();
    expect(await sw.fetchEvent("https://cdn.example/_next/static/x.js")).toBeUndefined();
    expect(await sw.fetchEvent("/api/topics")).toBeUndefined();
    expect(sw.network.calls).toEqual([]);
  });

  it("only keeps home, forum lists and topics, under a path rebuilt from validated parts", async () => {
    for (const p of ["/", "/f/admin", "/f/dev-web", "/t/42"]) sw.network.routes.set(p, () => html(p));
    sw.network.routes.set("/f/dev-web?page=3", () => html("p3"));
    for (const p of ["/", "/f/admin", "/f/dev-web?page=3&toast=ok&title=x", "/f/dev-web?page=../../admin", "/t/42?x=1"]) await sw.navigate(p);
    expect(sw.caches.paths("veille-pages")).toEqual(["/", "/f/admin", "/f/dev-web?page=3", "/f/dev-web", "/t/42"]);
  });

  it("anything else is network only: /t/abc, /f/Upper, /f/a/b, /administratif, /_not-found…", async () => {
    for (const p of ["/t/abc", "/t/0", "/f/Upper", "/f/a/b", "/administratif", "/_not-found", "/t/1/edit"]) {
      sw.network.routes.set(p, () => html(p));
      expect((await sw.navigate(p))!.status, p).toBe(200);
      await sw.message({ type: "cache-page", url: p });
    }
    expect(sw.caches.paths("veille-pages")).toEqual([]);
  });
});

describe("service worker — offline reading of opened topics", () => {
  beforeEach(() => {
    sw.network.routes.set("/t/42", () => html("Un article · Veille", TOPIC_BODY));
    sw.network.routes.set("/api/favicon/3?v=1", () => png("ico"));
    sw.network.routes.set("/api/image-proxy?url=https%3A%2F%2Fex.com%2Fa.png&w=1", () => png("a"));
    sw.network.routes.set("/api/image-proxy?url=https%3A%2F%2Fex.com%2Fb.png", () => png("b"));
  });

  it("a topic opened in the app (cache-page message) is saved with its proxied images", async () => {
    await sw.message({ type: "cache-page", url: "/t/42" });
    expect(sw.caches.paths("veille-pages")).toEqual(["/t/42"]);
    expect(sw.caches.paths("veille-images").sort()).toEqual([
      "/api/favicon/3?v=1",
      "/api/image-proxy?url=https%3A%2F%2Fex.com%2Fa.png&w=1",
      "/api/image-proxy?url=https%3A%2F%2Fex.com%2Fb.png",
    ]);

    sw.network.online = false;
    expect(await (await sw.navigate("/t/42"))!.text()).toContain("Un article");
    expect(await (await sw.fetchEvent("/api/image-proxy?url=https%3A%2F%2Fex.com%2Fb.png"))!.text()).toBe("b");
  });

  it("a page saved a moment ago by a full load is not downloaded twice", async () => {
    await sw.navigate("/t/42");
    const calls = sw.network.calls.filter((c) => c === "/t/42").length;
    await sw.message({ type: "cache-page", url: "/t/42" });
    expect(sw.network.calls.filter((c) => c === "/t/42").length).toBe(calls);
    expect(sw.caches.paths("veille-images")).toHaveLength(3);
  });

  it("offline, a cache-page message keeps the copy already saved", async () => {
    await sw.message({ type: "cache-page", url: "/t/42" });
    sw.network.online = false;
    await sw.message({ type: "cache-page", url: "/t/42" });
    expect(sw.caches.paths("veille-pages")).toEqual(["/t/42"]);
  });

  it("refuses URLs of another origin, and messages from another origin", async () => {
    await sw.message({ type: "cache-page", url: "https://evil.example/t/1" });
    await sw.message({ type: "cache-page", url: "//evil.example/t/1" });
    await sw.message({ type: "cache-page", url: "/t/42" }, "https://evil.example");
    await sw.message({ type: "clear" }, "https://evil.example");
    await sw.message({ type: "skip-waiting" }, "https://evil.example");
    expect(sw.network.calls).toEqual([]);
    expect(sw.self.skipWaitingCalls).toBe(0);
  });
});


describe("service worker — logout and lifecycle", () => {
  it("« clear » deletes every cache, and drops writes that were in flight", async () => {
    sw.network.routes.set("/", () => html("Forums · Veille"));
    sw.network.routes.set("/_next/static/a.js", () => png("a"));
    await sw.navigate("/");
    await sw.fetchEvent("/_next/static/a.js");
    expect(await sw.caches.keys()).toEqual(["veille-pages", "veille-static"]);

    // A page download started before the logout must not land after it.
    sw.network.routes.set("/t/5", () => html("Secret · Veille"));
    const download = sw.message({ type: "cache-page", url: "/t/5" }); // waiting for the network…
    const cleared = sw.message({ type: "clear" });
    await Promise.all([download, cleared]);
    expect(sw.caches.paths("veille-pages")).toEqual([]);
    expect(sw.caches.paths("veille-static")).toEqual([]);
  });

  it("activation removes caches it does not know (older versions), keeps its own", async () => {
    await sw.caches.open("veille-pages");
    await sw.caches.open("old-cache-v0");
    await sw.activate();
    expect(await sw.caches.keys()).toEqual(["veille-pages"]);
  });

  it("only activates an update when the page asks (« Recharger »)", async () => {
    expect(sw.self.skipWaitingCalls).toBe(0);
    await sw.message({ type: "skip-waiting" });
    expect(sw.self.skipWaitingCalls).toBe(1);
  });

  it("caps the pages cache, evicting the oldest", async () => {
    for (let i = 1; i <= 152; i++) {
      sw.network.routes.set(`/f/x?page=${i}`, () => html(`p${i}`));
      await sw.navigate(`/f/x?page=${i}`);
    }
    const paths = sw.caches.paths("veille-pages");
    expect(paths).toHaveLength(150);
    expect(paths[0]).toBe("/f/x?page=3");
  });
});

describe("service worker — kept in sync with the app", () => {
  it("uses the colors of the design tokens on its offline page", () => {
    const css = readFileSync(path.join(import.meta.dirname, "..", "app", "globals.css"), "utf8");
    const root = /:root \{([\s\S]*?)\n\}/.exec(css)![1]!;
    const token = (name: string) => new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(root)![1]!.toUpperCase();
    const colors = JSON.parse(/const COLORS = (\{[^}]*\})/.exec(SW_SOURCE)![1]!.replace(/(\w+):/g, '"$1":')) as Record<string, string>;
    expect(colors).toEqual({
      bar: token("bar"),
      barText: token("bar-text"),
      barAccent: token("bar-accent"),
      bg: token("bg"),
      surface: token("surface"),
      border: token("border"),
      text: token("text"),
      muted: token("text-muted"),
      accent: token("accent"),
    });
  });
});

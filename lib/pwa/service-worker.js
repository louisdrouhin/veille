/* Veille service worker.
 *
 * Served at /sw.js by app/sw.js/route.ts, which prepends a version comment
 * (build id + this file's hash): every deploy changes the bytes, the browser
 * installs the new worker, and components/pwa/update-toast.tsx offers to reload.
 *
 * Strategies:
 *   - /_next/static, icons ............. cache-first (file names are content-hashed)
 *   - /api/image-proxy, /api/favicon ... cache-first (an image URL never changes)
 *     Cache-first refuses redirects, and anything but an image where one is expected.
 *     /apple-touch-icon*.png is not intercepted: iOS fetches it from the network.
 *   - pages kept offline (savablePath: . network-first, cached copy when offline,
 *     home, forums, topics)              else a generated « Hors ligne » page
 *   - other pages ...................... network only, « Hors ligne » page offline
 *   - everything else .................. not intercepted (network)
 * Never cached: non-GET requests (server actions, forms), Next router data (RSC),
 * cross-origin requests, NEVER_CACHE (auth, setup, admin, account, login) and
 * any page outside savablePath.
 *
 * Pages opened by client-side navigation never reach this worker as documents:
 * components/pwa/offline-page-cache.tsx posts { type: "cache-page" } and the page
 * is downloaded here, with its proxied images for a topic. Offline, the router's
 * data request fails, Next.js falls back to a full navigation, and that one is
 * answered from the cache.
 *
 * { type: "clear" } (logout, login page) deletes every cache; writes started
 * before it are dropped.
 */
"use strict";

const STATIC_CACHE = "veille-static";
const PAGES_CACHE = "veille-pages";
const IMAGES_CACHE = "veille-images";
const CACHE_LIMITS = { [STATIC_CACHE]: 400, [PAGES_CACHE]: 150, [IMAGES_CACHE]: 600 };

const NEVER_CACHE = ["/api/auth", "/api/health", "/setup", "/admin", "/login", "/compte", "/sw.js"];
/** Colors of app/globals.css, light and dark (checked by tests/service-worker.test.ts). */
const COLORS = { bar: "#1E3640", barText: "#F3F7F8", barAccent: "#7FC3DE", bg: "#F3F2EE", surface: "#FFFFFF", border: "#DCD9D1", text: "#1B1A17", muted: "#5C5952", accent: "#1C5B77", accentFg: "#FFFFFF" };
const COLORS_DARK = { bar: "#1C3039", barText: "#EEF3F5", barAccent: "#7FC3DE", bg: "#0F1214", surface: "#171B1E", border: "#2A3035", text: "#E7E5E0", muted: "#A8A59E", accent: "#6CB0CE", accentFg: "#0B1418" };
/** A page cached this recently is not downloaded again for a "cache-page" message. */
const FRESH_MS = 30_000;
const MAX_IMAGES_PER_TOPIC = 60;

let epoch = 0;
const cachedAt = new Map();

const isUnder = (pathname, prefix) => pathname === prefix || pathname.startsWith(prefix + "/");
const neverCached = (url) => NEVER_CACHE.some((p) => isUnder(url.pathname, p));
const isStaticAsset = (url) =>
  url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/") || url.pathname === "/icon.svg";
const isImage = (url) => url.pathname === "/api/image-proxy" || url.pathname.startsWith("/api/favicon/");
const isTopic = (url) => url.pathname.startsWith("/t/");

/**
 * The pages kept for offline reading — home, a forum's list (with its page number),
 * a topic — as a path rebuilt from validated parts; null for anything else. The
 * rest of the query is dropped (a cached copy must not replay a toast), and a URL
 * received in a message can only ever fetch one of these pages of our origin.
 */
function savablePath(href) {
  let url;
  try {
    url = new URL(href, self.location.origin);
  } catch {
    return null;
  }
  if (url.origin !== self.location.origin) return null;
  const m = /^\/(?:f\/([a-z0-9-]{1,60})|t\/([1-9][0-9]{0,14}))?$/.exec(url.pathname);
  if (!m) return null;
  if (m[2]) return `/t/${Number(m[2])}`;
  if (!m[1]) return "/";
  const page = Number(url.searchParams.get("page"));
  const query = Number.isInteger(page) && page > 1 && page < 10_000 ? `?page=${page}` : "";
  return `/f/${encodeURIComponent(m[1])}${query}`;
}

const pageKey = (path) => new URL(path, self.location.origin).href;

/** A complete page of ours: not an error, not a redirect (e.g. to /login once the session is gone). */
const isCacheablePage = (res) =>
  res.ok && res.type === "basic" && !res.redirected && (res.headers.get("content-type") || "").includes("text/html");

async function put(cacheName, key, response, startEpoch) {
  if (startEpoch !== epoch) return;
  const cache = await caches.open(cacheName);
  if (startEpoch !== epoch) return;
  await cache.put(key, response);
  const keys = await cache.keys();
  const excess = keys.length - CACHE_LIMITS[cacheName];
  // keys() is in insertion order, and put() moves an entry to the end: oldest first.
  for (let i = 0; i < excess; i++) await cache.delete(keys[i]);
}

/** Image files and image routes: what they return must be an image. */
const expectsImage = (url) => isImage(url) || /\.(?:png|svg|ico|webp|avif|jpe?g|gif)$/i.test(url.pathname);
const isImageResponse = (res) => (res.headers.get("content-type") || "").toLowerCase().startsWith("image/");

/**
 * Kept cache-first: a complete answer of ours, not a redirect (a file behind the login
 * would come back as the /login page) and, for an image, an image — never an HTML page
 * stored under an icon's URL.
 */
const isCacheableAsset = (res, url) =>
  res.ok && res.type === "basic" && !res.redirected && (!expectsImage(url) || isImageResponse(res));

async function cacheFirst(event, cacheName) {
  const url = new URL(event.request.url);
  const cache = await caches.open(cacheName);
  const cached = await cache.match(event.request, { ignoreVary: true });
  if (cached) {
    if (!expectsImage(url) || isImageResponse(cached)) return cached;
    await cache.delete(event.request, { ignoreVary: true }); // stored by an older version
  }
  const startEpoch = epoch;
  const res = await fetch(event.request);
  // A redirect, or a non-image where an image is expected: refused, the browser gets a
  // network error (as for a missing file) rather than the /login page.
  if (res.redirected || (res.ok && expectsImage(url) && !isImageResponse(res))) return Response.error();
  if (isCacheableAsset(res, url)) event.waitUntil(put(cacheName, event.request.url, res.clone(), startEpoch));
  return res;
}

async function storePage(path, res, startEpoch) {
  const key = pageKey(path);
  const html = path.startsWith("/t/") ? await res.clone().text() : null;
  await put(PAGES_CACHE, key, res, startEpoch);
  if (startEpoch === epoch) cachedAt.set(key, Date.now());
  if (html !== null) await cacheImages(html, startEpoch);
}

async function networkFirstPage(event, path) {
  const startEpoch = epoch;
  try {
    const res = await fetch(event.request);
    if (isCacheablePage(res)) event.waitUntil(storePage(path, res.clone(), startEpoch));
    return res;
  } catch {
    const cache = await caches.open(PAGES_CACHE);
    return (await cache.match(pageKey(path), { ignoreVary: true })) || offlinePage(cache);
  }
}

/** Other pages: never stored, never read from the cache; offline, the « Hors ligne » page. */
async function networkOnlyPage(event) {
  try {
    return await fetch(event.request);
  } catch {
    return offlinePage(await caches.open(PAGES_CACHE));
  }
}

/** Downloads a page (and a topic's proxied images) so that it can be read offline. */
async function cachePage(href) {
  const path = savablePath(href);
  if (path === null) return;
  if (Date.now() - (cachedAt.get(pageKey(path)) || 0) < FRESH_MS) return;
  const startEpoch = epoch;
  let res;
  try {
    res = await fetch(path, { credentials: "same-origin", headers: { accept: "text/html" } });
  } catch {
    return; // offline: keep the copy we have
  }
  if (isCacheablePage(res)) await storePage(path, res, startEpoch);
}

/** Images of the reading mode and favicons referenced by a topic page. */
async function cacheImages(html, startEpoch) {
  const srcs = new Set();
  for (const m of html.matchAll(/\ssrc="(\/api\/(?:image-proxy\?|favicon\/)[^"]*)"/g)) {
    srcs.add(m[1].replace(/&amp;/g, "&"));
    if (srcs.size >= MAX_IMAGES_PER_TOPIC) break;
  }
  const cache = await caches.open(IMAGES_CACHE);
  await Promise.all(
    [...srcs].map(async (src) => {
      const href = new URL(src, self.location.origin).href;
      if (await cache.match(href)) return;
      try {
        const res = await fetch(href, { credentials: "same-origin" });
        if (isCacheableAsset(res, new URL(href))) await put(IMAGES_CACHE, href, res, startEpoch);
      } catch {
        // offline or failed: the page still reads without it
      }
    }),
  );
}

async function clearAll() {
  epoch++;
  cachedAt.clear();
  const keys = await caches.keys();
  await Promise.all(keys.map((k) => caches.delete(k)));
}

// ---------------------------------------------------------------- offline page

const escapeHtml = (s) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const decodeEntities = (s) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&");

/** Topics available offline, most recently saved first. */
async function savedTopics(cache) {
  const topics = [];
  for (const req of (await cache.keys()).reverse()) {
    const url = new URL(req.url);
    if (!isTopic(url) || topics.length >= 50) continue;
    const res = await cache.match(req);
    const title = res && /<title>([^<]*)<\/title>/.exec(await res.text());
    topics.push({ href: url.pathname + url.search, title: title ? decodeEntities(title[1]).replace(/ · (?:Folders|Veille)$/, "") : url.pathname });
  }
  return topics;
}

const LOGO =
  '<svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true"><rect width="26" height="26" rx="5" fill="' + COLORS.barAccent + '"/>' +
  '<path d="M5 9c0-.83.67-1.5 1.5-1.5h4.1c.4 0 .78.16 1.06.44L13 9.25h6.5c.83 0 1.5.67 1.5 1.5V18.5c0 .83-.67 1.5-1.5 1.5h-13c-.83 0-1.5-.67-1.5-1.5z" fill="' + COLORS.bar + '"/>' +
  '<path d="M8.5 16.5a4 4 0 0 1 4-4M8.5 13.75a1.25 1.25 0 0 1 1.25-1.25" stroke="' + COLORS.barAccent + '" stroke-width="1.6" fill="none" stroke-linecap="round"/>' +
  '<circle cx="9" cy="16" r="1" fill="' + COLORS.barAccent + '"/></svg>';

async function offlinePage(cache) {
  const topics = await savedTopics(cache);
  const home = await cache.match(new URL("/", self.location.origin).href);
  const list = topics.length
    ? `<ul>${topics.map((t) => `<li><a href="${escapeHtml(t.href)}">${escapeHtml(t.title)}</a></li>`).join("")}</ul>`
    : "<p class=\"muted\">Aucun topic enregistré pour l'instant : ceux que tu ouvres sont gardés pour la lecture hors ligne.</p>";
  const c = COLORS;
  const d = COLORS_DARK;
  // Generated by the worker, without the theme cookie: follows the device's setting.
  const html = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" media="(prefers-color-scheme: light)" content="${c.bar}">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="${d.bar}">
<title>Hors ligne · Folders</title>
<style>
*{box-sizing:border-box}
body{margin:0;background:${c.bg};color:${c.text};font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;padding-bottom:env(safe-area-inset-bottom)}
header{background:${c.bar};color:${c.barText};padding:env(safe-area-inset-top) max(14px,env(safe-area-inset-right)) 0 max(14px,env(safe-area-inset-left))}
header div{display:flex;align-items:center;gap:8px;min-height:52px;font-weight:700;font-size:21px;max-width:1200px;margin:0 auto}
main{max-width:720px;margin:0 auto;padding:16px max(14px,env(safe-area-inset-right)) 16px max(14px,env(safe-area-inset-left))}
section{background:${c.surface};border:1px solid ${c.border};border-radius:6px;padding:16px;margin-bottom:12px}
h1{font-size:20px;margin:0 0 6px}h2{font-size:15px;margin:0 0 8px}p{margin:0 0 12px}
a{color:${c.accent}}.muted{color:${c.muted};font-size:14px}
.btn{display:inline-flex;align-items:center;min-height:44px;padding:0 16px;border-radius:4px;background:${c.accent};color:${c.accentFg};font-weight:600;text-decoration:none}
ul{margin:0;padding:0;list-style:none}li{border-top:1px solid ${c.border}}li:first-child{border-top:0}
li a{display:block;padding:10px 0;min-height:44px}
@media (prefers-color-scheme:dark){body{background:${d.bg};color:${d.text}}header{background:${d.bar};color:${d.barText}}
section{background:${d.surface};border-color:${d.border}}a{color:${d.accent}}.muted{color:${d.muted}}
.btn{background:${d.accent};color:${d.accentFg}}li{border-color:${d.border}}}
</style></head>
<body><header><div>${LOGO}<span>Folders</span></div></header>
<main>
<section><h1>Hors ligne</h1>
<p>Pas de connexion, et cette page n'a pas été enregistrée pour la lecture hors ligne.</p>
<p><a class="btn" href="">Réessayer</a>${home ? ' &nbsp; <a href="/">Forums (copie hors ligne)</a>' : ""}</p></section>
<section><h2>Disponible hors ligne</h2>${list}</section>
</main></body></html>`;
  return new Response(html, {
    status: 503,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    },
  });
}

// ---------------------------------------------------------------- events

self.addEventListener("install", () => {
  // Nothing to precache: the offline page is generated. No skipWaiting(): an
  // update waits for the user's « Recharger » (message "skip-waiting").
});

self.addEventListener("activate", (event) => {
  const known = new Set(Object.keys(CACHE_LIMITS));
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !known.has(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (neverCached(url)) {
    if (req.mode === "navigate") event.respondWith(networkOnlyPage(event));
    return;
  }
  // Next.js router data (RSC): depends on the client's router state, never cached.
  if (req.headers.get("rsc") || url.searchParams.has("_rsc")) return;
  if (req.mode === "navigate") {
    const path = savablePath(url.href);
    return event.respondWith(path === null ? networkOnlyPage(event) : networkFirstPage(event, path));
  }
  if (isStaticAsset(url)) return event.respondWith(cacheFirst(event, STATIC_CACHE));
  if (isImage(url)) return event.respondWith(cacheFirst(event, IMAGES_CACHE));
});

self.addEventListener("message", (event) => {
  // A worker only hears from pages of its own origin; checked all the same.
  if (event.origin !== self.location.origin) return;
  const data = event.data || {};
  if (data.type === "skip-waiting") self.skipWaiting();
  else if (data.type === "cache-page" && typeof data.url === "string") event.waitUntil(cachePage(data.url));
  else if (data.type === "clear") event.waitUntil(clearAll());
});

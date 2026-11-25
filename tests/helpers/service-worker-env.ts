/**
 * Runs lib/pwa/service-worker.js in a fake worker global scope: in-memory Cache
 * Storage, a scripted fetch() that can be switched offline, and events that
 * record respondWith / waitUntil.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

export const ORIGIN = "https://veille.test";
export const SW_SOURCE = readFileSync(path.join(import.meta.dirname, "..", "..", "lib", "pwa", "service-worker.js"), "utf8");

type FakeRequest = { url: string; method: string; mode: string; headers: Headers };
type RequestLike = string | { url: string };
const keyOf = (r: RequestLike) => new URL(typeof r === "string" ? r : r.url, ORIGIN).href;

class FakeCache {
  readonly entries = new Map<string, { body: ArrayBuffer; status: number; headers: [string, string][] }>();
  async match(req: RequestLike) {
    const e = this.entries.get(keyOf(req));
    return e && new Response(e.body.slice(0), { status: e.status, headers: e.headers });
  }
  async put(req: RequestLike, res: Response) {
    const key = keyOf(req);
    const body = await res.arrayBuffer();
    this.entries.delete(key); // like the real thing: a new put goes to the end
    this.entries.set(key, { body, status: res.status, headers: [...res.headers] });
  }
  async keys() {
    return [...this.entries.keys()].map((url) => ({ url }));
  }
  async delete(req: RequestLike) {
    return this.entries.delete(keyOf(req));
  }
}

export class FakeCacheStorage {
  readonly stores = new Map<string, FakeCache>();
  async open(name: string) {
    if (!this.stores.has(name)) this.stores.set(name, new FakeCache());
    return this.stores.get(name)!;
  }
  async keys() {
    return [...this.stores.keys()];
  }
  async delete(name: string) {
    return this.stores.delete(name);
  }
  /** Cached URLs (paths + query) of one cache, oldest first. */
  paths(name: string): string[] {
    return [...(this.stores.get(name)?.entries.keys() ?? [])].map((u) => new URL(u).pathname + new URL(u).search);
  }
}

/** A same-origin response as fetch() returns it ("basic"), possibly after a redirect. */
export function basic(body: string, init: ResponseInit & { redirected?: boolean } = {}): Response {
  const res = new Response(body, init);
  Object.defineProperty(res, "type", { value: "basic" });
  Object.defineProperty(res, "redirected", { value: init.redirected ?? false });
  return res;
}

export const png = (body: string, init: ResponseInit & { redirected?: boolean } = {}) =>
  basic(body, { ...init, headers: { "content-type": "image/png", ...init.headers } });

export const html = (title: string, body = "") =>
  basic(`<!DOCTYPE html><html><head><title>${title}</title></head><body>${body}</body></html>`, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });

type Listener = (event: unknown) => void;

export function loadServiceWorker() {
  const listeners = new Map<string, Listener[]>();
  const caches = new FakeCacheStorage();
  const network = { online: true, calls: [] as string[], routes: new Map<string, () => Response>() };
  const fetch = async (input: RequestLike) => {
    const url = keyOf(input);
    network.calls.push(new URL(url).pathname + new URL(url).search);
    if (!network.online) throw new TypeError("Failed to fetch");
    const route = network.routes.get(new URL(url).pathname + new URL(url).search) ?? network.routes.get(new URL(url).pathname);
    return route ? route() : basic("not found", { status: 404 });
  };
  const self = {
    location: new URL(ORIGIN + "/sw.js"),
    clients: {
      claim: async () => {},
      windows: [] as { url: string; focused: boolean; navigatedTo?: string }[],
      opened: [] as string[],
      async matchAll() {
        return this.windows.map((w) => ({
          url: w.url,
          focus: async () => {
            w.focused = true;
            return undefined;
          },
          navigate: async (u: string) => {
            w.navigatedTo = u;
          },
        }));
      },
      async openWindow(u: string) {
        this.opened.push(u);
      },
    },
    registration: {
      shown: [] as { title: string; options: Record<string, unknown> }[],
      async showNotification(title: string, options: Record<string, unknown>) {
        this.shown.push({ title, options });
      },
    },
    skipWaitingCalls: 0,
    skipWaiting() {
      this.skipWaitingCalls++;
    },
    addEventListener(type: string, fn: Listener) {
      listeners.set(type, [...(listeners.get(type) ?? []), fn]);
    },
  };
  new Function("self", "caches", "fetch", SW_SOURCE)(self, caches, fetch);

  /** Dispatches an event, then waits for its response and every waitUntil (including nested ones). */
  async function dispatch(type: string, fields: object): Promise<Response | undefined> {
    const waits: Promise<unknown>[] = [];
    let response: Promise<Response> | undefined;
    const event = {
      ...fields,
      respondWith: (p: Promise<Response>) => (response = p),
      waitUntil: (p: Promise<unknown>) => waits.push(p),
    };
    for (const fn of listeners.get(type) ?? []) fn(event);
    const res = await response;
    for (let done = 0; done < waits.length; done++) await waits[done];
    return res;
  }

  const request = (pathOrUrl: string, init: { mode?: string; method?: string; headers?: Record<string, string> } = {}): FakeRequest => ({
    url: new URL(pathOrUrl, ORIGIN).href,
    method: init.method ?? "GET",
    mode: init.mode ?? "cors",
    headers: new Headers(init.headers),
  });

  return {
    self,
    caches,
    network,
    /** Undefined: the worker left the request to the network. */
    fetchEvent: (path: string, init?: Parameters<typeof request>[1]) => dispatch("fetch", { request: request(path, init) }),
    navigate: (path: string) => dispatch("fetch", { request: request(path, { mode: "navigate" }) }),
    message: (data: unknown, origin = ORIGIN) => dispatch("message", { data, origin }),
    activate: () => dispatch("activate", {}),
    /** A push message with this JSON payload (or raw text). */
    push: (payload: unknown) =>
      dispatch("push", { data: { json: () => (typeof payload === "string" ? JSON.parse(payload) : payload) } }),
    notificationClick: (data: unknown) => {
      const notification = { data, closed: false, close() { this.closed = true; } };
      return dispatch("notificationclick", { notification }).then(() => notification);
    },
  };
}

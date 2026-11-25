/** Fake network for the Ma stack sources: answers by URL, records the requests. */
import { readFileSync } from "node:fs";
import path from "node:path";

export const fixture = (name: string) => readFileSync(path.join(import.meta.dirname, "..", "fixtures", "stack", name), "utf8");

export type Route = (url: URL, init: RequestInit) => Response | Promise<Response> | null | undefined;

export function fakeNet(routes: Route[]) {
  const calls: { url: string; headers: Record<string, string>; method: string }[] = [];
  const fetchImpl = (async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ url: url.href, headers: Object.fromEntries(new Headers(init.headers).entries()), method: init.method ?? "GET" });
    for (const r of routes) {
      const res = await r(url, init);
      if (res) return res;
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  // Every host resolves to a public address (the SSRF checks themselves are tested in safe-fetch.test.ts).
  const resolve = async () => [{ address: "93.184.216.34", family: 4 }];
  return { fetchImpl, resolve, calls, sleep: async () => {} };
}

export const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
export const xml = (text: string) => new Response(text, { status: 200, headers: { "content-type": "application/rss+xml" } });

/** An NVD page with these CVEs. */
export const nvdPage = (cves: unknown[]) => json({ resultsPerPage: cves.length, startIndex: 0, totalResults: cves.length, vulnerabilities: cves.map((cve) => ({ cve })) });

/** A minimal NVD CVE for `cpe` (vendor:product), with one range. */
export function nvdCve(id: string, cpe: string, range: Record<string, string>, opts: { score?: number; exploited?: boolean; description?: string } = {}) {
  return {
    id,
    vulnStatus: "Analyzed",
    published: "2026-11-02T10:00:00.000",
    lastModified: "2026-11-20T10:00:00.000",
    descriptions: [{ lang: "en", value: opts.description ?? `A flaw in the product allows remote attackers to do things (${id}).` }],
    metrics: opts.score === undefined ? {} : { cvssMetricV31: [{ type: "Primary", cvssData: { baseScore: opts.score } }] },
    ...(opts.exploited ? { cisaExploitAdd: "2026-11-10" } : {}),
    configurations: [{ nodes: [{ operator: "OR", cpeMatch: [{ vulnerable: true, criteria: `${cpe}:*:*:*:*:*:*:*:*`, ...range }] }] }],
    references: [],
  };
}

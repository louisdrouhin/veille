/**
 * NVD, CVE API 2.0: the CVEs of a product, found by its CPE prefix (virtualMatchString), with their
 * affected ranges for that product. NVD_API_KEY (optional, server .env) raises the quota from 5 to 50
 * requests per 30 s; without it, requests are spaced by 6.5 s.
 * Also the CPE dictionary search of the « Ajouter un logiciel » sheet (products not in the catalog).
 */
import type { AffectedRange } from "@/lib/db/schema";
import { nvdVersion } from "../versions";
import { cleanText, CVE_ID, getFrom, httpsUrl, parseJson, severityOf, SourceError, type FetchedVuln, type SourceDeps } from "./types";

export const NVD_API = "https://services.nvd.nist.gov/rest/json";
const PAGE_SIZE = 500;
const MAX_PAGES = 40;
/** The API refuses a lastMod window longer than 120 days: beyond it, everything is fetched again. */
export const NVD_MAX_WINDOW_DAYS = 119;

type CpeMatch = {
  vulnerable?: boolean;
  criteria?: string;
  versionStartIncluding?: string;
  versionStartExcluding?: string;
  versionEndIncluding?: string;
  versionEndExcluding?: string;
};
type Metric = { type?: string; cvssData?: { baseScore?: number } };
export type NvdCve = {
  id?: string;
  vulnStatus?: string;
  cveTags?: { tags?: string[] }[];
  published?: string;
  lastModified?: string;
  descriptions?: { lang?: string; value?: string }[];
  metrics?: Record<string, Metric[] | undefined>;
  cisaExploitAdd?: string;
  configurations?: { nodes?: { cpeMatch?: CpeMatch[] }[] }[];
  references?: { url?: string; tags?: string[] }[];
};
type NvdPage = { totalResults?: number; resultsPerPage?: number; startIndex?: number; vulnerabilities?: { cve?: NvdCve }[] };

export const CPE_PREFIX = /^cpe:2\.3:[aoh]:[a-z0-9_\-.!~%\\&]+:[a-z0-9_\-.!~%\\&]+$/i;

/** Splits a CPE 2.3 string on unescaped colons. */
function cpeParts(cpe: string): string[] {
  return cpe.split(/(?<!\\):/);
}

function score(cve: NvdCve): number | null {
  for (const key of ["cvssMetricV40", "cvssMetricV31", "cvssMetricV30", "cvssMetricV2"]) {
    const list = cve.metrics?.[key];
    if (!list?.length) continue;
    const m = list.find((x) => x.type === "Primary") ?? list[0];
    const s = m?.cvssData?.baseScore;
    if (typeof s === "number" && Number.isFinite(s)) return Math.round(s * 10) / 10;
  }
  return null;
}

/** The ranges of `cpePrefix` in the CVE's configurations (vulnerable matches only). */
export function nvdRanges(cve: NvdCve, cpePrefix: string): AffectedRange[] {
  const prefix = cpeParts(cpePrefix.toLowerCase());
  const out: AffectedRange[] = [];
  const seen = new Set<string>();
  for (const conf of cve.configurations ?? []) {
    for (const node of conf.nodes ?? []) {
      for (const m of node.cpeMatch ?? []) {
        if (!m.vulnerable || typeof m.criteria !== "string") continue;
        const parts = cpeParts(m.criteria);
        if (parts.length < 7 || prefix.some((p, i) => parts[i]!.toLowerCase() !== p)) continue;
        const version = parts[5]!.replace(/\\/g, "");
        const update = parts[6]!.replace(/\\/g, "");
        let range: AffectedRange;
        if (version !== "*" && version !== "-") {
          range = { exact: nvdVersion(version, update), ...(update === "*" ? { anyUpdate: true } : {}), src: "nvd" };
        } else {
          range = { src: "nvd" };
          if (m.versionStartIncluding) Object.assign(range, { start: m.versionStartIncluding, startIncluding: true });
          else if (m.versionStartExcluding) Object.assign(range, { start: m.versionStartExcluding, startIncluding: false });
          if (m.versionEndIncluding) Object.assign(range, { end: m.versionEndIncluding, endIncluding: true });
          else if (m.versionEndExcluding) Object.assign(range, { end: m.versionEndExcluding, endIncluding: false });
        }
        const key = JSON.stringify(range);
        if (!seen.has(key)) {
          seen.add(key);
          out.push(range);
        }
      }
    }
  }
  return out;
}

/** One NVD CVE for one product; null when rejected, disputed or without a range for this product. */
export function parseNvdCve(cve: NvdCve, cpePrefix: string): FetchedVuln | null {
  const id = typeof cve.id === "string" ? cve.id.trim() : "";
  if (!CVE_ID.test(id)) return null;
  if (/^rejected$/i.test(cve.vulnStatus ?? "")) return null;
  if (cve.cveTags?.some((t) => t.tags?.includes("disputed"))) return null;
  const ranges = nvdRanges(cve, cpePrefix);
  if (ranges.length === 0) return null;
  const s = score(cve);
  const vendorRefs = (cve.references ?? [])
    .filter((r) => r.tags?.includes("Vendor Advisory"))
    .map((r) => httpsUrl(r.url))
    .filter((u): u is string => u !== null)
    .slice(0, 2);
  return {
    ref: id,
    cveId: id,
    descriptionEn: cleanText(cve.descriptions?.find((d) => d.lang === "en")?.value, 4000),
    cvss: s,
    severity: severityOf(s),
    exploited: typeof cve.cisaExploitAdd === "string" && cve.cisaExploitAdd.length > 0,
    publishedAt: utc(cve.published),
    updatedAt: utc(cve.lastModified ?? cve.published),
    sources: [
      { kind: "nvd", ref: id, url: `https://nvd.nist.gov/vuln/detail/${id}` },
      ...vendorRefs.map((url) => ({ kind: "vendor" as const, ref: new URL(url).hostname, url })),
    ],
    ranges,
  };
}

/** NVD dates have no zone and are UTC (« 2024-07-01T13:15:06.467 »). */
function utc(s: string | undefined): Date {
  const d = new Date(s && !/(?:Z|[+-]dd:dd)$/.test(s) ? `${s}Z` : (s ?? ""));
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

const nvdDate = (d: Date) => d.toISOString().replace("Z", "+00:00");
const pause = (deps: SourceDeps) => (deps.env?.NVD_API_KEY ? 700 : 6500);

/**
 * Every CVE of the product, or those modified since `since` (if within 119 days). Rejected CVEs
 * come back in `rejected`, to drop their ranges. Throws SourceError when NVD does not answer.
 */
export async function fetchNvd(
  cpePrefix: string,
  deps: SourceDeps,
  opts: { since?: Date | null; now?: Date } = {},
): Promise<{ vulns: FetchedVuln[]; rejected: string[] }> {
  if (!CPE_PREFIX.test(cpePrefix)) throw new SourceError("nvd", "CPE invalide");
  const now = opts.now ?? new Date();
  const incremental = opts.since && now.getTime() - opts.since.getTime() < NVD_MAX_WINDOW_DAYS * 86_400_000;
  const key = deps.env?.NVD_API_KEY?.trim();
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const vulns: FetchedVuln[] = [];
  const rejected: string[] = [];
  for (let page = 0, start = 0; page < MAX_PAGES; page++) {
    if (page > 0) await sleep(pause(deps));
    const params = new URLSearchParams({ virtualMatchString: cpePrefix, resultsPerPage: String(PAGE_SIZE), startIndex: String(start) });
    if (incremental) {
      params.set("lastModStartDate", nvdDate(new Date(opts.since!.getTime() - 3_600_000)));
      params.set("lastModEndDate", nvdDate(now));
    }
    const res = await getFrom("nvd", `${NVD_API}/cves/2.0?${params}`, deps, {
      headers: key ? { apiKey: key } : undefined,
      maxBytes: 64 * 1024 * 1024,
      timeoutMs: 90_000,
    });
    const data = parseJson<NvdPage>("nvd", res.text);
    const list = data.vulnerabilities ?? [];
    for (const { cve } of list) {
      if (!cve) continue;
      const v = parseNvdCve(cve, cpePrefix);
      if (v) vulns.push(v);
      else if (typeof cve.id === "string" && /^rejected$/i.test(cve.vulnStatus ?? "")) rejected.push(cve.id);
    }
    start += list.length;
    if (list.length === 0 || start >= (data.totalResults ?? 0)) break;
  }
  return { vulns, rejected };
}

export type CpeCandidate = { cpePrefix: string; name: string; vendor: string };

const humanize = (s: string) =>
  s
    .replace(/\\(.)/g, "$1")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

/** The NVD CPE dictionary, by keyword: one candidate per vendor:product (at most 10). */
export async function searchCpe(query: string, deps: SourceDeps): Promise<CpeCandidate[]> {
  const q = query.trim().slice(0, 60);
  if (q.length < 2) return [];
  const key = deps.env?.NVD_API_KEY?.trim();
  const params = new URLSearchParams({ keywordSearch: q, resultsPerPage: "200" });
  const res = await getFrom("nvd", `${NVD_API}/cpes/2.0?${params}`, deps, { headers: key ? { apiKey: key } : undefined, timeoutMs: 30_000 });
  const data = parseJson<{ products?: { cpe?: { cpeName?: string; deprecated?: boolean; titles?: { title?: string; lang?: string }[] } }[] }>("nvd", res.text);
  const found = new Map<string, CpeCandidate>();
  for (const p of data.products ?? []) {
    const name = p.cpe?.cpeName;
    if (typeof name !== "string" || p.cpe?.deprecated) continue;
    const parts = cpeParts(name);
    if (parts.length < 5 || parts[2] === "h") continue; // hardware: no version to compare
    const prefix = parts.slice(0, 5).join(":");
    if (!CPE_PREFIX.test(prefix) || found.has(prefix)) continue;
    found.set(prefix, { cpePrefix: prefix, name: humanize(parts[4]!), vendor: humanize(parts[3]!) });
    if (found.size >= 10) break;
  }
  return [...found.values()];
}

/**
 * GitHub: a repository's published security advisories (vulnerabilities without a CPE, or before
 * NVD has analysed them) and its releases (« Mise à jour disponible », recent versions of the add
 * sheet). Anonymous: 60 requests per hour; GITHUB_TOKEN (optional, read-only) raises it.
 */
import type { AffectedRange, Severity, VersionScheme } from "@/lib/db/schema";
import { parseVersion, sortVersionsDesc } from "../versions";
import { cleanText, CVE_ID, getFrom, httpsUrl, parseJson, severityOf, type FetchedVuln, type SourceDeps } from "./types";

export const GITHUB_API = "https://api.github.com";
export const GITHUB_REPO = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;

function headers(deps: SourceDeps): Record<string, string> {
  const token = deps.env?.GITHUB_TOKEN?.trim();
  return { "X-GitHub-Api-Version": "2022-11-28", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

type Advisory = {
  ghsa_id?: string;
  cve_id?: string | null;
  html_url?: string;
  summary?: string;
  description?: string;
  severity?: string;
  state?: string;
  published_at?: string;
  updated_at?: string;
  withdrawn_at?: string | null;
  cvss?: { score?: number | null } | null;
  cvss_severities?: { cvss_v3?: { score?: number | null }; cvss_v4?: { score?: number | null } } | null;
  vulnerabilities?: { vulnerable_version_range?: string | null; patched_versions?: string | null }[];
};

/**
 * « < 1.2.3 », « >= 1.0, < 1.2 », « <= 1.37.3 », « = 1.0.0 » → one range; null when unreadable.
 * `fixed`: the first patched version, kept for « corrigé en ».
 */
export function githubRange(spec: string, patched: string | null | undefined): AffectedRange | null {
  const range: AffectedRange = { src: "github" };
  const parts = spec.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0 || parts.length > 2) return null;
  for (const part of parts) {
    const m = /^(<=|>=|<|>|=)?\s*v?([0-9][^\s,]*)$/.exec(part);
    if (!m) return null;
    const [, op = "=", version] = m;
    if (op === "=") range.exact = version;
    else if (op === ">=" || op === ">") Object.assign(range, { start: version, startIncluding: op === ">=" });
    else Object.assign(range, { end: version, endIncluding: op === "<=" });
  }
  const fix = patched?.split(",")[0]?.trim().replace(/^v(?=\d)/, "");
  if (fix && /^[0-9][\w.+-]*$/.test(fix)) range.fixed = fix;
  return range;
}

const SEVERITY: Record<string, Severity> = { critical: "critical", high: "high", medium: "medium", moderate: "medium", low: "low" };

export function parseAdvisory(a: Advisory): FetchedVuln | null {
  if (a.state && a.state !== "published") return null;
  if (a.withdrawn_at) return null;
  const ghsa = typeof a.ghsa_id === "string" && /^GHSA(-[23456789cfghjmpqrvwx]{4}){3}$/.test(a.ghsa_id) ? a.ghsa_id : null;
  if (!ghsa) return null;
  const cve = typeof a.cve_id === "string" && CVE_ID.test(a.cve_id) ? a.cve_id : null;
  const ranges = (a.vulnerabilities ?? [])
    .map((v) => (v.vulnerable_version_range ? githubRange(v.vulnerable_version_range, v.patched_versions) : null))
    .filter((r): r is AffectedRange => r !== null);
  if (ranges.length === 0) return null;
  const raw = a.cvss_severities?.cvss_v4?.score ?? a.cvss_severities?.cvss_v3?.score ?? a.cvss?.score ?? null;
  const score = typeof raw === "number" && raw > 0 ? Math.round(raw * 10) / 10 : null;
  const url = httpsUrl(a.html_url);
  const published = new Date(a.published_at ?? "");
  const updated = new Date(a.updated_at ?? a.published_at ?? "");
  return {
    ref: cve ?? ghsa,
    cveId: cve,
    descriptionEn: cleanText(`${a.summary ?? ""}\n\n${a.description ?? ""}`, 4000),
    cvss: score,
    severity: severityOf(score) ?? SEVERITY[(a.severity ?? "").toLowerCase()] ?? null,
    exploited: false,
    publishedAt: Number.isNaN(published.getTime()) ? new Date() : published,
    updatedAt: Number.isNaN(updated.getTime()) ? new Date() : updated,
    sources: url && url.startsWith("https://github.com/") ? [{ kind: "github", ref: ghsa, url }] : [],
    ranges,
  };
}

export async function fetchGithubAdvisories(repo: string, deps: SourceDeps): Promise<FetchedVuln[]> {
  if (!GITHUB_REPO.test(repo)) return [];
  const res = await getFrom("github", `${GITHUB_API}/repos/${repo}/security-advisories?state=published&per_page=100`, deps, {
    accept: "application/vnd.github+json",
    headers: headers(deps),
    allow404: true,
  });
  if (res.status === 404) return [];
  const list = parseJson<Advisory[]>("github", res.text);
  return Array.isArray(list) ? list.map(parseAdvisory).filter((v): v is FetchedVuln => v !== null) : [];
}

/** Stable releases, newest first (tags « v1.2.3 » → « 1.2.3 »; those the scheme cannot read are skipped). */
export async function fetchGithubReleases(repo: string, scheme: VersionScheme, deps: SourceDeps): Promise<string[]> {
  if (!GITHUB_REPO.test(repo)) return [];
  const res = await getFrom("github", `${GITHUB_API}/repos/${repo}/releases?per_page=30`, deps, {
    accept: "application/vnd.github+json",
    headers: headers(deps),
    allow404: true,
  });
  if (res.status === 404) return [];
  const list = parseJson<{ tag_name?: string; draft?: boolean; prerelease?: boolean }[]>("github", res.text);
  if (!Array.isArray(list)) return [];
  const tags = list
    .filter((r) => !r.draft && !r.prerelease && typeof r.tag_name === "string")
    .map((r) => r.tag_name!.trim().replace(/^v(?=\d)/, ""))
    .filter((t) => t.length <= 32 && parseVersion(t, scheme) !== null);
  return sortVersionsDesc([...new Set(tags)], scheme);
}

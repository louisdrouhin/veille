import type { AffectedRange, Severity, VulnSource } from "@/lib/db/schema";
import { readLimited, safeFetch, SsrfError, type Resolver } from "@/lib/net/safe-fetch";

/** A vulnerability as one source sees it, for one product. Texts are untrusted (plain text only). */
export type FetchedVuln = {
  /** CVE-… when there is one, else the source's own id (GHSA-…). */
  ref: string;
  cveId: string | null;
  descriptionEn: string;
  cvss: number | null;
  severity: Severity | null;
  exploited: boolean;
  publishedAt: Date;
  updatedAt: Date;
  sources: VulnSource[];
  ranges: AffectedRange[];
};

export type SourceName = "nvd" | "github" | "certfr";

/** What the sources need: injected in tests, real network otherwise. */
export type SourceDeps = {
  fetchImpl?: typeof fetch;
  resolve?: Resolver;
  sleep?: (ms: number) => Promise<void>;
  env?: Partial<Record<string, string | undefined>>;
};

export class SourceError extends Error {
  constructor(
    readonly source: SourceName,
    message: string,
  ) {
    super(message);
    this.name = "SourceError";
  }
}

export const USER_AGENT = "Folders/3 (self-hosted vulnerability radar)";

/**
 * GET through safe-fetch (public addresses only, redirects re-checked), JSON or text. A 304 gives
 * null. Errors never carry the URL: it names a product of the stack (no inventory in the logs).
 */
export async function getFrom(
  source: SourceName,
  url: string,
  deps: SourceDeps,
  opts: { headers?: Record<string, string>; accept?: string; maxBytes?: number; timeoutMs?: number; allow404?: boolean } = {},
): Promise<{ status: number; text: string | null; headers: Headers }> {
  let res: Response;
  try {
    res = await safeFetch(url, {
      accept: opts.accept ?? "application/json",
      userAgent: USER_AGENT,
      timeoutMs: opts.timeoutMs ?? 30_000,
      headers: opts.headers,
      fetchImpl: deps.fetchImpl,
      resolve: deps.resolve,
    });
  } catch (err) {
    const name = (err as Error)?.name;
    throw new SourceError(source, err instanceof SsrfError ? "adresse refusée" : name === "TimeoutError" ? "délai dépassé" : "injoignable");
  }
  if (res.status === 304) {
    await res.body?.cancel().catch(() => {});
    return { status: 304, text: null, headers: res.headers };
  }
  if (res.status === 404 && opts.allow404) {
    await res.body?.cancel().catch(() => {});
    return { status: 404, text: null, headers: res.headers };
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw new SourceError(source, `HTTP ${res.status}`);
  }
  const body = await readLimited(res, opts.maxBytes ?? 8 * 1024 * 1024);
  if (body === null) throw new SourceError(source, "réponse trop volumineuse");
  return { status: res.status, text: new TextDecoder().decode(body), headers: res.headers };
}

export function parseJson<T>(source: SourceName, text: string | null): T {
  try {
    return JSON.parse(text ?? "") as T;
  } catch {
    throw new SourceError(source, "réponse illisible");
  }
}

/** CVSS base score → severity (CVSS v3/v4 rating scale). */
export function severityOf(score: number | null): Severity | null {
  if (score === null || !Number.isFinite(score) || score <= 0) return null;
  if (score >= 9) return "critical";
  if (score >= 7) return "high";
  if (score >= 4) return "medium";
  return "low";
}

/** Plain text, without control characters, cut to `max`. */
export function cleanText(s: unknown, max: number): string {
  if (typeof s !== "string") return "";
  const t = s.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** An https URL, or null. */
export function httpsUrl(s: unknown): string | null {
  if (typeof s !== "string" || s.length > 500) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

export const CVE_ID = /^CVE-\d{4}-\d{4,7}$/;

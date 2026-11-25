/**
 * CERT-FR (cert.cyber.gouv.fr, formerly cert.ssi.gouv.fr): the avis and alerte feeds, then each new
 * advisory's JSON (title, summary, solution, CVEs). Its French texts replace a generated summary;
 * an alerte, or an advisory saying the flaw is exploited, marks it « exploitée ».
 * Only the reference is taken from the feed (CERTFR-2026-AVI-1547): the JSON URL is rebuilt from it.
 */
import { cleanText, CVE_ID, getFrom, parseJson, type SourceDeps } from "./types";

export const CERTFR_BASE = "https://www.cert.cyber.gouv.fr";
export const CERTFR_FEEDS = { avis: `${CERTFR_BASE}/avis/feed/`, alerte: `${CERTFR_BASE}/alerte/feed/` } as const;
const REF = /CERTFR-(\d{4})-(AVI|ALE)-(\d{1,5})/;

export type CertfrKind = keyof typeof CERTFR_FEEDS;
export type FeedEntry = { ref: string; kind: CertfrKind; feedTitle: string };
export type CertfrAdvisory = {
  ref: string;
  kind: CertfrKind;
  title: string;
  summary: string;
  solution: string;
  cves: string[];
  exploited: boolean;
  url: string;
};

const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&");

/** The entries of a feed: reference and title only. */
export function parseCertfrFeed(xml: string, kind: CertfrKind): FeedEntry[] {
  const out: FeedEntry[] = [];
  for (const item of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const body = item[1]!;
    const link = /<link>([\s\S]*?)<\/link>/.exec(body)?.[1] ?? "";
    const ref = REF.exec(link)?.[0];
    if (!ref || (kind === "avis") !== ref.includes("-AVI-")) continue;
    const title = cleanText(decode(/<title>([\s\S]*?)<\/title>/.exec(body)?.[1] ?? ""), 300);
    out.push({ ref, kind, feedTitle: title });
    if (out.length >= 100) break;
  }
  return out;
}

export async function fetchCertfrFeed(kind: CertfrKind, deps: SourceDeps): Promise<FeedEntry[]> {
  const res = await getFrom("certfr", CERTFR_FEEDS[kind], deps, { accept: "application/rss+xml, application/xml", maxBytes: 4 * 1024 * 1024 });
  return parseCertfrFeed(res.text ?? "", kind);
}

/** « est activement exploitée », « sont exploitées », « exploitation active » — not « n'est pas exploitée ». */
const EXPLOITED = /(?<!n['’])(?<!\bpas\s)\b(?:est|sont|a été|ont été)\s+(?:activement\s+)?exploitée?s?\b|exploitation\s+active|activement\s+exploitée?s?/i;
const NOT_EXPLOITED = /(?:n['’](?:est|ont|a)\s+pas\s+(?:été\s+)?(?:activement\s+)?exploitée?s?|aucune?\s+(?:preuve|cas|information)\s+d['’]exploitation|pas\s+connaissance\s+d['’]exploitation)/gi;

export function mentionsExploitation(text: string): boolean {
  return EXPLOITED.test(text.replace(NOT_EXPLOITED, " "));
}

/** Markdown of CERT-FR (*italique*, **gras**, liens) → plain text. */
export function plainText(md: string, max: number): string {
  return cleanText(
    md
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/^#+\s*/gm, "")
      .replace(/\n{3,}/g, "\n\n"),
    max,
  );
}

type CertfrJson = {
  reference?: string;
  title?: string;
  summary?: string;
  content?: string;
  cves?: { name?: string }[];
};

/** The « ## Solution(s) » section of the content, as paragraphs. */
function solution(content: string): string {
  const m = /^##\s*Solutions?\s*$([\s\S]*?)(?=^##\s|$(?![\s\S]))/im.exec(content);
  return m ? plainText(m[1]!, 1000) : "";
}

export function parseCertfrJson(data: CertfrJson, entry: FeedEntry): CertfrAdvisory | null {
  if (data.reference !== entry.ref) return null;
  const title = cleanText(data.title, 200);
  if (!title) return null;
  const summary = plainText(data.summary ?? "", 1500);
  const content = typeof data.content === "string" ? data.content : "";
  const cves = [...new Set((data.cves ?? []).map((c) => c.name).filter((n): n is string => typeof n === "string" && CVE_ID.test(n)))];
  return {
    ref: entry.ref,
    kind: entry.kind,
    title,
    summary,
    solution: solution(content),
    cves,
    exploited: entry.kind === "alerte" || mentionsExploitation(`${summary}\n${content}`),
    url: `${CERTFR_BASE}/${entry.kind}/${entry.ref}/`,
  };
}

export async function fetchCertfrAdvisory(entry: FeedEntry, deps: SourceDeps): Promise<CertfrAdvisory | null> {
  if (!REF.test(entry.ref)) return null;
  const res = await getFrom("certfr", `${CERTFR_BASE}/${entry.kind}/${entry.ref}/json/`, deps, { maxBytes: 2 * 1024 * 1024 });
  return parseCertfrJson(parseJson<CertfrJson>("certfr", res.text), entry);
}

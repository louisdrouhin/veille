import Parser from "rss-parser";
import { makeExcerpt, titleToText } from "./excerpt";
import { normalizeUrl } from "./normalize-url";

export interface FeedEntry {
  title: string;
  url: string;
  normalizedUrl: string;
  excerpt: string;
  /** Always in the past or present: missing, invalid or future dates fall back to `now`. */
  publishedAt: Date;
  /** Full article HTML, unsanitized (RSS content:encoded, Atom <content>), when the feed provides it. */
  content?: string;
}

type RawItem = {
  title?: string;
  link?: string;
  guid?: string;
  id?: string;
  isoDate?: string;
  pubDate?: string;
  summary?: string;
  content?: string;
  contentSnippet?: string;
  "content:encoded"?: string;
  description?: string;
};

const parser: Parser<Record<string, unknown>, RawItem> = new Parser({
  // Parsing only — network access is handled by fetch-source.ts.
  customFields: { item: ["description", "summary"] },
});

function pickDate(item: RawItem, now: Date): Date {
  for (const raw of [item.isoDate, item.pubDate]) {
    if (!raw) continue;
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) continue;
    return date.getTime() > now.getTime() ? now : date;
  }
  return now;
}

function pickUrl(item: RawItem, baseUrl: string | undefined): string | null {
  for (const candidate of [item.link, item.guid, item.id]) {
    if (!candidate || typeof candidate !== "string") continue;
    try {
      const absolute = new URL(candidate.trim(), baseUrl).toString();
      if (normalizeUrl(absolute)) return absolute;
    } catch {
      // try next candidate
    }
  }
  return null;
}

function pickSummary(item: RawItem): string {
  // Prefer the feed's summary; fall back to the full content.
  const candidates = [item.summary, item.description, item.contentSnippet, item.content, item["content:encoded"]];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c;
  }
  return "";
}

/** True when the document root is an Atom <feed> (prolog, comments and doctype skipped). */
export function isAtomDocument(xml: string): boolean {
  const body = xml.replace(/^﻿?(?:\s+|<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>]*>)*/i, "");
  return /^<(?:[\w.-]+:)?feed[\s>/]/.test(body);
}

/**
 * Full content of an entry, shown as the topic article. With rss-parser, `content` is
 * the RSS <description> but the Atom <content>: it only counts for Atom.
 */
function pickContent(item: RawItem, atom: boolean): string | undefined {
  const raw = atom ? item.content : item["content:encoded"];
  return typeof raw === "string" && raw.trim() ? raw : undefined;
}

/**
 * Parses an RSS / Atom document into entries ready to become topics.
 * Items without a usable http(s) link are skipped; duplicates (same
 * normalized URL) inside the feed are collapsed, keeping the first one.
 */
export async function parseFeed(xml: string, opts: { feedUrl?: string; now?: Date } = {}): Promise<FeedEntry[]> {
  const now = opts.now ?? new Date();
  const feed = await parser.parseString(xml);
  const atom = isAtomDocument(xml);
  const seen = new Set<string>();
  const entries: FeedEntry[] = [];

  for (const item of feed.items ?? []) {
    const url = pickUrl(item, opts.feedUrl);
    if (!url) continue;
    const normalizedUrl = normalizeUrl(url);
    if (!normalizedUrl || seen.has(normalizedUrl)) continue;
    seen.add(normalizedUrl);

    const title = titleToText(item.title ?? "") || "(sans titre)";
    entries.push({
      title: title.length > 300 ? `${title.slice(0, 299)}…` : title,
      url,
      normalizedUrl,
      excerpt: makeExcerpt(pickSummary(item)),
      publishedAt: pickDate(item, now),
      content: pickContent(item, atom),
    });
  }
  return entries;
}

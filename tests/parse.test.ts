import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EXCERPT_MAX_LENGTH, htmlToText, makeExcerpt, truncate } from "@/lib/feeds/excerpt";
import { isAtomDocument, parseFeed } from "@/lib/feeds/parse";

const fixture = (name: string) => readFileSync(path.join(import.meta.dirname, "fixtures", name), "utf8");
const NOW = new Date("2026-01-15T12:00:00Z");

describe("parseFeed — RSS 2.0", async () => {
  const entries = await parseFeed(fixture("rss2.xml"), { feedUrl: "https://secu.example.org/feed.xml", now: NOW });

  it("keeps items with a usable link, collapses duplicates", () => {
    expect(entries.map((e) => e.normalizedUrl)).toEqual([
      "https://secu.example.org/2025/03/cve-2025-29927",
      "https://secu.example.org/sans-date",
      "https://secu.example.org/futur",
      "https://secu.example.org/relatif",
    ]);
  });

  it("decodes the title and keeps the original URL", () => {
    const [first] = entries;
    expect(first?.title).toBe("Faille critique dans <Next.js> & middleware");
    expect(first?.url).toBe("https://secu.example.org/2025/03/cve-2025-29927/?utm_source=rss&utm_medium=feed");
  });

  it("cleans HTML from the excerpt (scripts dropped, entities decoded)", () => {
    expect(entries[0]?.excerpt).toBe("Une faille permet de contourner le middleware. Mettez à jour !");
  });

  it("uses the feed date when valid", () => {
    expect(entries[0]?.publishedAt.toISOString()).toBe("2025-03-24T10:00:00.000Z");
  });

  it("falls back to now for missing or future dates", () => {
    expect(entries[1]?.publishedAt).toEqual(NOW);
    expect(entries[2]?.publishedAt).toEqual(NOW);
  });

  it("resolves relative links against the feed URL and reads content:encoded", () => {
    expect(entries[3]?.url).toBe("https://secu.example.org/relatif");
    expect(entries[3]?.excerpt).toBe("Contenu complet");
  });

  it("keeps content:encoded as the full content, never the <description>", () => {
    expect(entries[3]?.content).toBe("<div>Contenu complet</div>");
    expect(entries.slice(0, 3).every((e) => e.content === undefined)).toBe(true);
  });
});

describe("parseFeed — Atom", () => {
  it("parses entries, summary and published date", async () => {
    const xml = fixture("atom.xml").replace("LONG_CONTENT_PLACEHOLDER", "mot ".repeat(400));
    const entries = await parseFeed(xml, { now: NOW });
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      title: "Proxmox VE 9.0 — notes",
      normalizedUrl: "https://pve.example.net/news/pve-9-0",
      excerpt: "Nouvelle version majeure avec Debian 13.",
    });
    expect(entries[0]?.publishedAt.toISOString()).toBe("2025-04-09T06:30:00.000Z");
    // falls back to <updated> when <published> is missing
    expect(entries[1]?.publishedAt.toISOString()).toBe("2025-04-08T12:00:00.000Z");
    expect([...(entries[1]?.excerpt ?? "")].length).toBeLessThanOrEqual(EXCERPT_MAX_LENGTH);
    expect(entries[1]?.excerpt.endsWith("…")).toBe(true);
  });

  it("keeps <content> as the full content, not <summary>", async () => {
    const xml = fixture("atom.xml").replace("LONG_CONTENT_PLACEHOLDER", "&lt;p&gt;corps&lt;/p&gt;");
    const entries = await parseFeed(xml, { now: NOW });
    expect(entries[0]?.content).toBeUndefined();
    expect(entries[1]?.content).toBe("<p>corps</p>");
  });

  it("isAtomDocument looks at the root element only", () => {
    expect(isAtomDocument(fixture("atom.xml"))).toBe(true);
    expect(isAtomDocument('﻿<?xml version="1.0"?>\n<!-- c --><?xml-stylesheet href="a"?><atom:feed xmlns:atom="x"/>')).toBe(true);
    expect(isAtomDocument(fixture("rss2.xml"))).toBe(false);
    expect(isAtomDocument("<rss><channel><description>&lt;feed&gt;</description></channel></rss>")).toBe(false);
  });

  it("rejects documents that are not feeds", async () => {
    await expect(parseFeed("<html><body>Not a feed</body></html>")).rejects.toThrow();
  });
});

describe("excerpt helpers", () => {
  it("htmlToText strips tags, comments and styles", () => {
    expect(htmlToText("<style>p{}</style><p>a<!-- x --></p><p>b&#233;&#x20AC;</p>")).toBe("a bé€");
  });

  it("truncate cuts on a word boundary", () => {
    const text = "lorem ipsum ".repeat(100);
    const out = truncate(text, 50);
    expect([...out].length).toBeLessThanOrEqual(50);
    expect(out).toMatch(/(lorem|ipsum)…$/);
  });

  it("makeExcerpt handles empty input", () => {
    expect(makeExcerpt(undefined)).toBe("");
    expect(makeExcerpt("   ")).toBe("");
  });
});

describe("titleToText", () => {
  it("keeps literal angle brackets but strips inline HTML tags", async () => {
    const { titleToText } = await import("@/lib/feeds/excerpt");
    expect(titleToText("Le type <T> en TypeScript")).toBe("Le type <T> en TypeScript");
    expect(titleToText("<b>Gras</b> &amp; <em>italique</em>")).toBe("Gras & italique");
  });
});

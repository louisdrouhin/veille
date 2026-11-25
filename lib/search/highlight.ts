/**
 * Highlighting of the exact search (docs/design/3.3 § 3): ranges [start, end) of the words matched by the
 * query, computed on the folded text (same positions as the original, lib/search/fold.ts) and sent to the
 * client, which renders <mark> around plain text (never HTML). A query word matches the words starting
 * with its stem (a rough prefix: « réseau » finds « réseaux », « backup » finds « backups »).
 */
import { fold } from "./fold";

export type Range = [number, number];
export type Highlighted = { text: string; ranges: Range[] };

const STOP = new Set(
  "le la les un une des du de d l et ou en au aux a ce ces cet cette est sont dans sur pour par avec sans que qui quoi the a an of to in on for and or is are with".split(" "),
);

/** The folded query words worth highlighting (no operator, no stop word, at least 2 characters). */
export function queryTerms(q: string): string[] {
  const words = fold(q)
    .replace(/["()]/g, " ")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 2 && w !== "or" && !STOP.has(w) && !w.startsWith("-"));
  return [...new Set(words)].slice(0, 12);
}

const stem = (term: string) => (term.length > 4 ? term.slice(0, Math.max(4, term.length - 2)) : term);

export function highlightRanges(text: string, terms: string[]): Range[] {
  if (!terms.length || !text) return [];
  const folded = fold(text);
  const out: Range[] = [];
  const word = /[\p{L}\p{N}]+/gu;
  for (let m = word.exec(folded); m; m = word.exec(folded)) {
    if (terms.some((t) => m![0].startsWith(stem(t)))) out.push([m.index, m.index + m[0].length]);
  }
  return out;
}

/**
 * A short passage of `text` around its first match (or its start), with the ranges inside it.
 * `max` characters at most, cut on spaces, « … » where cut.
 */
export function snippet(text: string, terms: string[], max = 240): Highlighted {
  const clean = text.replace(/\s+/g, " ").trim();
  const ranges = highlightRanges(clean, terms);
  if (clean.length <= max) return { text: clean, ranges };
  const first = ranges[0]?.[0] ?? 0;
  let start = Math.max(0, first - Math.floor(max / 3));
  if (start > 0) {
    const space = clean.indexOf(" ", start);
    start = space >= 0 && space < first ? space + 1 : start;
  }
  let end = Math.min(clean.length, start + max);
  if (end < clean.length) {
    const space = clean.lastIndexOf(" ", end);
    end = space > start + max / 2 ? space : end;
  }
  const prefix = start > 0 ? "… " : "";
  const body = clean.slice(start, end);
  const shift = prefix.length - start;
  return {
    text: `${prefix}${body}${end < clean.length ? " …" : ""}`,
    ranges: ranges.filter(([s, e]) => s >= start && e <= end).map(([s, e]) => [s + shift, e + shift] as Range),
  };
}

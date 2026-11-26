/**
 * The answer as plain text blocks with references (docs/design/3.3 § 4.4), shared by the server (check) and the
 * client (live text while it is written). No server import.
 */
export const NOTHING = "RIEN";

export type AnswerPart = string | { cite: number };
export type AnswerBlock = { kind: "p" | "li"; parts: AnswerPart[] };
export type CheckedAnswer = { blocks: AnswerBlock[]; cited: number[] };

const CITES = /\[(\d{1,2}(?:\s*[,;]\s*\d{1,2})*)\]/g;

/** Parts of one line: text and valid references (others dropped). */
function parts(line: string, max: number, cited: Set<number>): AnswerPart[] {
  const out: AnswerPart[] = [];
  let at = 0;
  for (const m of line.matchAll(CITES)) {
    if (m.index > at) out.push(line.slice(at, m.index));
    for (const n of m[1]!.split(/[,;]/).map((x) => Number(x.trim()))) {
      if (Number.isInteger(n) && n >= 1 && n <= max) {
        out.push({ cite: n });
        cited.add(n);
      }
    }
    at = m.index + m[0].length;
  }
  if (at < line.length) out.push(line.slice(at));
  // Adjacent text joined (a dropped reference leaves « faille  . »), without what Markdown or HTML the model may
  // still have written, no space before punctuation.
  const merged: AnswerPart[] = [];
  for (const p of out) {
    const last = merged.at(-1);
    if (typeof p === "string" && typeof last === "string") merged[merged.length - 1] = last + p;
    else merged.push(p);
  }
  return merged
    .map((p, i) =>
      typeof p === "string"
        ? p
            .replace(/\*\*|__|`/g, "")
            .replace(/<[^>]*>/g, "")
            .replace(/ {2,}/g, " ")
            .replace(/ +([.,;:!?)])/g, i > 0 ? "$1" : " $1")
        : p,
    )
    .filter((p) => typeof p !== "string" || p.length > 0);
}

/**
 * The model's text, checked (§ 4.4): references to no extract removed; null when nothing is left to show (no valid
 * reference, or « RIEN »): never an answer from the model's general knowledge.
 */
export function checkAnswer(text: string, extractCount: number): CheckedAnswer | null {
  const t = text.replace(/\r\n?/g, "\n").trim();
  if (!t || t === NOTHING || /^RIEN\b/.test(t)) return null;
  const cited = new Set<number>();
  const blocks: AnswerBlock[] = [];
  for (const raw of t.split(/\n+/)) {
    const line = raw.trim().replace(/^#+\s*/, "");
    if (!line) continue;
    const li = /^[-*•]\s+/.test(line);
    const body = li ? line.replace(/^[-*•]\s+/, "") : line;
    // A statement whose every reference points to no extract is unsupported: it goes, whole.
    const kept = body
      .split(/(?<=[.!?…])\s+/)
      .filter((sentence) => {
        const refs = [...sentence.matchAll(CITES)].flatMap((m) => m[1]!.split(/[,;]/).map((x) => Number(x.trim())));
        return refs.length === 0 || refs.some((n) => Number.isInteger(n) && n >= 1 && n <= extractCount);
      })
      .join(" ");
    if (!kept.trim()) continue;
    const p = parts(kept, extractCount, cited);
    if (p.some((x) => typeof x !== "string" || x.trim())) blocks.push({ kind: li ? "li" : "p", parts: p });
  }
  if (cited.size === 0) return null;
  return { blocks, cited: [...cited].sort((a, b) => a - b) };
}

/** « Copier »: the answer as text, with its sources as footnotes. */
export function answerAsText(answer: CheckedAnswer, sources: { n: number; title: string; url: string }[]): string {
  const body = answer.blocks
    .map((b) => `${b.kind === "li" ? "- " : ""}${b.parts.map((p) => (typeof p === "string" ? p : `[${p.cite}]`)).join("")}`)
    .join("\n");
  const notes = sources.filter((s) => answer.cited.includes(s.n)).map((s) => `[${s.n}] ${s.title} — ${s.url}`);
  return `${body}\n\nSources :\n${notes.join("\n")}`;
}

/** While the answer is written: the same blocks, shown as they come (checked again once complete). */
export function liveBlocks(text: string, extractCount: number): AnswerBlock[] {
  const t = text.replace(/\r\n?/g, "\n");
  if (/^\s*R(I(E(N)?)?)?\s*$/.test(t)) return [];
  const cited = new Set<number>();
  return t
    .split(/\n+/)
    .map((raw) => raw.trim().replace(/^#+\s*/, ""))
    .filter(Boolean)
    .map((line) => {
      const li = /^[-*•]\s+/.test(line);
      return { kind: li ? ("li" as const) : ("p" as const), parts: parts(li ? line.replace(/^[-*•]\s+/, "") : line, extractCount, cited) };
    });
}

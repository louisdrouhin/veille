import { parseHTML } from "linkedom";
import { resanitizeArticleHtml } from "@/lib/reader/sanitize";

/**
 * Translation without letting the model write HTML. The stored article (already sanitized) is cut
 * into numbered runs of text — the inline content of p, h2-h4, li, blockquote, figcaption,
 * caption, th/td… — and only `{ id: text }` goes to the model. Each answer is put back into the
 * node it came from: images, link targets, tables and formatting always come from our HTML.
 *
 * Inline elements inside a run become markers so that a sentence is translated as a whole and the
 * link / bold / code stays on the right words: `⟦1⟧link text⟦/1⟧` (translated inside) and `⟦2⟧`
 * (code, image, line break: copied as is, never translated). The answer must contain exactly the
 * same markers, nested the same way; otherwise it is refused. pre blocks are never sent.
 */

/** Elements that stay inside a run of text; anything else is a block that splits runs. */
const INLINE = new Set(["A", "STRONG", "EM", "CODE", "IMG", "BR", "B", "I"]);
/** Copied verbatim, never translated. */
const OPAQUE = new Set(["CODE", "IMG", "BR"]);
/** Blocks whose content is never sent. */
const SKIP = new Set(["PRE"]);

const MARKER = /⟦(\/?)(\d{1,4})⟧/g;
const LETTER = /\p{L}/u;
/** Anything that looks like an HTML tag: an answer is plain text only. */
const HTML_TAG = /<\/?[a-z!?][^>]*>/i;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

export type Segment = { id: string; text: string };

export class SegmentError extends Error {}

type NodeLike = { nodeType: number; textContent: string | null; childNodes: ArrayLike<NodeLike>; parentNode: NodeLike | null };
type ElementLike = NodeLike & {
  tagName: string;
  cloneNode(deep: boolean): ElementLike;
  appendChild(n: NodeLike): void;
  insertBefore(n: NodeLike, ref: NodeLike): void;
  removeChild(n: NodeLike): void;
  innerHTML: string;
};

type Run = {
  id: string;
  nodes: NodeLike[];
  text: string;
  /** Marker k (1-based) → original element, whether it is opaque, and its parent marker (0 = none). */
  markers: { el: ElementLike; opaque: boolean; parent: number }[];
  lead: boolean;
  trail: boolean;
  translated?: NodeLike[];
};

/** Text of the article as it is sent: whitespace collapsed, our marker characters neutralized. */
const cleanText = (s: string) => s.replace(/[⟦⟧]/g, (c) => (c === "⟦" ? "[" : "]")).replace(/\s+/g, " ");

export function segmentArticle(html: string) {
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  const body = document.body as unknown as ElementLike;
  const runs: Run[] = [];

  function addRun(nodes: NodeLike[]) {
    const markers: Run["markers"] = [];
    const ser = (node: NodeLike, parent: number): string => {
      if (node.nodeType === 3) return cleanText(node.textContent ?? "");
      if (node.nodeType !== 1) return "";
      const el = node as ElementLike;
      const opaque = OPAQUE.has(el.tagName) || !INLINE.has(el.tagName) || !LETTER.test(el.textContent ?? "");
      markers.push({ el, opaque, parent });
      const k = markers.length;
      if (opaque) return `⟦${k}⟧`;
      return `⟦${k}⟧${Array.from(el.childNodes, (c) => ser(c, k)).join("")}⟦/${k}⟧`;
    };
    const raw = nodes.map((n) => ser(n, 0)).join("");
    const text = raw.trim();
    // Nothing to translate (an image alone, a number in a cell…): left untouched.
    if (!LETTER.test(text.replace(MARKER, ""))) return;
    runs.push({ id: String(runs.length + 1), nodes, text, markers, lead: /^\s/.test(raw), trail: /\s$/.test(raw) });
  }

  function walk(el: ElementLike) {
    let run: NodeLike[] = [];
    const flush = () => {
      if (run.length) addRun(run);
      run = [];
    };
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === 3 || (child.nodeType === 1 && INLINE.has((child as ElementLike).tagName))) run.push(child);
      else if (child.nodeType === 1) {
        flush();
        if (!SKIP.has((child as ElementLike).tagName)) walk(child as ElementLike);
      }
    }
    flush();
  }
  walk(body);

  const byId = new Map(runs.map((r) => [r.id, r]));

  /** Rebuilds the run from the translated text, or throws SegmentError when it does not fit. */
  function parse(run: Run, value: unknown): NodeLike[] {
    if (typeof value !== "string") throw new SegmentError(`${run.id}: not a string`);
    const text = value.replace(/\s+/g, " ").trim();
    if (!text || !LETTER.test(text.replace(MARKER, ""))) throw new SegmentError(`${run.id}: empty`);
    if (HTML_TAG.test(text) || CONTROL.test(text)) throw new SegmentError(`${run.id}: not plain text`);
    if (text.length > run.text.length * 3 + 200) throw new SegmentError(`${run.id}: too long`);

    const root: { k: number; children: NodeLike[] } = { k: 0, children: [] };
    const stack = [root];
    const seen = new Set<number>();
    let last = 0;
    const pushText = (s: string) => {
      if (s) stack.at(-1)!.children.push(document.createTextNode(s) as unknown as NodeLike);
    };
    for (const m of text.matchAll(MARKER)) {
      pushText(text.slice(last, m.index));
      last = m.index + m[0].length;
      const k = Number(m[2]);
      const marker = run.markers[k - 1];
      const top = stack.at(-1)!;
      if (m[1]) {
        if (top.k !== k) throw new SegmentError(`${run.id}: marker ${k} closed out of order`);
        stack.pop();
        const el = marker!.el.cloneNode(false);
        for (const c of top.children) el.appendChild(c);
        stack.at(-1)!.children.push(el);
        continue;
      }
      if (!marker || seen.has(k)) throw new SegmentError(`${run.id}: unknown or repeated marker ${k}`);
      if (marker.parent !== top.k) throw new SegmentError(`${run.id}: marker ${k} moved`);
      seen.add(k);
      if (marker.opaque) top.children.push(marker.el.cloneNode(true));
      else stack.push({ k, children: [] });
    }
    pushText(text.slice(last));
    if (stack.length !== 1) throw new SegmentError(`${run.id}: marker left open`);
    if (seen.size !== run.markers.length) throw new SegmentError(`${run.id}: marker missing`);
    return root.children;
  }

  return {
    segments: runs.map((r): Segment => ({ id: r.id, text: r.text })),

    /**
     * Checks a batch of answers against the segments that were sent: exactly the same ids, plain
     * text with the same markers. All or nothing: on error, nothing of the batch is kept.
     */
    accept(sent: readonly Segment[], answer: unknown) {
      if (!answer || typeof answer !== "object" || Array.isArray(answer)) throw new SegmentError("not an object");
      const record = answer as Record<string, unknown>;
      const keys = Object.keys(record);
      if (keys.length !== sent.length || sent.some((s) => !Object.hasOwn(record, s.id))) throw new SegmentError("ids differ");
      const parsed = sent.map((s) => {
        const run = byId.get(s.id);
        if (!run) throw new SegmentError(`${s.id}: unknown`);
        return [run, parse(run, record[s.id])] as const;
      });
      for (const [run, nodes] of parsed) run.translated = nodes;
    },

    /** The translated article. Throws if a single segment is missing. */
    html(): string {
      const missing = runs.filter((r) => !r.translated);
      if (missing.length) throw new SegmentError(`${missing.length} segment(s) missing`);
      for (const run of runs) {
        const first = run.nodes[0]!;
        const parent = first.parentNode as ElementLike;
        const nodes = [...(run.lead ? [document.createTextNode(" ")] : []), ...run.translated!, ...(run.trail ? [document.createTextNode(" ")] : [])];
        for (const n of nodes) parent.insertBefore(n as NodeLike, first);
        for (const n of run.nodes) parent.removeChild(n);
      }
      // Built only from our sanitized nodes and text nodes; one more pass all the same.
      return resanitizeArticleHtml(body.innerHTML);
    },
  };
}

/** Groups segments into batches of at most `maxChars` of text (a longer segment goes alone). */
export function batchSegments(segments: readonly Segment[], maxChars: number): Segment[][] {
  const batches: Segment[][] = [];
  let current: Segment[] = [];
  let size = 0;
  for (const s of segments) {
    if (current.length && size + s.text.length > maxChars) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(s);
    size += s.text.length;
  }
  if (current.length) batches.push(current);
  return batches;
}

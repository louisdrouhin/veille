/**
 * Minimal Markdown → HTML for the model's answers. Deliberately small and closed: everything is
 * escaped first, then only paragraphs, h2-h4, lists, quotes, code, bold and italic are produced.
 * Links keep their text only and images are dropped: a model output (possibly steered by the
 * article) cannot add a link, an image or any HTML. The result still goes through the reading
 * mode's sanitizer (lib/reader/sanitize.ts) before being stored.
 */
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** A link / image target in parentheses, with one level of nested parentheses (« javascript:alert(1) »). */
const TARGET = String.raw`\((?:[^()]|\([^()]*\))*\)`;

function inline(text: string): string {
  const codes: string[] = [];
  let s = text
    .replace(new RegExp(String.raw`!\[([^\]]*)\]` + TARGET, "g"), "") // images: dropped
    .replace(new RegExp(String.raw`\[([^\]]+)\]` + TARGET, "g"), "$1") // links: text only
    .replace(/<(https?:[^>\s]+)>/g, "$1"); // autolinks: plain text
  s = escapeHtml(s).replace(/`([^`]+)`/g, (_, c: string) => {
    codes.push(c);
    return `\u0000${codes.length - 1}\u0000`;
  });
  s = s
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/__(.+?)__/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/(^|\W)_(?!\s)(.+?)_(?=\W|$)/g, "$1<em>$2</em>");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i: string) => `<code>${codes[Number(i)]}</code>`);
}

export function markdownToHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let para: string[] = [];
  let list: { type: "ul" | "ol"; items: string[] } | null = null;
  let quote: string[] = [];

  const flushPara = () => {
    if (para.length) out.push(`<p>${inline(para.join(" "))}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) out.push(`<${list.type}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${list.type}>`);
    list = null;
  };
  const flushQuote = () => {
    if (quote.length) out.push(`<blockquote><p>${inline(quote.join(" "))}</p></blockquote>`);
    quote = [];
  };
  const flushAll = () => {
    flushPara();
    flushList();
    flushQuote();
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fence = /^\s*(```|~~~)/.exec(line);
    if (fence) {
      flushAll();
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i]!.trim().startsWith(fence[1]!); i++) code.push(lines[i]!);
      out.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }
    const trimmed = line.trim();
    if (!trimmed) {
      flushAll();
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushAll();
      const level = Math.min(4, Math.max(2, heading[1]!.length));
      out.push(`<h${level}>${inline(heading[2]!.replace(/\s+#+\s*$/, ""))}</h${level}>`);
      continue;
    }
    const bullet = /^[-*+•]\s+(.*)$/.exec(trimmed);
    const numbered = /^\d{1,3}[.)]\s+(.*)$/.exec(trimmed);
    if (bullet || numbered) {
      flushPara();
      flushQuote();
      const type = bullet ? "ul" : "ol";
      if (list && list.type !== type) flushList();
      list ??= { type, items: [] };
      list.items.push((bullet ?? numbered)![1]!);
      continue;
    }
    if (trimmed.startsWith(">")) {
      flushPara();
      flushList();
      quote.push(trimmed.replace(/^>\s?/, ""));
      continue;
    }
    if (list && /^\s{2,}\S/.test(line)) {
      // Continuation of the previous list item.
      const items = (list as { items: string[] }).items;
      items[items.length - 1] += ` ${trimmed}`;
      continue;
    }
    flushList();
    flushQuote();
    para.push(trimmed);
  }
  flushAll();
  return out.join("\n");
}

/** « Copier en Markdown » of a list (docs/design/v3 § 3.7). Pure: built in the browser at click time. */
export type MarkdownItem = { topicId?: number; title: string; url: string; source: string | null; forum: string };

const dateFmt = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", year: "numeric" });

/** Link text: brackets (and backslashes) escaped, line breaks flattened. */
export function escapeLinkText(text: string): string {
  return text.replace(/\s+/g, " ").trim().replace(/[\\[\]]/g, (c) => "\\" + c);
}

/** Link target: spaces and parentheses percent-encoded so the URL cannot end the link early. */
const URL_ESCAPES: Record<string, string> = { "(": "%28", ")": "%29", "<": "%3C", ">": "%3E" };
function escapeUrl(url: string): string {
  return url.replace(/[\s()<>]/g, (c) => URL_ESCAPES[c] ?? encodeURIComponent(c));
}

export function listToMarkdown(name: string, items: MarkdownItem[], now: Date = new Date()): string {
  const n = items.length;
  const lines = [
    `## ${name.replace(/\s+/g, " ").trim()}`,
    `_${n} article${n > 1 ? "s" : ""} · exporté de Folders le ${dateFmt.format(now)}_`,
    "",
    ...items.map((i) => `- [${escapeLinkText(i.title)}](${escapeUrl(i.url)}) — ${i.source ?? "Source supprimée"} · ${i.forum}`),
  ];
  return `${lines.join("\n")}\n`;
}

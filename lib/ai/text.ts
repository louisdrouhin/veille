import sanitizeHtml from "sanitize-html";

/** Characters of article text sent to the model at most (≈ 6 000 tokens); the rest is cut. */
export const MAX_INPUT_CHARS = 24_000;

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };

/**
 * Plain text of the stored (sanitized) article HTML: blocks become paragraphs, every tag and
 * attribute is dropped. Only this, the article itself, is ever sent to the model — never notes.
 */
export function articleText(html: string): string {
  const blocks = html.replace(/<\/(p|h[1-6]|li|blockquote|pre|figure|figcaption)>/gi, "$&\n\n").replace(/<br\s*\/?>/gi, "\n");
  const text = sanitizeHtml(blocks, { allowedTags: [], allowedAttributes: {} }).replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (e) => ENTITIES[e] ?? e);
  return text
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function truncateForModel(text: string, max = MAX_INPUT_CHARS): { text: string; cut: boolean } {
  if (text.length <= max) return { text, cut: false };
  const at = text.lastIndexOf("\n", max);
  return { text: text.slice(0, at > max * 0.8 ? at : max), cut: true };
}

const FR = new Set("le la les des du de un une et est sont pour dans que qui sur pas avec au aux ce cette ces il elle nous vous ils leur plus par mais ou où été être a ont sa son ses en ne".split(" "));
const EN = new Set("the and of to is are for in that which on not with this these it they we you their more by but or been be has have its an as at from was were will".split(" "));

/** Whether the text is mostly French (stop-word count on its first 4 000 characters). */
export function isFrench(text: string): boolean {
  const words = text.slice(0, 4000).toLowerCase().match(/[a-zàâäçéèêëîïôöùûüœ']+/g) ?? [];
  let fr = 0;
  let en = 0;
  for (const raw of words) {
    const w = raw.replace(/^(l|d|qu|n|s|c|j)'/, "");
    if (FR.has(w)) fr++;
    if (EN.has(w)) en++;
  }
  return fr >= 5 && fr > en * 1.5;
}

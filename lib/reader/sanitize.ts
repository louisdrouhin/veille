/**
 * Server-side sanitization of article HTML (feed content or Readability output)
 * before it is stored and rendered with dangerouslySetInnerHTML.
 *
 * - strict allow-list of tags, everything else is dropped (text kept, except
 *   for script/style/iframe… whose content is dropped too);
 * - no attribute besides a[href], img[src|alt] and th/td[colspan|rowspan] (small integers only):
 *   no on*, style, class, id…;
 * - links: http(s)/mailto only, resolved against the article URL, opened in a
 *   new tab with rel="noopener noreferrer";
 * - images: resolved against the article URL and rewritten to the
 *   authenticated /api/image-proxy, so the browser never contacts third parties
 *   (the topic page CSP only allows img-src 'self').
 */
import sanitizeHtml from "sanitize-html";

export const ALLOWED_TAGS = [
  "p",
  "h2",
  "h3",
  "h4",
  "ul",
  "ol",
  "li",
  "a",
  "strong",
  "em",
  "blockquote",
  "pre",
  "code",
  "img",
  "figure",
  "figcaption",
  "table",
  "caption",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
] as const;

/** Tags removed together with their content (default: tag dropped, text kept). */
const DROP_WITH_CONTENT = [
  "script",
  "style",
  "noscript",
  "template",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
  "svg",
  "math",
  "canvas",
  "video",
  "audio",
  "textarea",
  "select",
  "option",
  "button",
  "form",
  "head",
  "title",
  "nav",
];

export const IMAGE_PROXY_PATH = "/api/image-proxy";

export function imageProxyUrl(absoluteUrl: string): string {
  return `${IMAGE_PROXY_PATH}?url=${encodeURIComponent(absoluteUrl)}`;
}

function resolve(value: string | undefined, baseUrl: string, protocols: readonly string[]): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim(), baseUrl);
    return protocols.includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

const rename = (tagName: string) => (_: string, attribs: sanitizeHtml.Attributes) => ({ tagName, attribs });

/** colspan / rowspan kept only as an integer from 2 to 50. */
function cell(tagName: string, attribs: sanitizeHtml.Attributes) {
  const out: sanitizeHtml.Attributes = {};
  for (const name of ["colspan", "rowspan"]) {
    const v = attribs[name]?.trim();
    if (v && /^\d{1,2}$/.test(v) && Number(v) >= 2 && Number(v) <= 50) out[name] = String(Number(v));
  }
  return { tagName, attribs: out };
}

const CELL_ATTRIBUTES = ["colspan", "rowspan"];

export function sanitizeArticleHtml(html: string, baseUrl: string): string {
  return sanitizeHtml(html, {
    allowedTags: [...ALLOWED_TAGS],
    allowedAttributes: { a: ["href", "target", "rel"], img: ["src", "alt", "loading"], th: CELL_ATTRIBUTES, td: CELL_ATTRIBUTES },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesAppliedToAttributes: ["href", "src"],
    allowProtocolRelative: false,
    disallowedTagsMode: "discard",
    nonTextTags: DROP_WITH_CONTENT,
    transformTags: {
      th: (_, attribs) => cell("th", attribs),
      td: (_, attribs) => cell("td", attribs),
      h1: rename("h2"),
      h5: rename("h4"),
      h6: rename("h4"),
      b: rename("strong"),
      i: rename("em"),
      a: (_, attribs) => {
        const href = resolve(attribs.href, baseUrl, ["http:", "https:", "mailto:"]);
        return {
          tagName: "a",
          attribs: href ? { href, target: "_blank", rel: "noopener noreferrer" } : ({} as sanitizeHtml.Attributes),
        };
      },
      img: (_, attribs) => {
        const src = resolve(attribs.src || attribs["data-src"], baseUrl, ["http:", "https:"]);
        return {
          tagName: "img",
          attribs: src ? { src: imageProxyUrl(src), alt: attribs.alt ?? "", loading: "lazy" } : ({} as sanitizeHtml.Attributes),
        };
      },
    },
    // Images without a usable source are removed entirely.
    exclusiveFilter: (frame) => frame.tag === "img" && !frame.attribs.src,
  });
}

/**
 * Second pass over HTML that is ours already (sanitized article in which only text nodes were
 * replaced, e.g. a translation): same allow-list, no rewriting, so an image keeps its proxy URL.
 * Anything that does not fit — a link that is not absolute http(s)/mailto, an image that does not
 * go through the proxy — is removed.
 */
export function resanitizeArticleHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [...ALLOWED_TAGS],
    allowedAttributes: { a: ["href", "target", "rel"], img: ["src", "alt", "loading"], th: CELL_ATTRIBUTES, td: CELL_ATTRIBUTES },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesAppliedToAttributes: ["href", "src"],
    allowProtocolRelative: false,
    disallowedTagsMode: "discard",
    nonTextTags: DROP_WITH_CONTENT,
    transformTags: {
      th: (_, attribs) => cell("th", attribs),
      td: (_, attribs) => cell("td", attribs),
      a: (_, attribs) => ({
        tagName: "a",
        attribs: /^(?:https?|mailto):/i.test(attribs.href ?? "") ? { href: attribs.href!, target: "_blank", rel: "noopener noreferrer" } : ({} as sanitizeHtml.Attributes),
      }),
      img: (_, attribs) => ({
        tagName: "img",
        attribs: (attribs.src ?? "").startsWith(`${IMAGE_PROXY_PATH}?url=`)
          ? { src: attribs.src!, alt: attribs.alt ?? "", loading: "lazy" }
          : ({} as sanitizeHtml.Attributes),
      }),
    },
    exclusiveFilter: (frame) => frame.tag === "img" && !frame.attribs.src,
  });
}

/** Visible text of sanitized HTML, whitespace collapsed (used for « empty extraction »). */
export function htmlTextLength(html: string): number {
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} }).replace(/\s+/g, " ").trim().length;
}

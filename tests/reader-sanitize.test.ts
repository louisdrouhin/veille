import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";
import { ALLOWED_TAGS, htmlTextLength, imageProxyUrl, sanitizeArticleHtml } from "@/lib/reader/sanitize";

const BASE = "https://blog.example.org/2025/article";
const clean = (html: string) => sanitizeArticleHtml(html, BASE);

const ALLOWED_ATTRS: Record<string, string[]> = { a: ["href", "target", "rel"], img: ["src", "alt", "loading"], th: ["colspan", "rowspan"], td: ["colspan", "rowspan"] };

/** Parses the output as a browser would and checks every element and attribute against the policy. */
function expectSafeDom(html: string) {
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  for (const el of document.body.querySelectorAll("*")) {
    const tag = el.tagName.toLowerCase();
    expect(ALLOWED_TAGS as readonly string[], html).toContain(tag);
    for (const { name, value } of el.attributes) {
      expect(ALLOWED_ATTRS[tag] ?? [], `${tag}[${name}]`).toContain(name);
      if (name === "href") expect(value).toMatch(/^(https?|mailto):/);
      if (name === "src") expect(value.startsWith("/api/image-proxy?url=")).toBe(true);
    }
  }
}

describe("sanitizeArticleHtml — trapped HTML", () => {
  it("removes <script>, its content included", () => {
    const out = clean(`<p>Avant</p><script>alert("xss")</script><SCRIPT src="//evil.example/x.js"></SCRIPT><p>Après</p>`);
    expect(out).toBe("<p>Avant</p><p>Après</p>");
  });

  it("removes on* handlers (onerror, onclick, onload…)", () => {
    const out = clean(
      `<p onclick="steal()">texte</p><img src="https://cdn.example.org/a.png" onerror="alert(1)" onload="x()"><a href="https://ok.example.org" onmouseover="x()">lien</a>`,
    );
    expect(out).not.toMatch(/on\w+=/i);
    expect(out).not.toMatch(/alert|steal/);
    expect(out).toContain("<p>texte</p>");
  });

  it("drops javascript:, vbscript: and data: URLs (any casing / whitespace / entities)", () => {
    for (const href of [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      " javascript:alert(1)",
      "java&#x09;script:alert(1)",
      "&#106;avascript:alert(1)",
      "vbscript:msgbox(1)",
      "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
    ]) {
      const out = clean(`<a href="${href}">lien</a>`);
      expect(out, href).toBe("<a>lien</a>");
    }
    expect(clean(`<img src="javascript:alert(1)"><img src="data:image/png;base64,AAAA">`)).toBe("");
  });

  it("removes iframe, object, embed, style, svg, form, with their content", () => {
    const out = clean(
      `<p>a</p><iframe src="https://evil.example"></iframe><object data="x.swf"></object><embed src="x"><style>body{display:none}</style>` +
        `<svg><script>alert(1)</script></svg><form action="https://evil.example"><input name="p"><button>OK</button></form><p>b</p>`,
    );
    expect(out).toBe("<p>a</p><p>b</p>");
  });

  it("removes style, class, id and every other attribute", () => {
    const out = clean(`<p style="position:fixed" class="x" id="y" data-x="1" title="t">texte</p>`);
    expect(out).toBe("<p>texte</p>");
  });

  it("drops unknown tags but keeps their text", () => {
    expect(clean(`<div><span>Bonjour</span> <u>monde</u></div>`)).toBe("Bonjour monde");
  });

  it("keeps tables, with only small integer colspan / rowspan", () => {
    expect(clean(`<table class="x"><caption>Prix</caption><tr><th scope="col" colspan="2" style="x">a</th><td rowspan="3x" onclick="y">b</td><td colspan="999">c</td></tr></table>`)).toBe(
      `<table><caption>Prix</caption><tr><th colspan="2">a</th><td>b</td><td>c</td></tr></table>`,
    );
  });

  it("is not fooled by malformed markup", () => {
    for (const html of [
      `<p>ok</p><img src=x onerror=alert(1)//><scr<script>ipt>alert(2)</scr</script>ipt><<a>a href="javascript:x"</a>`,
      `<a href="javascript:alert(1)"<p onclick=x>t</p>`,
      `<p title="</p><script>alert(1)</script>">t</p>`,
      `<!--<img src=x onerror=alert(1)>--><p>t</p>`,
      `<math><mi xlink:href="javascript:alert(1)">x</mi></math><svg><a href="javascript:alert(1)">x</a></svg>`,
      `<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>`,
    ]) {
      expectSafeDom(clean(html));
    }
  });
});

describe("sanitizeArticleHtml — allowed content", () => {
  it("keeps the allow-listed tags", () => {
    const html =
      "<p>p</p><h2>h2</h2><h3>h3</h3><h4>h4</h4><ul><li>ul</li></ul><ol><li>ol</li></ol><strong>s</strong><em>e</em>" +
      "<blockquote>q</blockquote><pre><code>c</code></pre><figure><figcaption>cap</figcaption></figure>";
    expect(clean(html)).toBe(html);
  });

  it("maps h1 → h2, h5/h6 → h4, b → strong, i → em", () => {
    expect(clean("<h1>a</h1><h5>b</h5><h6>c</h6><b>d</b><i>e</i>")).toBe("<h2>a</h2><h4>b</h4><h4>c</h4><strong>d</strong><em>e</em>");
  });

  it("opens links in a new tab with rel=noopener noreferrer, resolved against the article URL", () => {
    expect(clean(`<a href="/autre" target="_self" rel="opener">x</a>`)).toBe(
      `<a href="https://blog.example.org/autre" target="_blank" rel="noopener noreferrer">x</a>`,
    );
    expect(clean(`<a href="mailto:moi@example.org">m</a>`)).toBe(
      `<a href="mailto:moi@example.org" target="_blank" rel="noopener noreferrer">m</a>`,
    );
  });

  it("rewrites images to the image proxy (absolute URL, relative URL, lazy data-src)", () => {
    expect(clean(`<img src="https://cdn.example.org/a.png" alt="A" width="10" srcset="b.png 2x">`)).toBe(
      `<img src="${imageProxyUrl("https://cdn.example.org/a.png")}" alt="A" loading="lazy" />`,
    );
    expect(clean(`<img src="img/b.jpg">`)).toContain(encodeURIComponent("https://blog.example.org/2025/img/b.jpg"));
    expect(clean(`<img data-src="//cdn.example.org/c.webp">`)).toContain(encodeURIComponent("https://cdn.example.org/c.webp"));
    expect(clean(`<img src="https://cdn.example.org/a.png">`)).toMatch(/^<img src="\/api\/image-proxy\?url=/);
  });

  it("never lets an image point outside the proxy", () => {
    const out = clean(`<img src="/api/image-proxy?url=http://127.0.0.1/">`);
    // A pre-rewritten src is treated as a relative URL of the article site, then proxied.
    expect(out).toContain(encodeURIComponent("https://blog.example.org/api/image-proxy?url=http://127.0.0.1/"));
  });
});

describe("htmlTextLength", () => {
  it("counts visible text only", () => {
    expect(htmlTextLength("<p>  ab  </p>\n<p>cd</p>")).toBe(5);
    expect(htmlTextLength('<img src="/x">')).toBe(0);
  });
});

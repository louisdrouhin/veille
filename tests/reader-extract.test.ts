import { describe, expect, it } from "vitest";
import { decodeHtml, extractArticle, fetchReadableArticle, MAX_PAGE_BYTES } from "@/lib/reader/extract";
import type { Resolver } from "@/lib/net/safe-fetch";
import { articlePage } from "./helpers/article-page";

const URL_ = "https://blog.example.org/2025/mon-article";
const publicDns: Resolver = async () => [{ address: "93.184.215.14", family: 4 }];
const html = (body: string, init: ResponseInit = {}) =>
  new Response(body, { ...init, headers: { "content-type": "text/html; charset=utf-8", ...(init.headers ?? {}) } });

function transport(handler: (url: string) => Response | Promise<Response>) {
  const sent: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    sent.push(String(input));
    return handler(String(input));
  }) as typeof fetch;
  return { sent, fetchImpl };
}

describe("extractArticle", () => {
  it("extracts the main content, without navigation, sidebar, footer or scripts", () => {
    const res = extractArticle(articlePage(), URL_);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.html).toContain("Proxmox VE 9 apporte Debian 13");
    expect(res.html).not.toMatch(/Accueil|newsletter|mentions légales|tracker|<script|<iframe|onerror|onclick|javascript:/i);
  });

  it("returns sanitized HTML: proxied images, absolute links in a new tab", () => {
    const res = extractArticle(articlePage(), URL_);
    if (!res.ok) throw new Error(res.error);
    expect(res.html).toContain(`/api/image-proxy?url=${encodeURIComponent("https://blog.example.org/img/schema.png")}`);
    expect(res.html).toContain('<a href="https://blog.example.org/autre" target="_blank" rel="noopener noreferrer">');
    expect(res.html).toContain("<figcaption>Le schéma</figcaption>");
  });

  it("fails on an empty extraction (paywall teaser, SPA shell)", () => {
    expect(extractArticle(articlePage("<p>Réservé aux abonnés.</p>"), URL_)).toEqual({
      ok: false,
      error: expect.stringMatching(/Extraction vide|Aucun article/),
    });
    expect(extractArticle('<!doctype html><html><body><div id="root"></div><script src="/app.js"></script></body></html>', URL_).ok).toBe(false);
  });
});

describe("soft 404 (error page served with a 200)", () => {
  it.each(["Erreur 404", "404 - Page introuvable", "Page not found | Blog", "Not Found", "Page introuvable"])(
    "fails on the title « %s »",
    (title) => {
      const page = articlePage().replace("<title>Mon article</title>", `<title>${title}</title>`);
      expect(extractArticle(page, URL_)).toEqual({ ok: false, error: "Page d'erreur renvoyée à la place de l'article" });
    },
  );

  it("keeps real articles that merely talk about 404", () => {
    const page = articlePage().replace("<title>Mon article</title>", "<title>Pourquoi soigner sa page 404</title>");
    expect(extractArticle(page, URL_).ok).toBe(true);
  });

  it("fails when the article URL redirects to an error path", async () => {
    const t = transport(() => {
      const res = html(articlePage());
      Object.defineProperty(res, "url", { value: "https://blog.example.org/error-404/index.html" });
      return res;
    });
    expect(await fetchReadableArticle(URL_, { resolve: publicDns, fetchImpl: t.fetchImpl })).toEqual({
      ok: false,
      error: "Page d'erreur renvoyée à la place de l'article",
    });
  });

  it("ignores « 404 » in the path when there was no redirect", async () => {
    const url = "https://blog.example.org/2025/404-pages-matter";
    const t = transport(() => html(articlePage()));
    expect((await fetchReadableArticle(url, { resolve: publicDns, fetchImpl: t.fetchImpl })).ok).toBe(true);
  });
});

describe("decodeHtml", () => {
  it("uses the charset of the header, then of <meta>, else UTF-8", () => {
    const latin1 = Uint8Array.from([0x63, 0x61, 0x66, 0xe9]); // « café » in ISO-8859-1
    expect(decodeHtml(latin1, "text/html; charset=iso-8859-1")).toBe("café");
    const meta = new Uint8Array([...new TextEncoder().encode('<meta charset="windows-1252">'), 0xe9]);
    expect(decodeHtml(meta, "text/html")).toBe('<meta charset="windows-1252">é');
    expect(decodeHtml(new TextEncoder().encode("café"), null)).toBe("café");
  });
});

describe("fetchReadableArticle", () => {
  it("downloads and extracts the page (extraction OK)", async () => {
    const t = transport(() => html(articlePage()));
    const res = await fetchReadableArticle(URL_, { resolve: publicDns, fetchImpl: t.fetchImpl });
    expect(res.ok).toBe(true);
    expect(t.sent).toEqual([URL_]);
  });

  it.each([
    [403, "HTTP 403"],
    [404, "HTTP 404"],
    [500, "HTTP 500"],
  ])("fails on HTTP %i", async (status, error) => {
    const t = transport(() => html("Forbidden", { status }));
    expect(await fetchReadableArticle(URL_, { resolve: publicDns, fetchImpl: t.fetchImpl })).toEqual({ ok: false, error });
  });

  it("fails on a non-HTML document", async () => {
    const t = transport(() => new Response("%PDF-1.7", { headers: { "content-type": "application/pdf" } }));
    expect(await fetchReadableArticle(URL_, { resolve: publicDns, fetchImpl: t.fetchImpl })).toEqual({
      ok: false,
      error: "Pas une page HTML (application/pdf)",
    });
  });

  it("fails on a page larger than 2 MB (stopped during the download)", async () => {
    const t = transport(() => html("x".repeat(MAX_PAGE_BYTES + 1)));
    expect(await fetchReadableArticle(URL_, { resolve: publicDns, fetchImpl: t.fetchImpl })).toEqual({
      ok: false,
      error: "Page trop volumineuse (> 2 Mo)",
    });
  });

  it("refuses private addresses, including through a redirect (SSRF)", async () => {
    const t = transport((url) => (url.startsWith("https://blog") ? new Response(null, { status: 302, headers: { location: "http://192.168.1.1/admin" } }) : html(articlePage())));
    const res = await fetchReadableArticle(URL_, { resolve: publicDns, fetchImpl: t.fetchImpl });
    expect(res).toEqual({ ok: false, error: expect.stringMatching(/^Adresse refusée/) });
    expect(t.sent).toEqual([URL_]);

    const internal = transport(() => html(articlePage()));
    const res2 = await fetchReadableArticle("http://intranet.lan/x", {
      resolve: async () => [{ address: "10.0.0.5", family: 4 }],
      fetchImpl: internal.fetchImpl,
    });
    expect(res2.ok).toBe(false);
    expect(internal.sent).toEqual([]);
  });

  it("turns a timeout into a failure", async () => {
    const t = transport(() => {
      throw new DOMException("timeout", "TimeoutError");
    });
    expect(await fetchReadableArticle(URL_, { resolve: publicDns, fetchImpl: t.fetchImpl })).toEqual({
      ok: false,
      error: "Délai dépassé (10 s)",
    });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Resolver } from "@/lib/net/safe-fetch";
import { fetchProxiedImage, MAX_IMAGE_BYTES, sniffProxyImage } from "@/lib/reader/image-proxy";

const getSession = vi.fn();
vi.mock("@/lib/auth", () => ({ getAuth: () => ({ api: { getSession } }) }));
const { GET } = await import("@/app/api/image-proxy/route");

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const GIF = new TextEncoder().encode("GIF89a\x01\x00");
const WEBP = new TextEncoder().encode("RIFF\x00\x00\x00\x00WEBPVP8 ");
const AVIF = Uint8Array.from([0, 0, 0, 0x1c, ...new TextEncoder().encode("ftypavif"), 0, 0, 0, 0, ...new TextEncoder().encode("avifmif1miaf")]);
const ICO = Uint8Array.from([0x00, 0x00, 0x01, 0x00, 0x01, 0x00]);
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

const publicDns: Resolver = async () => [{ address: "93.184.215.14", family: 4 }];
const privateDns =
  (address: string): Resolver =>
  async () => [{ address, family: address.includes(":") ? 6 : 4 }];

function transport(handler: (url: string) => Response) {
  const sent: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    sent.push(String(input));
    return handler(String(input));
  }) as typeof fetch;
  return { sent, fetchImpl };
}
const image = (bytes: Uint8Array, type = "image/png") => () => new Response(Buffer.from(bytes), { headers: { "content-type": type } });

describe("sniffProxyImage", () => {
  it("accepts PNG, JPEG, GIF, WebP and AVIF from their bytes", () => {
    expect(sniffProxyImage(PNG)).toBe("image/png");
    expect(sniffProxyImage(JPEG)).toBe("image/jpeg");
    expect(sniffProxyImage(GIF)).toBe("image/gif");
    expect(sniffProxyImage(WEBP)).toBe("image/webp");
    expect(sniffProxyImage(AVIF)).toBe("image/avif");
  });

  it("refuses SVG, ICO, HTML and unknown bytes", () => {
    for (const bytes of [SVG, ICO, new TextEncoder().encode("<!doctype html><script>x</script>"), new Uint8Array()]) {
      expect(sniffProxyImage(bytes)).toBeNull();
    }
  });
});

describe("fetchProxiedImage", () => {
  it("returns the image with the sniffed type, whatever the upstream Content-Type", async () => {
    const t = transport(image(JPEG, "application/octet-stream"));
    const res = await fetchProxiedImage("https://cdn.example.org/a.jpg", { resolve: publicDns, fetchImpl: t.fetchImpl });
    expect(res).toEqual({ ok: true, contentType: "image/jpeg", data: JPEG });
  });

  it("refuses an SVG served as image/png", async () => {
    const t = transport(image(SVG, "image/png"));
    expect(await fetchProxiedImage("https://cdn.example.org/a.png", { resolve: publicDns, fetchImpl: t.fetchImpl })).toMatchObject({
      ok: false,
      status: 415,
    });
  });

  it("refuses images over 5 MB", async () => {
    const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
    big.set(PNG);
    const t = transport(image(big));
    expect(await fetchProxiedImage("https://cdn.example.org/big.png", { resolve: publicDns, fetchImpl: t.fetchImpl })).toMatchObject({
      ok: false,
      status: 413,
    });
  });

  it("refuses missing, non-http and oversized URLs", async () => {
    const t = transport(image(PNG));
    for (const url of [null, "", "x".repeat(5000)]) {
      expect((await fetchProxiedImage(url, { resolve: publicDns, fetchImpl: t.fetchImpl })).ok).toBe(false);
    }
    for (const url of ["file:///etc/passwd", "ftp://cdn.example.org/a.png", "gopher://x/", "not a url"]) {
      expect(await fetchProxiedImage(url, { resolve: publicDns, fetchImpl: t.fetchImpl })).toMatchObject({ ok: false, status: 403 });
    }
    expect(t.sent).toEqual([]);
  });

  describe("SSRF", () => {
    it.each([
      "http://127.0.0.1/a.png",
      "http://localhost.:3000/a.png",
      "http://10.0.0.1/a.png",
      "http://192.168.1.50:8080/api/health",
      "http://169.254.169.254/latest/meta-data/",
      "http://[::1]/a.png",
      "http://[::ffff:127.0.0.1]/a.png",
      "http://0x7f.1/a.png",
    ])("refuses %s without sending anything", async (url) => {
      const t = transport(image(PNG));
      const res = await fetchProxiedImage(url, { resolve: privateDns("127.0.0.1"), fetchImpl: t.fetchImpl });
      expect(res).toMatchObject({ ok: false, status: 403 });
      expect(t.sent).toEqual([]);
    });

    it.each(["10.1.2.3", "192.168.1.20", "169.254.169.254", "fd00::1"])(
      "refuses a public-looking host resolving to %s",
      async (address) => {
        const t = transport(image(PNG));
        const res = await fetchProxiedImage("https://images.evil.example/a.png", { resolve: privateDns(address), fetchImpl: t.fetchImpl });
        expect(res).toMatchObject({ ok: false, status: 403 });
        expect(t.sent).toEqual([]);
      },
    );

    it("refuses a redirect to an internal address", async () => {
      const t = transport((url) =>
        url.startsWith("https://cdn") ? new Response(null, { status: 302, headers: { location: "http://192.168.1.1/a.png" } }) : image(PNG)(),
      );
      const res = await fetchProxiedImage("https://cdn.example.org/a.png", { resolve: publicDns, fetchImpl: t.fetchImpl });
      expect(res).toMatchObject({ ok: false, status: 403 });
      expect(t.sent).toEqual(["https://cdn.example.org/a.png"]);
    });
  });
});

describe("GET /api/image-proxy", () => {
  beforeEach(() => getSession.mockReset());
  const call = (url: string) => GET(new Request(`https://veille.example/api/image-proxy?url=${encodeURIComponent(url)}`));

  it("requires a session", async () => {
    getSession.mockResolvedValue(null);
    const res = await call("https://cdn.example.org/a.png");
    expect(res.status).toBe(401);
  });

  it("refuses internal URLs (real resolver and transport, nothing is fetched)", async () => {
    getSession.mockResolvedValue({ user: { id: "u" } });
    for (const url of ["http://127.0.0.1:3000/api/health", "http://169.254.169.254/latest/meta-data/", "http://[::1]/", "file:///etc/passwd"]) {
      const res = await call(url);
      expect(res.status, url).toBe(403);
      expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
      expect(await res.text()).toBe("");
    }
  });

  it("refuses a missing url parameter", async () => {
    getSession.mockResolvedValue({ user: { id: "u" } });
    const res = await GET(new Request("https://veille.example/api/image-proxy"));
    expect(res.status).toBe(400);
  });
});

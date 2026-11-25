import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isPublicAddress, MAX_REDIRECTS, readLimited, safeFetch, SsrfError, type Resolver } from "@/lib/net/safe-fetch";

const PUBLIC_IP = "93.184.215.14";
const publicDns: Resolver = async () => [{ address: PUBLIC_IP, family: 4 }];
const dnsTo =
  (...addresses: string[]): Resolver =>
  async () =>
    addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));

/** Fake transport recording every request actually sent. */
function transport(handler: (url: string) => Response) {
  const sent: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    sent.push(String(input));
    return handler(String(input));
  }) as typeof fetch;
  return { sent, fetchImpl };
}
const ok = () => new Response("ok");
const redirect = (location: string, status = 302) => new Response(null, { status, headers: { location } });

// ---------------------------------------------------------------------------

describe("isPublicAddress", () => {
  it.each([PUBLIC_IP, "1.1.1.1", "172.15.255.255", "172.32.0.0", "2606:4700:4700::1111"])("accepts public %s", (ip) => {
    expect(isPublicAddress(ip)).toBe(true);
  });
});

describe("refused addresses (literal IP in the URL)", () => {
  it.each([
    ["10/8", "http://10.0.0.1/"],
    ["10/8 (upper bound)", "http://10.255.255.255/"],
    ["172.16/12", "http://172.16.0.1/"],
    ["172.16/12 (upper bound)", "http://172.31.255.255/"],
    ["192.168/16", "http://192.168.1.1/"],
    ["127/8", "http://127.0.0.1/"],
    ["127/8 (other)", "http://127.8.8.8/"],
    ["127/8 written in decimal", "http://2130706433/"],
    ["127/8 written in hex", "http://0x7f.1/"],
    ["169.254/16 (cloud metadata)", "http://169.254.169.254/latest/meta-data/"],
    ["0.0.0.0/8", "http://0.0.0.0/"],
    ["100.64/10 (CGNAT)", "http://100.64.0.1/"],
    ["224/4 (multicast)", "http://224.0.0.1/"],
    ["240/4 (reserved)", "http://240.0.0.1/"],
    ["broadcast", "http://255.255.255.255/"],
    ["TEST-NET", "http://192.0.2.1/"],
    ["::1", "http://[::1]/"],
    ["fc00::/7", "http://[fc00::1]/"],
    ["fc00::/7 (fd…)", "http://[fd12:3456::1]/"],
    ["fe80::/10", "http://[fe80::1]/"],
    ["IPv4-mapped loopback", "http://[::ffff:127.0.0.1]/"],
    ["IPv4-mapped private", "http://[::ffff:192.168.0.1]/"],
    ["unspecified ::", "http://[::]/"],
  ])("%s → %s", async (_label, url) => {
    const t = transport(ok);
    await expect(safeFetch(url, { resolve: publicDns, fetchImpl: t.fetchImpl })).rejects.toBeInstanceOf(SsrfError);
    expect(t.sent).toEqual([]);
  });
});

describe("refused addresses (host resolved by DNS)", () => {
  it.each([
    ["10/8", "10.1.2.3"],
    ["172.16/12", "172.20.0.5"],
    ["192.168/16", "192.168.0.10"],
    ["127/8", "127.0.0.1"],
    ["169.254/16", "169.254.1.1"],
    ["::1", "::1"],
    ["fc00::/7", "fd00::5"],
    ["fe80::/10", "fe80::abcd"],
  ])("host resolving to %s (%s)", async (_label, ip) => {
    const t = transport(ok);
    await expect(safeFetch("https://intranet.example.com/", { resolve: dnsTo(ip), fetchImpl: t.fetchImpl })).rejects.toThrow(
      /non publique/,
    );
    expect(t.sent).toEqual([]);
  });

  it("host with one public and one private address", async () => {
    const t = transport(ok);
    await expect(
      safeFetch("https://mixed.example.com/", { resolve: dnsTo(PUBLIC_IP, "192.168.1.1"), fetchImpl: t.fetchImpl }),
    ).rejects.toBeInstanceOf(SsrfError);
    expect(t.sent).toEqual([]);
  });

  it("host that does not resolve", async () => {
    const t = transport(ok);
    const failing: Resolver = async () => {
      throw new Error("ENOTFOUND");
    };
    await expect(safeFetch("https://nope.invalid/", { resolve: failing, fetchImpl: t.fetchImpl })).rejects.toThrow(/DNS/);
  });
});

describe("refused schemes", () => {
  it.each(["ftp://example.com/favicon.ico", "file:///etc/passwd", "data:image/png;base64,AAAA", "gopher://example.com/", "javascript:alert(1)"])(
    "%s",
    async (url) => {
      const t = transport(ok);
      await expect(safeFetch(url, { resolve: publicDns, fetchImpl: t.fetchImpl })).rejects.toThrow(/Protocole refusé/);
      expect(t.sent).toEqual([]);
    },
  );
});

describe("redirects (followed manually, re-checked at every hop)", () => {
  it("follows up to 3 redirects to public hosts", async () => {
    const t = transport((url) => {
      const n = Number(new URL(url).searchParams.get("n") ?? 0);
      return n < MAX_REDIRECTS ? redirect(`/next?n=${n + 1}`) : ok();
    });
    const res = await safeFetch("https://site.example.com/start", { resolve: publicDns, fetchImpl: t.fetchImpl });
    expect(res.status).toBe(200);
    expect(t.sent).toHaveLength(MAX_REDIRECTS + 1);
  });

  it("refuses a 4th redirect", async () => {
    const t = transport((url) => redirect(`${url.split("?")[0]}?r=${Math.random()}`));
    await expect(safeFetch("https://loop.example.com/", { resolve: publicDns, fetchImpl: t.fetchImpl })).rejects.toThrow(
      /Trop de redirections/,
    );
    expect(t.sent).toHaveLength(MAX_REDIRECTS + 1);
  });

  it("refuses a redirect to a private IP", async () => {
    const t = transport(() => redirect("http://192.168.1.1/admin"));
    await expect(safeFetch("https://evil.example.com/favicon.ico", { resolve: publicDns, fetchImpl: t.fetchImpl })).rejects.toThrow(
      /non publique/,
    );
    expect(t.sent).toEqual(["https://evil.example.com/favicon.ico"]);
  });

  it("refuses a redirect to a host resolving to loopback", async () => {
    const resolve: Resolver = async (host) => (host === "internal.example.com" ? [{ address: "127.0.0.1", family: 4 }] : publicDns(host));
    const t = transport(() => redirect("https://internal.example.com/", 301));
    await expect(safeFetch("https://evil.example.com/", { resolve, fetchImpl: t.fetchImpl })).rejects.toBeInstanceOf(SsrfError);
    expect(t.sent).toHaveLength(1);
  });

  it("refuses a redirect to a non-http scheme", async () => {
    const t = transport(() => redirect("file:///etc/passwd"));
    await expect(safeFetch("https://evil.example.com/", { resolve: publicDns, fetchImpl: t.fetchImpl })).rejects.toThrow(
      /Protocole refusé/,
    );
  });
});

describe("size limit enforced while streaming", () => {
  it("cuts an endless body as soon as it exceeds the limit", async () => {
    const CHUNK = 8 * 1024;
    let pulled = 0;
    let cancelled = false;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += CHUNK;
        controller.enqueue(new Uint8Array(CHUNK));
      },
      cancel() {
        cancelled = true;
      },
    });
    const max = 100 * 1024;
    expect(await readLimited(new Response(endless), max)).toBeNull();
    expect(cancelled).toBe(true);
    expect(pulled).toBeLessThanOrEqual(max + 2 * CHUNK); // stopped right after the limit, not at the end
  });

  it("refuses a declared Content-Length above the limit without reading", async () => {
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        controller.enqueue(new Uint8Array(1024));
      },
    });
    const res = new Response(body, { headers: { "content-length": String(10 * 1024 * 1024) } });
    expect(await readLimited(res, 100 * 1024)).toBeNull();
    expect(pulled).toBeLessThanOrEqual(1);
  });

  it("returns small bodies intact", async () => {
    expect(await readLimited(new Response(new Uint8Array([1, 2, 3])), 100)).toEqual(new Uint8Array([1, 2, 3]));
  });
});

describe("connection-time guard (real sockets, no injected transport)", () => {
  let server: http.Server;
  let port = 0;
  let hits = 0;

  beforeAll(async () => {
    server = http.createServer((_req, res) => {
      hits++;
      res.end("secret");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => {
    server.close();
  });

  it("refuses a literal loopback IP before connecting", async () => {
    await expect(safeFetch(`http://127.0.0.1:${port}/`)).rejects.toBeInstanceOf(SsrfError);
    expect(hits).toBe(0);
  });

  it("refuses DNS rebinding: pre-check sees a public IP, the socket would reach loopback", async () => {
    // The pre-check is fooled on purpose; the guarded lookup of the socket must still refuse.
    await expect(safeFetch(`http://localhost:${port}/`, { resolve: publicDns })).rejects.toThrow();
    expect(hits).toBe(0);
  });
});

describe("POST and extra headers (Ma stack APIs, Web Push)", () => {
  it("sends the method, headers and body; a POST never follows a redirect", async () => {
    const seen: RequestInit[] = [];
    const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
      seen.push(init ?? {});
      return new Response(null, { status: 307, headers: { location: "http://127.0.0.1/" } });
    }) as typeof fetch;
    const body = new Uint8Array([1, 2, 3]);
    const res = await safeFetch("https://push.example.com/send/1", { method: "POST", headers: { TTL: "60" }, body, resolve: publicDns, fetchImpl });
    expect(res.status).toBe(307);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ method: "POST", redirect: "manual", body });
    expect((seen[0]!.headers as Record<string, string>).TTL).toBe("60");
  });
});

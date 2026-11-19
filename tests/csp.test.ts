import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { pageCsp } from "@/lib/csp";
import { proxy } from "@/proxy";

const withSession = (path: string) =>
  new NextRequest(`https://veille.example${path}`, { headers: { cookie: "better-auth.session_token=abc.def" } });

function directives(csp: string): Record<string, string> {
  return Object.fromEntries(csp.split(";").map((d) => d.trim().split(/\s+(.*)/s).slice(0, 2) as [string, string]));
}

describe("pageCsp", () => {
  it("is strict: nonce scripts, images from our origin only, no plugins, frames or foreign forms", () => {
    const d = directives(pageCsp("abc", false));
    expect(d["script-src"]).toBe("'self' 'nonce-abc' 'strict-dynamic'");
    expect(d["img-src"]).toBe("'self'");
    expect(d["default-src"]).toBe("'self'");
    expect(d["object-src"]).toBe("'none'");
    expect(d["frame-src"]).toBe("'none'");
    expect(d["frame-ancestors"]).toBe("'none'");
    expect(d["form-action"]).toBe("'self'");
    expect(d["base-uri"]).toBe("'self'");
    expect(pageCsp("abc", false)).not.toMatch(/unsafe-eval|\*|https?:|data:/);
  });

  it("only allows 'unsafe-eval' in dev", () => {
    expect(directives(pageCsp("abc", true))["script-src"]).toContain("'unsafe-eval'");
  });
});

describe("proxy — CSP on pages", () => {
  it("sets a per-request nonce CSP on the topic page, for the browser and for Next.js", () => {
    const first = proxy(withSession("/t/42"));
    const csp = first.headers.get("content-security-policy")!;
    expect(directives(csp)["img-src"]).toBe("'self'");
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
    expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    // Forwarded to the request so Next.js puts the nonce on its scripts.
    expect(first.headers.get("x-middleware-request-content-security-policy")).toBe(csp);

    const second = proxy(withSession("/t/42")).headers.get("content-security-policy")!;
    expect(second).not.toBe(csp);
  });

  it("also covers the other pages (topics are reached by client-side navigation)", () => {
    for (const path of ["/", "/f/ops", "/admin", "/login", "/setup"]) {
      const res = proxy(path === "/login" || path === "/setup" ? new NextRequest(`https://veille.example${path}`) : withSession(path));
      expect(res.headers.get("content-security-policy"), path).toContain("img-src 'self'");
    }
  });

  it("still redirects to /login without a session cookie", () => {
    const res = proxy(new NextRequest("https://veille.example/t/42"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://veille.example/login");
  });
});

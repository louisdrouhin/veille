import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";
import { newNonce, pageCsp } from "@/lib/csp";

const PUBLIC_PAGES = ["/login", "/setup"];

/**
 * 1. Convenience only: redirects visitors without a session cookie to /login.
 *    It does NOT validate the session — every protected layout, page, server
 *    action and API route re-checks it server-side (cf. CVE-2025-29927).
 * 2. Sets the strict, nonce-based CSP (lib/csp.ts) on every page. It must be on
 *    every document, not only /t/…: topics are usually reached by client-side
 *    navigation, which keeps the policy of the document first loaded.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PAGES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (!isPublic && !getSessionCookie(request)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const csp = pageCsp(newNonce());
  // Next.js extracts the nonce from this request header and applies it to its scripts.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  // Public files: the PWA manifest, its icons and the service worker must load
  // without a session (the worker is registered on the login page too). iOS fetches
  // the home-screen icon without cookies, and also tries /apple-touch-icon(-precomposed).png
  // at the root: a redirect to /login there gives the « V » placeholder icon.
  matcher: ["/((?!api/|_next/static/|_next/image|icons/|(?:favicon\.ico|icon\.svg|apple-icon\.png|apple-touch-icon(?:-precomposed)?\.png|manifest\.webmanifest|sw\.js)$).*)"],
};

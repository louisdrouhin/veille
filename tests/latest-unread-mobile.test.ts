/**
 * Home « Derniers non lus » on mobile: only 3 rows below md, hidden in CSS (same HTML on every
 * screen, so no layout jump and no hydration mismatch), plus « + N autres non lus » to unfold.
 */
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { TopicRowData } from "@/components/topic/topic-grid";

vi.mock("next/link", () => ({
  // Plain <a>; the prefetch prop is dropped (not an HTML attribute).
  default: (props: { href: string; prefetch?: boolean }) => {
    const rest: Record<string, unknown> = { ...props };
    delete rest.prefetch;
    return createElement("a", rest);
  },
}));
const { LatestUnreadList, MOBILE_VISIBLE } = await import("@/components/home/latest-unread-list");

const topic = (id: number): TopicRowData => ({
  id,
  title: `Topic ${id}`,
  replyCount: 0,
  lastActivityAt: new Date("2026-11-24T08:00:00Z"),
  read: false,
  sourceName: "CERT-FR",
  faviconSrc: null,
  forum: { name: "Sécurité", slug: "securite" },
});

function render(n: number) {
  const html = renderToString(createElement(LatestUnreadList, { topics: Array.from({ length: n }, (_, i) => topic(i + 1)) }));
  const rows = [...html.matchAll(/<li class="([^"]*)"/g)].map((m) => m[1]!.split(/\s+/).includes("max-md:hidden"));
  return { html, hiddenOnMobile: rows };
}

describe("latest unread topics on mobile", () => {
  it("keeps every topic in the HTML, and hides those after the 3rd below md only", () => {
    expect(MOBILE_VISIBLE).toBe(3);
    const { hiddenOnMobile } = render(8);
    expect(hiddenOnMobile).toEqual([false, false, false, true, true, true, true, true]);
  });

  it("offers « + 5 autres non lus » as a mobile-only, collapsed disclosure button", () => {
    const { html } = render(8);
    const button = /<button[^>]*>[^<]*<\/button>/.exec(html)![0];
    expect(button).toContain('aria-expanded="false"');
    expect(button).toMatch(/aria-controls="[^"]+"/);
    expect(button).toContain("md:hidden");
    expect(button).toContain("+ 5 autres non lus");
  });

  it("singular with 4 topics; no button with 3 or fewer", () => {
    expect(render(4).html).toContain("+ 1 autre non lu<");
    for (const n of [1, 2, 3]) {
      const { html, hiddenOnMobile } = render(n);
      expect(html).not.toContain("<button");
      expect(hiddenOnMobile.every((h) => !h)).toBe(true);
    }
  });
});

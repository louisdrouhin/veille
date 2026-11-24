/** ★ mark of topic rows (docs/design/v3 § 3.8), rendered on the server like a forum list. */
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { TopicRowData } from "@/components/topic/topic-grid";

vi.mock("next/link", () => ({
  default: (props: { href: string; prefetch?: boolean }) => {
    const rest: Record<string, unknown> = { ...props };
    delete rest.prefetch;
    return createElement("a", rest);
  },
}));
const { TopicRow } = await import("@/components/topic/topic-row");

const row = (savedCount?: number): string =>
  renderToString(
    createElement(TopicRow, {
      topic: {
        id: 7,
        title: "Proxmox VE 9.2",
        replyCount: 0,
        lastActivityAt: new Date("2026-11-24T08:00:00Z"),
        read: false,
        hot: true,
        sourceName: "Proxmox Blog",
        faviconSrc: null,
        savedCount,
      } satisfies TopicRowData,
    }),
  );

describe("★ in topic rows", () => {
  it("is labelled with the number of lists, once for mobile (meta line) and once for desktop (after the title)", () => {
    const html = row(2);
    expect(html.match(/role="img" aria-label="Enregistré dans 2 listes" title="Enregistré dans 2 listes"/g)).toHaveLength(2);
    // Desktop copy: right after the title, before the « Chaud » badge.
    expect(html.indexOf("Enregistré dans 2 listes")).toBeLessThan(html.indexOf(">Chaud<"));
  });

  it("singular, and nothing when the topic is in no list", () => {
    expect(row(1)).toContain('aria-label="Enregistré dans 1 liste"');
    expect(row(0)).not.toContain("Enregistré");
    expect(row(undefined)).not.toContain("Enregistré");
  });
});

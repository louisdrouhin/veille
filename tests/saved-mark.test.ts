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
// The row's menu calls server actions: not rendered on the server, only imported.
vi.mock("@/lib/actions/lists", () => ({ getTopicListsAction: vi.fn(), toggleTopicInList: vi.fn(), createList: vi.fn() }));
vi.mock("@/lib/actions/topics", () => ({ setTopicReadAction: vi.fn() }));
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

describe("rows of a favorite list", () => {
  it("show the date of addition and put « retirer » beside the link, not inside it", () => {
    const html = renderToString(
      createElement(TopicRow, {
        topic: {
          id: 9,
          title: "Ceph",
          replyCount: 0,
          lastActivityAt: new Date("2026-11-20T08:00:00Z"),
          addedAt: new Date("2026-11-23T08:00:00Z"),
          read: true,
          sourceName: "LWN",
          faviconSrc: null,
          forum: { name: "Infra", slug: "infra" },
          savedCount: 1,
        } satisfies TopicRowData,
        showForum: true,
        trailing: createElement("button", { type: "button", "aria-label": "Retirer « Ceph » de la liste" }),
      }),
    );
    expect(html.match(/ajouté <!-- -->?<time/g) ?? html.match(/ajouté <time/g)).toHaveLength(2);
    const link = /<a [^>]*href="\/t\/9"[^>]*>[\s\S]*?<\/a>/.exec(html)![0];
    expect(link).not.toContain("Retirer");
    expect(html).toContain('aria-label="Retirer « Ceph » de la liste"');
    expect(html).toMatch(/md:grid-cols-\[28px_minmax\(0,1fr\)_150px_170px_48px_140px_36px\]/);
  });
});

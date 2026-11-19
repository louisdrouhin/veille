import { describe, expect, it } from "vitest";
import { normalizeUrl } from "@/lib/feeds/normalize-url";

describe("normalizeUrl", () => {
  it.each([
    // tracking params
    ["https://example.com/a?utm_source=x&utm_medium=y", "https://example.com/a"],
    ["https://example.com/a?id=3&utm_campaign=z&b=2", "https://example.com/a?id=3&b=2"],
    ["https://example.com/a?UTM_Source=x", "https://example.com/a"],
    ["https://example.com/a?fbclid=abc", "https://example.com/a"],
    ["https://example.com/a?gclid=abc&q=1", "https://example.com/a?q=1"],
    // fragment
    ["https://example.com/a#comments", "https://example.com/a"],
    ["https://example.com/a?x=1#top", "https://example.com/a?x=1"],
    // host & scheme case, default port
    ["https://EXAMPLE.Com/Path", "https://example.com/Path"],
    ["HTTPS://example.com/a", "https://example.com/a"],
    ["https://example.com:443/a", "https://example.com/a"],
    ["http://example.com:80/a", "http://example.com/a"],
    ["http://example.com:8080/a", "http://example.com:8080/a"],
    // trailing slash
    ["https://example.com/a/", "https://example.com/a"],
    ["https://example.com/", "https://example.com"],
    ["https://example.com", "https://example.com"],
    ["https://example.com/a//", "https://example.com/a"],
    ["https://example.com/?q=1", "https://example.com?q=1"],
    // credentials dropped, whitespace trimmed
    ["https://user:pw@example.com/a", "https://example.com/a"],
    ["  https://example.com/a  ", "https://example.com/a"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeUrl(input)).toBe(expected);
  });

  it("keeps the order of non-tracking params", () => {
    expect(normalizeUrl("https://e.com/p?z=1&utm_x=2&a=3&m=4")).toBe("https://e.com/p?z=1&a=3&m=4");
  });

  it("keeps the path case (paths are case-sensitive)", () => {
    expect(normalizeUrl("https://e.com/CVE-2025-29927")).toBe("https://e.com/CVE-2025-29927");
  });

  it("treats variants of the same article as one key", () => {
    const variants = [
      "https://Blog.example.com/post/42/?utm_source=rss#more",
      "https://blog.example.com/post/42?fbclid=xyz",
      "https://blog.example.com:443/post/42",
    ];
    expect(new Set(variants.map(normalizeUrl)).size).toBe(1);
  });

  it.each(["", "not a url", "/relative/path", "ftp://example.com/file", "mailto:a@b.c", "javascript:alert(1)"])(
    "rejects %j",
    (input) => {
      expect(normalizeUrl(input)).toBeNull();
    },
  );
});

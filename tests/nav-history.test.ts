import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backAction, previousUrl, recordNavigation, resetNavigation, shouldIgnoreShortcut } from "@/lib/nav-history";

beforeEach(() => resetNavigation());

describe("recordNavigation", () => {
  it("remembers the page shown before the current one", () => {
    recordNavigation("/");
    expect(previousUrl()).toBeNull();
    recordNavigation("/f/securite?page=3");
    recordNavigation("/t/42");
    expect(previousUrl()).toBe("/f/securite?page=3");
  });

  it("ignores a repeated URL (re-render, refresh)", () => {
    recordNavigation("/f/securite");
    recordNavigation("/t/42");
    recordNavigation("/t/42");
    expect(previousUrl()).toBe("/f/securite");
  });
});

describe("backAction", () => {
  it("opened directly (no in-app history): link to the parent", () => {
    expect(backAction("/f/securite", "parent", null, "/t/42")).toBe("link");
    expect(backAction("/", "any", null, "/admin")).toBe("link");
  });

  it("topic reached from its forum list, any page: history (keeps page and scroll)", () => {
    expect(backAction("/f/securite", "parent", "/f/securite", "/t/42")).toBe("history");
    expect(backAction("/f/securite", "parent", "/f/securite?page=3", "/t/42")).toBe("history");
  });

  it("topic reached from elsewhere (home's last topic, another forum): link to its forum", () => {
    expect(backAction("/f/securite", "parent", "/", "/t/42")).toBe("link");
    expect(backAction("/f/securite", "parent", "/f/infra", "/t/42")).toBe("link");
  });

  it("forum list → home only via history when coming from home", () => {
    expect(backAction("/", "parent", "/", "/f/securite")).toBe("history");
    expect(backAction("/", "parent", "/t/42", "/f/securite")).toBe("link");
  });

  it("admin, account, forms: back to whatever page came before", () => {
    expect(backAction("/", "any", "/t/42", "/admin")).toBe("history");
    expect(backAction("/admin", "any", "/admin", "/admin?edit=3")).toBe("link");
  });

  it("after a server action redirect to the same page (toast), never goes back to itself", () => {
    expect(backAction("/", "any", "/admin?toast=ok&title=x", "/admin")).toBe("link");
    expect(backAction("/f/securite", "parent", "/t/42?toast=ok", "/t/42")).toBe("link");
  });
});

describe("shouldIgnoreShortcut", () => {
  const key = (over: Partial<KeyboardEvent> & { inField?: boolean } = {}) =>
    ({
      key: "u",
      defaultPrevented: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      isComposing: false,
      target: { closest: () => (over.inField ? {} : null) },
      ...over,
    }) as unknown as KeyboardEvent;

  let open: unknown = null;
  beforeEach(() => {
    open = null;
    vi.stubGlobal("document", { querySelector: () => open });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("handles a plain key press on the page", () => {
    expect(shouldIgnoreShortcut(key())).toBe(false);
  });

  it("ignores typing in a field, modifiers, and already handled events", () => {
    expect(shouldIgnoreShortcut(key({ inField: true }))).toBe(true);
    expect(shouldIgnoreShortcut(key({ ctrlKey: true }))).toBe(true);
    expect(shouldIgnoreShortcut(key({ metaKey: true }))).toBe(true);
    expect(shouldIgnoreShortcut(key({ defaultPrevented: true }))).toBe(true);
  });

  it("leaves Escape to an open dialog or menu", () => {
    open = {};
    expect(shouldIgnoreShortcut(key({ key: "Escape" }))).toBe(true);
  });
});

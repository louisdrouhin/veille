/**
 * In-app navigation memory (client only, this document only): the URL of the
 * page shown before the current one, when it was reached by navigating inside
 * the app. Lets "← Retour" use router.back() — which restores the previous
 * page, its pagination and scroll position — only when the browser's previous
 * history entry really is that page; otherwise it links to the parent.
 */
let current: string | null = null;
let previous: string | null = null;

/** Called by <NavigationTracker /> on every URL change. */
export function recordNavigation(url: string) {
  if (url === current) return;
  previous = current;
  current = url;
}

export function previousUrl(): string | null {
  return previous;
}

/** Test helper. */
export function resetNavigation() {
  current = null;
  previous = null;
}

export type BackMode =
  /** Go back only when the previous page is the parent itself (e.g. topic → forum list). */
  | "parent"
  /** Go back to whatever in-app page came before (admin, account, forms). */
  | "any";

/**
 * Decides what "back" does: "history" (router.back()) or "link" (navigate to
 * the parent). `parentHref` may carry a query string: only paths are compared,
 * so a topic opened from page 3 of its forum goes back to page 3.
 * The previous entry must be another page: a server action redirect (toast)
 * pushes the same page again, and going back there would look like a no-op.
 */
export function backAction(
  parentHref: string,
  mode: BackMode,
  prev: string | null = previous,
  now: string | null = current,
): "history" | "link" {
  if (!prev) return "link";
  const path = (u: string) => new URL(u, "http://x").pathname;
  if (now && path(prev) === path(now)) return "link";
  if (mode === "any") return "history";
  return path(prev) === path(parentHref) ? "history" : "link";
}

/** True when a key press must not trigger a page shortcut (typing, modifiers, open dialog). */
export function shouldIgnoreShortcut(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return true;
  const target = event.target as HTMLElement | null;
  if (target?.closest?.("input, textarea, select, [contenteditable=''], [contenteditable='true']")) return true;
  // An open dialog or menu handles Escape itself.
  return document.querySelector("dialog[open], [aria-expanded='true']") !== null;
}

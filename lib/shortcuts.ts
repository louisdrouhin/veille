/**
 * Keyboard shortcuts (docs/design/3.5 § 6), the pure part: which key does what, when they are ignored, the list a
 * topic was opened from (sessionStorage). No server import.
 */
export const G_TARGETS: Record<string, { href: string; label: string }> = {
  h: { href: "/", label: "accueil" },
  f: { href: "/#forums-title", label: "forums" },
  b: { href: "/briefing", label: "briefing" },
  l: { href: "/listes", label: "listes" },
  s: { href: "/stack", label: "Ma stack" },
  p: { href: "/parametres", label: "paramètres" },
};
export const G_TIMEOUT_MS = 1_500;

/** The interrupter of Paramètres › Raccourcis clavier (per device: a keyboard is a device's). */
export const SHORTCUTS_KEY = "folders-shortcuts";

type KeyLike = { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean };
type TargetLike = { tagName?: string; isContentEditable?: boolean; closest?: (s: string) => unknown } | null;

/** Typing in a field: every shortcut is ignored (WCAG 2.1.4). */
export function isTyping(target: TargetLike): boolean {
  if (!target) return false;
  const tag = (target.tagName ?? "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (target.isContentEditable) return true;
  return !!target.closest?.("[contenteditable=''], [contenteditable='true']");
}

export type ShortcutAction =
  | { kind: "help" }
  | { kind: "g" }
  | { kind: "move"; step: 1 | -1 }
  | { kind: "page"; rel: "next" | "prev" }
  | { kind: "row"; key: "Enter" | "newTab" | "o" | "m" | "s" | "C" };

/**
 * The global meaning of a key (rows, pages, help, « g »), or null: modifiers other than Maj are left alone (Ctrl+K,
 * the browser), except Ctrl / ⌘ + Entrée; « / », « u » and Échap belong to the search and the back button.
 */
export function globalAction(e: KeyLike): ShortcutAction | null {
  if (e.altKey) return null;
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) return { kind: "row", key: "newTab" };
  if (e.ctrlKey || e.metaKey) return null;
  switch (e.key) {
    case "?":
      return { kind: "help" };
    case "g":
      return { kind: "g" };
    case "j":
      return { kind: "move", step: 1 };
    case "k":
      return { kind: "move", step: -1 };
    case "n":
      return { kind: "page", rel: "next" };
    case "p":
      return { kind: "page", rel: "prev" };
    case "Enter":
      return { kind: "row", key: "Enter" };
    case "o":
    case "m":
    case "s":
      return { kind: "row", key: e.key };
    case "C":
      return e.shiftKey ? { kind: "row", key: "C" } : null;
    default:
      return null;
  }
}

/** The list a topic was opened from (« Depuis Accueil · Derniers non lus 3 / 21 »), for j / k on the topic page. */
export type Origin = { path: string; label: string; ids: number[]; lastId: number };
export const ORIGIN_KEY = "folders-origin-list";

export function parseOrigin(raw: string | null): Origin | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Partial<Origin>;
    if (typeof o.path !== "string" || !o.path.startsWith("/") || typeof o.label !== "string" || !Array.isArray(o.ids) || typeof o.lastId !== "number") return null;
    const ids = o.ids.filter((x): x is number => Number.isSafeInteger(x) && x > 0).slice(0, 500);
    return { path: o.path.slice(0, 300), label: o.label.slice(0, 120), ids, lastId: o.lastId };
  } catch {
    return null;
  }
}

/** Position of a topic in its origin list, and its neighbours. */
export function positionIn(origin: Origin, topicId: number): { index: number; total: number; prev: number | null; next: number | null } | null {
  const i = origin.ids.indexOf(topicId);
  if (i < 0) return null;
  return { index: i + 1, total: origin.ids.length, prev: origin.ids[i - 1] ?? null, next: origin.ids[i + 1] ?? null };
}

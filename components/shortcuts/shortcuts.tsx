"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { OPEN_SHORTCUTS_EVENT } from "@/components/layout/account-menu";
import { buttonClass } from "@/components/ui/button";
import { G_TARGETS, G_TIMEOUT_MS, globalAction, isTyping, ORIGIN_KEY, parseOrigin, SHORTCUTS_KEY, type Origin } from "@/lib/shortcuts";

const CHANGE_EVENT = "folders-shortcuts-change";
const FINE = "(pointer: fine)";

/** The switch of Paramètres › Raccourcis clavier (on by default), per device. */
export function shortcutsEnabled(): boolean {
  try {
    return window.localStorage.getItem(SHORTCUTS_KEY) !== "off";
  } catch {
    return true;
  }
}
export function setShortcutsEnabled(on: boolean) {
  try {
    if (on) window.localStorage.removeItem(SHORTCUTS_KEY);
    else window.localStorage.setItem(SHORTCUTS_KEY, "off");
  } catch {
    /* private mode: on for this visit */
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}
const subscribe = (l: () => void) => {
  window.addEventListener(CHANGE_EVENT, l);
  window.addEventListener("storage", l);
  return () => {
    window.removeEventListener(CHANGE_EVENT, l);
    window.removeEventListener("storage", l);
  };
};
export function useShortcutsEnabled(): boolean {
  return useSyncExternalStore(subscribe, shortcutsEnabled, () => true);
}

/**
 * Not for us: a field being typed in, a menu or a dialog open (they handle their own keys, the 3.2 context menu
 * included), a coarse pointer (touch screen), or shortcuts turned off.
 */
export function ignoreKey(e: KeyboardEvent): boolean {
  if (e.defaultPrevented || !shortcutsEnabled() || !window.matchMedia(FINE).matches) return true;
  if (isTyping(e.target as Element | null)) return true;
  return !!document.querySelector('[role="menu"], dialog[open]');
}

const rowsOnPage = () => [...document.querySelectorAll<HTMLElement>("[data-topic-row]")].filter((r) => r.getClientRects().length > 0);
const linkOf = (row: Element | null) => row?.querySelector<HTMLAnchorElement>("a[data-topic-link]") ?? null;
const selectedRow = () => document.querySelector<HTMLElement>("[data-kbd-selected]");

/** Selection of a row (docs/design/3.5 § 6): its link gets the focus (one pattern, kept everywhere), scrolled into view. */
export function selectRow(row: HTMLElement, focus = true) {
  selectedRow()?.removeAttribute("data-kbd-selected");
  row.setAttribute("data-kbd-selected", "");
  if (focus) linkOf(row)?.focus({ preventScroll: true });
  row.scrollIntoView({ block: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}

/** The list a topic is opened from: its rows, a label (« Accueil · Derniers non lus »), the topic. */
function rememberOrigin(link: HTMLAnchorElement) {
  const row = link.closest<HTMLElement>("[data-topic-row]");
  if (!row) return;
  const ids = rowsOnPage().map((r) => Number(r.dataset.topicRow)).filter((n) => n > 0);
  const page = document.title.replace(/ · Folders$/, "");
  const section = row.closest("section")?.querySelector("h2")?.textContent?.trim();
  const origin: Origin = { path: window.location.pathname + window.location.search, label: section && section !== page ? `${page} · ${section}` : page, ids, lastId: Number(row.dataset.topicRow) };
  try {
    window.sessionStorage.setItem(ORIGIN_KEY, JSON.stringify(origin));
  } catch {
    /* no position bar then */
  }
}

/** Sends a key to a row as if it had the focus: its own handler (3.2 accelerators: m, o, s, Maj+C, Ctrl+Entrée) acts. */
function keyToRow(row: HTMLElement, init: KeyboardEventInit) {
  (linkOf(row) ?? row).dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
}

export const SHORTCUT_COLUMNS: { title: string; keys: [string[], string][] }[] = [
  {
    title: "Partout",
    keys: [
      [["/"], "rechercher"],
      [["Ctrl", "K"], "rechercher"],
      [["g", "h"], "accueil"],
      [["g", "f"], "forums"],
      [["g", "b"], "briefing"],
      [["g", "l"], "listes"],
      [["g", "s"], "Ma stack"],
      [["g", "p"], "paramètres"],
      [["u"], "remonter d'un niveau (ou Échap)"],
      [["?"], "cette aide"],
    ],
  },
  {
    title: "Listes de topics",
    keys: [
      [["j"], "ligne suivante"],
      [["k"], "ligne précédente"],
      [["Entrée"], "ouvrir le topic"],
      [["Ctrl", "Entrée"], "dans un nouvel onglet"],
      [["o"], "article d'origine"],
      [["m"], "marquer lu / non lu"],
      [["s"], "enregistrer dans une liste"],
      [["Maj", "C"], "copier le lien Folders"],
      [["n"], "page suivante"],
      [["p"], "page précédente"],
    ],
  },
  {
    title: "Page d'un topic",
    keys: [
      [["j"], "topic suivant de la liste"],
      [["k"], "topic précédent de la liste"],
      [["m"], "marquer lu / non lu"],
      [["s"], "enregistrer dans une liste"],
      [["o"], "article d'origine"],
      [["Maj", "C"], "copier le lien Folders"],
      [["Espace"], "défiler"],
    ],
  },
];

/** « ? » (docs/design/3.5 § 6): modal of 940 px, 3 columns, keys in <kbd>; focus trapped, then given back. */
function HelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const back = useRef<Element | null>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      back.current = document.activeElement;
      d.showModal();
    } else if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby="shortcuts-title"
      onClose={() => {
        onClose();
        (back.current as HTMLElement | null)?.focus?.();
      }}
      onClick={(e) => e.target === ref.current && ref.current?.close()}
      className="m-auto w-[min(940px,calc(100vw-24px))] rounded-lg border border-line bg-surface p-5 text-fg shadow-md backdrop:bg-black/40"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="shortcuts-title" className="font-cond text-xl font-bold">
          Raccourcis clavier
        </h2>
        <button type="button" onClick={() => ref.current?.close()} className={buttonClass("secondary")} autoFocus>
          Fermer
        </button>
      </div>
      <div className="mt-4 grid gap-6 md:grid-cols-3">
        {SHORTCUT_COLUMNS.map((c) => (
          <section key={c.title} aria-labelledby={`sc-${c.title}`}>
            <h3 id={`sc-${c.title}`} className="mb-2 font-cond text-sm font-bold tracking-caps text-fg-muted uppercase">
              {c.title}
            </h3>
            <dl className="grid grid-cols-[max-content_1fr] items-center gap-x-3 gap-y-1.5 text-sm">
              {c.keys.map(([keys, label]) => (
                <div key={keys.join("+") + label} className="contents">
                  <dt className="flex gap-1">
                    {keys.map((k) => (
                      <kbd key={k} className="inline-flex h-6 min-w-6 items-center justify-center rounded-sm border border-line-strong bg-surface-alt px-1.5 font-mono text-xs">
                        {k}
                      </kbd>
                    ))}
                  </dt>
                  <dd>{label}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <p className="mt-5 border-t border-line pt-3 text-sm text-fg-muted">
        Inactifs pendant la saisie dans un champ ·{" "}
        <Link href="/parametres/raccourcis" onClick={() => ref.current?.close()} className="font-semibold">
          Désactiver ou voir dans les paramètres
        </Link>
      </p>
    </dialog>
  );
}

/**
 * Global keyboard shortcuts, desktop (docs/design/3.5 § 6). Lists: j / k select a row (its link gets the focus), the
 * actions act on the selected row, else the hovered one; n / p change page. « g » + letter navigates (indicator
 * bottom left, 1.5 s). « ? » opens the help. Topic pages: components/shortcuts/topic-shortcuts.tsx.
 */
export function ShortcutsProvider() {
  const router = useRouter();
  const pathname = usePathname();
  const [help, setHelp] = useState(false);
  const [gPending, setGPending] = useState(false);
  const gTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hovered = useRef<HTMLElement | null>(null);

  const cancelG = useCallback(() => {
    if (gTimer.current) clearTimeout(gTimer.current);
    setGPending(false);
  }, []);

  useEffect(() => {
    const open = () => setHelp(true);
    window.addEventListener(OPEN_SHORTCUTS_EVENT, open);
    return () => window.removeEventListener(OPEN_SHORTCUTS_EVENT, open);
  }, []);

  // Back to a list (u, Échap, the browser's back): the last topic seen is selected again (the scroll is the browser's).
  useEffect(() => {
    let origin: Origin | null = null;
    try {
      origin = parseOrigin(window.sessionStorage.getItem(ORIGIN_KEY));
    } catch {
      origin = null;
    }
    if (!origin || origin.path !== window.location.pathname + window.location.search) return;
    const t = setTimeout(() => {
      const row = document.querySelector<HTMLElement>(`[data-topic-row="${origin!.lastId}"]`);
      if (row) {
        selectedRow()?.removeAttribute("data-kbd-selected");
        row.setAttribute("data-kbd-selected", "");
      }
    }, 0);
    return () => clearTimeout(t);
  }, [pathname]);

  useEffect(() => {
    const onOver = (e: PointerEvent) => {
      hovered.current = (e.target as Element | null)?.closest?.<HTMLElement>("[data-topic-row]") ?? null;
    };
    // A click places the selection (moving the mouse does not).
    const onDown = (e: PointerEvent) => {
      const row = (e.target as Element | null)?.closest?.<HTMLElement>("[data-topic-row]");
      if (row) selectRow(row, false);
    };
    // A topic opened from a list (click, Entrée): its list is remembered for the topic page.
    const onClick = (e: MouseEvent) => {
      const link = (e.target as Element | null)?.closest?.<HTMLAnchorElement>("a[data-topic-link]");
      if (link) rememberOrigin(link);
    };
    document.addEventListener("pointerover", onOver);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("click", onClick, true);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Our own keys sent to a row (keyToRow) must never come back here.
      if (!e.isTrusted) return;
      if (gPending) {
        // The second key of « g »: a known letter navigates, anything else cancels without effect.
        if (e.key === "Shift") return;
        e.preventDefault();
        cancelG();
        const target = !e.ctrlKey && !e.metaKey && !e.altKey ? G_TARGETS[e.key] : undefined;
        if (target) router.push(target.href);
        return;
      }
      if (ignoreKey(e)) return;
      const action = globalAction(e);
      if (!action) return;
      if (action.kind === "help") {
        e.preventDefault();
        setHelp(true);
        return;
      }
      if (action.kind === "g") {
        e.preventDefault();
        setGPending(true);
        gTimer.current = setTimeout(() => setGPending(false), G_TIMEOUT_MS);
        return;
      }
      // Topic pages have their own j / k (the list they were opened from).
      if (window.location.pathname.startsWith("/t/") && action.kind !== "page") return;
      if (action.kind === "page") {
        const link = document.querySelector<HTMLAnchorElement>(`a[rel="${action.rel}"]`);
        if (link) {
          e.preventDefault();
          link.click();
        }
        return;
      }
      const rows = rowsOnPage();
      if (!rows.length) return;
      if (action.kind === "move") {
        e.preventDefault();
        const current = selectedRow() ?? (document.activeElement?.closest?.<HTMLElement>("[data-topic-row]") || null);
        const i = current ? rows.indexOf(current) : -1;
        // The first press selects the first row in view.
        const next = i < 0 ? (rows.find((r) => r.getBoundingClientRect().top >= 80) ?? rows[0]!) : rows[Math.min(rows.length - 1, Math.max(0, i + action.step))]!;
        selectRow(next);
        return;
      }
      // A row action: the focused row handles it itself (3.2); else the selected row, else the hovered one.
      if (document.activeElement?.closest?.("[data-topic-row]")) return;
      const row = selectedRow() ?? hovered.current;
      if (!row || !row.isConnected) return;
      e.preventDefault();
      if (action.key === "Enter") linkOf(row)?.click();
      else if (action.key === "newTab") keyToRow(row, { key: "Enter", ctrlKey: true, metaKey: true });
      else if (action.key === "C") keyToRow(row, { key: "C", shiftKey: true });
      else keyToRow(row, { key: action.key });
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [gPending, cancelG, router]);

  return (
    <>
      {gPending && (
        <p role="status" className="fixed bottom-[calc(env(safe-area-inset-bottom)+16px)] left-4 z-50 rounded-md border border-line-strong bg-surface px-3 py-2 text-sm shadow-md">
          <kbd className="font-mono font-semibold">g</kbd> puis{" "}
          {Object.entries(G_TARGETS)
            .map(([k, t]) => `${k} ${t.label}`)
            .join(" · ")}
        </p>
      )}
      <HelpDialog open={help} onClose={() => setHelp(false)} />
    </>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ListPickerContent, type PickerStatus } from "@/components/lists/list-picker-content";
import { ListPickerPopover, POPOVER_WIDTH } from "@/components/lists/list-picker-popover";
import { ListSwatch } from "@/components/lists/list-swatch";
import { savedStateOf, useSavedCount, type SavedState } from "@/components/lists/saved-state";
import { Star } from "@/components/lists/star";
import { useSavedLists } from "@/components/lists/use-saved-lists";
import { IconCheck, IconChevronRight, IconClipboard, IconClose, IconExternal } from "@/components/ui/icons";
import { getTopicListsAction } from "@/lib/actions/lists";
import { setTopicReadAction } from "@/lib/actions/topics";
import { showToast } from "@/lib/toast-client";
import { FolderIcon } from "./folder-icon";
import { useReadTopics } from "./read-topics";
import type { TopicRowData } from "./topic-grid";

/**
 * Context menu of the topic rows, desktop only (docs/design/3.2): right click, the row's ⋯ button,
 * the Menu key or Shift+F10. One menu for the whole page (TopicMenuProvider, in the protected
 * layout), built on the native popover API (top layer, no dependency) with the menu pattern of
 * ARIA: role="menu", arrows, Home / End, typeahead, Escape, focus back on the trigger. Every
 * action applies on the client at once, without revalidatePath nor router.refresh: the page and
 * its scroll stay.
 */

/** ≥ md with a fine pointer: the only place with this menu (`desk:` in app/globals.css). */
export const DESK_QUERY = "(min-width: 48rem) and (pointer: fine)";
const MENU_WIDTH = 284;
const SUB_WIDTH = 248;
const EDGE = 8;

export type MenuContext = "forum" | "home" | "list";
export type RowMenu = { context: MenuContext; list?: { id: number; name: string }; onRemove?: () => void };

export type MenuRequest = {
  topic: TopicRowData;
  /** Read state shown by the row (this visit's change included). */
  read: boolean;
  menu: RowMenu;
  row: HTMLElement;
  button: HTMLElement | null;
  /** Cursor (right click); else anchored under the ⋯ button. */
  point: { x: number; y: number } | null;
  via: "pointer" | "button" | "keyboard";
  /** « E »: open the lists submenu at once. */
  submenu?: boolean;
};

type Accelerator = "newTab" | "toggleRead" | "article" | "copyArticle" | "copyFolders" | "remove" | "lists";

type TopicMenuApi = {
  openFor: number | null;
  open: (req: MenuRequest) => void;
  /** A shortcut on a focused row, menu closed. */
  run: (req: MenuRequest, action: Accelerator) => void;
};

const TopicMenuContext = createContext<TopicMenuApi>({ openFor: null, open: () => {}, run: () => {} });

export function useTopicMenu(): TopicMenuApi {
  return useContext(TopicMenuContext);
}

const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const linkOf = (row: Element | null) => row?.querySelector<HTMLElement>("a[data-topic-link]") ?? null;

/** Keyboard shortcut of a focused row (no field focused), or null. */
export function rowAccelerator(e: Pick<KeyboardEvent, "key" | "shiftKey" | "ctrlKey" | "metaKey" | "altKey">, context: MenuContext): Accelerator | "menu" | null {
  if (e.altKey) return null;
  if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) return "menu";
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) return "newTab";
  if (e.ctrlKey || e.metaKey) return null;
  const k = e.key;
  if (k === "m" || k === "M") return e.shiftKey ? null : "toggleRead";
  if (k === "e" || k === "E") return e.shiftKey ? null : "lists";
  if (k === "o" || k === "O") return e.shiftKey ? null : "article";
  if (k === "c") return "copyArticle";
  if (k === "C") return e.shiftKey ? "copyFolders" : "copyArticle";
  if (k === "Delete") return context === "list" ? "remove" : null;
  return null;
}

/** Menu position: at the cursor (+2 px), else under the anchor aligned right; flipped and kept 8 px inside. */
export function placeMenu(
  size: { w: number; h: number },
  view: { w: number; h: number },
  at: { point: { x: number; y: number } } | { anchor: { left: number; right: number; top: number; bottom: number } },
): { left: number; top: number } {
  let left: number;
  let top: number;
  if ("point" in at) {
    const { x, y } = at.point;
    left = x + 2 + size.w > view.w - EDGE ? x - size.w : x + 2;
    top = y + 2 + size.h > view.h - EDGE ? y - size.h : y + 2;
  } else {
    const a = at.anchor;
    left = a.right - size.w;
    top = a.bottom + 4 + size.h > view.h - EDGE ? a.top - 4 - size.h : a.bottom + 4;
  }
  return {
    // A menu taller than the window: its top stays visible (8 px), the rest overflows.
    left: Math.round(Math.max(EDGE, Math.min(left, view.w - EDGE - size.w))),
    top: Math.round(Math.max(EDGE, Math.min(top, view.h - EDGE - size.h))),
  };
}

/** Submenu: right of the menu, aligned on its item (−5 px), else left of the menu; kept 8 px inside. */
export function placeSubmenu(
  size: { w: number; h: number },
  view: { w: number; h: number },
  menu: { left: number; right: number },
  item: { top: number },
): { left: number; top: number } {
  const left = menu.right + size.w <= view.w - EDGE ? menu.right - 1 : menu.left - size.w + 1;
  const top = Math.max(EDGE, Math.min(item.top - 5, view.h - EDGE - size.h));
  return { left: Math.round(Math.max(EDGE, left)), top: Math.round(top) };
}

async function copy(text: string, title: string) {
  try {
    await navigator.clipboard.writeText(text);
    showToast({ kind: "ok", title, durationMs: 2000 });
  } catch {
    showToast({ kind: "error", title: "Impossible de copier le lien" });
  }
}

export function TopicMenuProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { setRead } = useReadTopics();
  const [req, setReq] = useState<MenuRequest | null>(null);
  const [save, setSave] = useState<{ topicId: number; initial: SavedState; anchor: HTMLElement; row: HTMLElement } | null>(null);
  const flash = useRef(false);

  const flashRow = useCallback((row: HTMLElement) => {
    if (reducedMotion()) return;
    row.classList.remove("animate-saved-flash");
    void row.offsetWidth; // restart the animation
    row.classList.add("animate-saved-flash");
    row.addEventListener("animationend", () => row.classList.remove("animate-saved-flash"), { once: true });
  }, []);

  const actions = useMemo(
    () => ({
      open: (r: MenuRequest) => router.push(`/t/${r.topic.id}`),
      newTab: (r: MenuRequest) => void window.open(`/t/${r.topic.id}`, "_blank", "noopener"),
      article: (r: MenuRequest) => {
        if (r.topic.url) window.open(r.topic.url, "_blank", "noopener,noreferrer");
      },
      copyArticle: (r: MenuRequest) => {
        if (r.topic.url) void copy(r.topic.url, "Lien de l'article copié");
      },
      copyFolders: (r: MenuRequest) => void copy(new URL(`/t/${r.topic.id}`, window.location.origin).href, "Lien Folders copié"),
      toggleRead: (r: MenuRequest) => {
        const next = !r.read;
        const change = setRead(r.topic.id, next, r.read, r.topic.forumSlug);
        void setTopicReadAction(r.topic.id, next).then(
          (res) => {
            if (res.ok) change.confirm(res.at);
            else {
              change.rollback();
              showToast({ kind: "error", title: "Lu / non lu :", msg: res.error });
            }
          },
          () => {
            change.rollback();
            showToast({ kind: "error", title: "Lu / non lu :", msg: "Enregistrement impossible, réessaie." });
          },
        );
      },
      remove: (r: MenuRequest) => {
        if (!r.menu.onRemove) return;
        // Focus: the next row, or the previous one if it was the last.
        const target = r.row.nextElementSibling ?? r.row.previousElementSibling;
        const done = () => {
          r.menu.onRemove?.();
          requestAnimationFrame(() => linkOf(target)?.focus());
        };
        if (reducedMotion()) return done();
        const h = r.row.getBoundingClientRect().height;
        r.row.style.overflow = "hidden";
        r.row.animate([{ height: `${h}px`, opacity: 1 }, { height: "0px", opacity: 0, paddingTop: "0px", paddingBottom: "0px" }], { duration: 200, easing: "ease-in", fill: "forwards" }).finished.then(done, done);
      },
    }),
    [router, setRead],
  );

  const close = useCallback(
    (current: MenuRequest, focus: "trigger" | "none" = "trigger") => {
      if (flash.current) flashRow(current.row);
      flash.current = false;
      if (focus === "trigger") {
        const target = current.via === "pointer" ? linkOf(current.row) : (current.button ?? linkOf(current.row));
        requestAnimationFrame(() => target?.focus());
      }
      setReq(null);
    },
    [flashRow],
  );

  const open = useCallback((r: MenuRequest) => {
    flash.current = false;
    setReq(r);
  }, []);

  const run = useCallback(
    (r: MenuRequest, a: Accelerator) => {
      if (a === "lists") return open({ ...r, submenu: true });
      actions[a](r);
    },
    [actions, open],
  );

  const api = useMemo<TopicMenuApi>(() => ({ openFor: req?.topic.id ?? null, open, run }), [req, open, run]);

  return (
    <TopicMenuContext value={api}>
      {children}
      {req && (
        <TopicMenu
          key={`${req.topic.id}:${req.via}:${req.point?.x ?? ""}:${req.point?.y ?? ""}`}
          req={req}
          onClose={(focus) => close(req, focus)}
          onSaved={() => {
            flash.current = true;
          }}
          onAction={(a) => {
            const r = req;
            close(r, a === "remove" || a === "open" ? "none" : "trigger");
            if (a === "open") actions.open(r);
            else actions[a](r);
          }}
          onNewList={(initial) => {
            const r = req;
            close(r, "none");
            setSave({ topicId: r.topic.id, initial, anchor: r.button && r.via !== "pointer" ? r.button : r.row, row: r.row });
          }}
        />
      )}
      {save && (
        <SavePopover
          key={save.topicId}
          {...save}
          onClosed={(saved) => {
            if (saved) flashRow(save.row);
            const target = save.anchor.tagName === "BUTTON" ? save.anchor : linkOf(save.row);
            setSave(null);
            requestAnimationFrame(() => target?.focus());
          }}
        />
      )}
    </TopicMenuContext>
  );
}

type ItemDef =
  | { kind: "item"; id: Exclude<Accelerator, "lists"> | "open"; label: string; shortcut?: string; keys?: string; icon: React.ReactNode; danger?: boolean }
  | { kind: "lists" }
  | { kind: "sep" };

function TopicMenu({
  req,
  onClose,
  onAction,
  onSaved,
  onNewList,
}: {
  req: MenuRequest;
  onClose: (focus?: "trigger" | "none") => void;
  onAction: (a: Exclude<Accelerator, "lists"> | "open") => void;
  onSaved: () => void;
  onNewList: (initial: SavedState) => void;
}) {
  const { topic, read, menu } = req;
  const ref = useRef<HTMLDivElement>(null);
  const listsItem = useRef<HTMLButtonElement>(null);
  const [sub, setSub] = useState<"closed" | "hover" | "keyboard">(req.submenu ? "keyboard" : "closed");
  const [lists, setLists] = useState<SavedState | "loading" | "error">(() => savedStateOf(topic.id) ?? "loading");
  const savedCount = useSavedCount(topic.id, topic.savedCount ?? 0);
  const mod = isMac() ? "⌘" : "Ctrl";

  // The lists of the topic, fetched once per opening (unless this visit already knows them).
  useEffect(() => {
    if (lists !== "loading") return;
    let alive = true;
    void getTopicListsAction(topic.id).then(
      (res) => alive && setLists(res.ok ? { lists: res.lists, selected: res.selected } : "error"),
      () => alive && setLists("error"),
    );
    return () => {
      alive = false;
    };
  }, [lists, topic.id]);

  const items: ItemDef[] = [
    { kind: "item", id: "open", label: "Ouvrir le topic", shortcut: "Entrée", icon: <IconChevronRight size={16} /> },
    { kind: "item", id: "newTab", label: "Ouvrir dans un nouvel onglet", shortcut: `${mod}+Entrée`, keys: isMac() ? "Meta+Enter" : "Control+Enter", icon: <IconExternal size={16} /> },
    { kind: "sep" },
    {
      kind: "item",
      id: "toggleRead",
      label: read ? "Marquer comme non lu" : "Marquer comme lu",
      shortcut: "M",
      keys: "m",
      icon: (
        <span aria-hidden>
          <FolderIcon state={read ? "unread" : "read"} size={16} />
        </span>
      ),
    },
    { kind: "lists" },
    ...(topic.url
      ? ([
          { kind: "sep" },
          { kind: "item", id: "article", label: "Ouvrir l'article d'origine ↗", shortcut: "O", keys: "o", icon: <IconExternal size={16} /> },
          { kind: "sep" },
          { kind: "item", id: "copyArticle", label: "Copier le lien de l'article", shortcut: "C", keys: "c", icon: <IconClipboard size={16} /> },
        ] satisfies ItemDef[])
      : [{ kind: "sep" } satisfies ItemDef]),
    { kind: "item", id: "copyFolders", label: "Copier le lien Folders", shortcut: "Maj+C", keys: "Shift+C", icon: <IconClipboard size={16} /> },
    ...(menu.context === "list" && menu.list && menu.onRemove
      ? ([
          { kind: "sep" },
          { kind: "item", id: "remove", label: `Retirer de « ${menu.list.name} »`, shortcut: "Suppr", keys: "Delete", icon: <IconClose size={16} />, danger: true },
        ] satisfies ItemDef[])
      : []),
  ];

  const subId = `topic-menu-sub-${topic.id}`;
  const focusables = () => [...(ref.current?.querySelectorAll<HTMLElement>("[data-menu-item]") ?? [])];

  // Open: positioned, shown in the top layer, focus on the first item (or the submenu, « E »).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.showPopover();
    const size = { w: el.offsetWidth || MENU_WIDTH, h: el.offsetHeight };
    const view = { w: window.innerWidth, h: window.innerHeight };
    const b = req.button?.getBoundingClientRect();
    const anchor = b && b.width > 0 ? b : req.row.getBoundingClientRect();
    const pos = req.point ? placeMenu(size, view, { point: req.point }) : placeMenu(size, view, { anchor });
    el.style.left = `${pos.left}px`;
    el.style.top = `${pos.top}px`;
    if (!req.submenu) focusables()[0]?.focus();
    return () => {
      if (el.matches(":popover-open")) el.hidePopover();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per opening (the provider keys this component)
  }, []);

  // Closes on a pointer down outside, a scroll of the page, a resize or leaving the window.
  useEffect(() => {
    const inside = (t: EventTarget | null) => t instanceof Node && !!(ref.current?.contains(t) || document.getElementById(subId)?.contains(t));
    const onPointer = (e: PointerEvent) => {
      if (!inside(e.target)) onClose("none");
    };
    const onScroll = (e: Event) => {
      if (!inside(e.target)) onClose("none");
    };
    const onLeave = () => onClose("none");
    document.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onLeave);
    window.addEventListener("blur", onLeave);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onLeave);
      window.removeEventListener("blur", onLeave);
    };
  }, [onClose, subId]);

  const label = `Actions pour « ${topic.title} »`;

  function onKeyDown(e: React.KeyboardEvent) {
    // The menu handles every key: nothing reaches the page shortcuts (« u », Escape: back).
    e.stopPropagation();
    if (e.nativeEvent.isComposing) return;
    const all = focusables();
    const i = all.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => all[(n + all.length) % all.length]?.focus();
    const key = e.key;
    if (key === "ArrowDown") go(i + 1);
    else if (key === "ArrowUp") go(i < 0 ? -1 : i - 1);
    else if (key === "Home") go(0);
    else if (key === "End") go(-1);
    else if (key === "Escape" || key === "ContextMenu" || (key === "F10" && e.shiftKey)) onClose("trigger");
    else if (key === "Tab") onClose("trigger");
    else if (key === "ArrowRight" && document.activeElement === listsItem.current) setSub("keyboard");
    else if (key === "ArrowLeft") {
      /* top level: nothing */
    } else if (key === "Enter" && (e.ctrlKey || e.metaKey)) onAction("newTab");
    else if (key === "Enter" || key === " ") (document.activeElement as HTMLElement | null)?.click();
    else {
      const acc = rowAccelerator(e, menu.context);
      if (acc === "lists") setSub("keyboard");
      else if (acc && acc !== "menu" && acc !== "newTab" && (acc !== "article" && acc !== "copyArticle" ? true : !!topic.url)) onAction(acc);
      else if (key.length === 1 && /\S/.test(key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // Typeahead: the next item starting with this letter.
        const k = key.toLocaleLowerCase("fr");
        const order = [...all.slice(i + 1), ...all.slice(0, i + 1)];
        order.find((el) => (el.dataset.label ?? "").toLocaleLowerCase("fr").startsWith(k))?.focus();
      } else return;
    }
    e.preventDefault();
  }

  return (
    <>
      <div
        ref={ref}
        popover="manual"
        role="menu"
        aria-label={label}
        aria-orientation="vertical"
        onKeyDown={onKeyDown}
        onContextMenu={(e) => e.preventDefault()}
        className="fixed m-0 w-max max-w-[340px] min-w-[284px] overflow-visible rounded-md border border-line-strong bg-surface p-0 py-1 text-fg shadow-md [inset:auto]"
      >
        <div role="presentation" className="mb-1 truncate border-b border-line px-3 pt-1 pb-1.5 text-xs text-fg-muted">
          {topic.title}
        </div>
        {items.map((it, i) =>
          it.kind === "sep" ? (
            <div key={`sep-${i}`} role="separator" className="my-1 border-t border-line" />
          ) : it.kind === "lists" ? (
            <button
              key="lists"
              ref={listsItem}
              type="button"
              role="menuitem"
              tabIndex={-1}
              data-menu-item
              data-label="Enregistrer dans une liste"
              aria-haspopup="menu"
              aria-expanded={sub !== "closed"}
              aria-controls={sub !== "closed" ? subId : undefined}
              aria-keyshortcuts="e ArrowRight"
              onClick={() => setSub("keyboard")}
              onPointerEnter={(e) => {
                e.currentTarget.focus();
                setSub((s) => (s === "closed" ? "hover" : s));
              }}
              className={`${ITEM} ${sub !== "closed" ? "bg-surface-hover" : ""}`}
            >
              <Star filled={savedCount > 0} size={16} className={savedCount > 0 ? "" : "text-fg-muted"} />
              <span className="min-w-0 flex-1 truncate">
                Enregistrer dans une liste
                {savedCount > 0 && <span className="text-fg-muted"> · {savedCount}</span>}
              </span>
              <IconChevronRight size={14} className="text-fg-muted" />
            </button>
          ) : (
            <button
              key={it.id}
              type="button"
              role="menuitem"
              tabIndex={-1}
              data-menu-item
              data-label={it.label}
              aria-keyshortcuts={it.keys}
              onClick={() => onAction(it.id)}
              onPointerEnter={(e) => {
                e.currentTarget.focus();
                setSub((s) => (s === "hover" ? "closed" : s));
              }}
              className={`${ITEM} ${it.danger ? "text-err" : ""}`}
            >
              <span className={`inline-flex shrink-0 ${it.danger ? "text-err" : "text-fg-muted"}`}>{it.icon}</span>
              <span className="min-w-0 flex-1 truncate">{it.label}</span>
              {it.shortcut && <kbd className="font-mono text-[11.5px] text-fg-muted">{it.shortcut}</kbd>}
            </button>
          ),
        )}
      </div>
      {sub !== "closed" && (
        <ListsSubmenu
          id={subId}
          topicId={topic.id}
          lists={lists}
          parent={listsItem}
          menu={ref}
          focusFirst={sub === "keyboard"}
          onBack={() => {
            setSub("closed");
            listsItem.current?.focus();
          }}
          onClose={onClose}
          onSaved={onSaved}
          onNewList={onNewList}
        />
      )}
    </>
  );
}

const ITEM =
  "flex h-8 w-full cursor-pointer items-center gap-2.5 px-3 text-left text-[13.5px] text-fg outline-none hover:bg-surface-hover focus:bg-surface-hover";

function ListsSubmenu({
  id,
  topicId,
  lists,
  parent,
  menu,
  focusFirst,
  onBack,
  onClose,
  onSaved,
  onNewList,
}: {
  id: string;
  topicId: number;
  lists: SavedState | "loading" | "error";
  parent: React.RefObject<HTMLButtonElement | null>;
  menu: React.RefObject<HTMLDivElement | null>;
  focusFirst: boolean;
  onBack: () => void;
  onClose: (focus?: "trigger" | "none") => void;
  onSaved: () => void;
  onNewList: (initial: SavedState) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    const m = menu.current?.getBoundingClientRect();
    const item = parent.current?.getBoundingClientRect();
    if (!el || !m || !item) return;
    el.showPopover();
    const pos = placeSubmenu({ w: SUB_WIDTH, h: el.offsetHeight }, { w: window.innerWidth, h: window.innerHeight }, m, item);
    el.style.left = `${pos.left}px`;
    el.style.top = `${pos.top}px`;
    if (focusFirst) el.querySelector<HTMLElement>("[data-menu-item]")?.focus();
    return () => {
      if (el.matches(":popover-open")) el.hidePopover();
    };
  }, [lists, focusFirst, menu, parent]);

  function onKeyDown(e: React.KeyboardEvent) {
    e.stopPropagation();
    const all = [...(ref.current?.querySelectorAll<HTMLElement>("[data-menu-item]") ?? [])];
    const i = all.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => all[(n + all.length) % all.length]?.focus();
    if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i < 0 ? -1 : i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(-1);
    else if (e.key === "ArrowLeft" || e.key === "Escape") onBack();
    else if (e.key === "Tab") onClose("trigger");
    else if (e.key === "Enter" || e.key === " ") (document.activeElement as HTMLElement | null)?.click();
    else if ((e.key === "n" || e.key === "N") && typeof lists === "object") onNewList(lists);
    else return;
    e.preventDefault();
  }

  return (
    <div
      ref={ref}
      id={id}
      popover="manual"
      role="menu"
      aria-label="Enregistrer dans une liste"
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
      className="fixed m-0 w-[248px] rounded-md border border-line-strong bg-surface p-0 py-1 text-fg shadow-md [inset:auto]"
    >
      {lists === "loading" ? (
        <p role="presentation" className="flex h-8 items-center px-3 text-[13.5px] text-fg-muted">
          Chargement…
        </p>
      ) : lists === "error" ? (
        <p role="presentation" className="px-3 py-1.5 text-[13.5px] text-err">
          Listes indisponibles : réessaie.
        </p>
      ) : (
        <ListsItems topicId={topicId} initial={lists} onSaved={onSaved} onNewList={onNewList} />
      )}
    </div>
  );
}

function ListsItems({ topicId, initial, onSaved, onNewList }: { topicId: number; initial: SavedState; onSaved: () => void; onNewList: (initial: SavedState) => void }) {
  const { state, toggle } = useSavedLists(topicId, initial, (status) => {
    if (status.kind === "error") showToast({ kind: "error", title: "Listes :", msg: status.text });
  });
  const selected = new Set(state.selected);
  return (
    <>
      {/* Same order as the ★ popover; more than 8 lists scroll. */}
      <div className="max-h-[256px] overflow-y-auto overscroll-contain">
        {state.lists.map((l) => {
          const on = selected.has(l.id);
          return (
            <button
              key={l.id}
              type="button"
              role="menuitemcheckbox"
              aria-checked={on}
              tabIndex={-1}
              data-menu-item
              // Checking does not close the menu: several lists in a row.
              onClick={() => {
                if (!on) onSaved();
                toggle(l, !on);
              }}
              onPointerEnter={(e) => e.currentTarget.focus()}
              className={`${ITEM} ${on ? "bg-accent-soft font-semibold hover:bg-accent-soft focus:bg-accent-soft" : ""}`}
            >
              <span aria-hidden className="inline-flex w-3.5 shrink-0 text-accent">
                {on && <IconCheck size={14} />}
              </span>
              <ListSwatch color={l.color} size={10} />
              <span className="min-w-0 flex-1 truncate">{l.name}</span>
              <span className="font-mono text-[11.5px] font-normal text-fg-muted">{l.count}</span>
            </button>
          );
        })}
      </div>
      {state.lists.length > 0 && <div role="separator" className="my-1 border-t border-line" />}
      <button
        type="button"
        role="menuitem"
        tabIndex={-1}
        data-menu-item
        aria-keyshortcuts="n"
        onClick={() => onNewList(state)}
        onPointerEnter={(e) => e.currentTarget.focus()}
        className={`${ITEM} font-semibold text-accent`}
      >
        <span aria-hidden className="inline-flex w-3.5 shrink-0 justify-center text-base leading-none">
          +
        </span>
        <span className="flex-1">Nouvelle liste…</span>
        <kbd className="font-mono text-[11.5px] font-normal text-fg-muted">N</kbd>
      </button>
    </>
  );
}

/** « Nouvelle liste… »: the ★ popover of the topic page, anchored on the row (or ⋯), field open. */
function SavePopover({
  topicId,
  initial,
  anchor,
  onClosed,
}: {
  topicId: number;
  initial: SavedState;
  anchor: HTMLElement;
  row: HTMLElement;
  onClosed: (saved: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [status, setStatus] = useState<PickerStatus>(null);
  const saved = useRef(false);
  const { state, toggle, create } = useSavedLists(topicId, initial, setStatus);
  const [arrow, setArrow] = useState(28);

  useLayoutEffect(() => {
    const pop = ref.current;
    if (!pop) return;
    const r = anchor.getBoundingClientRect();
    // Under the anchor, right-aligned on a ⋯ button, left-aligned on a row's title; kept on screen.
    const want = anchor.tagName === "BUTTON" ? r.right - POPOVER_WIDTH : r.left + 40;
    const left = Math.max(EDGE, Math.min(want, window.innerWidth - POPOVER_WIDTH - EDGE));
    pop.style.left = `${left}px`;
    pop.style.top = `${r.bottom + 8}px`;
    setArrow(Math.max(12, Math.min(POPOVER_WIDTH - 24, (anchor.tagName === "BUTTON" ? r.left + r.width / 2 : r.left + 60) - left - 6)));
    pop.showPopover();
    // autoFocus ran while the popover was still hidden: the name field gets the focus now.
    pop.querySelector<HTMLInputElement>('input:not([type="checkbox"])')?.focus();
    const onToggle = (e: Event) => {
      if ((e as ToggleEvent).newState === "closed") onClosed(saved.current);
    };
    pop.addEventListener("toggle", onToggle);
    return () => pop.removeEventListener("toggle", onToggle);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once: the provider keys this component
  }, []);

  return (
    <ListPickerPopover ref={ref} titleId={titleId} arrowLeft={arrow}>
      <ListPickerContent
        lists={state.lists}
        selected={new Set(state.selected)}
        status={status}
        startAdding
        onToggle={(l, on) => {
          setStatus(null);
          if (on) saved.current = true;
          toggle(l, on);
        }}
        onCreate={(name) => {
          setStatus(null);
          saved.current = true;
          create(name);
        }}
      />
    </ListPickerPopover>
  );
}

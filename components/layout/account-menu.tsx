"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { UserAvatar, type AvatarUser } from "@/components/account/user-avatar";
import { applyTheme, useThemePreference } from "@/components/theme/theme-sync";
import { IconCheck, IconChevronDown, IconLogout } from "@/components/ui/icons";
import { setTheme } from "@/lib/actions/account";
import { authClient } from "@/lib/auth-client";
import { displayName } from "@/lib/profile";
import { clearOfflineData } from "@/lib/pwa/client";
import { THEME_LABEL, type ThemePreference } from "@/lib/theme";

export type MenuUser = AvatarUser & { email: string; theme: ThemePreference };

const THEMES: ThemePreference[] = ["light", "dark", "system"];
type Stop = "settings" | "profile" | "shortcuts" | "theme" | "logout";
const STOPS: Stop[] = ["settings", "profile", "shortcuts", "theme", "logout"];

/** Opens the keyboard shortcuts help (components/shortcuts): an event, so that the menu does not depend on it. */
export const OPEN_SHORTCUTS_EVENT = "folders-open-shortcuts";

const ITEM =
  "flex h-9 w-full cursor-pointer items-center gap-2 rounded-sm px-2.5 text-left text-sm text-fg no-underline outline-none hover:bg-surface-hover focus-visible:bg-accent-soft focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus";

/**
 * Account menu, desktop (docs/design/3.5 § 2): photo, « Prénom Nom », chevron; role="menu" of 300 px under it.
 * Keyboard: Entrée / Espace / ↓ open on the first item; ↑ ↓ move (the Thème group is one stop, ← → change it, applied
 * at once); Échap closes and gives the focus back; Tab closes.
 */
export function AccountMenu({ user }: { user: MenuUser }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // <html data-theme>: also follows a change made in Paramètres › Apparence.
  const theme = useThemePreference(user.theme);
  const [, start] = useTransition();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const refs = useRef<Partial<Record<Stop, HTMLElement | null>>>({});
  const menuId = useId();
  const name = displayName(user);

  const focusStop = (s: Stop) => refs.current[s]?.focus();
  const close = (focusButton = true) => {
    setOpen(false);
    if (focusButton) buttonRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && !buttonRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const chooseTheme = (next: ThemePreference) => {
    const previous = theme;
    applyTheme(next);
    start(async () => {
      const saved = await setTheme(next).catch(() => ({ ok: false }));
      if (!saved.ok) {
        applyTheme(previous);
      }
    });
  };

  const onMenuKey = (e: React.KeyboardEvent) => {
    const current = STOPS.find((s) => refs.current[s] === document.activeElement || (s === "theme" && refs.current.theme?.contains(document.activeElement)));
    const i = current ? STOPS.indexOf(current) : -1;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = STOPS[(i + (e.key === "ArrowDown" ? 1 : STOPS.length - 1)) % STOPS.length]!;
      focusStop(next);
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      focusStop(e.key === "Home" ? STOPS[0]! : STOPS.at(-1)!);
    } else if (current === "theme" && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      e.preventDefault();
      const j = THEMES.indexOf(theme);
      const next = THEMES[(j + (e.key === "ArrowRight" ? 1 : THEMES.length - 1)) % THEMES.length]!;
      chooseTheme(next);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "Tab") {
      close(false);
    }
  };

  const go = (href: string) => {
    close(false);
    router.push(href);
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Menu du compte : ${name}`}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || ((e.key === "Enter" || e.key === " ") && !open)) {
            e.preventDefault();
            setOpen(true);
            requestAnimationFrame(() => focusStop("settings"));
          }
        }}
        className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-sm px-1.5 text-sm font-medium text-bar-fg hover:bg-white/8 aria-expanded:bg-white/14 focus-visible:outline-bar-accent"
      >
        <UserAvatar user={user} size={30} />
        <span className="max-w-[180px] truncate">{name}</span>
        <IconChevronDown size={14} className="text-bar-muted" />
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="Menu du compte"
          onKeyDown={onMenuKey}
          className="absolute top-[calc(100%+6px)] right-0 z-50 w-[300px] rounded-md border border-line-strong bg-surface p-1.5 text-fg shadow-lg"
        >
          <div className="flex items-center gap-3 px-2.5 pt-1.5 pb-2.5">
            <UserAvatar user={user} size={44} />
            <div className="min-w-0">
              <p className="truncate font-semibold">{name}</p>
              <p className="truncate text-sm text-fg-muted">{user.email}</p>
            </div>
          </div>
          <div role="separator" className="my-1 border-t border-line" />
          <button ref={(el) => void (refs.current.settings = el)} type="button" role="menuitem" tabIndex={-1} className={ITEM} onClick={() => go("/parametres")}>
            Paramètres <kbd className="ml-auto font-mono text-xs text-fg-muted">g p</kbd>
          </button>
          <button ref={(el) => void (refs.current.profile = el)} type="button" role="menuitem" tabIndex={-1} className={ITEM} onClick={() => go("/parametres/profil")}>
            Profil
          </button>
          <button
            ref={(el) => void (refs.current.shortcuts = el)}
            type="button"
            role="menuitem"
            tabIndex={-1}
            className={ITEM}
            onClick={() => {
              close(false);
              window.dispatchEvent(new Event(OPEN_SHORTCUTS_EVENT));
            }}
          >
            Raccourcis clavier <kbd className="ml-auto font-mono text-xs text-fg-muted">?</kbd>
          </button>
          <div role="separator" className="my-1 border-t border-line" />
          <div ref={(el) => void (refs.current.theme = el)} role="group" aria-label="Thème" tabIndex={-1} className="rounded-sm px-2.5 py-1.5 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus">
            <p className="mb-1 text-xs font-semibold text-fg-muted">Thème</p>
            <div className="flex gap-1">
              {THEMES.map((t) => (
                <button
                  key={t}
                  type="button"
                  role="menuitemradio"
                  aria-checked={theme === t}
                  tabIndex={-1}
                  onClick={() => chooseTheme(t)}
                  className="inline-flex h-8 flex-1 cursor-pointer items-center justify-center gap-1 rounded-sm border border-line-strong text-sm aria-checked:border-accent aria-checked:bg-accent-soft aria-checked:font-semibold"
                >
                  {theme === t && <IconCheck size={13} />}
                  {THEME_LABEL[t]}
                </button>
              ))}
            </div>
          </div>
          <div role="separator" className="my-1 border-t border-line" />
          <button
            ref={(el) => void (refs.current.logout = el)}
            type="button"
            role="menuitem"
            tabIndex={-1}
            className={ITEM}
            onClick={() =>
              start(async () => {
                setOpen(false);
                await clearOfflineData();
                await authClient.signOut();
                router.replace("/login");
                router.refresh();
              })
            }
          >
            <IconLogout size={14} /> Se déconnecter
          </button>
        </div>
      )}
    </div>
  );
}

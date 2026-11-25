"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useState, useTransition } from "react";
import { LogoutButton } from "@/components/account/logout-button";
import { Avatar } from "@/components/account/avatar";
import { Star } from "@/components/lists/star";
import { useUnreadCount } from "@/components/topic/read-topics";
import { IconClose, IconFolder, IconMenu, IconRefresh, IconSettings, IconShield, Logo } from "@/components/ui/icons";
import { runPageRefresh } from "@/lib/page-refresh";
import { useStandalone } from "@/lib/pwa/client";

export type NavCounts = { unread: number; lists: number; errors: number; stack: { open: number; critical: number }; renderedAt?: number };

/** « Ma stack, 5 alertes à traiter dont 2 critiques » (docs/design/3.0 § 3). */
export function stackLabel({ open, critical }: NavCounts["stack"]): string {
  if (open === 0) return "Ma stack";
  return `Ma stack, ${open} alerte${open > 1 ? "s" : ""} à traiter${critical ? ` dont ${critical} critique${critical > 1 ? "s" : ""}` : ""}`;
}

/** Red (sev-critical) with at least one critical, else bar-accent; absent at 0. */
function StackBadge({ counts, className = "" }: { counts: NavCounts["stack"]; className?: string }) {
  if (counts.open === 0) return null;
  return (
    <span
      aria-hidden
      className={`inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 font-mono text-[11px] leading-none font-bold ${
        counts.critical ? "bg-sev-critical text-sev-critical-fg" : "bg-bar-accent text-bar"
      } ${className}`}
    >
      {counts.open}
    </span>
  );
}

const NAV = [
  { href: "/", label: "Forums", match: (p: string) => p === "/" || p.startsWith("/f/") || p.startsWith("/t/") },
  { href: "/listes", label: "Listes", match: (p: string) => p === "/listes" || p.startsWith("/listes/") },
  { href: "/stack", label: "Ma stack", match: (p: string) => p === "/stack" || p.startsWith("/stack/") },
  { href: "/admin", label: "Admin", match: (p: string) => p.startsWith("/admin") },
] as const;

/** Mobile menu rows (docs/design/v3 § 2): 52 px, 20 px icon, counter; active = light background + 3 px accent bar. */
const MENU_ROW =
  "relative flex h-13 items-center gap-3 rounded-sm px-3 text-base font-medium text-bar-fg no-underline hover:bg-white/8 hover:text-bar-fg " +
  "aria-[current=page]:bg-white/10 aria-[current=page]:font-semibold aria-[current=page]:before:absolute aria-[current=page]:before:inset-y-2 " +
  "aria-[current=page]:before:left-0 aria-[current=page]:before:w-[3px] aria-[current=page]:before:rounded-full aria-[current=page]:before:bg-bar-accent " +
  "focus-visible:outline-bar-accent";

/** « N non lus » of the menu, kept in step with the read changes of the topic row menu. */
function UnreadExtra({ unread, renderedAt }: { unread: number; renderedAt?: number }) {
  const n = useUnreadCount(unread, renderedAt);
  return n > 0 ? <span className="ml-auto font-mono text-sm text-bar-muted">{n} non lus</span> : null;
}

function MenuExtra({ href, counts }: { href: string; counts: NavCounts }) {
  if (href === "/") return <UnreadExtra unread={counts.unread} renderedAt={counts.renderedAt} />;
  if (href === "/listes") return <span className="ml-auto font-mono text-sm text-bar-muted">{counts.lists}</span>;
  if (href === "/stack")
    return counts.stack.open > 0 ? (
      <span className={`ml-auto rounded-full px-2 text-xs leading-5 font-semibold ${counts.stack.critical ? "bg-sev-critical text-sev-critical-fg" : "bg-bar-accent text-bar"}`}>
        {counts.stack.open} à traiter
      </span>
    ) : null;
  if (counts.errors > 0)
    return (
      <span className="ml-auto rounded-full bg-err px-2 text-xs leading-5 font-semibold text-err-fg">
        {counts.errors} erreur{counts.errors > 1 ? "s" : ""}
      </span>
    );
  return null;
}

const MENU_ICONS = { "/": IconFolder, "/stack": IconShield, "/admin": IconSettings } as const;

const NAV_LINK =
  "rounded-sm px-3 py-[7px] text-sm font-medium text-bar-muted no-underline hover:bg-white/8 hover:text-bar-fg " +
  "aria-[current=page]:bg-white/12 aria-[current=page]:font-semibold aria-[current=page]:text-bar-fg " +
  "aria-[current=page]:shadow-[inset_0_-2px_0_var(--bar-accent)] focus-visible:outline-bar-accent";

/**
 * Installed app only (no browser toolbar, and no pull-to-refresh on iOS):
 * re-renders the page with fresh data, keeping scroll and client state.
 */
function RefreshButton({ className }: { className: string }) {
  const router = useRouter();
  const standalone = useStandalone();
  const [pending, startTransition] = useTransition();
  if (!standalone) return null;
  return (
    <button
      type="button"
      className={className}
      aria-label="Actualiser"
      title="Actualiser"
      aria-busy={pending}
      onClick={() =>
        startTransition(async () => {
          await runPageRefresh();
          router.refresh();
        })
      }
    >
      <IconRefresh size={18} className={pending ? "animate-spin" : undefined} />
    </button>
  );
}

const REFRESH_CLASS =
  "inline-flex cursor-pointer items-center justify-center rounded-sm text-bar-fg hover:bg-white/8 disabled:opacity-70";

export function AppHeader({ userName, counts }: { userName: string; counts: NavCounts }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const menuId = useId();

  // Close the mobile menu after navigation.
  const [menuPath, setMenuPath] = useState(pathname);
  if (pathname !== menuPath) {
    setMenuPath(pathname);
    setOpen(false);
  }
  // Same for an in-page anchor: the open menu (sticky with the header) would cover the target.
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("hashchange", close);
    return () => window.removeEventListener("hashchange", close);
  }, [open]);

  return (
    // Sticky and opaque: iOS 26 then paints the status bar with --bar and skips the blur it
    // draws over the top of an installed app (it looks for a pinned, full-width, opaque box).
    <header className="safe-top safe-x sticky top-0 z-40 border-b border-black/30 bg-bar text-bar-fg">
      <div className="mx-auto flex min-h-13 max-w-[1200px] items-center gap-7 px-3.5 md:px-5">
        <Link href="/" className="flex items-center gap-2 text-bar-fg no-underline hover:text-bar-fg">
          <Logo />
          <span className="font-cond text-[21px] leading-none font-bold">Folders</span>
        </Link>

        <nav aria-label="Navigation principale" className="hidden flex-1 items-center gap-1 md:flex">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`${NAV_LINK} inline-flex items-center gap-1.5`}
              aria-current={item.match(pathname) ? "page" : undefined}
              aria-label={item.href === "/stack" ? stackLabel(counts.stack) : undefined}
            >
              {item.href === "/listes" && <Star size={14} />}
              {item.href === "/stack" && <IconShield size={15} />}
              {item.label}
              {item.href === "/stack" && <StackBadge counts={counts.stack} />}
            </Link>
          ))}
        </nav>

        <div className="ml-auto hidden items-center gap-3 md:flex">
          <RefreshButton className={`${REFRESH_CLASS} size-8`} />
          <Link
            href="/compte"
            className="inline-flex h-8 items-center gap-2 rounded-sm px-1.5 text-sm font-medium text-bar-muted no-underline hover:bg-white/8 hover:text-bar-fg aria-[current=page]:text-bar-fg focus-visible:outline-bar-accent"
            aria-current={pathname === "/compte" ? "page" : undefined}
          >
            <Avatar name={userName} size="sm" />
            Mon compte
          </Link>
        </div>

        <div className="ml-auto flex items-center md:hidden">
          {/* Ma stack shortcut, between the logo and the burger: 44 px, badge top right. */}
          <Link
            href="/stack/alertes"
            aria-label={stackLabel(counts.stack)}
            aria-current={pathname.startsWith("/stack") ? "page" : undefined}
            className="relative inline-flex size-11 items-center justify-center rounded-sm text-bar-fg hover:bg-white/8 hover:text-bar-fg aria-[current=page]:bg-white/10 focus-visible:outline-bar-accent"
          >
            <IconShield size={20} />
            <StackBadge counts={counts.stack} className="absolute top-1 right-0.5" />
          </Link>
          <RefreshButton className={`${REFRESH_CLASS} size-11`} />
        <button
          type="button"
          className="inline-flex size-11 cursor-pointer items-center justify-center rounded-sm text-bar-fg hover:bg-white/8 md:hidden"
          aria-label={open ? "Fermer le menu" : "Ouvrir le menu"}
          aria-expanded={open}
          aria-controls={menuId}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <IconClose size={20} /> : <IconMenu size={20} />}
        </button>
        </div>
      </div>

      <div id={menuId} hidden={!open} className="border-t border-white/10 px-3.5 pb-3 md:hidden">
        <nav aria-label="Navigation principale (mobile)" className="flex flex-col py-2">
          {NAV.map((item) => {
            const Icon = item.href === "/listes" ? null : MENU_ICONS[item.href];
            return (
              <Link
                key={item.href}
                href={item.href}
                className={MENU_ROW}
                aria-current={item.match(pathname) ? "page" : undefined}
                aria-label={item.href === "/stack" ? stackLabel(counts.stack) : undefined}
              >
                {Icon ? <Icon size={20} className="text-bar-muted" /> : <Star size={20} className="text-bar-muted" />}
                {item.label}
                <MenuExtra href={item.href} counts={counts} />
              </Link>
            );
          })}
          <Link href="/compte" className={MENU_ROW} aria-current={pathname === "/compte" ? "page" : undefined}>
            <Avatar name={userName} size="sm" />
            Mon compte
          </Link>
        </nav>
        <div className="flex flex-col border-t border-white/10 pt-2">
          <LogoutButton className={`${MENU_ROW} w-full cursor-pointer text-left disabled:opacity-70`} />
        </div>
      </div>
    </header>
  );
}

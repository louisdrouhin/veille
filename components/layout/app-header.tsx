"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { authClient } from "@/lib/auth-client";
import { IconClose, IconLogout, IconMenu, Logo } from "@/components/ui/icons";

const NAV = [
  { href: "/", label: "Forums", match: (p: string) => p === "/" || p.startsWith("/f/") || p.startsWith("/t/") },
  { href: "/admin", label: "Admin", match: (p: string) => p.startsWith("/admin") },
];

const NAV_LINK =
  "rounded-sm px-3 py-[7px] text-sm font-medium text-bar-muted no-underline hover:bg-white/8 hover:text-bar-fg " +
  "aria-[current=page]:bg-white/12 aria-[current=page]:font-semibold aria-[current=page]:text-bar-fg " +
  "aria-[current=page]:shadow-[inset_0_-2px_0_var(--bar-accent)] focus-visible:outline-bar-accent";

function LogoutButton({ className }: { className: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      className={className}
      onClick={() =>
        startTransition(async () => {
          await authClient.signOut();
          router.replace("/login");
          router.refresh();
        })
      }
    >
      <IconLogout size={14} />
      {pending ? "Déconnexion…" : "Déconnexion"}
    </button>
  );
}

export function AppHeader({ userName }: { userName: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const menuId = useId();

  // Close the mobile menu after navigation.
  const [menuPath, setMenuPath] = useState(pathname);
  if (pathname !== menuPath) {
    setMenuPath(pathname);
    setOpen(false);
  }

  return (
    <header className="border-b border-black/30 bg-bar text-bar-fg">
      <div className="mx-auto flex min-h-13 max-w-[1200px] items-center gap-7 px-3.5 md:px-5">
        <Link href="/" className="flex items-center gap-2 text-bar-fg no-underline hover:text-bar-fg">
          <Logo />
          <span className="font-cond text-[21px] leading-none font-bold">Veille</span>
        </Link>

        <nav aria-label="Navigation principale" className="hidden flex-1 items-center gap-1 md:flex">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className={NAV_LINK} aria-current={item.match(pathname) ? "page" : undefined}>
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto hidden items-center gap-3 md:flex">
          <span className="text-sm text-bar-muted">{userName}</span>
          <LogoutButton className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-sm border border-white/28 px-3 text-sm font-medium text-bar-fg hover:bg-white/8 disabled:opacity-70" />
        </div>

        <button
          type="button"
          className="ml-auto inline-flex size-11 cursor-pointer items-center justify-center rounded-sm text-bar-fg hover:bg-white/8 md:hidden"
          aria-label={open ? "Fermer le menu" : "Ouvrir le menu"}
          aria-expanded={open}
          aria-controls={menuId}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <IconClose size={20} /> : <IconMenu size={20} />}
        </button>
      </div>

      <div id={menuId} hidden={!open} className="border-t border-white/10 px-3.5 pb-3 md:hidden">
        <nav aria-label="Navigation principale (mobile)" className="flex flex-col py-2">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`${NAV_LINK} flex h-11 items-center text-base`}
              aria-current={item.match(pathname) ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center justify-between gap-3 border-t border-white/10 pt-3">
          <span className="text-sm text-bar-muted">Connecté : {userName}</span>
          <LogoutButton className="inline-flex h-11 cursor-pointer items-center gap-1.5 rounded-sm border border-white/28 px-3 text-sm font-medium text-bar-fg disabled:opacity-70" />
        </div>
      </div>
    </header>
  );
}

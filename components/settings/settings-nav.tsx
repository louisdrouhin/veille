"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import { UserAvatar, type AvatarUser } from "@/components/account/user-avatar";
import { LogoutButton } from "@/components/account/logout-button";
import {
  IconBell,
  IconChevronRight,
  IconFolder,
  IconInfo,
  IconKey,
  IconKeyboard,
  IconLock,
  IconPalette,
  IconRss,
  IconSparkle,
  IconSun,
  IconUser,
} from "@/components/ui/icons";
import { displayName } from "@/lib/profile";
import { SETTINGS_GROUPS, SETTINGS_PAGES, settingsHref, type SettingsIcon, type SettingsValues } from "@/lib/settings/nav";

const ICONS: Record<SettingsIcon, (p: { size?: number; className?: string }) => React.ReactNode> = {
  user: IconUser,
  lock: IconLock,
  palette: IconPalette,
  bell: IconBell,
  sun: IconSun,
  keyboard: IconKeyboard,
  folder: IconFolder,
  rss: IconRss,
  key: IconKey,
  sparkle: IconSparkle,
  info: IconInfo,
};

/** « Nouveau » next to À propos until the first visit after an update (this browser). */
const SEEN_KEY = "folders-about-seen";
const SEEN_EVENT = "folders-about-seen";
const subscribe = (l: () => void) => {
  window.addEventListener(SEEN_EVENT, l);
  return () => window.removeEventListener(SEEN_EVENT, l);
};
export function useAboutUnseen(version: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => {
      try {
        return window.localStorage.getItem(SEEN_KEY) !== version;
      } catch {
        return false;
      }
    },
    () => false,
  );
}
export function markAboutSeen(version: string) {
  try {
    window.localStorage.setItem(SEEN_KEY, version);
  } catch {
    /* private mode: no badge memory */
  }
  window.dispatchEvent(new Event(SEEN_EVENT));
}

function Badge({ text, tone }: { text: string; tone: "err" | "accent" }) {
  return (
    <span className={`ml-auto shrink-0 rounded-full px-2 text-xs leading-5 font-semibold ${tone === "err" ? "bg-err text-err-fg" : "bg-accent text-accent-fg"}`}>{text}</span>
  );
}

/**
 * Side menu of Paramètres, desktop (docs/design/3.5 § 1, § 8): <nav aria-label="Paramètres">, group titles in h2,
 * current page with aria-current, background, bar and weight. Badges are text, inside the link's name.
 */
export function SettingsSideNav({ values, version }: { values: SettingsValues; version: string }) {
  const pathname = usePathname();
  const unseen = useAboutUnseen(version);
  return (
    <nav aria-label="Paramètres" className="sticky top-20 hidden w-[240px] shrink-0 flex-col gap-4 md:flex">
      {SETTINGS_GROUPS.map((group) => (
        <div key={group}>
          <h2 className="mb-1 px-3 font-cond text-xs font-bold tracking-caps text-fg-muted uppercase">{group}</h2>
          <ul className="grid gap-0.5">
            {SETTINGS_PAGES.filter((p) => p.group === group).map((p) => {
              const Icon = ICONS[p.icon];
              const href = settingsHref(p.key);
              const current = pathname === href;
              const badge = p.key === "a-propos" && unseen ? "Nouveau" : values[p.key]?.badge;
              return (
                <li key={p.key}>
                  <Link
                    href={href}
                    aria-current={current ? "page" : undefined}
                    className="relative flex h-9 items-center gap-2.5 rounded-sm px-3 text-sm text-fg no-underline hover:bg-surface-hover hover:text-fg aria-[current=page]:bg-accent-soft aria-[current=page]:font-semibold aria-[current=page]:before:absolute aria-[current=page]:before:inset-y-1.5 aria-[current=page]:before:left-0 aria-[current=page]:before:w-[3px] aria-[current=page]:before:rounded-full aria-[current=page]:before:bg-accent"
                  >
                    <Icon size={16} className="shrink-0 text-fg-muted" />
                    <span className="min-w-0 truncate">{p.label}</span>
                    {badge && <Badge text={badge} tone={p.key === "a-propos" ? "accent" : "err"} />}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/**
 * /parametres on mobile (docs/design/3.5 § 3): the list, iOS Settings style. Profile card, then the groups (50 px
 * rows: icon in an accent-soft square, label, current value or badge, chevron), « Se déconnecter », the version.
 * Raccourcis clavier is not listed (desktop only; its URL still works).
 */
export function SettingsList({ me, values, version, commit }: { me: AvatarUser & { email: string }; values: SettingsValues; version: string; commit: string | null }) {
  const unseen = useAboutUnseen(version);
  return (
    <div className="flex flex-col gap-5 pb-[calc(env(safe-area-inset-bottom)+110px)]">
      <h1 className="sr-only">Paramètres</h1>
      <Link href={settingsHref("profil")} className="flex min-h-[76px] items-center gap-3 rounded-md border border-line bg-surface p-3 text-fg no-underline shadow-sm hover:text-fg">
        <UserAvatar user={me} size={56} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-md font-bold">{displayName(me)}</span>
          <span className="block truncate text-sm text-fg-muted">{me.email}</span>
        </span>
        <IconChevronRight size={18} className="text-fg-muted" />
      </Link>
      {SETTINGS_GROUPS.map((group) => (
        <section key={group} aria-labelledby={`settings-${group}`}>
          <h2 id={`settings-${group}`} className="mb-1.5 px-3 font-cond text-xs font-bold tracking-caps text-fg-muted uppercase">
            {group}
          </h2>
          <ul className="overflow-hidden rounded-md border border-line bg-surface shadow-sm">
            {SETTINGS_PAGES.filter((p) => p.group === group && !("desktopOnly" in p && p.desktopOnly)).map((p) => {
              const Icon = ICONS[p.icon];
              const v = values[p.key];
              const badge = p.key === "a-propos" && unseen ? "Nouveau" : v?.badge;
              return (
                <li key={p.key} className="border-t border-line first:border-t-0">
                  <Link href={settingsHref(p.key)} className="flex min-h-[50px] items-center gap-3 px-3 text-fg no-underline hover:bg-surface-hover hover:text-fg">
                    <span aria-hidden className="inline-flex size-8 shrink-0 items-center justify-center rounded-sm bg-accent-soft text-accent">
                      <Icon size={17} />
                    </span>
                    <span className="min-w-0 flex-1 text-base">{p.label}</span>
                    {badge ? <Badge text={badge} tone={p.key === "a-propos" ? "accent" : "err"} /> : v?.value && <span className="text-sm text-fg-muted">{v.value}</span>}
                    <IconChevronRight size={16} className="shrink-0 text-fg-muted" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      <div className="overflow-hidden rounded-md border border-line bg-surface shadow-sm">
        <LogoutButton className="flex min-h-[50px] w-full cursor-pointer items-center px-3 text-left text-base font-semibold text-err hover:bg-surface-hover disabled:opacity-70" />
      </div>
      <p className="text-center font-mono text-xs text-fg-muted">
        Folders {version}
        {commit ? ` · ${commit}` : ""}
      </p>
    </div>
  );
}

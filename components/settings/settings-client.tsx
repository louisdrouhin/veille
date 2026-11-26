"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { LEGACY_ANCHORS, settingsHref, type SettingsKey } from "@/lib/settings/nav";

/** h1 of a settings page: focused when the page changes (docs/design/3.5 § 8), without scrolling. */
export function FocusHeading({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);
  return (
    <h1 ref={ref} tabIndex={-1} className="font-cond text-xl font-bold focus:outline-none">
      {children}
    </h1>
  );
}

/**
 * Anchors of the old pages (/compte#apparence → 308 → /parametres/profil#apparence): sent to the page that now holds
 * that block. The browser keeps the fragment through the redirect; the server never sees it.
 */
export function LegacyAnchor({ page }: { page: SettingsKey }) {
  const router = useRouter();
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    const target = hash ? LEGACY_ANCHORS[hash] : undefined;
    if (target && target !== page) router.replace(settingsHref(target));
  }, [page, router]);
  return null;
}

/** /parametres on desktop: straight to Profil (the list is the mobile page). */
export function DesktopToProfile() {
  const router = useRouter();
  useEffect(() => {
    if (window.matchMedia("(min-width: 48rem)").matches) router.replace(settingsHref("profil"));
  }, [router]);
  return null;
}

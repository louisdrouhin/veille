"use client";

import { useEffect, useSyncExternalStore } from "react";
import { isThemePreference, THEME_COOKIE, THEME_COOKIE_MAX_AGE, type ThemePreference } from "@/lib/theme";

function subscribeTheme(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

/**
 * The theme in use on this page: <html data-theme>, which every change goes through (applyTheme: the account menu,
 * Paramètres › Apparence, another device via AccountThemeSync). Each picker reads it here instead of keeping its own
 * copy, so a change made in one shows at once in the other, without reloading. `serverValue`: the account's
 * preference, for the server render and the hydration.
 */
export function useThemePreference(serverValue: ThemePreference): ThemePreference {
  return useSyncExternalStore(
    subscribeTheme,
    () => {
      const t = document.documentElement.dataset.theme;
      return isThemePreference(t) ? t : serverValue;
    },
    () => serverValue,
  );
}

/** Switches the page's theme at once (before the server has saved it). */
export function applyTheme(theme: string): void {
  if (document.documentElement.dataset.theme !== theme) document.documentElement.dataset.theme = theme;
}

function cookieTheme(): string | null {
  const entry = document.cookie.split("; ").find((c) => c.startsWith(`${THEME_COOKIE}=`));
  const value = entry?.slice(THEME_COOKIE.length + 1);
  return isThemePreference(value) ? value : null;
}

/**
 * The server renders <html data-theme> from the cookie, but a page can come from elsewhere:
 * the offline cache (saved before the theme changed) or the back/forward cache. Aligns it with
 * the cookie, the device's current choice. Bundled code, not an inline script (strict CSP).
 */
export function ThemeSync() {
  useEffect(() => {
    const sync = () => {
      const theme = cookieTheme();
      if (theme) applyTheme(theme);
    };
    sync();
    window.addEventListener("pageshow", sync);
    return () => window.removeEventListener("pageshow", sync);
  }, []);
  return null;
}

/**
 * Signed-in pages: the account is the reference (same choice on every device). If this device's
 * cookie is behind — the theme was changed on another device — rewrite it and switch the page.
 */
export function AccountThemeSync({ theme }: { theme: ThemePreference }) {
  useEffect(() => {
    if (cookieTheme() === theme) return;
    const secure = window.location.protocol === "https:" ? "; secure" : "";
    document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=${THEME_COOKIE_MAX_AGE}; samesite=lax${secure}`;
    applyTheme(theme);
  }, [theme]);
  return null;
}

/**
 * Theme preference (Paramètres › Apparence) and the token colors needed outside CSS
 * (manifest, <meta name="theme-color">, the service worker's offline page).
 * Same values as app/globals.css (checked by tests/pwa-manifest.test.ts and tests/theme-tokens.test.ts).
 */
export const THEME = {
  bar: "#1E3640",
  barAccent: "#7FC3DE",
  bg: "#F3F2EE",
} as const;

/** --bar of the dark theme: the iOS status bar and Android title bar follow the header. */
export const THEME_DARK = { bar: "#1C3039" } as const;

export const THEMES = ["system", "light", "dark"] as const;
export type ThemePreference = (typeof THEMES)[number];
export const DEFAULT_THEME: ThemePreference = "system";
export const THEME_LABEL: Record<ThemePreference, string> = { system: "Système", light: "Clair", dark: "Sombre" };

/**
 * Mirror of the account's preference, read by the root layout to render <html data-theme>
 * without any script (« system » is resolved in CSS). Not httpOnly: components/theme/theme-sync.tsx
 * reads it to fix pages served from the offline cache. Not a secret, not an authorization.
 */
export const THEME_COOKIE = "folders-theme";
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

/** Any cookie or form value → a valid preference (unknown values fall back to « system »). */
export function parseTheme(value: unknown): ThemePreference {
  return isThemePreference(value) ? value : DEFAULT_THEME;
}

/** Cookie attributes, shared by the login hook (lib/auth.ts) and the setTheme action. */
export function themeCookieOptions(secure: boolean) {
  return { path: "/", maxAge: THEME_COOKIE_MAX_AGE, sameSite: "lax" as const, httpOnly: false, secure };
}

/** <meta name="theme-color">: one value when the theme is forced, a light/dark pair otherwise. */
export function themeColor(pref: ThemePreference) {
  if (pref === "light") return THEME.bar;
  if (pref === "dark") return THEME_DARK.bar;
  return [
    { media: "(prefers-color-scheme: light)", color: THEME.bar },
    { media: "(prefers-color-scheme: dark)", color: THEME_DARK.bar },
  ];
}

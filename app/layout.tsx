import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { PwaStart } from "@/components/pwa/pwa-start";
import { ThemeSync } from "@/components/theme/theme-sync";
import { ICONS } from "@/lib/pwa/icons";
import { parseTheme, THEME_COOKIE, themeColor } from "@/lib/theme";
import { plexCondensed, plexMono, plexSans } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Folders", template: "%s · Folders" },
  robots: { index: false, follow: false },
  applicationName: "Folders",
  // Installed on iOS: the page starts below an opaque status bar ("default"). With
  // "black-translucent" the page went under it, and iOS blurs a band at the top of
  // the screen taller than safe-area-inset-top: the whole header looked washed out.
  appleWebApp: { capable: true, title: "Folders", statusBarStyle: "default" },
  // apple-touch-icon, then PNG, then SVG: see lib/pwa/icons.ts.
  icons: ICONS,
  // Next.js emits the standard mobile-web-app-capable; older iOS versions only read this one.
  other: { "apple-mobile-web-app-capable": "yes" },
};

async function themePreference() {
  return parseTheme((await cookies()).get(THEME_COOKIE)?.value);
}

// viewport-fit=cover: the page goes under the notch and home indicator, and
// env(safe-area-inset-*) (app/globals.css) keeps the content clear of them.
// themeColor follows the header (--bar): one value when the theme is forced, else a light/dark pair.
export async function generateViewport(): Promise<Viewport> {
  return { themeColor: themeColor(await themePreference()), viewportFit: "cover" };
}

/**
 * data-theme comes from the folders-theme cookie: « light » and « dark » are known here, « system »
 * is resolved by CSS (prefers-color-scheme). No anti-flash script, nothing inline (strict CSP).
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = await themePreference();
  return (
    <html lang="fr" data-theme={theme} className={`${plexSans.variable} ${plexCondensed.variable} ${plexMono.variable}`}>
      <body>
        {children}
        <PwaStart />
        <ThemeSync />
      </body>
    </html>
  );
}

import type { Metadata, Viewport } from "next";
import { PwaStart } from "@/components/pwa/pwa-start";
import { ICONS } from "@/lib/pwa/icons";
import { THEME } from "@/lib/theme";
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

// viewport-fit=cover: the page goes under the notch and home indicator, and
// env(safe-area-inset-*) (app/globals.css) keeps the content clear of them.
export const viewport: Viewport = { themeColor: THEME.bar, viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${plexSans.variable} ${plexCondensed.variable} ${plexMono.variable}`}>
      <body>
        {children}
        <PwaStart />
      </body>
    </html>
  );
}

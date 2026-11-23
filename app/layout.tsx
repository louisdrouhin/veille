import type { Metadata, Viewport } from "next";
import { PwaStart } from "@/components/pwa/pwa-start";
import { THEME } from "@/lib/theme";
import { plexCondensed, plexMono, plexSans } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Veille", template: "%s · Veille" },
  robots: { index: false, follow: false },
  applicationName: "Veille",
  // Installed on iOS: full screen, the status bar over the header (hence the safe-area padding).
  appleWebApp: { capable: true, title: "Veille", statusBarStyle: "black-translucent" },
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

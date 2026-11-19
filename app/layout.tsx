import type { Metadata, Viewport } from "next";
import { plexCondensed, plexMono, plexSans } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Veille", template: "%s · Veille" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#1E3640" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${plexSans.variable} ${plexCondensed.variable} ${plexMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}

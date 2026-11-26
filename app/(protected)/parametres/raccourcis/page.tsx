import type { Metadata } from "next";
import { SettingsPage } from "@/components/settings/settings-page";
import { ShortcutsSettings } from "@/components/shortcuts/shortcuts-settings";
import { requireSession } from "@/lib/session";
import { settingsTitle } from "@/lib/settings/nav";

export const metadata: Metadata = { title: settingsTitle("raccourcis") };

/** Paramètres › Raccourcis clavier (docs/design/3.5 § 6): desktop only in the menus; the URL works everywhere. */
export default async function ShortcutsPage() {
  await requireSession();
  return (
    <SettingsPage page="raccourcis" title="Raccourcis clavier" description="Pour parcourir ta veille sans quitter le clavier. Aide à tout moment avec « ? ».">
      <ShortcutsSettings />
    </SettingsPage>
  );
}

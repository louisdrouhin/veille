import type { Metadata } from "next";
import { ThemePicker } from "@/components/account/theme-picker";
import { SettingsPage } from "@/components/settings/settings-page";
import { Panel } from "@/components/ui/panel";
import { requireSession } from "@/lib/session";
import { settingsTitle } from "@/lib/settings/nav";
import { parseTheme } from "@/lib/theme";

export const metadata: Metadata = { title: settingsTitle("apparence") };

/** Paramètres › Apparence (docs/design/3.5 § 7): the same setting as « Thème » in the account menu. */
export default async function AppearancePage() {
  const session = await requireSession();
  return (
    <SettingsPage page="apparence" title="Apparence" description="Le thème de Folders sur tous tes appareils.">
      <Panel title="Thème">
        <div className="p-3.5">
          <ThemePicker initial={parseTheme((session.user as { theme?: unknown }).theme)} />
        </div>
      </Panel>
    </SettingsPage>
  );
}

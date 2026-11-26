import { SettingsSideNav } from "@/components/settings/settings-nav";
import { appInfo } from "@/lib/app-info";
import { getDb } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { settingsValues } from "@/lib/settings/summary";
import { parseTheme } from "@/lib/theme";

export const dynamic = "force-dynamic";

/**
 * Paramètres (docs/design/3.5 § 1): side menu on desktop (sticky, current page, badges), the page next to it.
 * On mobile the menu is the /parametres page itself; each page has « ‹ Paramètres ».
 */
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const values = await settingsValues(getDb(), parseTheme((session.user as { theme?: unknown }).theme));
  return (
    <div className="flex items-start gap-8">
      <SettingsSideNav values={values} version={appInfo().version} />
      {children}
    </div>
  );
}

import type { Metadata } from "next";
import { DesktopToProfile } from "@/components/settings/settings-client";
import { SettingsList } from "@/components/settings/settings-nav";
import { appInfo } from "@/lib/app-info";
import { getDb } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { getMe, settingsValues } from "@/lib/settings/summary";
import { parseTheme } from "@/lib/theme";

export const metadata: Metadata = { title: "Paramètres" };

/** /parametres (docs/design/3.5 § 1, § 3): the list on mobile; desktop goes to Profil. */
export default async function SettingsIndexPage() {
  const session = await requireSession();
  const db = getDb();
  const [me, values] = await Promise.all([getMe(db, session.user.id), settingsValues(db, parseTheme((session.user as { theme?: unknown }).theme))]);
  const info = appInfo();
  return (
    <div className="min-w-0 flex-1 md:hidden">
      <DesktopToProfile />
      <SettingsList me={me} values={values} version={info.version} commit={info.commit} />
    </div>
  );
}

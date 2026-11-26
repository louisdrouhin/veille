import type { Metadata } from "next";
import { PhotoSetting } from "@/components/settings/photo-setting";
import { ProfileForm } from "@/components/settings/profile-form";
import { SettingsPage } from "@/components/settings/settings-page";
import { getDb } from "@/lib/db";
import { grantUntil, proofKind } from "@/lib/secrets/reconfirm";
import { requireSession } from "@/lib/session";
import { settingsTitle } from "@/lib/settings/nav";
import { getMe } from "@/lib/settings/summary";

export const metadata: Metadata = { title: settingsTitle("profil") };

/** Paramètres › Profil (docs/design/3.5 § 5). */
export default async function ProfilePage() {
  const session = await requireSession();
  const db = getDb();
  const [me, proof] = await Promise.all([getMe(db, session.user.id), proofKind(db, session.user.id)]);
  return (
    <SettingsPage page="profil" title="Profil" description="Ton nom tel qu'il s'affiche dans Folders, ton adresse de connexion.">
      <PhotoSetting me={me} />
      <ProfileForm me={me} grantUntil={grantUntil(session.session.id)} proof={proof} />
    </SettingsPage>
  );
}

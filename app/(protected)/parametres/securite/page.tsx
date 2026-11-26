import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { TwoFactorPanel } from "@/components/account/two-factor-panel";
import { IdentityGate } from "@/components/settings/identity";
import { PasswordPanel, SessionsPanel } from "@/components/settings/security-panels";
import { SettingsPage } from "@/components/settings/settings-page";
import { getDb } from "@/lib/db";
import { user } from "@/lib/db/schema";
import { grantUntil, proofKind } from "@/lib/secrets/reconfirm";
import { backupCodesLeft, listSessions } from "@/lib/security";
import { requireSession } from "@/lib/session";
import { settingsTitle } from "@/lib/settings/nav";

export const metadata: Metadata = { title: settingsTitle("securite") };
export const dynamic = "force-dynamic";

/** Paramètres › Sécurité (docs/design/3.5 § 7): behind the identity re-confirmation (10 min, shared with Intégrations). */
export default async function SecurityPage() {
  const session = await requireSession();
  const db = getDb();
  const [[me], proof, sessions, backupLeft] = await Promise.all([
    db.select({ twoFactorEnabled: user.twoFactorEnabled }).from(user).where(eq(user.id, session.user.id)),
    proofKind(db, session.user.id),
    listSessions(db, session.user.id, session.session.id),
    backupCodesLeft(db, session.user.id, process.env.BETTER_AUTH_SECRET),
  ]);
  return (
    <SettingsPage page="securite" title="Sécurité" description="Mot de passe, double authentification et sessions ouvertes.">
      <IdentityGate grantUntil={grantUntil(session.session.id)} proof={proof} what="modifier la sécurité du compte">
        <div className="flex flex-col gap-4">
          <PasswordPanel />
          <TwoFactorPanel enabled={me?.twoFactorEnabled ?? false} backupLeft={backupLeft} />
          <SessionsPanel sessions={sessions} />
        </div>
      </IdentityGate>
    </SettingsPage>
  );
}

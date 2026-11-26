import type { Metadata } from "next";
import { IntegrationsPanel } from "@/components/admin/integrations-panel";
import { IdentityGate } from "@/components/settings/identity";
import { SettingsPage } from "@/components/settings/settings-page";
import { getDb } from "@/lib/db";
import { grantUntil, proofKind } from "@/lib/secrets/reconfirm";
import { integrationsView } from "@/lib/secrets/view";
import { requireSession } from "@/lib/session";
import { settingsTitle } from "@/lib/settings/nav";

export const metadata: Metadata = { title: settingsTitle("integrations") };
export const dynamic = "force-dynamic";

/** Paramètres › Intégrations: API keys and models (lib/secrets, 3.1). No value ever reaches the page. */
export default async function IntegrationsPage() {
  const session = await requireSession();
  const db = getDb();
  const [view, proof] = await Promise.all([integrationsView(db), proofKind(db, session.user.id)]);
  return (
    <SettingsPage
      page="integrations"
      title="Intégrations"
      description="Clés d'API des services externes. Une clé enregistrée ici, chiffrée sur le serveur, remplace celle du .env ; supprimée, l'app reprend celle du .env."
    >
      {view.master === "ok" ? (
        <IdentityGate grantUntil={grantUntil(session.session.id)} proof={proof} what="modifier les clés et les modèles">
          <IntegrationsPanel view={view} grantUntil={grantUntil(session.session.id)} proof={proof} />
        </IdentityGate>
      ) : (
        // Read-only (no SECRETS_KEY): nothing to change, the notice must stay readable.
        <IntegrationsPanel view={view} grantUntil={null} proof={proof} />
      )}
    </SettingsPage>
  );
}

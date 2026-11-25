import type { Metadata } from "next";
import { IntegrationsPanel } from "@/components/admin/integrations-panel";
import { PageNav } from "@/components/layout/page-nav";
import { getDb } from "@/lib/db";
import { grantUntil, proofKind } from "@/lib/secrets/reconfirm";
import { integrationsView } from "@/lib/secrets/view";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Intégrations" };
export const dynamic = "force-dynamic";

/** Admin › Intégrations: API keys and models (lib/secrets). No value ever reaches the page. */
export default async function IntegrationsPage() {
  const session = await requireSession();
  const db = getDb();
  const [view, proof] = await Promise.all([integrationsView(db), proofKind(db, session.user.id)]);
  return (
    <div className="pb-[calc(env(safe-area-inset-bottom)+96px)] md:pb-0">
      <PageNav items={[{ label: "Administration", href: "/admin" }, { label: "Intégrations" }]} back={{ href: "/admin", mode: "any" }} />
      <h1 className="mb-1 font-cond text-xl font-bold">Intégrations</h1>
      <p className="mb-4 max-w-[72ch] text-base text-fg-muted">
        Clés d&apos;API des services externes. Une clé enregistrée ici, chiffrée sur le serveur, remplace celle du .env ; supprimée, l&apos;app reprend celle
        du .env.
      </p>
      <IntegrationsPanel view={view} grantUntil={grantUntil(session.session.id)} proof={proof} />
    </div>
  );
}

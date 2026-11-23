import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { TwoFactorPanel } from "@/components/account/two-factor-panel";
import { Breadcrumb } from "@/components/layout/breadcrumb";
import { Panel } from "@/components/ui/panel";
import { getDb } from "@/lib/db";
import { user } from "@/lib/db/schema";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Mon compte" };
export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const session = await requireSession();
  // Read from the database, not the (cached) session: the 2FA state changes on this page.
  const [me] = await getDb()
    .select({ email: user.email, name: user.name, twoFactorEnabled: user.twoFactorEnabled })
    .from(user)
    .where(eq(user.id, session.user.id));

  return (
    <>
      <Breadcrumb items={[{ label: "Mon compte" }]} />
      <h1 className="mb-3 font-cond text-xl font-bold">Mon compte</h1>
      <div className="grid max-w-[720px] gap-4">
        <Panel title="Profil">
          <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 p-3.5 text-base">
            <dt className="font-semibold">Nom</dt>
            <dd>{me?.name}</dd>
            <dt className="font-semibold">Email</dt>
            <dd className="font-mono text-sm">{me?.email}</dd>
          </dl>
        </Panel>
        <TwoFactorPanel enabled={me?.twoFactorEnabled ?? false} />
      </div>
    </>
  );
}

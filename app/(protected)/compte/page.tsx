import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { AboutPanel } from "@/components/account/about-panel";
import { Avatar } from "@/components/account/avatar";
import { LogoutButton } from "@/components/account/logout-button";
import { ThemePicker } from "@/components/account/theme-picker";
import { TwoFactorPanel } from "@/components/account/two-factor-panel";
import { buttonClass } from "@/components/ui/button";
import { PageNav } from "@/components/layout/page-nav";
import { Panel } from "@/components/ui/panel";
import { getDb } from "@/lib/db";
import { user } from "@/lib/db/schema";
import { requireSession } from "@/lib/session";
import { parseTheme } from "@/lib/theme";

export const metadata: Metadata = { title: "Mon compte" };
export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const session = await requireSession();
  // Read from the database, not the (cached) session: the 2FA state changes on this page.
  const [me] = await getDb()
    .select({ email: user.email, name: user.name, twoFactorEnabled: user.twoFactorEnabled, theme: user.theme })
    .from(user)
    .where(eq(user.id, session.user.id));

  return (
    <>
      <PageNav items={[{ label: "Mon compte" }]} back={{ href: "/", mode: "any" }} />
      <h1 className="mb-3 font-cond text-xl font-bold">Mon compte</h1>
      <div className="grid max-w-[720px] gap-4">
        <Panel title="Profil">
          <div className="flex items-center gap-3.5 p-3.5">
            <Avatar name={me?.name ?? ""} />
            <dl className="grid min-w-0 grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-base">
              <dt className="font-semibold">Nom</dt>
              <dd className="min-w-0 break-words">{me?.name}</dd>
              <dt className="font-semibold">Email</dt>
              <dd className="min-w-0 font-mono text-sm break-all">{me?.email}</dd>
            </dl>
          </div>
        </Panel>
        <Panel title="Apparence">
          <div className="p-3.5">
            <ThemePicker initial={parseTheme(me?.theme)} />
          </div>
        </Panel>
        <TwoFactorPanel enabled={me?.twoFactorEnabled ?? false} />
        <Panel title="Session">
          <div className="flex flex-wrap items-center justify-between gap-3 p-3.5">
            <p className="text-base text-fg-muted">Les pages gardées pour la lecture hors ligne sont effacées de cet appareil.</p>
            <LogoutButton className={buttonClass("danger", "md")} />
          </div>
        </Panel>
        <AboutPanel />
      </div>
    </>
  );
}

import type { Metadata } from "next";
import { AboutPanel } from "@/components/account/about-panel";
import { AboutSeen } from "@/components/settings/about-seen";
import { SettingsPage } from "@/components/settings/settings-page";
import { appInfo } from "@/lib/app-info";
import { changelogHtml } from "@/lib/changelog";
import { requireSession } from "@/lib/session";
import { settingsTitle } from "@/lib/settings/nav";

export const metadata: Metadata = { title: settingsTitle("a-propos") };
export const dynamic = "force-dynamic";

/** Paramètres › À propos (docs/design/3.5 § 7): version, commit, build date, and « Nouveautés » (CHANGELOG.md). */
export default async function AboutPage() {
  await requireSession();
  const info = appInfo();
  const html = changelogHtml();
  return (
    <SettingsPage page="a-propos" title="À propos" description="La version de Folders installée sur le serveur et ses nouveautés.">
      <AboutSeen version={info.version} />
      <AboutPanel info={info} />
      <section aria-labelledby="changelog-title" className="rounded-md border border-line bg-surface p-4 shadow-sm">
        <h2 id="changelog-title" className="mb-2 font-cond text-lg font-bold">
          Nouveautés
        </h2>
        {html ? (
          // CHANGELOG.md of the repository, through the closed Markdown renderer (everything escaped).
          <div className="changelog article-body max-w-[72ch]" dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <p className="text-md text-fg-muted">Le journal des versions n&apos;est pas disponible.</p>
        )}
      </section>
    </SettingsPage>
  );
}

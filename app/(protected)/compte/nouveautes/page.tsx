import type { Metadata } from "next";
import { PageNav } from "@/components/layout/page-nav";
import { appInfo } from "@/lib/app-info";
import { changelogHtml } from "@/lib/changelog";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Nouveautés" };
export const dynamic = "force-dynamic";

/** « Nouveautés »: CHANGELOG.md of the running version, shipped with the server. */
export default async function ChangelogPage() {
  await requireSession();
  const html = changelogHtml();
  const { version } = appInfo();
  return (
    <>
      <PageNav items={[{ label: "Mon compte", href: "/compte" }, { label: "Nouveautés" }]} back={{ href: "/compte", mode: "parent" }} />
      <h1 className="mb-1 font-cond text-xl font-bold">Nouveautés</h1>
      <p className="mb-4 text-sm text-fg-muted">
        Version installée : <span className="font-mono">{version}</span>
      </p>
      {html ? (
        // CHANGELOG.md of the repository, through the closed Markdown renderer (everything escaped).
        <div className="changelog article-body max-w-[72ch]" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <p className="text-md text-fg-muted">Le journal des versions n&apos;est pas disponible.</p>
      )}
    </>
  );
}

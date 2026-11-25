import Link from "next/link";
import { Panel } from "@/components/ui/panel";
import { appInfo, type AppInfo } from "@/lib/app-info";

/** Mon compte › « À propos »: version, commit (link to GitHub) and build date, set at build. */
export function AboutPanel({ info = appInfo() }: { info?: AppInfo }) {
  return (
    <Panel title="À propos">
      <div className="flex flex-wrap items-end justify-between gap-3 p-3.5">
        <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-base">
          <dt className="font-semibold">Version</dt>
          <dd className="font-mono text-sm">{info.version}</dd>
          <dt className="font-semibold">Commit</dt>
          <dd className="font-mono text-sm">
            {info.commitUrl ? (
              <a href={info.commitUrl} target="_blank" rel="noopener noreferrer">
                {info.commit} <span aria-hidden="true">↗</span>
                <span className="sr-only"> (sur GitHub, nouvel onglet)</span>
              </a>
            ) : (
              (info.commit ?? "inconnu")
            )}
          </dd>
          <dt className="font-semibold">Build</dt>
          <dd className="text-sm">
            {info.builtAt === "dev" ? (
              <span className="font-mono">dev</span>
            ) : info.builtAt ? (
              <time dateTime={info.builtAt.iso} title={info.builtAt.title}>
                {info.builtAt.label}
              </time>
            ) : (
              "inconnu"
            )}
          </dd>
        </dl>
        {/* /compte/… is never cached offline (lib/pwa/service-worker.js); a plain link, no prefetch. */}
        <Link href="/compte/nouveautes" prefetch={false} className="inline-flex h-11 items-center text-base font-semibold md:h-auto">
          Nouveautés
        </Link>
      </div>
    </Panel>
  );
}

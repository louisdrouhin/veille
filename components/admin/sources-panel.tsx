import Link from "next/link";
import { buttonClass, LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { IconPencil, IconPlus, IconPower, IconRefresh, IconRss } from "@/components/ui/icons";
import { BAR_BUTTON, Panel } from "@/components/ui/panel";
import { RelativeTime } from "@/components/ui/relative-time";
import { SubmitButton } from "@/components/ui/submit-button";
import { TableHead } from "@/components/ui/table-head";
import { createSource, fetchSourceNow, setSourceEnabled, updateSource } from "@/lib/actions/admin";
import type { Forum, Source } from "@/lib/db/schema";
import { SourceDeleteButton } from "./source-delete-button";
import { SourceStatusBadge } from "./source-status-badge";

const GRID = "grid-cols-[minmax(0,1fr)_128px_168px_104px_136px]";
const FIELD = "h-9 w-full rounded-sm border border-line-strong bg-surface px-2.5 text-base font-normal text-fg max-md:h-11 max-md:text-[16px]";
const LABEL = "flex min-w-0 flex-col gap-1 text-xs font-semibold text-fg-muted";

export type AdminSource = Source & { forumName: string };

export function SourcesPanel({ sources, forums, editing, now }: { sources: AdminSource[]; forums: Forum[]; editing?: AdminSource; now: Date }) {
  return (
    <Panel
      id="sources"
      title="Sources"
      className="w-full min-w-0 min-[1000px]:flex-[999_1_640px]"
      action={
        forums.length > 0 && (
          <Link href="/admin#source-form" className={BAR_BUTTON}>
            <IconPlus size={14} /> Ajouter une source
          </Link>
        )
      }
    >
      {forums.length === 0 ? (
        <p className="px-3.5 py-4 text-sm text-fg-muted">Crée d&apos;abord un forum pour y ranger tes sources.</p>
      ) : (
        <>
          {sources.length === 0 ? (
            <div className="p-3.5">
              <EmptyState
                icon={<IconRss size={40} strokeWidth={1.2} />}
                title="Aucune source configurée"
                action={
                  <LinkButton href="/admin#source-form" variant="primary">
                    <IconPlus size={14} /> Ajouter une source
                  </LinkButton>
                }
              >
                Ajoute un flux RSS ou Atom avec le formulaire ci-dessous.
              </EmptyState>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <div className="min-w-[720px]">
                <TableHead
                  grid={GRID}
                  alwaysVisible
                  className="!bg-surface-alt !text-fg-muted border-b border-line"
                  columns={[{ label: "Nom" }, { label: "Forum" }, { label: "Statut" }, { label: "Dernière récup." }, { label: "Actions", align: "right" }]}
                />
                <ul>
                  {sources.map((s) => (
                    <SourceRow key={s.id} source={s} now={now} />
                  ))}
                </ul>
              </div>
            </div>
          )}
          <SourceForm forums={forums} editing={editing} />
        </>
      )}
    </Panel>
  );
}

function SourceRow({ source: s, now }: { source: AdminSource; now: Date }) {
  return (
    <li className={`grid ${GRID} items-center gap-x-3 border-t border-line px-4 py-2.5 first:border-t-0 odd:bg-surface even:bg-surface-alt`}>
      <div className="min-w-0">
        <p className={`truncate text-base font-semibold ${s.enabled ? "" : "text-fg-read"}`}>{s.name}</p>
        <p className="truncate font-mono text-xs text-fg-muted" title={s.url}>
          {s.url}
        </p>
      </div>
      <span className="truncate text-sm">{s.forumName}</span>
      <SourceStatusBadge source={s} now={now} />
      <span className="text-sm text-fg-muted">{s.lastFetchedAt ? <RelativeTime date={s.lastFetchedAt} /> : "jamais"}</span>
      <div className="flex justify-end">
        <form action={fetchSourceNow}>
          <input type="hidden" name="id" value={s.id} />
          <SubmitButton variant="ghost-icon" className="text-accent" aria-label={`Récupérer « ${s.name} » maintenant`} title="Récupérer maintenant">
            <IconRefresh size={15} />
          </SubmitButton>
        </form>
        <form action={setSourceEnabled}>
          <input type="hidden" name="id" value={s.id} />
          <input type="hidden" name="enabled" value={s.enabled ? "false" : "true"} />
          <SubmitButton
            variant="ghost-icon"
            className={s.enabled ? "" : "text-ok"}
            aria-label={`${s.enabled ? "Désactiver" : "Activer"} « ${s.name} »`}
            title={s.enabled ? "Désactiver" : "Activer"}
          >
            <IconPower size={15} />
          </SubmitButton>
        </form>
        <Link
          href={`/admin?edit=${s.id}#source-form`}
          className={buttonClass("ghost-icon")}
          aria-label={`Modifier « ${s.name} »`}
          title="Modifier"
        >
          <IconPencil size={15} />
        </Link>
        <SourceDeleteButton id={s.id} name={s.name} enabled={s.enabled} />
      </div>
    </li>
  );
}

function SourceForm({ forums, editing }: { forums: Forum[]; editing?: AdminSource }) {
  return (
    <form
      id="source-form"
      action={editing ? updateSource : createSource}
      className="scroll-mt-4 border-t border-line bg-surface-alt p-3.5 md:p-4"
      key={editing?.id ?? "new"}
    >
      <p className="mb-2.5 text-sm font-semibold">{editing ? `Modifier « ${editing.name} »` : "Nouvelle source RSS / Atom"}</p>
      {editing && <input type="hidden" name="id" value={editing.id} />}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(180px,100%),1fr))] gap-2.5">
        <label className={LABEL}>
          Nom
          <input name="name" required maxLength={100} defaultValue={editing?.name} placeholder="CERT-FR" className={FIELD} />
        </label>
        <label className={`${LABEL} sm:col-span-2`}>
          URL du flux
          <input
            name="url"
            type="url"
            required
            maxLength={2000}
            defaultValue={editing?.url}
            placeholder="https://www.cert.ssi.gouv.fr/feed/"
            className={`${FIELD} font-mono text-sm`}
          />
        </label>
        <label className={LABEL}>
          Forum
          <select name="forumId" required defaultValue={editing?.forumId ?? forums[0]?.id} className={FIELD}>
            {forums.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {editing && (
        <p className="mt-2 text-xs text-fg-muted">
          Changer de forum ne déplace pas les topics existants. Changer d&apos;URL relance un import initial (marqué comme lu).
        </p>
      )}
      <div className="mt-3 flex justify-end gap-2">
        {editing ? (
          <LinkButton href="/admin#sources" variant="secondary">
            Annuler
          </LinkButton>
        ) : (
          <button type="reset" className={buttonClass("secondary")}>
            Annuler
          </button>
        )}
        <SubmitButton variant="primary">{editing ? "Enregistrer" : "Ajouter"}</SubmitButton>
      </div>
    </form>
  );
}

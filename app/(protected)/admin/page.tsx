import { asc, count, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { Breadcrumb } from "@/components/breadcrumb";
import { Flash } from "@/components/flash";
import { SubmitButton } from "@/components/submit-button";
import {
  createForum,
  createSource,
  deleteForum,
  deleteSource,
  fetchSourceNow,
  setSourceEnabled,
  updateForum,
  updateSource,
} from "@/lib/actions/admin";
import { getDb } from "@/lib/db";
import { forums, sources, topics, type Forum, type Source } from "@/lib/db/schema";
import { formatDateTime, formatRelative, formatTime } from "@/lib/format";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Administration" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

function SourceStatus({ source, now }: { source: Source; now: Date }) {
  const paused = source.pausedUntil && source.pausedUntil > now;
  return (
    <div className="text-[0.85rem]">
      {!source.enabled ? (
        <span className="font-bold text-read">Désactivée</span>
      ) : paused ? (
        <span className="font-bold text-danger">En pause jusqu&apos;à {formatTime(source.pausedUntil!)}</span>
      ) : source.lastError && source.consecutiveFailures > 0 ? (
        <span className="font-bold text-danger">En erreur</span>
      ) : source.lastFetchedAt ? (
        <span className="font-bold text-ok">OK</span>
      ) : (
        <span className="text-read">En attente du premier passage</span>
      )}
      <div className="text-read" title={source.lastFetchedAt ? formatDateTime(source.lastFetchedAt) : undefined}>
        Dernier succès : {source.lastFetchedAt ? formatRelative(source.lastFetchedAt, now) : "jamais"}
      </div>
      {source.lastError && (
        <div className="mt-1 break-words text-danger">
          {source.consecutiveFailures > 0
            ? `${source.consecutiveFailures} échec(s) consécutif(s) : `
            : "Dernière erreur (avant réactivation) : "}
          {source.lastError}
        </div>
      )}
    </div>
  );
}

function ForumSelect({ forums, value }: { forums: Forum[]; value?: number }) {
  return (
    <select name="forumId" className="input" defaultValue={value} required aria-label="Forum">
      {forums.map((f) => (
        <option key={f.id} value={f.id}>
          {f.name}
        </option>
      ))}
    </select>
  );
}

export default async function AdminPage({ searchParams }: Props) {
  await requireSession();
  const query = await searchParams;
  const db = getDb();
  const now = new Date();

  const forumRows = await db.select().from(forums).orderBy(asc(forums.position), asc(forums.name));
  const topicCounts = new Map(
    (await db.select({ forumId: topics.forumId, n: count() }).from(topics).groupBy(topics.forumId)).map((r) => [r.forumId, r.n]),
  );
  const sourceRows = await db
    .select({ source: sources, forumName: forums.name })
    .from(sources)
    .innerJoin(forums, eq(forums.id, sources.forumId))
    .orderBy(asc(forums.position), asc(forums.name), asc(sources.name));
  const sourceCounts = new Map<number, number>();
  for (const { source } of sourceRows) sourceCounts.set(source.forumId, (sourceCounts.get(source.forumId) ?? 0) + 1);

  return (
    <>
      <Breadcrumb items={[{ label: "Administration" }]} />
      <Flash ok={query.ok} error={query.error} />

      {/* ------------------------------------------------------------ Forums */}
      <section id="forums" className="mb-6 scroll-mt-4">
        <h2 className="mb-2 text-lg font-bold text-bar">Forums</h2>
        <div className="overflow-x-auto">
          <table className="forum-table">
            <thead>
              <tr>
                <th className="w-20">Ordre</th>
                <th>Nom</th>
                <th>Slug</th>
                <th className="w-32 text-right">Contenu</th>
                <th className="w-48">Actions</th>
              </tr>
            </thead>
            <tbody>
              {forumRows.map((f) => {
                const formId = `forum-${f.id}`;
                return (
                  <tr key={f.id}>
                    <td>
                      <input form={formId} name="position" type="number" defaultValue={f.position} className="input w-16" aria-label="Ordre" />
                    </td>
                    <td>
                      <input form={formId} name="name" defaultValue={f.name} required maxLength={100} className="input w-full" aria-label="Nom" />
                    </td>
                    <td>
                      <input form={formId} name="slug" defaultValue={f.slug} maxLength={60} className="input w-full" aria-label="Slug" />
                    </td>
                    <td className="text-right text-[0.85rem] text-read">
                      {sourceCounts.get(f.id) ?? 0} src · {topicCounts.get(f.id) ?? 0} topics
                    </td>
                    <td>
                      <div className="flex gap-1">
                        <form id={formId} action={updateForum}>
                          <input type="hidden" name="id" value={f.id} />
                          <SubmitButton>Enregistrer</SubmitButton>
                        </form>
                        <form action={deleteForum}>
                          <input type="hidden" name="id" value={f.id} />
                          <SubmitButton className="btn btn-danger">Supprimer</SubmitButton>
                        </form>
                      </div>
                    </td>
                  </tr>
                );
              })}
              <tr>
                <td>
                  <input form="forum-new" name="position" type="number" defaultValue={(forumRows.at(-1)?.position ?? 0) + 10} className="input w-16" aria-label="Ordre" />
                </td>
                <td>
                  <input form="forum-new" name="name" required maxLength={100} placeholder="Nouveau forum (ex. Sécu/CVE)" className="input w-full" aria-label="Nom" />
                </td>
                <td>
                  <input form="forum-new" name="slug" maxLength={60} placeholder="auto" className="input w-full" aria-label="Slug" />
                </td>
                <td />
                <td>
                  <form id="forum-new" action={createForum}>
                    <SubmitButton className="btn btn-primary">Créer</SubmitButton>
                  </form>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* ----------------------------------------------------------- Sources */}
      <section id="sources" className="scroll-mt-4">
        <h2 className="mb-2 text-lg font-bold text-bar">Sources</h2>
        {forumRows.length === 0 ? (
          <p className="panel p-3">Crée d&apos;abord un forum.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="forum-table">
                <thead>
                  <tr>
                    <th>Source</th>
                    <th className="w-36">Forum</th>
                    <th className="w-64">Statut</th>
                    <th className="w-72">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sourceRows.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-3 text-center text-read">
                        Aucune source.
                      </td>
                    </tr>
                  )}
                  {sourceRows.map(({ source: s, forumName }) => (
                    <tr key={s.id} className="align-top">
                      <td className="align-top">
                        <div className={`font-bold ${s.enabled ? "" : "text-read"}`}>{s.name}</div>
                        <div className="break-all text-[0.8rem] text-read">{s.url}</div>
                        <details className="mt-1">
                          <summary className="cursor-pointer text-[0.85rem] text-link">Modifier</summary>
                          <form action={updateSource} className="mt-1 flex flex-col gap-1">
                            <input type="hidden" name="id" value={s.id} />
                            <input name="name" defaultValue={s.name} required maxLength={100} className="input" aria-label="Nom" />
                            <input name="url" type="url" defaultValue={s.url} required maxLength={2000} className="input" aria-label="URL du flux" />
                            <ForumSelect forums={forumRows} value={s.forumId} />
                            <p className="text-[0.8rem] text-read">
                              Changer de forum ne déplace pas les topics existants. Changer d&apos;URL relance un import initial
                              (marqué comme lu).
                            </p>
                            <SubmitButton className="btn self-start">Enregistrer</SubmitButton>
                          </form>
                        </details>
                      </td>
                      <td className="align-top">{forumName}</td>
                      <td className="align-top">
                        <SourceStatus source={s} now={now} />
                      </td>
                      <td className="align-top">
                        <div className="flex flex-wrap gap-1">
                          <form action={fetchSourceNow}>
                            <input type="hidden" name="id" value={s.id} />
                            <SubmitButton pendingLabel="Récupération…">Récupérer maintenant</SubmitButton>
                          </form>
                          <form action={setSourceEnabled}>
                            <input type="hidden" name="id" value={s.id} />
                            <input type="hidden" name="enabled" value={s.enabled ? "false" : "true"} />
                            <SubmitButton>{s.enabled ? "Désactiver" : "Activer"}</SubmitButton>
                          </form>
                        </div>
                        <details className="mt-1">
                          <summary className="cursor-pointer text-[0.85rem] text-danger">Supprimer…</summary>
                          <div className="mt-1 border border-line bg-row p-2 text-[0.85rem]">
                            {s.enabled ? (
                              <>
                                <p className="mb-2">
                                  Tu veux juste arrêter de la suivre ? <strong>Désactive-la</strong> : rien n&apos;est perdu et tu
                                  pourras la réactiver.
                                </p>
                                <form action={setSourceEnabled} className="mb-2">
                                  <input type="hidden" name="id" value={s.id} />
                                  <input type="hidden" name="enabled" value="false" />
                                  <SubmitButton className="btn btn-primary">Désactiver</SubmitButton>
                                </form>
                              </>
                            ) : null}
                            <p className="mb-2">
                              Supprimer définitivement : les topics et tes notes sont conservés, l&apos;auteur affiché devient
                              « Source supprimée ».
                            </p>
                            <form action={deleteSource}>
                              <input type="hidden" name="id" value={s.id} />
                              <SubmitButton className="btn btn-danger">Supprimer définitivement</SubmitButton>
                            </form>
                          </div>
                        </details>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <form action={createSource} className="panel mt-3">
              <h3 className="panel-title">Ajouter une source RSS / Atom</h3>
              <div className="flex flex-wrap items-end gap-2 p-3">
                <label className="flex flex-col gap-1">
                  <span>Nom</span>
                  <input name="name" required maxLength={100} className="input" placeholder="CERT-FR" />
                </label>
                <label className="flex min-w-0 flex-1 basis-64 flex-col gap-1">
                  <span>URL du flux</span>
                  <input name="url" type="url" required maxLength={2000} className="input w-full" placeholder="https://…/feed.xml" />
                </label>
                <label className="flex flex-col gap-1">
                  <span>Forum</span>
                  <ForumSelect forums={forumRows} />
                </label>
                <label className="flex items-center gap-1 pb-1">
                  <input type="checkbox" name="enabled" defaultChecked /> Active
                </label>
                <SubmitButton className="btn btn-primary">Ajouter</SubmitButton>
              </div>
            </form>
          </>
        )}
      </section>
    </>
  );
}

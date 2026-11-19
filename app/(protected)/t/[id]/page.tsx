import { and, asc, eq, isNull } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Breadcrumb } from "@/components/breadcrumb";
import { Flash } from "@/components/flash";
import { SubmitButton } from "@/components/submit-button";
import { addNote } from "@/lib/actions/topics";
import { getDb } from "@/lib/db";
import { forums, replies, sources, topics, type ReplyType } from "@/lib/db/schema";
import { formatDateTime } from "@/lib/format";
import { requireSession } from "@/lib/session";
import { NOTE_MAX_LENGTH } from "@/lib/validation";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const REPLY_LABEL: Record<ReplyType, string> = {
  note: "Note perso",
  source: "Autre source",
  comment: "Commentaire",
};

async function getTopic(rawId: string) {
  const topicId = Number(rawId);
  if (!Number.isSafeInteger(topicId) || topicId <= 0) return undefined;
  const [row] = await getDb()
    .select({ topic: topics, forum: forums, sourceName: sources.name })
    .from(topics)
    .innerJoin(forums, eq(forums.id, topics.forumId))
    .leftJoin(sources, eq(sources.id, topics.sourceId))
    .where(eq(topics.id, topicId));
  return row;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  await requireSession();
  const row = await getTopic((await params).id);
  return { title: row?.topic.title ?? "Topic introuvable" };
}

function Post({
  id,
  author,
  authorMuted,
  badge,
  date,
  children,
}: {
  id?: string;
  author: string;
  authorMuted?: boolean;
  badge: string;
  date: Date;
  children: React.ReactNode;
}) {
  return (
    <article id={id} className="panel mb-3 flex flex-col sm:flex-row">
      <aside className="border-line bg-row p-2 text-[0.85rem] sm:w-44 sm:shrink-0 sm:border-r">
        <div className={`font-bold ${authorMuted ? "italic text-read" : "text-bar"}`}>{author}</div>
        <div className="text-read">{badge}</div>
      </aside>
      <div className="min-w-0 flex-1">
        <div className="border-b border-line px-3 py-1 text-[0.8rem] text-read">Posté le {formatDateTime(date)}</div>
        <div className="px-3 py-2">{children}</div>
      </div>
    </article>
  );
}

export default async function TopicPage({ params, searchParams }: Props) {
  const session = await requireSession();
  const query = await searchParams;
  const row = await getTopic((await params).id);
  if (!row) notFound();
  const { topic, forum, sourceName } = row;

  const db = getDb();
  // Opening the topic marks it as read.
  if (topic.readAt === null) {
    await db.update(topics).set({ readAt: new Date() }).where(and(eq(topics.id, topic.id), isNull(topics.readAt)));
  }
  const replyRows = await db
    .select()
    .from(replies)
    .where(eq(replies.topicId, topic.id))
    .orderBy(asc(replies.createdAt), asc(replies.id));

  return (
    <>
      <Breadcrumb items={[{ label: forum.name, href: `/f/${forum.slug}` }, { label: topic.title }]} />
      <Flash ok={query.ok} error={query.error} />
      <h1 className="mb-3 text-xl font-bold text-bar">{topic.title}</h1>

      <Post author={sourceName ?? "Source supprimée"} authorMuted={!sourceName} badge="Source" date={topic.publishedAt}>
        {topic.excerpt ? (
          <p className="mb-3 whitespace-pre-line leading-relaxed">{topic.excerpt}</p>
        ) : (
          <p className="mb-3 italic text-read">Pas de résumé dans le flux.</p>
        )}
        <a href={topic.url} target="_blank" rel="noopener noreferrer" className="btn btn-primary">
          Lire l&apos;article ↗
        </a>
      </Post>

      {replyRows.map((r) => (
        <Post key={r.id} id={`reply-${r.id}`} author={r.author} badge={REPLY_LABEL[r.type]} date={r.createdAt}>
          <p className="whitespace-pre-wrap break-words leading-relaxed">{r.content}</p>
          {r.url && (
            <a href={r.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-[0.85rem]">
              Lien ↗
            </a>
          )}
        </Post>
      ))}

      <section id="note-form" className="panel mt-4">
        <h2 className="panel-title">Ajouter une note perso</h2>
        <form action={addNote} className="flex flex-col gap-2 p-3">
          <input type="hidden" name="topicId" value={topic.id} />
          <textarea
            name="content"
            required
            maxLength={NOTE_MAX_LENGTH}
            rows={5}
            className="input w-full"
            placeholder={`Note de ${session.user.name}…`}
            aria-label="Contenu de la note"
          />
          <SubmitButton className="btn btn-primary self-start" pendingLabel="Envoi…">
            Poster
          </SubmitButton>
        </form>
      </section>
    </>
  );
}

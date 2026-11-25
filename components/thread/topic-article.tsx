import { cache } from "react";
import { SaveTopicForOffline } from "@/components/pwa/offline-page-cache";
import type { SavedState } from "@/components/lists/saved-state";
import { SaveButton } from "@/components/lists/save-button";
import { SubmitButton } from "@/components/ui/submit-button";
import { reloadArticle } from "@/lib/actions/topics";
import { currentAiConfig } from "@/lib/secrets/effective";
import { getStoredAiOutputs } from "@/lib/ai/service";
import { articleText, detectLanguage } from "@/lib/ai/text";
import { getDb } from "@/lib/db";
import { formatFull, formatShort, formatTitle } from "@/lib/format-date";
import { getArticle } from "@/lib/reader/article";
import { ArticleView, type AiProps } from "./article-view";

type TopicRef = { id: number; url: string; excerpt: string; title: string };

/**
 * The article of a topic, once per request: the body and the « récupéré le » of the #1 header
 * both wait on it, and the first opening may download the page (up to 10 s).
 */
const loadArticle = cache((id: number, url: string) => getArticle(getDb(), { id, url }));

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** « proxmox.com ↗ » at the end of the article, and the discreet « Recharger l'article » next to it. */
function ArticleFooter({ topic, reload = true }: { topic: TopicRef; reload?: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3">
      <a href={topic.url} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 min-w-0 items-center gap-1 font-mono text-sm">
        <span className="truncate">{hostOf(topic.url)}</span> <span aria-hidden="true">↗</span>
        <span className="sr-only"> (article d&apos;origine, nouvel onglet)</span>
      </a>
      {reload && (
        <form action={reloadArticle}>
          <input type="hidden" name="topicId" value={topic.id} />
          <SubmitButton variant="ghost" size="sm" pendingLabel="Rechargement…" className="md:h-11">
            Recharger l&apos;article
          </SubmitButton>
        </form>
      )}
    </div>
  );
}

/** « récupéré le 25 nov. 2026 à 09:20 » on the right of the #1 header (docs/design/v3.1 § 6). */
export async function ArticleFetchedAt({ topic }: { topic: TopicRef }) {
  const article = await loadArticle(topic.id, topic.url);
  if (!article.html) return null;
  const d = article.fetchedAt;
  return (
    <time dateTime={d.toISOString()} title={formatTitle(d)}>
      récupéré le <span className="hidden md:inline">{formatFull(d)}</span>
      <span className="md:hidden">{formatShort(d)}</span>
    </time>
  );
}

/** While the article is fetched (streamed with Suspense): ★ already usable, the body as a skeleton. */
export function TopicArticleSkeleton({ topic, saved }: { topic: TopicRef; saved: SavedState }) {
  return (
    <>
      <SaveButton topicId={topic.id} topicTitle={topic.title} initial={saved} />
      <div id="article" className="flex flex-col gap-2.5" role="status" aria-live="polite">
        <span className="sr-only">Chargement de l&apos;article…</span>
        {[92, 100, 85, 96, 60].map((w, i) => (
          <span key={i} className="h-3.5 animate-pulse-soft rounded-sm bg-off-soft motion-reduce:animate-none" style={{ width: `${w}%` }} />
        ))}
      </div>
      <ArticleFooter topic={topic} reload={false} />
    </>
  );
}

/**
 * The topic's article: sanitized HTML (lib/reader/sanitize.ts) from the feed or extracted from the
 * page, under the action bar; on failure, a message, the feed excerpt and the link to the original.
 */
export async function TopicArticle({ topic, saved }: { topic: TopicRef; saved: SavedState }) {
  const article = await loadArticle(topic.id, topic.url);

  if (!article.html) {
    return (
      <>
        <SaveButton topicId={topic.id} topicTitle={topic.title} initial={saved} />
        <div id="article" className="flex flex-col gap-2 rounded-sm border border-warn bg-warn-soft px-3.5 py-3" role="status">
          <p className="font-semibold text-warn">Article non disponible</p>
          {article.error && <p className="text-sm text-fg-muted">{article.error}.</p>}
        </div>
        {topic.excerpt ? (
          <p className="max-w-[72ch] text-md">{topic.excerpt}</p>
        ) : (
          <p className="text-md text-fg-muted italic">Pas de résumé dans le flux.</p>
        )}
        <ArticleFooter topic={topic} />
        <SaveTopicForOffline />
      </>
    );
  }

  const config = await currentAiConfig(getDb());
  let ai: AiProps | null = null;
  if (config) {
    // Results already made (on any device): from the database, never a call to Gemini here.
    const stored = await getStoredAiOutputs(getDb(), topic.id, article.fetchedAt, config);
    const lang = detectLanguage(articleText(article.html));
    ai = {
      canTranslate: lang !== "fr",
      sourceLang: lang,
      initialSummary: stored.summary ?? null,
      initialTranslation: stored.translation ?? null,
    };
  }

  return (
    <>
      <ArticleView
        // A reloaded article starts over (its stored results belong to the previous version).
        key={article.fetchedAt.getTime()}
        topicId={topic.id}
        topicTitle={topic.title}
        saved={saved}
        ai={ai}
      >
        {/* Sanitized server-side with a strict allow-list before storage (see lib/reader/sanitize.ts). */}
        <div id="article" className="article-body" dangerouslySetInnerHTML={{ __html: article.html }} />
      </ArticleView>
      <ArticleFooter topic={topic} />
      <SaveTopicForOffline />
    </>
  );
}

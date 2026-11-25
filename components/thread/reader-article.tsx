import { SaveTopicForOffline } from "@/components/pwa/offline-page-cache";
import { buttonClass } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { reloadArticle } from "@/lib/actions/topics";
import { getDb } from "@/lib/db";
import { formatFull } from "@/lib/format-date";
import { aiConfig } from "@/lib/ai/config";
import { getStoredAiOutputs } from "@/lib/ai/service";
import { articleText, isFrench } from "@/lib/ai/text";
import { getArticle } from "@/lib/reader/article";
import { AiArticle } from "./ai-article";

type TopicRef = { id: number; url: string; excerpt: string };

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function OriginalLink({ url }: { url: string }) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className={buttonClass("primary", "md")}>
      Lire l&apos;article <span aria-hidden="true">↗</span>
    </a>
  );
}

function ReloadButton({ topicId }: { topicId: number }) {
  return (
    <form action={reloadArticle}>
      <input type="hidden" name="topicId" value={topicId} />
      <SubmitButton variant="secondary" size="md" pendingLabel="Rechargement…">
        Recharger l&apos;article
      </SubmitButton>
    </form>
  );
}

function Actions({ topic }: { topic: TopicRef }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <OriginalLink url={topic.url} />
      <ReloadButton topicId={topic.id} />
      <span className="truncate font-mono text-sm text-fg-muted">{hostOf(topic.url)}</span>
    </div>
  );
}

/** Shown while the page is downloaded and extracted (streamed with Suspense). */
export function ReaderArticleSkeleton({ topic }: { topic: TopicRef }) {
  return (
    <>
      <div id="article" className="flex flex-col gap-2" role="status" aria-live="polite">
        <span className="text-sm text-fg-muted">Chargement de l&apos;article en mode lecture…</span>
        {[92, 100, 85, 96, 60].map((w, i) => (
          <span key={i} className="h-3.5 animate-pulse-soft rounded-sm bg-off-soft" style={{ width: `${w}%` }} />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <OriginalLink url={topic.url} />
        <span className="truncate font-mono text-sm text-fg-muted">{hostOf(topic.url)}</span>
      </div>
    </>
  );
}

/**
 * Reading mode of a topic: sanitized article HTML (lib/reader/sanitize.ts)
 * from the feed or extracted from the page; on failure, a message, the feed
 * excerpt and the link to the original.
 */
export async function ReaderArticle({ topic }: { topic: TopicRef }) {
  const article = await getArticle(getDb(), topic);

  if (!article.html) {
    return (
      <>
        <div id="article" className="flex flex-col gap-2 rounded-sm border border-warn bg-warn-soft px-3.5 py-3" role="status">
          <p className="font-semibold text-warn">Article non disponible en mode lecture</p>
          {article.error && <p className="text-sm text-fg-muted">{article.error}.</p>}
          <p className="text-sm">
            <a href={topic.url} target="_blank" rel="noopener noreferrer">
              Lire l&apos;article sur {hostOf(topic.url)} <span aria-hidden="true">↗</span>
            </a>
          </p>
        </div>
        {topic.excerpt ? (
          <p className="max-w-[72ch] text-md">{topic.excerpt}</p>
        ) : (
          <p className="text-md text-fg-muted italic">Pas de résumé dans le flux.</p>
        )}
        <Actions topic={topic} />
        <SaveTopicForOffline />
      </>
    );
  }

  const config = aiConfig();
  // Results already made (on any device): shown from the database, never a call to Gemini here.
  const stored = config ? await getStoredAiOutputs(getDb(), topic.id, article.fetchedAt, config) : {};

  return (
    <>
      <p className="text-xs text-fg-muted">
        Mode lecture · {article.source === "feed" ? "contenu fourni par le flux" : "extrait de la page d'origine"} ·{" "}
        <time dateTime={article.fetchedAt.toISOString()}>{formatFull(article.fetchedAt)}</time>
      </p>
      {config ? (
        // Résumer / Traduire (Gemini, server side): only when GEMINI_API_KEY is set.
        <AiArticle
          // A reloaded article starts over (its stored results belong to the previous version).
          key={article.fetchedAt.getTime()}
          topicId={topic.id}
          canTranslate={!isFrench(articleText(article.html))}
          initialSummary={stored.summary ?? null}
          initialTranslation={stored.translation ?? null}
        >
          <ArticleBody html={article.html} />
        </AiArticle>
      ) : (
        <ArticleBody html={article.html} />
      )}
      <Actions topic={topic} />
      <SaveTopicForOffline />
    </>
  );
}

function ArticleBody({ html }: { html: string }) {
  // Sanitized server-side with a strict allow-list before storage (see lib/reader/sanitize.ts).
  return <div id="article" className="reader" dangerouslySetInnerHTML={{ __html: html }} />;
}

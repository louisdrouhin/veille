"use client";

import { useRef, useState, useTransition } from "react";
import { SaveButton } from "@/components/lists/save-button";
import type { SavedState } from "@/components/lists/saved-state";
import { runAi } from "@/lib/actions/ai";
import type { AiOutput } from "@/lib/ai/service";
import type { AiKind } from "@/lib/db/schema";
import { cachePageForOffline } from "@/lib/pwa/client";
import { AiAlert, AiSkeleton, AiSummaryPanel, AiTools, TranslationBanner, type ToolState } from "./ai-tools";

export type AiProps = {
  canTranslate: boolean;
  /** Detected language of the article (« en »…), null when unsure. */
  sourceLang: string | null;
  /** Results made before, on any device (server render, no call to Gemini). */
  initialSummary: AiOutput | null;
  initialTranslation: AiOutput | null;
};

type Tool = { output: AiOutput | null; open: boolean; loading: boolean; error: string | null };

const ERROR_TITLE: Record<AiKind, string> = { summary: "Résumé indisponible.", translation: "Traduction indisponible." };

/**
 * Head of the topic's article (docs/design/v3.1): the action bar (★ + AI tools), the « Dans … »
 * chips, the summary or the errors, then the article body — original, or its translation.
 * Without `ai` (no key, or no article to work on), the bar holds ★ alone.
 */
export function ArticleView({
  topicId,
  topicTitle,
  saved,
  ai,
  children,
}: {
  topicId: number;
  topicTitle: string;
  saved: SavedState;
  ai: AiProps | null;
  children: React.ReactNode;
}) {
  const [tools, setTools] = useState<Record<AiKind, Tool>>(() => ({
    // A summary made before is shown at once; a translation made before waits for « Traduire ».
    summary: { output: ai?.initialSummary ?? null, open: Boolean(ai?.initialSummary), loading: false, error: null },
    translation: { output: ai?.initialTranslation ?? null, open: false, loading: false, error: null },
  }));
  const [, startTransition] = useTransition();
  const summaryRef = useRef<HTMLButtonElement>(null);
  // Two quick clicks both run before the re-render: the ref, not the state, keeps it to one request.
  const running = useRef(new Set<AiKind>());

  const update = (kind: AiKind, patch: Partial<Tool>) => setTools((t) => ({ ...t, [kind]: { ...t[kind], ...patch } }));

  function toggle(kind: AiKind) {
    const tool = tools[kind];
    if (tool.loading || running.current.has(kind)) return;
    if (tool.open) return update(kind, { open: false });
    // Already made (here or on another device): shown at once, no call.
    if (tool.output) return update(kind, { open: true, error: null });
    update(kind, { loading: true, error: null });
    running.current.add(kind);
    startTransition(async () => {
      const res = await runAi(topicId, kind)
        .catch(() => ({ ok: false as const, error: "Connexion au serveur impossible." }))
        .finally(() => running.current.delete(kind));
      if (!res.ok) return update(kind, { loading: false, error: res.error });
      update(kind, { loading: false, output: res, open: true });
      // The page now renders with this result: refresh the offline copy (lib/pwa/service-worker.js).
      cachePageForOffline(window.location.pathname, { force: true });
    });
  }

  const state = (t: Tool): ToolState => (t.loading ? "loading" : t.open && t.output ? "active" : "rest");
  const { summary, translation } = tools;
  const translated = translation.open && translation.output !== null;

  return (
    <>
      <SaveButton
        topicId={topicId}
        topicTitle={topicTitle}
        initial={saved}
        actions={
          ai && (
            <AiTools
              summary={state(summary)}
              translation={state(translation)}
              canTranslate={ai.canTranslate}
              sourceLang={ai.sourceLang}
              onSummary={() => toggle("summary")}
              onTranslation={() => toggle("translation")}
              summaryRef={summaryRef}
            />
          )
        }
      />

      {(["summary", "translation"] as const).map(
        (kind) =>
          tools[kind].error && <AiAlert key={kind} title={ERROR_TITLE[kind]} message={tools[kind].error!} onRetry={() => toggle(kind)} />,
      )}

      {(summary.loading || (summary.open && summary.output)) && (
        <AiSummaryPanel
          output={summary.loading ? null : summary.output}
          onClose={() => {
            update("summary", { open: false });
            summaryRef.current?.focus();
          }}
        />
      )}

      {(translation.loading || translated) && <TranslationBanner loading={translation.loading} sourceLang={ai?.sourceLang ?? null} />}
      {translation.loading && <AiSkeleton lines={[96, 90, 100, 64]} />}
      {translated && !translation.loading && (
        <div lang="fr" className="article-body" dangerouslySetInnerHTML={{ __html: translation.output!.html }} />
      )}
      {/* The original stays mounted (and in the offline copy), hidden while the translation is shown. */}
      <div hidden={translated || translation.loading} lang={ai?.sourceLang && ai.sourceLang !== "fr" ? ai.sourceLang : undefined}>
        {children}
      </div>
    </>
  );
}

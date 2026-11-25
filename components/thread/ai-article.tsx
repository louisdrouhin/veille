"use client";

import { useState, useTransition } from "react";
import { buttonClass } from "@/components/ui/button";
import { runAi } from "@/lib/actions/ai";
import { cachePageForOffline } from "@/lib/pwa/client";
import type { AiOutput } from "@/lib/ai/service";
import type { AiKind } from "@/lib/db/schema";

function AiNote({ output }: { output: AiOutput }) {
  return (
    <p className="text-xs text-fg-muted">
      Généré par IA ({output.model}), peut contenir des erreurs
      {output.truncated && " · réponse tronquée"}
      {output.inputCut && " · article trop long, seul le début a été traité"}
    </p>
  );
}

/**
 * « Résumer » and « Traduire en français » around the reading-mode article, on demand only. The
 * summary goes above the article; the translation replaces it on screen (« Voir l'original »).
 * The HTML comes from the server already rendered and sanitized (lib/ai/service.ts).
 *
 * Results made before, on any device, come with the page (server render, no call): the summary
 * is shown (« Masquer le résumé »), the translation is one click away (« Voir la traduction »).
 */
export function AiArticle({
  topicId,
  canTranslate,
  initialSummary,
  initialTranslation,
  children,
}: {
  topicId: number;
  canTranslate: boolean;
  initialSummary: AiOutput | null;
  initialTranslation: AiOutput | null;
  children: React.ReactNode;
}) {
  const [summary, setSummary] = useState<AiOutput | null>(initialSummary);
  const [summaryHidden, setSummaryHidden] = useState(false);
  const [translation, setTranslation] = useState<AiOutput | null>(initialTranslation);
  const [showTranslation, setShowTranslation] = useState(false);
  const [pending, setPending] = useState<AiKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function run(kind: AiKind) {
    if (kind === "translation" && translation) {
      setShowTranslation(true);
      return;
    }
    setError(null);
    setPending(kind);
    startTransition(async () => {
      const res = await runAi(topicId, kind).catch(() => ({ ok: false as const, error: "Connexion au serveur impossible : réessaie." }));
      setPending(null);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (kind === "summary") setSummary(res);
      else {
        setTranslation(res);
        setShowTranslation(true);
      }
      // The page now renders with this result: refresh the offline copy (lib/pwa/service-worker.js).
      cachePageForOffline(window.location.pathname, { force: true });
    });
  }

  const translated = showTranslation && translation;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {summary ? (
          <button type="button" className={buttonClass("secondary", "sm")} onClick={() => setSummaryHidden((h) => !h)} aria-expanded={!summaryHidden}>
            {summaryHidden ? "Afficher le résumé" : "Masquer le résumé"}
          </button>
        ) : (
          <button type="button" className={buttonClass("secondary", "sm")} onClick={() => run("summary")} disabled={pending !== null} aria-busy={pending === "summary"}>
            {pending === "summary" ? "Résumé en cours…" : "Résumer"}
          </button>
        )}
        {canTranslate &&
          (translated ? (
            <button type="button" className={buttonClass("secondary", "sm")} onClick={() => setShowTranslation(false)}>
              Voir l&apos;original
            </button>
          ) : (
            <button type="button" className={buttonClass("secondary", "sm")} onClick={() => run("translation")} disabled={pending !== null} aria-busy={pending === "translation"}>
              {pending === "translation" ? "Traduction en cours…" : translation ? "Voir la traduction" : "Traduire en français"}
            </button>
          ))}
      </div>
      <p role="status" className={error ? "text-sm text-err" : "sr-only"}>
        {error ?? (pending === "summary" ? "Résumé en cours" : pending === "translation" ? "Traduction en cours" : "")}
      </p>

      {summary && !summaryHidden && (
        <section aria-label="Résumé" className="flex flex-col gap-1.5 rounded-sm border border-line bg-surface-alt px-3.5 py-3">
          <h2 className="font-cond text-sm font-semibold tracking-caps text-fg-muted uppercase">Résumé</h2>
          {/* Rendered by a closed Markdown renderer, then sanitized server-side (lib/ai/service.ts). */}
          <div className="reader" dangerouslySetInnerHTML={{ __html: summary.html }} />
          <AiNote output={summary} />
        </section>
      )}

      {translated && (
        <section aria-label="Traduction en français" lang="fr" className="flex flex-col gap-2">
          <div className="reader" dangerouslySetInnerHTML={{ __html: translation.html }} />
          <AiNote output={translation} />
        </section>
      )}
      {/* The original stays mounted (and in the offline copy), only hidden while the translation is shown. */}
      <div hidden={Boolean(translated)}>
        {children}
      </div>
    </>
  );
}

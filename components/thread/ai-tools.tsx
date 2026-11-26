"use client";

import { IconClose, IconSparkle, IconSpinner, IconTranslate } from "@/components/ui/icons";
import type { AiOutput } from "@/lib/ai/service";

/** State of one AI tool in the action bar (docs/design/v3.1 § 2). */
export type ToolState = "rest" | "loading" | "active";

/** Wording for a detected source language (lib/ai/text.ts detectLanguage); generic otherwise. */
const LANG: Record<string, { banner: string; original: string }> = {
  en: { banner: "Traduit de l'anglais", original: "Voir l'original en anglais" },
};

/** Short label on mobile (one line at 390 px), full label from md. */
function Label({ short, full }: { short: string; full: string }) {
  return (
    <>
      <span className="md:hidden">{short}</span>
      <span className="hidden md:inline">{full}</span>
    </>
  );
}

function ToolButton({
  state,
  icon,
  rest,
  active,
  activeLabel,
  onClick,
  buttonRef,
}: {
  state: ToolState;
  icon: React.ReactNode;
  rest: { short: string; full: string };
  active: { short: string; full: string };
  activeLabel: string;
  onClick: () => void;
  buttonRef?: React.Ref<HTMLButtonElement>;
}) {
  const on = state === "active";
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-pressed={on}
      aria-busy={state === "loading"}
      aria-label={on ? activeLabel : undefined}
      // While loading, clicks are ignored (not disabled: the focus stays on the button).
      onClick={() => state !== "loading" && onClick()}
      className={`inline-flex h-11 cursor-pointer items-center gap-1.5 rounded-full px-2 text-[13.5px] whitespace-nowrap md:px-2.5 ${
        on ? "bg-accent-soft font-semibold text-accent" : "font-medium text-fg-muted hover:text-fg"
      } ${state === "loading" ? "cursor-progress" : ""}`}
    >
      {state === "loading" ? <IconSpinner size={16} /> : icon}
      {on ? <Label {...active} /> : <Label {...rest} />}
    </button>
  );
}

/**
 * « Outils IA »: Résumer / Traduire, a discreet pill on the right of the action bar (§ 3).
 * Not rendered at all without an AI key; Traduire is absent for a French article.
 */
export function AiTools({
  summary,
  translation,
  canTranslate,
  sourceLang,
  onSummary,
  onTranslation,
  summaryRef,
  sourceCount = 1,
}: {
  sourceCount?: number;
  summary: ToolState;
  translation: ToolState;
  canTranslate: boolean;
  sourceLang: string | null;
  onSummary: () => void;
  onTranslation: () => void;
  summaryRef: React.Ref<HTMLButtonElement>;
}) {
  const lang = sourceLang ? LANG[sourceLang] : undefined;
  return (
    <div role="group" aria-label="Outils IA" className="ml-auto inline-flex items-center rounded-full border border-line bg-surface px-px">
      <ToolButton
        buttonRef={summaryRef}
        state={summary}
        icon={<IconSparkle size={16} />}
        // Mobile keeps « Résumer » (no room); the panel says how many sources it covers.
        rest={{ short: "Résumer", full: sourceCount > 1 ? `Résumer les ${sourceCount} sources` : "Résumer" }}
        active={{ short: "Masquer", full: "Masquer le résumé" }}
        activeLabel="Masquer le résumé"
        onClick={onSummary}
      />
      {canTranslate && (
        <>
          <span aria-hidden="true" className="h-[22px] w-px bg-line" />
          <ToolButton
            state={translation}
            icon={<IconTranslate size={16} />}
            rest={{ short: "Traduire", full: "Traduire en français" }}
            active={{ short: "Original", full: "Voir l'original" }}
            activeLabel={lang?.original ?? "Voir l'original"}
            onClick={onTranslation}
          />
        </>
      )}
    </div>
  );
}

/** « Généré par IA » chip of the summary header; the model is in its tooltip. */
function GeneratedChip({ model }: { model?: string }) {
  return (
    <span
      title={model ? `Gemini (${model})` : undefined}
      className="inline-flex h-5 items-center gap-1 rounded-full border border-line-strong px-[7px] text-[11.5px] font-semibold whitespace-nowrap text-fg-muted"
    >
      <IconSparkle size={11} filled strokeWidth={1} />
      Généré par IA
    </span>
  );
}

function Skeleton({ lines }: { lines: number[] }) {
  return (
    <div className="flex flex-col gap-2.5" aria-hidden="true">
      {lines.map((w, i) => (
        <span key={i} className="h-3.5 animate-pulse-soft rounded-sm bg-off-soft motion-reduce:animate-none" style={{ width: `${w}%` }} />
      ))}
    </div>
  );
}

/** The summary under the bar (§ 4): loading (skeleton) or shown, with ✕. */
export function AiSummaryPanel({ output, onClose, sourceCount = 1 }: { output: AiOutput | null; onClose: () => void; sourceCount?: number }) {
  const titleId = "ai-summary-title";
  const loading = output === null;
  return (
    <section aria-labelledby={titleId} aria-busy={loading} className="overflow-hidden rounded-md border border-line-strong bg-surface">
      <div className="flex min-h-10 items-center gap-2 border-b border-line bg-surface-alt pl-3.5">
        <h2 id={titleId} className="font-cond text-[12.5px] font-bold tracking-caps uppercase">
          {sourceCount > 1 ? `Résumé de ${sourceCount} sources` : "Résumé"}
          {loading && <span className="font-medium text-fg-muted normal-case"> · Génération…</span>}
        </h2>
        {!loading && <GeneratedChip model={output.model} />}
        {!loading && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Masquer le résumé"
            className="ml-auto inline-flex size-11 cursor-pointer items-center justify-center text-fg-muted hover:text-fg"
          >
            <IconClose size={16} />
          </button>
        )}
      </div>
      <div className="flex flex-col gap-2.5 px-3.5 py-3">
        {loading ? (
          <Skeleton lines={[94, 86, 70]} />
        ) : (
          <>
            {/* Rendered by a closed Markdown renderer, then sanitized server-side (lib/ai/service.ts). */}
            <div className="article-body text-[15px]/[22px]" dangerouslySetInnerHTML={{ __html: output.html }} />
            <p className="text-[12.5px] text-fg-muted">
              Résumé automatique de l&apos;article ci-dessous, peut contenir des erreurs.
              {output.truncated && " Réponse tronquée."}
              {output.inputCut && " Article trop long : seul le début a été résumé."}
            </p>
          </>
        )}
      </div>
    </section>
  );
}

/** « Résumé indisponible. » / « Traduction indisponible. » with « Réessayer » (§ 4-5). */
export function AiAlert({ title, message, onRetry }: { title: string; message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-err bg-err-soft px-3.5 py-2 text-sm text-err">
      <p className="min-w-0 flex-1">
        <strong>{title}</strong> {message}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex h-11 cursor-pointer items-center rounded-sm border border-err bg-surface px-3.5 font-semibold text-err"
      >
        Réessayer
      </button>
    </div>
  );
}

/** Head of the article while translating, then once translated (§ 5). */
export function TranslationBanner({ loading, sourceLang }: { loading: boolean; sourceLang: string | null }) {
  if (loading) {
    return (
      <p role="status" className="flex min-h-9 items-center gap-2 rounded-sm bg-surface-alt px-3 text-[13px] text-fg-muted">
        <IconSpinner size={13} />
        Traduction en français…
      </p>
    );
  }
  const lang = sourceLang ? LANG[sourceLang] : undefined;
  return (
    <p className="flex min-h-9 items-center gap-1.5 rounded-sm border-b border-line bg-accent-soft px-3 text-[13px]">
      <IconSparkle size={13} filled strokeWidth={1} className="text-accent" />
      <span>
        {lang?.banner ?? "Traduit en français"} · <strong>Généré par IA</strong>
      </span>
    </p>
  );
}

export { Skeleton as AiSkeleton };

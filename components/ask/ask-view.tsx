"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { SearchField } from "@/components/search/search-field";
import { Highlighted } from "@/components/search/highlighted";
import { FallbackNote } from "@/components/thread/ai-tools";
import { FolderIcon } from "@/components/topic/folder-icon";
import { FORUM_BADGE } from "@/components/topic/topic-grid";
import { IconAlertCircle, IconCheck, IconClipboard, IconSparkle } from "@/components/ui/icons";
import { RelativeTime } from "@/components/ui/relative-time";
import { feedbackAction } from "@/lib/actions/ask";
import { answerAsText, liveBlocks, type AnswerBlock, type CheckedAnswer } from "@/lib/ask/render";
import { ASK_PERIODS, askHref, periodLabel, type AskPeriod, type AskScope } from "@/lib/ask/scope";
import type { Range } from "@/lib/search/highlight";
import { searchHref, NO_FILTERS } from "@/lib/search/filters";
import { showToast } from "@/lib/toast-client";

type Source = { n: number; topicId: number; title: string; forum: { name: string; slug: string }; sources: string[]; at: string; read: boolean };
type Also = { id: number; title: string; ranges: Range[]; forum: string; source: string | null; at: string; read: boolean };
type State =
  | { step: "idle" }
  | { step: "searching" }
  | {
      step: "writing" | "done" | "stopped" | "empty" | "error";
      sources: Source[];
      also: Also[];
      alsoTotal: number;
      keywords: string;
      text: string;
      answer: CheckedAnswer | null;
      message?: string;
      reason?: string;
      /** Written by the backup model, the main one being overloaded. */
      fallback?: boolean;
    };

type Snapshot = Extract<State, { sources: Source[] }>;

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * « Demande à ta veille » (docs/design/3.3 § 4): sources first (« N articles trouvés dans ta veille »), then the
 * text as it is written (« Arrêter »), then the answer checked by the server. A question, an answer: no thread.
 */
export function AskView({ q, scope, go, forums }: { q: string; scope: AskScope; go: boolean; forums: { slug: string; name: string }[] }) {
  const router = useRouter();
  const [state, setState] = useState<State>({ step: "idle" });
  const [historyId, setHistoryId] = useState<number | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<"utile" | "pas-utile" | null>(null);
  const [announce, setAnnounce] = useState("");
  const abort = useRef<AbortController | null>(null);
  const cardId = useId();

  const start = useCallback(async (opts: { primary?: boolean } = {}) => {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setActive(null);
    setFeedback(null);
    setAnnounce("");
    setState({ step: "searching" });
    const u = new URLSearchParams({ q, periode: scope.period });
    for (const f of scope.forums) u.append("forum", f);
    if (opts.primary) u.set("principal", "1");
    // The latest snapshot, read by the stream loop (React state is not updated synchronously).
    const cur: { v: Snapshot | null } = { v: null };
    const set = (patch: Partial<Snapshot>) => {
      cur.v = { ...(cur.v ?? { step: "writing", sources: [], also: [], alsoTotal: 0, keywords: "", text: "", answer: null }), ...patch } as Snapshot;
      setState(cur.v);
    };
    try {
      const res = await fetch(`/api/demander?${u}`, { signal: ctrl.signal, cache: "no-store" });
      if (!res.ok || !res.body) throw new Error(String(res.status));
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let cut: number;
        while ((cut = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 1);
          if (!line.trim()) continue;
          const ev = JSON.parse(line) as Record<string, unknown>;
          if (ev.type === "meta") setHistoryId(ev.historyId as number);
          else if (ev.type === "sources") set({ step: "writing", sources: ev.sources as Source[], also: ev.also as Also[], alsoTotal: ev.alsoTotal as number, keywords: ev.keywords as string });
          else if (ev.type === "fallback") set({ fallback: true });
          else if (ev.type === "delta") set({ text: `${cur.v?.text ?? ""}${ev.text as string}` });
          else if (ev.type === "answer") {
            set({ step: "done", answer: ev.answer as CheckedAnswer, fallback: ev.fallback === true });
            setAnnounce("Réponse prête");
          } else if (ev.type === "empty") set({ step: "empty", reason: ev.reason as string, text: "" });
          else if (ev.type === "error") set({ step: "error", message: ev.message as string });
        }
      }
      if (cur.v?.step === "writing") set({ step: "error", message: "La réponse a été coupée : réessaie." });
    } catch (err) {
      if ((err as Error)?.name === "AbortError") {
        if (cur.v) set({ step: "stopped" });
        else setState({ step: "idle" });
        setAnnounce("Réponse interrompue");
        return;
      }
      if (cur.v) set({ step: "error", message: "La question n'a pas abouti : réessaie." });
      else setState({ step: "idle" });
      showToast({ kind: "error", title: "Demander à ta veille :", msg: "la question n'a pas abouti, réessaie." });
    }
  }, [q, scope]);

  // An explicit gesture brought us here (go=1): ask once, and drop go from the URL (a reload asks first).
  useEffect(() => {
    if (!go || q.length < 3) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("go");
    window.history.replaceState(window.history.state, "", url);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- starts the streamed request (external system)
    void start();
    return () => abort.current?.abort();
  }, [go, q, start]);

  const changeScope = (next: AskScope) => router.push(askHref(q, next, true));

  const cite = (n: number) => {
    setActive(n);
    document.getElementById(`${cardId}-source-${n}`)?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "nearest" });
  };

  const s = state.step === "idle" || state.step === "searching" ? null : state;
  const blocks: AnswerBlock[] = s?.answer ? s.answer.blocks : s ? liveBlocks(s.text, s.sources.length) : [];
  const writing = state.step === "writing" || state.step === "searching";

  return (
    <div className="flex flex-col gap-4">
      <SearchField variant="page" initial={q} filters={NO_FILTERS} />

      {q && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
          <span>Dans</span>
          <label className="relative">
            <span className="sr-only">Période</span>
            <select
              value={scope.period}
              onChange={(e) => changeScope({ ...scope, period: e.target.value as AskPeriod })}
              className="h-9 cursor-pointer appearance-none rounded-full border border-accent bg-accent-soft pr-7 pl-3 text-sm font-semibold text-accent max-md:h-11"
            >
              {!ASK_PERIODS.some((p) => p.key === scope.period) && <option value={scope.period}>{periodLabel(scope.period)}</option>}
              {ASK_PERIODS.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.key === "mois" ? periodLabel("mois") : p.label}
                </option>
              ))}
            </select>
            <span aria-hidden className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-accent">
              ▾
            </span>
          </label>
          <label className="relative">
            <span className="sr-only">Forum</span>
            <select
              value={scope.forums[0] ?? ""}
              onChange={(e) => changeScope({ ...scope, forums: e.target.value ? [e.target.value] : [] })}
              className="h-9 cursor-pointer appearance-none rounded-full border border-line-strong bg-surface pr-7 pl-3 text-sm font-semibold text-fg max-md:h-11"
            >
              <option value="">Tous les forums</option>
              {forums.map((f) => (
                <option key={f.slug} value={f.slug}>
                  {f.name}
                </option>
              ))}
            </select>
            <span aria-hidden className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2">
              ▾
            </span>
          </label>
        </div>
      )}

      <p aria-live="polite" className="sr-only">
        {announce}
      </p>

      {state.step === "idle" && q && (
        <div className="flex flex-col items-start gap-3 rounded-md border border-accent bg-surface p-4 shadow-sm">
          <p className="text-base">
            Une réponse rédigée par l&apos;IA, <strong>uniquement</strong> à partir des articles de ta veille, avec leurs sources.
          </p>
          <button type="button" onClick={() => void start()} className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-sm bg-accent px-4 text-base font-semibold text-accent-fg md:h-9">
            <IconSparkle size={16} /> Demander à ta veille
          </button>
        </div>
      )}

      {state.step === "searching" && (
        <p role="status" className="flex items-center gap-2 text-sm text-fg-muted">
          <span className="size-2 animate-pulse-soft rounded-full bg-accent" /> Recherche dans ta veille…
        </p>
      )}

      {s && s.sources.length > 0 && (
        <p className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
          <IconCheck size={14} className="text-ok" />
          {s.sources.length} article{s.sources.length > 1 ? "s" : ""} trouvé{s.sources.length > 1 ? "s" : ""} dans ta veille
          {state.step === "writing" && (
            <>
              <span aria-hidden>·</span> Rédaction…
              <button type="button" onClick={() => abort.current?.abort()} className="ml-1 inline-flex h-8 cursor-pointer items-center rounded-sm border border-line-strong px-2.5 font-semibold text-fg max-md:h-11">
                Arrêter
              </button>
            </>
          )}
        </p>
      )}

      {s && (blocks.length > 0 || state.step === "writing" || state.step === "stopped") && state.step !== "empty" && (
        <section aria-labelledby={`${cardId}-title`} aria-busy={writing} className="overflow-hidden rounded-md border border-line-strong bg-surface shadow-sm">
          <div className="flex min-h-10 items-center justify-between gap-2 border-b border-line bg-surface-alt px-3.5">
            <h2 id={`${cardId}-title`} className="font-cond text-[12.5px] font-bold tracking-caps uppercase">
              Réponse de ta veille
            </h2>
            <span className="inline-flex h-5 items-center gap-1 rounded-full border border-line-strong px-[7px] text-[11.5px] font-semibold text-fg-muted">
              <IconSparkle size={11} filled strokeWidth={1} /> Généré par IA
            </span>
          </div>
          <div className="flex max-w-[72ch] flex-col gap-2.5 px-3.5 py-3.5 text-[15px] leading-[23px] md:px-5 md:text-[15.5px] md:leading-[25px]">
            {s.fallback && (
              <p className="text-[13px] leading-5">
                {state.step === "done" ? (
                  <FallbackNote onPrimary={() => void start({ primary: true })} />
                ) : (
                  <span className="text-fg-muted">Modèle de secours utilisé, le principal était surchargé.</span>
                )}
              </p>
            )}
            <AnswerText blocks={blocks} sources={s.sources} active={active} onCite={cite} cardId={cardId} />
            {state.step === "writing" && !reducedMotion() && <span aria-hidden className="inline-block h-4 w-2 animate-pulse-soft bg-fg-muted" />}
            {state.step === "stopped" && <p className="text-sm text-fg-muted italic">Réponse interrompue.</p>}
          </div>
          {state.step === "done" && s.answer && (
            <div className="flex flex-wrap items-center gap-2 border-t border-line px-3.5 py-2.5">
              <p className="mr-auto text-sm text-fg-muted">
                Rédigé uniquement à partir de {s.sources.length} article{s.sources.length > 1 ? "s" : ""} de ta veille. Vérifie l&apos;essentiel dans les sources.
              </p>
              <button
                type="button"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(answerAsText(s.answer!, s.sources.map((x) => ({ n: x.n, title: x.title, url: new URL(`/t/${x.topicId}`, window.location.origin).href }))))
                    .then(
                      () => showToast({ kind: "ok", title: "Réponse copiée, avec ses sources", durationMs: 2000 }),
                      () => showToast({ kind: "error", title: "Impossible de copier la réponse" }),
                    )
                }
                className="inline-flex h-11 cursor-pointer items-center gap-1.5 rounded-sm border border-line-strong px-3 text-sm font-semibold md:h-9"
              >
                <IconClipboard size={14} /> Copier
              </button>
              {(["utile", "pas-utile"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={feedback === v}
                  onClick={() => {
                    const next = feedback === v ? null : v;
                    setFeedback(next);
                    if (historyId) void feedbackAction(historyId, next);
                  }}
                  className="inline-flex h-11 cursor-pointer items-center rounded-sm border border-line-strong px-3 text-sm font-semibold aria-pressed:border-accent aria-pressed:bg-accent-soft aria-pressed:text-accent md:h-9"
                >
                  {v === "utile" ? "Utile" : "Pas utile"}
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {s && state.step === "empty" && <NothingFound q={q} scope={scope} keywords={s.keywords} hadSources={s.sources.length > 0} />}

      {s && state.step === "error" && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md border border-err bg-err-soft p-3.5 text-base text-err">
          <IconAlertCircle size={18} />
          <span className="flex-1">{s.message}</span>
          <button type="button" onClick={() => void start()} className="cursor-pointer font-semibold text-err underline">
            Réessayer
          </button>
        </div>
      )}

      {s && s.sources.length > 0 && <SourcesList sources={s.sources} active={active} cardId={cardId} />}

      {s && s.also.length > 0 && (
        <section aria-labelledby={`${cardId}-also`} className="overflow-hidden rounded-md border border-line bg-surface shadow-sm">
          <h2 id={`${cardId}-also`} className="flex min-h-9 items-center bg-bar-2 px-3.5 font-cond text-sm font-semibold tracking-caps text-bar-fg uppercase">
            Aussi dans ta veille · {s.alsoTotal}
          </h2>
          <ul>
            {s.also.map((a) => (
              <li key={a.id} className="relative flex items-start gap-2.5 border-t border-line px-3.5 py-2.5 first:border-t-0 hover:bg-surface-hover">
                <FolderIcon state={a.read ? "read" : "unread"} size={18} className="mt-0.5" />
                <div className="min-w-0">
                  <Link href={`/t/${a.id}`} prefetch={false} className={`line-clamp-2 no-underline after:absolute after:inset-0 ${a.read ? "text-fg-read hover:text-fg-read" : "font-semibold text-fg hover:text-fg"}`}>
                    <Highlighted value={{ text: a.title, ranges: a.ranges }} />
                  </Link>
                  <p className="text-xs text-fg-muted">
                    <span className={FORUM_BADGE}>{a.forum}</span> {a.source ?? "Source supprimée"} · <RelativeTime date={new Date(a.at)} />
                  </p>
                </div>
              </li>
            ))}
          </ul>
          <Link href={searchHref(s.keywords, NO_FILTERS)} className="flex min-h-11 items-center justify-center border-t border-line text-sm font-semibold text-accent no-underline hover:bg-surface-hover">
            Voir les {s.alsoTotal} résultats de recherche
          </Link>
        </section>
      )}
    </div>
  );
}

function AnswerText({ blocks, sources, active, onCite, cardId }: { blocks: AnswerBlock[]; sources: Source[]; active: number | null; onCite: (n: number) => void; cardId: string }) {
  const render = (b: AnswerBlock) =>
    b.parts.map((p, i) => {
      if (typeof p === "string") return <span key={i}>{p}</span>;
      const src = sources.find((x) => x.n === p.cite);
      return (
        <button
          key={i}
          type="button"
          aria-label={`Source ${p.cite}${src ? ` : ${src.title}` : ""}`}
          aria-describedby={`${cardId}-source-${p.cite}`}
          onClick={() => onCite(p.cite)}
          className={`relative mx-px inline-flex h-5 min-w-5 cursor-pointer items-center justify-center rounded-sm px-1 align-[1px] font-mono text-[11.5px] leading-none font-semibold after:absolute after:-inset-x-2 after:-inset-y-3 ${
            active === p.cite ? "bg-accent text-accent-fg" : "bg-accent-soft text-accent hover:bg-accent hover:text-accent-fg"
          }`}
        >
          {p.cite}
        </button>
      );
    });
  const items: React.ReactNode[] = [];
  let list: AnswerBlock[] = [];
  const flush = () => {
    if (list.length)
      items.push(
        <ul key={`ul${items.length}`} className="flex list-disc flex-col gap-1 pl-5">
          {list.map((b, i) => (
            <li key={i}>{render(b)}</li>
          ))}
        </ul>,
      );
    list = [];
  };
  for (const [i, b] of blocks.entries()) {
    if (b.kind === "li") list.push(b);
    else {
      flush();
      items.push(<p key={`p${i}`}>{render(b)}</p>);
    }
  }
  flush();
  return <>{items}</>;
}

function SourcesList({ sources, active, cardId }: { sources: Source[]; active: number | null; cardId: string }) {
  return (
    <section aria-labelledby={`${cardId}-sources`} className="overflow-hidden rounded-md border border-line bg-surface shadow-sm">
      <h2 id={`${cardId}-sources`} className="flex min-h-9 items-center bg-bar-2 px-3.5 font-cond text-sm font-semibold tracking-caps text-bar-fg uppercase">
        Sources · {sources.length}
      </h2>
      <ol>
        {sources.map((s) => (
          <li
            key={s.n}
            id={`${cardId}-source-${s.n}`}
            className={`relative flex min-h-12 items-start gap-2.5 border-t border-line px-3.5 py-2.5 first:border-t-0 hover:bg-surface-hover ${active === s.n ? "bg-accent-soft" : ""}`}
          >
            <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft font-mono text-xs font-semibold text-accent">{s.n}</span>
            <div className="min-w-0">
              {/* To the Folders topic, not the external article. */}
              <Link href={`/t/${s.topicId}`} prefetch={false} className={`line-clamp-2 no-underline after:absolute after:inset-0 ${s.read ? "text-fg-read hover:text-fg-read" : "font-semibold text-fg hover:text-fg"}`}>
                {s.title}
              </Link>
              <p className="text-xs text-fg-muted">
                <span className={FORUM_BADGE}>{s.forum.name}</span> {s.sources.join(", ")} · <RelativeTime date={new Date(s.at)} />
              </p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function NothingFound({ q, scope, keywords, hadSources }: { q: string; scope: AskScope; keywords: string; hadSources: boolean }) {
  const since = scope.period === "tout" ? "" : ` (${periodLabel(scope.period).toLowerCase()})`;
  return (
    <div className="flex flex-col items-start gap-3 rounded-md border border-dashed border-line-strong bg-surface px-4 py-5">
      <p className="text-[15px] font-semibold">Rien trouvé dans ta veille</p>
      <p className="text-sm text-fg-muted">
        {hadSources
          ? `Les articles trouvés${since} ne permettent pas de répondre à « ${q} ».`
          : `Aucun article de ta veille ne parle de « ${q} »${since}.`}{" "}
        Sans source, pas de réponse : Folders n&apos;invente rien.
      </p>
      <div className="flex flex-wrap gap-2">
        {scope.period !== "tout" && (
          <Link href={askHref(q, { ...scope, period: "tout" }, true)} className="inline-flex h-11 items-center rounded-sm border border-line-strong px-3.5 text-base font-semibold text-fg no-underline md:h-9">
            Chercher sur toute la période
          </Link>
        )}
        {keywords && (
          <Link href={searchHref(keywords, NO_FILTERS)} className="inline-flex h-11 items-center rounded-sm border border-line-strong px-3.5 text-base font-semibold text-fg no-underline md:h-9">
            Rechercher « {keywords} »
          </Link>
        )}
        <Link href="/admin#sources" className="inline-flex h-11 items-center rounded-sm border border-line-strong px-3.5 text-base font-semibold text-fg no-underline md:h-9">
          Ajouter une source
        </Link>
      </div>
    </div>
  );
}

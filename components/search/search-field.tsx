"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { IconClock, IconFolder, IconSearch, IconShield, IconSparkle } from "@/components/ui/icons";
import { forgetQuestionsAction } from "@/lib/actions/ask";
import { recentQuestionsAction, startSuggestionsAction, suggestAction, type StartSuggestion } from "@/lib/actions/search";
import { formatShort } from "@/lib/format-date";
import { NO_FILTERS, searchHref, type SearchFilters } from "@/lib/search/filters";
import type { Range } from "@/lib/search/highlight";
import { defaultIntent, otherIntent, searchWords, type Intent } from "@/lib/search/intent";
import { Highlighted } from "./highlighted";

/**
 * The single field to search and to ask (docs/design/3.3 § 3, 5, 7): combobox (role="combobox" + listbox,
 * aria-activedescendant). Enter does the default action of the text, Ctrl+Enter the other one; nothing goes to
 * the model without one of these gestures (and the question page asks again before writing anything).
 * Suggestions while typing come from the local exact search (debounced 150 ms).
 */

const RECENT_KEY = "folders-recent-searches";
const RECENT_MAX = 8;

export function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}
function remember(q: string) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([q, ...readRecent().filter((x) => x !== q)].slice(0, RECENT_MAX)));
  } catch {
    /* private mode: nothing kept */
  }
}
function forget() {
  try {
    localStorage.removeItem(RECENT_KEY);
  } catch {
    /* nothing */
  }
}

type Option = { id: string; group?: "Topics" | "Forums" | "Suggestions" | "Recherches récentes" | "Tes dernières questions"; label: React.ReactNode; text: string; icon: React.ReactNode; run: () => void; primary?: boolean };

export function SearchField({
  variant,
  initial = "",
  filters = NO_FILTERS,
  onDone,
  autoFocus = false,
  inputRef: externalRef,
}: {
  variant: "header" | "overlay" | "page";
  initial?: string;
  filters?: SearchFilters;
  /** After a navigation (closes the mobile input screen). */
  onDone?: () => void;
  autoFocus?: boolean;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [found, setFound] = useState<{ q: string; topics: { id: number; title: string; ranges: Range[] }[]; forums: { name: string; slug: string }[] } | null>(null);
  const [start, setStart] = useState<StartSuggestion[] | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [questions, setQuestions] = useState<{ question: string; scope: string; at: string }[]>([]);
  const ownRef = useRef<HTMLInputElement>(null);
  const inputRef = externalRef ?? ownRef;
  const listId = useId();
  const q = value.trim();
  const intent = defaultIntent(q);

  // Suggestions while typing: local exact search, 150 ms after the last key.
  useEffect(() => {
    if (q.length < 2) return;
    let alive = true;
    const t = setTimeout(() => {
      void suggestAction(q).then((r) => alive && setFound({ q, ...r }));
    }, 150);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q]);

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      onDone?.();
      router.push(href);
    },
    [router, onDone],
  );

  const runIntent = useCallback(
    (i: Intent, text = q) => {
      if (!text) return;
      if (i === "search") {
        const words = defaultIntent(text) === "ask" ? searchWords(text) : text;
        remember(words);
        go(searchHref(words, filters));
      } else go(searchHref(text, filters, { go: "1" }, "/demander"));
    },
    [q, filters, go],
  );

  const options = useMemo<Option[]>(() => {
    const out: Option[] = [];
    if (q) {
      const label = (i: Intent) =>
        i === "search" ? (
          <>
            Rechercher <strong className="font-semibold">« {i === intent ? q : searchWords(q)} »</strong>
          </>
        ) : (
          <>
            Demander à ta veille : <strong className="font-semibold">« {q} »</strong>
          </>
        );
      const icon = (i: Intent) => (i === "ask" ? <IconSparkle size={16} /> : <IconSearch size={16} />);
      out.push({ id: "default", label: label(intent), text: q, icon: icon(intent), run: () => runIntent(intent), primary: true });
      out.push({ id: "other", label: label(otherIntent(intent)), text: q, icon: icon(otherIntent(intent)), run: () => runIntent(otherIntent(intent)) });
      if (found && found.q === q) {
        for (const t of found.topics) out.push({ id: `t${t.id}`, group: "Topics", label: <Highlighted value={{ text: t.title, ranges: t.ranges }} />, text: t.title, icon: <IconFolder size={16} />, run: () => go(`/t/${t.id}`) });
        for (const f of found.forums) out.push({ id: `f${f.slug}`, group: "Forums", label: f.name, text: f.name, icon: <IconFolder size={16} />, run: () => go(`/f/${f.slug}`) });
      }
    } else {
      for (const [i, s] of (start ?? []).entries())
        out.push({
          id: `s${i}`,
          group: "Suggestions",
          label: s.text,
          text: s.text,
          icon: s.ask ? <IconSparkle size={16} /> : <IconShield size={16} />,
          // A click on a suggestion is the explicit gesture (§ 5).
          run: () => (s.href ? go(s.href) : runIntent("ask", s.ask ?? s.text)),
        });
      for (const [i, h] of questions.entries()) {
        const u = new URLSearchParams(h.scope);
        u.set("q", h.question);
        u.set("go", "1");
        out.push({
          id: `h${i}`,
          group: "Tes dernières questions",
          label: (
            <>
              {h.question} <span className="text-sm text-fg-muted">· {formatShort(new Date(h.at))}</span>
            </>
          ),
          text: h.question,
          icon: <IconClock size={16} />,
          run: () => go(`/demander?${u}`),
        });
      }
      for (const [i, r] of recent.entries())
        out.push({ id: `r${i}`, group: "Recherches récentes", label: r, text: r, icon: <IconClock size={16} />, run: () => runIntent("search", r) });
    }
    return out;
  }, [q, intent, found, start, recent, questions, runIntent, go]);

  const activeIndex = Math.min(active, Math.max(0, options.length - 1));
  const expanded = open && options.length > 0;

  function onFocus() {
    setOpen(true);
    setRecent(readRecent());
    if (!start) void startSuggestionsAction().then(setStart, () => setStart([]));
    void recentQuestionsAction().then(setQuestions, () => setQuestions([]));
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    // The field handles its keys: nothing reaches the page shortcuts (« u », Escape: back).
    e.stopPropagation();
    if (e.nativeEvent.isComposing) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      if (options.length) setActive((activeIndex + (e.key === "ArrowDown" ? 1 : options.length - 1)) % options.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) runIntent(otherIntent(intent));
      else if (expanded && options[activeIndex]) options[activeIndex]!.run();
      else runIntent(intent);
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (expanded) setOpen(false);
      else if (value) setValue("");
      else if (variant !== "page") {
        inputRef.current?.blur();
        onDone?.();
      }
    }
  }

  const header = variant === "header";
  const field = (
    <div role="search" className={`relative ${header ? "w-44 transition-[width] focus-within:w-72 motion-reduce:transition-none lg:w-[300px] lg:focus-within:w-[420px]" : "w-full"}`}>
      <span aria-hidden className={`pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 ${header ? "text-bar-muted" : "text-fg-muted"}`}>
        {intent === "ask" && q ? <IconSparkle size={16} /> : <IconSearch size={16} />}
      </span>
      <input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-label="Rechercher ou demander à ta veille"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={expanded ? `${listId}-${options[activeIndex]?.id}` : undefined}
        aria-keyshortcuts={header ? "/ Control+K" : undefined}
        enterKeyHint={intent === "ask" && q ? "send" : "search"}
        autoComplete="off"
        spellCheck={false}
        autoFocus={autoFocus}
        placeholder={header ? "Rechercher ou demander…  /" : "Rechercher ou demander à ta veille"}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={onFocus}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={onKeyDown}
        className={
          header
            ? "h-8 w-full rounded-sm border border-white/15 bg-bar-2 pr-2 pl-8 text-sm text-bar-fg placeholder:text-bar-muted focus:border-bar-accent focus:bg-surface focus:text-fg focus:outline-none"
            : "h-11 w-full rounded-sm border border-line-strong bg-surface pr-3 pl-9 text-[16px] text-fg md:h-10 md:text-base"
        }
      />
      {expanded && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Suggestions"
          className={
            variant === "overlay"
              ? // Under the input screen's bar, over the whole screen.
                "fixed inset-x-0 top-[calc(env(safe-area-inset-top)+61px)] bottom-0 flex flex-col overflow-y-auto overscroll-contain bg-bg pb-[env(safe-area-inset-bottom)] text-fg"
              : `absolute z-50 mt-1 flex max-h-[70vh] flex-col overflow-y-auto rounded-md border border-line-strong bg-surface py-1 text-fg shadow-md ${header ? "right-0 w-[560px]" : "left-0 w-full"}`
          }
          // Keep the focus in the field when an option is clicked.
          onMouseDown={(e) => e.preventDefault()}
        >
          {options.map((o, i) => (
            <OptionRow key={o.id} id={`${listId}-${o.id}`} option={o} active={i === activeIndex} group={o.group !== options[i - 1]?.group ? o.group : undefined} overlay={variant === "overlay"} onHover={() => setActive(i)} />
          ))}
          {!q && questions.length > 0 && (
            <li role="presentation" className="px-3 py-1.5 text-right">
              <button
                type="button"
                className="cursor-pointer text-sm text-accent hover:underline"
                onClick={() => {
                  void forgetQuestionsAction("all");
                  setQuestions([]);
                }}
              >
                Effacer les questions
              </button>
            </li>
          )}
          {!q && recent.length > 0 && (
            <li role="presentation" className="px-3 py-1.5 text-right">
              <button
                type="button"
                className="cursor-pointer text-sm text-accent hover:underline"
                onClick={() => {
                  forget();
                  setRecent([]);
                }}
              >
                Effacer les recherches récentes
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
  return field;
}

function OptionRow({ id, option, active, group, overlay, onHover }: { id: string; option: Option; active: boolean; group?: string; overlay: boolean; onHover: () => void }) {
  const primaryActive = active && option.primary;
  return (
    <>
      {group && (
        <li role="presentation" className="px-3 pt-2.5 pb-1 font-cond text-xs font-semibold tracking-caps text-fg-muted uppercase">
          {group}
        </li>
      )}
      <li
        id={id}
        role="option"
        aria-selected={active}
        onPointerMove={onHover}
        onClick={option.run}
        className={`flex cursor-pointer items-center gap-2.5 px-3 text-base ${overlay ? "min-h-12" : "min-h-9"} ${
          active ? (overlay ? "bg-accent-soft" : primaryActive ? "bg-surface-hover shadow-[inset_3px_0_0_var(--accent)]" : "bg-surface-hover") : ""
        }`}
      >
        <span className="inline-flex shrink-0 text-fg-muted">{option.icon}</span>
        <span className="min-w-0 flex-1 truncate">{option.label}</span>
        {option.id === "other" && !overlay && <kbd className="font-mono text-[11.5px] text-fg-muted">Ctrl ↵</kbd>}
        {option.id === "default" && !overlay && <kbd className="font-mono text-[11.5px] text-fg-muted">↵</kbd>}
      </li>
    </>
  );
}

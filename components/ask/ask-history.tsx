"use client";

import Link from "next/link";
import { useState } from "react";
import { IconClock, IconClose } from "@/components/ui/icons";
import { forgetQuestionsAction } from "@/lib/actions/ask";
import { formatShort } from "@/lib/format-date";

export type HistoryItem = { id: number; question: string; scope: string; at: string };

/** « Tes dernières questions » (docs/design/3.3 § 4): ask again, erase one, or « Effacer » all. */
export function AskHistory({ items: initial }: { items: HistoryItem[] }) {
  const [items, setItems] = useState(initial);
  if (!items.length) return null;
  const forgetIds = (ids: number[] | "all") => {
    setItems((prev) => (ids === "all" ? [] : prev.filter((i) => !ids.includes(i.id))));
    void forgetQuestionsAction(ids);
  };
  return (
    <section aria-labelledby="ask-history-title" className="overflow-hidden rounded-md border border-line bg-surface shadow-sm">
      <div className="flex min-h-9 items-center justify-between bg-bar-2 px-3.5">
        <h2 id="ask-history-title" className="font-cond text-sm font-semibold tracking-caps text-bar-fg uppercase">
          Tes dernières questions
        </h2>
        <button type="button" onClick={() => forgetIds("all")} className="cursor-pointer text-sm text-bar-muted hover:text-bar-fg max-md:min-h-11">
          Effacer
        </button>
      </div>
      <ul>
        {items.map((h) => {
          const scope = new URLSearchParams(h.scope);
          scope.set("q", h.question);
          scope.set("go", "1");
          return (
            <li key={h.id} className="flex items-center gap-1 border-t border-line first:border-t-0">
              <Link href={`/demander?${scope}`} className="flex min-h-11 min-w-0 flex-1 items-center gap-2 px-3.5 py-1.5 text-fg no-underline hover:bg-surface-hover hover:text-fg">
                <IconClock size={14} className="shrink-0 text-fg-muted" />
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 text-base">{h.question}</span>
                  <span className="text-xs text-fg-muted">{formatShort(new Date(h.at))}</span>
                </span>
              </Link>
              <button
                type="button"
                aria-label={`Effacer la question « ${h.question} »`}
                onClick={() => forgetIds([h.id])}
                className="mr-1 inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-sm text-fg-muted hover:bg-surface-hover hover:text-fg max-md:size-11"
              >
                <IconClose size={14} />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

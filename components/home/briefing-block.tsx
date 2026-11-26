"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { IconClose, IconSun } from "@/components/ui/icons";
import { hideHomeBriefingAction } from "@/lib/actions/briefing";
import type { HomeBriefing } from "@/lib/briefing/queries";

const more = (n: number, one: string, many: string) => (n > 0 ? ` et ${n} ${n > 1 ? many : one}` : "");

/**
 * « Ton briefing de ce matin » (docs/design/3.4 § 5), at the top of the home page: today's briefing, unread, before
 * noon. ✕ hides it until tomorrow. Mobile: stacked; desktop: one line (title and meta | preview | button).
 */
export function BriefingBlock({ briefing: b }: { briefing: HomeBriefing }) {
  const [hidden, setHidden] = useState(false);
  const [, start] = useTransition();
  if (hidden) return null;
  const lines = [
    b.critical && `${b.critical.count > 1 ? `${b.critical.count} failles critiques` : "Faille critique"} sur ta stack : ${b.critical.title}`,
    b.featured && `À la une : ${b.featured.first}${more(b.featured.more, "autre sujet", "autres sujets")}`,
    b.services && `Services : ${b.services.first}${more(b.services.more, "autre", "autres")}`,
  ].filter(Boolean) as string[];
  return (
    <section aria-labelledby="home-briefing" className="relative flex flex-col gap-2 rounded-md border border-line border-l-4 border-l-accent bg-surface p-3.5 pr-12 shadow-sm md:flex-row md:items-center md:gap-5">
      <div className="shrink-0">
        <h2 id="home-briefing" className="flex items-center gap-1.5 font-cond text-base font-bold">
          <IconSun size={16} className="text-accent" /> Ton briefing de ce matin
        </h2>
        <p className="font-mono text-xs text-fg-muted">
          {b.at} · {b.points} point{b.points > 1 ? "s" : ""} · {b.minutes} min
        </p>
      </div>
      <ul className="min-w-0 flex-1 text-sm">
        {lines.slice(0, 3).map((l) => (
          <li key={l} className="truncate">
            {l}
          </li>
        ))}
      </ul>
      <Link
        href={`/briefing/${b.day}`}
        prefetch={false}
        className="inline-flex h-11 shrink-0 items-center justify-center rounded-sm bg-accent px-4 text-base font-semibold text-accent-fg no-underline hover:text-accent-fg md:h-9"
      >
        Lire le briefing
      </Link>
      <button
        type="button"
        aria-label="Masquer jusqu'à demain"
        title="Masquer jusqu'à demain"
        onClick={() => {
          setHidden(true);
          start(async () => void (await hideHomeBriefingAction()));
        }}
        className="absolute top-1.5 right-1.5 inline-flex size-11 cursor-pointer items-center justify-center rounded-sm text-fg-muted hover:bg-surface-hover hover:text-fg md:size-8"
      >
        <IconClose size={16} />
      </button>
    </section>
  );
}

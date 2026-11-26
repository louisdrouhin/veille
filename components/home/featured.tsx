"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { SavedMark } from "@/components/lists/saved-mark";
import { useSavedCount } from "@/components/lists/saved-state";
import { useCurrentRead } from "@/components/topic/row-menu";
import { FORUM_BADGE } from "@/components/topic/topic-grid";
import { RelativeTime } from "@/components/ui/relative-time";
import { SourceAvatar } from "@/components/ui/source-avatar";
import type { FeaturedTopic } from "@/lib/home";

const MOBILE_VISIBLE = 3;
const DESKTOP_CARDS = 4;

const label = (t: FeaturedTopic) => `${t.title}, repris par ${t.sourceNames.length} sources : ${t.sourceNames.join(", ")}`;

/** Overlapping source avatars (À la une, Briefing du matin). */
export function SourceStack({ names, size = 18 }: { names: string[]; size?: number }) {
  return (
    <span className="flex" aria-hidden>
      {names.slice(0, 4).map((name) => (
        <SourceAvatar key={name} name={name} size={size} shape="round" className="-ml-1.5 border border-surface first:ml-0" />
      ))}
    </span>
  );
}

/**
 * « À la une » (docs/design/3.3 § 2): topics merged from 2 sources or more in the last 48 h. Desktop: 4 cards;
 * mobile: 3 rows and « + N autres sujets à la une ». Hidden when empty (nothing to show, no empty state).
 */
export function FeaturedSection({ items }: { items: FeaturedTopic[] }) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  if (items.length === 0) return null;
  const hidden = items.length - MOBILE_VISIBLE;
  return (
    <section aria-labelledby="featured-title" className="overflow-hidden rounded-md border border-line bg-surface shadow-sm md:border-0 md:bg-transparent md:shadow-none">
      <h2 id="featured-title" className="flex min-h-9 items-center bg-bar-2 px-3.5 font-cond text-sm font-semibold tracking-caps text-bar-fg uppercase md:mb-2 md:min-h-0 md:bg-transparent md:px-0 md:text-hot">
        À la une
      </h2>
      {/* Mobile: rows. */}
      <ul id={listId} className="md:hidden">
        {items.map((t, i) => (
          <FeaturedRow key={t.id} topic={t} hidden={!expanded && i >= MOBILE_VISIBLE} />
        ))}
      </ul>
      {hidden > 0 && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setExpanded((v) => !v)}
          className="flex min-h-11 w-full cursor-pointer items-center justify-center border-t border-line text-sm font-semibold text-accent hover:bg-surface-hover md:hidden"
        >
          {expanded ? "Afficher moins" : `+ ${hidden} autre${hidden > 1 ? "s" : ""} sujet${hidden > 1 ? "s" : ""} à la une`}
        </button>
      )}
      {/* Desktop: cards. */}
      <ul className="hidden gap-3 md:grid md:grid-cols-2 lg:grid-cols-4">
        {items.slice(0, DESKTOP_CARDS).map((t) => (
          <FeaturedCard key={t.id} topic={t} />
        ))}
      </ul>
    </section>
  );
}

function FeaturedRow({ topic, hidden }: { topic: FeaturedTopic; hidden: boolean }) {
  const t = useCurrentRead(topic);
  const saved = useSavedCount(t.id, t.savedCount);
  return (
    <li
      hidden={hidden}
      className="relative flex min-h-11 flex-col gap-1 border-t border-line px-3.5 py-2.5 first:border-t-0 hover:bg-surface-hover has-[a:focus-visible]:outline-2 has-[a:focus-visible]:-outline-offset-2 has-[a:focus-visible]:outline-focus"
    >
      <p className="flex items-start gap-1.5">
        <Link
          href={`/t/${t.id}`}
          prefetch={false}
          aria-label={label(t)}
          className={`line-clamp-2 text-md no-underline after:absolute after:inset-0 focus-visible:outline-none ${t.read ? "font-normal text-fg-read hover:text-fg-read" : "font-bold text-fg hover:text-fg"}`}
        >
          {t.title}
        </Link>
        <SavedMark count={saved} className="mt-1" />
      </p>
      <p className="flex flex-wrap items-center gap-x-1.5 text-[12.5px] leading-4 text-fg-muted">
        <SourceStack names={t.sourceNames} />
        <span className="font-semibold text-fg">{t.sourceNames.length} sources</span>
        <span aria-hidden>·</span>
        <span className={FORUM_BADGE}>{t.forum.name}</span>
        <RelativeTime date={t.lastActivityAt} />
      </p>
    </li>
  );
}

function FeaturedCard({ topic }: { topic: FeaturedTopic }) {
  const t = useCurrentRead(topic);
  const saved = useSavedCount(t.id, t.savedCount);
  const many = t.sourceNames.length >= 5;
  return (
    <li
      className={`relative flex flex-col gap-2 rounded-md border border-line border-t-[3px] bg-surface p-3 shadow-sm hover:bg-surface-hover has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-focus ${many ? "border-t-hot" : "border-t-accent"}`}
    >
      <p className="flex items-center gap-1.5 text-xs text-fg-muted">
        <span className={FORUM_BADGE}>{t.forum.name}</span>
        <RelativeTime date={t.lastActivityAt} />
        <SavedMark count={saved} className="ml-auto" />
      </p>
      <Link
        href={`/t/${t.id}`}
        prefetch={false}
        aria-label={label(t)}
        className={`line-clamp-3 text-base no-underline after:absolute after:inset-0 focus-visible:outline-none ${t.read ? "font-normal text-fg-read hover:text-fg-read" : "font-bold text-fg hover:text-fg"}`}
      >
        {t.title}
      </Link>
      <p className="mt-auto flex items-center gap-2 text-sm">
        <SourceStack names={t.sourceNames} />
        <span className={`font-semibold ${many ? "text-hot" : "text-accent"}`}>{t.sourceNames.length} sources</span>
      </p>
    </li>
  );
}

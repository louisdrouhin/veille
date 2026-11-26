"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useReadTopics } from "@/components/topic/read-topics";
import { setTopicReadAction } from "@/lib/actions/topics";
import { ORIGIN_KEY, parseOrigin, positionIn, type Origin } from "@/lib/shortcuts";
import { showToast } from "@/lib/toast-client";
import { ignoreKey } from "./shortcuts";

const noop = () => () => {};
const readOrigin = (): string | null => {
  try {
    return window.sessionStorage.getItem(ORIGIN_KEY);
  } catch {
    return null;
  }
};

function save(origin: Origin) {
  try {
    window.sessionStorage.setItem(ORIGIN_KEY, JSON.stringify(origin));
  } catch {
    /* ignored */
  }
}

const KBD = "inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-line-strong bg-surface-alt px-1 font-mono text-[11px]";

/**
 * Page of a topic (docs/design/3.5 § 6): the position bar when it was opened from a list (« Depuis Accueil · Derniers
 * non lus 3 / 21 », Précédent k / Suivant j), j / k in that list (the topic opened passes to read, as any opening),
 * and m, s, o, Maj+C on this topic. Espace keeps its native scrolling. Links never prefetched.
 */
export function TopicShortcuts({ topicId, url, forumSlug }: { topicId: number; url: string; forumSlug: string }) {
  const router = useRouter();
  const raw = useSyncExternalStore(noop, readOrigin, () => null);
  const origin = parseOrigin(raw);
  const pos = origin ? positionIn(origin, topicId) : null;
  const [end, setEnd] = useState<string | null>(null);
  const { readOf, setRead } = useReadTopics();

  // The last topic seen, for the selection when going back to the list.
  useEffect(() => {
    if (origin && pos && origin.lastId !== topicId) save({ ...origin, lastId: topicId });
  }, [origin, pos, topicId]);

  useEffect(() => {
    const go = (id: number | null, which: "next" | "prev") => {
      if (!id) {
        setEnd(which === "next" ? "Fin de la liste" : "Début de la liste");
        setTimeout(() => setEnd(null), 1_500);
        return;
      }
      router.push(`/t/${id}`);
    };
    const onKey = (e: KeyboardEvent) => {
      if (!e.isTrusted || ignoreKey(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      if ((e.key === "j" || e.key === "k") && pos) {
        e.preventDefault();
        go(e.key === "j" ? pos.next : pos.prev, e.key === "j" ? "next" : "prev");
      } else if (e.key === "o") {
        e.preventDefault();
        window.open(url, "_blank", "noopener,noreferrer");
      } else if (e.key === "s") {
        const b = document.querySelector<HTMLButtonElement>("[data-save-button]");
        if (b) {
          e.preventDefault();
          b.click();
        }
      } else if (e.key === "C" && e.shiftKey) {
        e.preventDefault();
        void navigator.clipboard.writeText(new URL(`/t/${topicId}`, window.location.origin).href).then(
          () => showToast({ kind: "ok", title: "Lien Folders copié", durationMs: 2000 }),
          () => showToast({ kind: "error", title: "Copie impossible" }),
        );
      } else if (e.key === "m") {
        e.preventDefault();
        // Opened = read: « m » makes it unread (and back). No toast (docs/design/3.5 § 6).
        const read = readOf(topicId) ?? true;
        const change = setRead(topicId, !read, read, forumSlug);
        void setTopicReadAction(topicId, !read).then(
          (r) => (r.ok ? change.confirm(r.at) : change.rollback()),
          () => change.rollback(),
        );
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [pos, router, url, topicId, forumSlug, readOf, setRead]);

  if (!origin || !pos) return null;
  return (
    <nav aria-label="Position dans la liste" className="-mt-1 mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-muted">
      <span>
        Depuis{" "}
        <Link href={origin.path} prefetch={false} className="font-semibold">
          {origin.label}
        </Link>{" "}
        <span className="font-mono">
          {pos.index} / {pos.total}
        </span>
      </span>
      <span className="ml-auto flex items-center gap-1.5">
        {end && (
          <span role="status" className="mr-2 text-fg">
            {end}
          </span>
        )}
        {pos.prev ? (
          <Link href={`/t/${pos.prev}`} prefetch={false} className="inline-flex min-h-9 items-center gap-1.5 rounded-sm px-2 no-underline hover:bg-surface-hover">
            <kbd className={KBD}>k</kbd> Précédent
          </Link>
        ) : null}
        {pos.next ? (
          <Link href={`/t/${pos.next}`} prefetch={false} className="inline-flex min-h-9 items-center gap-1.5 rounded-sm px-2 no-underline hover:bg-surface-hover">
            Suivant <kbd className={KBD}>j</kbd>
          </Link>
        ) : null}
      </span>
    </nav>
  );
}

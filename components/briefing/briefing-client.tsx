"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { useReadTopics, useUnreadCount } from "@/components/topic/read-topics";
import { Button } from "@/components/ui/button";
import { IconAlertCircle, IconCheck, IconSpinner } from "@/components/ui/icons";
import { retrySentencesAction, setTopicsReadAction } from "@/lib/actions/briefing";
import { showToast } from "@/lib/toast-client";

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Sommaire (§ 3): anchors; no animated scroll with prefers-reduced-motion. */
export function BriefingToc({ items }: { items: { id: string; label: string; count: number; alert?: boolean }[] }) {
  if (!items.length) return null;
  return (
    <nav aria-label="Sommaire du briefing" className="-mx-2.5 overflow-x-auto px-2.5 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
      <ul className="flex w-max gap-2">
        {items.map((it) => (
          <li key={it.id}>
            <a
              href={`#${it.id}`}
              onClick={(e) => {
                const target = document.getElementById(it.id);
                if (!target) return;
                e.preventDefault();
                target.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
                history.replaceState(history.state, "", `#${it.id}`);
              }}
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line-strong bg-surface px-3 text-sm font-semibold whitespace-nowrap text-fg no-underline hover:bg-surface-hover hover:text-fg max-md:h-11"
            >
              {it.label}
              <span className={`font-mono text-xs ${it.alert ? "rounded-full bg-sev-critical px-1.5 text-sev-critical-fg" : "text-fg-muted"}`}>{it.count}</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * « En préparation » (§ 6): the page is rendered again every 3 s until the briefing is ready; « Briefing prêt » is
 * announced once (aria-live).
 */
export function PreparingWatcher({ preparing }: { preparing: boolean }) {
  const router = useRouter();
  const was = useRef(preparing);
  const [announce, setAnnounce] = useState("");
  useEffect(() => {
    if (was.current && !preparing) {
      setAnnounce("Briefing prêt");
    }
    was.current = preparing;
    if (!preparing) return;
    const t = setInterval(() => router.refresh(), 3_000);
    return () => clearInterval(t);
  }, [preparing, router]);
  return (
    <p aria-live="polite" className="sr-only">
      {announce}
    </p>
  );
}

/** Encart « Résumés indisponibles » with « Générer les résumés » (§ 6). */
export function RetrySentences({ day }: { day: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md border border-err bg-err-soft p-3.5 text-base">
      <IconAlertCircle size={18} className="shrink-0 text-err" />
      <p className="min-w-0 flex-1">
        <strong className="text-err">Résumés indisponibles.</strong> Le service IA n&apos;a pas répondu. Voici le briefing sans les phrases générées.
      </p>
      <Button
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await retrySentencesAction(day).catch(() => ({ ok: false as const, error: "Connexion au serveur impossible." }));
            if (res.ok) {
              showToast({ kind: "ok", title: "Résumés générés", durationMs: 2500 });
              router.refresh();
            } else showToast({ kind: "error", title: "Générer les résumés :", msg: res.error });
          })
        }
        className="max-md:min-h-11"
      >
        {pending && <IconSpinner size={14} />} Générer les résumés
      </Button>
    </div>
  );
}

/**
 * Pied « C'est tout pour ce matin. » (§ 3): points and articles, unread left, « Voir les N non lus », « Marquer ces
 * N topics lus » with « Annuler », next briefing.
 */
export function BriefingFooter({
  topics,
  points,
  articles,
  unread,
  renderedAt,
  next,
}: {
  topics: { id: number; read: boolean; forumSlug: string }[];
  points: number;
  articles: number;
  unread: number;
  renderedAt: number;
  next: string | null;
}) {
  const { readOf, setRead } = useReadTopics();
  const left = useUnreadCount(unread, renderedAt);
  const [busy, start] = useTransition();
  const current = topics.map((t) => ({ ...t, read: readOf(t.id) ?? t.read }));
  const toMark = current.filter((t) => !t.read);

  const apply = (list: typeof current, read: boolean) => {
    const changes = list.map((t) => setRead(t.id, read, !read, t.forumSlug));
    return {
      confirm: (at: number, changed: number[]) => changes.forEach((c, i) => (changed.includes(list[i]!.id) ? c.confirm(at) : c.rollback())),
      rollback: () => changes.forEach((c) => c.rollback()),
    };
  };

  const markAll = () =>
    start(async () => {
      const list = toMark;
      const change = apply(list, true);
      const res = await setTopicsReadAction(
        list.map((t) => t.id),
        true,
      ).catch(() => ({ ok: false as const, error: "Enregistrement impossible, réessaie." }));
      if (!res.ok) {
        change.rollback();
        return showToast({ kind: "error", title: "Marquer lus :", msg: res.error });
      }
      change.confirm(res.at, res.changed);
      const done = list.filter((t) => res.changed.includes(t.id));
      showToast({
        kind: "ok",
        title: `${done.length} topic${done.length > 1 ? "s" : ""} marqué${done.length > 1 ? "s" : ""} lu${done.length > 1 ? "s" : ""}`,
        action: {
          label: "Annuler",
          onClick: () => {
            const back = apply(done, false);
            void setTopicsReadAction(
              done.map((t) => t.id),
              false,
            ).then(
              (r) => (r.ok ? back.confirm(r.at, r.changed) : back.rollback()),
              () => back.rollback(),
            );
          },
        },
      });
    });

  return (
    <section aria-labelledby="briefing-end" className="flex flex-col items-start gap-3 rounded-md border border-line bg-surface p-4 shadow-sm">
      <h2 id="briefing-end" className="flex items-center gap-2 font-cond text-lg font-bold">
        <IconCheck size={18} className="text-ok" /> C&apos;est tout pour ce matin.
      </h2>
      <p className="text-base text-fg-muted">
        {points} point{points > 1 ? "s" : ""} tiré{points > 1 ? "s" : ""} de {articles} article{articles > 1 ? "s" : ""}.
        {left > 0 ? ` Il te reste ${left} non lu${left > 1 ? "s" : ""}.` : " Tout est lu."}
      </p>
      <div className="flex w-full flex-wrap gap-2">
        {left > 0 && (
          <Link
            href="/#latest-unread-title"
            className="inline-flex h-11 items-center rounded-sm bg-accent px-4 text-base font-semibold text-accent-fg no-underline hover:text-accent-fg max-md:w-full max-md:justify-center md:h-9"
          >
            Voir les {left} non lu{left > 1 ? "s" : ""}
          </Link>
        )}
        {toMark.length > 0 && (
          <Button onClick={markAll} disabled={busy} className="max-md:min-h-11 max-md:w-full">
            Marquer ces {toMark.length} topic{toMark.length > 1 ? "s" : ""} lu{toMark.length > 1 ? "s" : ""}
          </Button>
        )}
      </div>
      <p className="text-sm text-fg-muted">
        {next ? `Prochain briefing ${next}` : "Briefing désactivé"} ·{" "}
        <Link href="/parametres/briefing" className="font-semibold">
          Réglages
        </Link>
      </p>
    </section>
  );
}

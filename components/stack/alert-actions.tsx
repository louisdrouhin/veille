"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { IconCheck, IconSpinner } from "@/components/ui/icons";
import { Sheet } from "@/components/ui/sheet";
import { ignoreAlertAction, markAlertDoneAction, reopenAlertAction } from "@/lib/actions/stack";
import type { AlertState, IgnoreReason } from "@/lib/db/schema";
import { formatTime } from "@/lib/format-date";
import { IGNORE_LABEL } from "@/lib/stack/labels";
import { showToast } from "@/lib/toast-client";

const REASONS: IgnoreReason[] = ["not_exposed", "not_concerned", "backport", "other"];
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** « Traitée aujourd'hui à 11:42 », « Traitée le 24/11 à 09:10 ». */
function doneLabel(doneAt: Date): string {
  const today = new Date().toDateString() === doneAt.toDateString();
  const day = doneAt.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit" });
  return `${today ? "aujourd'hui" : `le ${day}`} à ${formatTime(doneAt)}`;
}

/**
 * Actions of an alert, in the page flow (docs/design/3.0 § 4.5): « Marquer comme traitée » (48 px)
 * and « Ignorer… » (reasons sheet); once handled, its state with « Rouvrir ». The toast « Alerte
 * traitée · Annuler » goes above « Remonter en haut »; the navigation badge follows (router.refresh).
 */
export function AlertActions({
  id,
  state,
  doneAt,
  ignored,
}: {
  id: number;
  state: AlertState;
  doneAt: string | null;
  ignored: { reason: IgnoreReason; note: string | null } | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [ignoring, setIgnoring] = useState(false);
  const [reason, setReason] = useState<IgnoreReason>("not_exposed");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const name = useId();
  const noteId = useId();

  const reopen = () =>
    start(async () => {
      const res = await reopenAlertAction(id);
      if (!res.ok) showToast({ kind: "error", title: res.error });
      router.refresh();
    });

  const done = () =>
    start(async () => {
      const res = await markAlertDoneAction(id);
      if (!res.ok) {
        showToast({ kind: "error", title: res.error });
        return;
      }
      showToast({ kind: "ok", title: "Alerte traitée", action: { label: "Annuler", onClick: reopen } });
      router.refresh();
    });

  const ignore = () =>
    start(async () => {
      setError(null);
      const res = await ignoreAlertAction({ id, reason, note });
      if (!res.ok) return setError(res.error);
      setIgnoring(false);
      showToast({ kind: "ok", title: "Alerte ignorée", msg: capital(IGNORE_LABEL[reason]) + ".", action: { label: "Annuler", onClick: reopen } });
      router.refresh();
    });

  if (state === "done" || state === "ignored") {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-line bg-surface-alt px-3 py-2.5 text-base">
        {state === "done" ? <IconCheck size={16} className="text-ok" /> : null}
        <span className="min-w-0 flex-1">
          {state === "done" ? `Traitée ${doneAt ? doneLabel(new Date(doneAt)) : ""}` : `Ignorée : ${ignored ? IGNORE_LABEL[ignored.reason] : ""}`}
          {state === "ignored" && ignored?.note ? <span className="text-fg-muted"> — {ignored.note}</span> : null}
        </span>
        <Button size="sm" onClick={reopen} disabled={pending}>
          Rouvrir
        </Button>
      </div>
    );
  }

  return (
    <div className="grid gap-2 md:flex md:items-center">
      <Button variant="primary" onClick={done} disabled={pending} className="h-12! w-full text-base md:w-auto md:px-5">
        {pending ? <IconSpinner size={16} className="animate-spin motion-reduce:animate-none" /> : <IconCheck size={16} />}
        Marquer comme traitée
      </Button>
      <Button variant="secondary" onClick={() => setIgnoring(true)} disabled={pending} className="h-12! w-full text-base md:w-auto">
        Ignorer…
      </Button>
      <Sheet open={ignoring} onClose={() => setIgnoring(false)} title="Ignorer cette alerte">
        <form
          className="grid gap-3 pb-2"
          onSubmit={(e) => {
            e.preventDefault();
            ignore();
          }}
        >
          <fieldset>
            <legend className="mb-2 text-sm font-semibold">Pourquoi ?</legend>
            <div role="radiogroup" className="grid gap-1">
              {REASONS.map((r) => (
                <label key={r} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-sm px-1 hover:bg-surface-hover">
                  <input type="radio" name={name} value={r} checked={reason === r} onChange={() => setReason(r)} className="size-4 accent-[var(--accent)]" />
                  <span className="text-base">{capital(IGNORE_LABEL[r])}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-1.5">
            <label htmlFor={noteId} className="text-sm font-semibold">
              Précision <span className="font-normal text-fg-muted">{reason === "other" ? "(obligatoire)" : "(facultatif)"}</span>
            </label>
            <textarea id={noteId} value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} rows={2} className="rounded-sm border border-line-strong bg-surface px-3 py-2 text-base" />
          </div>
          {error && (
            <p role="alert" className="text-sm text-err">
              {error}
            </p>
          )}
          <Button type="submit" variant="primary" disabled={pending || (reason === "other" && !note.trim())} className="h-12! w-full text-base">
            Ignorer l&apos;alerte
          </Button>
        </form>
      </Sheet>
    </div>
  );
}

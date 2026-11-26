"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";
import { buttonClass } from "@/components/ui/button";
import { ConfirmDialog, type ConfirmDialogHandle } from "@/components/ui/confirm-dialog";
import { Panel } from "@/components/ui/panel";
import { RelativeTime } from "@/components/ui/relative-time";
import { revokeOtherSessionsAction, revokeSessionAction } from "@/lib/actions/security";
import { authClient } from "@/lib/auth-client";
import type { SessionRow } from "@/lib/security";
import { showToast } from "@/lib/toast-client";
import { SaveError, SavedHint, useSave } from "./saved";

const FIELD = "h-11 w-full max-w-[320px] rounded-sm border border-line-strong bg-surface px-3 text-base md:h-9";
const MIN = 12;

/** Mot de passe (docs/design/3.5 § 7): « Changer » opens the form; Better Auth checks the current one. */
export function PasswordPanel() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { state, save } = useSave();
  const [pending, start] = useTransition();
  const ids = { current: useId(), next: useId(), again: useId(), err: useId() };
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const current = String(data.get("current") ?? "");
    const next = String(data.get("next") ?? "");
    if (next.length < MIN) return setError(`Le nouveau mot de passe doit faire au moins ${MIN} caractères.`);
    if (next !== String(data.get("again") ?? "")) return setError("Les deux saisies du nouveau mot de passe ne sont pas identiques.");
    setError(null);
    start(async () => {
      const ok = await save(async () => {
        const { error: err } = await authClient.changePassword({ currentPassword: current, newPassword: next, revokeOtherSessions: false });
        if (!err) return { ok: true };
        return { ok: false, error: err.code === "INVALID_PASSWORD" || err.status === 400 ? "Mot de passe actuel incorrect." : "Changement impossible, réessaie." };
      });
      if (ok) {
        form.reset();
        setOpen(false);
      }
    });
  };
  return (
    <Panel title="Mot de passe">
      <div className="grid gap-3 p-3.5">
        <div className="flex flex-wrap items-center gap-3">
          <p className="min-w-0 flex-1 text-base text-fg-muted">Au moins {MIN} caractères. Un gestionnaire de mots de passe en génère un solide.</p>
          <SavedHint state={state} />
          {!open && (
            <button type="button" className={`${buttonClass("secondary", "md")} max-md:min-h-11`} onClick={() => setOpen(true)}>
              Changer
            </button>
          )}
        </div>
        {open && (
          <form onSubmit={submit} className="grid gap-3">
            {(
              [
                ["current", "Mot de passe actuel", "current-password", ids.current],
                ["next", "Nouveau mot de passe", "new-password", ids.next],
                ["again", "Nouveau mot de passe, encore", "new-password", ids.again],
              ] as const
            ).map(([name, label, ac, id]) => (
              <div key={name} className="grid gap-1.5">
                <label htmlFor={id} className="text-sm font-semibold">
                  {label}
                </label>
                <input id={id} name={name} type="password" autoComplete={ac} required minLength={name === "current" ? 1 : MIN} className={FIELD} aria-describedby={error ? ids.err : undefined} />
              </div>
            ))}
            {error && (
              <p id={ids.err} role="alert" className="text-sm text-err">
                {error}
              </p>
            )}
            <SaveError state={state} />
            <div className="flex flex-wrap gap-2">
              <button type="submit" disabled={pending} className={`${buttonClass("primary", "md")} max-md:min-h-11`}>
                {pending ? "Enregistrement…" : "Changer le mot de passe"}
              </button>
              <button type="button" className={`${buttonClass("secondary", "md")} max-md:min-h-11`} onClick={() => setOpen(false)}>
                Annuler
              </button>
            </div>
          </form>
        )}
      </div>
    </Panel>
  );
}

/** Sessions (docs/design/3.5 § 7): device, last activity, « Cette session » in --ok, Déconnecter; all the others (confirmed). */
export function SessionsPanel({ sessions: initial }: { sessions: SessionRow[] }) {
  const router = useRouter();
  const [sessions, setSessions] = useState(initial);
  const [pending, start] = useTransition();
  const dialog = useRef<ConfirmDialogHandle>(null);
  const others = sessions.filter((s) => !s.current).length;
  const revoke = (id: string) =>
    start(async () => {
      const r = await revokeSessionAction(id).catch(() => ({ ok: false as const, error: "Connexion au serveur impossible." }));
      if (!r.ok) return showToast({ kind: "error", title: "Session :", msg: r.error });
      setSessions((list) => list.filter((s) => s.id !== id));
      showToast({ kind: "ok", title: "Session déconnectée", durationMs: 2500 });
    });
  return (
    <Panel title="Sessions">
      <ul>
        {sessions.map((s) => (
          <li key={s.id} className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-3.5 py-2 first:border-t-0">
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{s.device}</p>
              <p className="text-sm text-fg-muted">
                {s.current ? <span className="font-semibold text-ok">Cette session</span> : <>Dernière activité <RelativeTime date={new Date(s.lastActive)} /></>}
              </p>
            </div>
            {!s.current && (
              <button type="button" disabled={pending} onClick={() => revoke(s.id)} className={`${buttonClass("secondary")} max-md:min-h-11`}>
                Déconnecter
              </button>
            )}
          </li>
        ))}
      </ul>
      {others > 0 && (
        <div className="border-t border-line p-3.5">
          <button type="button" onClick={() => dialog.current?.open()} className={`${buttonClass("danger", "md")} max-md:min-h-11`}>
            Déconnecter toutes les autres sessions
          </button>
          <ConfirmDialog handle={dialog} title="Déconnecter les autres sessions ?" description={`${others} session${others > 1 ? "s" : ""} devront se reconnecter. Celle-ci reste ouverte.`}>
            <button
              type="button"
              disabled={pending}
              className={`${buttonClass("danger-solid")} max-md:min-h-11`}
              onClick={() =>
                start(async () => {
                  const r = await revokeOtherSessionsAction().catch(() => ({ ok: false as const, error: "Connexion au serveur impossible." }));
                  dialog.current?.close();
                  if (!r.ok) return showToast({ kind: "error", title: "Sessions :", msg: r.error });
                  setSessions((list) => list.filter((s) => s.current));
                  showToast({ kind: "ok", title: `${r.count ?? 0} session${(r.count ?? 0) > 1 ? "s" : ""} déconnectée${(r.count ?? 0) > 1 ? "s" : ""}` });
                  router.refresh();
                })
              }
            >
              Déconnecter
            </button>
          </ConfirmDialog>
        </div>
      )}
    </Panel>
  );
}

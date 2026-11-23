"use client";

import { useActionState } from "react";
import { buttonClass } from "@/components/ui/button";
import { IconAlertCircle, Logo } from "@/components/ui/icons";
import { setupAction, type SetupState } from "@/lib/actions/setup";

const FIELD =
  "h-10 w-full rounded-sm border border-line-strong bg-surface px-3 text-[16px] font-normal text-fg md:text-[15px] aria-invalid:border-err";
const MIN = 12;

export function SetupForm() {
  const [state, action, pending] = useActionState<SetupState, FormData>(setupAction, {});
  const passwordError = state.error?.includes("mot de passe");

  return (
    <div className="mx-auto flex max-w-[400px] flex-col gap-5">
      <div className="flex items-center justify-center gap-3">
        <span className="inline-flex size-11 items-center justify-center rounded-lg bg-bar">
          <Logo size={30} />
        </span>
        <span className="font-cond text-[32px] leading-none font-bold">Folders</span>
      </div>

      <div className="overflow-hidden rounded-lg border border-line bg-surface shadow-md">
        <div className="flex h-10 items-center bg-bar-2 px-4">
          <h1 className="font-cond text-sm font-semibold tracking-caps text-bar-fg uppercase">Premier lancement</h1>
        </div>
        <form action={action} className="flex flex-col gap-3.5 p-4">
          <p className="text-base text-fg-muted">
            Crée le compte unique de cette instance. Cet écran disparaît dès que le compte existe.
          </p>
          {state.error && (
            <div role="alert" className="flex items-start gap-2 rounded-sm border border-err bg-err-soft p-2.5 text-base text-err">
              <IconAlertCircle size={18} className="mt-px shrink-0" />
              <p>{state.error}</p>
            </div>
          )}
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            Email
            <input className={FIELD} name="email" type="email" autoComplete="username" required autoFocus defaultValue={state.email} />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            Mot de passe
            <input
              className={FIELD}
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={MIN}
              maxLength={128}
              aria-describedby="password-hint"
              aria-invalid={passwordError || undefined}
            />
            <span id="password-hint" className="text-xs font-normal text-fg-muted">
              {MIN} caractères minimum.
            </span>
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            Confirmation du mot de passe
            <input
              className={FIELD}
              name="confirm"
              type="password"
              autoComplete="new-password"
              required
              minLength={MIN}
              maxLength={128}
              aria-invalid={passwordError || undefined}
            />
          </label>
          <button type="submit" className={buttonClass("primary", "md", "h-10.5 w-full max-md:h-11")} disabled={pending}>
            {pending ? "Création…" : "Créer le compte"}
          </button>
        </form>
      </div>
    </div>
  );
}

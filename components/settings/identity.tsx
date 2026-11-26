"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { buttonClass } from "@/components/ui/button";
import { IconAlertCircle, IconCheck, IconLock } from "@/components/ui/icons";
import { reconfirmAction } from "@/lib/actions/integrations";

const FIELD = "h-11 w-full max-w-[320px] rounded-sm border border-line-strong bg-surface px-3 text-base md:h-9";
const hhmm = (ms: number) => new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" }).format(ms).replace(/^0/, "");

/**
 * « Confirme ton identité » (docs/design/3.5 § 4): the password, or the 2FA code when it is on. Valid 10 minutes for
 * this session, on Sécurité, Intégrations and the e-mail of Profil (lib/secrets/reconfirm.ts).
 */
export function ConfirmIdentityCard({ proof, onConfirmed, what }: { proof: "password" | "code"; onConfirmed: (until: number) => void; what: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const errorId = useId();
  const fieldId = useId();
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const secret = String(new FormData(form).get("proof") ?? "");
    setError(null);
    start(async () => {
      const r = await reconfirmAction(proof === "code" ? { code: secret } : { password: secret }).catch(() => ({ ok: false as const, error: "Connexion au serveur impossible." }));
      if (!r.ok) return setError(r.error);
      form.reset();
      onConfirmed(r.until);
    });
  };
  return (
    <section aria-labelledby={`${fieldId}-title`} className="rounded-md border border-accent bg-surface p-4 shadow-sm">
      <h2 id={`${fieldId}-title`} className="flex items-center gap-2 font-cond text-lg font-bold">
        <IconLock size={18} className="text-accent" /> Confirme ton identité
      </h2>
      <form onSubmit={submit} className="mt-2 flex flex-col gap-3 text-base">
        <p className="text-fg-muted">
          Pour {what}, {proof === "code" ? "saisis le code de ton application d'authentification" : "saisis ton mot de passe"}. Valable 10 minutes, sur Sécurité et
          Intégrations.
        </p>
        <label htmlFor={fieldId} className="text-sm font-semibold">
          {proof === "code" ? "Code à 6 chiffres" : "Mot de passe"}
        </label>
        <input
          id={fieldId}
          className={proof === "code" ? `${FIELD} font-mono tracking-widest` : FIELD}
          name="proof"
          type={proof === "code" ? "text" : "password"}
          inputMode={proof === "code" ? "numeric" : undefined}
          pattern={proof === "code" ? "[0-9 ]{6,7}" : undefined}
          maxLength={proof === "code" ? 7 : undefined}
          autoComplete={proof === "code" ? "one-time-code" : "current-password"}
          aria-invalid={!!error}
          aria-describedby={error ? errorId : undefined}
          required
        />
        {error && (
          <p id={errorId} role="alert" className="flex items-start gap-2 text-sm text-err">
            <IconAlertCircle size={16} className="mt-px shrink-0" />
            {error}
          </p>
        )}
        <button type="submit" className={`${buttonClass("primary", "md")} w-fit max-md:min-h-11`} disabled={pending}>
          {pending ? "Vérification…" : "Confirmer"}
        </button>
      </form>
    </section>
  );
}

/**
 * A sensitive page (Sécurité, Intégrations): until the identity is confirmed (less than 10 minutes ago), the card on
 * top and the content below blurred and inert; then « Identité confirmée. Modifications possibles jusqu'à 14:24. ».
 */
export function IdentityGate({ grantUntil, proof, what, children }: { grantUntil: number | null; proof: "password" | "code"; what: string; children: React.ReactNode }) {
  const [until, setUntil] = useState(grantUntil);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return;
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, [until]);
  const open = until !== null && until > now;
  return (
    <div className="flex flex-col gap-4">
      {open ? (
        <p role="status" className="flex items-center gap-2 rounded-md border border-ok bg-ok-soft px-3.5 py-2.5 text-base">
          <IconCheck size={16} className="shrink-0 text-ok" />
          Identité confirmée. Modifications possibles jusqu&apos;à {hhmm(until)}.
        </p>
      ) : (
        <ConfirmIdentityCard proof={proof} what={what} onConfirmed={setUntil} />
      )}
      <div inert={!open} aria-hidden={!open || undefined} className={open ? "" : "pointer-events-none blur-[3px] select-none"}>
        {children}
      </div>
    </div>
  );
}

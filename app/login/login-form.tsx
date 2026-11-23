"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { buttonClass } from "@/components/ui/button";
import { IconAlertCircle, Logo } from "@/components/ui/icons";
import { authClient } from "@/lib/auth-client";

const FIELD =
  "h-10 w-full rounded-sm border border-line-strong bg-surface px-3 text-[16px] font-normal text-fg md:text-[15px] aria-invalid:border-err";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<{ title: string; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  // Second step when two-factor authentication is on: TOTP code, or a backup code.
  const [step, setStep] = useState<"password" | "totp" | "backup">("password");

  function done() {
    router.replace("/");
    router.refresh();
  }

  function rateLimited(status: number) {
    if (status !== 429) return false;
    setError({ title: "Trop de tentatives.", text: "Réessaie dans quelques secondes." });
    return true;
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError(null);
    startTransition(async () => {
      const { data, error } = await authClient.signIn.email({
        email: String(form.get("email") ?? ""),
        password: String(form.get("password") ?? ""),
        rememberMe: true,
      });
      if (error) {
        if (!rateLimited(error.status)) setError({ title: "Connexion impossible.", text: "Email ou mot de passe incorrect." });
        return;
      }
      if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) {
        setStep("totp");
        return;
      }
      done();
    });
  }

  function onSubmitCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const code = String(form.get("code") ?? "").replace(/\s+/g, "");
    const trustDevice = form.get("trust") === "on";
    setError(null);
    startTransition(async () => {
      const { error } =
        step === "backup"
          ? await authClient.twoFactor.verifyBackupCode({ code, trustDevice })
          : await authClient.twoFactor.verifyTotp({ code, trustDevice });
      if (error) {
        if (error.code === "ACCOUNT_TEMPORARILY_LOCKED") {
          setError({ title: "Trop d'échecs.", text: "La double authentification est verrouillée quelques minutes." });
          return;
        }
        if (rateLimited(error.status)) return;
        if (error.code === "INVALID_TWO_FACTOR_COOKIE") {
          setStep("password");
          setError({ title: "Session expirée.", text: "Reconnecte-toi avec ton mot de passe." });
          return;
        }
        setError({ title: "Code refusé.", text: step === "backup" ? "Code de secours invalide ou déjà utilisé." : "Code invalide." });
        return;
      }
      done();
    });
  }

  return (
    <div className="mx-auto flex max-w-[380px] flex-col gap-5">
      <div className="flex items-center justify-center gap-3">
        <span className="inline-flex size-11 items-center justify-center rounded-lg bg-bar">
          <Logo size={30} />
        </span>
        <span className="font-cond text-[32px] leading-none font-bold">Veille</span>
      </div>

      <div className="overflow-hidden rounded-lg border border-line bg-surface shadow-md">
        <div className="flex h-10 items-center bg-bar-2 px-4">
          <h1 className="font-cond text-sm font-semibold tracking-caps text-bar-fg uppercase">Connexion</h1>
        </div>
        {step === "password" ? (
          <form onSubmit={onSubmit} className="flex flex-col gap-3.5 p-4" noValidate={false}>
            {error && <ErrorBox error={error} />}
            <label className="flex flex-col gap-1.5 text-sm font-semibold">
              Email
              <input className={FIELD} name="email" type="email" autoComplete="username" required autoFocus />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-semibold">
              Mot de passe
              <input
                className={FIELD}
                name="password"
                type="password"
                autoComplete="current-password"
                required
                aria-invalid={error ? true : undefined}
              />
            </label>
            <button type="submit" className={buttonClass("primary", "md", "h-10.5 w-full max-md:h-11")} disabled={pending}>
              {pending ? "Connexion…" : "Se connecter"}
            </button>
          </form>
        ) : (
          <form key={step} onSubmit={onSubmitCode} className="flex flex-col gap-3.5 p-4">
            {error && <ErrorBox error={error} />}
            <p className="text-base text-fg-muted">
              {step === "totp"
                ? "Double authentification : saisis le code à 6 chiffres affiché par ton application."
                : "Saisis l'un de tes codes de secours. Chaque code ne sert qu'une fois."}
            </p>
            <label className="flex flex-col gap-1.5 text-sm font-semibold">
              {step === "totp" ? "Code de vérification" : "Code de secours"}
              <input
                className={`${FIELD} font-mono tracking-widest`}
                name="code"
                type="text"
                required
                autoFocus
                autoComplete="one-time-code"
                {...(step === "totp" ? { inputMode: "numeric" as const, pattern: "[0-9 ]{6,7}", maxLength: 7 } : { maxLength: 32 })}
                aria-invalid={error ? true : undefined}
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="trust" className="size-4" />
              Faire confiance à cet appareil pendant 30 jours
            </label>
            <button type="submit" className={buttonClass("primary", "md", "h-10.5 w-full max-md:h-11")} disabled={pending}>
              {pending ? "Vérification…" : "Valider"}
            </button>
            <button
              type="button"
              className="cursor-pointer self-start text-sm text-accent underline"
              onClick={() => {
                setError(null);
                setStep(step === "totp" ? "backup" : "totp");
              }}
            >
              {step === "totp" ? "Utiliser un code de secours" : "Utiliser l'application d'authentification"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function ErrorBox({ error }: { error: { title: string; text: string } }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-sm border border-err bg-err-soft p-2.5 text-base text-err">
      <IconAlertCircle size={18} className="mt-px shrink-0" />
      <p>
        <strong className="font-semibold">{error.title}</strong> {error.text}
      </p>
    </div>
  );
}

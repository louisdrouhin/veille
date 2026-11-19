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

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError(null);
    startTransition(async () => {
      const { error } = await authClient.signIn.email({
        email: String(form.get("email") ?? ""),
        password: String(form.get("password") ?? ""),
        rememberMe: true,
      });
      if (error) {
        setError(
          error.status === 429
            ? { title: "Trop de tentatives.", text: "Réessaie dans une minute." }
            : { title: "Connexion impossible.", text: "Email ou mot de passe incorrect." },
        );
        return;
      }
      router.replace("/");
      router.refresh();
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
        <form onSubmit={onSubmit} className="flex flex-col gap-3.5 p-4" noValidate={false}>
          {error && (
            <div role="alert" className="flex items-start gap-2 rounded-sm border border-err bg-err-soft p-2.5 text-base text-err">
              <IconAlertCircle size={18} className="mt-px shrink-0" />
              <p>
                <strong className="font-semibold">{error.title}</strong> {error.text}
              </p>
            </div>
          )}
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
      </div>
    </div>
  );
}

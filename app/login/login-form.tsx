"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { authClient } from "@/lib/auth-client";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
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
        setError(error.status === 429 ? "Trop de tentatives, réessaie dans une minute." : "Email ou mot de passe incorrect.");
        return;
      }
      router.replace("/");
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 p-4">
      <label className="flex flex-col gap-1">
        <span>Email</span>
        <input className="input" name="email" type="email" autoComplete="username" required autoFocus />
      </label>
      <label className="flex flex-col gap-1">
        <span>Mot de passe</span>
        <input className="input" name="password" type="password" autoComplete="current-password" required />
      </label>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      <button type="submit" className="btn btn-primary self-start" disabled={pending}>
        {pending ? "Connexion…" : "Se connecter"}
      </button>
    </form>
  );
}

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Connexion" };

export default async function LoginPage() {
  if (await getSession()) redirect("/");
  return (
    <main className="min-h-dvh bg-bg bg-[radial-gradient(var(--border)_1px,transparent_1px)] bg-size-[18px_18px] px-4 py-[12vh]">
      <LoginForm />
    </main>
  );
}

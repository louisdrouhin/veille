import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/session";
import { hasAnyUser } from "@/lib/users";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Connexion" };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (!(await hasAnyUser(getDb()))) redirect("/setup");
  if (await getSession()) redirect("/");
  return (
    <main className="min-h-dvh bg-bg bg-[radial-gradient(var(--border)_1px,transparent_1px)] bg-size-[18px_18px] px-4 py-[12vh]">
      <LoginForm />
    </main>
  );
}

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Connexion" };

export default async function LoginPage() {
  if (await getSession()) redirect("/");
  return (
    <main className="mx-auto mt-[12vh] max-w-sm px-4">
      <div className="panel">
        <h1 className="panel-title">Veille — connexion</h1>
        <LoginForm />
      </div>
    </main>
  );
}

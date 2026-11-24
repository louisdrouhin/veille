import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/session";
import { hasAnyUser } from "@/lib/users";
import { ClearOfflineData } from "@/components/pwa/clear-offline-data";
import { Logo } from "@/components/ui/icons";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Connexion" };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (!(await hasAnyUser(getDb()))) redirect("/setup");
  if (await getSession()) redirect("/");
  return (
    <>
      {/* Mobile: the logo sits in a bar like the app header (sticky and opaque: iOS paints the status bar from it). */}
      <header className="safe-top safe-x sticky top-0 z-40 border-b border-black/30 bg-bar text-bar-fg md:hidden">
        <div className="flex min-h-13 items-center justify-center gap-2">
          <Logo />
          <span className="font-cond text-[21px] leading-none font-bold">Folders</span>
        </div>
      </header>
      <main className="safe-x min-h-dvh bg-bg bg-[radial-gradient(var(--border)_1px,transparent_1px)] bg-size-[18px_18px] px-4 py-6 md:safe-top md:py-[12vh]">
        <ClearOfflineData />
        <LoginForm />
      </main>
    </>
  );
}

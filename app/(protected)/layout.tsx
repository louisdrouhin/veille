import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LogoutButton } from "@/components/logout-button";
import { getAuth } from "@/lib/auth";

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  // Real authorization check (proxy.ts is only a convenience redirect).
  const requestHeaders = await headers();
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (!session) redirect("/login");

  return (
    <>
      <header className="border-b-4 border-amber bg-bar text-bar-text">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-2">
          <Link href="/" className="text-lg font-bold tracking-wide text-bar-text no-underline hover:no-underline">
            ▌Veille
          </Link>
          <nav className="flex items-center gap-3 text-[0.9rem]">
            <Link href="/" className="text-bar-text">
              Forums
            </Link>
            <Link href="/admin" className="text-bar-text">
              Administration
            </Link>
            <span className="hidden opacity-80 sm:inline">Connecté : {session.user.name}</span>
            <LogoutButton />
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-4">{children}</main>
    </>
  );
}

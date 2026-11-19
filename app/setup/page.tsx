import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { hasAnyUser } from "@/lib/users";
import { SetupForm } from "./setup-form";

export const metadata: Metadata = { title: "Premier lancement" };
export const dynamic = "force-dynamic";

/** First-run wizard: only exists while no account does. */
export default async function SetupPage() {
  if (await hasAnyUser(getDb())) notFound();
  return (
    <main className="min-h-dvh bg-bg bg-[radial-gradient(var(--border)_1px,transparent_1px)] bg-size-[18px_18px] px-4 py-[10vh]">
      <SetupForm />
    </main>
  );
}

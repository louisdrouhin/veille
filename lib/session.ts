import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";

export async function getSession() {
  const requestHeaders = await headers();
  return getAuth().api.getSession({ headers: requestHeaders });
}

/**
 * Must be called at the top of every server action, protected page/layout and
 * protected API route: `proxy.ts` is only a convenience redirect and is never
 * relied upon for authorization (cf. CVE-2025-29927).
 */
export async function requireSession() {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

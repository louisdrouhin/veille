import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppHeader } from "@/components/layout/app-header";
import { BackForwardRefresh } from "@/components/layout/back-forward-refresh";
import { NavigationTracker } from "@/components/layout/navigation-tracker";
import { PullToRefresh } from "@/components/layout/pull-to-refresh";
import { ScrollTopButton } from "@/components/layout/scroll-top-button";
import { OfflinePageCache } from "@/components/pwa/offline-page-cache";
import { UpdateToast } from "@/components/pwa/update-toast";
import { AccountThemeSync } from "@/components/theme/theme-sync";
import { ReadTopicsProvider } from "@/components/topic/read-topics";
import { Toaster } from "@/components/ui/toaster";
import { getAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getNavCounts } from "@/lib/lists/queries";
import { countOpenAlerts } from "@/lib/stack/queries";
import { parseTheme } from "@/lib/theme";
import { hasAnyUser } from "@/lib/users";

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const requestHeaders = await headers();
  // First run: no account yet → setup wizard.
  if (!(await hasAnyUser(getDb()))) redirect("/setup");
  // Real authorization check (proxy.ts is only a convenience redirect).
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (!session) redirect("/login");
  // Mobile menu counters (unread, lists, sources in error). The layout is kept across navigations:
  // refreshed with the page (BackForwardRefresh, « Actualiser », pull to refresh).
  const [nav, stack] = await Promise.all([getNavCounts(getDb()), countOpenAlerts(getDb())]);
  const counts = { ...nav, stack };

  return (
    <ReadTopicsProvider>
      <AppHeader userName={session.user.name} counts={counts} />
      <div className="safe-x">
        <main className="mx-auto w-full max-w-[1200px] px-2.5 py-4 sm:px-3.5 md:px-5">{children}</main>
      </div>
      <Suspense>
        <Toaster>
          <ScrollTopButton />
          <UpdateToast />
        </Toaster>
        <NavigationTracker />
        <OfflinePageCache />
        <BackForwardRefresh />
      </Suspense>
      <PullToRefresh />
      <AccountThemeSync theme={parseTheme((session.user as { theme?: unknown }).theme)} />
    </ReadTopicsProvider>
  );
}

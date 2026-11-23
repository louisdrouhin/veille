"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { recordNavigation } from "@/lib/nav-history";

/** Records every in-app URL change (see lib/nav-history.ts). Renders nothing. */
export function NavigationTracker() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  useEffect(() => {
    recordNavigation(search ? `${pathname}?${search}` : pathname);
  }, [pathname, search]);
  return null;
}

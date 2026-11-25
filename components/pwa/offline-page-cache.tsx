"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { cachePageForOffline } from "@/lib/pwa/client";

const isTopic = (pathname: string) => pathname.startsWith("/t/");

/**
 * Saves every page shown for offline reading: client-side navigations never
 * reach the service worker as documents, so it is told which URL to download
 * (lib/pwa/service-worker.js decides what may be cached, and skips a page it
 * saved moments ago). Topics are left to <SaveTopicForOffline/>. Renders nothing.
 */
export function OfflinePageCache() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  useEffect(() => {
    if (!isTopic(pathname)) cachePageForOffline(search ? `${pathname}?${search}` : pathname);
  }, [pathname, search]);
  return null;
}

/**
 * Rendered by the topic's article once it is there (it streams in
 * behind a Suspense boundary): the worker then downloads the page with the stored
 * article and its images, instead of starting a second extraction in parallel
 * with the first opening. Renders nothing.
 */
export function SaveTopicForOffline() {
  useEffect(() => {
    if (isTopic(window.location.pathname)) cachePageForOffline(window.location.pathname);
  }, []);
  return null;
}

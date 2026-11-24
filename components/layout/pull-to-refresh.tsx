"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { IconRefresh } from "@/components/ui/icons";
import { isStandalone } from "@/lib/pwa/client";
import { canStartPull, classifyGesture, pullDistance, pullProgress, shouldRefresh } from "@/lib/pull-to-refresh";

const FIELD = "input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]), textarea, select, [contenteditable='']";

function isTyping(): boolean {
  const el = document.activeElement;
  return el instanceof HTMLElement && (el.matches(FIELD) || el.isContentEditable);
}

/** Same rule as the keyboard shortcuts (lib/nav-history.ts): an open menu or dialog owns the gesture. */
const overlayOpen = () => document.querySelector("dialog[open], [aria-expanded='true']") !== null;

/**
 * Installed app only (iOS has no pull to refresh in a standalone PWA; Safari and other browsers keep
 * their own): pulling down from the very top shows a wheel that follows the finger; releasing past
 * the threshold re-renders the page with fresh data (router.refresh(): scroll and client state kept),
 * before it the pull is cancelled. The native bounce at the top is turned off in the installed app
 * (html[data-standalone] in app/globals.css) so the two never fight. The header's « Actualiser »
 * button stays. Touch listeners are passive: normal scrolling is never delayed.
 */
export function PullToRefresh() {
  const router = useRouter();
  const [distance, setDistance] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const gesture = useRef<{ x: number; y: number; kind: "pull" | "other" | null } | null>(null);
  const distanceRef = useRef(0);

  useEffect(() => {
    if (isStandalone()) document.documentElement.setAttribute("data-standalone", "");

    function reset() {
      gesture.current = null;
      distanceRef.current = 0;
      setDragging(false);
      setDistance(0);
    }

    function onStart(e: TouchEvent) {
      const touch = e.touches[0];
      const ok =
        touch &&
        canStartPull({
          standalone: isStandalone(),
          scrollY: window.scrollY,
          touches: e.touches.length,
          typing: isTyping(),
          overlayOpen: overlayOpen(),
        });
      gesture.current = ok ? { x: touch.clientX, y: touch.clientY, kind: null } : null;
    }

    function onMove(e: TouchEvent) {
      const g = gesture.current;
      const touch = e.touches[0];
      if (!g || !touch) return;
      if (e.touches.length > 1 || window.scrollY > 0) return reset();
      const dx = touch.clientX - g.x;
      const dy = touch.clientY - g.y;
      g.kind ??= classifyGesture(dx, dy);
      if (g.kind !== "pull") {
        if (g.kind === "other") gesture.current = null;
        return;
      }
      distanceRef.current = pullDistance(dy);
      setDragging(true);
      setDistance(distanceRef.current);
    }

    function onEnd() {
      if (!gesture.current) return;
      const refresh = shouldRefresh(distanceRef.current);
      reset();
      if (refresh) startRefresh(() => router.refresh());
    }

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd, { passive: true });
    window.addEventListener("touchcancel", reset, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", reset);
    };
  }, [router]);

  const shown = refreshing ? 56 : distance;
  const progress = refreshing ? 1 : pullProgress(distance);
  const armed = shouldRefresh(distance);

  return (
    <div
      aria-hidden={!refreshing}
      className={`pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+3.25rem)] z-30 flex justify-center ${
        dragging ? "" : "transition-transform duration-200 motion-reduce:transition-none"
      }`}
      style={{ transform: `translateY(${shown - 44}px)`, opacity: shown > 0 ? 1 : 0 }}
    >
      <span
        role="status"
        className={`inline-flex size-9 items-center justify-center rounded-full border shadow-md ${
          armed || refreshing ? "border-accent bg-accent text-accent-fg" : "border-line bg-surface text-accent"
        }`}
      >
        <IconRefresh
          size={18}
          className={
            refreshing
              ? "animate-spin motion-reduce:animate-none"
              : "rotate-[calc(var(--pull)*270deg)] opacity-[calc(0.4+var(--pull)*0.6)] motion-reduce:rotate-0"
          }
          style={{ "--pull": progress } as React.CSSProperties}
        />
        <span className="sr-only">{refreshing ? "Actualisation…" : ""}</span>
      </span>
    </div>
  );
}

"use client";

import { useSyncExternalStore } from "react";
import { isIos } from "./platform";

/**
 * Browser side of the PWA: service worker registration, the deferred install
 * prompt, display mode. Everything degrades to a no-op without service workers
 * (old browsers, plain http) or without Cache Storage.
 */

type BeforeInstallPromptEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

const hasServiceWorker = () => typeof navigator !== "undefined" && "serviceWorker" in navigator;

// ---------------------------------------------------------------- tiny external stores

function store<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: T) {
      value = next;
      listeners.forEach((l) => l());
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

const installPrompt = store<BeforeInstallPromptEvent | null>(null);
const waitingWorker = store<ServiceWorker | null>(null);

// ---------------------------------------------------------------- registration

let started = false;

/** Registers /sw.js and watches for updates and for the install prompt. Called once, from the root layout. */
export function startPwa(): void {
  if (started || typeof window === "undefined") return;
  started = true;

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // our banner offers it instead of the browser's mini-infobar
    installPrompt.set(e as BeforeInstallPromptEvent);
  });
  window.addEventListener("appinstalled", () => installPrompt.set(null));

  if (!hasServiceWorker() || process.env.NODE_ENV !== "production") return;
  void navigator.serviceWorker
    .register("/sw.js", { scope: "/", updateViaCache: "none" })
    .then((reg) => {
      const track = (worker: ServiceWorker | null) => {
        if (!worker) return;
        const check = () => {
          // "installed" with a controller = an update (the first install has none).
          if (worker.state === "installed" && navigator.serviceWorker.controller) waitingWorker.set(worker);
        };
        check();
        worker.addEventListener("statechange", check);
      };
      track(reg.waiting);
      reg.addEventListener("updatefound", () => track(reg.installing));
      // An installed app can stay open for days: look for a new version when it
      // comes back to the foreground, and every 30 minutes.
      const update = () => void reg.update().catch(() => {});
      document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && update());
      setInterval(update, 30 * 60_000);
    })
    .catch(() => {});
}

/** Activates the waiting worker, then reloads once it controls the page (never automatic). */
export function applyUpdate(): void {
  const worker = waitingWorker.get();
  if (!worker) return;
  navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload(), { once: true });
  worker.postMessage({ type: "skip-waiting" });
}

export function useWaitingUpdate(): boolean {
  return useSyncExternalStore(waitingWorker.subscribe, () => waitingWorker.get() !== null, () => false);
}

export function useInstallPrompt(): BeforeInstallPromptEvent | null {
  return useSyncExternalStore(installPrompt.subscribe, installPrompt.get, () => null);
}

export async function promptInstall(): Promise<void> {
  const e = installPrompt.get();
  if (!e) return;
  await e.prompt();
  await e.userChoice.catch(() => undefined);
  installPrompt.set(null); // a prompt can only be used once
}

// ---------------------------------------------------------------- caches

/** Asks the worker to save a page (and a topic's images) for offline reading. */
export function cachePageForOffline(url: string): void {
  if (!hasServiceWorker()) return;
  navigator.serviceWorker.controller?.postMessage({ type: "cache-page", url });
}

/** Deletes every cache of the worker (logout, login page): nothing read stays on the device. */
export async function clearOfflineData(): Promise<void> {
  if (hasServiceWorker()) navigator.serviceWorker.controller?.postMessage({ type: "clear" });
  if (typeof caches === "undefined") return;
  try {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  } catch {
    // storage unavailable (private mode…): nothing to clear
  }
}

// ---------------------------------------------------------------- display mode

const STANDALONE_QUERY = "(display-mode: standalone)";

function subscribeDisplayMode(onChange: () => void) {
  const mq = window.matchMedia(STANDALONE_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/** Running as an installed app, without the browser's toolbar (iOS: navigator.standalone). */
export function isStandalone(): boolean {
  return window.matchMedia(STANDALONE_QUERY).matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function useStandalone(): boolean {
  return useSyncExternalStore(subscribeDisplayMode, isStandalone, () => false);
}

const noSubscribe = () => () => {};

export function useIsIos(): boolean {
  return useSyncExternalStore(noSubscribe, () => isIos(navigator.userAgent, navigator.platform, navigator.maxTouchPoints), () => false);
}

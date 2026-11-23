"use client";

import { useSyncExternalStore } from "react";
import { buttonClass } from "@/components/ui/button";
import { IconClose, IconDownload, IconShare } from "@/components/ui/icons";
import { promptInstall, useInstallPrompt, useIsIos, useStandalone } from "@/lib/pwa/client";
import { installMode } from "@/lib/pwa/platform";

const DISMISSED_KEY = "veille:install-banner-dismissed";
const dismissListeners = new Set<() => void>();

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

function dismissForGood() {
  try {
    window.localStorage.setItem(DISMISSED_KEY, "1");
  } catch {
    // storage blocked: hidden for this visit only
  }
  hiddenThisVisit = true;
  dismissListeners.forEach((l) => l());
}

let hiddenThisVisit = false;
const subscribeDismissed = (l: () => void) => {
  dismissListeners.add(l);
  return () => dismissListeners.delete(l);
};

/**
 * Discreet « Installer l'app » box on the home page: the browser's install
 * prompt where there is one (Android, desktop Chrome/Edge), the Share → « Sur
 * l'écran d'accueil » steps on iOS. Gone for good once closed, and never shown
 * inside the installed app.
 */
export function InstallBanner() {
  const standalone = useStandalone();
  const prompt = useInstallPrompt();
  const ios = useIsIos();
  // Server snapshot "dismissed": nothing is rendered before the browser has answered.
  const dismissed = useSyncExternalStore(subscribeDismissed, () => hiddenThisVisit || readDismissed(), () => true);
  const mode = installMode({ standalone, dismissed, hasPrompt: prompt !== null, ios });
  if (mode === "none") return null;

  return (
    <aside
      aria-label="Installer l'app"
      className="mb-3 flex items-center gap-3 rounded-md border border-line bg-surface-alt px-3 py-2 text-sm"
    >
      <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-sm bg-accent-soft text-accent">
        <IconDownload size={15} />
      </span>
      {mode === "prompt" ? (
        <>
          <p className="min-w-0 flex-1">Installe Veille pour l&apos;ouvrir comme une app, en plein écran.</p>
          <button type="button" className={buttonClass("primary", "sm")} onClick={() => void promptInstall()}>
            Installer l&apos;app
          </button>
        </>
      ) : (
        <p className="min-w-0 flex-1">
          <strong className="font-semibold">Installer l&apos;app :</strong> touche{" "}
          <span className="whitespace-nowrap">
            <IconShare size={15} className="inline-block align-[-2px] text-accent" /> Partager
          </span>
          , puis <span className="whitespace-nowrap">« Sur l&apos;écran d&apos;accueil »</span>.
        </p>
      )}
      <button
        type="button"
        onClick={dismissForGood}
        aria-label="Ne plus proposer l'installation"
        title="Ne plus afficher"
        className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-sm text-fg-muted hover:bg-surface-hover max-md:size-11"
      >
        <IconClose size={14} />
      </button>
    </aside>
  );
}

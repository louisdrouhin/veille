"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import { applyTheme } from "@/components/theme/theme-sync";
import { IconCheck } from "@/components/ui/icons";
import { SavedHint, useSave } from "@/components/settings/saved";
import { setTheme } from "@/lib/actions/account";
import type { ThemePreference } from "@/lib/theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function subscribeScheme(onChange: () => void) {
  const mq = window.matchMedia(DARK_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/** The device's own setting, live (iOS switches at sunset, for instance). Null on the server. */
function useSystemDark(): boolean | null {
  return useSyncExternalStore(subscribeScheme, () => window.matchMedia(DARK_QUERY).matches, () => null);
}

type Palette = "light" | "dark";

// Fixed colors (app/globals.css, --color-preview-*): the « Clair » preview stays light in dark mode.
const PREVIEW: Record<Palette, { bg: string; bar: string; surface: string; line: string; accent: string; text: string }> = {
  light: {
    bg: "bg-preview-light-bg",
    bar: "bg-preview-light-bar",
    surface: "bg-preview-light-surface border-preview-light-line",
    line: "bg-preview-light-text",
    accent: "bg-preview-light-accent",
    text: "bg-preview-light-line",
  },
  dark: {
    bg: "bg-preview-dark-bg",
    bar: "bg-preview-dark-bar",
    surface: "bg-preview-dark-surface border-preview-dark-line",
    line: "bg-preview-dark-text",
    accent: "bg-preview-dark-accent",
    text: "bg-preview-dark-line",
  },
};

/** A tiny screen: header, then two topic rows (folder + title line). */
function MiniScreen({ palette }: { palette: Palette }) {
  const c = PREVIEW[palette];
  return (
    <div className={`flex h-full min-w-0 flex-1 flex-col gap-1 ${c.bg}`}>
      <div className={`h-2.5 shrink-0 md:h-3.5 ${c.bar}`} />
      {[0, 1].map((i) => (
        <div key={i} className={`mx-1 flex items-center gap-1 rounded-[2px] border px-1 py-1 md:mx-1.5 md:py-1.5 ${c.surface}`}>
          <span className={`size-1.5 shrink-0 rounded-[1px] md:size-2 ${i === 0 ? c.accent : c.line}`} />
          <span className={`h-1 flex-1 rounded-full md:h-1.5 ${i === 0 ? c.line : c.text}`} />
        </div>
      ))}
    </div>
  );
}

const OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "system", label: "Système" },
  { value: "light", label: "Clair" },
  { value: "dark", label: "Sombre" },
];

function hint(value: ThemePreference, systemDark: boolean | null): string {
  if (value === "light") return "Toujours clair, quel que soit le réglage de l'appareil.";
  if (value === "dark") return "Toujours sombre, quel que soit le réglage de l'appareil.";
  const now = systemDark === null ? "" : ` : ${systemDark ? "sombre" : "clair"} en ce moment`;
  return `Suit le réglage de l'appareil${now}. Change tout seul quand l'appareil bascule.`;
}

/**
 * Paramètres › Apparence. A change applies at once (<html data-theme>), then is saved on the
 * account by the setTheme action. No « Enregistrer » button.
 */
export function ThemePicker({ initial }: { initial: ThemePreference }) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState(false);
  const [, startTransition] = useTransition();
  const systemDark = useSystemDark();

  const { state: savedState, save } = useSave();
  function choose(next: ThemePreference) {
    const previous = value;
    setValue(next);
    setError(false);
    applyTheme(next);
    startTransition(async () => {
      const ok = await save(async () => ((await setTheme(next).catch(() => ({ ok: false }))).ok ? { ok: true } : { ok: false, error: "Thème non enregistré : réessaie." }));
      if (ok) return;
      setValue(previous);
      applyTheme(previous);
      setError(true);
    });
  }

  return (
    <fieldset className="flex flex-col gap-2.5">
      <legend className="mb-2.5 flex items-center gap-2 text-[15px] font-semibold">
        Thème <SavedHint state={savedState} />
      </legend>
      <div className="grid grid-cols-3 gap-2 md:gap-3">
        {OPTIONS.map((o) => {
          const checked = value === o.value;
          return (
            <label
              key={o.value}
              className={`relative flex cursor-pointer flex-col gap-2 rounded-md bg-surface p-2 has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-focus ${
                checked ? "border-2 border-accent bg-accent-soft" : "border border-line-strong hover:bg-surface-hover"
              }`}
            >
              <input
                type="radio"
                name="theme"
                value={o.value}
                checked={checked}
                onChange={() => choose(o.value)}
                className="sr-only"
              />
              <span aria-hidden className="flex h-[58px] overflow-hidden rounded-sm border border-line md:h-[92px]">
                {o.value === "system" ? (
                  <>
                    <MiniScreen palette="light" />
                    <MiniScreen palette="dark" />
                  </>
                ) : (
                  <MiniScreen palette={o.value} />
                )}
              </span>
              <span className={`flex min-h-6 items-center gap-1.5 text-base ${checked ? "font-bold" : ""}`}>
                {checked && (
                  <span aria-hidden className="inline-flex size-4.5 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg">
                    <IconCheck size={12} />
                  </span>
                )}
                {o.label}
              </span>
            </label>
          );
        })}
      </div>
      <p className="text-sm text-fg-muted" aria-live="polite">
        {hint(value, systemDark)}
      </p>
      {error && (
        <p role="alert" className="text-sm text-err">
          Réglage non enregistré : réessaie.
        </p>
      )}
    </fieldset>
  );
}

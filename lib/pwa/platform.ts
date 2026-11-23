/** Pure helpers for the install banner and the standalone UI (tested in tests/pwa-platform.test.ts). */

/** iPhone, iPod, or an iPad (which reports itself as a Mac with a touch screen). */
export function isIos(userAgent: string, platform = "", maxTouchPoints = 0): boolean {
  return /iPhone|iPad|iPod/.test(userAgent) || (platform === "MacIntel" && maxTouchPoints > 1);
}

export type InstallMode = "none" | "prompt" | "ios";

/**
 * What the install banner offers: the browser's own prompt (Android, desktop
 * Chrome/Edge: beforeinstallprompt), the « Partager → Sur l'écran d'accueil »
 * steps on iOS (no install API), or nothing (already installed, dismissed for good,
 * or a browser that cannot install).
 */
export function installMode(s: { standalone: boolean; dismissed: boolean; hasPrompt: boolean; ios: boolean }): InstallMode {
  if (s.standalone || s.dismissed) return "none";
  if (s.hasPrompt) return "prompt";
  return s.ios ? "ios" : "none";
}

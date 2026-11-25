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

export type PushAvailability = "unconfigured" | "install-ios" | "unsupported" | "denied" | "available";

/**
 * What « Sur cet appareil » can offer (docs/design/3.0 § 5): Web Push only works in the app
 * installed on the iPhone home screen (iOS 16.4+), never in Safari itself; a permission refused in
 * iOS must be changed in Réglages; the server may have no VAPID keys.
 */
export function pushAvailability(s: { configured: boolean; ios: boolean; standalone: boolean; hasPush: boolean; permission: NotificationPermission | null }): PushAvailability {
  if (!s.configured) return "unconfigured";
  if (s.ios && !s.standalone) return "install-ios";
  if (!s.hasPush) return "unsupported";
  if (s.permission === "denied") return "denied";
  return "available";
}

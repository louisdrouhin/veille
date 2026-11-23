import { describe, expect, it } from "vitest";
import { installMode, isIos } from "@/lib/pwa/platform";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const MAC_SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15";
const ANDROID = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36";

describe("isIos", () => {
  it("recognizes iPhone, and iPad posing as a Mac (touch screen)", () => {
    expect(isIos(IPHONE)).toBe(true);
    expect(isIos(MAC_SAFARI, "MacIntel", 5)).toBe(true);
  });
  it("leaves out real Macs and Android", () => {
    expect(isIos(MAC_SAFARI, "MacIntel", 0)).toBe(false);
    expect(isIos(ANDROID, "Linux armv8l", 5)).toBe(false);
  });
});

describe("installMode", () => {
  const base = { standalone: false, dismissed: false, hasPrompt: false, ios: false };
  it("offers the browser prompt when there is one (Android, desktop)", () => {
    expect(installMode({ ...base, hasPrompt: true })).toBe("prompt");
  });
  it("shows the Share → « Sur l'écran d'accueil » steps on iOS", () => {
    expect(installMode({ ...base, ios: true })).toBe("ios");
  });
  it("shows nothing once installed, once dismissed, or when the browser cannot install", () => {
    expect(installMode({ ...base, hasPrompt: true, standalone: true })).toBe("none");
    expect(installMode({ ...base, ios: true, dismissed: true })).toBe("none");
    expect(installMode(base)).toBe("none");
  });
});

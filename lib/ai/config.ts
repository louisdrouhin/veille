import "server-only";

/**
 * Gemini (résumé / traduction). Model: gemini-3.5-flash-lite — stable, free tier, made for
 * high-volume, low-latency text tasks (docs: ai.google.dev / aistudio.google.com, nov. 2026).
 * GEMINI_MODEL overrides it (e.g. when Google retires the model).
 */
export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";

export type AiConfig = { apiKey: string; model: string };

/** Null without GEMINI_API_KEY: the buttons are not shown. The key never leaves the server. */
export function aiConfig(env: Partial<Record<string, string | undefined>> = process.env): AiConfig | null {
  const apiKey = env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;
  const model = env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
  // Goes into the URL path: letters, digits, dots and dashes only.
  if (!/^[a-z0-9][a-z0-9.-]{0,63}$/.test(model)) return null;
  return { apiKey, model };
}

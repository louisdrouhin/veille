import "server-only";

/**
 * Gemini (résumé / traduction), models checked in the docs (aistudio.google.com/docs, nov. 2026):
 * - summary: gemini-3.5-flash-lite — stable, free tier, made for high-volume, low-latency tasks;
 * - translation: gemini-3.8-flash — the current stable Flash (not Lite), free tier, better
 *   at faithful, natural French (Lite left words untranslated or mistranslated).
 * GEMINI_MODEL and GEMINI_TRANSLATE_MODEL override them (e.g. when Google retires a model).
 */
export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";
export const DEFAULT_TRANSLATE_MODEL = "gemini-3.8-flash";

export type AiConfig = { apiKey: string; model: string; translateModel: string };

// Goes into the URL path: letters, digits, dots and dashes only.
const MODEL = /^[a-z0-9][a-z0-9.-]{0,63}$/;

/** Null without GEMINI_API_KEY: the buttons are not shown. The key never leaves the server. */
export function aiConfig(env: Partial<Record<string, string | undefined>> = process.env): AiConfig | null {
  const apiKey = env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;
  const model = env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
  const translateModel = env.GEMINI_TRANSLATE_MODEL?.trim() || DEFAULT_TRANSLATE_MODEL;
  if (!MODEL.test(model) || !MODEL.test(translateModel)) return null;
  return { apiKey, model, translateModel };
}

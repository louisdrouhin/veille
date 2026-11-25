/**
 * Admin › Intégrations: the values that can be set from the interface instead of the server .env.
 * Secrets are stored encrypted (lib/secrets/crypto.ts); the others (models, VAPID public key) in clear.
 */
export const SETTING_NAMES = ["gemini_api_key", "gemini_model", "gemini_translate_model", "nvd_api_key", "vapid_public_key", "vapid_private_key"] as const;
export type SettingName = (typeof SETTING_NAMES)[number];

export const SECRET_NAMES = ["gemini_api_key", "nvd_api_key", "vapid_private_key"] as const satisfies readonly SettingName[];
export type SecretName = (typeof SECRET_NAMES)[number];

/** The environment variable each one overrides. */
export const ENV_OF: Record<SettingName, string> = {
  gemini_api_key: "GEMINI_API_KEY",
  gemini_model: "GEMINI_MODEL",
  gemini_translate_model: "GEMINI_TRANSLATE_MODEL",
  nvd_api_key: "NVD_API_KEY",
  vapid_public_key: "VAPID_PUBLIC_KEY",
  vapid_private_key: "VAPID_PRIVATE_KEY",
};

/** Journal of the changes: which value, what was done, when (never the value). */
export const SETTING_ACTIONS = ["set", "delete", "generate", "import"] as const;
export type SettingAction = (typeof SETTING_ACTIONS)[number];

export const isSecret = (name: SettingName): name is SecretName => (SECRET_NAMES as readonly string[]).includes(name);
export const isSettingName = (v: unknown): v is SettingName => typeof v === "string" && (SETTING_NAMES as readonly string[]).includes(v);

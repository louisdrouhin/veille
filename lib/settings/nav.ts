/**
 * Paramètres (docs/design/3.5 § 1): groups and pages, one URL each. Shared by the side menu (desktop), the list of
 * /parametres (mobile), the account menu and the redirects. No server import.
 */
export const SETTINGS_PAGES = [
  { key: "profil", group: "Compte", label: "Profil", icon: "user" },
  { key: "securite", group: "Compte", label: "Sécurité", icon: "lock" },
  { key: "apparence", group: "Préférences", label: "Apparence", icon: "palette" },
  { key: "notifications", group: "Préférences", label: "Notifications", icon: "bell" },
  { key: "briefing", group: "Préférences", label: "Briefing du matin", icon: "sun" },
  { key: "raccourcis", group: "Préférences", label: "Raccourcis clavier", icon: "keyboard", desktopOnly: true },
  { key: "forums", group: "Administration", label: "Forums", icon: "folder" },
  { key: "sources", group: "Administration", label: "Sources", icon: "rss" },
  { key: "integrations", group: "Administration", label: "Intégrations", icon: "key" },
  { key: "recherche-ia", group: "Administration", label: "Recherche et IA", icon: "sparkle" },
  { key: "a-propos", group: "À propos", label: "À propos", icon: "info" },
] as const;

export type SettingsKey = (typeof SETTINGS_PAGES)[number]["key"];
export type SettingsIcon = (typeof SETTINGS_PAGES)[number]["icon"];
export const SETTINGS_GROUPS = ["Compte", "Préférences", "Administration", "À propos"] as const;

export const settingsHref = (key: SettingsKey) => `/parametres/${key}`;
export const settingsLabel = (key: SettingsKey) => SETTINGS_PAGES.find((p) => p.key === key)!.label;

/** Document title: « Sources · Paramètres » (the root layout adds « · Folders »). */
export const settingsTitle = (key: SettingsKey) => `${settingsLabel(key)} · Paramètres`;

/**
 * Anchors of the old pages (/compte#apparence, /admin#sources), kept by the browser through the 308 redirect: the
 * page they land on sends them to the page that now holds that block.
 */
export const LEGACY_ANCHORS: Record<string, SettingsKey> = {
  profil: "profil",
  apparence: "apparence",
  notifications: "notifications",
  securite: "securite",
  "deux-facteurs": "securite",
  "2fa": "securite",
  session: "securite",
  "a-propos": "a-propos",
  briefing: "briefing",
  forums: "forums",
  sources: "sources",
  integrations: "integrations",
};

/** Per page: what the mobile list shows on the right (current value or badge). */
export type SettingsValues = Partial<Record<SettingsKey, { value?: string; badge?: string }>>;

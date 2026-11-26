import type { NextConfig } from "next";
import { buildInfoEnv } from "./lib/build-info";

export default function config(phase: string): NextConfig {
  return {
    output: "standalone",
    poweredByHeader: false,
    env: buildInfoEnv(phase),
    outputFileTracingIncludes: {
      // Read at runtime by app/sw.js/route.ts (lib/pwa/sw-script.ts).
      "/sw.js": ["./lib/pwa/service-worker.js"],
      // « Nouveautés » in Paramètres › À propos (lib/changelog.ts).
      "/parametres/a-propos": ["./CHANGELOG.md"],
    },
    redirects: async () => LEGACY_REDIRECTS,
  };
}

/**
 * « Mon compte » and « Admin » are gone (docs/design/3.5 § 1): permanent redirects (308) from their URLs. The query
 * is kept (?edit=12 of a source); an anchor (#apparence) is kept by the browser and mapped by the page
 * (components/settings/legacy-anchor.tsx).
 */
export const LEGACY_REDIRECTS = [
  { source: "/compte", destination: "/parametres/profil", permanent: true },
  { source: "/compte/notifications", destination: "/parametres/notifications", permanent: true },
  { source: "/compte/nouveautes", destination: "/parametres/a-propos", permanent: true },
  // A source being edited (/admin?edit=12) was on the Sources panel.
  { source: "/admin", has: [{ type: "query" as const, key: "edit" }], destination: "/parametres/sources", permanent: true },
  { source: "/admin", destination: "/parametres/forums", permanent: true },
  { source: "/admin/sources", destination: "/parametres/sources", permanent: true },
  { source: "/admin/integrations", destination: "/parametres/integrations", permanent: true },
];

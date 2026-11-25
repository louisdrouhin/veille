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
      // « Nouveautés » (lib/changelog.ts).
      "/compte/nouveautes": ["./CHANGELOG.md"],
    },
  };
}

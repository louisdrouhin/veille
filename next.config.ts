import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // Read at runtime by app/sw.js/route.ts (lib/pwa/sw-script.ts).
  outputFileTracingIncludes: { "/sw.js": ["./lib/pwa/service-worker.js"] },
};

export default nextConfig;

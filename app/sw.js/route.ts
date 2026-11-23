import { SERVICE_WORKER_HEADERS, serviceWorkerScript } from "@/lib/pwa/sw-script";

export const dynamic = "force-dynamic";

/** The service worker (lib/pwa/service-worker.js), public: it is registered on the login page too. */
export function GET() {
  return new Response(serviceWorkerScript(), { headers: SERVICE_WORKER_HEADERS });
}

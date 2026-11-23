import { getDb } from "@/lib/db";
import { checkHealth } from "@/lib/health";

export const dynamic = "force-dynamic";

/**
 * Unauthenticated healthcheck for external monitoring: database + worker
 * freshness (see lib/health.ts). The Docker healthcheck uses /api/health/app,
 * which ignores the worker: the worker only starts once the app is healthy.
 */
export async function GET() {
  const { httpStatus, body } = await checkHealth(getDb());
  return Response.json(body, { status: httpStatus, headers: { "Cache-Control": "no-store" } });
}

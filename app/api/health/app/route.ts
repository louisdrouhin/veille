import { getDb } from "@/lib/db";
import { checkAppHealth } from "@/lib/health";

export const dynamic = "force-dynamic";

/**
 * Liveness of the app container alone, used by the Docker healthcheck: the
 * worker waits for the app to be healthy, so this one must not depend on it.
 */
export async function GET() {
  const { httpStatus, body } = await checkAppHealth(getDb());
  return Response.json(body, { status: httpStatus, headers: { "Cache-Control": "no-store" } });
}

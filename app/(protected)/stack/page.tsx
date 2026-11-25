import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { countOpenAlerts } from "@/lib/stack/queries";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** « Ma stack » (docs/design/3.0 § 3): the alerts when some are to handle, else the software. */
export default async function StackPage() {
  await requireSession();
  const { open } = await countOpenAlerts(getDb());
  redirect(open > 0 ? "/stack/alertes" : "/stack/logiciels");
}

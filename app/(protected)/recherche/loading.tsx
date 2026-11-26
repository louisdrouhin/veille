import { count } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { topics } from "@/lib/db/schema";

/** While the exact matches load (docs/design/3.3 § 3): « Recherche dans 3 112 articles… » and skeletons. */
export default async function Loading() {
  const [row] = await getDb()
    .select({ n: count() })
    .from(topics)
    .catch(() => [{ n: 0 }]);
  const n = row?.n ?? 0;
  return (
    <div aria-busy="true" className="flex flex-col gap-3.5">
      <p role="status" className="text-sm text-fg-muted">
        {n > 0 ? `Recherche dans ${n.toLocaleString("fr-FR")} articles…` : "Recherche dans ta veille…"}
      </p>
      <div className="h-11 w-full animate-pulse-soft rounded-sm bg-off-soft md:h-10" />
      <div className="h-14 w-full animate-pulse-soft rounded-md bg-off-soft" />
      <div className="overflow-hidden rounded-md border border-line bg-surface shadow-sm">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex flex-col gap-2 border-t border-line px-4 py-3 first:border-t-0">
            <span className="h-4 w-2/3 animate-pulse-soft rounded-sm bg-off-soft" />
            <span className="h-3 w-full animate-pulse-soft rounded-sm bg-off-soft" />
          </div>
        ))}
      </div>
    </div>
  );
}

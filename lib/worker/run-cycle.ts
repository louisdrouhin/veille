import type { Db } from "@/lib/db";
import { refreshFavicon } from "@/lib/feeds/favicon";
import { fetchSource, listDueSources } from "@/lib/feeds/fetch-source";
import { purgeArticleContents } from "@/lib/reader/store";

export type CycleStats = { sources: number; inserted: number; notModified: number; failed: number };

/**
 * One worker pass: fetches every due source with `concurrency` parallel lanes,
 * then refreshes its favicon when missing or older than 7 days. Also purges
 * reading-mode articles cached more than 90 days ago.
 */
export async function runCycle(
  db: Db,
  opts: { concurrency: number; log?: (...args: unknown[]) => void; shouldStop?: () => boolean; fetchImpl?: typeof fetch },
): Promise<CycleStats> {
  const log = opts.log ?? (() => {});
  const purged = await purgeArticleContents(db);
  if (purged) log(`Mode lecture : ${purged} article(s) de plus de 90 jours purgé(s)`);
  const due = await listDueSources(db);
  log(`Cycle : ${due.length} source(s) à récupérer`);
  const stats: CycleStats = { sources: due.length, inserted: 0, notModified: 0, failed: 0 };
  const queue = [...due];

  async function lane() {
    for (let source = queue.shift(); source && !opts.shouldStop?.(); source = queue.shift()) {
      const res = await fetchSource(db, source, { fetchImpl: opts.fetchImpl });
      if (res.status === "ok") {
        stats.inserted += res.inserted;
        log(`[${source.name}] ${res.inserted} nouveau(x) topic(s)${res.firstImport ? " (import initial, marqués lus)" : ""}`);
      } else if (res.status === "not-modified") {
        stats.notModified++;
        log(`[${source.name}] inchangé (304)`);
      } else {
        stats.failed++;
        log(`[${source.name}] ERREUR : ${res.error}${res.paused ? " — source en pause 1 h" : ""}`);
      }
      const icon = await refreshFavicon(db, source, { fetchImpl: opts.fetchImpl });
      if (icon === "stored") log(`[${source.name}] favicon enregistré`);
    }
  }

  await Promise.all(Array.from({ length: Math.min(Math.max(1, opts.concurrency), queue.length) }, lane));
  return stats;
}

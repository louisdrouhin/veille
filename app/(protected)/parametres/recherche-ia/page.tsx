import type { Metadata } from "next";
import { SearchAiSettings } from "@/components/settings/search-ai";
import { SettingsPage } from "@/components/settings/settings-page";
import { getDb } from "@/lib/db";
import { DEFAULT_MERGE_THRESHOLD, mergeThreshold, mergeWindowMs } from "@/lib/merge/fusion";
import { indexProgress } from "@/lib/search/indexer";
import { fusionScores, reindexEstimate } from "@/lib/search/simulate";
import { dailyLimit, usedToday } from "@/lib/search/usage";
import { effectiveEnv } from "@/lib/secrets/effective";
import { requireSession } from "@/lib/session";
import { settingsTitle } from "@/lib/settings/nav";

export const metadata: Metadata = { title: settingsTitle("recherche-ia") };
export const dynamic = "force-dynamic";

/** Paramètres › Recherche et IA (docs/design/3.5 § 7): fusion threshold and window, daily limits, indexing. */
export default async function SearchAiPage() {
  await requireSession();
  const db = getDb();
  const env = await effectiveEnv(db);
  const windowMs = mergeWindowMs(env);
  const [scores, progress, embedUsed, askUsed] = await Promise.all([fusionScores(db, windowMs, env), indexProgress(db, env), usedToday(db, "embed"), usedToday(db, "ask")]);
  const embedLimit = dailyLimit("embed", env);
  return (
    <SettingsPage page="recherche-ia" title="Recherche et IA" description="Comment Folders regroupe les doublons, combien d'appels à l'IA il s'autorise chaque jour, et l'état de l'index.">
      <SearchAiSettings
        view={{
          threshold: mergeThreshold(env),
          thresholdDefault: DEFAULT_MERGE_THRESHOLD,
          windowHours: windowMs / 3_600_000,
          scores,
          limits: { embed: { used: embedUsed, limit: embedLimit }, ask: { used: askUsed, limit: dailyLimit("ask", env) } },
          index: { ...progress, estimate: reindexEstimate(progress.total, embedLimit) },
        }}
      />
    </SettingsPage>
  );
}

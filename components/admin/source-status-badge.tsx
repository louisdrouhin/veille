import { IconAlert, IconBan, IconCheck, IconClock, IconPause } from "@/components/ui/icons";
import type { Source } from "@/lib/db/schema";
import { formatTime, plural } from "@/lib/format-date";

export type SourceStatus = "ok" | "error" | "paused" | "disabled" | "pending";

export function sourceStatus(source: Source, now: Date): SourceStatus {
  if (!source.enabled) return "disabled";
  if (source.pausedUntil && source.pausedUntil > now) return "paused";
  if (source.consecutiveFailures > 0) return "error";
  if (source.lastFetchedAt) return "ok";
  return "pending";
}

const PILL = "inline-flex h-5.5 items-center gap-1.25 rounded-full px-2 text-xs font-semibold whitespace-nowrap";

export function SourceStatusBadge({ source, now }: { source: Source; now: Date }) {
  const status = sourceStatus(source, now);
  const failures = plural(source.consecutiveFailures, "échec");

  switch (status) {
    case "ok":
      return (
        <span className={`${PILL} bg-ok-soft text-ok`}>
          <IconCheck size={12} /> OK
        </span>
      );
    case "error":
      return (
        <div className="flex flex-col items-start gap-1">
          <span className={`${PILL} bg-err-soft text-err`}>
            <IconAlert size={12} /> En erreur
          </span>
          <span className="font-mono text-[11.5px] leading-4 break-words text-err">
            {source.lastError} · {failures}
          </span>
        </div>
      );
    case "paused":
      return (
        <div className="flex flex-col items-start gap-1">
          <span className={`${PILL} bg-warn-soft text-warn`}>
            <IconPause size={12} /> En pause jusqu&apos;à {formatTime(source.pausedUntil!)}
          </span>
          <span className="text-[11.5px] leading-4 break-words text-fg-muted">
            {failures} consécutifs · <span className="font-mono">{source.lastError}</span>
          </span>
        </div>
      );
    case "disabled":
      return (
        <span className={`${PILL} border border-dashed border-line-strong bg-off-soft text-off`}>
          <IconBan size={12} /> Désactivée
        </span>
      );
    case "pending":
      return (
        <span className={`${PILL} bg-off-soft text-off`}>
          <IconClock size={12} /> En attente
        </span>
      );
  }
}

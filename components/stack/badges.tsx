/**
 * Ma stack badges (docs/design/3.0 § 1). Severity is never carried by color alone: always the word,
 * and the CVSS score when there is one. Red is for « Critique » (and errors) only; « Exploitée » is
 * neutral and inverted, never red.
 */
import { IconTriangle } from "@/components/ui/icons";
import type { Severity, StackContext } from "@/lib/db/schema";
import { CONTEXT_LABEL, SEVERITY_LABEL } from "@/lib/stack/labels";

const BADGE = "inline-flex h-[22px] shrink-0 items-center gap-1 rounded-sm px-[7px] font-cond text-[11px] font-bold uppercase tracking-[.06em] whitespace-nowrap";

/** Classes per severity: solid for critical, soft with a border for the others. */
export const SEVERITY_BADGE: Record<Severity, string> = {
  critical: "bg-sev-critical text-sev-critical-fg border border-sev-critical",
  high: "bg-sev-high-soft text-sev-high border border-sev-high",
  medium: "bg-sev-medium-soft text-sev-medium border border-sev-medium",
  low: "bg-sev-low-soft text-sev-low border border-sev-low",
};
/** Frame and soft background of a panel tinted by severity (« Ton logiciel », home block, edit banner). */
export const SEVERITY_PANEL: Record<Severity, string> = {
  critical: "border-sev-critical bg-sev-critical-soft",
  high: "border-sev-high bg-sev-high-soft",
  medium: "border-sev-medium bg-sev-medium-soft",
  low: "border-sev-low bg-sev-low-soft",
};
export const SEVERITY_TEXT: Record<Severity, string> = { critical: "text-sev-critical", high: "text-sev-high", medium: "text-sev-medium", low: "text-sev-low" };
export const SEVERITY_BORDER: Record<Severity, string> = { critical: "border-sev-critical", high: "border-sev-high", medium: "border-sev-medium", low: "border-sev-low" };

export const formatCvss = (cvss: number | null | undefined) => (typeof cvss === "number" ? cvss.toFixed(1) : null);

/** « CRITIQUE 9.8 », or another word than the severity (« Vulnérable »). */
export function SeverityBadge({ severity, cvss, label }: { severity: Severity; cvss?: number | null; label?: string }) {
  const score = formatCvss(cvss);
  return (
    <span className={`${BADGE} ${SEVERITY_BADGE[severity]}`}>
      {label ?? SEVERITY_LABEL[severity]}
      {label && <span className="sr-only"> ({SEVERITY_LABEL[severity]})</span>}
      {score && <span className="font-mono text-[11px] font-semibold tracking-normal">{score}</span>}
    </span>
  );
}

export function ExploitedBadge({ long = false }: { long?: boolean }) {
  return (
    <span className={`${BADGE} bg-fg text-bg`}>
      <IconTriangle size={12} />
      {long ? "Exploitée activement" : "Exploitée"}
    </span>
  );
}

export function ContextTag({ context }: { context: StackContext }) {
  return (
    <span className="inline-flex h-[18px] shrink-0 items-center rounded-sm border border-line-strong px-[5px] font-cond text-[10px] font-bold tracking-[.06em] text-fg-muted uppercase">
      {CONTEXT_LABEL[context]}
    </span>
  );
}

/** Initial tile of a software (34 px). */
export function SoftwareTile({ name, className = "" }: { name: string; className?: string }) {
  return (
    <span aria-hidden className={`inline-flex size-[34px] shrink-0 items-center justify-center rounded-md bg-accent-soft font-cond text-base font-bold text-accent ${className}`}>
      {(name.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}

/** French wording of Ma stack (docs/design/3.0), pure: shared by server pages and client sheets. */
import type { IgnoreReason, Severity, StackContext } from "@/lib/db/schema";

export const SEVERITY_ORDER: readonly Severity[] = ["critical", "high", "medium", "low"];
export const SEVERITY_LABEL: Record<Severity, string> = { critical: "Critique", high: "Haute", medium: "Moyenne", low: "Basse" };
/** « 2 failles critiques », « 1 faille haute ». */
const SEVERITY_ADJ: Record<Severity, [string, string]> = {
  critical: ["critique", "critiques"],
  high: ["haute", "hautes"],
  medium: ["moyenne", "moyennes"],
  low: ["basse", "basses"],
};
export const CONTEXT_LABEL: Record<StackContext, string> = { homelab: "Homelab", work: "Travail" };
export const IGNORE_LABEL: Record<IgnoreReason, string> = {
  not_exposed: "non exposé",
  not_concerned: "pas concerné",
  backport: "corrigé par la distribution (rétroportage)",
  other: "autre",
};

export const severityRank = (s: Severity | null | undefined) => (s ? SEVERITY_ORDER.indexOf(s) : SEVERITY_ORDER.length);

/** The worst of a list (critical first); null for none. */
export function worstSeverity(list: readonly (Severity | null | undefined)[]): Severity | null {
  let worst: Severity | null = null;
  for (const s of list) if (s && severityRank(s) < severityRank(worst)) worst = s;
  return worst;
}

export const severityWord = (s: Severity, n: number) => SEVERITY_ADJ[s][n > 1 ? 1 : 0];
export const nWord = (n: number, one: string, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;

/** « 1 alerte critique · exploitée », « 3 alertes hautes ». */
export function alertsDetail(count: number, worst: Severity, exploited: boolean): string {
  return `${nWord(count, "alerte")} ${severityWord(worst, count)}${exploited ? " · exploitée" : ""}`;
}

/** Home block title: « 2 failles critiques à traiter », « 1 faille haute à traiter ». */
export function homeTitle(count: number, worst: Severity): string {
  return `${nWord(count, "faille")} ${severityWord(worst, count)} à traiter`;
}

/** « 1 haute, 2 moyennes » (grouped notification, counts by severity). */
export function severityCounts(list: readonly Severity[]): string {
  return SEVERITY_ORDER.filter((s) => list.includes(s))
    .map((s) => {
      const n = list.filter((x) => x === s).length;
      return `${n} ${severityWord(s, n)}`;
    })
    .join(", ");
}

export type VersionPreview =
  | { kind: "unrecognized" }
  | { kind: "pending" }
  | { kind: "unchecked" }
  | {
      kind: "checked";
      vulns: { ref: string; severity: Severity; cvss: number | null; exploited: boolean; fix: string | null }[];
      latest: string | null;
      updateAvailable: boolean;
      /** Open alerts of the edited item that this version fixes. */
      fixes: string[];
    };

/** The immediate check under the version field (role="status"). */
export function previewMessage(version: string, p: VersionPreview, productName: string): string {
  const v = version.trim();
  if (p.kind === "unrecognized") return "Version non reconnue : vérifie le format (chiffres, points, ex. 9.8p1 ou 8.0 U2).";
  if (p.kind === "pending") return `Première vérification de ${productName}…`;
  if (p.kind === "unchecked") return `${productName} n'a pas encore pu être vérifié : le statut apparaîtra après la prochaine vérification.`;
  const update = p.updateAvailable && p.latest ? ` Mise à jour ${p.latest} disponible.` : "";
  const fixes = p.fixes.length ? ` La ${v} corrige ${p.fixes.join(", ")} : ${p.fixes.length > 1 ? "les alertes passeront" : "l'alerte passera"} en traitée à l'enregistrement.` : "";
  if (p.vulns.length === 0) return `Aucune faille connue pour la ${v}.${update}${fixes}`;
  const worst = worstSeverity(p.vulns.map((x) => x.severity))!;
  const ofWorst = p.vulns.filter((x) => x.severity === worst);
  const exploited = ofWorst.some((x) => x.exploited) ? ` ${ofWorst.length > 1 ? "exploitées" : "exploitée"}` : "";
  const fix = ofWorst.map((x) => x.fix).find((f) => f);
  const head =
    p.vulns.length === ofWorst.length
      ? `${nWord(p.vulns.length, "faille")} ${severityWord(worst, p.vulns.length)}${exploited}`
      : `${nWord(p.vulns.length, "faille")}, dont ${ofWorst.length} ${severityWord(worst, ofWorst.length)}${exploited}`;
  return `${head} pour la ${v}.${fix ? ` Corrigé en ${fix}.` : ""}${update}${fixes}`;
}

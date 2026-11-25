/**
 * French title, summary and recommended actions of a vulnerability that has no CERT-FR advisory,
 * written by Gemini (shown with « Généré par IA »). The CVE texts (NVD, GitHub) are UNTRUSTED data,
 * with the same protections as article summaries (lib/ai/prompts.ts): rules in the system
 * instruction, data between random markers, markers stripped from the data, and an answer that must
 * be a strict JSON object of plain text (no HTML, link or URL), refused otherwise.
 */
import type { AiConfig } from "@/lib/ai/config";
import { generateContent } from "@/lib/ai/gemini";
import { newMarkerId, stripMarkers, untrustedRules } from "@/lib/ai/prompts";

const SYSTEM = `Tu es l'outil d'une application personnelle de veille de sécurité qui rédige, en français, la fiche d'une vulnérabilité pour un administrateur système.
Entrée : l'identifiant de la vulnérabilité, le produit concerné et sa description en anglais (avis NVD ou GitHub).
Réponds uniquement par un objet JSON de la forme {"titre": "...", "resume": "...", "actions": ["...", "..."]} :
- titre : une phrase nominale courte en français (60 à 110 caractères) qui dit le type de faille et le produit, sans l'identifiant CVE (ex. « Exécution de code à distance dans OpenSSH »).
- resume : 2 ou 3 phrases factuelles en français : ce que permet la faille, à quelles conditions, ce qui est touché. Reste strictement fidèle à la description : aucune information extérieure, aucune version ou date inventée, garde ses nuances.
- actions : 1 à 3 actions concrètes tirées de la description (mettre à jour vers la version corrigée qu'elle cite, contournement ou réglage qu'elle indique). Liste vide si elle n'en indique aucune.
Texte brut uniquement dans chaque valeur : jamais de HTML, de Markdown, de lien ni d'URL.`;

const AVIS_DATA = { what: "la description d'une vulnérabilité", mark: "AVIS", self: "la description" };

export type VulnSummary = { titleFr: string; summaryFr: string; actionsFr: string[] };

/** Plain text: no markup, no URL, no control character. */
const PLAIN = (s: unknown, min: number, max: number): s is string =>
  typeof s === "string" && s.trim().length >= min && s.length <= max && !/[<>]|https?:|www\.|\]\(|`/i.test(s) && !/[\u0000-\u001F]/.test(s);

/** The model's answer, or null when it is not exactly what was asked. */
export function parseVulnSummary(text: string): VulnSummary | null {
  let data: unknown;
  try {
    data = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return null;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const o = data as Record<string, unknown>;
  if (Object.keys(o).sort().join(",") !== "actions,resume,titre") return null;
  if (!PLAIN(o.titre, 10, 160) || !PLAIN(o.resume, 20, 900) || !Array.isArray(o.actions) || o.actions.length > 3) return null;
  if (!o.actions.every((a) => PLAIN(a, 5, 240))) return null;
  return { titleFr: o.titre.trim(), summaryFr: o.resume.trim(), actionsFr: (o.actions as string[]).map((a) => a.trim()) };
}

export function vulnMessage(input: { ref: string; product: string; description: string }, id: string): string {
  return `<<<AVIS ${id}>>>\nIdentifiant : ${stripMarkers(input.ref)}\nProduit : ${stripMarkers(input.product)}\n\n${stripMarkers(input.description)}\n<<<FIN AVIS ${id}>>>`;
}

export async function summarizeVuln(
  config: AiConfig,
  input: { ref: string; product: string; description: string },
  deps: { fetch?: typeof fetch } = {},
): Promise<VulnSummary | null> {
  if (input.description.trim().length < 20) return null;
  const id = newMarkerId();
  const res = await generateContent({
    apiKey: config.apiKey,
    model: config.model,
    system: `${SYSTEM}\n\n${untrustedRules(id, AVIS_DATA)}`,
    user: vulnMessage({ ...input, description: input.description.slice(0, 6000) }, id),
    maxOutputTokens: 1024,
    temperature: 0.2,
    json: true,
    fetch: deps.fetch,
  });
  return res.ok && !res.truncated ? parseVulnSummary(res.text) : null;
}

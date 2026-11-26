/**
 * Writing of « Demande à ta veille » (docs/design/3.3 § 4.3-4.4): strict rules (French, only from the extracts, a
 * [n] after each statement, say when the extracts are not enough), extracts as UNTRUSTED data between random
 * markers, then a server check: references to no extract are removed; without any valid one left, no answer is
 * shown (« Rien trouvé dans ta veille »). The result is plain text blocks, rendered by React (never HTML).
 */
import { newMarkerId, stripMarkers, untrustedRules } from "@/lib/ai/prompts";
import type { Extract } from "./retrieve";
import { NOTHING } from "./render";

export { NOTHING };

const SYSTEM = `Tu es l'assistant d'une application personnelle de veille technique. Tu réponds à la question de l'utilisateur en français, UNIQUEMENT à partir des extraits d'articles numérotés [1], [2]… fournis.
- Après chaque affirmation, mets le renvoi au numéro de l'extrait qui la soutient, entre crochets : [2], ou [1][3] s'il y en a plusieurs. Jamais d'affirmation sans renvoi.
- N'utilise aucune connaissance extérieure aux extraits : pas de date, de version, de chiffre ou de fait qu'ils ne contiennent pas. Garde leurs nuances (« selon », « pourrait »).
- Si les extraits ne permettent pas de répondre, réponds exactement « ${NOTHING} » et rien d'autre. S'ils ne répondent qu'en partie, réponds sur cette partie et dis clairement ce qui manque.
- Réponse courte et directe : 2 à 6 phrases, ou une courte liste de puces « - » si la question appelle une énumération. Texte brut : pas de titre, de Markdown, de HTML, de lien ni d'URL.`;

const DATA = { what: "des extraits d'articles web numérotés", mark: "EXTRAITS", self: "les extraits" };

export function askSystem(id: string): string {
  return `${SYSTEM}\n\n${untrustedRules(id, DATA)}`;
}

const clean = (s: string) => stripMarkers(s).replace(/<<<|>>>/g, "");

/** The user message: the numbered extracts between the markers, then the question (the user's own words). */
export function askMessage(question: string, extracts: Extract[], id: string, now = new Date()): string {
  const day = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", dateStyle: "long" });
  const list = extracts
    .map((e) => `[${e.n}] ${clean(e.title)} (${e.sources.map(clean).join(", ")}, ${day.format(e.at)})\n${clean(e.text)}`)
    .join("\n\n");
  return `<<<EXTRAITS ${id}>>>\n${list}\n<<<FIN EXTRAITS ${id}>>>\n\nAujourd'hui : ${day.format(now)}.\nQuestion : ${clean(question)}`;
}

export const newAskMarker = newMarkerId;

export { answerAsText, checkAnswer, type AnswerBlock, type AnswerPart, type CheckedAnswer } from "./render";

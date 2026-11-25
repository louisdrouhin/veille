/**
 * One field to search and to ask (docs/design/3.3 § 5): what Enter does, and the other action (second line,
 * Ctrl+Enter). Nothing is ever sent to the model without one of these explicit gestures.
 * Shared by the client (field) and the server (results page): no import with side effects.
 */
import { fold } from "./fold";

export type Intent = "search" | "ask";

const QUESTION_START =
  /^(qu['’]est[- ]ce|quel(le)?s?\b|comment\b|pourquoi\b|quand\b|combien\b|est[- ]ce\b|resume\b|résume\b|quoi de neuf\b|que\b|qui\b|ou\b|où\b|y a[- ]t[- ]il\b|what\b|how\b|why\b|when\b|which\b|who\b|is there\b|are there\b|summari[sz]e\b)/;

/** What Enter does with this text. */
export function defaultIntent(q: string): Intent {
  const t = q.trim();
  if (!t) return "search";
  if (/^".*"$/.test(t)) return "search"; // between quotes: exact search
  if (t.endsWith("?")) return "ask";
  return QUESTION_START.test(fold(t)) || QUESTION_START.test(t.toLowerCase()) ? "ask" : "search";
}

export const otherIntent = (i: Intent): Intent => (i === "ask" ? "search" : "ask");

/** The words to search for a question (« Rechercher ces mots »): without the final question mark. */
export const searchWords = (q: string) => q.trim().replace(/\s*\?+$/, "");

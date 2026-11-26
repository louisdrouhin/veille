/**
 * « À la une » rule (docs/design/3.3 § 2, 3.4 § 1), shared by the home page and the briefing (bundled by the worker:
 * no server-only import). Sources are counted as shown: the topic's own, then its reprises, each name once — a
 * reprise by the topic's own source (same site published twice, duplicate feed) does not make a second source.
 */
export const FEATURED_MIN_SOURCES = 2;

export const distinctSources = (own: string | null, authors: readonly string[]) => [...new Set([own ?? "Source supprimée", ...authors])];

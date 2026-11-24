/** Pure helpers for the mobile « Remonter en haut » button (tested in tests/scroll-top.test.ts). */

/** Box of an element in viewport coordinates (getBoundingClientRect). */
export type Box = { top: number; bottom: number };

/**
 * Shown once the page is scrolled by about one screen, and never while the note form is on
 * screen (it would sit over its textarea or its « Poster » button).
 */
export function showScrollTop(s: { scrollY: number; viewportHeight: number; noteForm: Box | null }): boolean {
  if (s.viewportHeight <= 0 || s.scrollY < s.viewportHeight) return false;
  const form = s.noteForm;
  return !(form && form.top < s.viewportHeight && form.bottom > 0);
}

/** Smooth scroll, unless the user asked for reduced motion. */
export function scrollTopBehavior(reducedMotion: boolean): ScrollBehavior {
  return reducedMotion ? "auto" : "smooth";
}

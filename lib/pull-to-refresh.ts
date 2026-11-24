/**
 * Pull to refresh for the installed app (iOS disables its own in standalone PWAs).
 * Pure logic, used by components/layout/pull-to-refresh.tsx.
 */

/** Indicator distance (px) past which releasing refreshes. */
export const PULL_THRESHOLD = 70;
/** The indicator never goes further than this. */
export const PULL_MAX = 110;
/** Finger travel before deciding between a pull and a horizontal swipe. */
export const PULL_SLOP = 8;

/** Finger travel → indicator distance: 1:2 at first, then slower and capped (resists like a spring). */
export function pullDistance(dy: number): number {
  if (dy <= 0) return 0;
  const half = dy / 2;
  if (half <= PULL_THRESHOLD) return half;
  return Math.min(PULL_MAX, PULL_THRESHOLD + (half - PULL_THRESHOLD) / 3);
}

export function shouldRefresh(distance: number): boolean {
  return distance >= PULL_THRESHOLD;
}

/** Progress 0 → 1 up to the threshold (indicator opacity and rotation). */
export function pullProgress(distance: number): number {
  return Math.min(1, Math.max(0, distance / PULL_THRESHOLD));
}

export type PullContext = {
  standalone: boolean;
  scrollY: number;
  touches: number;
  /** A text field, select or contenteditable has the focus (typing, keyboard open). */
  typing: boolean;
  /** The mobile menu or another disclosure is open, or a dialog. */
  overlayOpen: boolean;
};

/** Whether a touch may start a pull: installed app, page at the very top, one finger, nothing else going on. */
export function canStartPull(c: PullContext): boolean {
  return c.standalone && c.scrollY <= 0 && c.touches === 1 && !c.typing && !c.overlayOpen;
}

/** After PULL_SLOP: a pull only if the finger moved down more than sideways; null = not decided yet. */
export function classifyGesture(dx: number, dy: number): "pull" | "other" | null {
  if (Math.abs(dx) < PULL_SLOP && Math.abs(dy) < PULL_SLOP) return null;
  return dy > 0 && dy > Math.abs(dx) ? "pull" : "other";
}

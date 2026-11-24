import "server-only";

/**
 * Per-user limit on Gemini calls (cached answers are free). The free tier is per project and its
 * per-model numbers are only shown in AI Studio, so stay well below: 6 per minute, 60 per day.
 * In memory: a single app instance (same as Better Auth's own rate limiting).
 */
export const AI_LIMITS = [
  { windowMs: 60_000, max: 6 },
  { windowMs: 24 * 3_600_000, max: 60 },
] as const;

const calls = new Map<string, number[]>();

/** Records a call if allowed; otherwise returns how long to wait (seconds). */
export function takeAiCall(userId: string, now = Date.now()): { ok: true } | { ok: false; retryAfterSec: number } {
  const longest = Math.max(...AI_LIMITS.map((l) => l.windowMs));
  const history = (calls.get(userId) ?? []).filter((t) => now - t < longest);
  for (const { windowMs, max } of AI_LIMITS) {
    const inWindow = history.filter((t) => now - t < windowMs);
    if (inWindow.length >= max) {
      calls.set(userId, history);
      return { ok: false, retryAfterSec: Math.max(1, Math.ceil((inWindow[0]! + windowMs - now) / 1000)) };
    }
  }
  history.push(now);
  calls.set(userId, history);
  return { ok: true };
}

/** Test helper. */
export function resetAiCalls() {
  calls.clear();
}

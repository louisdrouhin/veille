/**
 * « Tester la clé »: the smallest call that proves a key works, without spending quota on content.
 * - Gemini: the description of each chosen model (GET models/{model}): key and models checked;
 * - NVD: one known CVE (cveId=CVE-2021-44228) with the key in the apiKey header.
 * The messages never contain the key, nor anything of the answer beyond its status.
 */
import { GEMINI_API } from "@/lib/ai/gemini";
import { NVD_API } from "@/lib/stack/sources/nvd";

export type KeyTest = { ok: boolean; message: string };
type Deps = { fetch?: typeof fetch; timeoutMs?: number };

async function get(url: string, headers: Record<string, string>, deps: Deps): Promise<number | "timeout" | "network"> {
  try {
    const res = await (deps.fetch ?? fetch)(url, {
      headers: { accept: "application/json", ...headers },
      signal: AbortSignal.timeout(deps.timeoutMs ?? 10_000),
      redirect: "error",
      cache: "no-store",
    });
    await res.body?.cancel().catch(() => {});
    return res.status;
  } catch (err) {
    const name = (err as Error)?.name;
    return name === "TimeoutError" || name === "AbortError" ? "timeout" : "network";
  }
}

export async function testGeminiKey(apiKey: string, models: string[], deps: Deps = {}): Promise<KeyTest> {
  for (const model of [...new Set(models)]) {
    const s = await get(`${GEMINI_API}/models/${encodeURIComponent(model)}`, { "x-goog-api-key": apiKey }, deps);
    if (s === 200) continue;
    if (s === "timeout") return { ok: false, message: "Google n'a pas répondu à temps : réessaie." };
    if (s === "network") return { ok: false, message: "Google injoignable depuis le serveur." };
    if (s === 400 || s === 401 || s === 403) return { ok: false, message: "Clé refusée par Google." };
    if (s === 404) return { ok: false, message: `Clé acceptée, mais modèle introuvable : ${model}.` };
    if (s === 429) return { ok: true, message: "Clé valide, quota atteint pour l'instant." };
    return { ok: false, message: `Google indisponible (HTTP ${s}) : réessaie plus tard.` };
  }
  return { ok: true, message: "Clé acceptée, modèles disponibles." };
}

export async function testNvdKey(apiKey: string, deps: Deps = {}): Promise<KeyTest> {
  const s = await get(`${NVD_API}/cves/2.0?cveId=CVE-2021-44228`, { apiKey }, deps);
  if (s === 200) return { ok: true, message: "Clé acceptée par NVD." };
  if (s === "timeout") return { ok: false, message: "NVD n'a pas répondu à temps : réessaie." };
  if (s === "network") return { ok: false, message: "NVD injoignable depuis le serveur." };
  // An unknown or revoked key: 404 (with a « message: Invalid apiKey » header) or 403.
  if (s === 403 || s === 404) return { ok: false, message: "Clé refusée par NVD." };
  if (s === 429) return { ok: false, message: "NVD limite les appels : réessaie dans 30 s." };
  return { ok: false, message: `NVD indisponible (HTTP ${s}) : réessaie plus tard.` };
}

/** « Tester la clé »: 5 per minute and 30 per day per user (in memory, single app instance). */
export const TEST_LIMITS = [
  { windowMs: 60_000, max: 5 },
  { windowMs: 24 * 3_600_000, max: 30 },
] as const;
const tests = new Map<string, number[]>();

export function takeKeyTest(userId: string, now = Date.now()): { ok: true } | { ok: false; retryAfterSec: number } {
  const longest = Math.max(...TEST_LIMITS.map((l) => l.windowMs));
  const history = (tests.get(userId) ?? []).filter((t) => now - t < longest);
  for (const { windowMs, max } of TEST_LIMITS) {
    const inWindow = history.filter((t) => now - t < windowMs);
    if (inWindow.length >= max) {
      tests.set(userId, history);
      return { ok: false, retryAfterSec: Math.max(1, Math.ceil((inWindow[0]! + windowMs - now) / 1000)) };
    }
  }
  history.push(now);
  tests.set(userId, history);
  return { ok: true };
}

/** Test helper. */
export function resetKeyTests() {
  tests.clear();
}

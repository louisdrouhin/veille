/**
 * Feed fetching worker: every FETCH_INTERVAL_MINUTES (default 15), fetches
 * every enabled, non-paused source. Runs as its own process / container.
 * Then, every STACK_CHECK_INTERVAL_MINUTES (default 30), the Ma stack check (lib/stack/sync.ts), and
 * at every cycle its push notifications (lib/push/notify.ts).
 *
 *   node dist/worker.js          loop forever
 *   node dist/worker.js --once   run a single cycle and exit (exit code 1 if the cycle crashed)
 */
import { aiConfig } from "@/lib/ai/config";
import { closeDb, getDb } from "@/lib/db";
import { dispatchNotifications } from "@/lib/push/notify";
import { vapidConfig } from "@/lib/push/config";
import { checkIfDue, CHECK_INTERVAL_MIN } from "@/lib/stack/sync";
import { recordCycle } from "@/lib/worker/heartbeat";
import { runCycle } from "@/lib/worker/run-cycle";

const once = process.argv.includes("--once") || process.env.WORKER_ONCE === "1";
const intervalMinutes = Number(process.env.FETCH_INTERVAL_MINUTES ?? 15);
if (!Number.isFinite(intervalMinutes) || intervalMinutes < 1) {
  console.error("FETCH_INTERVAL_MINUTES doit être un nombre ≥ 1");
  process.exit(1);
}
const concurrency = Math.max(1, Number(process.env.FETCH_CONCURRENCY ?? 4));
const stackInterval = Math.max(5, Number(process.env.STACK_CHECK_INTERVAL_MINUTES) || CHECK_INTERVAL_MIN);

let stopping = false;
let wake: (() => void) | undefined;

const log = (...args: unknown[]) => console.log(new Date().toISOString(), ...args);

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    wake = () => {
      clearTimeout(timer);
      resolve();
    };
  });
}

async function cycle(): Promise<boolean> {
  const startedAt = new Date();
  try {
    const stats = await runCycle(getDb(), { concurrency, log, shouldStop: () => stopping });
    log(`Cycle terminé : ${stats.inserted} topic(s), ${stats.notModified} inchangée(s), ${stats.failed} en erreur`);
    await stackCheck();
    // Heartbeat read by /api/health (503 after 3 intervals without a completed cycle).
    await recordCycle(getDb(), { startedAt, finishedAt: new Date(), intervalMinutes });
    return true;
  } catch (err) {
    log("Cycle en échec :", err);
    return false;
  }
}

/** Ma stack: its own failures never stop the feeds. Logged without any detail of the stack. */
async function stackCheck() {
  if (stopping) return;
  try {
    await checkIfDue(getDb(), { env: process.env, ai: aiConfig(), log }, stackInterval);
    // Every cycle, not only after a check: alerts held during quiet hours go out at their end.
    await dispatchNotifications(getDb(), { vapid: vapidConfig(), log });
  } catch (err) {
    log(`[stack] Vérification en échec : ${(err as Error)?.name ?? "erreur"}`);
  }
}

async function main() {
  log(`Worker démarré (${once ? "un seul cycle" : `intervalle : ${intervalMinutes} min`}, parallélisme : ${concurrency})`);
  if (once) {
    const ok = await cycle();
    await closeDb();
    process.exitCode = ok ? 0 : 1;
    return;
  }
  while (!stopping) {
    const started = Date.now();
    await cycle();
    if (!stopping) await sleep(Math.max(0, intervalMinutes * 60_000 - (Date.now() - started)));
  }
  await closeDb();
  log("Worker arrêté");
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    log(`${signal} reçu, arrêt…`);
    stopping = true;
    wake?.();
  });
}

void main();

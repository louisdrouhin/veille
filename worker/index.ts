/**
 * Feed fetching worker: every FETCH_INTERVAL_MINUTES (default 15), fetches
 * every enabled, non-paused source. Runs as its own process / container.
 *
 *   node dist/worker.js          loop forever
 *   node dist/worker.js --once   run a single cycle and exit (exit code 1 if the cycle crashed)
 */
import { closeDb, getDb } from "@/lib/db";
import { runCycle } from "@/lib/worker/run-cycle";

const once = process.argv.includes("--once") || process.env.WORKER_ONCE === "1";
const intervalMinutes = Number(process.env.FETCH_INTERVAL_MINUTES ?? 15);
if (!Number.isFinite(intervalMinutes) || intervalMinutes < 1) {
  console.error("FETCH_INTERVAL_MINUTES doit être un nombre ≥ 1");
  process.exit(1);
}
const concurrency = Math.max(1, Number(process.env.FETCH_CONCURRENCY ?? 4));

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
  try {
    const stats = await runCycle(getDb(), { concurrency, log, shouldStop: () => stopping });
    log(`Cycle terminé : ${stats.inserted} topic(s), ${stats.notModified} inchangée(s), ${stats.failed} en erreur`);
    return true;
  } catch (err) {
    log("Cycle en échec :", err);
    return false;
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

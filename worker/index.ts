/**
 * Feed fetching worker: every FETCH_INTERVAL_MINUTES (default 15), fetches
 * every enabled, non-paused source. Runs as its own process / container.
 */
import { closeDb, getDb } from "@/lib/db";
import { fetchSource, listDueSources } from "@/lib/feeds/fetch-source";

const intervalMinutes = Number(process.env.FETCH_INTERVAL_MINUTES ?? 15);
if (!Number.isFinite(intervalMinutes) || intervalMinutes < 1) {
  console.error("FETCH_INTERVAL_MINUTES doit être un nombre ≥ 1");
  process.exit(1);
}
const concurrency = Math.max(1, Number(process.env.FETCH_CONCURRENCY ?? 4));

let stopping = false;
let wake: (() => void) | undefined;

const log = (...args: unknown[]) => console.log(new Date().toISOString(), ...args);

async function runOnce() {
  const db = getDb();
  const due = await listDueSources(db);
  log(`Cycle : ${due.length} source(s) à récupérer`);
  const queue = [...due];

  async function lane() {
    for (let source = queue.shift(); source && !stopping; source = queue.shift()) {
      const res = await fetchSource(db, source);
      if (res.status === "ok") log(`[${source.name}] ${res.inserted} nouveau(x) topic(s)${res.firstImport ? " (import initial, marqués lus)" : ""}`);
      else if (res.status === "not-modified") log(`[${source.name}] inchangé (304)`);
      else log(`[${source.name}] ERREUR : ${res.error}${res.paused ? " — source en pause 1 h" : ""}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, lane));
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    wake = () => {
      clearTimeout(timer);
      resolve();
    };
  });
}

async function main() {
  log(`Worker démarré (intervalle : ${intervalMinutes} min, parallélisme : ${concurrency})`);
  while (!stopping) {
    const started = Date.now();
    try {
      await runOnce();
    } catch (err) {
      log("Cycle en échec :", err);
    }
    const elapsed = Date.now() - started;
    if (!stopping) await sleep(Math.max(0, intervalMinutes * 60_000 - elapsed));
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

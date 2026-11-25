/**
 * What « tirer pour rafraîchir » and the header's « Actualiser » do besides re-rendering the page:
 * a page can register one extra job (Ma stack: a new check of the sources, at most every 5 min).
 * Module state on purpose: one page at a time, unregistered when it unmounts.
 */
type Job = () => Promise<unknown>;
let current: Job | null = null;

export function setPageRefresh(job: Job): () => void {
  current = job;
  return () => {
    if (current === job) current = null;
  };
}

/** Runs the page's job, if any; never throws (the page is refreshed anyway). */
export async function runPageRefresh(): Promise<void> {
  try {
    await current?.();
  } catch {
    // the refresh itself still happens
  }
}

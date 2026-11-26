"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { IconAlertCircle, IconCheck } from "@/components/ui/icons";

type Outcome = { ok: true } | { ok: false; error: string };
export type SaveState = { status: "idle" | "saving" | "saved" | "error"; error: string | null; retry: (() => void) | null };

/**
 * A setting applied at once (docs/design/3.5 § 4): « ✓ Enregistré » next to its label for 2 s; on failure the
 * value goes back (`rollback`) and the error shows under the control with « Réessayer ».
 */
export function useSave() {
  const [state, setState] = useState<SaveState>({ status: "idle", error: null, retry: null });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const self = useRef<((run: () => Promise<Outcome>, rollback?: () => void) => Promise<boolean>) | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const save = useCallback(async (run: () => Promise<Outcome>, rollback?: () => void): Promise<boolean> => {
    if (timer.current) clearTimeout(timer.current);
    setState({ status: "saving", error: null, retry: null });
    const res = await run().catch((): Outcome => ({ ok: false, error: "Connexion au serveur impossible." }));
    if (res.ok) {
      setState({ status: "saved", error: null, retry: null });
      timer.current = setTimeout(() => setState((s) => (s.status === "saved" ? { ...s, status: "idle" } : s)), 2_000);
    } else {
      rollback?.();
      setState({ status: "error", error: res.error, retry: () => void self.current?.(run, rollback) });
    }
    return res.ok;
  }, []);
  useEffect(() => {
    self.current = save;
  }, [save]);
  return { state, save };
}

/** « ✓ Enregistré » in --ok next to the label, announced once, then faded. */
export function SavedHint({ state }: { state: SaveState }) {
  return (
    <span role="status" className={`inline-flex items-center gap-1 text-sm font-semibold text-ok transition-opacity duration-500 motion-reduce:transition-none ${state.status === "saved" ? "opacity-100" : "opacity-0"}`}>
      {state.status === "saved" && (
        <>
          <IconCheck size={14} /> Enregistré
        </>
      )}
    </span>
  );
}

/** The failure under the control, with « Réessayer ». */
export function SaveError({ state }: { state: SaveState }) {
  if (state.status !== "error" || !state.error) return null;
  return (
    <p role="alert" className="flex flex-wrap items-center gap-2 text-sm text-err">
      <IconAlertCircle size={16} className="shrink-0" />
      {state.error}
      {state.retry && (
        <button type="button" onClick={state.retry} className="cursor-pointer font-semibold underline max-md:min-h-11">
          Réessayer
        </button>
      )}
    </p>
  );
}

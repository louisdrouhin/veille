"use client";

import type { ToastData } from "./toast";

/**
 * Toasts raised in the browser (no server redirect), e.g. « Retiré de Homelab · Annuler ».
 * Shown by <Toaster/> in its usual stack, so they never overlap « Remonter en haut ».
 */
/** `durationMs`: how long a success stays (5 s by default; errors stay until dismissed). */
export type ClientToast = ToastData & { action?: { label: string; onClick: () => void }; durationMs?: number };

const listeners = new Set<(toast: ClientToast) => void>();

export function showToast(toast: ClientToast): void {
  listeners.forEach((l) => l(toast));
}

export function onToast(listener: (toast: ClientToast) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

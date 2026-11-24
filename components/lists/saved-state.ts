"use client";

import { useSyncExternalStore } from "react";
import type { PickerList } from "@/lib/lists/queries";

/**
 * What this visit changed in the lists, per topic. The topic page saves without revalidatePath
 * (it would purge the router cache and cost « ← Retour » its scroll position), so a page restored
 * from the router cache can be older than these changes: the save button and the ★ marks of
 * topic rows read this first. Same idea as components/topic/read-topics.tsx.
 */
export type SavedState = { lists: PickerList[]; selected: number[] };

const byTopic = new Map<number, SavedState>();
const listeners = new Set<() => void>();
let version = 0;

export function savedStateOf(topicId: number): SavedState | undefined {
  return byTopic.get(topicId);
}

export function rememberSavedState(topicId: number, state: SavedState): void {
  byTopic.set(topicId, state);
  version++;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Number of lists holding the topic: this visit's change if any, else the server's count. */
export function useSavedCount(topicId: number, serverCount: number): number {
  useSyncExternalStore(subscribe, () => version, () => 0);
  return byTopic.get(topicId)?.selected.length ?? serverCount;
}

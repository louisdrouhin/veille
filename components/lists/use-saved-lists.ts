"use client";

import { useOptimistic, useState, useTransition } from "react";
import { createList, toggleTopicInList } from "@/lib/actions/lists";
import type { PickerList } from "@/lib/lists/queries";
import type { PickerStatus } from "./list-picker-content";
import { rememberSavedState, savedStateOf, type SavedState } from "./saved-state";

type Change = { type: "toggle"; listId: number; on: boolean } | { type: "create"; list: PickerList };

function apply(state: SavedState, change: Change): SavedState {
  if (change.type === "create") {
    return { lists: [...state.lists, change.list], selected: [...state.selected, change.list.id] };
  }
  const has = state.selected.includes(change.listId);
  if (has === change.on) return state;
  return {
    lists: state.lists.map((l) => (l.id === change.listId ? { ...l, count: Math.max(0, l.count + (change.on ? 1 : -1)) } : l)),
    selected: change.on ? [...state.selected, change.listId] : state.selected.filter((id) => id !== change.listId),
  };
}

/**
 * The lists of a topic and the changes made to them: the ★ of the topic page (sheet and popover)
 * and the « Enregistrer dans une liste » submenu of a topic row. Every change shows at once
 * (useOptimistic), is remembered for this visit (saved-state.ts: ★ of the rows), and goes back
 * if the action fails; `onResult` reports it (status line, or toast).
 */
export function useSavedLists(topicId: number, initial: SavedState, onResult: (status: NonNullable<PickerStatus>) => void) {
  // A page restored from the router cache may predate this visit's changes (see saved-state.ts).
  const [committed, setCommitted] = useState<SavedState>(() => savedStateOf(topicId) ?? initial);
  const [state, addOptimistic] = useOptimistic(committed, apply);
  const [, startTransition] = useTransition();

  // Functional update: two quick changes in a row each build on the latest committed state.
  function commit(change: Change) {
    setCommitted((prev) => {
      const next = apply(prev, change);
      rememberSavedState(topicId, next);
      return next;
    });
  }

  function toggle(list: PickerList, on: boolean) {
    startTransition(async () => {
      addOptimistic({ type: "toggle", listId: list.id, on });
      const res = await toggleTopicInList(topicId, list.id, on);
      if (res.ok) {
        commit({ type: "toggle", listId: list.id, on });
        onResult({ kind: "ok", text: on ? `Ajouté à « ${list.name} »` : `Retiré de « ${list.name} »` });
      } else {
        onResult({ kind: "error", text: res.error });
      }
    });
  }

  function create(name: string) {
    const temp: PickerList = { id: -Date.now(), name, color: "slate", count: 1 };
    startTransition(async () => {
      addOptimistic({ type: "create", list: temp });
      const res = await createList({ name, topicId });
      if (res.ok) {
        commit({ type: "create", list: { ...res.list, count: 1 } });
        onResult({ kind: "ok", text: `Ajouté à « ${res.list.name} »` });
      } else {
        onResult({ kind: "error", text: res.error });
      }
    });
  }

  return { state, toggle, create };
}

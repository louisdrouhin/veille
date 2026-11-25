"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

/**
 * Read state changed during this visit, shared by every page under the protected layout.
 * - A topic opened (MarkTopicRead): the back button restores the forum list from the router cache,
 *   rendered while it was still unread; rows look it up to show it read at once.
 * - « Marquer comme lu / non lu » of the context menu (docs/design/3.2): applied at once, without
 *   revalidatePath nor router.refresh (they would purge the router cache: page and scroll lost).
 *   Each change is also kept with the server time it was saved at, so that the unread counters
 *   rendered before it (header, forum, home) add it, and those rendered after it do not.
 */
export type ReadChange = { key: number; id: number; forumSlug?: string; read: boolean; at: number };

type ReadTopics = {
  /** This visit's state of the topic, if it changed (else the row's own). */
  readOf: (id: number) => boolean | undefined;
  /** Kept for the topic page: opened = read. */
  isRead: (id: number) => boolean;
  markRead: (id: number) => void;
  /** Shows the change at once; returns a handle to confirm it (server time) or roll it back. */
  setRead: (id: number, read: boolean, from: boolean, forumSlug?: string) => { confirm: (at: number) => void; rollback: () => void };
  /** What to add to an unread counter rendered at `renderedAt` (server ms), for one forum or all. */
  unreadDelta: (renderedAt: number, forumSlug?: string) => number;
};

const ReadTopicsContext = createContext<ReadTopics>({
  readOf: () => undefined,
  isRead: () => false,
  markRead: () => {},
  setRead: () => ({ confirm: () => {}, rollback: () => {} }),
  unreadDelta: () => 0,
});

let seq = 0;

/** Changes saved after the counter was rendered (or still pending), of this forum or all: −1 read, +1 unread. */
export function unreadDelta(changes: readonly ReadChange[], renderedAt: number, forumSlug?: string): number {
  return changes.reduce((n, c) => (c.at > renderedAt && (!forumSlug || c.forumSlug === forumSlug) ? n + (c.read ? -1 : 1) : n), 0);
}

export function ReadTopicsProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{ byId: ReadonlyMap<number, boolean>; changes: readonly ReadChange[] }>(() => ({ byId: new Map(), changes: [] }));

  const markRead = useCallback((id: number) => {
    setState((prev) => {
      if (prev.byId.get(id) === true) return prev;
      // Opened after « Marquer comme non lu » in this visit: back to read, that change cancels out.
      const changes = prev.byId.get(id) === false ? prev.changes.filter((c) => c.id !== id) : prev.changes;
      return { byId: new Map(prev.byId).set(id, true), changes };
    });
  }, []);

  const setRead = useCallback((id: number, read: boolean, from: boolean, forumSlug?: string) => {
    const key = ++seq;
    setState((prev) => ({
      byId: new Map(prev.byId).set(id, read),
      // Pending (at = Infinity): every counter on screen was rendered before it.
      changes: from === read ? prev.changes : [...prev.changes, { key, id, forumSlug, read, at: Number.POSITIVE_INFINITY }],
    }));
    return {
      confirm: (at: number) => setState((prev) => ({ ...prev, changes: prev.changes.map((c) => (c.key === key ? { ...c, at } : c)) })),
      rollback: () =>
        setState((prev) => ({
          byId: new Map(prev.byId).set(id, from),
          changes: prev.changes.filter((c) => c.key !== key),
        })),
    };
  }, []);

  const value = useMemo<ReadTopics>(
    () => ({
      readOf: (id) => state.byId.get(id),
      isRead: (id) => state.byId.get(id) === true,
      markRead,
      setRead,
      unreadDelta: (renderedAt, forumSlug) => unreadDelta(state.changes, renderedAt, forumSlug),
    }),
    [state, markRead, setRead],
  );
  return <ReadTopicsContext value={value}>{children}</ReadTopicsContext>;
}

export function useReadTopics(): ReadTopics {
  return useContext(ReadTopicsContext);
}

/** An unread counter rendered by the server at `renderedAt`, with this visit's changes. */
export function useUnreadCount(base: number, renderedAt: number | undefined, forumSlug?: string): number {
  const { unreadDelta } = useReadTopics();
  return renderedAt === undefined ? base : Math.max(0, base + unreadDelta(renderedAt, forumSlug));
}

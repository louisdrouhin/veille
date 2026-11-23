"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

/**
 * Topics read during this visit, shared by every page under the protected layout.
 * The back button restores the forum list from the router cache, rendered while the
 * topic was still unread: rows look this set up to show it read at once, without
 * waiting for the network. (Read state only goes one way: nothing ever un-reads.)
 */
type ReadTopics = { isRead: (id: number) => boolean; markRead: (id: number) => void };

const ReadTopicsContext = createContext<ReadTopics>({ isRead: () => false, markRead: () => {} });

export function ReadTopicsProvider({ children }: { children: React.ReactNode }) {
  const [ids, setIds] = useState<ReadonlySet<number>>(() => new Set());
  const markRead = useCallback((id: number) => {
    setIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }, []);
  const value = useMemo(() => ({ isRead: (id: number) => ids.has(id), markRead }), [ids, markRead]);
  return <ReadTopicsContext value={value}>{children}</ReadTopicsContext>;
}

export function useReadTopics(): ReadTopics {
  return useContext(ReadTopicsContext);
}

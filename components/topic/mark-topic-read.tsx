"use client";

import { useEffect } from "react";
import { useReadTopics } from "@/components/topic/read-topics";

/**
 * Mounted by the topic page: records the topic as read in the shared client state, so
 * that the forum list restored by « ← Retour » shows it greyed out at once. The database
 * is updated by the page itself while rendering (works without JavaScript).
 *
 * Deliberately no Server Action with revalidatePath here: in Next 16 a revalidation
 * from a Server Function purges the whole client router cache, and the back button
 * would then refetch the list (loading skeleton) and lose its scroll position.
 * The list resyncs through BackForwardRefresh instead. Renders nothing.
 */
export function MarkTopicRead({ topicId }: { topicId: number }) {
  const { markRead } = useReadTopics();
  useEffect(() => {
    markRead(topicId);
  }, [topicId, markRead]);
  return null;
}

import { TopicListSkeleton } from "@/components/topic/topic-list-skeleton";

export default function Loading() {
  return (
    <>
      <div className="mb-3 h-4 w-40 animate-pulse-soft rounded-sm bg-off-soft motion-reduce:animate-none" />
      <div className="mb-1 h-7 w-56 animate-pulse-soft rounded-sm bg-off-soft motion-reduce:animate-none" />
      <div className="mb-5 h-4 w-32 animate-pulse-soft rounded-sm bg-off-soft motion-reduce:animate-none" />
      <TopicListSkeleton />
    </>
  );
}

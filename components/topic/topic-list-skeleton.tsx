import { TOPIC_ROW, TopicListHead } from "./topic-list";

const WIDTHS = [72, 55, 80, 48, 66, 75, 52, 61, 45, 70];
const BLOCK = "rounded-sm bg-off-soft animate-pulse-soft motion-reduce:animate-none";

export function TopicListSkeleton({ rows = 10 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label="Chargement des topics" className="overflow-hidden rounded-md border border-line bg-surface shadow-sm">
      <TopicListHead />
      <ul>
        {WIDTHS.slice(0, rows).map((w, i) => (
          <li key={i} className={`${TOPIC_ROW} md:h-[38px]`}>
            <span className={`${BLOCK} size-5`} />
            <span className={`${BLOCK} h-3.5`} style={{ width: `${w}%` }} />
            <span className={`${BLOCK} hidden h-3 w-28 md:block`} />
            <span className={`${BLOCK} hidden h-3 w-5 justify-self-end md:block`} />
            <span className={`${BLOCK} hidden h-3 w-16 justify-self-end md:block`} />
          </li>
        ))}
      </ul>
    </div>
  );
}

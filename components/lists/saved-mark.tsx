import { Star } from "./star";

/** ★ in topic rows (docs/design/v3 § 3.8): the topic is saved in at least one list. */
export function SavedMark({ count, className = "" }: { count: number; className?: string }) {
  if (count <= 0) return null;
  const label = `Enregistré dans ${count} liste${count > 1 ? "s" : ""}`;
  return (
    <span role="img" aria-label={label} title={label} className={`inline-flex shrink-0 ${className}`}>
      <Star filled size={13} />
    </span>
  );
}

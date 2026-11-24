import Link from "next/link";
import { SavedMark } from "@/components/lists/saved-mark";
import { FolderIcon } from "@/components/topic/folder-icon";
import { SourceAvatar } from "@/components/ui/source-avatar";
import type { FeaturedTopic } from "@/lib/home";

/** « À la une »: rendered only when FEATURED_ENABLED and there is something to show (docs/design/v2 § 2.1). */
export function FeaturedSection({ items }: { items: FeaturedTopic[] }) {
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="featured-title" className="flex flex-col gap-2">
      <h2 id="featured-title" className="font-cond text-sm font-bold tracking-caps text-hot uppercase">
        À la une
      </h2>
      <ul className="grid gap-2 md:grid-cols-3">
        {items.map((t) => (
          <FeaturedCard key={t.id} topic={t} />
        ))}
      </ul>
    </section>
  );
}

export function FeaturedCard({ topic }: { topic: FeaturedTopic }) {
  return (
    <li className="relative flex gap-2.5 rounded-md border border-hot bg-surface p-3 hover:bg-surface-hover has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-focus">
      <FolderIcon state="hot" size={20} />
      <div className="flex min-w-0 flex-col gap-1.5">
        <Link
          href={`/t/${topic.id}`}
          prefetch={false}
          className="text-base font-bold text-fg no-underline after:absolute after:inset-0 hover:text-fg focus-visible:outline-none md:text-md"
        >
          {topic.title}
        </Link>
        <SavedMark count={topic.savedCount} className="self-start" />
        <div className="flex items-center gap-2 text-sm">
          <span className="flex" aria-hidden>
            {topic.sourceNames.slice(0, 4).map((name) => (
              <SourceAvatar key={name} name={name} size={18} shape="round" className="-ml-1.5 border border-surface first:ml-0" />
            ))}
          </span>
          <span className="font-bold text-hot">Repris par {topic.sourceNames.length} sources</span>
        </div>
      </div>
    </li>
  );
}

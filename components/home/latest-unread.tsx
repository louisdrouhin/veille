import { TableHead } from "@/components/ui/table-head";
import { IconCheckDouble } from "@/components/ui/icons";
import { TOPIC_GRID_WITH_FORUM, type TopicRowData } from "@/components/topic/topic-grid";
import { LatestUnreadList } from "./latest-unread-list";

/** « Derniers non lus »: the newest unread topics of every forum, or « Tout est lu ». */
export function LatestUnread({ topics }: { topics: TopicRowData[] }) {
  return (
    <section aria-labelledby="latest-unread-title" className="overflow-hidden rounded-md border border-line bg-surface shadow-sm">
      <div className="flex min-h-10 items-center bg-bar-2 px-3.5 py-1.5 md:px-4">
        <h2 id="latest-unread-title" className="font-cond text-sm font-semibold tracking-caps text-bar-fg uppercase">
          Derniers non lus
        </h2>
      </div>
      {topics.length > 0 ? (
        <>
          <TableHead
            grid={TOPIC_GRID_WITH_FORUM}
            className="border-t border-white/10"
            columns={[
              { label: "" },
              { label: "Sujet" },
              { label: "Forum" },
              { label: "Source" },
              { label: "Nb", align: "right" },
              { label: "Dernier msg", align: "right" },
              { label: "", className: "hidden desk:block" },
            ]}
          />
          <LatestUnreadList topics={topics} />
        </>
      ) : (
        <div className="flex items-center gap-3 px-3.5 py-4 md:px-4">
          <span aria-hidden className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-ok-soft text-ok">
            <IconCheckDouble size={18} />
          </span>
          <div>
            <p className="text-[15px] font-bold">Tout est lu</p>
            <p className="text-sm text-fg-muted">Les nouveaux articles apparaîtront ici à la prochaine récupération.</p>
          </div>
        </div>
      )}
    </section>
  );
}

import { TableHead } from "@/components/ui/table-head";
import { TOPIC_GRID, type TopicRowData } from "./topic-grid";
import { TopicRow } from "./topic-row";

export { TOPIC_GRID, TOPIC_ROW, type TopicRowData } from "./topic-grid";

export function TopicListHead() {
  return (
    <TableHead
      grid={TOPIC_GRID}
      columns={[{ label: "" }, { label: "Sujet" }, { label: "Source" }, { label: "Nb", align: "right" }, { label: "Dernier msg", align: "right" }]}
    />
  );
}

export function TopicList({ topics }: { topics: TopicRowData[] }) {
  return (
    <div className="overflow-hidden rounded-md border border-line bg-surface shadow-sm">
      <TopicListHead />
      <ul>
        {topics.map((t) => (
          <TopicRow key={t.id} topic={t} />
        ))}
      </ul>
    </div>
  );
}

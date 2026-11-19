import { count, eq, max, sql } from "drizzle-orm";
import Link from "next/link";
import { FolderIcon } from "@/components/folder-icon";
import { getDb } from "@/lib/db";
import { forums, topics } from "@/lib/db/schema";
import { formatCompact } from "@/lib/format";
import { requireSession } from "@/lib/session";

export default async function HomePage() {
  await requireSession();
  const rows = await getDb()
    .select({
      id: forums.id,
      name: forums.name,
      slug: forums.slug,
      total: count(topics.id),
      unread: sql<number>`count(${topics.id}) filter (where ${topics.readAt} is null)`.mapWith(Number),
      lastActivity: max(topics.lastActivityAt),
    })
    .from(forums)
    .leftJoin(topics, eq(topics.forumId, forums.id))
    .groupBy(forums.id)
    .orderBy(forums.position, forums.name);

  if (rows.length === 0) {
    return (
      <p className="panel p-4">
        Aucun forum pour l&apos;instant. Commence par en créer un dans l&apos;<Link href="/admin">administration</Link>.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="forum-table">
        <thead>
          <tr>
            <th className="w-8" aria-label="État" />
            <th>Forum</th>
            <th className="w-20 text-right">Sujets</th>
            <th className="w-20 text-right">Non lus</th>
            <th className="w-40">Dernier msg</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((f) => (
            <tr key={f.id}>
              <td className="text-center">
                <FolderIcon state={f.unread > 0 ? "unread" : "read"} />
              </td>
              <td>
                <Link href={`/f/${f.slug}`} className={f.unread > 0 ? "font-bold" : ""}>
                  {f.name}
                </Link>
              </td>
              <td className="text-right">{f.total}</td>
              <td className={`text-right ${f.unread > 0 ? "font-bold text-amber" : "text-read"}`}>{f.unread}</td>
              <td className="whitespace-nowrap text-[0.85rem]">{f.lastActivity ? formatCompact(f.lastActivity) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

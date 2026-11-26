import { asc } from "drizzle-orm";
import type { Metadata } from "next";
import { PageNav } from "@/components/layout/page-nav";
import { AskView } from "@/components/ask/ask-view";
import { AskHistory } from "@/components/ask/ask-history";
import { getDb } from "@/lib/db";
import { forums } from "@/lib/db/schema";
import { parseScope } from "@/lib/ask/scope";
import { history } from "@/lib/ask/store";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Demander à ta veille" };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * « Demande à ta veille » (docs/design/3.3 § 4): the URL is shareable (question and scope). The answer is only
 * written after an explicit gesture: `go=1` (Enter on « Demander », a click) — opened from a shared link or reloaded,
 * the page asks first.
 */
export default async function AskPage({ searchParams }: Props) {
  const session = await requireSession();
  const params = await searchParams;
  const q = (typeof params.q === "string" ? params.q : "").replace(/\s+/g, " ").trim().slice(0, 300);
  const scope = parseScope(q, params);
  const db = getDb();
  const [forumRows, past] = await Promise.all([
    db.select({ slug: forums.slug, name: forums.name }).from(forums).orderBy(asc(forums.position), asc(forums.name)),
    history(db, session.user.id),
  ]);
  const items = past.map((h) => ({ id: h.id, question: h.question, scope: h.scope, at: h.askedAt.toISOString() }));
  return (
    <div className="pb-[calc(env(safe-area-inset-bottom)+96px)] md:pb-0">
      <PageNav items={[{ label: "Demander à ta veille" }]} back={{ href: "/", mode: "any" }} />
      <h1 className="sr-only">Demander à ta veille</h1>
      <div className="flex gap-6">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <AskView key={`${q}|${scope.period}|${scope.forums.join(",")}`} q={q} scope={scope} go={params.go === "1"} forums={forumRows} />
          <div className="lg:hidden">
            <AskHistory items={items} />
          </div>
        </div>
        <aside aria-label="Tes questions" className="hidden w-[280px] shrink-0 lg:block">
          <AskHistory items={items} />
        </aside>
      </div>
    </div>
  );
}

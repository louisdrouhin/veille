import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageNav } from "@/components/layout/page-nav";
import { ListView } from "@/components/lists/list-view";
import { ListSwatch } from "@/components/lists/list-swatch";
import { Pagination } from "@/components/ui/pagination";
import { getDb } from "@/lib/db";
import { getList, getListExports, getListItems, getListSummaries, LIST_PAGE_SIZE } from "@/lib/lists/queries";
import { requireSession } from "@/lib/session";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Same strict format as the service worker's whitelist: a positive integer without leading zero. */
function listIdOf(raw: string): number | null {
  return /^[1-9][0-9]{0,9}$/.test(raw) ? Number(raw) : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  await requireSession();
  const id = listIdOf((await params).id);
  const list = id ? await getList(getDb(), id) : undefined;
  return { title: list?.name ?? "Liste introuvable" };
}

export default async function ListPage({ params, searchParams }: Props) {
  await requireSession();
  const id = listIdOf((await params).id);
  if (!id) notFound();
  const db = getDb();
  const [list, summaries] = await Promise.all([getList(db, id), getListSummaries(db)]);
  if (!list) notFound();

  const count = summaries.find((l) => l.id === id)?.count ?? 0;
  const pageCount = Math.max(1, Math.ceil(count / LIST_PAGE_SIZE));
  const query = await searchParams;
  const page = Number.parseInt(typeof query.page === "string" ? query.page : "1", 10);
  if (!Number.isFinite(page) || page < 1 || page > pageCount) redirect(`/listes/${id}`);
  const [items, exports] = await Promise.all([getListItems(db, id, page), getListExports(db, [id])]);
  const href = (p: number) => (p === 1 ? `/listes/${id}` : `/listes/${id}?page=${p}`);

  return (
    <>
      <PageNav items={[{ label: "Listes", href: "/listes" }, { label: list.name }]} back={{ href: "/listes", mode: "parent" }} />
      <div className="flex items-start gap-5 max-md:pb-16">
        <div className="min-w-0 flex-1">
          <ListView key={`${id}:${page}:${list.name}:${list.color}`} list={list} count={count} exportItems={exports.get(id) ?? []} items={items} />
          {pageCount > 1 && (
            <div className="mt-3 flex justify-center">
              <Pagination page={page} pageCount={pageCount} href={href} label="Pagination de la liste" />
            </div>
          )}
        </div>
        {/* Desktop: every list, the current one highlighted. */}
        <nav aria-label="Toutes les listes" className="sticky top-[calc(3.25rem+1px+env(safe-area-inset-top)+16px)] hidden w-[230px] shrink-0 md:block">
          <div className="overflow-hidden rounded-md border border-line bg-surface shadow-sm">
            <div className="flex min-h-10 items-center justify-between bg-bar-2 px-3.5">
              <h2 className="font-cond text-sm font-semibold tracking-caps text-bar-fg uppercase">Listes</h2>
              <Link href="/listes" className="text-sm text-bar-muted hover:text-bar-fg">
                Gérer
              </Link>
            </div>
            <ul className="py-1">
              {summaries.map((l) => (
                <li key={l.id}>
                  <Link
                    href={`/listes/${l.id}`}
                    aria-current={l.id === id ? "page" : undefined}
                    className="flex h-9 items-center gap-2 px-3.5 text-base text-fg no-underline hover:bg-surface-hover hover:text-fg aria-[current=page]:bg-accent-soft aria-[current=page]:font-bold"
                  >
                    <ListSwatch color={l.color} size={10} />
                    <span className="min-w-0 flex-1 truncate">{l.name}</span>
                    <span className="font-mono text-sm text-fg-muted">{l.count}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </nav>
      </div>
    </>
  );
}

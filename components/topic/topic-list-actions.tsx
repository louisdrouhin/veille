import { Pagination } from "@/components/ui/pagination";
import { SubmitButton } from "@/components/ui/submit-button";
import { markForumRead } from "@/lib/actions/topics";

/** « Tout marquer comme lu » + « Page n sur N » + pagination — rendered above and below the list. */
export function TopicListActions({
  forumId,
  page,
  pageCount,
  href,
  position,
  hasUnread,
}: {
  forumId: number;
  page: number;
  pageCount: number;
  href: (p: number) => string;
  position: "top" | "bottom";
  hasUnread: boolean;
}) {
  return (
    <div className={`flex flex-wrap items-center justify-between gap-2.5 ${position === "top" ? "mb-2.5" : "mt-2.5"}`}>
      <form action={markForumRead}>
        <input type="hidden" name="forumId" value={forumId} />
        <SubmitButton variant="secondary" disabled={!hasUnread} pendingLabel="…">
          <span className="md:hidden">Tout marquer lu</span>
          <span className="hidden md:inline">Tout marquer comme lu</span>
        </SubmitButton>
      </form>
      {pageCount > 1 && (
        <div className="flex items-center gap-3">
          <span className="hidden text-sm text-fg-muted md:inline">
            Page {page} sur {pageCount}
          </span>
          <Pagination
            page={page}
            pageCount={pageCount}
            href={href}
            label={position === "top" ? "Pagination (haut de liste)" : "Pagination (bas de liste)"}
          />
        </div>
      )}
    </div>
  );
}

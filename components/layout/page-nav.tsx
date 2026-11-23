import { BackButton } from "@/components/layout/back-button";
import { Breadcrumb } from "@/components/layout/breadcrumb";
import type { BackMode } from "@/lib/nav-history";

/** Top of every page except home: "← Retour" + breadcrumb, on one line when it fits. */
export function PageNav({
  items,
  back,
}: {
  items: { label: string; href?: string }[];
  back: { href: string; mode?: BackMode };
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
      <BackButton href={back.href} mode={back.mode} />
      <Breadcrumb items={items} className="min-w-0 flex-1" />
    </div>
  );
}

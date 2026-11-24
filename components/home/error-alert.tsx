import Link from "next/link";
import { IconAlert, IconChevronRight } from "@/components/ui/icons";

/** « N sources en erreur · Voir l'admin › », or nothing without errors. */
export function ErrorAlert({ errorCount, className = "" }: { errorCount: number; className?: string }) {
  if (errorCount === 0) return null;
  return (
    <Link
      href="/admin#sources"
      className={`flex min-h-11 items-center gap-2 rounded-md border border-err bg-err-soft px-3 text-sm text-err no-underline hover:text-err hover:underline md:min-h-9 ${className}`}
    >
      <span aria-hidden className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-err text-err-fg">
        <IconAlert size={13} strokeWidth={2} />
      </span>
      <span>
        <strong className="font-bold">
          {errorCount} source{errorCount > 1 ? "s" : ""} en erreur
        </strong>
        <span aria-hidden className="max-md:hidden"> · </span>
      </span>
      <span className="ml-auto inline-flex items-center gap-0.5 whitespace-nowrap md:ml-0">
        Voir l&apos;admin <IconChevronRight size={13} />
      </span>
    </Link>
  );
}

import { IconSpinner } from "@/components/ui/icons";

/** Loading state of Logiciels (docs/design/3.0 § 6): « Vérification de ta stack… » and 4 skeleton rows. */
export default function Loading() {
  return (
    <div className="grid gap-3" aria-busy="true">
      <div className="h-11 animate-pulse-soft rounded-md bg-surface-alt motion-reduce:animate-none md:w-60" />
      <p role="status" className="flex min-h-6 items-center gap-2 text-sm text-fg-muted">
        <IconSpinner size={14} className="animate-spin motion-reduce:animate-none" /> Vérification de ta stack…
      </p>
      <ul className="overflow-hidden rounded-md border border-line bg-surface">
        {[0, 1, 2, 3].map((i) => (
          <li key={i} className="flex min-h-[60px] items-center gap-3 border-t border-line px-3 first:border-t-0">
            <span className="size-[34px] animate-pulse-soft rounded-md bg-surface-alt motion-reduce:animate-none" />
            <span className="grid flex-1 gap-1.5">
              <span className="h-3.5 w-2/5 animate-pulse-soft rounded-sm bg-surface-alt motion-reduce:animate-none" />
              <span className="h-3 w-3/5 animate-pulse-soft rounded-sm bg-surface-alt motion-reduce:animate-none" />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

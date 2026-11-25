"use client";

/**
 * Switch (docs/design/3.0 § 5): role="switch", a 51 × 31 track in a 44 px target, named by its label
 * (aria-labelledby). `busy`: aria-busy while the change is applied.
 */
export function Switch({
  checked,
  onChange,
  labelledBy,
  describedBy,
  disabled = false,
  busy = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  labelledBy: string;
  describedBy?: string;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      aria-busy={busy || undefined}
      disabled={disabled || busy}
      onClick={() => onChange(!checked)}
      className="group inline-flex h-11 w-[59px] shrink-0 cursor-pointer items-center justify-center rounded-full disabled:cursor-not-allowed"
    >
      <span
        aria-hidden
        className={`relative inline-block h-[31px] w-[51px] rounded-full border transition-colors motion-reduce:transition-none group-disabled:opacity-50 ${
          checked ? "border-accent bg-accent" : "border-line-strong bg-off-soft"
        } ${busy ? "animate-pulse-soft motion-reduce:animate-none" : ""}`}
      >
        <span
          className={`absolute top-[2px] left-[2px] size-[25px] rounded-full bg-surface shadow-sm transition-transform motion-reduce:transition-none ${checked ? "translate-x-5" : ""}`}
        />
      </span>
    </button>
  );
}

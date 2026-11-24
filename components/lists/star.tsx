const STAR = "M10 2.8l2.15 4.5 4.95.62-3.63 3.42.93 4.9L10 13.85l-4.4 2.39.93-4.9L2.9 7.92l4.95-.62z";

/** The star of favorite lists (docs/design/v3 § 3.1): outlined when empty, filled with --saved when saved. Decorative. */
export function Star({ filled = false, size = 16, className = "" }: { filled?: boolean; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      aria-hidden="true"
      focusable="false"
      className={`shrink-0 ${filled ? "fill-saved stroke-saved" : "fill-none stroke-current"} ${className}`}
      strokeWidth={1.6}
      strokeLinejoin="round"
    >
      <path d={STAR} />
    </svg>
  );
}
